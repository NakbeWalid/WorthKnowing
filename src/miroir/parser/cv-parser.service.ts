import { Injectable, Logger } from '@nestjs/common';
import * as zlib from 'zlib';
import { ParamScores } from '../domain/types';

function scoreToOption(score: number): string {
  const reference = [15, 40, 65, 90];
  let bestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < reference.length; i++) {
    const diff = Math.abs(reference[i] - score);
    if (diff < minDiff) {
      minDiff = diff;
      bestIdx = i;
    }
  }
  return String(bestIdx);
}

export interface ParsedCvResult {
  textSnippet: string;
  detectedName?: string;
  detectedRole?: string;
  industry?: string;
  yearsOfExperience: number;
  seniority: 'junior' | 'intermediate' | 'senior' | 'lead' | 'executive';
  financialLiteracy: 'novice' | 'intermediate' | 'advanced';
  esgAffinity: 'high' | 'medium' | 'low';
  cryptoAffinity: 'yes' | 'no';
  suggestedAnswers: {
    age: string;
    horizon: string;
    objective: string;
    experience: string;
    esg: string;
    crypto: string;
    follows: string;
    [key: string]: string;
  };
  inferredScores: ParamScores;
  highlights: string[];
  summary: string;
}

@Injectable()
export class CvParserService {
  private log = new Logger('CvParser');

  /** Extrait le texte d'un buffer ou d'une chaîne (PDF, texte brut, JSON). */
  extractText(input: Buffer | string, filename = ''): string {
    if (typeof input === 'string') {
      if (input.startsWith('data:') && input.includes(';base64,')) {
        const base64Data = input.split(';base64,')[1];
        return this.extractFromBuffer(Buffer.from(base64Data, 'base64'), filename);
      }
      // Si la chaîne est du base64 brut ou si le nom est un PDF
      const trimmed = input.trim();
      if (
        filename.toLowerCase().endsWith('.pdf') ||
        trimmed.startsWith('JVBERi') ||
        (trimmed.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(trimmed.slice(0, 100)))
      ) {
        try {
          const buf = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
          if (buf.slice(0, 5).toString('ascii').startsWith('%PDF')) {
            return this.extractFromBuffer(buf, filename || 'cv.pdf');
          }
        } catch {
          // pas du base64 valide
        }
      }
      return input;
    }
    return this.extractFromBuffer(input, filename);
  }

  private extractFromBuffer(buf: Buffer, filename: string): string {
    const isPdf =
      filename.toLowerCase().endsWith('.pdf') ||
      buf.slice(0, 5).toString('ascii').startsWith('%PDF');

    if (isPdf) {
      try {
        const text = this.parsePdfBuffer(buf);
        if (text && text.trim().length > 20) return text;
      } catch (err) {
        this.log.warn(`Extraction PDF zlib échouée : ${(err as Error).message}`);
      }
    }

    // Repli sur le décodage texte / UTF-8
    return buf.toString('utf-8');
  }

  /**
   * Parseur PDF léger sans dépendance externe :
   * Décompresse les flux /FlateDecode et extrait les opérateurs de texte Tj, TJ et chaînes hexadécimales.
   */
  private parsePdfBuffer(buf: Buffer): string {
    const textPieces: string[] = [];

    // 1) Parcours binaire fiable des blocs stream ... endstream (évite tout débordement regex)
    let searchPos = 0;
    while (searchPos < buf.length) {
      const streamIdx = buf.indexOf(Buffer.from('stream'), searchPos);
      if (streamIdx === -1) break;

      let start = streamIdx + 6;
      if (buf[start] === 0x0d && buf[start + 1] === 0x0a) {
        start += 2;
      } else if (buf[start] === 0x0a || buf[start] === 0x0d) {
        start += 1;
      }

      const endIdx = buf.indexOf(Buffer.from('endstream'), start);
      if (endIdx === -1) break;

      let end = endIdx;
      if (end > start && (buf[end - 1] === 0x0a || buf[end - 1] === 0x0d)) end--;
      if (end > start && (buf[end - 1] === 0x0a || buf[end - 1] === 0x0d)) end--;

      if (end > start) {
        const rawStream = buf.subarray(start, end);
        let decompressed: Buffer | null = null;
        try {
          decompressed = zlib.inflateSync(rawStream);
        } catch {
          try {
            decompressed = zlib.inflateRawSync(rawStream);
          } catch {
            // non compressé
            decompressed = rawStream;
          }
        }

        if (decompressed) {
          const streamStr = decompressed.toString('latin1');

          // Opérateurs standard de texte Tj : (Texte) Tj
          const tjRegex = /\(([^)]+)\)\s*Tj/g;
          let tjMatch: RegExpExecArray | null;
          while ((tjMatch = tjRegex.exec(streamStr)) !== null) {
            textPieces.push(this.cleanPdfString(tjMatch[1]));
          }

          // Opérateurs array TJ : [(Texte) 10 (Suite)] TJ
          const arrayTjRegex = /\[(.*?)\]\s*TJ/g;
          let arrayMatch: RegExpExecArray | null;
          while ((arrayMatch = arrayTjRegex.exec(streamStr)) !== null) {
            const inner = arrayMatch[1];
            const innerStrings = inner.match(/\(([^)]*)\)/g);
            if (innerStrings) {
              textPieces.push(
                innerStrings.map((s) => this.cleanPdfString(s.slice(1, -1))).join(''),
              );
            }
            // Chaînes hexadécimales dans TJ : [<00480065> 10 <006c006c006f>] TJ
            const hexMatches = inner.match(/<([0-9a-fA-F]+)>/g);
            if (hexMatches) {
              textPieces.push(hexMatches.map((h) => this.decodePdfHex(h.slice(1, -1))).join(''));
            }
          }

          // Opérateurs hexadécimaux <...> Tj
          const hexTjRegex = /<([0-9a-fA-F]{4,})>\s*Tj/g;
          let hexMatch: RegExpExecArray | null;
          while ((hexMatch = hexTjRegex.exec(streamStr)) !== null) {
            textPieces.push(this.decodePdfHex(hexMatch[1]));
          }
        }
      }

      searchPos = endIdx + 9;
    }

    const fullText = textPieces.join(' ').replace(/\s+/g, ' ').trim();
    if (fullText.length > 20) return fullText;

    // Si extraction des streams n'a pas suffi, chercher les chaînes littérales ou métadonnées
    const rawContent = buf.toString('latin1');
    const rawMatches = rawContent.match(/\(([^)]{3,})\)/g);
    if (rawMatches) {
      return rawMatches.map((m) => this.cleanPdfString(m.slice(1, -1))).join(' ');
    }

    return '';
  }

  private decodePdfHex(hex: string): string {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    if (!clean) return '';
    try {
      const bytes = Buffer.from(clean, 'hex');
      if (clean.toLowerCase().startsWith('feff') && bytes.length >= 2) {
        return bytes.subarray(2).swap16().toString('utf16le');
      }
      // UTF-16BE si alternance de 00
      if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[2] === 0x00) {
        return bytes.swap16().toString('utf16le');
      }
      return bytes.toString('latin1');
    } catch {
      return '';
    }
  }

  private cleanPdfString(s: string): string {
    return s
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\([\\()])/g, '$1');
  }

  /** Analyse sémantique et comportementale du texte de CV. */
  parseCv(rawInput: Buffer | string, filename = ''): ParsedCvResult {
    const text = this.extractText(rawInput, filename);
    const lower = text.toLowerCase();

    // Détection d'années et calcul d'expérience
    const yearMatches = [...text.matchAll(/\b(19\d{2}|20[0-2]\d)\b/g)].map((m) => Number(m[1]));
    const validYears = yearMatches.filter((y) => y >= 1970 && y <= 2026);
    let minYear = validYears.length ? Math.min(...validYears) : 2020;
    let maxYear = validYears.length ? Math.max(...validYears) : 2026;
    let computedYears = Math.max(1, Math.min(45, maxYear - minYear));

    // Si explicitement mentionné : "X ans d'expérience" ou "X+ years of experience"
    const expRegex = /(\d+)\+?\s*(?:ans|years?)\s*(?:d['’]exp|of experience)/i;
    const expMatch = text.match(expRegex);
    if (expMatch) {
      computedYears = parseInt(expMatch[1], 10);
    }

    // Détection du niveau de séniorité
    let seniority: ParsedCvResult['seniority'] = 'intermediate';
    if (/lead|principal|architect|director|head of|vp|partner|fondateur|founder|ceo|cto|cfo/i.test(text)) {
      seniority = 'senior';
      if (/director|vp|cfo|ceo|partner|fondateur/i.test(text)) seniority = 'executive';
    } else if (/junior|stagiaire|intern|étudiant|student|assistant|apprentice/i.test(text) || computedYears <= 2) {
      seniority = 'junior';
    } else if (computedYears >= 8) {
      seniority = 'senior';
    }

    // Détection du domaine
    let industry = 'Technologie & Ingénierie';
    if (/finance|banque|bourse|trading|portfolio|wealth|comptab|audit|cpa|cfa|investment|asset management/i.test(text)) {
      industry = 'Finance & Investissement';
    } else if (/santé|biotech|médic|pharma|clinical|doctor|infirm/i.test(text)) {
      industry = 'Santé & Sciences de la vie';
    } else if (/droit|juriste|avocat|legal|compliance|juridique/i.test(text)) {
      industry = 'Droit & Réglementation';
    } else if (/marketing|sales|vente|commerce|business development/i.test(text)) {
      industry = 'Commerce & Marketing';
    }

    // Détection de la culture financière
    let financialLiteracy: ParsedCvResult['financialLiteracy'] = 'novice';
    const finTerms = ['cfa', 'cpa', 'dcf', 'portefeuille', 'actions', 'obligations', 'etf', 'option', 'dérivé', 'pe ratio', 'bloomberg', 'ebitda', 'trading', 'hedge fund', 'courtage'];
    const finHits = finTerms.filter((term) => lower.includes(term));
    if (finHits.length >= 4 || /cfa|gérant de fonds|trader|analyste financier/i.test(text)) {
      financialLiteracy = 'advanced';
    } else if (finHits.length >= 1 || /économie|gestion|comptabilité|business/i.test(text)) {
      financialLiteracy = 'intermediate';
    }

    // ESG & Durabilité
    const esgHits = ['esg', 'durable', 'rse', 'carbone', 'renouvelable', 'écolog', 'climat', 'impact investing', 'green bond'].filter((t) => lower.includes(t));
    const esgAffinity: ParsedCvResult['esgAffinity'] = esgHits.length >= 2 ? 'high' : esgHits.length === 1 ? 'medium' : 'low';

    // Crypto & Blockchain
    const cryptoHits = ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'web3', 'defi', 'solidity', 'token', 'smart contract'].filter((t) => lower.includes(t));
    const cryptoAffinity: ParsedCvResult['cryptoAffinity'] = cryptoHits.length >= 1 ? 'yes' : 'no';

    // Déduction tranche d'âge
    let age = '30-44';
    if (minYear >= 2018 || computedYears <= 4) age = '18-29';
    else if (minYear <= 1998 || computedYears >= 20) age = '45-59';

    // Horizon et objectifs déduits
    let horizon = '15+';
    let objective = 'growth';
    if (age === '45-59') {
      horizon = '3-5';
      objective = 'preserve';
    } else if (age === '30-44') {
      horizon = '8-12';
      objective = 'balanced';
    }

    // Suivi marché
    const follows = financialLiteracy === 'advanced' ? 'daily' : 'weekly';

    // Inférence des 6 critères comportementaux initiaux (ce que vous pensez / a priori)
    const inferredScores: ParamScores = {
      riskTolerance: cryptoAffinity === 'yes' ? 70 : industry.includes('Finance') ? 55 : age === '18-29' ? 60 : 35,
      lossAversion: financialLiteracy === 'advanced' ? 40 : age === '45-59' ? 65 : 45,
      fomo: cryptoAffinity === 'yes' ? 65 : seniority === 'junior' ? 55 : 30,
      concentration: financialLiteracy === 'advanced' ? 30 : 45,
      impulsivity: seniority === 'executive' ? 35 : seniority === 'junior' ? 50 : 40,
      newsSensitivity: financialLiteracy === 'advanced' ? 55 : 40,
    };

    const highlights: string[] = [
      `Expérience estimée : ~${computedYears} an(s) (Niveau : ${seniority})`,
      `Secteur d'activité : ${industry}`,
      `Culture financière détectée : ${financialLiteracy}`,
      `Sensibilité ESG : ${esgAffinity === 'high' ? 'Élevée' : esgAffinity === 'medium' ? 'Modérée' : 'Standard'}`,
      `Intérêt crypto/blockchain : ${cryptoAffinity === 'yes' ? 'Détecté' : 'Non mentionné'}`,
    ];

    const summary = `Profil extrait : professionnel de niveau ${seniority} dans le domaine « ${industry} ». Culture financière évaluée comme « ${financialLiteracy} ». Orientation vers un horizon d'investissement « ${horizon} ans » avec objectif « ${objective} ».`;

    return {
      textSnippet: text.slice(0, 300) + (text.length > 300 ? '…' : ''),
      industry,
      yearsOfExperience: computedYears,
      seniority,
      financialLiteracy,
      esgAffinity,
      cryptoAffinity,
      suggestedAnswers: {
        age,
        horizon,
        objective,
        experience: financialLiteracy === 'novice' ? 'beginner' : financialLiteracy,
        esg: esgAffinity,
        crypto: cryptoAffinity,
        follows,
        riskTolerance: scoreToOption(inferredScores.riskTolerance),
        lossAversion: scoreToOption(inferredScores.lossAversion),
        fomo: scoreToOption(inferredScores.fomo),
        concentration: scoreToOption(inferredScores.concentration),
        impulsivity: scoreToOption(inferredScores.impulsivity),
        newsSensitivity: scoreToOption(inferredScores.newsSensitivity),
      },
      inferredScores,
      highlights,
      summary,
    };
  }
}
