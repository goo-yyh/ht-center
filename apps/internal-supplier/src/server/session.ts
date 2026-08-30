import 'server-only';

import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

import { coreJson } from './core-api';
import { unwrapCoreResponse } from './normalizers';
import { createSessionToken, verifySessionToken, type SessionClaims } from './session-token';

export const SESSION_COOKIE = 'haitian_internal_supplier_session';
const MAX_AGE_SECONDS = 8 * 60 * 60;

function sessionSecret(): string {
  const secret = process.env.DEMO_SESSION_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV !== 'production') return 'haitian-demo-session-secret-local-2026';
  throw new Error('服务端缺少 DEMO_SESSION_SECRET 配置');
}

export async function readSession(): Promise<SessionClaims | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = value ? verifySessionToken(value, sessionSecret()) : null;
  if (!session) return null;
  const context = unwrapCoreResponse(await coreJson('/context'));
  if (context.meta.workspaceCode !== session.workspaceCode || context.meta.workspaceInstanceId !== session.workspaceInstanceId) return null;
  return session;
}

export function setSessionCookie(
  response: NextResponse,
  supplier: Pick<SessionClaims, 'supplierNo' | 'supplierName' | 'workspaceCode' | 'workspaceInstanceId'>,
  secure = false,
): void {
  response.cookies.set(SESSION_COOKIE, createSessionToken(supplier, sessionSecret(), Date.now(), MAX_AGE_SECONDS), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse, secure = false): void {
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 0 });
}
