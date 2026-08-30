import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { CoreApiError } from '@/src/server/core-api';

export function apiSuccess(data: unknown, meta: unknown = {}, status = 200): NextResponse {
  return NextResponse.json({ data, meta }, { status });
}

export function apiFailure(error: unknown): NextResponse {
  if (error instanceof CoreApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: error.issues[0]?.message ?? '提交内容不完整', details: error.flatten() } },
      { status: 400 },
    );
  }
  console.error('External supplier BFF error', error instanceof Error ? error.message : 'unknown');
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' } },
    { status: 500 },
  );
}

export function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: '供应商会话已失效，请重新注册或重置演示数据' } },
    { status: 401 },
  );
}
