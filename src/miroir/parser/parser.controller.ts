import { BadRequestException, Body, Controller, Delete, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CvProfile } from '../domain/types';
import { Store } from '../storage/store';
import { CvParserService } from './cv-parser.service';

/** Environ 5 Mo de fichier une fois encodé en base64. */
const MAX_CV_CHARS = 7_000_000;

/**
 * CV facultatif (utilisateur connecté uniquement, comme les autres routes de l'API).
 * Le CV n'est PAS une réponse au questionnaire : ses scores sont conservés à part (user.cvProfile) et
 * entrent comme source distincte dans la référence du profil à la fin de l'évaluation (EvaluationService.finalize).
 * Le texte du CV n'est jamais conservé.
 */
@Controller('api/parser')
@UseGuards(AuthGuard)
export class ParserController {
  constructor(private cvParser: CvParserService, private store: Store) {}

  @Post('cv')
  @HttpCode(200)
  async analyse(@Req() req: any, @Body() body: { text?: string; base64?: string; filename?: string }) {
    const input = body?.base64 || body?.text || '';
    if (typeof input !== 'string' || !input.trim()) {
      throw new BadRequestException('Veuillez fournir le contenu du CV (texte ou fichier).');
    }
    if (input.length > MAX_CV_CHARS) throw new BadRequestException('CV trop volumineux (5 Mo maximum).');
    const parsed = this.cvParser.parseCv(input, String(body?.filename ?? 'cv.pdf').slice(0, 120));
    const cvProfile: CvProfile = {
      inferredScores: parsed.inferredScores, summary: parsed.summary, highlights: parsed.highlights,
      analysedAt: new Date().toISOString(),
    };
    req.user.cvProfile = cvProfile;
    await this.store.saveUser(req.user);
    return cvProfile;
  }

  /** L'utilisateur retire son CV : il ne sera pas pris en compte à sa prochaine évaluation. */
  @Delete('cv')
  async remove(@Req() req: any) {
    req.user.cvProfile = null;
    await this.store.saveUser(req.user);
    return { ok: true };
  }
}
