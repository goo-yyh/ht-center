import type { ApiErrorPayload, ApiResult } from './types';

export class BrowserApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'BrowserApiError';
  }
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  if (!response.ok) {
    let payload: ApiErrorPayload | undefined;
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      // Non-JSON infrastructure failures use the generic fallback below.
    }
    throw new BrowserApiError(response.status, payload?.error.code ?? 'REQUEST_FAILED', payload?.error.message ?? '请求失败，请稍后重试');
  }
  return response.json() as Promise<ApiResult<T>>;
}

export function readableError(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}
