import { NextResponse } from 'next/server';

import { coreJson } from '@/src/server/core-api';
import { handleRouteError } from '@/src/server/http';
import { normalizeSuppliers, unwrapCoreResponse } from '@/src/server/normalizers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const envelope = unwrapCoreResponse(await coreJson('/internal/demo-suppliers'));
    const suppliers = normalizeSuppliers(envelope.data);
    return NextResponse.json({
      data: { status: 'ok', coreApi: 'reachable', supplierCount: suppliers.length },
      meta: envelope.meta,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
