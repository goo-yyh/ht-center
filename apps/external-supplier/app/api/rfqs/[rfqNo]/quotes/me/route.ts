import { normalizeQuoteReceipt } from '@/src/contracts';
import { coreApiRequest } from '@/src/server/core-api';
import { apiFailure, apiSuccess, unauthorized } from '@/src/server/route-response';
import { readExternalSession } from '@/src/server/session';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ rfqNo: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  if (!(await readExternalSession())) return unauthorized();
  try {
    const { rfqNo } = await context.params;
    const result = await coreApiRequest<unknown>(`/external/rfqs/${encodeURIComponent(rfqNo)}/quotes/me`, {
      method: 'GET',
    });
    return apiSuccess(normalizeQuoteReceipt(result.data), result.meta);
  } catch (error) {
    return apiFailure(error);
  }
}
