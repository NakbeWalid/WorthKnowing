import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ParamScores } from '../domain/types';
import { CvParserService, ParsedCvResult } from './cv-parser.service';

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

@Controller(['api/parser', 'parser'])
export class ParserController {
  constructor(private cvParser: CvParserService) {}

  /** Parse un CV (PDF en base64 ou texte brut) et extrait le profil comportemental. */
  @Post('cv')
  @HttpCode(200)
  parseCv(@Body() body: { text?: string; base64?: string; filename?: string }) {
    if (!body?.text && !body?.base64) {
      throw new BadRequestException('Veuillez fournir le contenu du CV (texte ou fichier base64).');
    }
    const input = body.base64 || body.text || '';
    return this.cvParser.parseCv(input, body.filename || 'cv.pdf');
  }

  /**
   * Analyse du CV pour pré-remplir les 13 questions et affiner la caractérisation
   * comportementale sans jamais forcer l'utilisateur à sauter les questions.
   */
  @Post('enrich')
  @HttpCode(200)
  async enrichProfile(
    @Body()
    body: {
      cv?: { text?: string; base64?: string; filename?: string };
      text?: string;
      base64?: string;
      filename?: string;
    },
  ) {
    const cvInput = body.cv?.base64 || body.cv?.text || body.base64 || body.text || '';
    const filename = body.cv?.filename || body.filename || 'cv.pdf';

    if (!cvInput) {
      throw new BadRequestException('Veuillez fournir un CV (fichier PDF ou texte).');
    }

    const cvResult = this.cvParser.parseCv(cvInput, filename);
    const cvScores = cvResult.inferredScores;

    const inferredScores: ParamScores = {
      riskTolerance: cvScores.riskTolerance,
      lossAversion: cvScores.lossAversion,
      fomo: cvScores.fomo,
      concentration: cvScores.concentration,
      impulsivity: cvScores.impulsivity,
      newsSensitivity: cvScores.newsSensitivity,
    };

    // Réponses suggérées pour les 13 questions du questionnaire
    const suggestedAnswers: Record<string, string> = {
      age: cvResult.suggestedAnswers.age ?? '30-44',
      horizon: cvResult.suggestedAnswers.horizon ?? '8-12',
      objective: cvResult.suggestedAnswers.objective ?? 'balanced',
      experience: cvResult.suggestedAnswers.experience === 'novice'
        ? 'beginner'
        : (cvResult.suggestedAnswers.experience ?? 'intermediate'),
      esg: cvResult.suggestedAnswers.esg ?? 'medium',
      crypto: cvResult.suggestedAnswers.crypto ?? 'curious',
      follows: cvResult.suggestedAnswers.follows ?? 'weekly',
      // Les 6 questions de posture (0, 1, 2, 3)
      riskTolerance: scoreToOption(inferredScores.riskTolerance),
      lossAversion: scoreToOption(inferredScores.lossAversion),
      fomo: scoreToOption(inferredScores.fomo),
      concentration: scoreToOption(inferredScores.concentration),
      impulsivity: scoreToOption(inferredScores.impulsivity),
      newsSensitivity: scoreToOption(inferredScores.newsSensitivity),
    };

    return {
      cv: cvResult,
      suggestedAnswers,
      inferredScores,
      highlights: cvResult.highlights,
      summary: cvResult.summary,
    };
  }
}
