import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { quoteInputSchema } from '@/src/lib/quote-schema';
import { CoreApiError, coreJson } from '@/src/server/core-api';
import { handleRouteError, requireSupplierSession } from '@/src/server/http';
import { normalizeQuoteReceipt, unwrapCoreResponse, withMeta } from '@/src/server/normalizers';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ rfqNo: string }> }) {
  try {
    const session = await requireSupplierSession();
    const { rfqNo } = await context.params;
    const envelope = unwrapCoreResponse(await coreJson(`/internal/rfqs/${encodeURIComponent(rfqNo)}/quotes/me`, {}, session.supplierNo));
    return NextResponse.json(withMeta(normalizeQuoteReceipt(envelope.data), envelope.meta));
  } catch (error) {
    if (error instanceof CoreApiError && error.status === 404) {
      return NextResponse.json({ data: null, meta: { serverTime: new Date().toISOString() } });
    }
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ rfqNo: string }> }) {
  try {
    const session = await requireSupplierSession();
    const { rfqNo } = await context.params;
    const input = quoteInputSchema.parse(await request.json());
    const idempotencyKey = request.headers.get('idempotency-key')?.slice(0, 128) || randomUUID();
    const envelope = unwrapCoreResponse(await coreJson(`/internal/rfqs/${encodeURIComponent(rfqNo)}/quotes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    }, session.supplierNo));
    return NextResponse.json(withMeta(normalizeQuoteReceipt(envelope.data), envelope.meta), { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
