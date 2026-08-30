import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../../src/server/db";
import { assertDemoBaseline, initializeDemo, resetDemo } from "../../src/server/fixtures";
import { ACTIVE_DEMO_RFQ_DEADLINE } from "../../src/server/env";
import { getDashboard, getRequestDetail } from "../../src/server/queries";
import { closeExpiredRfqs, closeRfq, createPurchaseRequisition, evaluateRfq, getAttachment, getDeepSeekRuntimeStatus, getOwnSupplierQuote, getSupplierRfq, listSupplierRfqs, preflight, publishRfq, quoteSchema, registerExternalSupplier, runSourcingAgent, simulateRemainingQuotes, simulateRemainingQuotesInTransaction, submitSupplierQuote, submitSupplierQuoteInTransaction, withIdempotency } from "../../src/server/services";
import { openQuote, quoteAad, sealQuote } from "../../src/server/crypto";
import { ApiError } from "../../src/server/errors";
import * as deepseek from "../../src/server/deepseek";
import { migrate } from "../../src/server/migrate";

type CandidateAgentInput = {
  request: {
    itemCode: string;
    specificationCode: string;
    quantity: number;
    unit: string;
    qualificationCodes: string[];
    requiredDeliveryDays: number;
    quoteDurationMinutes: number;
    evaluationStrategy: string;
  };
  conversation: Array<{ role: string; content: string }>;
  candidates: Array<{ supplierNo: string }>;
};

function successfulCandidateDescription(input: unknown) {
  const payload = input as CandidateAgentInput;
  return Promise.resolve({
    value: {
      summary: "已按固定条件完成候选供应商筛选。",
      candidates: payload.candidates.map((candidate) => ({ supplierNo: candidate.supplierNo, recommendation: "符合固定条件", riskSummary: "风险可控" })),
    },
    providerRequestId: "test-provider-request",
    model: "deepseek-test",
  });
}

type SourcingToolCallbacks = Parameters<typeof deepseek.sourceCandidatesWithTools>[1];
type CandidateDescriptionResult = Awaited<ReturnType<typeof successfulCandidateDescription>>;

async function executeSuccessfulSourcingTools(
  input: unknown,
  callbacks: SourcingToolCallbacks,
  finalResult: (candidateInput: CandidateAgentInput) => Promise<CandidateDescriptionResult> = successfulCandidateDescription,
) {
  const payload = input as Omit<CandidateAgentInput, "candidates">;
  const sourceToolNames = [
    "query_internal_suppliers",
    "query_1688_suppliers",
    "query_qichacha_suppliers",
    "query_industry_platform_suppliers",
  ] as const;
  const sourceSuppliers = [] as Awaited<ReturnType<SourcingToolCallbacks["executeTool"]>>["suppliers"];
  for (const [index, name] of sourceToolNames.entries()) {
    const result = await callbacks.executeTool({ id: `test-source-${index}`, name, arguments: { itemCode: payload.request.itemCode } });
    sourceSuppliers.push(...result.suppliers);
  }
  const qualified = await callbacks.executeTool({
    id: "test-qualification",
    name: "check_supplier_qualifications",
    arguments: { supplierNos: sourceSuppliers.map((supplier) => supplier.supplierNo), qualificationCodes: payload.request.qualificationCodes },
  });
  const deliverable = await callbacks.executeTool({
    id: "test-delivery",
    name: "check_supplier_delivery",
    arguments: { supplierNos: qualified.suppliers.map((supplier) => supplier.supplierNo), requiredDeliveryDays: payload.request.requiredDeliveryDays },
  });
  const candidateInput = { ...payload, candidates: deliverable.suppliers } as CandidateAgentInput;
  return callbacks.finalize(() => finalResult(candidateInput));
}

function successfulIntent(intent: "RUN_SOURCING" | "ADJUST_AND_SOURCE" | "CONVERSATION" | "OUT_OF_SCOPE", answer = "已识别本轮消息意图。") {
  return Promise.resolve({
    value: { intent, answer },
    providerRequestId: "test-routing-provider-request",
    model: "deepseek-router-test",
  });
}

function mockIntent(intent: "RUN_SOURCING" | "ADJUST_AND_SOURCE" | "CONVERSATION" | "OUT_OF_SCOPE", answer?: string) {
  return vi.spyOn(deepseek, "classifyAgentIntent").mockImplementation(async () => successfulIntent(intent, answer));
}

type EvaluationAgentInput = {
  ranking: Array<{ quoteNo: string }>;
};

function successfulEvaluationDescription(input: unknown) {
  const payload = input as EvaluationAgentInput;
  return {
    value: {
      summary: "已完成报价评估并生成推荐说明。",
      items: payload.ranking.map((item) => ({ quoteNo: item.quoteNo, strengthCode: "BALANCED" as const, riskCode: "NONE" as const })),
    },
    providerRequestId: "evaluation-provider-request",
    model: "deepseek-evaluation-test",
  };
}

async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("等待测试状态超时");
}

beforeEach(async () => { await resetDemo(); });
afterAll(async () => { await pool.end(); });

describe("海天寻源核心后端", () => {
  it("健康状态区分已配置与已经真实调用", async () => {
    await expect(getDeepSeekRuntimeStatus()).resolves.toMatchObject({
      configured: false,
      state: "UNCONFIGURED",
      model: expect.any(String),
      lastVerifiedAt: null,
    });
  });

  it("初始化五条完整阶段数据并通过预检", async () => {
    const result = await preflight();
    expect(result.ready).toBe(true);
    const dashboard = await getDashboard();
    expect(dashboard.stats).toEqual({ total: 5, sourcing: 1, bidding: 1, evaluating: 1, awardPending: 1, completed: 1 });
    expect(dashboard.requests.find((request) => request.requestNo === "SR-DEMO-0001")?.quoteProgress).toBeNull();
    expect(dashboard.requests.find((request) => request.requestNo === "SR-DEMO-0002")?.quoteProgress).toMatchObject({ invited: 6, submitted: 2 });
    const sourcing = await getRequestDetail("SR-DEMO-0001");
    expect(sourcing.activeSourcingAgentRun).toBeNull();
    expect(sourcing.latestSourcingAgentRun).toMatchObject({ status: "SUCCEEDED", isSeeded: true });
    expect(sourcing.agentMessages.every((message) => message.agentRunId && message.isSeeded)).toBe(true);
    expect(sourcing.agentActions.every((action) => action.agentRunId && action.isSeeded)).toBe(true);
  });

  it("后四条需求中已有的固定询价统一截止到北京时间 2026 年 9 月 15 日 23:59", async () => {
    const rfqs = (await pool.query<{ request_no: string; status: string; deadline_at: Date; close_reason: string | null }>(
      `SELECT sr.request_no,r.status,r.deadline_at,r.close_reason
         FROM rfqs r
         JOIN sourcing_requests sr ON sr.id=r.request_id
        WHERE sr.request_no IN ('SR-DEMO-0002','SR-DEMO-0003','SR-DEMO-0004')
        ORDER BY sr.request_no`,
    )).rows;
    expect(rfqs).toHaveLength(3);
    expect(rfqs.map((rfq) => rfq.deadline_at.toISOString())).toEqual(Array(3).fill(ACTIVE_DEMO_RFQ_DEADLINE));
    expect(rfqs).toEqual([
      expect.objectContaining({ request_no: "SR-DEMO-0002", status: "OPEN", close_reason: null }),
      expect.objectContaining({ request_no: "SR-DEMO-0003", status: "CLOSED", close_reason: "EARLY_STOP" }),
      expect.objectContaining({ request_no: "SR-DEMO-0004", status: "CLOSED", close_reason: "EARLY_STOP" }),
    ]);
  });

  it("普通新建需求发布询价时仍按所选报价时长计算截止时间", async () => {
    await pool.query(`UPDATE sourcing_requests SET request_no='SR-LIVE-DEADLINE-TEST',quote_duration_minutes=30 WHERE request_no='SR-DEMO-0001'`);
    const before = (await pool.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0].now;
    const published = await publishRfq("SR-LIVE-DEADLINE-TEST");
    const after = (await pool.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0].now;
    const deadline = new Date(published.rfq!.deadlineAt!).getTime();
    expect(deadline).toBeGreaterThanOrEqual(before.getTime() + 30 * 60_000);
    expect(deadline).toBeLessThanOrEqual(after.getTime() + 30 * 60_000);
  });

  it("截止时间迁移原位保留业务状态、报价版本、评估、中选与 PR 数据", async () => {
    const before = (await pool.query<{
      request_no: string; status: string; versions: string; evaluations: string; awards: string; prs: string;
    }>(`
      SELECT sr.request_no,sr.status,
             (SELECT count(*)::text FROM quote_versions v JOIN quotes q ON q.id=v.quote_id JOIN rfqs rq ON rq.id=q.rfq_id WHERE rq.request_id=sr.id) AS versions,
             (SELECT count(*)::text FROM evaluations e WHERE e.request_id=sr.id) AS evaluations,
             (SELECT count(*)::text FROM awards aw WHERE aw.request_id=sr.id) AS awards,
             (SELECT count(*)::text FROM purchase_requisitions pr WHERE pr.request_id=sr.id) AS prs
        FROM sourcing_requests sr
       WHERE sr.request_no BETWEEN 'SR-DEMO-0001' AND 'SR-DEMO-0005'
       ORDER BY sr.request_no`)).rows;
    await pool.query(`
      UPDATE rfqs r
         SET deadline_at=clock_timestamp()-interval '1 day',
             close_reason=CASE WHEN r.status='CLOSED' THEN 'DEADLINE_REACHED' ELSE NULL END
        FROM sourcing_requests sr
       WHERE r.request_id=sr.id AND sr.request_no IN ('SR-DEMO-0001','SR-DEMO-0002','SR-DEMO-0003','SR-DEMO-0004')`);
    await pool.query(`UPDATE rfq_close_events event SET close_reason='DEADLINE_REACHED' FROM rfqs r,sourcing_requests sr WHERE event.rfq_id=r.id AND r.request_id=sr.id AND sr.request_no IN ('SR-DEMO-0003','SR-DEMO-0004')`);
    await pool.query(`INSERT INTO workflow_events(workspace_id,request_id,event_type,actor,summary,event_data) SELECT sr.workspace_id,sr.id,'RFQ_CLOSED_AND_REVEALED','buyer','报价已停止并统一解封','{"reason":"DEADLINE_REACHED"}'::jsonb FROM sourcing_requests sr WHERE sr.request_no='SR-DEMO-0003'`);
    await pool.query(`DELETE FROM schema_migrations WHERE version IN ('0003_demo_rfq_deadlines','0004_demo_rfq_close_audit')`);

    await migrate();

    const migrated = (await pool.query<{ request_no: string; status: string; deadline_at: Date | null; close_reason: string | null }>(`
      SELECT sr.request_no,sr.status,r.deadline_at,r.close_reason
        FROM sourcing_requests sr LEFT JOIN rfqs r ON r.request_id=sr.id
       WHERE sr.request_no BETWEEN 'SR-DEMO-0001' AND 'SR-DEMO-0005'
       ORDER BY sr.request_no`)).rows;
    expect(migrated.slice(0, 4).map((row) => row.deadline_at?.toISOString())).toEqual([
      undefined,
      ACTIVE_DEMO_RFQ_DEADLINE,
      ACTIVE_DEMO_RFQ_DEADLINE,
      ACTIVE_DEMO_RFQ_DEADLINE,
    ]);
    expect(migrated.find((row) => row.request_no === "SR-DEMO-0003")?.close_reason).toBe("EARLY_STOP");
    expect(migrated.find((row) => row.request_no === "SR-DEMO-0004")?.close_reason).toBe("EARLY_STOP");
    expect(migrated.find((row) => row.request_no === "SR-DEMO-0005")?.deadline_at?.toISOString()).not.toBe(ACTIVE_DEMO_RFQ_DEADLINE);
    expect((await pool.query(`SELECT event.close_reason FROM rfq_close_events event JOIN rfqs r ON r.id=event.rfq_id JOIN sourcing_requests sr ON sr.id=r.request_id WHERE sr.request_no IN ('SR-DEMO-0003','SR-DEMO-0004')`)).rows.every((row) => row.close_reason === "EARLY_STOP")).toBe(true);
    expect((await pool.query(`SELECT event_data->>'reason' AS reason FROM workflow_events event JOIN sourcing_requests sr ON sr.id=event.request_id WHERE sr.request_no='SR-DEMO-0003' AND event.event_type='RFQ_CLOSED_AND_REVEALED'`)).rows).toEqual([expect.objectContaining({ reason: "EARLY_STOP" })]);

    const after = (await pool.query(`
      SELECT sr.request_no,sr.status,
             (SELECT count(*)::text FROM quote_versions v JOIN quotes q ON q.id=v.quote_id JOIN rfqs rq ON rq.id=q.rfq_id WHERE rq.request_id=sr.id) AS versions,
             (SELECT count(*)::text FROM evaluations e WHERE e.request_id=sr.id) AS evaluations,
             (SELECT count(*)::text FROM awards aw WHERE aw.request_id=sr.id) AS awards,
             (SELECT count(*)::text FROM purchase_requisitions pr WHERE pr.request_id=sr.id) AS prs
        FROM sourcing_requests sr
       WHERE sr.request_no BETWEEN 'SR-DEMO-0001' AND 'SR-DEMO-0005'
       ORDER BY sr.request_no`)).rows;
    expect(after).toEqual(before);
  });

  it("明文报价文案迁移非破坏更新旧 Agent 步骤与时间线且重复执行幂等", async () => {
    await pool.query(`UPDATE agent_actions action SET action_type='LOAD_REVEALED_QUOTES',summary='已读取 5 份停止报价后统一解封的有效报价' FROM sourcing_requests request WHERE action.request_id=request.id AND request.request_no='SR-DEMO-0004' AND action.action_type='LOAD_CURRENT_QUOTES'`);
    await pool.query(`UPDATE agent_actions action SET summary='5 份报价的密封载荷、解封明细和关闭记录数量一致' FROM sourcing_requests request WHERE action.request_id=request.id AND request.request_no='SR-DEMO-0004' AND action.action_type='VERIFY_QUOTE_SET'`);
    await pool.query(`INSERT INTO workflow_events(workspace_id,request_id,event_type,actor,summary,event_data) SELECT workspace_id,id,'RFQ_CLOSED_AND_REVEALED','buyer','报价已停止并统一解封','{"reason":"EARLY_STOP","revealedQuoteCount":5}'::jsonb FROM sourcing_requests WHERE request_no='SR-DEMO-0004'`);
    await pool.query(`INSERT INTO workflow_events(workspace_id,request_id,event_type,actor,summary,event_data) SELECT workspace_id,id,'QUOTE_SUBMITTED','EXT-SUP-DEMO-001','供应商提交一次密封报价','{}'::jsonb FROM sourcing_requests WHERE request_no='SR-DEMO-0004'`);
    await pool.query(`INSERT INTO workflow_events(workspace_id,request_id,event_type,actor,summary,event_data) SELECT workspace_id,id,'REMAINING_QUOTES_SIMULATED','buyer-demo-helper','一键补齐剩余供应商密封报价','{}'::jsonb FROM sourcing_requests WHERE request_no='SR-DEMO-0004'`);
    await pool.query(`DELETE FROM schema_migrations WHERE version='0008_plain_quote_copy'`);

    await migrate();
    await migrate();

    const actions = await pool.query<{ action_type: string; summary: string }>(`SELECT action.action_type,action.summary FROM agent_actions action JOIN sourcing_requests request ON request.id=action.request_id WHERE request.request_no='SR-DEMO-0004' AND action.action_type IN ('LOAD_REVEALED_QUOTES','LOAD_CURRENT_QUOTES','VERIFY_QUOTE_SET') ORDER BY action.action_type`);
    expect(actions.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ action_type: 'LOAD_CURRENT_QUOTES', summary: '已读取 5 份停止报价后的最终有效报价' }),
      expect.objectContaining({ action_type: 'VERIFY_QUOTE_SET', summary: '5 份报价的最新版本与关闭记录数量一致' }),
    ]));
    expect(actions.rows.some((row) => row.action_type === 'LOAD_REVEALED_QUOTES')).toBe(false);
    const events = await pool.query<{ event_type: string; summary: string; event_data: Record<string, unknown> }>(`SELECT event_type,summary,event_data FROM workflow_events event JOIN sourcing_requests request ON request.id=event.request_id WHERE request.request_no='SR-DEMO-0004' AND event.event_type IN ('RFQ_CLOSED','RFQ_CLOSED_AND_REVEALED','QUOTE_SUBMITTED','REMAINING_QUOTES_SIMULATED') ORDER BY event_type`);
    expect(events.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'RFQ_CLOSED', summary: '报价已停止，最终报价集合已冻结', event_data: expect.objectContaining({ quoteCount: 5 }) }),
      expect.objectContaining({ event_type: 'QUOTE_SUBMITTED', summary: '供应商提交首次报价', event_data: expect.objectContaining({ version: 1 }) }),
      expect.objectContaining({ event_type: 'REMAINING_QUOTES_SIMULATED', summary: '一键补齐剩余供应商首次报价' }),
    ]));
    expect(events.rows.some((row) => row.event_type === 'RFQ_CLOSED_AND_REVEALED')).toBe(false);
  });

  it("供应商询价列表返回真实附件数量", async () => {
    const result = await listSupplierRfqs("INT-SUP-DEMO-002", "INTERNAL");
    expect(result.rfqs.find((rfq) => rfq.rfqNo === "RFQ-DEMO-0002")?.attachmentCount).toBe(1);
  });

  it("附件元数据校验和与实际下载字节一致", async () => {
    const detail = await getSupplierRfq("INT-SUP-DEMO-003", "INTERNAL", "RFQ-DEMO-0002");
    const attachment = detail.attachments[0];
    expect(attachment).toBeDefined();

    const downloaded = await getAttachment(attachment!.attachmentId, {
      supplierNo: "INT-SUP-DEMO-003",
      type: "INTERNAL",
    });
    expect(createHash("sha256").update(downloaded.content).digest("hex")).toBe(attachment!.checksumSha256);
  });

  it("初始化会无损修复既有附件的错误校验和", async () => {
    const attachment = (await pool.query<{ id: string; content: Buffer }>(
      `SELECT attachment.id,attachment.content
         FROM request_attachments attachment
         JOIN sourcing_requests request ON request.id=attachment.request_id
        WHERE request.request_no='SR-DEMO-0002'`,
    )).rows[0];
    await pool.query(`UPDATE request_attachments SET checksum_sha256='legacy-invalid-checksum' WHERE id=$1`, [attachment.id]);

    const result = await initializeDemo();
    const repaired = (await pool.query<{ checksum_sha256: string }>(
      `SELECT checksum_sha256 FROM request_attachments WHERE id=$1`,
      [attachment.id],
    )).rows[0];
    expect(result.initialized).toBe(false);
    expect(repaired.checksum_sha256).toBe(createHash("sha256").update(attachment.content).digest("hex"));
  });

  it("当前 seedVersion 已初始化时不修改工作区和演示进度", async () => {
    const before = await pool.query(`SELECT id,seed_version,revision::text,reset_at,updated_at FROM demo_workspaces WHERE code='DEMO-DEFAULT'`);
    const beforeCounts = await pool.query(`SELECT count(*)::int AS requests,(SELECT count(*)::int FROM quotes) AS quotes FROM sourcing_requests`);
    const result = await initializeDemo();
    const after = await pool.query(`SELECT id,seed_version,revision::text,reset_at,updated_at FROM demo_workspaces WHERE code='DEMO-DEFAULT'`);
    const afterCounts = await pool.query(`SELECT count(*)::int AS requests,(SELECT count(*)::int FROM quotes) AS quotes FROM sourcing_requests`);
    expect(result.initialized).toBe(false);
    expect(after.rows).toEqual(before.rows);
    expect(afterCounts.rows).toEqual(beforeCounts.rows);
  });

  it("初始化非破坏性回填旧密文报价且重复执行幂等", async () => {
    const workspaceBefore = (await pool.query<{ id: string; revision: string }>(`SELECT id,revision::text FROM demo_workspaces WHERE code='DEMO-DEFAULT'`)).rows[0];
    const legacy = (await pool.query<{
      id: string; workspace_id: string; rfq_id: string; supplier_id: string; submitted_at: Date; payload_sha256: string;
      total_amount: string; delivery_days: number; remark: string;
    }>(`
      SELECT quote.id,quote.workspace_id,quote.rfq_id,quote.supplier_id,quote.submitted_at,quote.payload_sha256,
             version.total_amount::text,version.delivery_days,version.remark
        FROM quotes quote JOIN quote_versions version ON version.quote_id=quote.id AND version.version_no=1
        JOIN rfqs rfq ON rfq.id=quote.rfq_id
       WHERE rfq.rfq_no='RFQ-DEMO-0002'
       ORDER BY quote.quote_no LIMIT 1`)).rows[0];
    const payload = { totalAmount: legacy.total_amount, deliveryDays: legacy.delivery_days, remark: legacy.remark };
    const sealed = sealQuote(payload, quoteAad(legacy.workspace_id, legacy.rfq_id, legacy.supplier_id, legacy.id));
    await pool.query(`INSERT INTO quote_sealed_payloads(quote_id,workspace_id,ciphertext,nonce,auth_tag,key_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [legacy.id, legacy.workspace_id, sealed.ciphertext, sealed.nonce, sealed.authTag, sealed.keyVersion, legacy.submitted_at]);
    await pool.query(`DELETE FROM quote_versions WHERE quote_id=$1`, [legacy.id]);

    const first = await initializeDemo();
    const second = await initializeDemo();
    expect(first.initialized).toBe(false);
    expect(second.initialized).toBe(false);
    const workspaceAfter = (await pool.query<{ id: string; revision: string }>(`SELECT id,revision::text FROM demo_workspaces WHERE code='DEMO-DEFAULT'`)).rows[0];
    expect(workspaceAfter).toEqual(workspaceBefore);
    const restored = await pool.query(`SELECT total_amount::text,delivery_days,remark FROM quote_versions WHERE quote_id=$1 ORDER BY version_no`, [legacy.id]);
    expect(restored.rows).toEqual([{ total_amount: legacy.total_amount, delivery_days: legacy.delivery_days, remark: legacy.remark }]);
  });

  it("数据库已迁移但工作区不存在时可以通过幂等初始化原子创建完整基线", async () => {
    await pool.query(`DELETE FROM demo_workspaces WHERE code='DEMO-DEFAULT'`);
    expect((await pool.query(`SELECT id FROM demo_workspaces WHERE code='DEMO-DEFAULT'`)).rowCount).toBe(0);
    const initialized = await withIdempotency(
      "/demo/initialize",
      "buyer",
      "cold-start-initialize-test",
      {},
      (client) => initializeDemo(client),
      { allowMissingWorkspace: true, workspaceLifecycle: "exclusive", workInTransaction: true },
    );
    expect(initialized.initialized).toBe(true);
    expect((await assertDemoBaseline()).ready).toBe(true);
    const workspace = (await pool.query<{ id: string }>(`SELECT id FROM demo_workspaces WHERE code='DEMO-DEFAULT'`)).rows[0];
    expect((await pool.query(
      `SELECT id FROM idempotency_records WHERE workspace_id=$1 AND scope='/demo/initialize' AND actor='buyer' AND idempotency_key='cold-start-initialize-test'`,
      [workspace.id],
    )).rowCount).toBe(1);
  });

  it("完整基线断言失败时可由调用事务整体回滚", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM notification_records WHERE invitation_id=(SELECT i.id FROM rfq_invitations i JOIN rfqs r ON r.id=i.rfq_id WHERE r.rfq_no='RFQ-DEMO-0002' LIMIT 1)`);
      await expect(assertDemoBaseline(client)).rejects.toThrow("Demo 基线断言失败");
      await client.query("ROLLBACK");
      expect((await assertDemoBaseline()).ready).toBe(true);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("阶段三至完成态时间链都以数据库 resetAt 为基准且顺序合法", async () => {
    const rows = (await pool.query<{
      request_no: string; reset_at: Date; request_created_at: Date; rfq_created_at: Date; invited_at: Date; submitted_at: Date;
      deadline_at: Date; closed_at: Date; close_reason: string; revealed_at: Date; evaluation_started_at: Date | null; evaluated_at: Date | null;
      awarded_at: Date | null; pr_created_at: Date | null;
    }>(
      `SELECT sr.request_no,w.reset_at,sr.created_at AS request_created_at,r.created_at AS rfq_created_at,
              min(i.invited_at) AS invited_at,min(q.submitted_at) AS submitted_at,r.deadline_at,r.closed_at,r.close_reason,r.revealed_at,
              e.created_at AS evaluation_started_at,e.completed_at AS evaluated_at,aw.selected_at AS awarded_at,pr.created_at AS pr_created_at
         FROM sourcing_requests sr JOIN demo_workspaces w ON w.id=sr.workspace_id JOIN rfqs r ON r.request_id=sr.id
         JOIN rfq_invitations i ON i.rfq_id=r.id JOIN quotes q ON q.rfq_id=r.id
         LEFT JOIN evaluations e ON e.request_id=sr.id AND e.status='SUCCEEDED'
         LEFT JOIN awards aw ON aw.request_id=sr.id LEFT JOIN purchase_requisitions pr ON pr.request_id=sr.id
        WHERE sr.request_no IN ('SR-DEMO-0003','SR-DEMO-0004','SR-DEMO-0005')
        GROUP BY sr.request_no,w.reset_at,sr.created_at,r.created_at,r.deadline_at,r.closed_at,r.close_reason,r.revealed_at,e.created_at,e.completed_at,aw.selected_at,pr.created_at
        ORDER BY sr.request_no`,
    )).rows;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const common = [row.request_created_at, row.rfq_created_at, row.invited_at, row.submitted_at, row.closed_at, row.revealed_at];
      expect(common.every((date, index) => index === 0 || common[index - 1].getTime() <= date.getTime())).toBe(true);
      expect(row.revealed_at.getTime()).toBeLessThan(row.reset_at.getTime());
      if (row.request_no === "SR-DEMO-0005") {
        expect(row.deadline_at.getTime()).toBeGreaterThanOrEqual(row.submitted_at.getTime());
        expect(row.deadline_at.getTime()).toBeLessThanOrEqual(row.closed_at.getTime());
        expect(row.close_reason).toBe("DEADLINE_REACHED");
      } else {
        expect(row.deadline_at.toISOString()).toBe(ACTIVE_DEMO_RFQ_DEADLINE);
        expect(row.closed_at.getTime()).toBeLessThan(row.deadline_at.getTime());
        expect(row.close_reason).toBe("EARLY_STOP");
      }
      if (row.request_no !== "SR-DEMO-0003") {
        expect(row.evaluation_started_at!.getTime()).toBeGreaterThan(row.revealed_at.getTime());
        expect(row.evaluated_at!.getTime()).toBeGreaterThanOrEqual(row.evaluation_started_at!.getTime());
        expect(row.evaluated_at!.getTime()).toBeLessThan(row.reset_at.getTime());
      }
      if (row.request_no === "SR-DEMO-0005") {
        expect(row.awarded_at!.getTime()).toBeGreaterThan(row.evaluated_at!.getTime());
        expect(row.pr_created_at!.getTime()).toBeGreaterThan(row.awarded_at!.getTime());
      }
    }
  });

  it("预置评估按需求策略权重计算综合分", async () => {
    const rows = (await pool.query<{ strategy: string; total_score: string; price_score: string; delivery_score: string; match_score: string; risk_score: string }>(
      `SELECT e.strategy,ei.total_score::text,ei.price_score::text,ei.delivery_score::text,ei.match_score::text,ei.risk_score::text
         FROM evaluation_items ei JOIN evaluations e ON e.id=ei.evaluation_id ORDER BY e.strategy,ei.rank`,
    )).rows;
    expect(new Set(rows.map((row) => row.strategy))).toEqual(new Set(["BALANCED", "PRICE_FIRST"]));
    for (const row of rows) {
      const weights = row.strategy === "PRICE_FIRST"
        ? { price: .60, delivery: .15, match: .15, risk: .10 }
        : { price: .40, delivery: .25, match: .20, risk: .15 };
      const expected = Number(row.price_score) * weights.price
        + Number(row.delivery_score) * weights.delivery
        + Number(row.match_score) * weights.match
        + Number(row.risk_score) * weights.risk;
      expect(Number(row.total_score)).toBeCloseTo(expected, 1);
    }
  });

  it("OPEN 阶段采购管理 DTO 可读已提交报价的最新版本", async () => {
    const detail = await getRequestDetail("SR-DEMO-0002");
    const serialized = JSON.stringify(detail);
    expect(detail.rfq?.status).toBe("OPEN");
    expect(detail.rfq?.counts.submitted).toBe(2);
    expect(detail.revealedQuotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ totalAmount: "124500.00", version: 1 }),
      expect.objectContaining({ totalAmount: "128000.00", version: 1 }),
    ]));
    for (const forbidden of ["ciphertext", "authTag", "nonce"]) expect(serialized).not.toContain(forbidden);
  });

  it("不在固定选项内的自然语言调整会解释原因且不修改需求", async () => {
    const intentSpy = mockIntent("ADJUST_AND_SOURCE");
    try {
      const before = await getRequestDetail("SR-DEMO-0001");
      const after = await runSourcingAgent("SR-DEMO-0001", { message: "增加五轴加工精度 0.002mm" });
      expect(after.requiredDeliveryDays).toBe(before.requiredDeliveryDays);
      expect(after.qualificationCodes).toEqual(before.qualificationCodes);
      expect(after.status).toBe("SOURCING_READY");
      expect(after.candidates.map((candidate) => candidate.supplierNo)).toEqual(before.candidates.map((candidate) => candidate.supplierNo));
      expect(after.latestSourcingAgentRun).toMatchObject({ status: "SUCCEEDED", model: "deepseek-router-test", isSeeded: false });
      expect(after.agentMessages.at(-1)?.content).toContain("不在采购目录提供的");
    } finally {
      intentSpy.mockRestore();
    }
  });

  it("包含非法数量档位时拒绝整组调整且不产生部分更新", async () => {
    const intentSpy = mockIntent("ADJUST_AND_SOURCE");
    try {
      const before = await getRequestDetail("SR-DEMO-0001");
      const after = await runSourcingAgent("SR-DEMO-0001", { message: "把采购物品改为 Q235 钢板加工，数量改为 40 吨，交付调整为 7 天。" });
      expect(after).toMatchObject({
        itemCode: before.itemCode,
        specificationCode: before.specificationCode,
        quantity: before.quantity,
        requiredDeliveryDays: before.requiredDeliveryDays,
      });
      expect(after.agentMessages.at(-1)?.content).toContain("采购数量只支持");
    } finally {
      intentSpy.mockRestore();
    }
  });

  it("交付周期是候选供应商硬门槛并向 DeepSeek 传入既有对话", async () => {
    let capturedInput: CandidateAgentInput | null = null;
    const intentSpy = mockIntent("ADJUST_AND_SOURCE");
    const describeSpy = vi.spyOn(deepseek, "sourceCandidatesWithTools").mockImplementation(async (input, callbacks) => {
      return executeSuccessfulSourcingTools(input, callbacks, async (candidateInput) => {
        capturedInput = candidateInput;
        return successfulCandidateDescription(candidateInput);
      });
    });
    try {
      const detail = await runSourcingAgent("SR-DEMO-0001", { message: "将交付要求调整为 7 天内并重新寻源" });
      expect(detail.requiredDeliveryDays).toBe(7);
      expect(detail.candidates.map((candidate) => candidate.supplierNo)).toEqual(["INT-SUP-DEMO-001"]);
      expect(detail.candidates.every((candidate) => candidate.expectedDeliveryDays <= 7)).toBe(true);
      expect(capturedInput).not.toBeNull();
      expect(capturedInput!.conversation).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: "USER", content: "请根据需求匹配合适供应商。" }),
        expect.objectContaining({ role: "ASSISTANT", content: "已完成内部资源湖与外部平台供应商匹配，请确认候选名单。" }),
      ]));
      expect(capturedInput!.conversation.some((message) => message.content.includes("7 天内"))).toBe(false);
    } finally {
      intentSpy.mockRestore();
      describeSpy.mockRestore();
    }
  });

  it("自然语言可将候选精简为 Top N，并由服务端确定白名单后交给 DeepSeek", async () => {
    const intentSpy = mockIntent("ADJUST_AND_SOURCE");
    const describeSpy = vi.spyOn(deepseek, "sourceCandidatesWithTools").mockImplementation(async (input, callbacks) => executeSuccessfulSourcingTools(input, callbacks));
    try {
      const detail = await runSourcingAgent("SR-DEMO-0001", { message: "请帮我把结果精简到3家候选供应商" });
      expect(detail.status).toBe("SOURCING_READY");
      expect(detail.candidates.map((candidate) => candidate.supplierNo)).toEqual([
        "INT-SUP-DEMO-001",
        "EXT-SUP-DEMO-001",
        "EXT-SUP-DEMO-004",
      ]);
      const runId = detail.latestSourcingAgentRun!.id;
      expect(detail.agentActions.find((action) => action.agentRunId === runId && action.actionType === "PARSE_SOURCING_REQUEST")?.summary).toContain("候选供应商精简为最多 3 家");
      expect(detail.agentActions.find((action) => action.agentRunId === runId && action.actionType === "CHECK_DELIVERY")).toMatchObject({
        status: "SUCCEEDED",
        hitCount: 3,
      });
      expect(detail.agentActions.find((action) => action.agentRunId === runId && action.actionType === "VALIDATE_AGENT_OUTPUT")).toMatchObject({
        status: "SUCCEEDED",
        hitCount: 3,
      });
    } finally {
      intentSpy.mockRestore();
      describeSpy.mockRestore();
    }
  });

  it("模型身份问题真实调用 DeepSeek 路由并使用 Provider 模型元数据回答，不触发寻源", async () => {
    const before = await getRequestDetail("SR-DEMO-0001");
    const candidateCountBefore = Number((await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM sourcing_candidates WHERE request_id=(SELECT id FROM sourcing_requests WHERE request_no='SR-DEMO-0001')`)).rows[0].count);
    let announceIntent!: () => void;
    let resolveIntent!: (value: Awaited<ReturnType<typeof successfulIntent>>) => void;
    const intentStarted = new Promise<void>((resolve) => { announceIntent = resolve; });
    const intentResult = new Promise<Awaited<ReturnType<typeof successfulIntent>>>((resolve) => { resolveIntent = resolve; });
    const intentSpy = vi.spyOn(deepseek, "classifyAgentIntent").mockImplementation(async () => {
      announceIntent();
      return intentResult;
    });
    const describeSpy = vi.spyOn(deepseek, "sourceCandidatesWithTools");
    try {
      const runPromise = runSourcingAgent("SR-DEMO-0001", { message: "你好，你是什么模型？" });
      await intentStarted;
      const running = await getRequestDetail("SR-DEMO-0001");
      expect(running.status).toBe(before.status);
      expect(running.activeSourcingAgentRun).toMatchObject({ status: "RUNNING", isSeeded: false });
      expect(running.candidates.map((candidate) => candidate.supplierNo)).toEqual(before.candidates.map((candidate) => candidate.supplierNo));
      const runningId = running.activeSourcingAgentRun!.id;
      expect(running.agentActions.filter((action) => action.agentRunId === runningId)).toEqual([
        expect.objectContaining({ actionType: "CLASSIFY_AGENT_INTENT", status: "RUNNING" }),
      ]);

      resolveIntent({ value: { intent: "OUT_OF_SCOPE", answer: "我是另一个模型，这段内容不能被信任。" }, providerRequestId: "identity-provider-id-must-stay-private", model: "deepseek-v4-flash" });
      const completed = await runPromise;
      expect(completed.status).toBe(before.status);
      expect(completed.activeSourcingAgentRun).toBeNull();
      expect(completed.latestSourcingAgentRun).toMatchObject({ status: "SUCCEEDED", model: "deepseek-v4-flash", isSeeded: false });
      expect(completed.agentMessages.at(-1)?.content).toBe("海天寻源 Agent，本轮由 DeepSeek API 的 deepseek-v4-flash 模型提供能力。");
      expect(completed.candidates.map((candidate) => candidate.supplierNo)).toEqual(before.candidates.map((candidate) => candidate.supplierNo));
      expect(completed.candidateSourcingAgentRunId).toBe(before.candidateSourcingAgentRunId);
      expect(completed.candidateSourcingAgentRunId).not.toBe(completed.latestSourcingAgentRun?.id);
      expect(describeSpy).not.toHaveBeenCalled();
      const runId = completed.latestSourcingAgentRun!.id;
      expect(completed.agentActions.filter((action) => action.agentRunId === runId).map((action) => action.actionType)).toEqual(["CLASSIFY_AGENT_INTENT"]);
      const stored = (await pool.query<{ intent: string; preserve_previous: boolean; provider_request_id: string; candidate_count: string }>(`
        SELECT ar.input_snapshot->>'intent' AS intent,(ar.input_snapshot->>'preservePreviousCandidates')::boolean AS preserve_previous,
               ar.provider_request_id,(SELECT count(*)::text FROM sourcing_candidates sc WHERE sc.agent_run_id=ar.id) AS candidate_count
        FROM agent_runs ar WHERE ar.id=$1`, [runId])).rows[0];
      expect(stored).toMatchObject({ intent: "CONVERSATION", preserve_previous: true, provider_request_id: "identity-provider-id-must-stay-private", candidate_count: "0" });
      expect(Number((await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM sourcing_candidates WHERE request_id=(SELECT id FROM sourcing_requests WHERE request_no='SR-DEMO-0001')`)).rows[0].count)).toBe(candidateCountBefore);
      expect(JSON.stringify(completed)).not.toContain("identity-provider-id-must-stay-private");

      const published = await publishRfq("SR-DEMO-0001");
      expect(published.status).toBe("BIDDING_OPEN");
      expect(published.rfq?.counts.invited).toBe(before.candidates.length);
      expect(published.rfq?.deadlineAt).toBe(ACTIVE_DEMO_RFQ_DEADLINE);
    } finally {
      intentSpy.mockRestore();
      describeSpy.mockRestore();
    }
  });

  it("越界对话只保存真实 DeepSeek 答复，不修改采购条件或候选", async () => {
    const before = await getRequestDetail("SR-DEMO-0001");
    const intentSpy = mockIntent("OUT_OF_SCOPE", "我只能协助采购寻源相关问题。");
    const describeSpy = vi.spyOn(deepseek, "sourceCandidatesWithTools");
    try {
      const completed = await runSourcingAgent("SR-DEMO-0001", { message: "帮我写一首与采购无关的诗" });
      expect(completed).toMatchObject({
        status: before.status,
        itemCode: before.itemCode,
        specification: before.specification,
        quantity: before.quantity,
        qualificationCodes: before.qualificationCodes,
        requiredDeliveryDays: before.requiredDeliveryDays,
      });
      expect(completed.agentMessages.at(-1)?.content).toBe("我只能协助采购寻源相关问题。");
      expect(completed.candidates.map((candidate) => candidate.supplierNo)).toEqual(before.candidates.map((candidate) => candidate.supplierNo));
      expect(describeSpy).not.toHaveBeenCalled();
      const runId = completed.latestSourcingAgentRun!.id;
      const stored = (await pool.query<{ intent: string; preserve_previous: boolean }>(`SELECT input_snapshot->>'intent' AS intent,(input_snapshot->>'preservePreviousCandidates')::boolean AS preserve_previous FROM agent_runs WHERE id=$1`, [runId])).rows[0];
      expect(stored).toEqual({ intent: "OUT_OF_SCOPE", preserve_previous: true });
      expect(completed.agentActions.filter((action) => action.agentRunId === runId).map((action) => action.actionType)).toEqual(["CLASSIFY_AGENT_INTENT"]);
    } finally {
      intentSpy.mockRestore();
      describeSpy.mockRestore();
    }
  });

  it("寻源运行中按真实检查点暴露步骤并隐藏上一轮候选，完成后只展示本轮结果", async () => {
    let capturedInput: unknown;
    let announceDeepSeek!: () => void;
    let resolveDeepSeek!: (value: Awaited<ReturnType<typeof successfulCandidateDescription>>) => void;
    const deepSeekStarted = new Promise<void>((resolve) => { announceDeepSeek = resolve; });
    const deepSeekResult = new Promise<Awaited<ReturnType<typeof successfulCandidateDescription>>>((resolve) => { resolveDeepSeek = resolve; });
    const intentSpy = mockIntent("RUN_SOURCING");
    const describeSpy = vi.spyOn(deepseek, "sourceCandidatesWithTools").mockImplementation(async (input, callbacks) => {
      return executeSuccessfulSourcingTools(input, callbacks, async (candidateInput) => {
        capturedInput = candidateInput;
        announceDeepSeek();
        return deepSeekResult;
      });
    });
    try {
      const runPromise = runSourcingAgent("SR-DEMO-0001", { message: "请按当前固定条件重新执行真实寻源" });
      await deepSeekStarted;

      const running = await getRequestDetail("SR-DEMO-0001");
      expect(running.activeSourcingAgentRun).toMatchObject({ status: "RUNNING", isSeeded: false });
      expect(running.latestSourcingAgentRun?.id).toBe(running.activeSourcingAgentRun?.id);
      expect(running.candidates).toEqual([]);
      const runId = running.activeSourcingAgentRun!.id as string;
      const runningActions = running.agentActions.filter((action) => action.agentRunId === runId);
      expect(runningActions.map((action) => action.actionType)).toEqual([
        "CLASSIFY_AGENT_INTENT",
        "PARSE_SOURCING_REQUEST",
        "QUERY_INTERNAL_SUPPLIERS",
        "QUERY_1688_SUPPLIERS",
        "QUERY_QICHACHA_SUPPLIERS",
        "QUERY_INDUSTRY_PLATFORM_SUPPLIERS",
        "CHECK_QUALIFICATION",
        "CHECK_DELIVERY",
        "ANALYZE_WITH_DEEPSEEK",
      ]);
      expect(runningActions.slice(0, -1).every((action) => action.status === "SUCCEEDED" && action.finishedAt)).toBe(true);
      expect(runningActions.at(-1)).toMatchObject({ status: "RUNNING", isSeeded: false });
      expect(running.agentMessages.at(-1)).toMatchObject({ agentRunId: runId, role: "USER", isSeeded: false });

      resolveDeepSeek(await successfulCandidateDescription(capturedInput));
      const completed = await runPromise;
      expect(completed.activeSourcingAgentRun).toBeNull();
      expect(completed.latestSourcingAgentRun).toMatchObject({ id: runId, status: "SUCCEEDED", model: "deepseek-test", isSeeded: false, errorCode: null, errorMessage: null });
      expect(completed.candidateSourcingAgentRunId).toBe(runId);
      expect(completed.candidates.length).toBeGreaterThan(0);
      const completedActions = completed.agentActions.filter((action) => action.agentRunId === runId);
      expect(completedActions.map((action) => action.actionType)).toEqual([
        "CLASSIFY_AGENT_INTENT",
        "PARSE_SOURCING_REQUEST",
        "QUERY_INTERNAL_SUPPLIERS",
        "QUERY_1688_SUPPLIERS",
        "QUERY_QICHACHA_SUPPLIERS",
        "QUERY_INDUSTRY_PLATFORM_SUPPLIERS",
        "CHECK_QUALIFICATION",
        "CHECK_DELIVERY",
        "ANALYZE_WITH_DEEPSEEK",
        "VALIDATE_AGENT_OUTPUT",
        "SAVE_CANDIDATES",
      ]);
      expect(completedActions.every((action) => action.status === "SUCCEEDED" && action.finishedAt && !action.isSeeded)).toBe(true);
      expect(completedActions.find((action) => action.actionType === "QUERY_INTERNAL_SUPPLIERS")?.hitCount).toBeGreaterThan(0);
      expect(completedActions.find((action) => action.actionType === "QUERY_1688_SUPPLIERS")?.hitCount).toBeGreaterThan(0);
      expect(completed.agentMessages.at(-1)).toMatchObject({ agentRunId: runId, role: "ASSISTANT", isSeeded: false });
      expect(JSON.stringify(completed)).not.toContain("test-provider-request");
      expect(JSON.stringify(completed)).not.toContain("test-routing-provider-request");
      const storedRun = (await pool.query<{ intent: string; preserve_previous: boolean; routing_provider_request_id: string; provider_request_id: string }>(`
        SELECT input_snapshot->>'intent' AS intent,(input_snapshot->>'preservePreviousCandidates')::boolean AS preserve_previous,
               input_snapshot->>'routingProviderRequestId' AS routing_provider_request_id,provider_request_id
        FROM agent_runs WHERE id=$1`, [runId])).rows[0];
      expect(storedRun).toEqual({ intent: "RUN_SOURCING", preserve_previous: false, routing_provider_request_id: "test-routing-provider-request", provider_request_id: "test-provider-request" });
    } finally {
      intentSpy.mockRestore();
      describeSpy.mockRestore();
    }
  });

  it("DeepSeek 白名单校验失败时记录失败步骤并恢复上一版可用候选", async () => {
    const before = await getRequestDetail("SR-DEMO-0001");
    const intentSpy = mockIntent("RUN_SOURCING");
    const describeSpy = vi.spyOn(deepseek, "sourceCandidatesWithTools").mockImplementation(async (input, callbacks) => executeSuccessfulSourcingTools(
      input,
      callbacks,
      async () => ({
        value: { summary: "非法候选", candidates: [{ supplierNo: "SUPPLIER-NOT-ALLOWED", recommendation: "非法", riskSummary: "非法" }] },
        providerRequestId: "must-not-be-exposed",
        model: "deepseek-test",
      }),
    ));
    try {
      await expect(runSourcingAgent("SR-DEMO-0001", { message: "重新寻源并校验输出白名单" })).rejects.toMatchObject({ code: "AGENT_OUTPUT_INVALID" });
      const detail = await getRequestDetail("SR-DEMO-0001");
      expect(detail.activeSourcingAgentRun).toBeNull();
      expect(detail.latestSourcingAgentRun).toMatchObject({ status: "FAILED", errorCode: "AGENT_OUTPUT_INVALID", isSeeded: false });
      expect(detail.status).toBe("SOURCING_READY");
      expect(detail.candidates.map((candidate) => candidate.supplierNo)).toEqual(before.candidates.map((candidate) => candidate.supplierNo));
      const runId = detail.latestSourcingAgentRun!.id;
      expect(detail.agentActions.find((action) => action.agentRunId === runId && action.actionType === "VALIDATE_AGENT_OUTPUT")).toMatchObject({ status: "FAILED" });
      expect(detail.agentActions.some((action) => action.agentRunId === runId && action.actionType === "SAVE_CANDIDATES")).toBe(false);
      expect(JSON.stringify(detail)).not.toContain("must-not-be-exposed");
      const published = await publishRfq("SR-DEMO-0001");
      expect(published.status).toBe("BIDDING_OPEN");
      expect(published.rfq?.counts.invited).toBe(before.candidates.length);
    } finally {
      intentSpy.mockRestore();
      describeSpy.mockRestore();
    }
  });

  it("Agent 只用目录白名单原子调整物品关联规格、数量及全部固定策略字段", async () => {
    let capturedInput: CandidateAgentInput | null = null;
    const intentSpy = mockIntent("ADJUST_AND_SOURCE");
    const describeSpy = vi.spyOn(deepseek, "sourceCandidatesWithTools").mockImplementation(async (input, callbacks) => {
      return executeSuccessfulSourcingTools(input, callbacks, async (candidateInput) => {
        capturedInput = candidateInput;
        return successfulCandidateDescription(candidateInput);
      });
    });
    try {
      const detail = await runSourcingAgent("SR-DEMO-0001", {
        message: "把采购物品改为 Q235 钢板加工，规格选择 Q235B、12mm、按图切割，数量改为大批量 50 吨，取消资质要求，交期调整为 15 天，报价截止改为 30 分钟，评估采用价格优先。",
      });
      expect(detail).toMatchObject({
        itemCode: "ITEM-PLATE-Q235",
        itemName: "Q235 钢板加工",
        specificationCode: "PLATE-Q235B-12",
        specification: "Q235B、12mm、按图切割",
        quantity: 50,
        unit: "吨",
        qualificationCodes: ["NONE"],
        requiredDeliveryDays: 15,
        quoteDurationMinutes: 30,
        evaluationStrategy: "PRICE_FIRST",
        status: "SOURCING_READY",
      });
      expect(capturedInput!.request).toMatchObject({
        itemCode: "ITEM-PLATE-Q235",
        specificationCode: "PLATE-Q235B-12",
        quantity: 50,
        unit: "吨",
        qualificationCodes: ["NONE"],
        requiredDeliveryDays: 15,
        quoteDurationMinutes: 30,
        evaluationStrategy: "PRICE_FIRST",
      });
      expect(detail.agentActions.some((action) => action.actionType === "APPLY_FIXED_OPTIONS" && action.summary.includes("采购物品调整为 Q235 钢板加工"))).toBe(true);
    } finally {
      intentSpy.mockRestore();
      describeSpy.mockRestore();
    }
  });

  it("AES-256-GCM 幂等快照工具使用 AAD 并拒绝错误上下文", () => {
    const payload = { totalAmount: "123456.78", deliveryDays: 13, remark: "幂等快照测试" };
    const aad = quoteAad("workspace", "rfq", "supplier", "quote");
    const sealed = sealQuote(payload, aad);
    expect(openQuote(sealed, aad)).toEqual(payload);
    expect(() => openQuote(sealed, quoteAad("workspace", "rfq", "other", "quote"))).toThrow();
  });

  it("外部供应商直接注册后沿用 E004 并只看到受邀询价", async () => {
    const registered = await registerExternalSupplier("EXT-SUP-DEMO-004", { contactName: "测试联系人", email: "e004-test@example.test", password: "DemoPass123!" });
    expect(registered.supplier.supplierNo).toBe("EXT-SUP-DEMO-004");
    const supplierCount = await pool.query(`SELECT count(*)::int AS count FROM suppliers WHERE supplier_no='EXT-SUP-DEMO-004'`);
    expect(supplierCount.rows[0].count).toBe(1);
  });

  it("外部供应商首次报价后可看竞争力并且仅能重新报价一次", async () => {
    await registerExternalSupplier("EXT-SUP-DEMO-004", { contactName: "测试联系人", email: "e004-test@example.test", password: "DemoPass123!" });
    const first = await submitSupplierQuote("EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002", { totalAmount: "123456.78", deliveryDays: 13, remark: "首次报价" });
    expect(first).toMatchObject({ sealed: false, editable: true, canRequote: true, remainingRequotes: 1 });
    expect(first.quote).toMatchObject({ totalAmount: "123456.78", version: 1, competitiveness: "HIGH" });
    const second = await submitSupplierQuote("EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002", { totalAmount: "126800.00", deliveryDays: 12, remark: "唯一一次重新报价" });
    expect(second).toMatchObject({ sealed: false, editable: false, canRequote: false, remainingRequotes: 0 });
    expect(second.quote).toMatchObject({ totalAmount: "126800.00", version: 2 });
    expect(second.versions).toHaveLength(2);
    expect(second.versions.map((version) => version.remark)).toEqual(["首次报价", "唯一一次重新报价"]);
    await expect(submitSupplierQuote("EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002", { totalAmount: "120000.00", deliveryDays: 10, remark: "第三次" }))
      .rejects.toMatchObject({ code: "QUOTE_ALREADY_SUBMITTED" } satisfies Partial<ApiError>);
  });

  it("内部供应商仍只能提交一版报价", async () => {
    const first = await submitSupplierQuote("INT-SUP-DEMO-003", "INTERNAL", "RFQ-DEMO-0002", { totalAmount: "127000.00", deliveryDays: 12, remark: "内部首次" });
    expect(first).toMatchObject({ sealed: false, canRequote: false, remainingRequotes: 0 });
    expect(first.quote).toMatchObject({ version: 1, competitiveness: null });
    await expect(submitSupplierQuote("INT-SUP-DEMO-003", "INTERNAL", "RFQ-DEMO-0002", { totalAmount: "126000.00", deliveryDays: 11, remark: "内部二次" }))
      .rejects.toMatchObject({ code: "QUOTE_ALREADY_SUBMITTED" } satisfies Partial<ApiError>);
  });

  it("一键模拟只补齐剩余邀请，生成各不相同的首次报价并向采购端展示", async () => {
    const existing = (await pool.query<{ quote_no: string; payload_sha256: string }>(`
      SELECT q.quote_no,q.payload_sha256 FROM quotes q JOIN rfqs r ON r.id=q.rfq_id
       WHERE r.rfq_no='RFQ-DEMO-0002' ORDER BY q.quote_no`)).rows;

    const result = await simulateRemainingQuotes("RFQ-DEMO-0002");
    expect(result).toMatchObject({ simulatedCount: 4, registeredExternalCount: 1, submittedCount: 6, invitedCount: 6 });
    expect(result.detail.rfq?.counts).toMatchObject({ invited: 6, submitted: 6, viewed: 6, registeredExternal: 3 });
    expect(result.detail.revealedQuotes).toHaveLength(6);

    const rows = (await pool.query<{
      quote_no: string; supplier_no: string; is_seeded: boolean; is_simulated: boolean;
      payload_sha256: string; total_amount: string; delivery_days: number; remark: string; version_no: number;
    }>(`
      SELECT q.quote_no,s.supplier_no,q.is_seeded,version.is_simulated,version.payload_sha256,
             version.total_amount::text,version.delivery_days,version.remark,version.version_no
        FROM quotes q JOIN rfqs r ON r.id=q.rfq_id JOIN suppliers s ON s.id=q.supplier_id
        JOIN quote_versions version ON version.quote_id=q.id AND version.version_no=q.current_version
       WHERE r.rfq_no='RFQ-DEMO-0002' ORDER BY version.submitted_at,q.id`)).rows;
    expect(rows).toHaveLength(6);
    const simulated = rows.filter((row) => row.is_simulated);
    expect(simulated).toHaveLength(4);
    expect(simulated.every((row) => row.version_no === 1)).toBe(true);
    expect(new Set(simulated.map((row) => row.total_amount)).size).toBe(4);
    expect(new Set(simulated.map((row) => row.remark)).size).toBe(4);
    expect(new Set(simulated.map((row) => row.payload_sha256)).size).toBe(4);
    simulated.forEach((row) => expect(quoteSchema.safeParse({ totalAmount: row.total_amount, deliveryDays: row.delivery_days, remark: row.remark }).success).toBe(true));
    const managementSnapshot = JSON.stringify(result.detail);
    simulated.forEach((row) => {
      expect(managementSnapshot).toContain(row.total_amount);
      expect(managementSnapshot).toContain(row.remark);
    });
    expect((await pool.query(`SELECT account.id FROM external_supplier_accounts account JOIN suppliers s ON s.id=account.supplier_id WHERE s.supplier_no='EXT-SUP-DEMO-004'`)).rowCount).toBe(1);
    const simulatedViewEvents = await pool.query<{ simulated: boolean }>(`
      SELECT (event_data->>'simulated')::boolean AS simulated
        FROM workflow_events event
        JOIN sourcing_requests request ON request.id=event.request_id
       WHERE request.request_no='SR-DEMO-0002'
         AND event.event_type='RFQ_VIEWED'
         AND event.actor='EXT-SUP-DEMO-004'`);
    expect(simulatedViewEvents.rows).toEqual([{ simulated: true }]);
    const ownQuote = await getOwnSupplierQuote("EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002");
    expect(ownQuote).toMatchObject({ canRequote: true, remainingRequotes: 1 });
    expect(simulated.some((row) => row.total_amount === ownQuote.quote.totalAmount && row.remark === ownQuote.quote.remark)).toBe(true);

    const afterExisting = (await pool.query<{ quote_no: string; payload_sha256: string }>(`
      SELECT q.quote_no,q.payload_sha256
        FROM quotes q JOIN rfqs r ON r.id=q.rfq_id
       WHERE r.rfq_no='RFQ-DEMO-0002' AND q.is_seeded=true
       ORDER BY q.quote_no`)).rows;
    expect(afterExisting).toEqual(existing);

    const closed = await closeRfq("RFQ-DEMO-0002", "EARLY_STOP");
    expect(closed.status).toBe("EVALUATION_PENDING");
    expect(closed.revealedQuotes).toHaveLength(6);
    expect(closed.revealedQuotes?.every((quote) => quote.version === 1)).toBe(true);
  });

  it("重复一键模拟保持幂等，已关闭询价拒绝继续补报价", async () => {
    const first = await simulateRemainingQuotes("RFQ-DEMO-0002");
    const hashes = (await pool.query<{ quote_no: string; payload_sha256: string }>(`
      SELECT q.quote_no,q.payload_sha256 FROM quotes q JOIN rfqs r ON r.id=q.rfq_id
       WHERE r.rfq_no='RFQ-DEMO-0002' ORDER BY q.quote_no`)).rows;
    const second = await simulateRemainingQuotes("RFQ-DEMO-0002");
    const afterReplay = (await pool.query<{ quote_no: string; payload_sha256: string }>(`
      SELECT q.quote_no,q.payload_sha256 FROM quotes q JOIN rfqs r ON r.id=q.rfq_id
       WHERE r.rfq_no='RFQ-DEMO-0002' ORDER BY q.quote_no`)).rows;
    expect(first.simulatedCount).toBe(4);
    expect(second).toMatchObject({ simulatedCount: 0, submittedCount: 6, invitedCount: 6 });
    expect(afterReplay).toEqual(hashes);

    await closeRfq("RFQ-DEMO-0002", "EARLY_STOP");
    await expect(simulateRemainingQuotes("RFQ-DEMO-0002"))
      .rejects.toMatchObject({ code: "RFQ_CLOSED" } satisfies Partial<ApiError>);
    expect((await pool.query(`SELECT q.id FROM quotes q JOIN rfqs r ON r.id=q.rfq_id WHERE r.rfq_no='RFQ-DEMO-0002'`)).rowCount).toBe(6);
  });

  it("一键模拟与停止报价并发时不会留下缺失最新版本的报价", async () => {
    const [simulationResult, closeResult] = await Promise.allSettled([
      simulateRemainingQuotes("RFQ-DEMO-0002"),
      closeRfq("RFQ-DEMO-0002", "EARLY_STOP"),
    ]);
    expect(closeResult.status).toBe("fulfilled");
    if (simulationResult.status === "rejected") {
      expect(simulationResult.reason).toMatchObject({ code: "RFQ_CLOSED" } satisfies Partial<ApiError>);
    }
    const final = (await pool.query<{ status: string; quotes: number; versioned: number }>(`
      SELECT r.status,count(DISTINCT q.id)::int AS quotes,count(DISTINCT details.quote_id)::int AS versioned
        FROM rfqs r
        LEFT JOIN quotes q ON q.rfq_id=r.id
        LEFT JOIN quote_versions details ON details.quote_id=q.id AND details.version_no=q.current_version
       WHERE r.rfq_no='RFQ-DEMO-0002'
       GROUP BY r.id`)).rows[0];
    expect(final.status).toBe("CLOSED");
    expect(final.quotes).toBe(simulationResult.status === "fulfilled" ? 6 : 2);
    expect(final.versioned).toBe(final.quotes);
  });

  it("一键模拟与幂等快照使用同一事务，失败回滚且重放保留首次结果", async () => {
    const scope = "/rfqs/RFQ-DEMO-0002/simulate-remaining-quotes";
    await expect(withIdempotency(
      scope,
      "buyer",
      "simulate-rollback-test",
      {},
      async (client) => {
        expect(client).toBeDefined();
        await simulateRemainingQuotesInTransaction(client!, "RFQ-DEMO-0002");
        throw new Error("模拟幂等快照写入前失败");
      },
      { workInTransaction: true },
    )).rejects.toThrow("模拟幂等快照写入前失败");
    expect((await pool.query(`SELECT q.id FROM quotes q JOIN rfqs r ON r.id=q.rfq_id WHERE r.rfq_no='RFQ-DEMO-0002'`)).rowCount).toBe(2);
    expect((await pool.query(`SELECT account.id FROM external_supplier_accounts account JOIN suppliers supplier ON supplier.id=account.supplier_id WHERE supplier.supplier_no='EXT-SUP-DEMO-004'`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT id FROM idempotency_records WHERE scope=$1 AND actor='buyer' AND idempotency_key='simulate-rollback-test'`, [scope])).rowCount).toBe(0);

    let executions = 0;
    const invoke = () => withIdempotency(
      scope,
      "buyer",
      "simulate-atomic-replay-test",
      {},
      async (client) => {
        expect(client).toBeDefined();
        executions += 1;
        return simulateRemainingQuotesInTransaction(client!, "RFQ-DEMO-0002");
      },
      { workInTransaction: true },
    );
    const first = await invoke();
    expect(first.detail.rfq).toMatchObject({ status: "OPEN", counts: { invited: 6, submitted: 6 } });
    await closeRfq("RFQ-DEMO-0002", "EARLY_STOP");
    const replay = await invoke();
    expect(first).toMatchObject({ simulatedCount: 4, submittedCount: 6, invitedCount: 6 });
    expect(replay).toEqual(first);
    expect(executions).toBe(1);
    expect((await getRequestDetail("SR-DEMO-0002")).rfq?.status).toBe("CLOSED");
    expect((await pool.query(`SELECT q.id FROM quotes q JOIN rfqs r ON r.id=q.rfq_id WHERE r.rfq_no='RFQ-DEMO-0002'`)).rowCount).toBe(6);
  });

  it("一键模拟拒绝报价、提交时间与版本不完整的已有记录", async () => {
    await pool.query(`
      DELETE FROM quote_versions
       WHERE quote_id=(
         SELECT q.id
           FROM quotes q JOIN rfqs r ON r.id=q.rfq_id
          WHERE r.rfq_no='RFQ-DEMO-0002'
          ORDER BY q.submitted_at
          LIMIT 1
       )`);
    await expect(simulateRemainingQuotes("RFQ-DEMO-0002"))
      .rejects.toMatchObject({ code: "STALE_VERSION" } satisfies Partial<ApiError>);
    expect((await pool.query(`SELECT q.id FROM quotes q JOIN rfqs r ON r.id=q.rfq_id WHERE r.rfq_no='RFQ-DEMO-0002'`)).rowCount).toBe(2);
    expect((await pool.query(`SELECT account.id FROM external_supplier_accounts account JOIN suppliers supplier ON supplier.id=account.supplier_id WHERE supplier.supplier_no='EXT-SUP-DEMO-004'`)).rowCount).toBe(0);
  });

  it("一键模拟以全部邀请为准，缺少能力记录时原子拒绝而不漏算", async () => {
    await pool.query(`
      DELETE FROM supplier_capabilities capability
       USING suppliers supplier
       WHERE capability.supplier_id=supplier.id
         AND supplier.supplier_no='INT-SUP-DEMO-003'
         AND capability.item_code='ITEM-PLATE-Q235'`);
    expect((await pool.query(`SELECT invitation.id FROM rfq_invitations invitation JOIN rfqs rfq ON rfq.id=invitation.rfq_id WHERE rfq.rfq_no='RFQ-DEMO-0002'`)).rowCount).toBe(6);
    await expect(simulateRemainingQuotes("RFQ-DEMO-0002"))
      .rejects.toMatchObject({ code: "STALE_VERSION" } satisfies Partial<ApiError>);
    expect((await pool.query(`SELECT q.id FROM quotes q JOIN rfqs r ON r.id=q.rfq_id WHERE r.rfq_no='RFQ-DEMO-0002'`)).rowCount).toBe(2);
    expect((await pool.query(`SELECT account.id FROM external_supplier_accounts account JOIN suppliers supplier ON supplier.id=account.supplier_id WHERE supplier.supplier_no='EXT-SUP-DEMO-004'`)).rowCount).toBe(0);
  });

  it("报价编号由报价主键稳定派生且不会因其他 RFQ 并发计数冲突", async () => {
    const result = await simulateRemainingQuotes("RFQ-DEMO-0002");
    expect(result.simulatedCount).toBe(4);
    const liveQuotes = (await pool.query<{ id: string; quote_no: string }>(`
      SELECT q.id,q.quote_no
        FROM quotes q JOIN rfqs r ON r.id=q.rfq_id
       WHERE r.rfq_no='RFQ-DEMO-0002' AND q.is_seeded=false
       ORDER BY q.quote_no`)).rows;
    expect(liveQuotes).toHaveLength(4);
    expect(new Set(liveQuotes.map((quote) => quote.quote_no)).size).toBe(liveQuotes.length);
    for (const quote of liveQuotes) {
      expect(quote.quote_no).toBe(`QT-LIVE-${quote.id.replaceAll("-", "").toUpperCase()}`);
    }
  });

  it("一键模拟遇到已过截止时间的 OPEN 询价会原子关停并拒绝继续补报价", async () => {
    await pool.query(`UPDATE rfqs SET deadline_at=clock_timestamp()-interval '1 minute' WHERE rfq_no='RFQ-DEMO-0002'`);
    await expect(simulateRemainingQuotes("RFQ-DEMO-0002"))
      .rejects.toMatchObject({ code: "RFQ_CLOSED" } satisfies Partial<ApiError>);
    const state = (await pool.query<{ status: string; close_reason: string; quotes: number; versioned: number }>(`
      SELECT r.status,r.close_reason,count(DISTINCT q.id)::int AS quotes,count(DISTINCT version.quote_id)::int AS versioned
        FROM rfqs r
        LEFT JOIN quotes q ON q.rfq_id=r.id
        LEFT JOIN quote_versions version ON version.quote_id=q.id AND version.version_no=q.current_version
       WHERE r.rfq_no='RFQ-DEMO-0002'
       GROUP BY r.id`)).rows[0];
    expect(state).toEqual({ status: "CLOSED", close_reason: "DEADLINE_REACHED", quotes: 2, versioned: 2 });
  });

  it("核心报价边界拒绝零金额", async () => {
    await registerExternalSupplier("EXT-SUP-DEMO-004", { contactName: "测试联系人", email: "e004-test@example.test", password: "DemoPass123!" });
    await expect(submitSupplierQuote("EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002", { totalAmount: "0.00", deliveryDays: 13, remark: "非法零金额" }))
      .rejects.toMatchObject({ name: "ZodError" });
  });

  it("报价版本与幂等快照原子提交，同 Key 重放不增加版本", async () => {
    await registerExternalSupplier("EXT-SUP-DEMO-004", { contactName: "测试联系人", email: "e004-test@example.test", password: "DemoPass123!" });
    const input = { totalAmount: "123456.78", deliveryDays: 13, remark: "幂等首次报价" };
    const scope = "/external/rfqs/RFQ-DEMO-0002/quotes";
    const key = "quote-v1-idempotency-test";
    const invoke = () => withIdempotency(
      scope,
      "EXT-SUP-DEMO-004",
      key,
      input,
      (client) => submitSupplierQuoteInTransaction(client!, "EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002", input),
      { sealResponse: true, workInTransaction: true },
    );
    const first = await invoke();
    const stored = await pool.query<{ response_snapshot: unknown }>(`SELECT response_snapshot FROM idempotency_records WHERE scope=$1 AND actor=$2 AND idempotency_key=$3`, [scope, "EXT-SUP-DEMO-004", key]);
    expect(stored.rows[0].response_snapshot).toMatchObject({ format: "aes-256-gcm+json" });
    expect(JSON.stringify(stored.rows[0].response_snapshot)).not.toContain(input.totalAmount);
    expect(JSON.stringify(stored.rows[0].response_snapshot)).not.toContain(input.remark);
    const replay = await invoke();
    expect(replay).toEqual(first);
    expect(replay.quote.version).toBe(1);
    expect((await pool.query(`SELECT count(*)::int AS count FROM quote_versions version JOIN quotes quote ON quote.id=version.quote_id JOIN suppliers supplier ON supplier.id=quote.supplier_id WHERE supplier.supplier_no='EXT-SUP-DEMO-004' AND quote.rfq_id=(SELECT id FROM rfqs WHERE rfq_no='RFQ-DEMO-0002')`)).rows[0].count).toBe(1);
  });

  it("报价业务成功后幂等快照失败会整体回滚，不会误消耗重报机会", async () => {
    await registerExternalSupplier("EXT-SUP-DEMO-004", { contactName: "测试联系人", email: "e004-test@example.test", password: "DemoPass123!" });
    const input = { totalAmount: "123456.78", deliveryDays: 13, remark: "应当回滚" };
    await expect(withIdempotency(
      "/external/rfqs/RFQ-DEMO-0002/quotes",
      "EXT-SUP-DEMO-004",
      "quote-atomic-rollback-test",
      input,
      async (client) => {
        await submitSupplierQuoteInTransaction(client!, "EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002", input);
        throw new Error("模拟幂等快照写入前失败");
      },
      { sealResponse: true, workInTransaction: true },
    )).rejects.toThrow("模拟幂等快照写入前失败");
    expect((await pool.query(`SELECT count(*)::int AS count FROM quotes quote JOIN suppliers supplier ON supplier.id=quote.supplier_id JOIN rfqs rfq ON rfq.id=quote.rfq_id WHERE supplier.supplier_no='EXT-SUP-DEMO-004' AND rfq.rfq_no='RFQ-DEMO-0002'`)).rows[0].count).toBe(0);
    const retry = await withIdempotency(
      "/external/rfqs/RFQ-DEMO-0002/quotes",
      "EXT-SUP-DEMO-004",
      "quote-atomic-rollback-test",
      input,
      (client) => submitSupplierQuoteInTransaction(client!, "EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002", input),
      { sealResponse: true, workInTransaction: true },
    );
    expect(retry.quote.version).toBe(1);
    expect(retry.canRequote).toBe(true);
  });

  it("外部报价使用同一幂等 Key 并发提交只生成一个版本", async () => {
    await registerExternalSupplier("EXT-SUP-DEMO-004", { contactName: "并发测试", email: "quote-concurrent@example.test", password: "DemoPass123!" });
    const scope = "/external/rfqs/RFQ-DEMO-0002/quotes";
    const input = { totalAmount: "122800.00", deliveryDays: 11, remark: "同 Key 并发" };
    const invoke = () => withIdempotency(
      scope,
      "EXT-SUP-DEMO-004",
      "quote-concurrent-same-key",
      input,
      (client) => submitSupplierQuoteInTransaction(client!, "EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002", input),
      { sealResponse: true, workInTransaction: true },
    );
    const [first, second] = await Promise.all([invoke(), invoke()]);
    expect(second).toEqual(first);
    expect(first.quote.version).toBe(1);
    expect((await pool.query(`SELECT count(*)::int AS count FROM quote_versions version JOIN quotes quote ON quote.id=version.quote_id JOIN suppliers supplier ON supplier.id=quote.supplier_id WHERE supplier.supplier_no='EXT-SUP-DEMO-004' AND quote.rfq_id=(SELECT id FROM rfqs WHERE rfq_no='RFQ-DEMO-0002')`)).rows[0].count).toBe(1);
  });

  it("同一幂等 Key 的并发请求只执行业务逻辑一次", async () => {
    let executions = 0;
    const work = async () => {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { execution: executions };
    };
    const [first, second] = await Promise.all([
      withIdempotency("/concurrency-test", "buyer", "same-key", { value: 1 }, work),
      withIdempotency("/concurrency-test", "buyer", "same-key", { value: 1 }, work),
    ]);
    expect(executions).toBe(1);
    expect(first).toEqual(second);
  });

  it("重置与幂等快照原子提交且重复重置请求不会再次执行", async () => {
    const body = { confirm: "RESET" };
    const options = { allowMissingWorkspace: true, workspaceLifecycle: "exclusive" as const, workInTransaction: true };
    const first = await withIdempotency(
      "/demo/reset",
      "buyer",
      "atomic-reset-idempotency-test",
      body,
      (client) => resetDemo(client),
      options,
    );
    const afterFirst = (await pool.query<{ id: string; revision: string; reset_at: Date }>(
      `SELECT id,revision::text,reset_at FROM demo_workspaces WHERE code='DEMO-DEFAULT'`,
    )).rows[0];
    let replayExecuted = false;
    const replay = await withIdempotency(
      "/demo/reset",
      "buyer",
      "atomic-reset-idempotency-test",
      body,
      async () => {
        replayExecuted = true;
        throw new Error("重复重置请求不应再次执行");
      },
      options,
    );
    const afterReplay = (await pool.query<{ id: string; revision: string; reset_at: Date }>(
      `SELECT id,revision::text,reset_at FROM demo_workspaces WHERE code='DEMO-DEFAULT'`,
    )).rows[0];
    expect(replayExecuted).toBe(false);
    expect(replay).toEqual(first);
    expect(afterReplay).toEqual(afterFirst);
    expect((await pool.query(
      `SELECT id FROM idempotency_records WHERE workspace_id=$1 AND scope='/demo/reset' AND actor='buyer' AND idempotency_key='atomic-reset-idempotency-test'`,
      [afterFirst.id],
    )).rowCount).toBe(1);
  });

  it("业务提交后并发重置会清除旧代幂等快照，重复 Key 必须在新代重新执行", async () => {
    let releaseFirstWork!: () => void;
    let announceBusinessCommitted!: () => void;
    const firstWorkReleased = new Promise<void>((resolve) => { releaseFirstWork = resolve; });
    const businessCommitted = new Promise<void>((resolve) => { announceBusinessCommitted = resolve; });
    const scope = "/external/register/reset-race";
    const key = "reset-race-idempotency-test";
    const input = { contactName: "并发重置测试", email: "reset-race@example.test", password: "DemoPass123!" };
    let executions = 0;
    const work = async () => {
      executions += 1;
      const registered = await registerExternalSupplier("EXT-SUP-DEMO-004", input);
      const workspace = (await pool.query<{ id: string }>(`SELECT id FROM demo_workspaces WHERE code='DEMO-DEFAULT'`)).rows[0];
      if (executions === 1) {
        announceBusinessCommitted();
        await firstWorkReleased;
      }
      return { execution: executions, workspaceId: workspace.id, supplierNo: registered.supplier.supplierNo };
    };

    const firstPromise = withIdempotency(scope, "EXT-SUP-DEMO-004", key, input, work);
    await businessCommitted;
    const waitersBefore = Number((await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted`,
    )).rows[0].count);
    const resetPromise = resetDemo();
    const waitForQueuedReset = async () => {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const waiting = Number((await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted`,
        )).rows[0].count);
        if (waiting > waitersBefore) return "reset-blocked" as const;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("并发重置没有进入工作区生命周期锁等待状态");
    };

    let resetState: "reset-blocked" | "reset-completed" | undefined;
    let synchronizationError: unknown;
    try {
      resetState = await Promise.race([
        resetPromise.then(() => "reset-completed" as const),
        waitForQueuedReset(),
      ]);
    } catch (error) {
      synchronizationError = error;
    } finally {
      releaseFirstWork();
    }
    const first = await firstPromise;
    await resetPromise;
    if (synchronizationError) throw synchronizationError;

    const currentWorkspace = (await pool.query<{ id: string }>(`SELECT id FROM demo_workspaces WHERE code='DEMO-DEFAULT'`)).rows[0];
    const currentGenerationRecords = await pool.query(
      `SELECT ir.id FROM idempotency_records ir JOIN demo_workspaces w ON w.id=ir.workspace_id WHERE w.code='DEMO-DEFAULT' AND ir.scope=$1 AND ir.actor=$2 AND ir.idempotency_key=$3`,
      [scope, "EXT-SUP-DEMO-004", key],
    );
    expect(resetState).toBe("reset-blocked");
    expect(currentWorkspace.id).not.toBe(first.workspaceId);
    expect(currentGenerationRecords.rowCount).toBe(0);

    const replay = await withIdempotency(scope, "EXT-SUP-DEMO-004", key, input, work);
    expect(executions).toBe(2);
    expect(replay.execution).toBe(2);
    expect(replay.workspaceId).toBe(currentWorkspace.id);
  });

  it("报价截止判断使用数据库时钟，不受应用进程时钟偏差影响", async () => {
    await registerExternalSupplier("EXT-SUP-DEMO-004", { contactName: "测试联系人", email: "e004-test@example.test", password: "DemoPass123!" });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 24 * 60 * 60 * 1000);
    try {
      const receipt = await submitSupplierQuote("EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002", { totalAmount: "120000.00", deliveryDays: 10, remark: "数据库时钟测试" });
      expect(receipt.quote.totalAmount).toBe("120000.00");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("停止报价在一个事务中冻结最终版本并推进到评估阶段", async () => {
    const detail = await closeRfq("RFQ-DEMO-0002", "EARLY_STOP");
    expect(detail.status).toBe("EVALUATION_PENDING");
    expect(detail.revealedQuotes).toHaveLength(2);
    const close = await pool.query(`SELECT quote_count FROM rfq_close_events event JOIN rfqs rfq ON rfq.id=event.rfq_id WHERE rfq.rfq_no='RFQ-DEMO-0002'`);
    expect(close.rows[0].quote_count).toBe(2);
  });

  it("停止报价与供应商报价并发时不会留下已关闭但缺失最新版本的报价", async () => {
    await registerExternalSupplier("EXT-SUP-DEMO-004", { contactName: "并发报价测试", email: "quote-race@example.test", password: "DemoPass123!" });
    const [quoteResult, closeResult] = await Promise.allSettled([
      submitSupplierQuote("EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002", { totalAmount: "118000.00", deliveryDays: 10, remark: "与停止报价并发" }),
      closeRfq("RFQ-DEMO-0002", "EARLY_STOP"),
    ]);
    expect(closeResult.status).toBe("fulfilled");
    if (quoteResult.status === "rejected") {
      expect(quoteResult.reason).toMatchObject({ code: "RFQ_CLOSED" } satisfies Partial<ApiError>);
    }
    const final = await pool.query<{ status: string; quotes: number; versioned: number }>(`
      SELECT r.status,count(DISTINCT q.id)::int AS quotes,count(DISTINCT d.quote_id)::int AS versioned
      FROM rfqs r LEFT JOIN quotes q ON q.rfq_id=r.id LEFT JOIN quote_versions d ON d.quote_id=q.id AND d.version_no=q.current_version
      WHERE r.rfq_no='RFQ-DEMO-0002' GROUP BY r.id
    `);
    expect(final.rows[0].status).toBe("CLOSED");
    expect(final.rows[0].versioned).toBe(final.rows[0].quotes);
    expect(final.rows[0].quotes).toBe(quoteResult.status === "fulfilled" ? 3 : 2);
  });

  it("报价评估和采购申请只使用外部供应商的最新版本", async () => {
    await registerExternalSupplier("EXT-SUP-DEMO-004", { contactName: "最新版本", email: "latest-quote@example.test", password: "DemoPass123!" });
    await submitSupplierQuote("EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002", { totalAmount: "140000.00", deliveryDays: 15, remark: "旧版" });
    const latest = await submitSupplierQuote("EXT-SUP-DEMO-004", "EXTERNAL", "RFQ-DEMO-0002", { totalAmount: "110000.00", deliveryDays: 10, remark: "最新版" });
    await closeRfq("RFQ-DEMO-0002", "EARLY_STOP");
    let capturedInput: unknown;
    const describeSpy = vi.spyOn(deepseek, "describeEvaluation").mockImplementation(async (input) => {
      capturedInput = input;
      return successfulEvaluationDescription(input);
    });
    try {
      const evaluated = await evaluateRfq("RFQ-DEMO-0002");
      expect((capturedInput as { ranking: Array<{ quoteNo: string; totalAmount: string }> }).ranking.find((quote) => quote.quoteNo === latest.quote.quoteNo)?.totalAmount).toBe("110000.00");
      expect(evaluated.evaluation?.items.find((quote) => quote.quoteNo === latest.quote.quoteNo)).toMatchObject({ totalAmount: "110000.00", version: 2 });
      const completed = await createPurchaseRequisition("SR-DEMO-0002", { quoteNo: latest.quote.quoteNo });
      expect(completed.purchaseRequisition).toMatchObject({ quoteNo: latest.quote.quoteNo, totalAmount: "110000.00", deliveryDays: 10 });
    } finally {
      describeSpy.mockRestore();
    }
  });

  it("评估结果和采购申请固定使用评估时的具体报价版本", async () => {
    await closeRfq("RFQ-DEMO-0002", "EARLY_STOP");
    const describeSpy = vi.spyOn(deepseek, "describeEvaluation").mockImplementation(async (input) => successfulEvaluationDescription(input));
    try {
      const evaluated = await evaluateRfq("RFQ-DEMO-0002");
      const original = evaluated.evaluation!.items.find((item) => item.version === 1)!;
      const quote = (await pool.query<{ id: string; workspace_id: string }>(
        `SELECT id,workspace_id FROM quotes WHERE quote_no=$1`,
        [original.quoteNo],
      )).rows[0];
      await pool.query(
        `INSERT INTO quote_versions(workspace_id,quote_id,version_no,receipt_no,total_amount,delivery_days,remark,competitiveness,payload_sha256)
         VALUES($1,$2,2,$3,'999999.00',99,'评估完成后的维护变更',NULL,'maintenance-version')`,
        [quote.workspace_id, quote.id, `RCPT-${original.quoteNo}-V2-MAINTENANCE`],
      );
      await pool.query(`UPDATE quotes SET current_version=2 WHERE id=$1`, [quote.id]);

      const stable = await getRequestDetail("SR-DEMO-0002");
      expect(stable.evaluation!.items.find((item) => item.quoteNo === original.quoteNo)).toMatchObject({
        version: 1,
        totalAmount: original.totalAmount,
        deliveryDays: original.deliveryDays,
      });
      const completed = await createPurchaseRequisition("SR-DEMO-0002", { quoteNo: original.quoteNo });
      expect(completed.purchaseRequisition).toMatchObject({
        quoteNo: original.quoteNo,
        totalAmount: original.totalAmount,
        deliveryDays: original.deliveryDays,
      });
    } finally {
      describeSpy.mockRestore();
    }
  });

  it("报价评估逐步落库、可实时查询且并发提交只调用一次 DeepSeek", async () => {
    await closeRfq("RFQ-DEMO-0002", "EARLY_STOP");
    let capturedInput: unknown;
    let releaseDeepSeek!: (value: ReturnType<typeof successfulEvaluationDescription>) => void;
    const deepSeekResponse = new Promise<ReturnType<typeof successfulEvaluationDescription>>((resolve) => { releaseDeepSeek = resolve; });
    const describeSpy = vi.spyOn(deepseek, "describeEvaluation").mockImplementation(async (input) => {
      capturedInput = input;
      return deepSeekResponse;
    });
    try {
      const evaluationPromise = evaluateRfq("RFQ-DEMO-0002");
      const running = await waitFor(async () => {
        const detail = await getRequestDetail("SR-DEMO-0002");
        const runId = detail.activeEvaluationAgentRun?.id;
        return runId && detail.agentActions.some((action) => action.agentRunId === runId && action.actionType === "ANALYZE_EVALUATION_WITH_DEEPSEEK" && action.status === "RUNNING")
          ? detail
          : undefined;
      });
      expect(running.activeEvaluationAgentRun).toMatchObject({ status: "RUNNING", promptVersion: "evaluation-v2" });
      const runningActions = running.agentActions.filter((action) => action.agentRunId === running.activeEvaluationAgentRun!.id);
      expect(runningActions.map((action) => action.actionType)).toEqual([
        "LOAD_CURRENT_QUOTES",
        "VERIFY_QUOTE_SET",
        "CALCULATE_PRICE_SCORE",
        "CALCULATE_DELIVERY_SCORE",
        "CALCULATE_MATCH_RISK_SCORE",
        "APPLY_EVALUATION_WEIGHTS",
        "ANALYZE_EVALUATION_WITH_DEEPSEEK",
      ]);
      await expect(evaluateRfq("RFQ-DEMO-0002")).rejects.toMatchObject({ code: "ILLEGAL_STATE_TRANSITION" });
      expect(describeSpy).toHaveBeenCalledTimes(1);

      releaseDeepSeek(successfulEvaluationDescription(capturedInput));
      const completed = await evaluationPromise;
      expect(completed.status).toBe("AWARD_PENDING");
      expect(completed.evaluation?.items).toHaveLength(2);
      expect(completed.activeEvaluationAgentRun).toBeNull();
      expect(completed.latestEvaluationAgentRun).toMatchObject({ status: "SUCCEEDED", model: "deepseek-evaluation-test" });
      const completedActions = completed.agentActions.filter((action) => action.agentRunId === completed.latestEvaluationAgentRun!.id);
      expect(completedActions.map((action) => action.actionType)).toEqual([
        "LOAD_CURRENT_QUOTES",
        "VERIFY_QUOTE_SET",
        "CALCULATE_PRICE_SCORE",
        "CALCULATE_DELIVERY_SCORE",
        "CALCULATE_MATCH_RISK_SCORE",
        "APPLY_EVALUATION_WEIGHTS",
        "ANALYZE_EVALUATION_WITH_DEEPSEEK",
        "VALIDATE_EVALUATION_OUTPUT",
        "SAVE_EVALUATION_RANKING",
      ]);
      expect(completedActions.every((action) => action.status === "SUCCEEDED" && action.finishedAt)).toBe(true);
      expect(completed.agentMessages.find((message) => message.agentRunId === completed.latestEvaluationAgentRun!.id)?.content).toBe("DeepSeek 已完成 Top 2 报价的关注点分析；最终排名、分数和比较结论均由服务端确定性计算。");
    } finally {
      describeSpy.mockRestore();
    }
  });

  it("DeepSeek 评估失败时保留详细失败步骤并允许后续重试", async () => {
    await closeRfq("RFQ-DEMO-0002", "EARLY_STOP");
    const describeSpy = vi.spyOn(deepseek, "describeEvaluation").mockRejectedValue(new ApiError("AGENT_SERVICE_UNAVAILABLE", "DeepSeek 评估暂时不可用", 503));
    try {
      await expect(evaluateRfq("RFQ-DEMO-0002")).rejects.toMatchObject({ code: "AGENT_SERVICE_UNAVAILABLE" });
      const failed = await getRequestDetail("SR-DEMO-0002");
      expect(failed.status).toBe("EVALUATION_PENDING");
      expect(failed.evaluation).toBeNull();
      expect(failed.activeEvaluationAgentRun).toBeNull();
      expect(failed.latestEvaluationAgentRun).toMatchObject({ status: "FAILED", errorCode: "AGENT_SERVICE_UNAVAILABLE", errorMessage: "DeepSeek 评估暂时不可用" });
      const actions = failed.agentActions.filter((action) => action.agentRunId === failed.latestEvaluationAgentRun!.id);
      expect(actions.find((action) => action.actionType === "ANALYZE_EVALUATION_WITH_DEEPSEEK")).toMatchObject({ status: "FAILED", summary: "DeepSeek 评估暂时不可用" });
      expect(actions.some((action) => action.actionType === "SAVE_EVALUATION_RANKING")).toBe(false);
    } finally {
      describeSpy.mockRestore();
    }
  });

  it("评估拒绝不完整最新版本，并在保存前重新核验报价集合", async () => {
    await closeRfq("RFQ-DEMO-0002", "EARLY_STOP");
    const removed = await pool.query<{ quote_id: string; workspace_id: string; version_no: number; receipt_no: string; total_amount: string; delivery_days: number; remark: string; competitiveness: string | null; submitted_at: Date; payload_sha256: string; is_simulated: boolean }>(`
      DELETE FROM quote_versions
       WHERE quote_id=(SELECT q.id FROM quotes q JOIN rfqs r ON r.id=q.rfq_id WHERE r.rfq_no='RFQ-DEMO-0002' ORDER BY q.quote_no LIMIT 1)
       RETURNING quote_id,workspace_id,version_no,receipt_no,total_amount::text,delivery_days,remark,competitiveness,submitted_at,payload_sha256,is_simulated`);
    const untouchedSpy = vi.spyOn(deepseek, "describeEvaluation");
    await expect(evaluateRfq("RFQ-DEMO-0002")).rejects.toMatchObject({ code: "STALE_VERSION" });
    expect(untouchedSpy).not.toHaveBeenCalled();
    untouchedSpy.mockRestore();
    await pool.query(`INSERT INTO quote_versions(quote_id,workspace_id,version_no,receipt_no,total_amount,delivery_days,remark,competitiveness,submitted_at,payload_sha256,is_simulated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [removed.rows[0].quote_id, removed.rows[0].workspace_id, removed.rows[0].version_no, removed.rows[0].receipt_no, removed.rows[0].total_amount, removed.rows[0].delivery_days, removed.rows[0].remark, removed.rows[0].competitiveness, removed.rows[0].submitted_at, removed.rows[0].payload_sha256, removed.rows[0].is_simulated]);

    let capturedInput: unknown;
    let releaseDeepSeek!: (value: ReturnType<typeof successfulEvaluationDescription>) => void;
    const deepSeekResponse = new Promise<ReturnType<typeof successfulEvaluationDescription>>((resolve) => { releaseDeepSeek = resolve; });
    const describeSpy = vi.spyOn(deepseek, "describeEvaluation").mockImplementation(async (input) => {
      capturedInput = input;
      return deepSeekResponse;
    });
    try {
      const evaluationPromise = evaluateRfq("RFQ-DEMO-0002");
      await waitFor(async () => describeSpy.mock.calls.length > 0 ? true : undefined);
      await pool.query(`UPDATE quote_versions SET total_amount=total_amount+1 WHERE quote_id=$1`, [removed.rows[0].quote_id]);
      releaseDeepSeek(successfulEvaluationDescription(capturedInput));
      await expect(evaluationPromise).rejects.toMatchObject({ code: "STALE_VERSION" });
      const failed = await getRequestDetail("SR-DEMO-0002");
      expect(failed.status).toBe("EVALUATION_PENDING");
      expect(failed.evaluation).toBeNull();
      expect(failed.latestEvaluationAgentRun).toMatchObject({ status: "FAILED", errorCode: "STALE_VERSION" });
      expect((await pool.query(`SELECT count(*)::int AS count FROM evaluation_items items JOIN evaluations evaluation ON evaluation.id=items.evaluation_id WHERE evaluation.rfq_id=(SELECT id FROM rfqs WHERE rfq_no='RFQ-DEMO-0002')`)).rows[0].count).toBe(0);
    } finally {
      describeSpy.mockRestore();
    }
  });

  it("阶段三、四、完成态具备累计完整记录", async () => {
    const stage3 = await getRequestDetail("SR-DEMO-0003");
    const stage4 = await getRequestDetail("SR-DEMO-0004");
    const completed = await getRequestDetail("SR-DEMO-0005");
    expect(stage3.revealedQuotes).toHaveLength(5);
    expect(stage4.evaluation?.items).toHaveLength(5);
    expect(stage4.latestEvaluationAgentRun).toMatchObject({ status: "SUCCEEDED", isSeeded: true });
    expect(stage4.agentActions.filter((action) => action.agentRunId === stage4.latestEvaluationAgentRun!.id && action.runType === "EVALUATION")).toHaveLength(9);
    expect(completed.purchaseRequisition?.prNo).toBe("PR-DEMO-0001");
  });

  it("使用数据库时间自动关闭过期 RFQ", async () => {
    await pool.query(`UPDATE rfqs SET deadline_at=clock_timestamp()-interval '1 second' WHERE rfq_no='RFQ-DEMO-0002'`);
    const list = await listSupplierRfqs("INT-SUP-DEMO-002", "INTERNAL");
    expect(list.rfqs.find((rfq) => rfq.rfqNo === "RFQ-DEMO-0002")?.status).toBe("CLOSED");
    expect(await closeExpiredRfqs()).toBe(0);
    const detail = await getRequestDetail("SR-DEMO-0002");
    expect(detail.status).toBe("EVALUATION_PENDING");
    expect(detail.rfq?.status).toBe("CLOSED");
  });

  it("DeepSeek 未配置时明确失败且不伪造 Agent 成功结果", async () => {
    const before = await getRequestDetail("SR-DEMO-0001");
    await expect(runSourcingAgent("SR-DEMO-0001", { message: "重新执行真实寻源" })).rejects.toMatchObject({ code: "AGENT_SERVICE_UNAVAILABLE" });
    const failed = await pool.query(`SELECT ar.status,ar.error_code,ar.input_snapshot->>'intent' AS intent,(ar.input_snapshot->>'preservePreviousCandidates')::boolean AS preserve_previous FROM agent_runs ar JOIN sourcing_requests sr ON sr.id=ar.request_id WHERE sr.request_no='SR-DEMO-0001' AND ar.input_snapshot->>'message'='重新执行真实寻源'`);
    expect(failed.rows).toEqual([expect.objectContaining({ status: "FAILED", error_code: "AGENT_SERVICE_UNAVAILABLE", intent: "PENDING", preserve_previous: true })]);
    const detail = await getRequestDetail("SR-DEMO-0001");
    expect(detail.activeSourcingAgentRun).toBeNull();
    expect(detail.latestSourcingAgentRun).toMatchObject({ status: "FAILED", errorCode: "AGENT_SERVICE_UNAVAILABLE", isSeeded: false });
    expect(detail.status).toBe(before.status);
    expect(detail.candidates.map((candidate) => candidate.supplierNo)).toEqual(before.candidates.map((candidate) => candidate.supplierNo));
    const runId = detail.latestSourcingAgentRun!.id;
    expect(detail.agentActions.find((action) => action.agentRunId === runId && action.actionType === "CLASSIFY_AGENT_INTENT")).toMatchObject({ status: "FAILED" });
    const published = await publishRfq("SR-DEMO-0001");
    expect(published.status).toBe("BIDDING_OPEN");
    expect(published.rfq?.counts.invited).toBe(before.candidates.length);
    expect(published.rfq?.deadlineAt).toBe(ACTIVE_DEMO_RFQ_DEADLINE);
  });
});
