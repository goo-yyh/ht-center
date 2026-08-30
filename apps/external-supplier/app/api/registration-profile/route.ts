import { normalizeRegistrationProfile } from '@/src/contracts';
import { coreApiRequest } from '@/src/server/core-api';
import { apiFailure, apiSuccess } from '@/src/server/route-response';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await coreApiRequest<unknown>('/external/registration-profile', {
      method: 'GET',
      includeSupplier: false,
    });
    return apiSuccess(normalizeRegistrationProfile(result.data), result.meta);
  } catch (error) {
    return apiFailure(error);
  }
}
