import { describe, expect, it } from 'vitest';

import { buildCoreHeaders } from '@/src/server/core-headers';

describe('核心 API 服务端身份头', () => {
  it('注入服务凭证和 Cookie 中的供应商编号', () => {
    const headers = buildCoreHeaders('service-secret', 'INT-SUP-DEMO-003', { 'content-type': 'application/json' });
    expect(headers.get('x-demo-service-token')).toBe('service-secret');
    expect(headers.get('authorization')).toBe('Bearer service-secret');
    expect(headers.get('x-demo-supplier-no')).toBe('INT-SUP-DEMO-003');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('公开身份列表请求不伪造供应商编号', () => {
    const headers = buildCoreHeaders('service-secret');
    expect(headers.has('x-demo-supplier-no')).toBe(false);
  });
});
