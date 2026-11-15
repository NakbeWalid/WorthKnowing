import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Briques d'authentification locale, utilisées séparément par chaque application avec SON propre secret :
 * mot de passe haché (scrypt + sel) et jeton signé HMAC-SHA256. Aucune dépendance externe.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = (stored ?? '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Signe un objet JSON : « <corps base64url>.<signature> ». */
export function signToken(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body, secret)}`;
}

/** Retourne l'objet signé, ou undefined si la signature est invalide ou si `exp` (ms) est dépassé. */
export function verifyToken<T extends { exp?: number }>(token: string, secret: string): T | undefined {
  const [body, signature] = String(token ?? '').split('.');
  if (!body || !signature || !safeEqual(signature, hmac(body, secret))) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
    return payload.exp && payload.exp < Date.now() ? undefined : payload;
  } catch {
    return undefined;
  }
}

/** Comparaison à temps constant (clés d'API, signatures). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

const hmac = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest('base64url');
