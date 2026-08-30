import { IdentitySelector } from '@/src/components/IdentitySelector';
import { coreJson } from '@/src/server/core-api';
import { normalizeSuppliers, unwrapCoreResponse } from '@/src/server/normalizers';
import { readSession } from '@/src/server/session';
import type { DemoSupplier, SessionSupplier } from '@/src/lib/types';

export default async function HomePage() {
  let initialSuppliers: DemoSupplier[] = [];
  let initialSession: SessionSupplier | null = null;
  let initialError: string | undefined;
  let selectorKey = 'no-session';
  try {
    const [supplierEnvelope, session] = await Promise.all([
      coreJson('/internal/demo-suppliers').then(unwrapCoreResponse),
      readSession(),
    ]);
    initialSuppliers = normalizeSuppliers(supplierEnvelope.data);
    initialSession = session ? {
      supplierNo: session.supplierNo,
      supplierName: session.supplierName,
      workspaceCode: session.workspaceCode,
    } : null;
    selectorKey = session ? `${session.workspaceInstanceId}:${session.supplierNo}` : 'no-session';
  } catch (error) {
    initialError = error instanceof Error ? error.message : '核心业务 API 暂时无法连接';
    selectorKey = 'load-error';
  }
  return (
    <IdentitySelector
      key={selectorKey}
      initialSuppliers={initialSuppliers}
      initialSession={initialSession}
      initialError={initialError}
    />
  );
}
