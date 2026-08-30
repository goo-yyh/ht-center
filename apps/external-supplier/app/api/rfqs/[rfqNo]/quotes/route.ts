import { normalizeQuoteReceipt, quoteInputSchema } from '@/src/contracts';
import { coreApiRequest } from '@/src/server/core-api';
import { apiFailure, apiSuccess, unauthorized } from '@/src/server/route-response';
import { readExternalSession } from '@/src/server/session';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ rfqNo: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  if (!(await readExternalSession())) return unauthorized();
  try {
    const { rfqNo } = await context.params;
    const input = quoteInputSchema.parse(await request.json());
    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    const result = await coreApiRequest<unknown>(`/external/rfqs/${encodeURIComponent(rfqNo)}/quotes`, {
      method: 'POST',
      headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
      body: input,
    });
    return apiSuccess(normalizeQuoteReceipt(result.data) ?? result.data, result.meta, 201);
  } catch (error) {
    return apiFailure(error);
  }
}
