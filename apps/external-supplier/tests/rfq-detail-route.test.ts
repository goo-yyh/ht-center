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

import { GET } from '@/app/api/rfqs/[rfqNo]/route';

describe('external RFQ detail BFF', () => {
  beforeEach(() => {
    mocks.coreApiRequest.mockReset();
    mocks.readExternalSession.mockReset();
    mocks.readExternalSession.mockResolvedValue({ supplierNo: 'EXT-SUP-DEMO-004' });
  });

  it('enriches the detail with the authoritative own-quote history from the core API', async () => {
    mocks.coreApiRequest
      .mockResolvedValueOnce({
        data: {
          rfq: {
            rfqNo: 'RFQ-DEMO-0002',
            requestNo: 'SR-DEMO-0002',
            status: 'OPEN',
            itemName: 'Q235 钢板加工',
            specification: 'Q235B、12mm、按图切割',
            quantity: '50',
            unit: '吨',
            requiredDeliveryDays: 15,
            deadlineAt: '2026-09-15T15:59:00.000Z',
            submittedAt: '2026-08-29T10:00:00.000Z',
          },
          supplier: { supplierNo: 'EXT-SUP-DEMO-004', name: '浙江远航工业', supplierType: 'EXTERNAL' },
          attachments: [{ attachmentId: 'att-1', fileName: '采购规格.pdf', mimeType: 'application/pdf', sizeBytes: 2048 }],
          quoteReceipt: {
            quoteNo: 'QT-LIVE-00001',
            totalAmount: '124000.00',
            deliveryDays: 10,
            submittedAt: '2026-08-29T10:00:00.000Z',
            version: 2,
            competitiveness: 'MEDIUM',
          },
        },
        meta: { revision: 12, serverTime: '2026-08-29T10:01:00.000Z' },
      })
      .mockResolvedValueOnce({
        data: {
          rfqNo: 'RFQ-DEMO-0002',
          quote: {
            quoteNo: 'QT-LIVE-00001',
            totalAmount: '124000.00',
            deliveryDays: 10,
            remark: '第二版',
            submittedAt: '2026-08-29T10:00:00.000Z',
            version: 2,
            competitiveness: 'MEDIUM',
          },
          versions: [
            {
              quoteNo: 'QT-LIVE-00001',
              totalAmount: '126800.00',
              deliveryDays: 12,
              remark: '第一版',
              submittedAt: '2026-08-29T09:00:00.000Z',
              version: 1,
              competitiveness: 'HIGH',
            },
            {
              quoteNo: 'QT-LIVE-00001',
              totalAmount: '124000.00',
              deliveryDays: 10,
              remark: '第二版',
              submittedAt: '2026-08-29T10:00:00.000Z',
              version: 2,
              competitiveness: 'MEDIUM',
            },
          ],
          canRequote: false,
          remainingRequotes: 0,
        },
        meta: { revision: 12, serverTime: '2026-08-29T10:01:00.000Z' },
      });

    const response = await GET(new Request('http://portal.test/api/rfqs/RFQ-DEMO-0002'), {
      params: Promise.resolve({ rfqNo: 'RFQ-DEMO-0002' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.coreApiRequest).toHaveBeenNthCalledWith(1, '/external/rfqs/RFQ-DEMO-0002', { method: 'GET' });
    expect(mocks.coreApiRequest).toHaveBeenNthCalledWith(2, '/external/rfqs/RFQ-DEMO-0002/quotes/me', { method: 'GET' });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        supplier: { supplierNo: 'EXT-SUP-DEMO-004', supplierName: '浙江远航工业' },
        requestNo: 'SR-DEMO-0002',
        requiredDeliveryDays: 15,
        quoteReceipt: {
          version: 2,
          versionCount: 2,
          canRequote: false,
          versions: [
            { version: 1, totalAmount: '126800.00', competitiveness: { level: 'HIGH' } },
            { version: 2, totalAmount: '124000.00', competitiveness: { level: 'MEDIUM' } },
          ],
        },
      },
    });
  });
});
