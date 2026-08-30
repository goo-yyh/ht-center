import { describe, expect, it } from 'vitest';
import {
  normalizeRegistrationProfile,
  normalizeQuoteReceipt,
  normalizeRfqDetail,
  normalizeRfqList,
  normalizeRfqListResult,
  quoteInputSchema,
  registrationInputSchema,
} from '@/src/contracts';

describe('external supplier input contracts', () => {
  it('accepts only the three browser registration fields and strips forged identity', () => {
    const parsed = registrationInputSchema.parse({
      contactName: '王经理',
      email: 'wang@example.com',
      password: 'secure-pass-2026',
      supplierNo: 'EXT-SUP-DEMO-999',
      role: 'BUYER',
    });
    expect(parsed).toEqual({
      contactName: '王经理',
      email: 'wang@example.com',
      password: 'secure-pass-2026',
    });
  });

  it('rejects invalid quote values', () => {
    expect(() => quoteInputSchema.parse({ totalAmount: '0', deliveryDays: 12 })).toThrow();
    expect(() => quoteInputSchema.parse({ totalAmount: '123.456', deliveryDays: 12 })).toThrow();
    expect(() => quoteInputSchema.parse({ totalAmount: '1000.00', deliveryDays: 0 })).toThrow();
    expect(quoteInputSchema.parse({ totalAmount: '128000.00', deliveryDays: 25 })).toEqual({
      totalAmount: '128000.00',
      deliveryDays: 25,
      remark: '',
    });
  });
});

describe('core DTO compatibility normalizers', () => {
  it('normalizes the fixed registration profile', () => {
    expect(normalizeRegistrationProfile({
      supplier: {
        supplierNo: 'EXT-SUP-DEMO-004',
        supplierName: '上海精工机电有限公司',
        region: '上海',
        sourcePlatform: '1688',
        sourceDetail: '1688 来源标识，本地仿真资料。',
        creditCode: '91310000TEST00004',
        registeredAddress: '上海市嘉定区装备产业园（仿真地址）',
        capabilities: [{ description: 'Q235 加工' }, { description: '精密机加工' }],
        qualifications: ['ISO9001', 'IATF16949'],
        riskLevel: 'MEDIUM',
        riskSummary: '存在一般风险提示，建议复核报价条件。',
      },
    })).toMatchObject({
      supplierNo: 'EXT-SUP-DEMO-004',
      name: '上海精工机电有限公司',
      region: '上海',
      source: '1688',
      sourceDetail: '1688 来源标识，本地仿真资料。',
      address: '上海市嘉定区装备产业园（仿真地址）',
      primaryCapabilities: ['Q235 加工', '精密机加工'],
      qualifications: ['ISO9001', 'IATF16949'],
      riskLevel: 'MEDIUM',
      riskSummary: '存在一般风险提示，建议复核报价条件。',
    });
  });

  it('keeps the fixed demo profile meaningful when the core sends only master-data basics', () => {
    const profile = normalizeRegistrationProfile({
      supplier: {
        supplierNo: 'EXT-SUP-DEMO-004',
        name: '浙江远航工业',
        region: '浙江',
        sourcePlatform: '企业信息库',
      },
    });

    expect(profile.address).toContain('浙江省宁波市北仑区');
    expect(profile.primaryCapabilities.length).toBeGreaterThan(0);
    expect(profile.qualifications).toEqual(['ISO 9001', 'IATF 16949']);
    expect(profile.riskLevel).toBe('LOW');
    expect(profile.sourceDetail).toContain('本地仿真供应商库');
  });

  it('normalizes list and detail without exposing another supplier', () => {
    const payload = {
      supplier: { supplierNo: 'EXT-SUP-DEMO-004', name: '浙江远航工业', supplierType: 'EXTERNAL' },
      rfqs: [{
      rfqNo: 'RFQ-DEMO-0002',
      requestNo: 'SR-DEMO-0002',
      title: 'Q235 钢板加工询价',
      item: { name: 'Q235 加工件', specification: '按图加工' },
      quantity: 500,
      unit: '件',
      status: 'OPEN',
      invitation: { viewedAt: '2026-08-29T08:00:00.000Z' },
    }],
    };
    const rfqs = normalizeRfqList(payload);
    expect(rfqs).toHaveLength(1);
    expect(rfqs[0]).toMatchObject({ rfqNo: 'RFQ-DEMO-0002', requestNo: 'SR-DEMO-0002', itemName: 'Q235 加工件', viewedAt: '2026-08-29T08:00:00.000Z' });
    expect(normalizeRfqListResult(payload).supplier).toEqual({
      supplierNo: 'EXT-SUP-DEMO-004',
      supplierName: '浙江远航工业',
      supplierType: 'EXTERNAL',
    });

    const detail = normalizeRfqDetail({
      rfq: rfqs[0],
      supplier: payload.supplier,
      attachments: [{ id: 'att-1', name: '采购图纸.pdf', contentType: 'application/pdf', size: 2048 }],
      quoteReceipt: { quoteNo: 'QT-001', totalAmount: '128000.00', deliveryDays: 25, submittedAt: '2026-08-29T09:00:00.000Z' },
    });
    expect(detail.attachments[0]).toEqual({
      attachmentId: 'att-1',
      fileName: '采购图纸.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    });
    expect(detail.quoteReceipt?.totalAmount).toBe('128000.00');
    expect(detail.supplier.supplierName).toBe('浙江远航工业');
  });

  it('reads the core nested own-quote response and rejects metadata-only receipts', () => {
    expect(normalizeQuoteReceipt({
      rfqNo: 'RFQ-DEMO-0002',
      quote: {
        quoteNo: 'QT-LIVE-00001',
        totalAmount: '126800.00',
        deliveryDays: 12,
        remark: '含税到厂',
        submittedAt: '2026-08-29T09:00:00.000Z',
        version: 1,
        competitiveness: {
          level: 'HIGH',
          label: '高',
          summary: '价格和交期均有优势。',
        },
      },
      canRequote: true,
      remainingRequotes: 1,
      versions: [
        {
          quoteNo: 'QT-LIVE-00001',
          totalAmount: '126800.00',
          deliveryDays: 12,
          remark: '含税到厂',
          submittedAt: '2026-08-29T09:00:00.000Z',
          version: 1,
          competitiveness: 'HIGH',
        },
      ],
    })).toMatchObject({
      quoteNo: 'QT-LIVE-00001',
      totalAmount: '126800.00',
      deliveryDays: 12,
      version: 1,
      versionCount: 1,
      maxVersions: 2,
      canRequote: true,
      remainingRequotes: 1,
      competitiveness: { level: 'HIGH', label: '高', summary: '价格和交期均有优势。' },
      versions: [{ version: 1, totalAmount: '126800.00', competitiveness: { level: 'HIGH' } }],
    });

    expect(normalizeQuoteReceipt({
      quote: {
        quoteNo: 'QT-LIVE-00001',
        totalAmount: '124000.00',
        deliveryDays: 10,
        submittedAt: '2026-08-29T10:00:00.000Z',
        version: 2,
        competitiveness: 'MEDIUM',
      },
      editable: false,
      remainingRequotes: 0,
    })).toMatchObject({
      version: 2,
      versionCount: 2,
      canRequote: false,
      remainingRequotes: 0,
      competitiveness: { level: 'MEDIUM', label: '中' },
    });

    expect(normalizeQuoteReceipt({
      quoteNo: 'QT-LIVE-00001',
      receiptNo: 'RCPT-DEMO',
      submittedAt: '2026-08-29T09:00:00.000Z',
    })).toBeNull();
  });

  it('preserves both external quote versions and keeps the latest version current', () => {
    const receipt = normalizeQuoteReceipt({
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
    });

    expect(receipt).toMatchObject({
      version: 2,
      versionCount: 2,
      canRequote: false,
      remainingRequotes: 0,
    });
    expect(receipt?.versions.map((version) => ({
      version: version.version,
      amount: version.totalAmount,
      competitiveness: version.competitiveness?.level,
    }))).toEqual([
      { version: 1, amount: '126800.00', competitiveness: 'HIGH' },
      { version: 2, amount: '124000.00', competitiveness: 'MEDIUM' },
    ]);
  });
});
