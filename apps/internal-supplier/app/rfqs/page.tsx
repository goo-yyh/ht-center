import { RfqList } from '@/src/components/RfqList';
import { coreJson } from '@/src/server/core-api';
import { normalizeRfqList, unwrapCoreResponse } from '@/src/server/normalizers';
import { readSession } from '@/src/server/session';
import { redirect } from 'next/navigation';

export default async function RfqsPage() {
  const session = await readSession();
  if (!session) redirect('/');

  const envelope = unwrapCoreResponse(await coreJson('/internal/rfqs', {}, session.supplierNo));
  return (
    <RfqList
      initialSession={{
        supplierNo: session.supplierNo,
        supplierName: session.supplierName,
        workspaceCode: session.workspaceCode,
      }}
      initialRfqs={normalizeRfqList(envelope.data)}
      initialMeta={envelope.meta}
    />
  );
}
