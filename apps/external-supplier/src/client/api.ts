'use client';

import type { PortalApiMeta } from '@haitian/sourcing-contracts';

export interface ApiEnvelope<T> {
  data: T;
  meta?: PortalApiMeta;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export class PortalApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PortalApiError';
  }
}

export async function portalFetch<T>(url: string, options?: RequestInit): Promise<ApiEnvelope<T>> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, cache: 'no-store' });
  } catch {
    throw new PortalApiError(503, 'NETWORK_ERROR', '网络连接失败，请检查核心服务是否已经启动');
  }
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T> & ErrorEnvelope;
  if (!response.ok) {
    throw new PortalApiError(
      response.status,
      payload.error?.code ?? 'REQUEST_FAILED',
      payload.error?.message ?? '请求失败，请稍后重试',
    );
  }
  return payload;
}

export async function portalDownload(url: string, fileName: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new PortalApiError(503, 'NETWORK_ERROR', '网络连接失败，请检查核心服务是否已经启动');
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    throw new PortalApiError(
      response.status,
      payload.error?.code ?? 'DOWNLOAD_FAILED',
      payload.error?.message ?? '采购附件下载失败',
    );
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function shouldReturnToRegister(error: unknown): boolean {
  return error instanceof PortalApiError && ['UNAUTHORIZED', 'REGISTRATION_REQUIRED'].includes(error.code);
}
