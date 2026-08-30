import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import type { ApiErrorPayload } from '@/src/lib/types';
import { CoreApiError } from './core-api';

export function apiError(code: string, message: string, status: number, requestId?: string): NextResponse<ApiErrorPayload> {
  return NextResponse.json({ error: { code, message, requestId } }, { status });
}

export function handleRouteError(error: unknown): NextResponse<ApiErrorPayload> {
  if (error instanceof CoreApiError) return apiError(error.code, error.message, error.status, error.requestId);
  if (error instanceof ZodError) return apiError('INVALID_INPUT', error.issues[0]?.message ?? '输入内容不合法', 400);
  if (error instanceof Error && error.message.includes('DEMO_SESSION_SECRET')) {
    return apiError('SERVICE_NOT_CONFIGURED', error.message, 503);
  }
  return apiError('INTERNAL_ERROR', '内部供应商服务暂时不可用，请稍后重试', 500);
}

export async function requireSupplierSession() {
  const { readSession } = await import('./session');
  const session = await readSession();
  if (!session) throw new CoreApiError(401, 'SESSION_REQUIRED', '请选择内部供应商身份后继续');
  return session;
}
