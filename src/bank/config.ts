import { env } from '../shared/env';

const port = Number(process.env.BANK_PORT ?? 3001);

/**
 * Configuration de Boréal Courtage — plateforme de courtage FICTIVE, entièrement indépendante de Miroir.
 * Elle ne connaît de Miroir que deux adresses et une clé d'API.
 */
export const config = {
  port,
  name: 'Boréal Courtage',
  jwtSecret: process.env.BANK_JWT_SECRET ?? 'dev-bank-secret-change-me',
  /** Capital fictif de départ de chaque compte. */
  startingCash: 100_000,
  /** Adresse publique de cette application (sert d'adresse de retour après la liaison Miroir). */
  publicUrl: (process.env.BANK_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  miroir: {
    /** Adresse de l'API partenaire de Miroir, appelée de serveur à serveur. */
    apiUrl: (process.env.MIROIR_API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    /** Adresse de Miroir vue par le navigateur du client (redirections). */
    publicUrl: (process.env.MIROIR_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    /** Clé d'API partenaire (même valeur que PARTNER_API_KEY côté Miroir). */
    apiKey: process.env.PARTNER_API_KEY ?? 'dev-partner-key-change-me',
    /** Le pré-contrôle doit être rapide : au-delà, le trade se poursuit sans rappel. */
    checkTimeoutMs: Number(process.env.MIROIR_CHECK_TIMEOUT_MS ?? 8_000),
    /** L'enquête peut appeler des modèles : on attend au plus 50 s (sous la limite de 60 s de CloudFront). */
    submitTimeoutMs: Number(process.env.MIROIR_SUBMIT_TIMEOUT_MS ?? 50_000),
  },
  awsRegion: env.awsRegion,
  /** json = data/bank-db.json (local) ; dynamodb = tables ci-dessous. */
  storageDriver: (process.env.BANK_STORAGE_DRIVER ?? 'json') as 'json' | 'dynamodb',
  tables: {
    accounts: process.env.BANK_ACCOUNTS_TABLE ?? 'boreal-accounts',
    trades: process.env.BANK_TRADES_TABLE ?? 'boreal-trades',
  },
};
