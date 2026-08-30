import type { PoolClient } from "pg";
import { contentHash, hashPassword, openQuote, quoteAad, stableHash, type QuotePayload } from "./crypto";
import { lockWorkspaceLifecycleForTransaction, pool, withTransaction } from "./db";
import { migrate } from "./migrate";
import { ACTIVE_DEMO_RFQ_DEADLINE, SEED_VERSION, WORKSPACE_CODE, env } from "./env";

type CatalogFixture = {
  code: string; name: string; unit: string;
  specifications: Array<{ code: string; label: string }>;
  quantities: Array<{ code: string; label: string; value: number }>;
};

const catalogs: CatalogFixture[] = [
  { code: "ITEM-BOLT-M12", name: "M12 镀锌螺栓", unit: "件", specifications: [{ code: "BOLT-GB5783", label: "GB/T 5783、8.8 级、镀锌" }], quantities: [{ code: "SMALL", label: "小批量 10,000 件", value: 10000 }, { code: "MEDIUM", label: "中批量 30,000 件", value: 30000 }, { code: "LARGE", label: "大批量 50,000 件", value: 50000 }] },
  { code: "ITEM-PLATE-Q235", name: "Q235 钢板加工", unit: "吨", specifications: [{ code: "PLATE-Q235B-12", label: "Q235B、12mm、按图切割" }], quantities: [{ code: "SMALL", label: "小批量 10 吨", value: 10 }, { code: "MEDIUM", label: "中批量 20 吨", value: 20 }, { code: "LARGE", label: "大批量 50 吨", value: 50 }] },
  { code: "ITEM-VALVE-HCV", name: "液压控制阀组件", unit: "套", specifications: [{ code: "VALVE-DN25", label: "DN25、31.5MPa、成套测试" }], quantities: [{ code: "SMALL", label: "小批量 50 套", value: 50 }, { code: "MEDIUM", label: "中批量 100 套", value: 100 }, { code: "LARGE", label: "大批量 200 套", value: 200 }] },
];

type SupplierFixture = {
  no: string; type: "INTERNAL" | "EXTERNAL"; name: string; region: string; source: string;
  qualifications: string[]; risk: "LOW" | "MEDIUM" | "HIGH"; items: string[]; delivery: number;
  registrationEnabled?: boolean; registered?: boolean;
};

const suppliers: SupplierFixture[] = [
  { no: "INT-SUP-DEMO-001", type: "INTERNAL", name: "宁波精固工业", region: "宁波", source: "内部资源湖", qualifications: ["ISO9001"], risk: "LOW", items: ["ITEM-BOLT-M12"], delivery: 7 },
  { no: "INT-SUP-DEMO-002", type: "INTERNAL", name: "嘉兴联标制造", region: "嘉兴", source: "内部资源湖", qualifications: ["ISO9001", "IATF16949"], risk: "LOW", items: ["ITEM-BOLT-M12", "ITEM-PLATE-Q235"], delivery: 10 },
  { no: "INT-SUP-DEMO-003", type: "INTERNAL", name: "无锡华钢加工", region: "无锡", source: "内部资源湖", qualifications: ["ISO9001"], risk: "MEDIUM", items: ["ITEM-PLATE-Q235"], delivery: 12 },
  { no: "INT-SUP-DEMO-004", type: "INTERNAL", name: "苏州锐虎机械", region: "苏州", source: "内部资源湖", qualifications: ["IATF16949"], risk: "LOW", items: ["ITEM-PLATE-Q235", "ITEM-VALVE-HCV"], delivery: 14 },
  { no: "INT-SUP-DEMO-005", type: "INTERNAL", name: "常州恒流液压", region: "常州", source: "内部资源湖", qualifications: ["ISO9001", "IATF16949"], risk: "LOW", items: ["ITEM-VALVE-HCV"], delivery: 9 },
  { no: "INT-SUP-DEMO-006", type: "INTERNAL", name: "杭州精控液压", region: "杭州", source: "内部资源湖", qualifications: ["ISO9001"], risk: "MEDIUM", items: ["ITEM-VALVE-HCV", "ITEM-BOLT-M12"], delivery: 15 },
  { no: "EXT-SUP-DEMO-001", type: "EXTERNAL", name: "沧州宏达标准件", region: "沧州", source: "1688", qualifications: ["ISO9001"], risk: "LOW", items: ["ITEM-BOLT-M12"], delivery: 8, registered: true },
  { no: "EXT-SUP-DEMO-002", type: "EXTERNAL", name: "佛山联创金属", region: "佛山", source: "1688", qualifications: ["ISO9001"], risk: "LOW", items: ["ITEM-PLATE-Q235"], delivery: 11, registered: true },
  { no: "EXT-SUP-DEMO-003", type: "EXTERNAL", name: "武汉中科液压", region: "武汉", source: "行业平台", qualifications: ["ISO9001"], risk: "MEDIUM", items: ["ITEM-VALVE-HCV"], delivery: 12, registered: true },
  { no: "EXT-SUP-DEMO-004", type: "EXTERNAL", name: "浙江远航工业", region: "浙江", source: "企业信息库", qualifications: ["ISO9001", "IATF16949"], risk: "LOW", items: ["ITEM-BOLT-M12", "ITEM-PLATE-Q235"], delivery: 10, registrationEnabled: true },
  { no: "EXT-SUP-DEMO-005", type: "EXTERNAL", name: "青岛盛达机电", region: "青岛", source: "行业平台", qualifications: ["ISO9001"], risk: "MEDIUM", items: ["ITEM-BOLT-M12", "ITEM-VALVE-HCV"], delivery: 13, registered: true },
  { no: "EXT-SUP-DEMO-006", type: "EXTERNAL", name: "东莞恒锐制造", region: "东莞", source: "1688", qualifications: ["ISO9001", "IATF16949"], risk: "LOW", items: ["ITEM-BOLT-M12", "ITEM-PLATE-Q235", "ITEM-VALVE-HCV"], delivery: 10, registered: true },
];

const requestFixtures = [
  { no: "SR-DEMO-0001", item: "ITEM-BOLT-M12", status: "SOURCING_READY", quantity: 30000, delivery: 15, strategy: "BALANCED" },
  { no: "SR-DEMO-0002", item: "ITEM-PLATE-Q235", status: "BIDDING_OPEN", quantity: 20, delivery: 15, strategy: "BALANCED" },
  { no: "SR-DEMO-0003", item: "ITEM-VALVE-HCV", status: "EVALUATION_PENDING", quantity: 100, delivery: 15, strategy: "DELIVERY_FIRST" },
  { no: "SR-DEMO-0004", item: "ITEM-BOLT-M12", status: "AWARD_PENDING", quantity: 50000, delivery: 30, strategy: "PRICE_FIRST" },
  { no: "SR-DEMO-0005", item: "ITEM-PLATE-Q235", status: "COMPLETED", quantity: 50, delivery: 30, strategy: "BALANCED" },
] as const;

const quoteAmounts: Record<string, Array<[string, QuotePayload]>> = {
  "SR-DEMO-0002": [
    ["INT-SUP-DEMO-002", { totalAmount: "128000.00", deliveryDays: 12, remark: "含切割及包装" }],
    ["EXT-SUP-DEMO-002", { totalAmount: "124500.00", deliveryDays: 14, remark: "含税到厂" }],
  ],
  "SR-DEMO-0003": [
    ["INT-SUP-DEMO-004", { totalAmount: "286000.00", deliveryDays: 14, remark: "成套测试" }],
    ["INT-SUP-DEMO-005", { totalAmount: "279500.00", deliveryDays: 10, remark: "质保一年" }],
    ["INT-SUP-DEMO-006", { totalAmount: "271800.00", deliveryDays: 16, remark: "常规包装" }],
    ["EXT-SUP-DEMO-003", { totalAmount: "274000.00", deliveryDays: 12, remark: "含运输" }],
    ["EXT-SUP-DEMO-006", { totalAmount: "281000.00", deliveryDays: 9, remark: "优先排产" }],
  ],
  "SR-DEMO-0004": [
    ["INT-SUP-DEMO-001", { totalAmount: "153000.00", deliveryDays: 12, remark: "镀锌包装" }],
    ["INT-SUP-DEMO-002", { totalAmount: "149500.00", deliveryDays: 14, remark: "含税" }],
    ["INT-SUP-DEMO-006", { totalAmount: "158000.00", deliveryDays: 10, remark: "优先交货" }],
    ["EXT-SUP-DEMO-001", { totalAmount: "147800.00", deliveryDays: 16, remark: "平台保障" }],
    ["EXT-SUP-DEMO-005", { totalAmount: "151200.00", deliveryDays: 11, remark: "送货到厂" }],
  ],
  "SR-DEMO-0005": [
    ["INT-SUP-DEMO-002", { totalAmount: "318000.00", deliveryDays: 21, remark: "含税" }],
    ["INT-SUP-DEMO-003", { totalAmount: "309000.00", deliveryDays: 25, remark: "含加工" }],
    ["INT-SUP-DEMO-004", { totalAmount: "326000.00", deliveryDays: 18, remark: "优先排产" }],
    ["EXT-SUP-DEMO-002", { totalAmount: "305500.00", deliveryDays: 24, remark: "含运输" }],
    ["EXT-SUP-DEMO-006", { totalAmount: "312000.00", deliveryDays: 20, remark: "质量保证" }],
  ],
};

type EvaluationStrategy = "BALANCED" | "PRICE_FIRST" | "DELIVERY_FIRST";

type FixtureTimeline = {
  requestCreatedAt: Date;
  sourcingStartedAt: Date;
  sourcingFinishedAt: Date;
  rfqCreatedAt?: Date;
  invitedAt?: Date;
  viewedAt?: Date;
  firstSubmittedAt?: Date;
  deadlineAt?: Date;
  closedAt?: Date;
  revealedAt?: Date;
  evaluationStartedAt?: Date;
  evaluatedAt?: Date;
  awardedAt?: Date;
  prCreatedAt?: Date;
};

const minutesBefore = (resetAt: Date, minutes: number) => new Date(resetAt.getTime() - minutes * 60_000);
const minutesAfter = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

function timelineFor(requestNo: string, resetAt: Date): FixtureTimeline {
  switch (requestNo) {
    case "SR-DEMO-0001":
      return {
        requestCreatedAt: minutesBefore(resetAt, 20),
        sourcingStartedAt: minutesBefore(resetAt, 19),
        sourcingFinishedAt: minutesBefore(resetAt, 18),
      };
    case "SR-DEMO-0002":
      return {
        requestCreatedAt: minutesBefore(resetAt, 180),
        sourcingStartedAt: minutesBefore(resetAt, 175),
        sourcingFinishedAt: minutesBefore(resetAt, 170),
        rfqCreatedAt: minutesBefore(resetAt, 150),
        invitedAt: minutesBefore(resetAt, 145),
        viewedAt: minutesBefore(resetAt, 140),
        firstSubmittedAt: minutesBefore(resetAt, 130),
        deadlineAt: new Date(ACTIVE_DEMO_RFQ_DEADLINE),
      };
    case "SR-DEMO-0003":
      return {
        requestCreatedAt: minutesBefore(resetAt, 600),
        sourcingStartedAt: minutesBefore(resetAt, 590),
        sourcingFinishedAt: minutesBefore(resetAt, 580),
        rfqCreatedAt: minutesBefore(resetAt, 540),
        invitedAt: minutesBefore(resetAt, 530),
        viewedAt: minutesBefore(resetAt, 520),
        firstSubmittedAt: minutesBefore(resetAt, 500),
        deadlineAt: new Date(ACTIVE_DEMO_RFQ_DEADLINE),
        closedAt: minutesBefore(resetAt, 179),
        revealedAt: minutesBefore(resetAt, 178),
      };
    case "SR-DEMO-0004":
      return {
        requestCreatedAt: minutesBefore(resetAt, 1_440),
        sourcingStartedAt: minutesBefore(resetAt, 1_430),
        sourcingFinishedAt: minutesBefore(resetAt, 1_420),
        rfqCreatedAt: minutesBefore(resetAt, 1_380),
        invitedAt: minutesBefore(resetAt, 1_370),
        viewedAt: minutesBefore(resetAt, 1_360),
        firstSubmittedAt: minutesBefore(resetAt, 1_300),
        deadlineAt: new Date(ACTIVE_DEMO_RFQ_DEADLINE),
        closedAt: minutesBefore(resetAt, 1_079),
        revealedAt: minutesBefore(resetAt, 1_078),
        evaluationStartedAt: minutesBefore(resetAt, 1_020),
        evaluatedAt: minutesBefore(resetAt, 1_000),
      };
    case "SR-DEMO-0005":
      return {
        requestCreatedAt: minutesBefore(resetAt, 4_320),
        sourcingStartedAt: minutesBefore(resetAt, 4_310),
        sourcingFinishedAt: minutesBefore(resetAt, 4_300),
        rfqCreatedAt: minutesBefore(resetAt, 4_200),
        invitedAt: minutesBefore(resetAt, 4_190),
        viewedAt: minutesBefore(resetAt, 4_180),
        firstSubmittedAt: minutesBefore(resetAt, 4_100),
        deadlineAt: minutesBefore(resetAt, 3_600),
        closedAt: minutesBefore(resetAt, 3_599),
        revealedAt: minutesBefore(resetAt, 3_598),
        evaluationStartedAt: minutesBefore(resetAt, 3_500),
        evaluatedAt: minutesBefore(resetAt, 3_480),
        awardedAt: minutesBefore(resetAt, 3_460),
        prCreatedAt: minutesBefore(resetAt, 3_440),
      };
    default:
      throw new Error(`未知固定需求：${requestNo}`);
  }
}

async function insertQuote(
  client: PoolClient,
  workspaceId: string,
  rfqId: string,
  invitationId: string,
  supplierId: string,
  quoteNo: string,
  payload: QuotePayload,
  submittedAt: Date,
  competitiveness: "HIGH" | "MEDIUM" | "LOW" | null,
  seeded = true,
) {
  const quoteId = crypto.randomUUID();
  const payloadSha256 = stableHash(payload);
  await client.query(
    `INSERT INTO quotes(id,workspace_id,quote_no,rfq_id,invitation_id,supplier_id,submitted_at,receipt_no,payload_sha256,current_version,is_seeded)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)`,
    [quoteId, workspaceId, quoteNo, rfqId, invitationId, supplierId, submittedAt, `RCPT-${quoteNo}`, payloadSha256, seeded],
  );
  const version = await client.query<{ id: string }>(
    `INSERT INTO quote_versions(workspace_id,quote_id,version_no,receipt_no,total_amount,delivery_days,remark,competitiveness,submitted_at,payload_sha256)
     VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [workspaceId, quoteId, `RCPT-${quoteNo}`, payload.totalAmount, payload.deliveryDays, payload.remark, competitiveness, submittedAt, payloadSha256],
  );
  await client.query("UPDATE rfq_invitations SET submitted_at=$2 WHERE id=$1", [invitationId, submittedAt]);
  return { quoteId, quoteVersionId: version.rows[0].id, payload, submittedAt };
}

function quoteCompetitiveness(
  payload: QuotePayload,
  competitors: QuotePayload[],
  requiredDeliveryDays: number,
): "HIGH" | "MEDIUM" | "LOW" {
  if (!competitors.length) return payload.deliveryDays <= requiredDeliveryDays ? "MEDIUM" : "LOW";
  const average = competitors.reduce((sum, entry) => sum + Number(entry.totalAmount), 0) / competitors.length;
  const amount = Number(payload.totalAmount);
  if (amount <= average * 0.98 && payload.deliveryDays <= requiredDeliveryDays) return "HIGH";
  if (amount >= average * 1.05 || payload.deliveryDays > requiredDeliveryDays) return "LOW";
  return "MEDIUM";
}

async function migrateLegacyQuoteVersions(client: PoolClient) {
  const legacyRows = (await client.query<{
    quote_id: string;
    workspace_id: string;
    rfq_id: string;
    supplier_id: string;
    submitted_at: Date;
    payload_sha256: string;
    ciphertext: Buffer;
    nonce: Buffer;
    auth_tag: Buffer;
  }>(`
    SELECT q.id AS quote_id,q.workspace_id,q.rfq_id,q.supplier_id,q.submitted_at,q.payload_sha256,
           sealed.ciphertext,sealed.nonce,sealed.auth_tag
      FROM quotes q
      JOIN quote_sealed_payloads sealed ON sealed.quote_id=q.id
      LEFT JOIN quote_versions version ON version.quote_id=q.id
     WHERE version.id IS NULL
     ORDER BY q.submitted_at,q.id
     FOR UPDATE OF q
  `)).rows;
  for (const row of legacyRows) {
    const payload = openQuote(
      { ciphertext: row.ciphertext, nonce: row.nonce, authTag: row.auth_tag },
      quoteAad(row.workspace_id, row.rfq_id, row.supplier_id, row.quote_id),
    );
    await client.query(
      `INSERT INTO quote_versions(workspace_id,quote_id,version_no,receipt_no,total_amount,delivery_days,remark,submitted_at,payload_sha256)
       SELECT $1,$2,1,q.receipt_no,$3,$4,$5,$6,$7 FROM quotes q WHERE q.id=$2
       ON CONFLICT (quote_id,version_no) DO NOTHING`,
      [row.workspace_id, row.quote_id, payload.totalAmount, payload.deliveryDays, payload.remark, row.submitted_at, row.payload_sha256],
    );
  }

  const pendingAnalyses = (await client.query<{
    version_id: string;
    rfq_id: string;
    quote_id: string;
    total_amount: string;
    delivery_days: number;
    required_delivery_days: number;
  }>(`
    SELECT version.id AS version_id,q.rfq_id,q.id AS quote_id,version.total_amount::text,
           version.delivery_days,sr.required_delivery_days
      FROM quote_versions version
      JOIN quotes q ON q.id=version.quote_id
      JOIN suppliers s ON s.id=q.supplier_id AND s.supplier_type='EXTERNAL'
      JOIN rfqs r ON r.id=q.rfq_id
      JOIN sourcing_requests sr ON sr.id=r.request_id
     WHERE version.competitiveness IS NULL
     ORDER BY q.rfq_id,version.submitted_at,version.id
  `)).rows;
  for (const row of pendingAnalyses) {
    const competitors = (await client.query<{ total_amount: string; delivery_days: number }>(`
      SELECT version.total_amount::text,version.delivery_days
        FROM quotes q
        JOIN quote_versions version ON version.quote_id=q.id AND version.version_no=q.current_version
       WHERE q.rfq_id=$1 AND q.id<>$2
    `, [row.rfq_id, row.quote_id])).rows;
    const competitiveness = quoteCompetitiveness(
      { totalAmount: row.total_amount, deliveryDays: row.delivery_days, remark: "" },
      competitors.map((entry) => ({ totalAmount: entry.total_amount, deliveryDays: entry.delivery_days, remark: "" })),
      row.required_delivery_days,
    );
    await client.query(`UPDATE quote_versions SET competitiveness=$2 WHERE id=$1 AND competitiveness IS NULL`, [row.version_id, competitiveness]);
  }
  return legacyRows.length;
}

function strategyWeights(strategy: EvaluationStrategy) {
  if (strategy === "PRICE_FIRST") return { price: .60, delivery: .15, match: .15, risk: .10 };
  if (strategy === "DELIVERY_FIRST") return { price: .25, delivery: .50, match: .15, risk: .10 };
  return { price: .40, delivery: .25, match: .20, risk: .15 };
}

function scoreSeedQuotes(
  rows: Array<{ quoteId: string; quoteVersionId: string; supplierNo: string; payload: QuotePayload; submittedAt: Date }>,
  strategy: EvaluationStrategy,
  requiredDeliveryDays: number,
  matchScores: Map<string, number>,
) {
  const minimum = Math.min(...rows.map((row) => Number(row.payload.totalAmount)));
  const weights = strategyWeights(strategy);
  return rows.map((row) => {
    const supplier = suppliers.find((entry) => entry.no === row.supplierNo)!;
    const price = (minimum / Number(row.payload.totalAmount)) * 100;
    const delivery = row.payload.deliveryDays <= requiredDeliveryDays ? 100 : (requiredDeliveryDays / row.payload.deliveryDays) * 100;
    const match = matchScores.get(row.supplierNo) ?? 80;
    const risk = supplier.risk === "LOW" ? 100 : supplier.risk === "MEDIUM" ? 70 : 30;
    const total = price * weights.price + delivery * weights.delivery + match * weights.match + risk * weights.risk;
    return { ...row, price, delivery, match, risk, total };
  }).sort((a, b) => b.total - a.total
    || Number(a.payload.totalAmount) - Number(b.payload.totalAmount)
    || a.payload.deliveryDays - b.payload.deliveryDays
    || a.submittedAt.getTime() - b.submittedAt.getTime()
    || a.supplierNo.localeCompare(b.supplierNo));
}

type BaselineCheck = { name: string; passed: boolean; actual: unknown; expected: unknown };
type Queryable = Pick<PoolClient, "query">;

export async function assertDemoBaseline(client: Queryable = pool): Promise<{ ready: true; checks: BaselineCheck[] }> {
  const checks: BaselineCheck[] = [];
  const add = (name: string, passed: boolean, actual: unknown, expected: unknown) => checks.push({ name, passed, actual, expected });
  const count = async (sql: string, values: unknown[] = []) => Number(((await client.query(sql, values)).rows[0] as { count: string }).count);

  const requestSummary = (await client.query(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE sr.is_seeded)::text AS seeded,
            count(DISTINCT sr.request_no)::text AS distinct_nos,
            array_agg(sr.request_no ORDER BY sr.request_no) AS request_nos
       FROM sourcing_requests sr
       JOIN demo_workspaces w ON w.id=sr.workspace_id
      WHERE w.code=$1`,
    [WORKSPACE_CODE],
  )).rows[0] as { total: string; seeded: string; distinct_nos: string; request_nos: string[] };
  const expectedRequestNos = requestFixtures.map((fixture) => fixture.no);
  add(
    "固定需求恰好五条",
    requestSummary.total === "5" && requestSummary.seeded === "5" && requestSummary.distinct_nos === "5" && JSON.stringify(requestSummary.request_nos) === JSON.stringify(expectedRequestNos),
    requestSummary,
    { total: "5", seeded: "5", distinctNos: "5", requestNos: expectedRequestNos },
  );

  const stages = (await client.query(
    `SELECT sr.status,count(*)::text AS count
       FROM sourcing_requests sr JOIN demo_workspaces w ON w.id=sr.workspace_id
      WHERE w.code=$1 AND sr.is_seeded=true GROUP BY sr.status ORDER BY sr.status`,
    [WORKSPACE_CODE],
  )).rows as Array<{ status: string; count: string }>;
  const expectedStages = ["SOURCING_READY", "BIDDING_OPEN", "EVALUATION_PENDING", "AWARD_PENDING", "COMPLETED"];
  add("五个固定阶段各一条", expectedStages.every((status) => stages.some((row) => row.status === status && row.count === "1")) && stages.length === 5, stages, expectedStages);

  const businessNoSummary = (await client.query(
    `SELECT
       (SELECT count(*)-count(DISTINCT request_no) FROM sourcing_requests WHERE is_seeded=true)::text AS duplicate_requests,
       (SELECT count(*)-count(DISTINCT rfq_no) FROM rfqs)::text AS duplicate_rfqs,
       (SELECT count(*)-count(DISTINCT evaluation_no) FROM evaluations)::text AS duplicate_evaluations,
       (SELECT count(*)-count(DISTINCT quote_no) FROM quotes)::text AS duplicate_quotes,
       (SELECT count(*)-count(DISTINCT pr_no) FROM purchase_requisitions)::text AS duplicate_prs,
       (SELECT array_agg(rfq_no ORDER BY rfq_no) FROM rfqs) AS rfq_nos,
       (SELECT array_agg(evaluation_no ORDER BY evaluation_no) FROM evaluations WHERE status='SUCCEEDED') AS evaluation_nos,
       (SELECT array_agg(pr_no ORDER BY pr_no) FROM purchase_requisitions) AS pr_nos`,
  )).rows[0] as Record<string, string | string[] | null>;
  const businessNosValid = ["duplicate_requests", "duplicate_rfqs", "duplicate_evaluations", "duplicate_quotes", "duplicate_prs"]
    .every((key) => businessNoSummary[key] === "0")
    && JSON.stringify(businessNoSummary.rfq_nos) === JSON.stringify(["RFQ-DEMO-0002", "RFQ-DEMO-0003", "RFQ-DEMO-0004", "RFQ-DEMO-0005"])
    && JSON.stringify(businessNoSummary.evaluation_nos) === JSON.stringify(["EV-DEMO-0004", "EV-DEMO-0005"])
    && JSON.stringify(businessNoSummary.pr_nos) === JSON.stringify(["PR-DEMO-0001"]);
  add("固定业务编号唯一且完整", businessNosValid, businessNoSummary, "需求/RFQ/评估/报价/PR 编号不重复且固定编号完整");

  const predecessorRows = (await client.query(
    `SELECT sr.request_no,
            (SELECT count(*) FROM request_attachments a WHERE a.request_id=sr.id)::int AS attachments,
            (SELECT count(*) FROM agent_runs ar WHERE ar.request_id=sr.id AND ar.run_type='SOURCING' AND ar.status='SUCCEEDED')::int AS sourcing_runs,
            (SELECT count(*) FROM agent_messages am WHERE am.request_id=sr.id)::int AS messages,
            (SELECT count(*) FROM agent_actions aa WHERE aa.request_id=sr.id AND aa.status='SUCCEEDED')::int AS actions,
            (SELECT count(*) FROM sourcing_candidates sc WHERE sc.request_id=sr.id)::int AS candidates,
            (SELECT count(*) FROM rfqs r WHERE r.request_id=sr.id)::int AS rfqs,
            (SELECT count(*) FROM rfqs r JOIN rfq_invitations i ON i.rfq_id=r.id WHERE r.request_id=sr.id)::int AS invitations,
            (SELECT count(*) FROM rfqs r JOIN rfq_invitations i ON i.rfq_id=r.id JOIN notification_records n ON n.invitation_id=i.id WHERE r.request_id=sr.id)::int AS notifications,
            (SELECT count(*) FROM rfqs r JOIN quotes q ON q.rfq_id=r.id WHERE r.request_id=sr.id)::int AS quotes,
            (SELECT count(*) FROM rfqs r JOIN quotes q ON q.rfq_id=r.id JOIN quote_versions v ON v.quote_id=q.id AND v.version_no=q.current_version WHERE r.request_id=sr.id)::int AS versioned,
            (SELECT count(*) FROM evaluations e WHERE e.request_id=sr.id AND e.status='SUCCEEDED')::int AS evaluations,
            (SELECT count(*) FROM evaluations e JOIN evaluation_items ei ON ei.evaluation_id=e.id WHERE e.request_id=sr.id AND e.status='SUCCEEDED')::int AS evaluation_items,
            (SELECT count(*) FROM awards aw WHERE aw.request_id=sr.id)::int AS awards,
            (SELECT count(*) FROM purchase_requisitions pr WHERE pr.request_id=sr.id)::int AS prs
       FROM sourcing_requests sr JOIN demo_workspaces w ON w.id=sr.workspace_id
      WHERE w.code=$1 AND sr.is_seeded=true ORDER BY sr.request_no`,
    [WORKSPACE_CODE],
  )).rows as Array<Record<string, string | number>>;
  const basePredecessorsValid = predecessorRows.every((row) => Number(row.attachments) === 1
    && Number(row.sourcing_runs) === 1
    && Number(row.messages) >= 2
    && Number(row.actions) >= 3
    && Number(row.candidates) > 0);
  const stage1 = predecessorRows.find((row) => row.request_no === "SR-DEMO-0001");
  const stage2 = predecessorRows.find((row) => row.request_no === "SR-DEMO-0002");
  const stage3 = predecessorRows.find((row) => row.request_no === "SR-DEMO-0003");
  const stage4 = predecessorRows.find((row) => row.request_no === "SR-DEMO-0004");
  const stage5 = predecessorRows.find((row) => row.request_no === "SR-DEMO-0005");
  const predecessorsValid = basePredecessorsValid
    && Number(stage1?.rfqs) === 0
    && [stage2, stage3, stage4, stage5].every((row) => Number(row?.rfqs) === 1 && Number(row?.invitations) > 0 && Number(row?.notifications) === Number(row?.invitations))
    && [stage3, stage4, stage5].every((row) => Number(row?.quotes) >= 5 && Number(row?.versioned) === Number(row?.quotes))
    && Number(stage4?.evaluations) === 1 && Number(stage4?.evaluation_items) === Number(stage4?.quotes)
    && Number(stage5?.evaluations) === 1 && Number(stage5?.evaluation_items) === Number(stage5?.quotes) && Number(stage5?.awards) === 1 && Number(stage5?.prs) === 1;
  add("后续需求具备全部前序数据", predecessorsValid, predecessorRows, "附件、寻源、候选、RFQ、邀请、通知、明文报价版本、评估、中选与 PR 按阶段累计完整");

  const rfq2 = (await client.query(
    `SELECT r.status,r.deadline_at,r.deadline_at > clock_timestamp() AS deadline_in_future,
            count(DISTINCT i.id)::text AS invitations,
            count(DISTINCT n.id)::text AS notifications,
            count(DISTINCT q.id)::text AS quotes,
            count(DISTINCT v.quote_id)::text AS versioned
       FROM rfqs r
       LEFT JOIN rfq_invitations i ON i.rfq_id=r.id
       LEFT JOIN notification_records n ON n.invitation_id=i.id
       LEFT JOIN quotes q ON q.rfq_id=r.id
       LEFT JOIN quote_versions v ON v.quote_id=q.id AND v.version_no=q.current_version
      WHERE r.rfq_no='RFQ-DEMO-0002'
      GROUP BY r.id`,
  )).rows[0] as { status: string; deadline_at: Date; deadline_in_future: boolean; invitations: string; notifications: string; quotes: string; versioned: string };
  add("阶段二邀请通知与明文报价完整", rfq2?.invitations === "6" && rfq2.notifications === "6" && rfq2.quotes === "2" && rfq2.versioned === "2", rfq2, { invitations: "6", notifications: "6", quotes: "2", versioned: "2" });

  const externalFour = (await client.query(
    `SELECT count(DISTINCT a.id)::text AS accounts,count(DISTINCT q.id)::text AS quotes
       FROM suppliers s
       LEFT JOIN external_supplier_accounts a ON a.supplier_id=s.id
       LEFT JOIN rfq_invitations i ON i.supplier_id=s.id
       LEFT JOIN rfqs r ON r.id=i.rfq_id AND r.rfq_no='RFQ-DEMO-0002'
       LEFT JOIN quotes q ON q.invitation_id=i.id AND q.rfq_id=r.id
      WHERE s.supplier_no='EXT-SUP-DEMO-004'`,
  )).rows[0] as { accounts: string; quotes: string };
  add("外部 E004 恢复未注册未报价", externalFour?.accounts === "0" && externalFour.quotes === "0", externalFour, { accounts: "0", quotes: "0" });

  add(
    "阶段二使用固定截止时间且报价可读",
    rfq2?.status === "OPEN"
      && rfq2.deadline_at.toISOString() === ACTIVE_DEMO_RFQ_DEADLINE
      && rfq2.deadline_in_future === true
      && rfq2.versioned === rfq2.quotes,
    rfq2,
    { status: "OPEN", deadlineAt: ACTIVE_DEMO_RFQ_DEADLINE, deadlineInFuture: true, versioned: "2" },
  );

  const stage3Summary = (await client.query(
    `SELECT count(DISTINCT q.id)::text AS quotes,count(DISTINCT v.quote_id)::text AS versioned,
            count(DISTINCT e.id) FILTER (WHERE e.status='SUCCEEDED')::text AS successful_evaluations
       FROM sourcing_requests sr JOIN rfqs r ON r.request_id=sr.id
       LEFT JOIN quotes q ON q.rfq_id=r.id LEFT JOIN quote_versions v ON v.quote_id=q.id AND v.version_no=q.current_version
       LEFT JOIN evaluations e ON e.request_id=sr.id
      WHERE sr.request_no='SR-DEMO-0003' GROUP BY sr.id`,
  )).rows[0] as { quotes: string; versioned: string; successful_evaluations: string };
  add("阶段三最终报价完整且未评估", Number(stage3Summary?.quotes) >= 5 && stage3Summary.quotes === stage3Summary.versioned && stage3Summary.successful_evaluations === "0", stage3Summary, "至少五份报价、最新版本完整、无成功评估");

  const stage4Summary = (await client.query(
    `SELECT count(DISTINCT q.id)::text AS quotes,count(DISTINCT ei.id)::text AS items,
            min(ei.rank)::text AS min_rank,max(ei.rank)::text AS max_rank,
            count(DISTINCT aw.id)::text AS awards,count(DISTINCT pr.id)::text AS prs
       FROM sourcing_requests sr JOIN rfqs r ON r.request_id=sr.id JOIN quotes q ON q.rfq_id=r.id
       JOIN evaluations e ON e.request_id=sr.id AND e.status='SUCCEEDED'
       JOIN evaluation_items ei ON ei.evaluation_id=e.id
       LEFT JOIN awards aw ON aw.request_id=sr.id LEFT JOIN purchase_requisitions pr ON pr.request_id=sr.id
      WHERE sr.request_no='SR-DEMO-0004' GROUP BY sr.id`,
  )).rows[0] as { quotes: string; items: string; min_rank: string; max_rank: string; awards: string; prs: string };
  add("阶段四有完整排名且未中选", Number(stage4Summary?.items) >= 5 && stage4Summary.items === stage4Summary.quotes && stage4Summary.min_rank === "1" && stage4Summary.max_rank === stage4Summary.items && stage4Summary.awards === "0" && stage4Summary.prs === "0", stage4Summary, "完整连续排名、无 Award、无 PR");

  const stage5Summary = (await client.query(
    `SELECT count(DISTINCT aw.id)::text AS awards,count(DISTINCT pr.id)::text AS prs,
            array_agg(DISTINCT pr.pr_no) FILTER (WHERE pr.pr_no IS NOT NULL) AS pr_nos
       FROM sourcing_requests sr LEFT JOIN awards aw ON aw.request_id=sr.id
       LEFT JOIN purchase_requisitions pr ON pr.request_id=sr.id
      WHERE sr.request_no='SR-DEMO-0005' GROUP BY sr.id`,
  )).rows[0] as { awards: string; prs: string; pr_nos: string[] };
  add("完成态唯一中选与 PR", stage5Summary?.awards === "1" && stage5Summary.prs === "1" && JSON.stringify(stage5Summary.pr_nos) === JSON.stringify(["PR-DEMO-0001"]), stage5Summary, { awards: "1", prs: "1", prNos: ["PR-DEMO-0001"] });

  const orphanQuotes = await count(
    `SELECT count(*)::text AS count FROM quotes q
       LEFT JOIN rfq_invitations i ON i.id=q.invitation_id AND i.rfq_id=q.rfq_id AND i.supplier_id=q.supplier_id
      WHERE i.id IS NULL`,
  );
  add("所有报价供应商均受邀", orphanQuotes === 0, orphanQuotes, 0);

  const quoteCounts = (await client.query(
    `SELECT count(*)::text AS quotes,count(DISTINCT q.id)::text AS unique_quotes,
            count(DISTINCT q.invitation_id)::text AS unique_invitations,
            (SELECT count(*)::text FROM rfq_invitations WHERE submitted_at IS NOT NULL) AS submitted_invitations,
            (SELECT count(*)::text FROM quote_versions) AS versions,
            (SELECT count(*)::text FROM quotes q2 JOIN quote_versions v ON v.quote_id=q2.id AND v.version_no=q2.current_version) AS current_versions
       FROM quotes q`,
  )).rows[0] as { quotes: string; unique_quotes: string; unique_invitations: string; submitted_invitations: string; versions: string; current_versions: string };
  add("报价计数与最新版本一致", quoteCounts.quotes === quoteCounts.unique_quotes && quoteCounts.quotes === quoteCounts.unique_invitations && quoteCounts.quotes === quoteCounts.submitted_invitations && quoteCounts.quotes === quoteCounts.current_versions && Number(quoteCounts.versions) >= Number(quoteCounts.quotes), quoteCounts, "quotes = unique quotes = submitted invitations = current versions <= all versions");

  const prMismatches = await count(
    `SELECT count(*)::text AS count
       FROM purchase_requisitions pr
       JOIN awards aw ON aw.id=pr.award_id
       JOIN quotes q ON q.id=aw.quote_id
       JOIN quote_versions d ON d.quote_id=q.id AND d.version_no=q.current_version
      WHERE pr.quote_id<>aw.quote_id OR pr.supplier_id<>aw.supplier_id OR q.supplier_id<>aw.supplier_id
         OR pr.total_amount<>d.total_amount OR pr.delivery_days<>d.delivery_days`,
  );
  add("PR 与中选报价完全一致", prMismatches === 0, prMismatches, 0);

  const relationMismatches = await count(
    `SELECT count(*)::text AS count FROM (
       SELECT sc.id FROM supplier_capabilities sc JOIN suppliers s ON s.id=sc.supplier_id WHERE sc.workspace_id<>s.workspace_id
       UNION ALL SELECT sr.id FROM sourcing_requests sr JOIN catalog_items c ON c.id=sr.item_id WHERE sr.workspace_id<>c.workspace_id
       UNION ALL SELECT a.id FROM request_attachments a JOIN sourcing_requests sr ON sr.id=a.request_id WHERE a.workspace_id<>sr.workspace_id
       UNION ALL SELECT ar.id FROM agent_runs ar JOIN sourcing_requests sr ON sr.id=ar.request_id WHERE ar.workspace_id<>sr.workspace_id
       UNION ALL SELECT am.id FROM agent_messages am JOIN sourcing_requests sr ON sr.id=am.request_id WHERE am.workspace_id<>sr.workspace_id
       UNION ALL SELECT aa.id FROM agent_actions aa JOIN sourcing_requests sr ON sr.id=aa.request_id JOIN agent_runs ar ON ar.id=aa.agent_run_id WHERE aa.workspace_id<>sr.workspace_id OR aa.workspace_id<>ar.workspace_id
       UNION ALL SELECT c.id FROM sourcing_candidates c JOIN sourcing_requests sr ON sr.id=c.request_id JOIN agent_runs ar ON ar.id=c.agent_run_id JOIN suppliers s ON s.id=c.supplier_id WHERE c.workspace_id<>sr.workspace_id OR c.workspace_id<>ar.workspace_id OR c.workspace_id<>s.workspace_id
       UNION ALL SELECT r.id FROM rfqs r JOIN sourcing_requests sr ON sr.id=r.request_id WHERE r.workspace_id<>sr.workspace_id
       UNION ALL SELECT i.id FROM rfq_invitations i JOIN rfqs r ON r.id=i.rfq_id JOIN suppliers s ON s.id=i.supplier_id WHERE i.workspace_id<>r.workspace_id OR i.workspace_id<>s.workspace_id
       UNION ALL SELECT n.id FROM notification_records n JOIN rfq_invitations i ON i.id=n.invitation_id WHERE n.workspace_id<>i.workspace_id
       UNION ALL SELECT a.id FROM external_supplier_accounts a JOIN suppliers s ON s.id=a.supplier_id WHERE a.workspace_id<>s.workspace_id
       UNION ALL SELECT q.id FROM quotes q JOIN rfqs r ON r.id=q.rfq_id JOIN rfq_invitations i ON i.id=q.invitation_id JOIN suppliers s ON s.id=q.supplier_id WHERE q.workspace_id<>r.workspace_id OR q.workspace_id<>i.workspace_id OR q.workspace_id<>s.workspace_id
       UNION ALL SELECT v.id FROM quote_versions v JOIN quotes q ON q.id=v.quote_id WHERE v.workspace_id<>q.workspace_id
       UNION ALL SELECT ce.id FROM rfq_close_events ce JOIN rfqs r ON r.id=ce.rfq_id WHERE ce.workspace_id<>r.workspace_id
       UNION ALL SELECT e.id FROM evaluations e JOIN sourcing_requests sr ON sr.id=e.request_id JOIN rfqs r ON r.id=e.rfq_id WHERE e.workspace_id<>sr.workspace_id OR e.workspace_id<>r.workspace_id
       UNION ALL SELECT ei.id FROM evaluation_items ei JOIN evaluations e ON e.id=ei.evaluation_id JOIN quotes q ON q.id=ei.quote_id WHERE ei.workspace_id<>e.workspace_id OR ei.workspace_id<>q.workspace_id OR ei.rfq_id<>e.rfq_id OR ei.rfq_id<>q.rfq_id
       UNION ALL SELECT aw.id FROM awards aw JOIN sourcing_requests sr ON sr.id=aw.request_id JOIN evaluations e ON e.id=aw.evaluation_id JOIN quotes q ON q.id=aw.quote_id JOIN suppliers s ON s.id=aw.supplier_id WHERE aw.workspace_id<>sr.workspace_id OR aw.workspace_id<>e.workspace_id OR aw.workspace_id<>q.workspace_id OR aw.workspace_id<>s.workspace_id OR q.supplier_id<>aw.supplier_id
       UNION ALL SELECT pr.id FROM purchase_requisitions pr JOIN sourcing_requests sr ON sr.id=pr.request_id JOIN rfqs r ON r.id=pr.rfq_id JOIN evaluations e ON e.id=pr.evaluation_id JOIN awards aw ON aw.id=pr.award_id JOIN quotes q ON q.id=pr.quote_id JOIN suppliers s ON s.id=pr.supplier_id WHERE pr.workspace_id<>sr.workspace_id OR pr.workspace_id<>r.workspace_id OR pr.workspace_id<>e.workspace_id OR pr.workspace_id<>aw.workspace_id OR pr.workspace_id<>q.workspace_id OR pr.workspace_id<>s.workspace_id
       UNION ALL SELECT we.id FROM workflow_events we JOIN sourcing_requests sr ON sr.id=we.request_id WHERE we.request_id IS NOT NULL AND we.workspace_id<>sr.workspace_id
     ) mismatches`,
  );
  add("外键与跨表工作区关系完整", relationMismatches === 0, relationMismatches, 0);

  const failed = checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    throw new Error(`Demo 基线断言失败：${failed.map((check) => check.name).join("；")}`);
  }
  return { ready: true, checks };
}

async function seedInTransaction(client: PoolClient, resetAt: Date, revision: number) {
  await client.query(`DELETE FROM demo_workspaces WHERE code=$1`, [WORKSPACE_CODE]);
  const ws = (await client.query<{ id: string }>(
    `INSERT INTO demo_workspaces(code,seed_version,revision,initialized_at,reset_at,updated_at)
     VALUES($1,$2,$3,$4,$4,$4) RETURNING id`,
    [WORKSPACE_CODE, SEED_VERSION, revision, resetAt],
  )).rows[0];

  const catalogIds = new Map<string, string>();
  for (const item of catalogs) {
    const row = (await client.query<{ id: string }>(
      `INSERT INTO catalog_items(workspace_id,code,name,unit,specifications,quantities,qualifications,delivery_options,quote_durations,evaluation_strategies)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [ws.id, item.code, item.name, item.unit, JSON.stringify(item.specifications), JSON.stringify(item.quantities), JSON.stringify([{ code: "NONE", label: "无特殊要求" }, { code: "ISO9001", label: "ISO 9001" }, { code: "IATF16949", label: "IATF 16949" }]), JSON.stringify([7, 15, 30]), JSON.stringify([15, 30, 60]), JSON.stringify(["BALANCED", "PRICE_FIRST", "DELIVERY_FIRST"])],
    )).rows[0];
    catalogIds.set(item.code, row.id);
  }

  const supplierIds = new Map<string, string>();
  for (let index = 0; index < suppliers.length; index++) {
    const supplier = suppliers[index];
    const row = (await client.query<{ id: string }>(
      `INSERT INTO suppliers(workspace_id,supplier_no,supplier_type,name,region,source_platform,qualifications,risk_level,history_score,platform_score,contact_name,email,phone,registration_enabled)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [ws.id, supplier.no, supplier.type, supplier.name, supplier.region, supplier.source, supplier.qualifications, supplier.risk, supplier.type === "INTERNAL" ? 92 - index : null, supplier.type === "EXTERNAL" ? 90 - index / 2 : null, `联系人${index + 1}`, `supplier${index + 1}@example.test`, `1380000${String(index + 1).padStart(4, "0")}`, supplier.registrationEnabled ?? false],
    )).rows[0];
    supplierIds.set(supplier.no, row.id);
    for (const item of supplier.items) {
      await client.query(
        `INSERT INTO supplier_capabilities(workspace_id,supplier_id,item_code,supported_qualifications,minimum_delivery_days,capacity_level,description)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [ws.id, row.id, item, supplier.qualifications, supplier.delivery, "LARGE", `具备${catalogs.find((catalog) => catalog.code === item)?.name}稳定供货能力`],
      );
    }
    if (supplier.registered) {
      await client.query(
        `INSERT INTO external_supplier_accounts(workspace_id,supplier_id,contact_name,email,password_hash,registered_at) VALUES($1,$2,$3,$4,$5,$6)`,
        [ws.id, row.id, `外部联系人${index + 1}`, `external${index + 1}@example.test`, await hashPassword("DemoPass123!"), minutesBefore(resetAt, 10_000 - index)],
      );
    }
  }

  let seededQuoteIndex = 1;
  for (const fixture of requestFixtures) {
    const timeline = timelineFor(fixture.no, resetAt);
    const catalog = catalogs.find((item) => item.code === fixture.item)!;
    const itemId = catalogIds.get(fixture.item)!;
    const spec = catalog.specifications[0];
    const request = (await client.query<{ id: string }>(
      `INSERT INTO sourcing_requests(workspace_id,request_no,item_id,item_code,item_name,specification_code,specification_snapshot,quantity,unit,qualification_codes,required_delivery_days,quote_duration_minutes,evaluation_strategy,status,is_seeded,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,60,$12,$13,true,$14,$14) RETURNING id`,
      [ws.id, fixture.no, itemId, catalog.code, catalog.name, spec.code, spec.label, fixture.quantity, catalog.unit, ["ISO9001"], fixture.delivery, fixture.strategy, fixture.status, timeline.requestCreatedAt],
    )).rows[0];

    const attachment = Buffer.from(`${fixture.no} ${catalog.name} 采购规格附件\n${spec.label}\n`, "utf8");
    await client.query(
      `INSERT INTO request_attachments(workspace_id,request_id,file_name,mime_type,size_bytes,checksum_sha256,content,created_at)
       VALUES($1,$2,$3,'text/plain; charset=utf-8',$4,$5,$6,$7)`,
      [ws.id, request.id, `${fixture.no}-采购规格.txt`, attachment.length, contentHash(attachment), attachment, minutesAfter(timeline.requestCreatedAt, 1)],
    );

    const run = (await client.query<{ id: string }>(
      `INSERT INTO agent_runs(workspace_id,request_id,run_type,status,model,prompt_version,input_snapshot,output_hash,started_at,finished_at)
       VALUES($1,$2,'SOURCING','SUCCEEDED',$3,'seed-v1',$4,$5,$6,$7) RETURNING id`,
      [ws.id, request.id, env.DEEPSEEK_MODEL, JSON.stringify({ seeded: true, itemCode: fixture.item }), stableHash({ request: fixture.no, item: fixture.item }), timeline.sourcingStartedAt, timeline.sourcingFinishedAt],
    )).rows[0];
    await client.query(
      `INSERT INTO agent_messages(workspace_id,request_id,agent_run_id,role,content,is_seeded,created_at) VALUES
       ($1,$2,$3,'USER','请根据需求匹配合适供应商。',true,$4),
       ($1,$2,$3,'ASSISTANT','已完成内部资源湖与外部平台供应商匹配，请确认候选名单。',true,$5)`,
      [ws.id, request.id, run.id, timeline.sourcingStartedAt, timeline.sourcingFinishedAt],
    );
    for (const [actionType, summary] of [["QUERY_INTERNAL_SUPPLIERS", "已查询内部资源湖"], ["QUERY_EXTERNAL_SUPPLIERS", "已查询同步自 1688、行业平台和企业信息库的供应商数据"], ["BUILD_CANDIDATE_LIST", "已形成合法候选名单"]]) {
      await client.query(
        `INSERT INTO agent_actions(workspace_id,request_id,agent_run_id,action_type,status,summary,started_at,finished_at) VALUES($1,$2,$3,$4,'SUCCEEDED',$5,$6,$7)`,
        [ws.id, request.id, run.id, actionType, summary, timeline.sourcingStartedAt, timeline.sourcingFinishedAt],
      );
    }
    const matchingSuppliers = suppliers.filter((supplier) => supplier.items.includes(fixture.item));
    const matchScores = new Map<string, number>();
    for (let index = 0; index < matchingSuppliers.length; index++) {
      const supplier = matchingSuppliers[index];
      const matchScore = 94 - index * 1.2;
      matchScores.set(supplier.no, matchScore);
      await client.query(
        `INSERT INTO sourcing_candidates(workspace_id,request_id,agent_run_id,supplier_id,supplier_type,match_score,qualification_summary,expected_delivery_days,recommendation,risk_summary)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [ws.id, request.id, run.id, supplierIds.get(supplier.no), supplier.type, matchScore, supplier.qualifications.join("、"), supplier.delivery, "供应能力和交付条件与需求匹配", supplier.risk === "LOW" ? "风险较低" : "建议关注履约计划"],
      );
    }
    await client.query(`INSERT INTO workflow_events(workspace_id,request_id,event_type,actor,summary,created_at) VALUES($1,$2,'SOURCING_COMPLETED','seed','初始化 Agent 寻源完成记录',$3)`, [ws.id, request.id, timeline.sourcingFinishedAt]);

    if (fixture.no === "SR-DEMO-0001") continue;

    const rfqNo = fixture.no.replace("SR-", "RFQ-");
    const isOpen = fixture.status === "BIDDING_OPEN";
    const closeReason = fixture.no === "SR-DEMO-0005" ? "DEADLINE_REACHED" : "EARLY_STOP";
    const rfq = (await client.query<{ id: string }>(
      `INSERT INTO rfqs(workspace_id,rfq_no,request_id,status,deadline_at,closed_at,close_reason,revealed_at,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [ws.id, rfqNo, request.id, isOpen ? "OPEN" : "CLOSED", timeline.deadlineAt, timeline.closedAt ?? null, isOpen ? null : closeReason, timeline.revealedAt ?? null, timeline.rfqCreatedAt],
    )).rows[0];

    const invitationIds = new Map<string, string>();
    for (const supplier of matchingSuppliers.slice(0, 6)) {
      const viewed = supplier.no.endsWith("004") ? null : timeline.viewedAt;
      const invitation = (await client.query<{ id: string }>(
        `INSERT INTO rfq_invitations(workspace_id,rfq_id,supplier_id,invitation_type,invited_at,viewed_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [ws.id, rfq.id, supplierIds.get(supplier.no), supplier.type, timeline.invitedAt, viewed],
      )).rows[0];
      invitationIds.set(supplier.no, invitation.id);
      await client.query(
        `INSERT INTO notification_records(workspace_id,invitation_id,recipient_address,generated_at) VALUES($1,$2,$3,$4)`,
        [ws.id, invitation.id, `${supplier.no.toLowerCase()}@example.test`, minutesAfter(timeline.invitedAt!, 1)],
      );
    }

    const quoteRows: Array<{ quoteId: string; quoteVersionId: string; supplierNo: string; payload: QuotePayload; submittedAt: Date }> = [];
    const seededQuotes = quoteAmounts[fixture.no] ?? [];
    for (let quoteIndex = 0; quoteIndex < seededQuotes.length; quoteIndex++) {
      const [supplierNo, payload] = seededQuotes[quoteIndex];
      const invitationId = invitationIds.get(supplierNo);
      if (!invitationId) continue;
      const submittedAt = minutesAfter(timeline.firstSubmittedAt!, quoteIndex);
      const supplierType = suppliers.find((supplier) => supplier.no === supplierNo)?.type;
      const competitiveness = supplierType === "EXTERNAL"
        ? quoteCompetitiveness(payload, seededQuotes.filter(([otherNo]) => otherNo !== supplierNo).map(([, other]) => other), fixture.delivery)
        : null;
      const quote = await insertQuote(client, ws.id, rfq.id, invitationId, supplierIds.get(supplierNo)!, `QT-DEMO-${String(seededQuoteIndex++).padStart(4, "0")}`, payload, submittedAt, competitiveness);
      quoteRows.push({ quoteId: quote.quoteId, quoteVersionId: quote.quoteVersionId, supplierNo, payload, submittedAt: quote.submittedAt });
    }

    if (!isOpen) {
      await client.query(
        `INSERT INTO rfq_close_events(workspace_id,rfq_id,close_reason,closed_at,revealed_quote_count,quote_count) VALUES($1,$2,$3,$4,$5,$5)`,
        [ws.id, rfq.id, closeReason, timeline.closedAt, quoteRows.length],
      );
    }

    if (fixture.status === "AWARD_PENDING" || fixture.status === "COMPLETED") {
      const evaluationRun = (await client.query<{ id: string }>(
        `INSERT INTO agent_runs(workspace_id,request_id,run_type,status,model,prompt_version,input_snapshot,output_hash,started_at,finished_at)
         VALUES($1,$2,'EVALUATION','SUCCEEDED',$3,'seed-v1',$4,$5,$6,$7) RETURNING id`,
        [ws.id, request.id, env.DEEPSEEK_MODEL, JSON.stringify({ quoteCount: quoteRows.length, seeded: true }), stableHash(quoteRows.map((quote) => quote.quoteId)), timeline.evaluationStartedAt, timeline.evaluatedAt],
      )).rows[0];
      const evaluation = (await client.query<{ id: string }>(
        `INSERT INTO evaluations(workspace_id,evaluation_no,request_id,rfq_id,agent_run_id,strategy,status,quote_set_hash,created_at,completed_at)
         VALUES($1,$2,$3,$4,$5,$6,'SUCCEEDED',$7,$8,$9) RETURNING id`,
        [ws.id, fixture.no.replace("SR-", "EV-"), request.id, rfq.id, evaluationRun.id, fixture.strategy, stableHash(quoteRows.map((quote) => quote.quoteId).sort()), timeline.evaluationStartedAt, timeline.evaluatedAt],
      )).rows[0];
      const scored = scoreSeedQuotes(quoteRows, fixture.strategy as EvaluationStrategy, fixture.delivery, matchScores);
      const evaluationActions = [
        ["LOAD_CURRENT_QUOTES", `已读取 ${quoteRows.length} 份停止报价后的最终有效报价`],
        ["VERIFY_QUOTE_SET", `${quoteRows.length} 份报价的最新版本与关闭记录数量一致`],
        ["CALCULATE_PRICE_SCORE", `已完成 ${quoteRows.length} 份报价的价格标准化评分`],
        ["CALCULATE_DELIVERY_SCORE", `已按 ${fixture.delivery} 天交付要求完成交期评分`],
        ["CALCULATE_MATCH_RISK_SCORE", `已完成 ${quoteRows.length} 家供应商的匹配度与履约风险量化`],
        ["APPLY_EVALUATION_WEIGHTS", `已按“${fixture.strategy}”策略生成 Top ${scored.length}`],
        ["ANALYZE_EVALUATION_WITH_DEEPSEEK", `DeepSeek 已生成 ${scored.length} 份推荐与风险说明`],
        ["VALIDATE_EVALUATION_OUTPUT", `DeepSeek 输出与 Top ${scored.length} 报价白名单完全一致`],
        ["SAVE_EVALUATION_RANKING", `已保存 Top ${scored.length} 报价、Agent 建议和分项得分`],
      ] as const;
      const evaluationStart = timeline.evaluationStartedAt!.getTime();
      const evaluationDuration = timeline.evaluatedAt!.getTime() - evaluationStart;
      for (let index = 0; index < evaluationActions.length; index++) {
        const [actionType, summary] = evaluationActions[index];
        const startedAt = new Date(evaluationStart + Math.floor(evaluationDuration * index / evaluationActions.length));
        const finishedAt = new Date(evaluationStart + Math.floor(evaluationDuration * (index + 0.8) / evaluationActions.length));
        await client.query(
          `INSERT INTO agent_actions(workspace_id,request_id,agent_run_id,action_type,status,hit_count,summary,started_at,finished_at) VALUES($1,$2,$3,$4,'SUCCEEDED',$5,$6,$7,$8)`,
          [ws.id, request.id, evaluationRun.id, actionType, scored.length, summary, startedAt, finishedAt],
        );
      }
      for (let index = 0; index < scored.length; index++) {
        const row = scored[index];
        await client.query(
          `INSERT INTO evaluation_items(workspace_id,evaluation_id,rfq_id,quote_id,quote_version_id,rank,price_score,delivery_score,match_score,risk_score,total_score,recommendation,risk_summary)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [ws.id, evaluation.id, rfq.id, row.quoteId, row.quoteVersionId, index + 1, row.price, row.delivery, row.match, row.risk, row.total, index === 0 ? "综合表现最佳，建议优先选择" : "可作为备选供应商", row.risk >= 100 ? "履约风险较低" : "需要关注交期承诺"],
        );
      }
      if (fixture.status === "COMPLETED") {
        const winner = scored[0];
        const award = (await client.query<{ id: string }>(
          `INSERT INTO awards(workspace_id,request_id,evaluation_id,quote_id,supplier_id,selected_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
          [ws.id, request.id, evaluation.id, winner.quoteId, supplierIds.get(winner.supplierNo), timeline.awardedAt],
        )).rows[0];
        await client.query(
          `INSERT INTO purchase_requisitions(workspace_id,pr_no,request_id,rfq_id,evaluation_id,award_id,quote_id,supplier_id,item_name,specification,quantity,unit,total_amount,delivery_days,created_at)
           VALUES($1,'PR-DEMO-0001',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [ws.id, request.id, rfq.id, evaluation.id, award.id, winner.quoteId, supplierIds.get(winner.supplierNo), catalog.name, spec.label, fixture.quantity, catalog.unit, winner.payload.totalAmount, winner.payload.deliveryDays, timeline.prCreatedAt],
        );
      }
    }
  }

  await assertDemoBaseline(client);
  return { workspaceCode: WORKSPACE_CODE, revision, seedVersion: SEED_VERSION, resetAt: resetAt.toISOString() };
}

async function resetDemoInTransaction(client: PoolClient) {
  await lockWorkspaceLifecycleForTransaction(client);
  const current = (await client.query<{ revision: string }>(
    "SELECT revision::text FROM demo_workspaces WHERE code=$1 FOR UPDATE",
    [WORKSPACE_CODE],
  )).rows[0];
  const resetAt = (await client.query<{ reset_at: Date }>("SELECT clock_timestamp() AS reset_at")).rows[0].reset_at;
  return seedInTransaction(client, resetAt, current ? Number(current.revision) + 1 : 1);
}

export async function resetDemo(transactionClient?: PoolClient) {
  await migrate();
  if (transactionClient) return resetDemoInTransaction(transactionClient);
  return withTransaction(resetDemoInTransaction);
}

async function initializeDemoInTransaction(client: PoolClient) {
  await lockWorkspaceLifecycleForTransaction(client);
  await migrateLegacyQuoteVersions(client);
  const attachments = await client.query<{ id: string; checksum_sha256: string; content: Buffer }>(
    `SELECT attachment.id,attachment.checksum_sha256,attachment.content
       FROM request_attachments attachment
       JOIN demo_workspaces workspace ON workspace.id=attachment.workspace_id
      WHERE workspace.code=$1`,
    [WORKSPACE_CODE],
  );
  for (const attachment of attachments.rows) {
    const checksum = contentHash(attachment.content);
    if (checksum !== attachment.checksum_sha256) {
      await client.query(`UPDATE request_attachments SET checksum_sha256=$1 WHERE id=$2`, [checksum, attachment.id]);
    }
  }
  const current = (await client.query<{ revision: string; seed_version: string; reset_at: Date | null }>(
    "SELECT revision::text,seed_version,reset_at FROM demo_workspaces WHERE code=$1 FOR UPDATE",
    [WORKSPACE_CODE],
  )).rows[0];
  if (current?.seed_version === SEED_VERSION) {
    return {
      workspaceCode: WORKSPACE_CODE,
      revision: Number(current.revision),
      seedVersion: current.seed_version,
      resetAt: current.reset_at?.toISOString() ?? null,
      initialized: false as const,
    };
  }
  const resetAt = (await client.query<{ reset_at: Date }>("SELECT clock_timestamp() AS reset_at")).rows[0].reset_at;
  const result = await seedInTransaction(client, resetAt, current ? Number(current.revision) + 1 : 1);
  return { ...result, initialized: true as const };
}

export async function initializeDemo(transactionClient?: PoolClient) {
  await migrate();
  if (transactionClient) return initializeDemoInTransaction(transactionClient);
  return withTransaction(initializeDemoInTransaction);
}

export { catalogs, suppliers };
