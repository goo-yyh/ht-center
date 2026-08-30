import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { coreJson } from '@/src/server/core-api';
import { handleRouteError } from '@/src/server/http';
import { normalizeSuppliers, unwrapCoreResponse } from '@/src/server/normalizers';
import { clearSessionCookie, readSession, setSessionCookie } from '@/src/server/session';

export const dynamic = 'force-dynamic';

const selectionSchema = z.object({ supplierNo: z.string().trim().min(1).max(64) });

function cookieIsSecure(request: NextRequest): boolean {
  return process.env.DEMO_COOKIE_SECURE === 'true' || request.headers.get('x-forwarded-proto') === 'https';
}

export async function GET() {
  try {
    const session = await readSession();
    if (!session) return NextResponse.json({ data: null, meta: { serverTime: new Date().toISOString() } });
    return NextResponse.json({
      data: {
        supplierNo: session.supplierNo,
        supplierName: session.supplierName,
        workspaceCode: session.workspaceCode,
      },
      meta: { workspaceCode: session.workspaceCode, serverTime: new Date().toISOString() },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = selectionSchema.parse(await request.json());
    const supplierEnvelope = unwrapCoreResponse(await coreJson('/internal/demo-suppliers'));
    const supplier = normalizeSuppliers(supplierEnvelope.data).find((item) => item.supplierNo === input.supplierNo);
    if (!supplier) {
      return NextResponse.json({ error: { code: 'INVALID_SUPPLIER_IDENTITY', message: '该供应商不属于可选的内部演示身份' } }, { status: 403 });
    }

    const sessionEnvelope = unwrapCoreResponse(await coreJson('/internal/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: '{}',
    }, supplier.supplierNo));
    const workspaceCode = sessionEnvelope.meta.workspaceCode ?? supplierEnvelope.meta.workspaceCode ?? 'DEMO-DEFAULT';
    const workspaceInstanceId = sessionEnvelope.meta.workspaceInstanceId ?? supplierEnvelope.meta.workspaceInstanceId;
    if (!workspaceInstanceId) throw new Error('核心 API 未返回工作区实例标识');
    const response = NextResponse.json({
      data: { supplierNo: supplier.supplierNo, supplierName: supplier.supplierName, workspaceCode },
      meta: { ...sessionEnvelope.meta, workspaceCode, serverTime: sessionEnvelope.meta.serverTime },
    });
    setSessionCookie(response, { supplierNo: supplier.supplierNo, supplierName: supplier.supplierName, workspaceCode, workspaceInstanceId }, cookieIsSecure(request));
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ data: { cleared: true }, meta: { serverTime: new Date().toISOString() } });
  clearSessionCookie(response, cookieIsSecure(request));
  return response;
}
