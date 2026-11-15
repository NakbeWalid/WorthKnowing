/** Configuration centralisée (variables d'environnement). */
const newsDriver = (process.env.NEWS_DRIVER ?? 'mock') as 'mock' | 'bedrock';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@miroir.local',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin123',
  /** Seuil du score de dérive à partir duquel une réévaluation est exigée. */
  driftThreshold: Number(process.env.DRIFT_THRESHOLD ?? 60),
  /** Capital fictif de départ de chaque utilisateur. */
  startingCash: 100_000,
  /** Nombre de mises en situation par évaluation (une par type de biais). */
  scenariosPerEvaluation: 5,
  /**
   * Pause entre les étapes du pipeline, pour que la vue admin les montre une à une (démo).
   * Inutile avec Bedrock : les appels au modèle introduisent déjà une vraie latence.
   */
  pipelineStepDelayMs: Number(process.env.PIPELINE_STEP_DELAY_MS ?? (newsDriver === 'bedrock' ? 0 : 350)),

  // --- AWS ---------------------------------------------------------------------
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  /** local = mot de passe scrypt + jeton HMAC ; cognito = Amazon Cognito User Pool. */
  authDriver: (process.env.AUTH_DRIVER ?? 'local') as 'local' | 'cognito',
  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID ?? '',
    clientId: process.env.COGNITO_CLIENT_ID ?? '',
  },
  /** Bucket S3 des données (dataset/, data/, corpus de nouvelles). Vide = disque local seulement. */
  dataBucket: process.env.DATA_BUCKET ?? '',
  /** json = data/db.json (local) ; dynamodb = tables DynamoDB ci-dessous. */
  storageDriver: (process.env.STORAGE_DRIVER ?? 'json') as 'json' | 'dynamodb',
  tables: {
    users: process.env.USERS_TABLE ?? 'miroir-users',
    evaluations: process.env.EVALUATIONS_TABLE ?? 'miroir-evaluations',
    trades: process.env.TRADES_TABLE ?? 'miroir-trades',
  },
  /** mock = signaux dérivés des prix ; bedrock = vraies nouvelles (GDELT) analysées par Bedrock. */
  newsDriver,
  /** template = résumé gabarit ; bedrock = résumé rédigé par Bedrock à partir des faits. */
  explainerDriver: (process.env.EXPLAINER_DRIVER ?? 'template') as 'template' | 'bedrock',
  /** off = constats déterministes seuls ; bedrock = + agent d'influence (nouvelles, historique). */
  influenceDriver: (process.env.INFLUENCE_DRIVER ?? 'off') as 'off' | 'bedrock',
  /** Modèle Bedrock (profil d'inférence). Haiku 4.5 : rapide et peu coûteux, suffisant pour classer et résumer. */
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  /** Fenêtre de recherche des nouvelles avant la date du trade (jamais après : pas de fuite du futur). */
  newsWindowDays: 7,
};
