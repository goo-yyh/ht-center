import 'server-only';
import { cookies } from 'next/headers';
import { getServerEnv } from '@/src/server/env';
import {
  EXTERNAL_SESSION_MAX_AGE_SECONDS,
  signExternalSession,
  verifyExternalSession,
  type ExternalSession,
} from '@/src/server/session-token';
import { CoreApiError, coreApiRequest } from '@/src/server/core-api';

export { signExternalSession, verifyExternalSession, type ExternalSession } from '@/src/server/session-token';

export const EXTERNAL_SESSION_COOKIE = 'ht_external_supplier_session';

export async function readExternalSession(): Promise<ExternalSession | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(EXTERNAL_SESSION_COOKIE)?.value;
  const session = verifyExternalSession(value, getServerEnv().DEMO_SESSION_SECRET);
  if (!session) return null;
  try {
    const context = await coreApiRequest<unknown>('/context', { method: 'GET', includeSupplier: false });
    if (
      context.meta.workspaceCode !== session.workspaceCode ||
      context.meta.workspaceInstanceId !== session.workspaceInstanceId
    ) return null;
    return session;
  } catch (error) {
    // A temporary core outage must not masquerade as an expired identity. Let the
    // actual business request surface the 5xx response while retaining the signed session.
    if (error instanceof CoreApiError && error.status >= 500) return session;
    return null;
  }
}

export async function setExternalSessionCookie(workspaceInstanceId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(EXTERNAL_SESSION_COOKIE, signExternalSession(getServerEnv().DEMO_SESSION_SECRET, workspaceInstanceId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: EXTERNAL_SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearExternalSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(EXTERNAL_SESSION_COOKIE);
}
