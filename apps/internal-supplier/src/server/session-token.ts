import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionClaims {
  version: 2;
  supplierNo: string;
  supplierName: string;
  workspaceCode: string;
  workspaceInstanceId: string;
  issuedAt: number;
  expiresAt: number;
}

function secretBytes(secret: string): Buffer {
  if (secret.length < 32) throw new Error('DEMO_SESSION_SECRET 至少需要 32 个字符');
  return Buffer.from(secret, 'utf8');
}

function signPart(payload: string, secret: string): string {
  return createHmac('sha256', secretBytes(secret)).update(payload).digest('base64url');
}

export function createSessionToken(
  supplier: Pick<SessionClaims, 'supplierNo' | 'supplierName' | 'workspaceCode' | 'workspaceInstanceId'>,
  secret: string,
  now = Date.now(),
  maxAgeSeconds = 8 * 60 * 60,
): string {
  const claims: SessionClaims = {
    version: 2,
    ...supplier,
    issuedAt: Math.floor(now / 1000),
    expiresAt: Math.floor(now / 1000) + maxAgeSeconds,
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${payload}.${signPart(payload, secret)}`;
}

export function verifySessionToken(token: string, secret: string, now = Date.now()): SessionClaims | null {
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;
    const expected = signPart(payload, secret);
    const actualBytes = Buffer.from(signature, 'base64url');
    const expectedBytes = Buffer.from(expected, 'base64url');
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<SessionClaims>;
    if (
      claims.version !== 2 ||
      typeof claims.supplierNo !== 'string' ||
      typeof claims.supplierName !== 'string' ||
      typeof claims.workspaceCode !== 'string' ||
      typeof claims.workspaceInstanceId !== 'string' ||
      typeof claims.issuedAt !== 'number' ||
      typeof claims.expiresAt !== 'number' ||
      claims.expiresAt <= Math.floor(now / 1000)
    ) return null;
    return claims as SessionClaims;
  } catch {
    return null;
  }
}
