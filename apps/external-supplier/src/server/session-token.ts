import { createHmac, timingSafeEqual } from 'node:crypto';
import { DEMO_EXTERNAL_SUPPLIER_NO, DEMO_WORKSPACE_CODE } from '@/src/contracts';

export const EXTERNAL_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export interface ExternalSession {
  version: 2;
  supplierNo: typeof DEMO_EXTERNAL_SUPPLIER_NO;
  workspaceCode: typeof DEMO_WORKSPACE_CODE;
  workspaceInstanceId: string;
  role: 'EXTERNAL_SUPPLIER';
  expiresAt: number;
}

function encode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signExternalSession(secret: string, workspaceInstanceId: string, now = Date.now()): string {
  const session: ExternalSession = {
    version: 2,
    supplierNo: DEMO_EXTERNAL_SUPPLIER_NO,
    workspaceCode: DEMO_WORKSPACE_CODE,
    workspaceInstanceId,
    role: 'EXTERNAL_SUPPLIER',
    expiresAt: now + EXTERNAL_SESSION_MAX_AGE_SECONDS * 1000,
  };
  const payload = encode(JSON.stringify(session));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyExternalSession(value: string | undefined, secret: string, now = Date.now()): ExternalSession | null {
  if (!value) return null;
  const [payload, providedSignature, extra] = value.split('.');
  if (!payload || !providedSignature || extra) return null;
  const expected = Buffer.from(signature(payload, secret));
  const provided = Buffer.from(providedSignature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<ExternalSession>;
    if (
      parsed.version !== 2 ||
      parsed.supplierNo !== DEMO_EXTERNAL_SUPPLIER_NO ||
      parsed.workspaceCode !== DEMO_WORKSPACE_CODE ||
      typeof parsed.workspaceInstanceId !== 'string' ||
      !parsed.workspaceInstanceId ||
      parsed.role !== 'EXTERNAL_SUPPLIER' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= now
    ) {
      return null;
    }
    return parsed as ExternalSession;
  } catch {
    return null;
  }
}
