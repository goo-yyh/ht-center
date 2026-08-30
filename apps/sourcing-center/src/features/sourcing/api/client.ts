import type {
  ApiEnvelope,
  CatalogResponse,
  CreateSourcingRequestInput,
  DashboardResponse,
  HealthResponse,
  SourcingRequestDetail,
} from '../types';

export type SimulateRemainingQuotesResult = {
  detail: SourcingRequestDetail;
  simulatedCount: number;
  registeredExternalCount: number;
  submittedCount: number;
  invitedCount: number;
};

const basePath = '/api/demo/v1';

export class SourcingApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'SourcingApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const response = await fetch(`${basePath}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | { error?: { code?: string; message?: string } }
    | null;

  if (!response.ok) {
    const error = payload && 'error' in payload ? payload.error : undefined;
    throw new SourcingApiError(
      error?.message || `请求失败（${response.status}）`,
      error?.code || 'REQUEST_FAILED',
      response.status,
    );
  }

  return payload as ApiEnvelope<T>;
}

function idempotencyHeaders(scope: string): HeadersInit {
  return {
    'Idempotency-Key': `${scope}-${crypto.randomUUID()}`,
  };
}

export const sourcingApi = {
  initializeDemo: () =>
    request<{ ok: boolean }>('/demo/initialize', {
      method: 'POST',
      headers: idempotencyHeaders('initialize-demo'),
      body: JSON.stringify({}),
    }),
  getDashboard: () => request<DashboardResponse>('/dashboard'),
  getHealth: () => request<HealthResponse>('/health'),
  getCatalog: () => request<CatalogResponse>('/catalog'),
  getRequest: (requestNo: string, signal?: AbortSignal) =>
    request<SourcingRequestDetail>(`/sourcing-requests/${encodeURIComponent(requestNo)}`, { signal }),
  createRequest: (input: CreateSourcingRequestInput) =>
    request<SourcingRequestDetail>('/sourcing-requests', {
      method: 'POST',
      headers: idempotencyHeaders('create-request'),
      body: JSON.stringify(input),
    }),
  sendAgentMessage: (requestNo: string, message: string) =>
    request<SourcingRequestDetail>(`/sourcing-requests/${encodeURIComponent(requestNo)}/agent/messages`, {
      method: 'POST',
      headers: idempotencyHeaders('agent-message'),
      body: JSON.stringify({ message }),
    }),
  publishRfq: (requestNo: string) =>
    request<SourcingRequestDetail>(`/sourcing-requests/${encodeURIComponent(requestNo)}/publish`, {
      method: 'POST',
      headers: idempotencyHeaders('publish-rfq'),
      body: JSON.stringify({}),
    }),
  closeRfq: (rfqNo: string) =>
    request<SourcingRequestDetail>(`/rfqs/${encodeURIComponent(rfqNo)}/close`, {
      method: 'POST',
      headers: idempotencyHeaders('close-rfq'),
      body: JSON.stringify({ reason: 'EARLY_STOP' }),
    }),
  simulateRemainingQuotes: (rfqNo: string) =>
    request<SimulateRemainingQuotesResult>(`/rfqs/${encodeURIComponent(rfqNo)}/simulate-remaining-quotes`, {
      method: 'POST',
      headers: idempotencyHeaders('simulate-remaining-quotes'),
      body: JSON.stringify({}),
    }),
  evaluateRfq: (rfqNo: string) =>
    request<SourcingRequestDetail>(`/rfqs/${encodeURIComponent(rfqNo)}/evaluations`, {
      method: 'POST',
      headers: idempotencyHeaders('evaluate-rfq'),
      body: JSON.stringify({}),
    }),
  createPurchaseRequisition: (requestNo: string, quoteNo: string) =>
    request<SourcingRequestDetail>(`/sourcing-requests/${encodeURIComponent(requestNo)}/purchase-requisition`, {
      method: 'POST',
      headers: idempotencyHeaders('create-pr'),
      body: JSON.stringify({ quoteNo }),
    }),
  resetDemo: () =>
    request<{ ok: boolean }>('/demo/reset', {
      method: 'POST',
      headers: idempotencyHeaders('reset-demo'),
      body: JSON.stringify({ confirmation: '重置 Demo 数据' }),
    }),
};
