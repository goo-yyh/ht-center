import { describe, expect, it } from 'vitest';

import { createSessionToken, verifySessionToken } from '@/src/server/session-token';

const secret = 'a-secure-demo-session-secret-with-32-chars';
const supplier = { supplierNo: 'INT-SUP-DEMO-003', supplierName: '海城精工制造有限公司', workspaceCode: 'DEMO-DEFAULT', workspaceInstanceId: 'workspace-instance-7' };

describe('内部供应商签名会话', () => {
  it('可以签发并校验未过期身份', () => {
    const now = Date.UTC(2026, 7, 29, 6, 0, 0);
    const token = createSessionToken(supplier, secret, now, 3600);
    expect(verifySessionToken(token, secret, now + 30_000)).toMatchObject(supplier);
  });

  it('拒绝篡改的供应商身份', () => {
    const token = createSessionToken(supplier, secret);
    const [payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    decoded.supplierNo = 'INT-SUP-DEMO-001';
    const tampered = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;
    expect(verifySessionToken(tampered, secret)).toBeNull();
  });

  it('拒绝已过期会话', () => {
    const now = Date.UTC(2026, 7, 29, 6, 0, 0);
    const token = createSessionToken(supplier, secret, now, 60);
    expect(verifySessionToken(token, secret, now + 61_000)).toBeNull();
  });

  it('拒绝过短的签名密钥', () => {
    expect(() => createSessionToken(supplier, 'too-short')).toThrow(/至少需要 32 个字符/);
  });
});
