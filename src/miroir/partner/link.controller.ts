import { Body, Controller, Delete, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { LinkService } from './link.service';

/** Côté utilisateur Miroir : autoriser ou révoquer la liaison avec la plateforme de courtage. */
@Controller('api/link')
export class LinkController {
  constructor(private links: LinkService) {}

  /** Public : cette adresse de retour appartient-elle à un partenaire connu ? (affichage + anti redirection ouverte) */
  @Get('partner')
  partner(@Query('return') returnUrl: string) {
    const name = this.links.partnerFor(returnUrl);
    return { allowed: !!name, name: name ?? null };
  }

  /** L'utilisateur autorise la liaison : retourne l'URL du courtier avec le code à usage unique. */
  @Post('authorize')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  authorize(@Req() req: any, @Body() body: { state: string; returnUrl: string }) {
    return this.links.authorize(req.user, body?.state, body?.returnUrl);
  }

  @Delete()
  @UseGuards(AuthGuard)
  revoke(@Req() req: any) { return this.links.revoke(req.user); }
}
