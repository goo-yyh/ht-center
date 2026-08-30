import { CoreApiError, coreApiDownload } from '@/src/server/core-api';
import { apiFailure, unauthorized } from '@/src/server/route-response';
import { readExternalSession } from '@/src/server/session';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ rfqNo: string; attachmentId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  if (!(await readExternalSession())) return unauthorized();
  try {
    const { rfqNo, attachmentId } = await context.params;
    const upstream = await coreApiDownload(
      `/external/rfqs/${encodeURIComponent(rfqNo)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    if (!upstream.body) throw new CoreApiError(502, 'ATTACHMENT_EMPTY', '采购附件内容为空');
    const headers = new Headers();
    for (const name of ['content-type', 'content-disposition', 'content-length', 'etag']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set('cache-control', 'private, no-store');
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    return apiFailure(error);
  }
}
