import { NextResponse } from 'next/server';

import { coreJson } from '@/src/server/core-api';
import { handleRouteError, requireSupplierSession } from '@/src/server/http';
import { normalizeRfqList, unwrapCoreResponse, withMeta } from '@/src/server/normalizers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireSupplierSession();
    const envelope = unwrapCoreResponse(await coreJson('/internal/rfqs', {}, session.supplierNo));
    return NextResponse.json(withMeta(normalizeRfqList(envelope.data), envelope.meta));
  } catch (error) {
    return handleRouteError(error);
  }
}
