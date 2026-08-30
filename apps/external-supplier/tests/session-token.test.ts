import { describe, expect, it } from 'vitest';
import { signExternalSession, verifyExternalSession } from '@/src/server/session-token';

const secret = 'test-secret-at-least-32-characters-long';
const now = Date.parse('2026-08-29T08:00:00.000Z');
const workspaceInstanceId = '11111111-2222-4333-8444-555555555555';

describe('signed external supplier session', () => {
  it('round-trips the fixed external supplier identity', () => {
    const token = signExternalSession(secret, workspaceInstanceId, now);
    expect(verifyExternalSession(token, secret, now + 1_000)).toMatchObject({
      version: 2,
      supplierNo: 'EXT-SUP-DEMO-004',
      workspaceCode: 'DEMO-DEFAULT',
      workspaceInstanceId,
      role: 'EXTERNAL_SUPPLIER',
    });
  });

  it('rejects a changed signature and an expired token', () => {
    const token = signExternalSession(secret, workspaceInstanceId, now);
    expect(verifyExternalSession(`${token.slice(0, -1)}x`, secret, now + 1_000)).toBeNull();
    expect(verifyExternalSession(token, secret, now + 9 * 60 * 60 * 1_000)).toBeNull();
  });

  it('rejects a token signed by another service', () => {
    const token = signExternalSession(secret, workspaceInstanceId, now);
    expect(verifyExternalSession(token, 'different-secret-at-least-32-characters', now + 1_000)).toBeNull();
  });
});
