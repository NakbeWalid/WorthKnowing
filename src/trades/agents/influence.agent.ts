import { Injectable, Logger } from '@nestjs/common';
import { BedrockClient } from '../../ai/bedrock.client';
import { inventedNumbers } from '../../ai/guards';
import {
  clamp, Finding, InfluenceVerdict, NewsItem, PARAM_INFO, ParamKey, pct, Profile, Trade,
} from '../../domain/types';
import { PARAM_CHECKS, TradeMetrics } from '../../evaluation/rule-templates';

export interface InfluenceInput {
  metrics: TradeMetrics;
  amount: number;
  note: string;
  news: NewsItem[];
  /** 10 derniers trades de l'utilisateur (plus récent d'abord). */
  recentTrades: Trade[];
  profile: Profile;
  /** Constats déterministes déjà établis (le socle). */
  deterministic: Finding[];
}
export interface InfluenceResult { findings: Finding[]; verdict: InfluenceVerdict | null }

/**
 * Agent d'influence : « ce trade montre-t-il un changement de comportement ou une influence externe ? »
 * Implémentation AWS : `BedrockInfluenceAgent`, choisie par INFLUENCE_DRIVER=bedrock.
 */
export abstract class InfluenceAgent {
  abstract analyse(input: InfluenceInput): Promise<InfluenceResult>;
}

/** Désactivé : seuls les constats déterministes comptent. */
@Injectable()
export class NoInfluenceAgent extends InfluenceAgent {
  async analyse(): Promise<InfluenceResult> {
    return { findings: [], verdict: null };
  }
}

/** Le modèle ne peut agir que sur les paramètres liés à une influence extérieure ; le reste est mécanique. */
const AI_PARAMS: ParamKey[] = ['newsSensitivity', 'fomo', 'lossAversion'];
/** Écart maximal entre le signal du modèle et le signal calculé par le code pour le même paramètre. */
const MAX_AI_SHIFT = 15;
const VERDICTS: InfluenceVerdict['verdict'][] = [
  'influence_externe', 'changement_de_comportement', 'les_deux', 'conforme', 'indetermine',
];

const SYSTEM = `Tu es l'agent d'influence de Miroir, un outil éducatif de SIMULATION d'investissement (aucun conseil financier).
On te donne des faits numérotés (F1, F2…) calculés par le code et des nouvelles réelles numérotées (N1, N2…).
Ta question : ce trade montre-t-il un changement de comportement de l'investisseur, une influence externe (nouvelle, emballement médiatique), les deux, ou rien de particulier ?
Règles absolues :
- Tu ne t'appuies QUE sur les faits et nouvelles fournis, cités par leur numéro. Aucun autre fait, chiffre ni cause.
- Tu recopies les chiffres tels quels ; tu ne calcules aucun nouveau chiffre.
- Une nouvelle ne prouve pas que l'investisseur l'a lue : parle d'influence « possible » ou « probable », jamais de cause certaine.
- C'est un profil de comportement, pas un diagnostic psychologique : n'emploie pas le mot « psychologique ».
- Si la recherche de nouvelles était indisponible, tu ne peux rien conclure sur une influence externe.
- Si les données ne permettent pas de conclure, réponds "indetermine". Dire qu'on ne sait pas est une bonne réponse.
- Jamais de recommandation d'achat ou de vente.
Tu réponds uniquement par un objet JSON, sans texte autour.`;

@Injectable()
export class BedrockInfluenceAgent extends InfluenceAgent {
  private log = new Logger('BedrockInfluence');
  constructor(private bedrock: BedrockClient) {
    super();
  }

  async analyse(input: InfluenceInput): Promise<InfluenceResult> {
    const facts = buildFacts(input);
    const news = input.news.filter((n) => !n.simulated); // un signal simulé n'est pas une influence externe
    const known = new Set([...facts.map((_, i) => `F${i + 1}`), ...news.map((_, i) => `N${i + 1}`)]);
    const covered = new Set(input.deterministic.map((f) => f.param));
    const allowed = AI_PARAMS.filter((p) => !covered.has(p));

    const prompt = `Faits :
${facts.map((f, i) => `F${i + 1}. ${f}`).join('\n')}

Nouvelles réelles publiées dans les 7 jours avant le trade :
${newsBlock(input.news, news)}

Constats déjà établis par le code : ${input.deterministic.map((f) => f.param).join(', ') || 'aucun'}.

Réponds avec :
- "verdict" : "influence_externe", "changement_de_comportement", "les_deux", "conforme" ou "indetermine" ;
- "rationale" : 1 à 2 phrases en français (50 mots maximum), en citant les numéros entre crochets, ex. [N1] [F3] ;
- "refs" : les numéros cités ;
- "findings" : 0 à 2 constats SUPPLÉMENTAIRES, uniquement pour ces paramètres : ${allowed.join(', ') || '(aucun : renvoie [])'}.
  Chaque constat : {"param":"...","signal":0-100,"evidence":"phrase courte en français","refs":["N1"]}.
  Paramètres : newsSensitivity = réagit aux manchettes ; fomo = achète ce qui vient de beaucoup monter ; lossAversion = vend dans la panique.
Format : {"verdict":"...","rationale":"...","refs":["F1"],"findings":[]}`;

    try {
      const out = await this.bedrock.json<any>(SYSTEM, prompt, 700);
      const verdict = this.checkVerdict(out, known, `${facts.join(' ')} ${news.map((n) => n.title).join(' ')}`);
      // Pas de constat supplémentaire si le modèle lui-même ne voit rien de particulier.
      const findings = ['conforme', 'indetermine'].includes(verdict.verdict)
        ? [] : this.checkFindings(out.findings, known, allowed, input, news);
      return { verdict, findings };
    } catch (err) {
      this.log.warn(`analyse impossible : ${(err as Error).message}`);
      return { findings: [], verdict: null };
    }
  }

  /** Une conclusion doit s'appuyer sur des références existantes ; « influence externe » exige une vraie nouvelle. */
  private checkVerdict(out: any, known: Set<string>, factsText: string): InfluenceVerdict {
    const refs = validRefs(out.refs, known);
    let verdict = VERDICTS.includes(out.verdict) ? out.verdict as InfluenceVerdict['verdict'] : 'indetermine';
    const needsNews = verdict === 'influence_externe' || verdict === 'les_deux';
    if ((needsNews && !refs.some((r) => r.startsWith('N'))) || (verdict !== 'indetermine' && !refs.length)) {
      verdict = 'indetermine';
    }
    let rationale = typeof out.rationale === 'string' ? out.rationale.trim().slice(0, 400) : '';
    // Un chiffre absent des faits = chiffre inventé ou recalculé : on ne montre que les références.
    if (!rationale || inventedNumbers(rationale, factsText).length) {
      rationale = refs.length ? `Appuyé sur : ${refs.join(', ')}.` : 'Les données fournies ne permettent pas de conclure.';
    }
    return { verdict, rationale, refs, model: this.bedrock.modelId };
  }

  /** Rejette tout constat sans référence valide ; borne le signal à ±15 autour du signal calculé par le code. */
  private checkFindings(raw: unknown, known: Set<string>, allowed: ParamKey[], input: InfluenceInput, news: NewsItem[]): Finding[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<ParamKey>();
    const findings: Finding[] = [];
    for (const f of raw.slice(0, 2)) {
      const param = f?.param as ParamKey;
      const refs = validRefs(f?.refs, known);
      const allKnown = Array.isArray(f?.refs) && f.refs.every((r: unknown) => known.has(String(r)));
      if (!allowed.includes(param) || seen.has(param) || !refs.length || !allKnown) continue;
      if (typeof f.evidence !== 'string' || !Number.isFinite(Number(f.signal))) continue;
      seen.add(param);
      const anchor = PARAM_CHECKS[param].signal(input.metrics);
      const signal = clamp(Math.max(anchor - MAX_AI_SHIFT, Math.min(anchor + MAX_AI_SHIFT, Number(f.signal))));
      // Un constat signale un comportement exprimé : il ne peut que renforcer le paramètre, jamais l'abaisser.
      if (signal <= input.profile.current[param]) continue;
      const cited = refs.filter((r) => r.startsWith('N')).map((r) => `« ${news[Number(r.slice(1)) - 1].title} »`);
      findings.push({
        param, signal, origin: 'bedrock',
        evidence: `Analyse IA (${PARAM_INFO[param].label.toLowerCase()}) : ${f.evidence.trim().slice(0, 200)}`
          + (cited.length ? ` Source : ${cited.join(', ')}.` : ''),
      });
    }
    return findings;
  }
}

/** Faits fournis au modèle : uniquement ce que le code a calculé ou ce que l'utilisateur a écrit. */
function buildFacts(i: InfluenceInput): string[] {
  const { context: c, side, positionWeight, speculativeWeight, decisionSeconds } = i.metrics;
  const p = i.profile;
  const facts = [
    `Trade : ${side === 'buy' ? 'achat' : 'vente'} de ${Math.round(i.amount)} $ de ${c.name} (${c.ticker}), date de marché ${c.date}, décision prise en ${decisionSeconds.toFixed(0)} s.`,
    `Mouvement de prix : ${pct(c.ret1d)} sur 1 séance, ${pct(c.ret5d)} sur 5 séances, ${pct(c.ret30d)} sur 30 séances.`,
    `Volatilité annualisée 30 séances : ${(c.vol30d * 100).toFixed(0)} % ; écart au sommet de 90 séances : ${pct(c.drawdown90d)} ; ${c.speculative ? 'actif spéculatif' : 'actif non spéculatif'}.`,
    `Après le trade : la position pèse ${(positionWeight * 100).toFixed(0)} % du portefeuille, les actifs spéculatifs ${(speculativeWeight * 100).toFixed(0)} %.`,
    `Profil de référence (observé à l'évaluation) : ${Object.entries(p.baseline).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    `Profil actuel : ${Object.entries(p.current).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    i.note.trim() ? `Note écrite par l'investisseur : « ${i.note.trim()} »` : 'L’investisseur n’a écrit aucune note.',
  ];
  if (!i.recentTrades.length) facts.push('Aucun trade précédent.');
  for (const t of i.recentTrades.slice(0, 10)) {
    const params = t.investigation.findings.map((f) => f.param).join(', ') || 'aucun constat';
    facts.push(`Trade précédent : ${t.marketDate}, ${t.side === 'buy' ? 'achat' : 'vente'} de ${Math.round(t.amount)} $ de ${t.ticker}, décision en ${(t.decisionTimeMs / 1000).toFixed(0)} s, constats : ${params}.`);
  }
  return facts;
}

/** Distingue « aucune nouvelle trouvée » (information) de « recherche indisponible » (on ne sait pas). */
function newsBlock(all: NewsItem[], real: NewsItem[]): string {
  if (real.length) return real.map((n, i) => `N${i + 1}. ${n.date} · ${n.source} · impact ${n.impact} · ${n.title}`).join('\n');
  if (all.some((n) => n.simulated)) return '(recherche de nouvelles indisponible pour ce trade : impossible de conclure sur une influence externe)';
  return '(aucune nouvelle trouvée dans les sources interrogées)';
}

function validRefs(raw: unknown, known: Set<string>): string[] {
  return Array.isArray(raw) ? [...new Set(raw.map(String).filter((r) => known.has(r)))] : [];
}
