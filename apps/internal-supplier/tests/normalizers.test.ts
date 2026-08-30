import { describe, expect, it } from 'vitest';

import {
  normalizeQuoteReceipt,
  normalizeRfqDetail,
  normalizeRfqList,
  normalizeSuppliers,
  unwrapCoreResponse,
} from '@/src/server/normalizers';

describe('核心 API 容错 DTO 解析', () => {
  it('解析标准 envelope 和内部供应商列表', () => {
    const envelope = unwrapCoreResponse({
      data: { suppliers: [{ supplierNo: 'INT-SUP-DEMO-003', supplierName: '海城精工制造有限公司', capabilities: ['机加工'] }] },
      meta: { workspaceCode: 'DEMO-DEFAULT', revision: 12, serverTime: '2026-08-29T06:00:00.000Z' },
    });
    expect(normalizeSuppliers(envelope.data)).toEqual([
      expect.objectContaining({ supplierNo: 'INT-SUP-DEMO-003', supplierName: '海城精工制造有限公司', capabilities: ['机加工'] }),
    ]);
    expect(envelope.meta.revision).toBe(12);
  });

  it('兼容列表字段别名但只输出供应商可见 DTO', () => {
    const result = normalizeRfqList({ items: [{
      number: 'RFQ-DEMO-0002',
      request: { requestNo: 'SR-DEMO-0002', itemName: 'Q235 钢板加工' },
      rfqStatus: 'BIDDING_OPEN',
      quotationDeadlineAt: '2026-08-29T07:00:00.000Z',
      myQuote: null,
      secretCiphertext: 'must-not-leak',
    }] });
    expect(result).toEqual([
      expect.objectContaining({ rfqNo: 'RFQ-DEMO-0002', status: 'OPEN', quoteSubmitted: false }),
    ]);
    expect(result[0]).not.toHaveProperty('secretCiphertext');
    expect(result[0]).not.toHaveProperty('suppliers');
  });

  it('解析询价详情和同一采购附件', () => {
    const detail = normalizeRfqDetail({
      rfqNo: 'RFQ-DEMO-0002',
      itemName: 'Q235 钢板加工',
      status: 'OPEN',
      deadlineAt: '2026-08-29T07:00:00.000Z',
      attachments: [{ attachmentId: 'ATT-DEMO-0002', fileName: '钢板加工图纸.pdf', fileSize: 2048 }],
    });
    expect(detail.attachments).toEqual([expect.objectContaining({ attachmentId: 'ATT-DEMO-0002', fileName: '钢板加工图纸.pdf' })]);
    expect(detail.attachmentCount).toBe(1);
  });

  it('兼容核心 API 将 rfq 与附件分开放在顶层的详情结构', () => {
    const detail = normalizeRfqDetail({
      rfq: {
        rfqNo: 'RFQ-DEMO-0002',
        itemName: 'Q235 钢板加工',
        status: 'OPEN',
        deadlineAt: '2026-08-29T07:00:00.000Z',
        qualificationCodes: ['ISO9001'],
        requiredDeliveryDays: 15,
      },
      attachments: [{ attachmentId: 'ATT-DEMO-0002', fileName: '钢板加工图纸.pdf', sizeBytes: 2048 }],
    });

    expect(detail.attachments).toEqual([
      expect.objectContaining({ attachmentId: 'ATT-DEMO-0002', fileName: '钢板加工图纸.pdf', fileSize: 2048 }),
    ]);
    expect(detail.qualificationRequirement).toBe('ISO9001');
    expect(detail.deliveryRequirement).toBe('15 天内');
  });

  it('无报价时返回 null，有报价时保留当前版本、竞争力和重新报价机会', () => {
    expect(normalizeQuoteReceipt(null)).toBeNull();
    expect(normalizeQuoteReceipt({
      rfqNo: 'RFQ-DEMO-0002',
      quote: {
        quoteNo: 'QUOTE-DEMO-LIVE-001', totalAmount: '128000.00', deliveryDays: 15, remark: '含税含运费', submittedAt: '2026-08-29T06:10:00.000Z',
        version: 1, competitiveness: 'MEDIUM',
      },
      versions: [{
        quoteNo: 'QUOTE-DEMO-LIVE-001', totalAmount: '128000.00', deliveryDays: 15, remark: '含税含运费', submittedAt: '2026-08-29T06:10:00.000Z',
        version: 1, competitiveness: 'MEDIUM',
      }],
      canRequote: true,
      remainingRequotes: 1,
    })).toMatchObject({
      quoteNo: 'QUOTE-DEMO-LIVE-001',
      rfqNo: 'RFQ-DEMO-0002',
      totalAmount: '128000.00',
      deliveryDays: 15,
      version: 1,
      versionCount: 1,
      maxVersions: 2,
      competitiveness: 'MEDIUM',
      canRequote: true,
      remainingRequotes: 1,
      versions: [{ version: 1, totalAmount: '128000.00', competitiveness: 'MEDIUM' }],
    });
  });

  it('保留两版内部报价历史并在第二版后锁定', () => {
    const receipt = normalizeQuoteReceipt({
      rfqNo: 'RFQ-DEMO-0002',
      quote: {
        quoteNo: 'QUOTE-DEMO-LIVE-001', totalAmount: '124000.00', deliveryDays: 11, remark: '第二版', submittedAt: '2026-08-29T07:10:00.000Z',
        version: 2, competitiveness: 'HIGH',
      },
      versions: [
        { quoteNo: 'QUOTE-DEMO-LIVE-001', totalAmount: '128000.00', deliveryDays: 15, remark: '第一版', submittedAt: '2026-08-29T06:10:00.000Z', version: 1, competitiveness: 'MEDIUM' },
        { quoteNo: 'QUOTE-DEMO-LIVE-001', totalAmount: '124000.00', deliveryDays: 11, remark: '第二版', submittedAt: '2026-08-29T07:10:00.000Z', version: 2, competitiveness: 'HIGH' },
      ],
      canRequote: false,
      remainingRequotes: 0,
    });

    expect(receipt).toMatchObject({
      version: 2,
      versionCount: 2,
      canRequote: false,
      remainingRequotes: 0,
      competitiveness: 'HIGH',
      versions: [
        { version: 1, competitiveness: 'MEDIUM' },
        { version: 2, competitiveness: 'HIGH' },
      ],
    });
  });
});
