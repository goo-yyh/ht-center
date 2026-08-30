import { normalizeRfqListResult } from '@/src/contracts';
import { coreApiRequest } from '@/src/server/core-api';
import { apiFailure, apiSuccess, unauthorized } from '@/src/server/route-response';
import { readExternalSession } from '@/src/server/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await readExternalSession())) return unauthorized();
  try {
    const result = await coreApiRequest<unknown>('/external/rfqs', { method: 'GET' });
    return apiSuccess(normalizeRfqListResult(result.data), result.meta);
  } catch (error) {
    return apiFailure(error);
  }
}
