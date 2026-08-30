import { DEMO_EXTERNAL_SUPPLIER_NO, normalizeRegistrationProfile } from '@/src/contracts';
import { coreApiRequest } from '@/src/server/core-api';
import { apiFailure, apiSuccess, unauthorized } from '@/src/server/route-response';
import { clearExternalSessionCookie, readExternalSession, setExternalSessionCookie } from '@/src/server/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await readExternalSession();
  if (!session) return unauthorized();

  try {
    const result = await coreApiRequest<unknown>('/external/registration-profile', {
      method: 'GET',
      includeSupplier: false,
    });
    const profile = normalizeRegistrationProfile(result.data);
    if (!profile.registered) {
      await clearExternalSessionCookie();
      return unauthorized();
    }
    return apiSuccess({ supplierNo: DEMO_EXTERNAL_SUPPLIER_NO, supplierName: profile.name }, result.meta);
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST() {
  try {
    const result = await coreApiRequest<unknown>('/external/registration-profile', {
      method: 'GET',
      includeSupplier: false,
    });
    const profile = normalizeRegistrationProfile(result.data);
    if (!profile.registered) return unauthorized();
    if (!result.meta.workspaceInstanceId) {
      throw new Error('核心服务未返回工作区实例标识');
    }
    await setExternalSessionCookie(result.meta.workspaceInstanceId);
    return apiSuccess({ supplierNo: DEMO_EXTERNAL_SUPPLIER_NO, supplierName: profile.name }, result.meta);
  } catch (error) {
    return apiFailure(error);
  }
}
