import { RfqDetailView } from '@/src/components/RfqDetailView';
import { CoreApiError, coreJson } from '@/src/server/core-api';
import { normalizeQuoteReceipt, normalizeRfqDetail, unwrapCoreResponse } from '@/src/server/normalizers';
import { readSession } from '@/src/server/session';
import { notFound, redirect } from 'next/navigation';

export default async function RfqDetailPage({ params }: { params: Promise<{ rfqNo: string }> }) {
  const { rfqNo } = await params;
  const session = await readSession();
  if (!session) redirect('/');

  let detailEnvelope;
  try {
    detailEnvelope = unwrapCoreResponse(await coreJson(
      `/internal/rfqs/${encodeURIComponent(rfqNo)}`,
      {},
      session.supplierNo,
    ));
  } catch (error) {
    if (error instanceof CoreApiError && error.status === 404) notFound();
    throw error;
  }

  let initialReceipt = null;
  try {
    const quoteEnvelope = unwrapCoreResponse(await coreJson(
      `/internal/rfqs/${encodeURIComponent(rfqNo)}/quotes/me`,
      {},
      session.supplierNo,
    ));
    initialReceipt = normalizeQuoteReceipt(quoteEnvelope.data);
  } catch (error) {
    if (!(error instanceof CoreApiError && error.status === 404)) throw error;
  }

  return (
    <RfqDetailView
      rfqNo={rfqNo}
      initialSession={{
        supplierNo: session.supplierNo,
        supplierName: session.supplierName,
        workspaceCode: session.workspaceCode,
      }}
      initialDetail={normalizeRfqDetail(detailEnvelope.data)}
      initialReceipt={initialReceipt}
      initialMeta={detailEnvelope.meta}
    />
  );
}
