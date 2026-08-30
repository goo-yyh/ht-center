import { NextResponse } from 'next/server';

import { coreJson } from '@/src/server/core-api';
import { handleRouteError, requireSupplierSession } from '@/src/server/http';
import { normalizeRfqDetail, unwrapCoreResponse, withMeta } from '@/src/server/normalizers';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ rfqNo: string }> }) {
  try {
    const session = await requireSupplierSession();
    const { rfqNo } = await context.params;
    const envelope = unwrapCoreResponse(await coreJson(`/internal/rfqs/${encodeURIComponent(rfqNo)}`, {}, session.supplierNo));
    return NextResponse.json(withMeta(normalizeRfqDetail(envelope.data), envelope.meta));
  } catch (error) {
    return handleRouteError(error);
  }
}
