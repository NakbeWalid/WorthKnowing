import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthService, publicUser } from './auth.service';

@Controller('api')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('auth/register')
  register(@Body() body: { email: string; password: string; name: string }) {
    return this.auth.register(body.email, body.password, body.name);
  }

  @Post('auth/login')
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body.email, body.password);
  }

  /** Profil complet de l'utilisateur connecté (profil, règles, dérive, portefeuille). */
  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: any) {
    return publicUser(req.user);
  }
}
