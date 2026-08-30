import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  coreApiRequest: vi.fn(),
  setExternalSessionCookie: vi.fn(),
}));

vi.mock('@/src/server/core-api', async () => {
  const actual = await vi.importActual<typeof import('@/src/server/core-api')>('@/src/server/core-api');
  return { ...actual, coreApiRequest: mocks.coreApiRequest };
});

vi.mock('@/src/server/session', () => ({
  clearExternalSessionCookie: vi.fn(),
  readExternalSession: vi.fn(),
  setExternalSessionCookie: mocks.setExternalSessionCookie,
}));

import { POST } from '@/app/api/session/route';

describe('external supplier session bootstrap', () => {
  beforeEach(() => {
    mocks.coreApiRequest.mockReset();
    mocks.setExternalSessionCookie.mockReset();
  });

  it('creates the demo session when the fixed external supplier is already registered', async () => {
    mocks.coreApiRequest.mockResolvedValue({
      data: { supplierNo: 'EXT-SUP-DEMO-004', name: '浙江远航工业', registered: true },
      meta: { workspaceInstanceId: 'workspace-instance-1', workspaceCode: 'DEMO-DEFAULT' },
    });

    const response = await POST();
    expect(response.status).toBe(200);
    expect(mocks.coreApiRequest).toHaveBeenCalledWith('/external/registration-profile', {
      method: 'GET',
      includeSupplier: false,
    });
    expect(mocks.setExternalSessionCookie).toHaveBeenCalledWith('workspace-instance-1');
    await expect(response.json()).resolves.toMatchObject({
      data: { supplierNo: 'EXT-SUP-DEMO-004', supplierName: '浙江远航工业' },
    });
  });

  it('does not create a session before registration is complete', async () => {
    mocks.coreApiRequest.mockResolvedValue({
      data: { supplierNo: 'EXT-SUP-DEMO-004', registered: false },
      meta: { workspaceInstanceId: 'workspace-instance-1' },
    });

    const response = await POST();
    expect(response.status).toBe(401);
    expect(mocks.setExternalSessionCookie).not.toHaveBeenCalled();
  });
});
