import { pool } from "./db";
import type { Pool, PoolClient } from "pg";
import { ApiError } from "./errors";
import { WORKSPACE_CODE } from "./env";
import { SOURCING_AGENT_ACTION_LABELS } from "@haitian/sourcing-contracts";

function iso(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : null;
}

export async function getMeta() {
  const row = (await pool.query<{ id: string; revision: string; server_time: Date }>("SELECT id,revision::text,clock_timestamp() AS server_time FROM demo_workspaces WHERE code=$1", [WORKSPACE_CODE])).rows[0];
  return { workspaceCode: WORKSPACE_CODE, workspaceInstanceId: row?.id ?? null, revision: Number(row?.revision ?? 0), serverTime: (row?.server_time ?? new Date()).toISOString(), requestId: crypto.randomUUID() };
}

export async function getCatalog() {
  const rows = (await pool.query(`SELECT c.code,c.name,c.unit,c.specifications,c.quantities,c.qualifications,c.delivery_options,c.quote_durations,c.evaluation_strategies FROM catalog_items c JOIN demo_workspaces w ON w.id=c.workspace_id WHERE w.code=$1 AND c.enabled=true ORDER BY c.code`, [WORKSPACE_CODE])).rows;
  return { items: rows.map((row) => ({
    code: row.code, name: row.name, unit: row.unit, specifications: row.specifications, quantities: row.quantities.map((quantity: Record<string, unknown>) => ({ ...quantity, unit: row.unit })),
    qualifications: row.qualifications, deliveryOptions: row.delivery_options, quoteDurations: row.quote_durations,
    evaluationStrategies: row.evaluation_strategies,
  })), quoteDurations: [15, 30, 60], evaluationStrategies: [{ value: "BALANCED", label: "综合均衡" }, { value: "PRICE_FIRST", label: "价格优先" }, { value: "DELIVERY_FIRST", label: "交期优先" }] };
}

const summarySql = `
 SELECT sr.request_no,sr.item_code,sr.item_name,sr.specification_snapshot,sr.quantity::text,sr.unit,sr.status,sr.created_at,sr.updated_at,
        r.rfq_no,r.status AS rfq_status,r.deadline_at,
        count(DISTINCT i.id)::int AS invited_count,
        count(DISTINCT i.id) FILTER (WHERE i.viewed_at IS NOT NULL)::int AS viewed_count,
        count(DISTINCT i.id) FILTER (WHERE s.supplier_type='EXTERNAL' AND esa.id IS NOT NULL)::int AS registered_external_count,
        count(DISTINCT q.id)::int AS submitted_count
 FROM sourcing_requests sr
 JOIN demo_workspaces w ON w.id=sr.workspace_id
 LEFT JOIN rfqs r ON r.request_id=sr.id
 LEFT JOIN rfq_invitations i ON i.rfq_id=r.id
 LEFT JOIN suppliers s ON s.id=i.supplier_id
 LEFT JOIN external_supplier_accounts esa ON esa.supplier_id=s.id
 LEFT JOIN quotes q ON q.rfq_id=r.id
 WHERE w.code=$1
 GROUP BY sr.id,r.id
`;

function requestSummary(row: Record<string, unknown>) {
  return {
    requestNo: row.request_no, itemCode: row.item_code, itemName: row.item_name, specification: row.specification_snapshot,
    quantity: Number(row.quantity), unit: row.unit, status: row.status, rfqNo: row.rfq_no ?? null, rfqStatus: row.rfq_status ?? null,
    quoteProgress: row.rfq_no ? { invited: Number(row.invited_count ?? 0), registeredExternal: Number(row.registered_external_count ?? 0), viewed: Number(row.viewed_count ?? 0), submitted: Number(row.submitted_count ?? 0) } : null,
    deadlineAt: iso(row.deadline_at as Date | null), createdAt: iso(row.created_at as Date), updatedAt: iso(row.updated_at as Date),
  };
}

export async function getRequestList() {
  const rows = (await pool.query(`${summarySql} ORDER BY sr.created_at ASC`, [WORKSPACE_CODE])).rows;
  return { requests: rows.map(requestSummary) };
}

export async function getDashboard() {
  const { requests } = await getRequestList();
  return {
    stats: {
      total: requests.length,
      sourcing: requests.filter((row) => row.status === "SOURCING_RUNNING" || row.status === "SOURCING_READY").length,
      bidding: requests.filter((row) => row.status === "BIDDING_OPEN").length,
      evaluating: requests.filter((row) => row.status === "EVALUATION_PENDING").length,
      awardPending: requests.filter((row) => row.status === "AWARD_PENDING").length,
      completed: requests.filter((row) => row.status === "COMPLETED").length,
    },
    requests,
  };
}

type Queryable = Pool | PoolClient;

type QueryTasks = readonly (() => Promise<unknown>)[];
type QueryTaskResults<T extends QueryTasks> = { [K in keyof T]: Awaited<ReturnType<T[K]>> };

async function runQueryBatch<T extends QueryTasks>(db: Queryable, tasks: T): Promise<QueryTaskResults<T>> {
  if (db === pool) {
    return Promise.all(tasks.map((task) => task())) as Promise<QueryTaskResults<T>>;
  }
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as QueryTaskResults<T>;
}

export async function getQuoteProgress(rfqNo: string, db: Queryable = pool) {
  const rfq = (await db.query(`SELECT r.id,r.rfq_no,r.status,r.deadline_at,r.closed_at,r.close_reason,r.revealed_at FROM rfqs r JOIN demo_workspaces w ON w.id=r.workspace_id WHERE w.code=$1 AND r.rfq_no=$2`, [WORKSPACE_CODE, rfqNo])).rows[0];
  if (!rfq) throw new ApiError("NOT_FOUND", "询价单不存在", 404);
  const rows = (await db.query(`
    SELECT s.supplier_no,s.name,s.supplier_type,i.invited_at,i.viewed_at,i.submitted_at,a.registered_at,
           q.quote_no,q.current_version,version.receipt_no,version.total_amount::text,version.delivery_days,
           version.remark,version.competitiveness,version.submitted_at AS quote_submitted_at,
           (SELECT count(*)::int FROM quote_versions all_versions WHERE all_versions.quote_id=q.id) AS version_count
    FROM rfq_invitations i JOIN suppliers s ON s.id=i.supplier_id LEFT JOIN external_supplier_accounts a ON a.supplier_id=s.id
    LEFT JOIN quotes q ON q.invitation_id=i.id
    LEFT JOIN quote_versions version ON version.quote_id=q.id AND version.version_no=q.current_version
    WHERE i.rfq_id=$1 ORDER BY s.supplier_type,s.supplier_no`, [rfq.id])).rows;
  return {
    rfqNo: rfq.rfq_no, status: rfq.status, deadlineAt: iso(rfq.deadline_at), closedAt: iso(rfq.closed_at), closeReason: rfq.close_reason, revealedAt: iso(rfq.revealed_at),
    counts: { invited: rows.length, registeredExternal: rows.filter((row) => row.supplier_type === "EXTERNAL" && row.registered_at).length, viewed: rows.filter((row) => row.viewed_at).length, submitted: rows.filter((row) => row.submitted_at).length },
    suppliers: rows.map((row) => ({
      supplierNo: row.supplier_no, supplierName: row.name, supplierType: row.supplier_type,
      invitedAt: iso(row.invited_at), viewedAt: iso(row.viewed_at), registeredAt: iso(row.registered_at), submittedAt: iso(row.submitted_at),
      latestQuote: row.quote_no ? {
        quoteNo: row.quote_no, receiptNo: row.receipt_no, totalAmount: row.total_amount,
        deliveryDays: row.delivery_days, remark: row.remark, version: row.current_version,
        versionCount: Number(row.version_count), competitiveness: row.competitiveness,
        submittedAt: iso(row.quote_submitted_at),
      } : null,
    })),
  };
}

export async function getRequestDetail(requestNo: string, db: Queryable = pool) {
  const request = (await db.query(`
    SELECT sr.*,c.name AS catalog_name FROM sourcing_requests sr JOIN demo_workspaces w ON w.id=sr.workspace_id JOIN catalog_items c ON c.id=sr.item_id
    WHERE w.code=$1 AND sr.request_no=$2`, [WORKSPACE_CODE, requestNo])).rows[0];
  if (!request) throw new ApiError("NOT_FOUND", "寻源需求不存在", 404);
  const [attachments, messages, actions, sourcingRuns, evaluationRuns, candidates, rfq, workflow] = await runQueryBatch(db, [
    () => db.query(`SELECT id,file_name,mime_type,size_bytes,checksum_sha256,created_at FROM request_attachments WHERE request_id=$1 ORDER BY created_at`, [request.id]),
    () => db.query(`SELECT id,agent_run_id,role,content,is_seeded,created_at FROM agent_messages WHERE request_id=$1 ORDER BY created_at,id`, [request.id]),
    () => db.query(`SELECT aa.id,aa.agent_run_id,aa.action_type,aa.status,aa.hit_count,aa.summary,aa.started_at,aa.finished_at,ar.run_type,coalesce((ar.input_snapshot->>'seeded')::boolean,false) AS is_seeded FROM agent_actions aa JOIN agent_runs ar ON ar.id=aa.agent_run_id WHERE aa.request_id=$1 ORDER BY aa.started_at,aa.id`, [request.id]),
    () => db.query(`SELECT ar.id,ar.status,ar.model,ar.prompt_version,ar.started_at,ar.finished_at,ar.error_code,ar.error_message,coalesce((ar.input_snapshot->>'seeded')::boolean,false) AS is_seeded FROM agent_runs ar WHERE ar.request_id=$1 AND ar.run_type='SOURCING' ORDER BY ar.started_at DESC,ar.id DESC`, [request.id]),
    () => db.query(`SELECT ar.id,ar.status,ar.model,ar.prompt_version,ar.started_at,ar.finished_at,ar.error_code,ar.error_message,coalesce((ar.input_snapshot->>'seeded')::boolean,false) AS is_seeded FROM agent_runs ar WHERE ar.request_id=$1 AND ar.run_type='EVALUATION' ORDER BY ar.started_at DESC,ar.id DESC`, [request.id]),
    () => db.query(`
      WITH latest_run AS (
        SELECT id,status,input_snapshot,started_at FROM agent_runs
        WHERE request_id=$1 AND run_type='SOURCING'
        ORDER BY started_at DESC,id DESC LIMIT 1
      ), candidate_run AS (
        SELECT CASE
          WHEN coalesce((latest_run.input_snapshot->>'preservePreviousCandidates')::boolean,false)
            OR coalesce((latest_run.input_snapshot->>'adjustmentRejected')::boolean,false) THEN (
            SELECT ar.id FROM agent_runs ar
            WHERE ar.request_id=$1 AND ar.run_type='SOURCING' AND ar.status='SUCCEEDED' AND ar.id<>latest_run.id
              AND EXISTS (SELECT 1 FROM sourcing_candidates previous_candidates WHERE previous_candidates.agent_run_id=ar.id)
            ORDER BY ar.started_at DESC,ar.id DESC LIMIT 1
          )
          WHEN latest_run.status<>'SUCCEEDED' THEN NULL
          ELSE latest_run.id
        END AS id
        FROM latest_run
      )
      SELECT sc.id,sc.agent_run_id,s.supplier_no,s.name,s.region,s.source_platform,s.risk_level,s.qualifications,sc.supplier_type,sc.match_score::text,sc.qualification_summary,sc.expected_delivery_days,sc.recommendation,sc.risk_summary,sc.eligible_for_rfq
      FROM sourcing_candidates sc JOIN suppliers s ON s.id=sc.supplier_id
      WHERE sc.request_id=$1 AND sc.agent_run_id=(SELECT id FROM candidate_run)
      ORDER BY sc.match_score DESC`, [request.id]),
    () => db.query(`SELECT * FROM rfqs WHERE request_id=$1`, [request.id]),
    () => db.query(`SELECT event_type,actor,summary,event_data,created_at FROM workflow_events WHERE request_id=$1 ORDER BY created_at,id`, [request.id]),
  ] as const);
  const rfqRow = rfq.rows[0] ?? null;
  const [quoteProgress, currentQuotes, evaluation, pr, notifications] = rfqRow ? await runQueryBatch(db, [
    () => getQuoteProgress(rfqRow.rfq_no, db),
    () => db.query(`SELECT q.quote_no,version.submitted_at,s.supplier_no,s.name AS supplier_name,s.supplier_type,
      version.total_amount::text,version.delivery_days,version.remark,version.version_no,version.competitiveness,
      (SELECT count(*)::int FROM quote_versions all_versions WHERE all_versions.quote_id=q.id) AS version_count
      FROM quotes q JOIN quote_versions version ON version.quote_id=q.id AND version.version_no=q.current_version
      JOIN suppliers s ON s.id=q.supplier_id WHERE q.rfq_id=$1 ORDER BY version.total_amount,q.quote_no`, [rfqRow.id]),
    () => db.query(`SELECT e.id,e.evaluation_no,e.strategy,e.status,e.created_at,e.completed_at FROM evaluations e WHERE e.rfq_id=$1 AND e.status='SUCCEEDED' ORDER BY e.completed_at DESC LIMIT 1`, [rfqRow.id]),
    () => db.query(`SELECT pr.pr_no,sr.request_no,r.rfq_no,pr.item_name,pr.specification,pr.quantity::text,pr.unit,pr.total_amount::text,pr.delivery_days,pr.created_at,s.supplier_no,s.name AS supplier_name,q.quote_no FROM purchase_requisitions pr JOIN sourcing_requests sr ON sr.id=pr.request_id JOIN rfqs r ON r.id=pr.rfq_id JOIN suppliers s ON s.id=pr.supplier_id JOIN quotes q ON q.id=pr.quote_id WHERE pr.request_id=$1`, [request.id]),
    () => db.query(`SELECT n.id,n.notification_type,n.recipient_address,n.delivery_mode,n.status,n.generated_at,s.supplier_no,s.name AS supplier_name FROM notification_records n JOIN rfq_invitations i ON i.id=n.invitation_id JOIN suppliers s ON s.id=i.supplier_id WHERE i.rfq_id=$1 ORDER BY n.generated_at`, [rfqRow.id]),
  ] as const) : [null, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }] as const;
  const evaluationRow = evaluation.rows[0] ?? null;
  const evaluationItems = evaluationRow ? (await db.query(`SELECT ei.rank,q.quote_no,s.supplier_no,s.name AS supplier_name,s.supplier_type,d.total_amount::text,d.delivery_days,d.version_no,d.competitiveness,ei.price_score::text,ei.delivery_score::text,ei.match_score::text,ei.risk_score::text,ei.total_score::text,ei.recommendation,ei.risk_summary FROM evaluation_items ei JOIN quotes q ON q.id=ei.quote_id JOIN suppliers s ON s.id=q.supplier_id JOIN quote_versions d ON d.id=ei.quote_version_id AND d.quote_id=ei.quote_id WHERE ei.evaluation_id=$1 ORDER BY ei.rank`, [evaluationRow.id])).rows : [];
  const mapSourcingRun = (row: Record<string, unknown> | undefined) => row ? {
    id: row.id,
    status: row.status,
    model: row.model,
    promptVersion: row.prompt_version,
    isSeeded: Boolean(row.is_seeded),
    startedAt: iso(row.started_at as Date),
    finishedAt: iso(row.finished_at as Date | null),
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
  } : null;
  const latestSourcingRun = sourcingRuns.rows[0] as Record<string, unknown> | undefined;
  const activeSourcingRun = sourcingRuns.rows.find((row) => row.status === "RUNNING") as Record<string, unknown> | undefined;
  const latestEvaluationRun = evaluationRuns.rows[0] as Record<string, unknown> | undefined;
  const activeEvaluationRun = evaluationRuns.rows.find((row) => row.status === "RUNNING") as Record<string, unknown> | undefined;
  return {
    requestNo: request.request_no, itemCode: request.item_code, itemName: request.item_name, specificationCode: request.specification_code,
    specification: request.specification_snapshot, quantity: Number(request.quantity), unit: request.unit, qualificationCodes: request.qualification_codes,
    requiredDeliveryDays: request.required_delivery_days, quoteDurationMinutes: request.quote_duration_minutes, evaluationStrategy: request.evaluation_strategy,
    status: request.status, version: request.version, isSeeded: request.is_seeded, createdAt: iso(request.created_at), updatedAt: iso(request.updated_at),
    attachment: attachments.rows[0] ? { id: attachments.rows[0].id, fileName: attachments.rows[0].file_name, mimeType: attachments.rows[0].mime_type, sizeBytes: attachments.rows[0].size_bytes, checksumSha256: attachments.rows[0].checksum_sha256, createdAt: iso(attachments.rows[0].created_at) } : null,
    attachments: attachments.rows.map((row) => ({ attachmentId: row.id, id: row.id, fileName: row.file_name, mimeType: row.mime_type, sizeBytes: row.size_bytes, checksumSha256: row.checksum_sha256, createdAt: iso(row.created_at) })),
    agentMessages: messages.rows.map((row) => ({ id: row.id, agentRunId: row.agent_run_id, role: row.role, content: row.content, isSeeded: row.is_seeded, createdAt: iso(row.created_at) })),
    agentActions: actions.rows.map((row) => ({ id: row.id, agentRunId: row.agent_run_id, runType: row.run_type, actionType: row.action_type, label: SOURCING_AGENT_ACTION_LABELS[row.action_type as keyof typeof SOURCING_AGENT_ACTION_LABELS], status: row.status, hitCount: row.hit_count, summary: row.summary, isSeeded: row.is_seeded, startedAt: iso(row.started_at), finishedAt: iso(row.finished_at) })),
    activeSourcingAgentRun: mapSourcingRun(activeSourcingRun),
    latestSourcingAgentRun: mapSourcingRun(latestSourcingRun),
    activeEvaluationAgentRun: mapSourcingRun(activeEvaluationRun),
    latestEvaluationAgentRun: mapSourcingRun(latestEvaluationRun),
    candidateSourcingAgentRunId: candidates.rows[0]?.agent_run_id ?? null,
    candidates: candidates.rows.map((row) => ({ id: row.id, supplierNo: row.supplier_no, supplierName: row.name, supplierType: row.supplier_type, region: row.region, sourcePlatform: row.source_platform, riskLevel: row.risk_level, matchScore: Number(row.match_score), qualifications: row.qualifications, qualificationSummary: row.qualification_summary, expectedDeliveryDays: row.expected_delivery_days, recommendation: row.recommendation, riskSummary: row.risk_summary, selectedForRfq: row.eligible_for_rfq, eligibleForRfq: row.eligible_for_rfq })),
    rfq: quoteProgress,
    quoteProgress,
    revealedQuotes: currentQuotes.rows.map((row) => ({ quoteNo: row.quote_no, supplierNo: row.supplier_no, supplierName: row.supplier_name, supplierType: row.supplier_type, totalAmount: row.total_amount, deliveryDays: row.delivery_days, remark: row.remark, submittedAt: iso(row.submitted_at), version: row.version_no, versionCount: Number(row.version_count), competitiveness: row.competitiveness })),
    evaluation: evaluationRow ? { evaluationNo: evaluationRow.evaluation_no, strategy: evaluationRow.strategy, status: evaluationRow.status, createdAt: iso(evaluationRow.created_at), completedAt: iso(evaluationRow.completed_at), items: evaluationItems.map((row) => ({ rank: row.rank, quoteNo: row.quote_no, supplierNo: row.supplier_no, supplierName: row.supplier_name, supplierType: row.supplier_type, totalAmount: row.total_amount, deliveryDays: row.delivery_days, version: row.version_no, versionCount: row.version_no, competitiveness: row.competitiveness, submittedAt: currentQuotes.rows.find((quote) => quote.quote_no === row.quote_no)?.submitted_at ? iso(currentQuotes.rows.find((quote) => quote.quote_no === row.quote_no)?.submitted_at) : null, priceScore: Number(row.price_score), deliveryScore: Number(row.delivery_score), matchScore: Number(row.match_score), riskScore: Number(row.risk_score), totalScore: Number(row.total_score), recommendation: row.recommendation, riskSummary: row.risk_summary })) } : null,
    purchaseRequisition: pr.rows[0] ? { prNo: pr.rows[0].pr_no, requestNo: pr.rows[0].request_no, rfqNo: pr.rows[0].rfq_no, itemName: pr.rows[0].item_name, specification: pr.rows[0].specification, quantity: Number(pr.rows[0].quantity), unit: pr.rows[0].unit, totalAmount: pr.rows[0].total_amount, deliveryDays: pr.rows[0].delivery_days, supplierNo: pr.rows[0].supplier_no, supplierName: pr.rows[0].supplier_name, quoteNo: pr.rows[0].quote_no, createdAt: iso(pr.rows[0].created_at) } : null,
    notifications: notifications.rows.map((row) => ({ id: row.id, supplierNo: row.supplier_no, supplierName: row.supplier_name, notificationType: row.notification_type, recipientAddress: row.recipient_address, deliveryMode: row.delivery_mode, status: row.status, generatedAt: iso(row.generated_at) })),
    workflowEvents: workflow.rows.map((row) => ({ eventType: row.event_type, actor: row.actor, summary: row.summary, eventData: row.event_data, createdAt: iso(row.created_at) })),
  };
}

export async function getNotifications(requestNo: string) {
  const detail = await getRequestDetail(requestNo);
  return { requestNo, notifications: detail.notifications };
}

export async function getRevealedQuotes(rfqNo: string) {
  const request = (await pool.query(`SELECT sr.request_no FROM rfqs r JOIN sourcing_requests sr ON sr.id=r.request_id JOIN demo_workspaces w ON w.id=r.workspace_id WHERE w.code=$1 AND r.rfq_no=$2`, [WORKSPACE_CODE, rfqNo])).rows[0];
  if (!request) throw new ApiError("NOT_FOUND", "询价单不存在", 404);
  const detail = await getRequestDetail(request.request_no);
  return { rfqNo, quotes: detail.revealedQuotes };
}
