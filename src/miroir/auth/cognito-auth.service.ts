import { BadRequestException, ConflictException, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import {
  AdminAddUserToGroupCommand, AdminConfirmSignUpCommand, AdminCreateUserCommand, AdminGetUserCommand,
  AdminInitiateAuthCommand, AdminSetUserPasswordCommand, CognitoIdentityProviderClient, SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { config } from '../config';
import { EventsService } from '../realtime/events.service';
import { Store } from '../storage/store';
import { AuthResult, AuthService, newUser, publicUser, TokenPayload, validateRegistration } from './auth.service';

const ADMIN_GROUP = 'admin';

/**
 * Authentification Amazon Cognito (AUTH_DRIVER=cognito).
 *  - Les mots de passe ne sont jamais stockés par Miroir : Cognito les gère (politique, hachage, verrouillage).
 *  - Le serveur appelle Cognito (SignUp, AdminInitiateAuth) et renvoie le jeton d'accès au navigateur,
 *    qui l'envoie comme avant en `Authorization: Bearer` : les pages et les gardes ne changent pas.
 *  - Chaque requête vérifie la signature du JWT (clés publiques du User Pool) ; le rôle vient du
 *    groupe Cognito « admin ». L'objet User métier reste dans le Store, clé = `sub` Cognito.
 * Simplification de démo : l'inscription est confirmée par le serveur (pas de code envoyé par courriel).
 */
@Injectable()
export class CognitoAuthService extends AuthService implements OnModuleInit {
  private log = new Logger('Cognito');
  private idp = new CognitoIdentityProviderClient({ region: config.awsRegion });
  private verifier = CognitoJwtVerifier.create({
    userPoolId: config.cognito.userPoolId, clientId: config.cognito.clientId, tokenUse: 'access',
  });

  constructor(private store: Store, private events: EventsService) {
    super();
  }

  /** Précharge les clés publiques et garantit l'existence du compte admin (membre du groupe « admin »). */
  async onModuleInit() {
    await this.verifier.hydrate();
    const email = config.adminEmail.toLowerCase();
    let sub: string | undefined;
    try {
      const existing = await this.idp.send(new AdminGetUserCommand({ UserPoolId: config.cognito.userPoolId, Username: email }));
      sub = existing.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
    } catch (err) {
      if ((err as Error).name !== 'UserNotFoundException') throw err;
      const created = await this.idp.send(new AdminCreateUserCommand({
        UserPoolId: config.cognito.userPoolId, Username: email, MessageAction: 'SUPPRESS',
        UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }],
      }));
      await this.idp.send(new AdminSetUserPasswordCommand({
        UserPoolId: config.cognito.userPoolId, Username: email, Password: config.adminPassword, Permanent: true,
      }));
      sub = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
      this.log.log(`compte admin créé : ${email}`);
    }
    await this.idp.send(new AdminAddUserToGroupCommand({ UserPoolId: config.cognito.userPoolId, Username: email, GroupName: ADMIN_GROUP }));
    if (sub && !(await this.store.getUser(sub))) await this.store.saveUser(newUser(sub, email, 'Admin', 'admin'));
  }

  async register(email: string, password: string, name: string) {
    validateRegistration(email, password, name);
    email = email.trim().toLowerCase();
    let sub: string;
    try {
      const out = await this.idp.send(new SignUpCommand({
        ClientId: config.cognito.clientId, Username: email, Password: password,
        UserAttributes: [{ Name: 'email', Value: email }, { Name: 'name', Value: name.trim() }],
      }));
      sub = out.UserSub!;
      await this.idp.send(new AdminConfirmSignUpCommand({ UserPoolId: config.cognito.userPoolId, Username: email }));
    } catch (err) {
      const e = err as Error;
      if (e.name === 'UsernameExistsException') throw new ConflictException('Ce courriel est déjà inscrit.');
      if (e.name === 'InvalidPasswordException' || e.name === 'InvalidParameterException') throw new BadRequestException(e.message);
      throw err;
    }
    const user = newUser(sub, email, name.trim(), 'user');
    await this.store.saveUser(user);
    this.events.emit('user.registered', user, 'Nouvel utilisateur inscrit');
    return this.login(email, password);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    let token: string | undefined;
    try {
      const out = await this.idp.send(new AdminInitiateAuthCommand({
        UserPoolId: config.cognito.userPoolId, ClientId: config.cognito.clientId, AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: (email ?? '').trim().toLowerCase(), PASSWORD: password ?? '' },
      }));
      token = out.AuthenticationResult?.AccessToken;
    } catch (err) {
      const name = (err as Error).name;
      if (['NotAuthorizedException', 'UserNotFoundException', 'UserNotConfirmedException'].includes(name)) {
        throw new UnauthorizedException('Courriel ou mot de passe invalide.');
      }
      throw err;
    }
    if (!token) throw new UnauthorizedException('Connexion incomplète (défi Cognito non pris en charge).');
    const payload = await this.verify(token);
    let user = await this.store.getUser(payload.sub);
    // Compte créé directement dans Cognito (console) : on crée l'objet métier à la première connexion.
    if (!user) {
      user = newUser(payload.sub, email, email.split('@')[0], payload.role);
      await this.store.saveUser(user);
    }
    return { token, user: publicUser({ ...user, role: payload.role }) };
  }

  async verify(token: string): Promise<TokenPayload> {
    try {
      const p = await this.verifier.verify(token ?? '');
      const groups = (p['cognito:groups'] as string[] | undefined) ?? [];
      return { sub: p.sub, role: groups.includes(ADMIN_GROUP) ? 'admin' : 'user', exp: p.exp * 1000 };
    } catch {
      throw new UnauthorizedException('Jeton invalide ou expiré.');
    }
  }
}
