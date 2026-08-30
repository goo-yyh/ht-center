import { NextResponse } from 'next/server';

import { coreFetch } from '@/src/server/core-api';
import { handleRouteError, requireSupplierSession } from '@/src/server/http';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ rfqNo: string; attachmentId: string }> },
) {
  try {
    const session = await requireSupplierSession();
    const { rfqNo, attachmentId } = await context.params;
    const upstream = await coreFetch(
      `/internal/rfqs/${encodeURIComponent(rfqNo)}/attachments/${encodeURIComponent(attachmentId)}`,
      {},
      session.supplierNo,
    );
    const headers = new Headers();
    for (const name of ['content-type', 'content-length', 'content-disposition', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    const body = await upstream.arrayBuffer();
    headers.set('content-length', String(body.byteLength));
    headers.set('cache-control', 'private, no-store');
    return new NextResponse(body, { status: upstream.status, headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
