import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireServiceToken, supplierNumber } from "../../../../../src/server/auth";
import { pool } from "../../../../../src/server/db";
import { normalizeError, ApiError } from "../../../../../src/server/errors";
import { initializeDemo, resetDemo } from "../../../../../src/server/fixtures";
import { getCatalog, getDashboard, getMeta, getNotifications, getQuoteProgress, getRequestDetail, getRequestList, getRevealedQuotes } from "../../../../../src/server/queries";
import {
  awardSchema, closeExpiredRfqs, closeRfq, createInternalSession, createPurchaseRequisition, createRequest, createRequestSchema, evaluateRfq,
  getAttachment, getDeepSeekRuntimeStatus, getExternalRegistrationProfile, getInternalDemoSuppliers, getOwnSupplierQuote, getSupplierRfq,
  listSupplierRfqs, markSupplierRfqViewed, preflight, publishRfq, quoteSchema, registerExternalSupplier,
  registerSchema, runSourcingAgent, agentMessageSchema, simulateRemainingQuotesInTransaction, submitSupplierQuoteInTransaction, withIdempotency,
} from "../../../../../src/server/services";
import { env } from "../../../../../src/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path?: string[] }> };

async function jsonBody(request: NextRequest) {
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text) as unknown; } catch { throw new ApiError("INVALID_INPUT", "请求体必须是 JSON", 400); }
}

async function success(data: unknown, status = 200) {
  return NextResponse.json({ data, meta: await getMeta() }, { status });
}

async function handler(request: NextRequest, context: Context) {
  const { path = [] } = await context.params;
  const method = request.method;
  const route = `/${path.join("/")}`;
  const idempotencyKey = request.headers.get("idempotency-key");

  if (method === "GET" && route === "/context") return success({ ...(await getMeta()) });
  if (method === "GET" && route === "/health") {
    const database = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    return success({ status: "ok", database: "connected", databaseTime: database.rows[0].now.toISOString(), deepSeek: await getDeepSeekRuntimeStatus(), quoteEncryptionConfigured: env.quoteKey.length === 32 });
  }
  if (["dashboard", "sourcing-requests", "rfqs", "internal", "external"].includes(path[0] ?? "")) await closeExpiredRfqs();
  if (method === "GET" && route === "/catalog") return success(await getCatalog());
  if (method === "GET" && route === "/dashboard") return success(await getDashboard());
  if (method === "GET" && route === "/sourcing-requests") return success(await getRequestList());
  if (method === "POST" && route === "/sourcing-requests") {
    const body = createRequestSchema.parse(await jsonBody(request));
    return success(await withIdempotency(route, "buyer", idempotencyKey, body, () => createRequest(body)), 201);
  }
  if (method === "GET" && path[0] === "sourcing-requests" && path.length === 2) return success(await getRequestDetail(path[1]));
  if (method === "POST" && path[0] === "sourcing-requests" && path[2] === "agent" && path[3] === "messages") {
    const body = agentMessageSchema.parse(await jsonBody(request));
    return success(await withIdempotency(route, "buyer", idempotencyKey, body, () => runSourcingAgent(path[1], body)));
  }
  if (method === "POST" && path[0] === "sourcing-requests" && path[2] === "publish") {
    const body = z.object({}).passthrough().parse(await jsonBody(request));
    return success(await withIdempotency(route, "buyer", idempotencyKey, body, () => publishRfq(path[1])));
  }
  if (method === "POST" && path[0] === "sourcing-requests" && path[2] === "purchase-requisition") {
    const body = awardSchema.parse(await jsonBody(request));
    return success(await withIdempotency(route, "buyer", idempotencyKey, body, () => createPurchaseRequisition(path[1], body)));
  }
  if (method === "GET" && path[0] === "sourcing-requests" && path[2] === "notifications") return success(await getNotifications(path[1]));
  if (method === "GET" && path[0] === "rfqs" && path[2] === "progress") return success(await getQuoteProgress(path[1]));
  if (method === "POST" && path[0] === "rfqs" && path[2] === "close") {
    const body = await jsonBody(request) as { reason?: string };
    return success(await withIdempotency(route, "buyer", idempotencyKey, body, () => closeRfq(path[1], body.reason ?? "EARLY_STOP")));
  }
  if (method === "POST" && path[0] === "rfqs" && path[2] === "simulate-remaining-quotes") {
    const body = z.object({}).passthrough().parse(await jsonBody(request));
    const simulation = await withIdempotency(route, "buyer", idempotencyKey, body, (client) => {
      if (!client) throw new ApiError("INTERNAL_ERROR", "模拟报价事务未建立", 500);
      return simulateRemainingQuotesInTransaction(client, path[1]);
    }, { workInTransaction: true });
    if (simulation.closedByDeadline) throw new ApiError("RFQ_CLOSED", "报价已到截止时间并自动停止", 409);
    const { closedByDeadline: _closedByDeadline, ...response } = simulation;
    void _closedByDeadline;
    return success(response);
  }
  if (method === "GET" && path[0] === "rfqs" && path[2] === "revealed-quotes") return success(await getRevealedQuotes(path[1]));
  if (method === "POST" && path[0] === "rfqs" && path[2] === "evaluations") {
    const body = await jsonBody(request);
    return success(await withIdempotency(route, "buyer", idempotencyKey, body, () => evaluateRfq(path[1])));
  }
  if (method === "GET" && path[0] === "attachments" && path[2] === "download") {
    const file = await getAttachment(path[1]);
    return new Response(new Uint8Array(file.content), { headers: { "content-type": file.mime_type, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}` } });
  }
  if (method === "POST" && route === "/demo/initialize") {
    if (!idempotencyKey) throw new ApiError("INVALID_INPUT", "写接口必须提供 Idempotency-Key", 400);
    const body = await jsonBody(request);
    return success(await withIdempotency(
      route,
      "buyer",
      idempotencyKey,
      body,
      (client) => initializeDemo(client),
      { allowMissingWorkspace: true, workspaceLifecycle: "exclusive", workInTransaction: true },
    ));
  }
  if (method === "GET" && route === "/demo/preflight") return success(await preflight());
  if (method === "POST" && route === "/demo/reset") {
    if (!env.DEMO_RESET_ENABLED) throw new ApiError("UNAUTHORIZED", "当前环境未开放 Demo 重置", 403);
    if (!idempotencyKey) throw new ApiError("INVALID_INPUT", "写接口必须提供 Idempotency-Key", 400);
    const body = await jsonBody(request) as { confirm?: string | boolean };
    const confirmation = (body as { confirmation?: string }).confirmation;
    if (!(body.confirm === true || body.confirm === "RESET" || confirmation === "重置 Demo 数据")) throw new ApiError("INVALID_INPUT", "重置必须显式确认", 400);
    return success(await withIdempotency(
      route,
      "buyer",
      idempotencyKey,
      body,
      (client) => resetDemo(client),
      { allowMissingWorkspace: true, workspaceLifecycle: "exclusive", workInTransaction: true },
    ));
  }

  if (path[0] === "internal") {
    requireServiceToken(request);
    if (method === "GET" && route === "/internal/demo-suppliers") return success(await getInternalDemoSuppliers());
    if (method === "POST" && route === "/internal/session") {
      await jsonBody(request);
      const supplierNo = request.headers.get("x-demo-supplier-no");
      if (!supplierNo) throw new ApiError("INVALID_INPUT", "请选择内部供应商", 400);
      return success(await createInternalSession(supplierNo));
    }
    const supplierNo = supplierNumber(request, "INTERNAL");
    if (method === "GET" && route === "/internal/rfqs") return success(await listSupplierRfqs(supplierNo, "INTERNAL"));
    if (method === "GET" && path[1] === "rfqs" && path.length === 3) return success(await getSupplierRfq(supplierNo, "INTERNAL", path[2]));
    if (method === "POST" && path[1] === "rfqs" && path[3] === "view") return success(await withIdempotency(route, supplierNo, idempotencyKey, {}, () => markSupplierRfqViewed(supplierNo, "INTERNAL", path[2])));
    if (method === "GET" && path[1] === "rfqs" && path[3] === "attachments") {
      const file = await getAttachment(path[4], { supplierNo, type: "INTERNAL" });
      return new Response(new Uint8Array(file.content), { headers: { "content-type": file.mime_type, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}` } });
    }
    if (method === "POST" && path[1] === "rfqs" && path[3] === "quotes") {
      const body = quoteSchema.parse(await jsonBody(request));
      return success(await withIdempotency(route, supplierNo, idempotencyKey, body, (client) => {
        if (!client) throw new ApiError("INTERNAL_ERROR", "报价事务未建立", 500);
        return submitSupplierQuoteInTransaction(client, supplierNo, "INTERNAL", path[2], body);
      }, { sealResponse: true, workInTransaction: true }), 201);
    }
    if (method === "GET" && path[1] === "rfqs" && path[3] === "quotes" && path[4] === "me") return success(await getOwnSupplierQuote(supplierNo, "INTERNAL", path[2]));
  }

  if (path[0] === "external") {
    requireServiceToken(request);
    if (method === "GET" && route === "/external/registration-profile") return success(await getExternalRegistrationProfile());
    const supplierNo = supplierNumber(request, "EXTERNAL");
    if (method === "POST" && route === "/external/register") {
      const body = registerSchema.parse(await jsonBody(request));
      return success(await withIdempotency(route, supplierNo, idempotencyKey, body, () => registerExternalSupplier(supplierNo, body)), 201);
    }
    if (method === "GET" && route === "/external/rfqs") return success(await listSupplierRfqs(supplierNo, "EXTERNAL"));
    if (method === "GET" && path[1] === "rfqs" && path.length === 3) return success(await getSupplierRfq(supplierNo, "EXTERNAL", path[2]));
    if (method === "POST" && path[1] === "rfqs" && path[3] === "view") return success(await withIdempotency(route, supplierNo, idempotencyKey, {}, () => markSupplierRfqViewed(supplierNo, "EXTERNAL", path[2])));
    if (method === "GET" && path[1] === "rfqs" && path[3] === "attachments") {
      const file = await getAttachment(path[4], { supplierNo, type: "EXTERNAL" });
      return new Response(new Uint8Array(file.content), { headers: { "content-type": file.mime_type, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}` } });
    }
    if (method === "POST" && path[1] === "rfqs" && path[3] === "quotes") {
      const body = quoteSchema.parse(await jsonBody(request));
      return success(await withIdempotency(route, supplierNo, idempotencyKey, body, (client) => {
        if (!client) throw new ApiError("INTERNAL_ERROR", "报价事务未建立", 500);
        return submitSupplierQuoteInTransaction(client, supplierNo, "EXTERNAL", path[2], body);
      }, { sealResponse: true, workInTransaction: true }), 201);
    }
    if (method === "GET" && path[1] === "rfqs" && path[3] === "quotes" && path[4] === "me") return success(await getOwnSupplierQuote(supplierNo, "EXTERNAL", path[2]));
  }

  throw new ApiError("NOT_FOUND", "接口不存在", 404);
}

async function route(request: NextRequest, context: Context) {
  try { return await handler(request, context); }
  catch (error) {
    const normalized = normalizeError(error);
    let meta: unknown = { workspaceCode: "DEMO-DEFAULT", revision: 0, serverTime: new Date().toISOString(), requestId: crypto.randomUUID() };
    try { meta = await getMeta(); } catch { /* database may not be initialized */ }
    return NextResponse.json({ error: { code: normalized.code, message: normalized.message, details: normalized.details ?? null }, meta }, { status: normalized.status });
  }
}

export const GET = route;
export const POST = route;
