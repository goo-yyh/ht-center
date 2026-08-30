import 'server-only';

import { buildCoreHeaders } from './core-headers';

export class CoreApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'CoreApiError';
  }
}

function requiredEnvironment(name: 'CORE_API_URL' | 'DEMO_SERVICE_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (process.env.NODE_ENV !== 'production') {
    return name === 'CORE_API_URL'
      ? 'http://127.0.0.1:3000/api/demo/v1'
      : 'haitian-demo-service-local';
  }
  throw new CoreApiError(503, 'SERVICE_NOT_CONFIGURED', `服务端缺少 ${name} 配置`);
}

function coreUrl(pathname: string): string {
  const base = requiredEnvironment('CORE_API_URL').replace(/\/+$/, '');
  return `${base}/${pathname.replace(/^\/+/, '')}`;
}

async function readError(response: Response): Promise<CoreApiError> {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  try {
    const body = (await response.json()) as Record<string, unknown>;
    const error = body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>) : body;
    return new CoreApiError(
      response.status,
      String(error.code ?? 'CORE_API_ERROR'),
      String(error.message ?? `核心 API 请求失败（${response.status}）`),
      String(error.requestId ?? requestId ?? '') || undefined,
    );
  } catch {
    return new CoreApiError(response.status, 'CORE_API_ERROR', `核心 API 请求失败（${response.status}）`, requestId);
  }
}

export async function coreFetch(pathname: string, init: RequestInit = {}, supplierNo?: string): Promise<Response> {
  const serviceToken = requiredEnvironment('DEMO_SERVICE_TOKEN');
  const headers = buildCoreHeaders(serviceToken, supplierNo, init.headers);
  let response: Response;
  try {
    response = await fetch(coreUrl(pathname), { ...init, headers, cache: 'no-store' });
  } catch {
    throw new CoreApiError(503, 'CORE_API_UNAVAILABLE', '核心业务 API 暂时无法连接，请确认管理端服务已启动');
  }
  if (!response.ok) throw await readError(response);
  return response;
}

export async function coreJson(pathname: string, init: RequestInit = {}, supplierNo?: string): Promise<unknown> {
  const response = await coreFetch(pathname, init, supplierNo);
  if (response.status === 204) return { data: null };
  return response.json();
}
