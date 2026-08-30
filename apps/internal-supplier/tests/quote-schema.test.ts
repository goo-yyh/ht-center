import { describe, expect, it } from 'vitest';

import { quoteInputSchema } from '@/src/lib/quote-schema';

describe('一次性报价输入', () => {
  it('规范化金额、交期和备注', () => {
    expect(quoteInputSchema.parse({ totalAmount: '128000.50', deliveryDays: '15', remark: ' 含税 ' })).toEqual({
      totalAmount: '128000.50', deliveryDays: 15, remark: '含税',
    });
  });

  it.each([
    { totalAmount: '0', deliveryDays: 15 },
    { totalAmount: '-1', deliveryDays: 15 },
    { totalAmount: '10.999', deliveryDays: 15 },
    { totalAmount: '100', deliveryDays: 0 },
    { totalAmount: '100', deliveryDays: 366 },
  ])('拒绝不合法报价 %#', (input) => {
    expect(quoteInputSchema.safeParse(input).success).toBe(false);
  });
});
