import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { coreApiRequest } from '@/src/server/core-api';
import { resetServerEnvForTests } from '@/src/server/env';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CORE_API_URL;
  delete process.env.DEMO_SERVICE_TOKEN;
  delete process.env.DEMO_SESSION_SECRET;
  resetServerEnvForTests();
});

describe('core API client', () => {
  it('adds service and fixed supplier headers and unwraps the core envelope', async () => {
    process.env.CORE_API_URL = 'http://core.test/api/demo/v1';
    process.env.DEMO_SERVICE_TOKEN = 'service-token';
    process.env.DEMO_SESSION_SECRET = 'session-secret-long-enough';
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-demo-service-token')).toBe('service-token');
      expect(headers.get('x-demo-supplier-no')).toBe('EXT-SUP-DEMO-004');
      expect(headers.get('authorization')).toBe('Bearer service-token');
      return Response.json({
        data: { rfqs: [] },
        meta: { workspaceCode: 'DEMO-DEFAULT', revision: 9, serverTime: '2026-08-29T08:00:00.000Z' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await coreApiRequest<{ rfqs: unknown[] }>('/external/rfqs');
    expect(result.data.rfqs).toEqual([]);
    expect(result.meta.revision).toBe(9);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('omits supplier context only for the public registration profile', async () => {
    process.env.CORE_API_URL = 'http://core.test/api/demo/v1';
    process.env.DEMO_SERVICE_TOKEN = 'service-token';
    process.env.DEMO_SESSION_SECRET = 'session-secret-long-enough';
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('x-demo-supplier-no')).toBe(false);
      return Response.json({ data: { supplierNo: 'EXT-SUP-DEMO-004' }, meta: {} });
    }));

    await coreApiRequest('/external/registration-profile', { includeSupplier: false });
  });

  it('adds an idempotency key to core write requests', async () => {
    process.env.CORE_API_URL = 'http://core.test/api/demo/v1';
    process.env.DEMO_SERVICE_TOKEN = 'service-token';
    process.env.DEMO_SESSION_SECRET = 'session-secret-long-enough';
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const key = new Headers(init?.headers).get('idempotency-key');
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
      return Response.json({ data: { registered: true }, meta: {} });
    }));

    await coreApiRequest('/external/register', {
      method: 'POST',
      body: { contactName: '王工', email: 'buyer@example.test', password: 'DemoPass123!' },
    });

    await coreApiRequest('/external/rfqs/RFQ-DEMO-0002/view', { method: 'POST' });
  });
});
