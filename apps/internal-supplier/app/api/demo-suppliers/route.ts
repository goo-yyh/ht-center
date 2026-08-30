import { NextResponse } from 'next/server';

import { coreJson } from '@/src/server/core-api';
import { handleRouteError } from '@/src/server/http';
import { normalizeSuppliers, unwrapCoreResponse, withMeta } from '@/src/server/normalizers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const envelope = unwrapCoreResponse(await coreJson('/internal/demo-suppliers'));
    return NextResponse.json(withMeta(normalizeSuppliers(envelope.data), envelope.meta));
  } catch (error) {
    return handleRouteError(error);
  }
}
