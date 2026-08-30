import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  coreApiRequest: vi.fn(),
  readExternalSession: vi.fn(),
}));

vi.mock('@/src/server/core-api', async () => {
  const actual = await vi.importActual<typeof import('@/src/server/core-api')>('@/src/server/core-api');
  return { ...actual, coreApiRequest: mocks.coreApiRequest };
});

vi.mock('@/src/server/session', () => ({
  readExternalSession: mocks.readExternalSession,
}));

import { POST } from '@/app/api/rfqs/[rfqNo]/quotes/route';

describe('external quote BFF', () => {
  beforeEach(() => {
    mocks.coreApiRequest.mockReset();
    mocks.readExternalSession.mockReset();
    mocks.readExternalSession.mockResolvedValue({ supplierNo: 'EXT-SUP-DEMO-004' });
  });

  it('forwards the browser idempotency key so a retry cannot consume the re-quote chance', async () => {
    mocks.coreApiRequest.mockResolvedValue({
      data: {
        rfqNo: 'RFQ-DEMO-0002',
        quote: {
          quoteNo: 'QT-LIVE-00001',
          totalAmount: '126800.00',
          deliveryDays: 12,
          submittedAt: '2026-08-29T09:00:00.000Z',
          version: 1,
          competitiveness: 'HIGH',
        },
        canRequote: true,
        remainingRequotes: 1,
        versions: [{
          quoteNo: 'QT-LIVE-00001',
          totalAmount: '126800.00',
          deliveryDays: 12,
          submittedAt: '2026-08-29T09:00:00.000Z',
          version: 1,
          competitiveness: 'HIGH',
        }],
      },
      meta: { revision: 11 },
    });

    const idempotencyKey = 'ad03fd3b-82d6-436e-8fae-1d4ae6005b63';
    const response = await POST(new Request('http://portal.test/api/rfqs/RFQ-DEMO-0002/quotes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ totalAmount: '126800.00', deliveryDays: 12, remark: '含税到厂' }),
    }), { params: Promise.resolve({ rfqNo: 'RFQ-DEMO-0002' }) });

    expect(response.status).toBe(201);
    expect(mocks.coreApiRequest).toHaveBeenCalledWith('/external/rfqs/RFQ-DEMO-0002/quotes', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: { totalAmount: '126800.00', deliveryDays: 12, remark: '含税到厂' },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        version: 1,
        canRequote: true,
        remainingRequotes: 1,
        competitiveness: { level: 'HIGH', label: '高' },
        versions: [{ version: 1, totalAmount: '126800.00' }],
      },
    });
  });
});
