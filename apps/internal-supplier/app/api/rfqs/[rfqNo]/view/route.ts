import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { coreJson } from '@/src/server/core-api';
import { handleRouteError, requireSupplierSession } from '@/src/server/http';
import { unwrapCoreResponse } from '@/src/server/normalizers';

export async function POST(request: NextRequest, context: { params: Promise<{ rfqNo: string }> }) {
  try {
    const session = await requireSupplierSession();
    const { rfqNo } = await context.params;
    const idempotencyKey = request.headers.get('idempotency-key')?.slice(0, 128) || randomUUID();
    const envelope = unwrapCoreResponse(await coreJson(`/internal/rfqs/${encodeURIComponent(rfqNo)}/view`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: '{}',
    }, session.supplierNo));
    return NextResponse.json(envelope);
  } catch (error) {
    return handleRouteError(error);
  }
}
