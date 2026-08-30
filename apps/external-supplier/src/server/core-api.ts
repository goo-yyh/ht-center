import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PortalApiMeta } from '@haitian/sourcing-contracts';
import { DEMO_EXTERNAL_SUPPLIER_NO } from '@/src/contracts';
import { getServerEnv } from '@/src/server/env';

export type CoreApiMeta = PortalApiMeta;

export interface CoreApiResult<T> {
  data: T;
  meta: CoreApiMeta;
}

export class CoreApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CoreApiError';
  }
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export interface CoreRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  includeSupplier?: boolean;
}

export async function coreApiRequest<T>(path: string, options: CoreRequestOptions = {}): Promise<CoreApiResult<T>> {
  const env = getServerEnv();
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  headers.set('x-demo-service-token', env.DEMO_SERVICE_TOKEN);
  headers.set('authorization', `Bearer ${env.DEMO_SERVICE_TOKEN}`);
  if (options.includeSupplier !== false) headers.set('x-demo-supplier-no', DEMO_EXTERNAL_SUPPLIER_NO);
  const method = (options.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method) && !headers.has('idempotency-key')) {
    headers.set('idempotency-key', randomUUID());
  }
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(env.CORE_API_URL, path), {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
    });
  } catch {
    throw new CoreApiError(503, 'CORE_API_UNAVAILABLE', '核心业务服务暂时不可用，请稍后重试');
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const root = record(payload);
    const error = record(root.error ?? payload);
    throw new CoreApiError(
      response.status,
      typeof error.code === 'string' ? error.code : 'CORE_API_ERROR',
      typeof error.message === 'string' ? error.message : '核心业务服务请求失败',
      error.details,
    );
  }

  const root = record(payload);
  const meta = record(root.meta);
  return {
    data: (Object.prototype.hasOwnProperty.call(root, 'data') ? root.data : payload) as T,
    meta: {
      workspaceCode: typeof meta.workspaceCode === 'string' ? meta.workspaceCode : undefined,
      workspaceInstanceId: typeof meta.workspaceInstanceId === 'string' ? meta.workspaceInstanceId : undefined,
      revision: typeof meta.revision === 'number' ? meta.revision : undefined,
      serverTime: typeof meta.serverTime === 'string' ? meta.serverTime : undefined,
      requestId: typeof meta.requestId === 'string' ? meta.requestId : undefined,
    },
  };
}

export async function coreApiDownload(path: string): Promise<Response> {
  const env = getServerEnv();
  let response: Response;
  try {
    response = await fetch(buildUrl(env.CORE_API_URL, path), {
      headers: {
        accept: '*/*',
        authorization: `Bearer ${env.DEMO_SERVICE_TOKEN}`,
        'x-demo-service-token': env.DEMO_SERVICE_TOKEN,
        'x-demo-supplier-no': DEMO_EXTERNAL_SUPPLIER_NO,
      },
      cache: 'no-store',
    });
  } catch {
    throw new CoreApiError(503, 'CORE_API_UNAVAILABLE', '采购附件服务暂时不可用，请稍后重试');
  }
  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    const error = record(record(payload).error ?? payload);
    throw new CoreApiError(
      response.status,
      typeof error.code === 'string' ? error.code : 'ATTACHMENT_DOWNLOAD_FAILED',
      typeof error.message === 'string' ? error.message : '附件下载失败',
    );
  }
  return response;
}
