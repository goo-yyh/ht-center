import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { AgentMessageIntent } from "@haitian/sourcing-contracts";
import {
  acquireWorkspaceLifecycleLock,
  bumpRevision,
  maybeWorkspace,
  one,
  pool,
  releaseWorkspaceLifecycleLock,
  withTransaction,
  workspace,
} from "./db";
import { ApiError } from "./errors";
import {
  classifyAgentIntent,
  describeEvaluation,
  sourceCandidatesWithTools,
  type SourcingToolCall,
  type SourcingToolExecutionResult,
} from "./deepseek";
import {
  contentHash,
  hashPassword,
  idempotencyAad,
  isSealedJsonSnapshot,
  openJsonSnapshot,
  sealJsonSnapshot,
  stableHash,
} from "./crypto";
import { ACTIVE_DEMO_RFQ_DEADLINE, env, WORKSPACE_CODE } from "./env";
import { getRequestDetail } from "./queries";
import {
  checkSupplierDeliveryApi,
  checkSupplierQualificationsApi,
  query1688SupplierApi,
  queryIndustryPlatformCrawlerApi,
  queryInternalSupplierApi,
  queryQichachaSupplierApi,
  type CandidateRow,
} from "./sourcing-tools";

export const createRequestSchema = z.object({
  itemCode: z.string().min(1),
  specificationCode: z.string().min(1),
  quantityCode: z.string().optional(),
  quantity: z.coerce.number().positive().optional(),
  qualificationCodes: z.array(z.string()).default(["NONE"]),
  requiredDeliveryDays: z.coerce.number().int().positive(),
  quoteDurationMinutes: z.coerce.number().int().refine((value) => [15, 30, 60].includes(value)),
  evaluationStrategy: z.enum(["BALANCED", "PRICE_FIRST", "DELIVERY_FIRST"]),
  attachment: z.object({ fileName: z.string().min(1), mimeType: z.string().min(1), contentBase64: z.string() }).optional(),
}).refine((value) => value.quantityCode || value.quantity, { message: "必须选择采购数量" });

export const agentMessageSchema = z.object({ message: z.string().trim().min(1).max(1000) });
export const quoteSchema = z.object({
  totalAmount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/).refine((value) => Number(value) > 0, { message: "报价金额必须大于 0" }),
  deliveryDays: z.coerce.number().int().positive().max(365),
  remark: z.string().max(500).default(""),
});
export const registerSchema = z.object({ contactName: z.string().trim().min(2).max(50), email: z.string().email().max(200), password: z.string().min(8).max(100) });
export const awardSchema = z.object({ quoteNo: z.string().min(1) });

async function event(client: PoolClient, workspaceId: string, requestId: string | null, eventType: string, actor: string, summary: string, data: unknown = {}) {
  await client.query(`INSERT INTO workflow_events(workspace_id,request_id,event_type,actor,summary,event_data) VALUES($1,$2,$3,$4,$5,$6)`, [workspaceId, requestId, eventType, actor, summary, JSON.stringify(data)]);
}

function normalizeMoney(value: string) {
  const [integer, decimals = ""] = value.split(".");
  return `${BigInt(integer).toString()}.${decimals.padEnd(2, "0")}`;
}

export async function createRequest(input: z.infer<typeof createRequestSchema>) {
  const parsed = createRequestSchema.parse(input);
  const requestNo = await withTransaction(async (client) => {
    const ws = await workspace(client, true);
    const catalog = await one<{ id: string; name: string; unit: string; specifications: Array<{ code: string; label: string }>; quantities: Array<{ code: string; value: number }> ; qualifications: Array<{ code: string }>; delivery_options: number[]; quote_durations: number[]; evaluation_strategies: string[] }>(
      client, `SELECT id,name,unit,specifications,quantities,qualifications,delivery_options,quote_durations,evaluation_strategies FROM catalog_items WHERE workspace_id=$1 AND code=$2 AND enabled=true`, [ws.id, parsed.itemCode],
    );
    const specification = catalog.specifications.find((entry) => entry.code === parsed.specificationCode);
    const quantity = parsed.quantityCode ? catalog.quantities.find((entry) => entry.code === parsed.quantityCode)?.value : catalog.quantities.find((entry) => entry.value === parsed.quantity)?.value;
    if (!specification || !quantity || !catalog.delivery_options.includes(parsed.requiredDeliveryDays) || !catalog.quote_durations.includes(parsed.quoteDurationMinutes) || !catalog.evaluation_strategies.includes(parsed.evaluationStrategy)) {
      throw new ApiError("INVALID_INPUT", "请选择目录中提供的固定选项", 400);
    }
    const allowedQualifications = new Set(catalog.qualifications.map((entry) => entry.code));
    if (parsed.qualificationCodes.some((entry) => !allowedQualifications.has(entry))) throw new ApiError("INVALID_INPUT", "供应商资质不是允许的固定选项", 400);
    const next = Number(ws.revision) + 1;
    const businessNo = `SR-LIVE-${String(next).padStart(4, "0")}`;
    const row = await one<{ id: string }>(client, `
      INSERT INTO sourcing_requests(workspace_id,request_no,item_id,item_code,item_name,specification_code,specification_snapshot,quantity,unit,qualification_codes,required_delivery_days,quote_duration_minutes,evaluation_strategy,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'SOURCING_RUNNING') RETURNING id`,
      [ws.id, businessNo, catalog.id, parsed.itemCode, catalog.name, parsed.specificationCode, specification.label, quantity, catalog.unit, parsed.qualificationCodes, parsed.requiredDeliveryDays, parsed.quoteDurationMinutes, parsed.evaluationStrategy]);
    if (parsed.attachment) {
      const content = Buffer.from(parsed.attachment.contentBase64, "base64");
      if (content.length > 5 * 1024 * 1024) throw new ApiError("INVALID_INPUT", "采购附件不能超过 5 MB", 400);
      await client.query(`INSERT INTO request_attachments(workspace_id,request_id,file_name,mime_type,size_bytes,checksum_sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7)`, [ws.id, row.id, parsed.attachment.fileName, parsed.attachment.mimeType, content.length, contentHash(content), content]);
    }
    await event(client, ws.id, row.id, "REQUEST_CREATED", "buyer", "创建寻源需求", { requestNo: businessNo });
    await bumpRevision(client, ws.id);
    return businessNo;
  });
  return getRequestDetail(requestNo);
}

type AgentActionContext = { workspaceId: string; requestId: string; runId: string };

function normalizedAgentError(error: unknown) {
  return error instanceof ApiError ? error : new ApiError("AGENT_SERVICE_UNAVAILABLE", "Agent 服务不可用", 503);
}

async function startAgentAction(context: AgentActionContext, actionType: string, summary: string) {
  return withTransaction(async (client) => {
    const ws = await workspace(client, true);
    const run = await one<{ status: string }>(client, `SELECT status FROM agent_runs WHERE id=$1 AND request_id=$2 AND workspace_id=$3 FOR UPDATE`, [context.runId, context.requestId, ws.id]);
    if (run.status !== "RUNNING") throw new ApiError("ILLEGAL_STATE_TRANSITION", "Agent 运行已经结束，不能继续写入步骤", 409);
    const action = await one<{ id: string }>(client, `INSERT INTO agent_actions(workspace_id,request_id,agent_run_id,action_type,status,summary) VALUES($1,$2,$3,$4,'RUNNING',$5) RETURNING id`, [ws.id, context.requestId, context.runId, actionType, summary]);
    await bumpRevision(client, ws.id);
    return action.id;
  });
}

async function completeAgentAction(context: AgentActionContext, actionId: string, summary: string, hitCount: number | null = null) {
  await withTransaction(async (client) => {
    const ws = await workspace(client, true);
    const updated = await client.query(`UPDATE agent_actions SET status='SUCCEEDED',hit_count=$4,summary=$5,finished_at=clock_timestamp() WHERE id=$1 AND request_id=$2 AND agent_run_id=$3 AND status='RUNNING'`, [actionId, context.requestId, context.runId, hitCount, summary]);
    if (updated.rowCount !== 1) throw new ApiError("ILLEGAL_STATE_TRANSITION", "Agent 步骤已经结束，不能重复完成", 409);
    await bumpRevision(client, ws.id);
  });
}

async function failAgentAction(context: AgentActionContext, actionId: string, error: unknown) {
  const apiError = normalizedAgentError(error);
  await withTransaction(async (client) => {
    const ws = await workspace(client, true);
    const updated = await client.query(`UPDATE agent_actions SET status='FAILED',summary=$4,finished_at=clock_timestamp() WHERE id=$1 AND request_id=$2 AND agent_run_id=$3 AND status='RUNNING'`, [actionId, context.requestId, context.runId, apiError.message]);
    if (updated.rowCount) await bumpRevision(client, ws.id);
  });
}

async function executeAgentAction<T>(
  context: AgentActionContext,
  actionType: string,
  runningSummary: string,
  work: () => Promise<T>,
  completed: (result: T) => { summary: string; hitCount?: number | null },
  minimumVisibleMs = 0,
) {
  const actionId = await startAgentAction(context, actionType, runningSummary);
  const startedAt = performance.now();
  try {
    const result = await work();
    const remainingVisibleMs = minimumVisibleMs - (performance.now() - startedAt);
    if (remainingVisibleMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remainingVisibleMs));
    }
    const outcome = completed(result);
    await completeAgentAction(context, actionId, outcome.summary, outcome.hitCount ?? null);
    return result;
  } catch (error) {
    await failAgentAction(context, actionId, error).catch(() => undefined);
    throw error;
  }
}

function assertExactSupplierNumbers(actual: string[], rows: CandidateRow[], toolName: string) {
  const uniqueActual = [...new Set(actual)].sort();
  const expected = rows.map((row) => row.supplier_no).sort();
  if (uniqueActual.length !== actual.length || uniqueActual.length !== expected.length || uniqueActual.some((value, index) => value !== expected[index])) {
    throw new ApiError("AGENT_OUTPUT_INVALID", `模型调用 ${toolName} 时未原样传递全部供应商编号`, 502);
  }
}

function toSourcingToolResult(summary: string, rows: CandidateRow[]): SourcingToolExecutionResult {
  return {
    summary,
    suppliers: rows.map((row) => ({
      supplierNo: row.supplier_no,
      supplierType: row.supplier_type,
      name: row.name,
      region: row.region,
      sourcePlatform: row.source_platform,
      qualifications: row.qualifications,
      riskLevel: row.risk_level,
      minimumDeliveryDays: row.minimum_delivery_days,
      matchScore: row.match_score,
    })),
  };
}

type SourcingRecoverySnapshot = CurrentSourcingSelection & {
  item_id: string;
  item_name: string;
  specification_snapshot: string;
  unit: string;
  originalStatus: string;
};

async function failSourcingRun(context: AgentActionContext, error: unknown, recovery: SourcingRecoverySnapshot) {
  const apiError = normalizedAgentError(error);
  await withTransaction(async (client) => {
    const ws = await workspace(client, true);
    const preservePreviousCandidates = recovery.originalStatus === "SOURCING_READY";
    const updated = await client.query(
      `UPDATE agent_runs
          SET status='FAILED',error_code=$2,error_message=$3,
              input_snapshot=input_snapshot || $4::jsonb,finished_at=clock_timestamp()
        WHERE id=$1 AND status='RUNNING'`,
      [context.runId, apiError.code, apiError.message, JSON.stringify({ preservePreviousCandidates, recoveredRequestStatus: recovery.originalStatus })],
    );
    if (!updated.rowCount) return;
    await client.query(`UPDATE agent_actions SET status='FAILED',summary=$2,finished_at=clock_timestamp() WHERE agent_run_id=$1 AND status='RUNNING'`, [context.runId, apiError.message]);
    await client.query(
      `UPDATE sourcing_requests
          SET item_id=$2,item_code=$3,item_name=$4,specification_code=$5,specification_snapshot=$6,
              quantity=$7,unit=$8,qualification_codes=$9,required_delivery_days=$10,
              quote_duration_minutes=$11,evaluation_strategy=$12,status=$13,
              version=version+CASE WHEN ROW(item_id,item_code,item_name,specification_code,specification_snapshot,quantity,unit,qualification_codes,required_delivery_days,quote_duration_minutes,evaluation_strategy,status)
                IS DISTINCT FROM ROW($2::uuid,$3::text,$4::text,$5::text,$6::text,$7::numeric,$8::text,$9::text[],$10::integer,$11::integer,$12::text,$13::text) THEN 1 ELSE 0 END,
              updated_at=clock_timestamp()
        WHERE id=$1`,
      [
        context.requestId,
        recovery.item_id,
        recovery.item_code,
        recovery.item_name,
        recovery.specification_code,
        recovery.specification_snapshot,
        recovery.quantity,
        recovery.unit,
        recovery.qualification_codes,
        recovery.required_delivery_days,
        recovery.quote_duration_minutes,
        recovery.evaluation_strategy,
        recovery.originalStatus,
      ],
    );
    await event(client, ws.id, context.requestId, "AGENT_SOURCING_FAILED", "agent", apiError.message, { runId: context.runId, errorCode: apiError.code });
    await bumpRevision(client, ws.id);
  });
}

type CatalogRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  specifications: Array<{ code: string; label: string }>;
  quantities: Array<{ code: string; label: string; value: number }>;
  qualifications: Array<{ code: string; label: string }>;
  delivery_options: number[];
  quote_durations: number[];
  evaluation_strategies: Array<"BALANCED" | "PRICE_FIRST" | "DELIVERY_FIRST">;
};

type CurrentSourcingSelection = {
  item_code: string;
  specification_code: string;
  quantity: number;
  qualification_codes: string[];
  required_delivery_days: number;
  quote_duration_minutes: number;
  evaluation_strategy: "BALANCED" | "PRICE_FIRST" | "DELIVERY_FIRST";
};

type FixedAdjustment = {
  itemCode?: string;
  specificationCode?: string;
  quantity?: number;
  candidateLimit?: number;
  deliveryDays?: number;
  qualificationCodes?: string[];
  quoteDurationMinutes?: number;
  evaluationStrategy?: "BALANCED" | "PRICE_FIRST" | "DELIVERY_FIRST";
  summary?: string;
  unsupportedReason?: string;
};

const catalogAliases: Record<string, string[]> = {
  "ITEM-BOLT-M12": ["M12螺栓", "镀锌螺栓", "螺栓"],
  "ITEM-PLATE-Q235": ["Q235钢板", "Q235B钢板", "钢板"],
  "ITEM-VALVE-HCV": ["液压控制阀", "液压阀", "控制阀"],
};

const evaluationStrategyLabels: Record<CurrentSourcingSelection["evaluation_strategy"], string> = {
  BALANCED: "综合平衡",
  PRICE_FIRST: "价格优先",
  DELIVERY_FIRST: "交付优先",
};

function normalizedOption(value: string) {
  return value.toUpperCase().replace(/[\s,，、/／_.:：-]/g, "");
}

function messageIncludesOption(message: string, value: string) {
  return normalizedOption(message).includes(normalizedOption(value));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function asksModelIdentity(message: string) {
  return /(?:你|agent|助手).{0,10}(?:什么|哪个).{0,6}模型|(?:什么|哪个).{0,6}模型|模型.{0,6}(?:名称|版本)/i.test(message);
}

function parseFixedAdjustment(message: string, catalogs: CatalogRow[], current: CurrentSourcingSelection): FixedAdjustment {
  const adjustment: FixedAdjustment = {};
  const summaries: string[] = [];
  const currentCatalog = catalogs.find((catalog) => catalog.code === current.item_code);
  if (!currentCatalog) return { unsupportedReason: "当前采购物品已不在可用目录中，本次未修改需求。" };

  const matchingCatalogs = catalogs.filter((catalog) => [
    catalog.code,
    catalog.name,
    ...(catalogAliases[catalog.code] ?? []),
    ...catalog.specifications.flatMap((specification) => [specification.code, specification.label]),
  ].some((option) => messageIncludesOption(message, option)));
  if (matchingCatalogs.length > 1) return { unsupportedReason: "一次只能选择一个采购物品及其关联规格，本次未修改需求。" };
  const targetCatalog = matchingCatalogs[0] ?? currentCatalog;
  const itemChanged = targetCatalog.code !== currentCatalog.code;
  if (itemChanged) {
    adjustment.itemCode = targetCatalog.code;
    summaries.push(`采购物品调整为 ${targetCatalog.name}`);
  }

  const matchingSpecifications = targetCatalog.specifications.filter((option) => [option.code, option.label].some((value) => messageIncludesOption(message, value)));
  if (matchingSpecifications.length > 1) return { unsupportedReason: "一次只能选择一个目录规格，本次未修改需求。" };
  if (/(规格|型号)/.test(message) && /(改成|改为|调整|换成|选择)/.test(message) && matchingSpecifications.length === 0 && !itemChanged) {
    return { unsupportedReason: `规格只支持 ${targetCatalog.specifications.map((option) => option.label).join("、")}，本次未修改需求。` };
  }
  const targetSpecification = matchingSpecifications[0]
    ?? (itemChanged ? targetCatalog.specifications[0] : targetCatalog.specifications.find((option) => option.code === current.specification_code));
  if (!targetSpecification) return { unsupportedReason: "采购物品没有可用的关联规格，本次未修改需求。" };
  if (itemChanged || targetSpecification.code !== current.specification_code) {
    adjustment.specificationCode = targetSpecification.code;
    summaries.push(`规格调整为 ${targetSpecification.label}`);
  }

  const quantityTierAliases: Record<string, string[]> = {
    SMALL: ["小批量"],
    MEDIUM: ["中批量"],
    LARGE: ["大批量"],
  };
  const tierMatches = targetCatalog.quantities.filter((option) => [option.code, option.label, ...(quantityTierAliases[option.code] ?? [])].some((value) => messageIncludesOption(message, value)));
  const numericQuantityMatches = [...message.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(件|吨|套)/g)]
    .filter((match) => match[2] === targetCatalog.unit)
    .map((match) => Number(match[1].replace(/,/g, "")));
  const explicitQuantityValues = unique([...tierMatches.map((option) => option.value), ...numericQuantityMatches]);
  if (explicitQuantityValues.length > 1) return { unsupportedReason: "一次只能选择一个采购数量档位，本次未修改需求。" };
  if (explicitQuantityValues.length === 1 && !targetCatalog.quantities.some((option) => option.value === explicitQuantityValues[0])) {
    return { unsupportedReason: `采购数量只支持 ${targetCatalog.quantities.map((option) => option.label).join("、")}，本次未修改需求。` };
  }
  const currentQuantityTier = currentCatalog.quantities.find((option) => option.value === current.quantity)?.code;
  const targetQuantity = explicitQuantityValues[0]
    ?? (itemChanged ? targetCatalog.quantities.find((option) => option.code === currentQuantityTier)?.value ?? targetCatalog.quantities[0]?.value : current.quantity);
  if (!targetQuantity || !targetCatalog.quantities.some((option) => option.value === targetQuantity)) {
    return { unsupportedReason: "采购数量不在所选物品的固定档位中，本次未修改需求。" };
  }
  if (itemChanged || targetQuantity !== current.quantity) {
    adjustment.quantity = targetQuantity;
    summaries.push(`采购数量调整为 ${targetCatalog.quantities.find((option) => option.value === targetQuantity)?.label ?? `${targetQuantity} ${targetCatalog.unit}`}`);
  }

  const candidateLimitMatches = unique(
    [...message.matchAll(/(?:精简(?:为|到)?|保留|只要|限定(?:为|到)?|限制(?:为|到)?|推荐)\s*(\d{1,2})\s*家(?:候选)?供应商/g)]
      .map((match) => Number(match[1])),
  );
  if (candidateLimitMatches.length > 1) return { unsupportedReason: "一次只能指定一个候选供应商数量，本次未修改需求。" };
  if (candidateLimitMatches.length === 1) {
    const candidateLimit = candidateLimitMatches[0];
    if (candidateLimit < 1 || candidateLimit > 10) {
      return { unsupportedReason: "候选供应商数量只支持 1 至 10 家，本次未修改需求。" };
    }
    adjustment.candidateLimit = candidateLimit;
    summaries.push(`候选供应商精简为最多 ${candidateLimit} 家`);
  }

  const noQualificationRequested = /(无特殊要求|无特殊资质|无资质要求|不要求资质|取消资质要求|\bNONE\b)/i.test(message);
  const mentionedQualificationCodes = targetCatalog.qualifications
    .filter((option) => option.code !== "NONE" && [option.code, option.label].some((value) => messageIncludesOption(message, value)))
    .map((option) => option.code);
  const mentionsQualificationChange = /资质/.test(message) && /(改成|改为|调整|增加|新增|只要|仅限|删除|取消|不要求|无特殊)/.test(message);
  if (mentionsQualificationChange && !noQualificationRequested && mentionedQualificationCodes.length === 0) {
    return { unsupportedReason: `供应商资质只支持 ${targetCatalog.qualifications.map((option) => option.label).join("、")}，本次未修改需求。` };
  }
  if (noQualificationRequested) {
    adjustment.qualificationCodes = ["NONE"];
  } else if (mentionedQualificationCodes.length) {
    const currentQualifications = current.qualification_codes.filter((code) => code !== "NONE" && targetCatalog.qualifications.some((option) => option.code === code));
    if (/(增加|新增|同时)/.test(message)) {
      adjustment.qualificationCodes = unique([...currentQualifications, ...mentionedQualificationCodes]);
    } else if (/(删除|取消)/.test(message)) {
      const remaining = currentQualifications.filter((code) => !mentionedQualificationCodes.includes(code));
      adjustment.qualificationCodes = remaining.length ? remaining : ["NONE"];
    } else {
      adjustment.qualificationCodes = unique(mentionedQualificationCodes);
    }
  } else if (itemChanged) {
    const retained = current.qualification_codes.filter((code) => targetCatalog.qualifications.some((option) => option.code === code));
    adjustment.qualificationCodes = retained.length ? retained : ["NONE"];
  }
  if (adjustment.qualificationCodes) {
    summaries.push(`供应商资质调整为 ${adjustment.qualificationCodes.map((code) => targetCatalog.qualifications.find((option) => option.code === code)?.label ?? code).join("、")}`);
  }

  const deliveryMatches = unique([...message.matchAll(/(\d{1,3})\s*天/g)].map((match) => Number(match[1])));
  if (deliveryMatches.length > 1) return { unsupportedReason: "一次只能选择一个交付周期，本次未修改需求。" };
  if (deliveryMatches.length === 1) {
    const days = deliveryMatches[0];
    if (!targetCatalog.delivery_options.includes(days)) {
      return { unsupportedReason: `交付要求只支持 ${targetCatalog.delivery_options.map((value) => `${value} 天内`).join("、")}，本次未修改需求。` };
    }
    adjustment.deliveryDays = days;
    summaries.push(`交付要求调整为 ${days} 天内`);
  } else if (itemChanged && !targetCatalog.delivery_options.includes(current.required_delivery_days)) {
    adjustment.deliveryDays = targetCatalog.delivery_options[0];
    summaries.push(`交付要求调整为 ${targetCatalog.delivery_options[0]} 天内`);
  }

  const quoteDurationMatches = unique([
    ...[...message.matchAll(/(\d{1,3})\s*分钟/g)].map((match) => Number(match[1])),
    ...[...message.matchAll(/(\d+(?:\.\d+)?)\s*小时/g)].map((match) => Number(match[1]) * 60),
  ]);
  if (quoteDurationMatches.length > 1) return { unsupportedReason: "一次只能选择一个报价时长，本次未修改需求。" };
  if (quoteDurationMatches.length === 1) {
    const minutes = quoteDurationMatches[0];
    if (!targetCatalog.quote_durations.includes(minutes)) {
      return { unsupportedReason: `报价时长只支持 ${targetCatalog.quote_durations.map((value) => `${value} 分钟`).join("、")}，本次未修改需求。` };
    }
    adjustment.quoteDurationMinutes = minutes;
    summaries.push(`报价时长调整为 ${minutes} 分钟`);
  } else if (itemChanged && !targetCatalog.quote_durations.includes(current.quote_duration_minutes)) {
    adjustment.quoteDurationMinutes = targetCatalog.quote_durations[0];
    summaries.push(`报价时长调整为 ${targetCatalog.quote_durations[0]} 分钟`);
  }

  const strategyMatches = unique(([
    ["BALANCED", ["BALANCED", "综合平衡", "均衡评估", "平衡策略"]],
    ["PRICE_FIRST", ["PRICE_FIRST", "价格优先", "低价优先"]],
    ["DELIVERY_FIRST", ["DELIVERY_FIRST", "交付优先", "交期优先"]],
  ] as const).filter(([, aliases]) => aliases.some((alias) => messageIncludesOption(message, alias))).map(([strategy]) => strategy));
  if (strategyMatches.length > 1) return { unsupportedReason: "一次只能选择一种评估策略，本次未修改需求。" };
  if (strategyMatches.length === 1) {
    const strategy = strategyMatches[0];
    if (!targetCatalog.evaluation_strategies.includes(strategy)) return { unsupportedReason: "评估策略不在所选物品的固定选项中，本次未修改需求。" };
    adjustment.evaluationStrategy = strategy;
    summaries.push(`评估策略调整为 ${evaluationStrategyLabels[strategy]}`);
  } else if (itemChanged && !targetCatalog.evaluation_strategies.includes(current.evaluation_strategy)) {
    adjustment.evaluationStrategy = targetCatalog.evaluation_strategies[0];
    summaries.push(`评估策略调整为 ${evaluationStrategyLabels[targetCatalog.evaluation_strategies[0]]}`);
  }

  const looksLikeUnsupportedAdjustment = /(改成|改为|调整|增加|新增|只要|仅限|删除|取消)/.test(message)
    && adjustment.itemCode == null
    && adjustment.specificationCode == null
    && adjustment.quantity == null
    && adjustment.candidateLimit == null
    && adjustment.deliveryDays == null
    && adjustment.qualificationCodes == null
    && adjustment.quoteDurationMinutes == null
    && adjustment.evaluationStrategy == null;
  if (looksLikeUnsupportedAdjustment) {
    return { unsupportedReason: "该调整不在采购目录提供的物品、规格、数量、资质、交付、报价时长或评估策略固定选项中，本次未修改需求。" };
  }
  adjustment.summary = summaries.join("；");
  return adjustment;
}

type PreparedSourcingSelection =
  | { kind: "unsupported"; reason: string }
  | {
      kind: "ready";
      catalog: CatalogRow;
      specification: { code: string; label: string };
      quantity: number;
      candidateLimit: number | null;
      deliveryDays: number;
      qualificationCodes: string[];
      quoteDurationMinutes: number;
      evaluationStrategy: CurrentSourcingSelection["evaluation_strategy"];
      adjustmentSummary: string;
      changed: boolean;
    };

function prepareSourcingSelection(message: string, catalogs: CatalogRow[], current: CurrentSourcingSelection): PreparedSourcingSelection {
  const adjustment = parseFixedAdjustment(message, catalogs, current);
  if (adjustment.unsupportedReason) return { kind: "unsupported", reason: adjustment.unsupportedReason };
  const catalog = catalogs.find((entry) => entry.code === (adjustment.itemCode ?? current.item_code));
  if (!catalog) throw new ApiError("INVALID_INPUT", "采购物品不在可用固定目录中", 400);
  const specification = catalog.specifications.find((option) => option.code === (adjustment.specificationCode ?? current.specification_code));
  const quantity = adjustment.quantity ?? current.quantity;
  const deliveryDays = adjustment.deliveryDays ?? current.required_delivery_days;
  const qualificationCodes = adjustment.qualificationCodes ?? current.qualification_codes;
  const quoteDurationMinutes = adjustment.quoteDurationMinutes ?? current.quote_duration_minutes;
  const evaluationStrategy = adjustment.evaluationStrategy ?? current.evaluation_strategy;
  const allowedQualificationCodes = new Set(catalog.qualifications.map((option) => option.code));
  if (!specification
    || !catalog.quantities.some((option) => option.value === quantity)
    || qualificationCodes.length === 0
    || qualificationCodes.some((code) => !allowedQualificationCodes.has(code))
    || (qualificationCodes.includes("NONE") && qualificationCodes.length > 1)
    || !catalog.delivery_options.includes(deliveryDays)
    || !catalog.quote_durations.includes(quoteDurationMinutes)
    || !catalog.evaluation_strategies.includes(evaluationStrategy)) {
    throw new ApiError("INVALID_INPUT", "Agent 调整结果未通过采购目录固定选项校验", 400);
  }
  const changed = catalog.code !== current.item_code
    || specification.code !== current.specification_code
    || quantity !== current.quantity
    || deliveryDays !== current.required_delivery_days
    || JSON.stringify(qualificationCodes) !== JSON.stringify(current.qualification_codes)
    || quoteDurationMinutes !== current.quote_duration_minutes
    || evaluationStrategy !== current.evaluation_strategy;
  return {
    kind: "ready",
    catalog,
    specification,
    quantity,
    candidateLimit: adjustment.candidateLimit ?? null,
    deliveryDays,
    qualificationCodes,
    quoteDurationMinutes,
    evaluationStrategy,
    adjustmentSummary: adjustment.summary || "",
    changed,
  };
}

export async function runSourcingAgent(requestNo: string, body: z.infer<typeof agentMessageSchema>) {
  const parsed = agentMessageSchema.parse(body);
  const setup = await withTransaction(async (client) => {
    const ws = await workspace(client, true);
    const request = await one<{
      id: string;
      status: string;
      item_id: string;
      item_code: string;
      item_name: string;
      specification_code: string;
      specification_snapshot: string;
      quantity: number;
      unit: string;
      required_delivery_days: number;
      qualification_codes: string[];
      quote_duration_minutes: number;
      evaluation_strategy: CurrentSourcingSelection["evaluation_strategy"];
    }>(client, `SELECT sr.id,sr.status,sr.item_id,sr.item_code,sr.item_name,sr.specification_code,sr.specification_snapshot,sr.quantity::float8 AS quantity,sr.unit,sr.required_delivery_days,sr.qualification_codes,sr.quote_duration_minutes,sr.evaluation_strategy FROM sourcing_requests sr WHERE sr.workspace_id=$1 AND sr.request_no=$2 FOR UPDATE OF sr`, [ws.id, requestNo]);
    if (!["SOURCING_RUNNING", "SOURCING_READY"].includes(request.status)) throw new ApiError("ILLEGAL_STATE_TRANSITION", "当前阶段不能重新执行寻源", 409);
    const activeRun = (await client.query(`SELECT id FROM agent_runs WHERE request_id=$1 AND run_type='SOURCING' AND status='RUNNING' ORDER BY started_at DESC LIMIT 1`, [request.id])).rows[0];
    if (activeRun) throw new ApiError("ILLEGAL_STATE_TRANSITION", "当前需求的寻源 Agent 正在运行，请等待本轮完成", 409);
    const catalogs = (await client.query<CatalogRow>(`SELECT id,code,name,unit,specifications,quantities,qualifications,delivery_options,quote_durations,evaluation_strategies FROM catalog_items WHERE workspace_id=$1 AND enabled=true ORDER BY code`, [ws.id])).rows;
    const conversation = (await client.query<{ role: "USER" | "ASSISTANT" | "SYSTEM_RESULT"; content: string }>(`
      SELECT role,content FROM (
        SELECT id,role,content,created_at FROM agent_messages WHERE request_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20
      ) recent ORDER BY created_at,id`, [request.id])).rows;
    const run = await one<{ id: string }>(client, `INSERT INTO agent_runs(workspace_id,request_id,run_type,status,model,prompt_version,input_snapshot) VALUES($1,$2,'SOURCING','RUNNING',$3,'sourcing-v4',$4) RETURNING id`, [ws.id, request.id, env.DEEPSEEK_MODEL, JSON.stringify({ message: parsed.message, conversation, originalStatus: request.status, intent: "PENDING", preservePreviousCandidates: true })]);
    await client.query(`INSERT INTO agent_messages(workspace_id,request_id,agent_run_id,role,content) VALUES($1,$2,$3,'USER',$4)`, [ws.id, request.id, run.id, parsed.message]);
    const intentAction = await one<{ id: string }>(client, `INSERT INTO agent_actions(workspace_id,request_id,agent_run_id,action_type,status,summary) VALUES($1,$2,$3,'CLASSIFY_AGENT_INTENT','RUNNING','正在调用模型识别本轮对话意图') RETURNING id`, [ws.id, request.id, run.id]);
    await event(client, ws.id, request.id, "AGENT_MESSAGE_RECEIVED", "buyer", "寻源 Agent 收到采购人员消息", { runId: run.id });
    await bumpRevision(client, ws.id);
    return {
      ...request,
      originalStatus: request.status,
      catalogs,
      conversation,
      workspaceId: ws.id,
      runId: run.id,
      intentActionId: intentAction.id,
    };
  });
  const context: AgentActionContext = { workspaceId: setup.workspaceId, requestId: setup.id, runId: setup.runId };
  try {
    let intentResult: Awaited<ReturnType<typeof classifyAgentIntent>>;
    let intent: AgentMessageIntent;
    try {
      intentResult = await classifyAgentIntent({
        message: parsed.message,
        request: {
          requestNo,
          itemCode: setup.item_code,
          itemName: setup.item_name,
          specificationCode: setup.specification_code,
          specification: setup.specification_snapshot,
          quantity: setup.quantity,
          unit: setup.unit,
          qualificationCodes: setup.qualification_codes,
          requiredDeliveryDays: setup.required_delivery_days,
          quoteDurationMinutes: setup.quote_duration_minutes,
          evaluationStrategy: setup.evaluation_strategy,
        },
        conversation: setup.conversation,
        assistant: { name: "海天寻源 Agent", scope: "企业采购寻源" },
      });
      intent = asksModelIdentity(parsed.message) ? "CONVERSATION" : intentResult.value.intent;
      const preservesCandidates = intent === "CONVERSATION" || intent === "OUT_OF_SCOPE";
      await withTransaction(async (client) => {
        const ws = await workspace(client, true);
        await client.query(`UPDATE agent_runs SET model=$2,provider_request_id=$3,input_snapshot=input_snapshot || $4::jsonb WHERE id=$1 AND status='RUNNING'`, [setup.runId, intentResult.model, intentResult.providerRequestId, JSON.stringify({ intent, preservePreviousCandidates: preservesCandidates, routingProviderRequestId: intentResult.providerRequestId })]);
        const updated = await client.query(`UPDATE agent_actions SET status='SUCCEEDED',summary=$4,finished_at=clock_timestamp() WHERE id=$1 AND request_id=$2 AND agent_run_id=$3 AND status='RUNNING'`, [setup.intentActionId, setup.id, setup.runId, `模型已将本轮消息识别为 ${intent}`]);
        if (updated.rowCount !== 1) throw new ApiError("ILLEGAL_STATE_TRANSITION", "对话意图识别步骤状态无效", 409);
        await bumpRevision(client, ws.id);
      });
    } catch (error) {
      await failAgentAction(context, setup.intentActionId, error).catch(() => undefined);
      throw error;
    }

    if (intent === "CONVERSATION" || intent === "OUT_OF_SCOPE") {
      const answer = asksModelIdentity(parsed.message)
        ? "海天寻源 Agent，本轮由已配置的模型服务提供能力。"
        : intentResult.value.answer;
      await withTransaction(async (client) => {
        const ws = await workspace(client, true);
        const updated = await client.query(`UPDATE agent_runs SET status='SUCCEEDED',output_hash=$2,finished_at=clock_timestamp() WHERE id=$1 AND status='RUNNING'`, [setup.runId, stableHash({ intent, answer })]);
        if (updated.rowCount !== 1) throw new ApiError("ILLEGAL_STATE_TRANSITION", "对话 Agent Run 状态无效", 409);
        await client.query(`INSERT INTO agent_messages(workspace_id,request_id,agent_run_id,role,content) VALUES($1,$2,$3,'ASSISTANT',$4)`, [ws.id, setup.id, setup.runId, answer]);
        await event(client, ws.id, setup.id, intent === "CONVERSATION" ? "AGENT_CONVERSATION_COMPLETED" : "AGENT_OUT_OF_SCOPE_ANSWERED", "agent", "模型对话答复完成", { runId: setup.runId, intent });
        await bumpRevision(client, ws.id);
      });
      return getRequestDetail(requestNo);
    }

    const parseActionId = await withTransaction(async (client) => {
      const ws = await workspace(client, true);
      await client.query(`UPDATE sourcing_requests SET status='SOURCING_RUNNING',version=version+CASE WHEN status='SOURCING_RUNNING' THEN 0 ELSE 1 END,updated_at=clock_timestamp() WHERE id=$1`, [setup.id]);
      await client.query(`UPDATE agent_runs SET input_snapshot=input_snapshot || $2::jsonb WHERE id=$1 AND status='RUNNING'`, [setup.runId, JSON.stringify({ preservePreviousCandidates: false })]);
      const action = await one<{ id: string }>(client, `INSERT INTO agent_actions(workspace_id,request_id,agent_run_id,action_type,status,summary) VALUES($1,$2,$3,'PARSE_SOURCING_REQUEST','RUNNING','正在读取并解析寻源需求') RETURNING id`, [ws.id, setup.id, setup.runId]);
      await event(client, ws.id, setup.id, "AGENT_SOURCING_STARTED", "buyer", "意图识别完成，启动真实寻源流程", { runId: setup.runId, intent });
      await bumpRevision(client, ws.id);
      return action.id;
    });

    let selection: PreparedSourcingSelection;
    try {
      selection = prepareSourcingSelection(parsed.message, setup.catalogs, setup);
      const parseSummary = selection.kind === "unsupported"
        ? `需求解析完成，但调整未通过固定选项校验：${selection.reason}`
        : selection.adjustmentSummary
          ? `需求解析完成：${selection.adjustmentSummary}`
          : "已读取物品、规格、数量、资质、交期、报价时长和评估策略";
      await completeAgentAction(context, parseActionId, parseSummary, 1);
    } catch (error) {
      await failAgentAction(context, parseActionId, error).catch(() => undefined);
      throw error;
    }

    if (selection.kind === "unsupported") {
      await withTransaction(async (client) => {
        const ws = await workspace(client, true);
        await client.query(`UPDATE agent_runs SET status='SUCCEEDED',input_snapshot=input_snapshot || $2::jsonb,output_hash=$3,finished_at=clock_timestamp() WHERE id=$1 AND status='RUNNING'`, [setup.runId, JSON.stringify({ adjustmentRejected: true, preservePreviousCandidates: true }), stableHash(selection.reason)]);
        await client.query(`INSERT INTO agent_messages(workspace_id,request_id,agent_run_id,role,content) VALUES($1,$2,$3,'ASSISTANT',$4)`, [ws.id, setup.id, setup.runId, selection.reason]);
        await client.query(`UPDATE sourcing_requests SET status=$2,version=version+CASE WHEN status=$2 THEN 0 ELSE 1 END,updated_at=clock_timestamp() WHERE id=$1`, [setup.id, setup.originalStatus]);
        await event(client, ws.id, setup.id, "AGENT_ADJUSTMENT_REJECTED", "agent", selection.reason, { runId: setup.runId });
        await bumpRevision(client, ws.id);
      });
      return getRequestDetail(requestNo);
    }

    if (selection.changed) {
      await executeAgentAction(
        context,
        "APPLY_FIXED_OPTIONS",
        "正在应用固定选项调整",
        async () => withTransaction(async (client) => {
          const ws = await workspace(client, true);
          await client.query(`UPDATE sourcing_requests SET item_id=$2,item_code=$3,item_name=$4,specification_code=$5,specification_snapshot=$6,quantity=$7,unit=$8,qualification_codes=$9,required_delivery_days=$10,quote_duration_minutes=$11,evaluation_strategy=$12,status='SOURCING_RUNNING',version=version+1,updated_at=clock_timestamp() WHERE id=$1`, [setup.id, selection.catalog.id, selection.catalog.code, selection.catalog.name, selection.specification.code, selection.specification.label, selection.quantity, selection.catalog.unit, selection.qualificationCodes, selection.deliveryDays, selection.quoteDurationMinutes, selection.evaluationStrategy]);
          await client.query(`UPDATE agent_runs SET input_snapshot=input_snapshot || $2::jsonb WHERE id=$1`, [setup.runId, JSON.stringify({ appliedAdjustment: selection.adjustmentSummary })]);
          await bumpRevision(client, ws.id);
          return selection.adjustmentSummary;
        }),
        (summary) => ({ summary, hitCount: 1 }),
      );
    } else {
      await withTransaction(async (client) => {
        const ws = await workspace(client, true);
        await client.query(`UPDATE agent_runs SET input_snapshot=input_snapshot || $2::jsonb WHERE id=$1`, [setup.runId, JSON.stringify({ appliedAdjustment: selection.adjustmentSummary || null, candidateLimit: selection.candidateLimit })]);
        await bumpRevision(client, ws.id);
      });
    }

    const sourcedCandidates = new Map<string, CandidateRow>();
    const toolState: {
      qualifiedCandidates: CandidateRow[] | null;
      deliveryCandidates: CandidateRow[] | null;
    } = { qualifiedCandidates: null, deliveryCandidates: null };

    const executeSourceTool = async (
      actionType: string,
      runningSummary: string,
      work: () => Promise<CandidateRow[]>,
      completedSummary: (rows: CandidateRow[]) => string,
    ) => {
      const rows = await executeAgentAction(
        context,
        actionType,
        runningSummary,
        work,
        (resultRows) => ({ summary: completedSummary(resultRows), hitCount: resultRows.length }),
      );
      rows.forEach((row) => sourcedCandidates.set(row.supplier_no, row));
      return toSourcingToolResult(completedSummary(rows), rows);
    };

    const executeTool = async (call: SourcingToolCall): Promise<SourcingToolExecutionResult> => {
      if ("itemCode" in call.arguments && call.arguments.itemCode !== selection.catalog.code) {
        throw new ApiError("AGENT_OUTPUT_INVALID", `模型调用 ${call.name} 时修改了采购物品编码`, 502);
      }
      switch (call.name) {
        case "query_internal_suppliers":
          return executeSourceTool(
            "QUERY_INTERNAL_SUPPLIERS",
            "模型正在调用内部供应商系统 API",
            () => queryInternalSupplierApi(selection.catalog.code),
            (rows) => `内部供应商系统返回 ${rows.length} 家具备该物品能力的供应商`,
          );
        case "query_1688_suppliers":
          return executeSourceTool(
            "QUERY_1688_SUPPLIERS",
            "模型正在调用 1688 供应商检索 API",
            () => query1688SupplierApi(selection.catalog.code),
            (rows) => `1688 接口返回 ${rows.length} 家匹配的外部供应商`,
          );
        case "query_qichacha_suppliers":
          return executeSourceTool(
            "QUERY_QICHACHA_SUPPLIERS",
            "模型正在调用企查查企业信息 API",
            () => queryQichachaSupplierApi(selection.catalog.code),
            (rows) => `企查查企业信息接口返回 ${rows.length} 家匹配企业`,
          );
        case "query_industry_platform_suppliers":
          return executeSourceTool(
            "QUERY_INDUSTRY_PLATFORM_SUPPLIERS",
            "模型正在调用行业平台爬虫接口",
            () => queryIndustryPlatformCrawlerApi(selection.catalog.code),
            (rows) => `行业平台爬虫接口返回 ${rows.length} 家匹配供应商`,
          );
        case "check_supplier_qualifications": {
          const sourceRows = [...sourcedCandidates.values()];
          if (!sourceRows.length) throw new ApiError("AGENT_OUTPUT_INVALID", "模型尚未查询供应商就调用了资质核验工具", 502);
          assertExactSupplierNumbers(call.arguments.supplierNos, sourceRows, call.name);
          const requested = [...new Set(call.arguments.qualificationCodes)].sort();
          const expected = [...new Set(selection.qualificationCodes)].sort();
          if (requested.length !== expected.length || requested.some((value, index) => value !== expected[index])) {
            throw new ApiError("AGENT_OUTPUT_INVALID", "模型调用资质核验工具时修改了资质要求", 502);
          }
          const rows = await executeAgentAction(
            context,
            "CHECK_QUALIFICATION",
            "模型正在调用供应商资质核验 API",
            async () => {
              const resultRows = await checkSupplierQualificationsApi(sourceRows, selection.qualificationCodes);
              if (!resultRows.length) throw new ApiError("NOT_FOUND", "资质核验后没有符合要求的供应商", 404);
              return resultRows;
            },
            (resultRows) => ({ summary: `资质核验接口完成，${sourceRows.length} 家中有 ${resultRows.length} 家符合要求`, hitCount: resultRows.length }),
          );
          toolState.qualifiedCandidates = rows;
          return toSourcingToolResult(`资质核验完成，${rows.length} 家供应商符合要求`, rows);
        }
        case "check_supplier_delivery": {
          if (!toolState.qualifiedCandidates) throw new ApiError("AGENT_OUTPUT_INVALID", "模型尚未完成资质核验就调用了交付核验工具", 502);
          assertExactSupplierNumbers(call.arguments.supplierNos, toolState.qualifiedCandidates, call.name);
          if (call.arguments.requiredDeliveryDays !== selection.deliveryDays) {
            throw new ApiError("AGENT_OUTPUT_INVALID", "模型调用交付核验工具时修改了交付要求", 502);
          }
          const result = await executeAgentAction(
            context,
            "CHECK_DELIVERY",
            "模型正在调用供应商交付能力核验 API",
            async () => {
              const eligibleRows = await checkSupplierDeliveryApi(toolState.qualifiedCandidates!, selection.deliveryDays);
              if (!eligibleRows.length) throw new ApiError("NOT_FOUND", "交付能力核验后没有符合要求的供应商", 404);
              const selectedRows = selection.candidateLimit && eligibleRows.length > selection.candidateLimit
                ? [...eligibleRows]
                  .sort((left, right) => right.match_score - left.match_score
                    || left.minimum_delivery_days - right.minimum_delivery_days
                    || left.supplier_no.localeCompare(right.supplier_no))
                  .slice(0, selection.candidateLimit)
                : eligibleRows;
              return { eligibleRows, selectedRows };
            },
            ({ eligibleRows, selectedRows }) => ({
              summary: selection.candidateLimit && eligibleRows.length > selectedRows.length
                ? `交付核验接口完成，${toolState.qualifiedCandidates!.length} 家中有 ${eligibleRows.length} 家满足交期，按匹配度、交期和风险保留 Top ${selectedRows.length}`
                : `交付核验接口完成，${toolState.qualifiedCandidates!.length} 家中有 ${eligibleRows.length} 家可在 ${selection.deliveryDays} 天内交付`,
              hitCount: selectedRows.length,
            }),
          );
          const rows = result.selectedRows;
          toolState.deliveryCandidates = rows;
          return toSourcingToolResult(`交付能力核验完成，${rows.length} 家供应商满足交期`, rows);
        }
      }
    };

    const result = await sourceCandidatesWithTools(
      {
        request: {
          requestNo,
          itemCode: selection.catalog.code,
          itemName: selection.catalog.name,
          specificationCode: selection.specification.code,
          specification: selection.specification.label,
          quantity: selection.quantity,
          unit: selection.catalog.unit,
          qualificationCodes: selection.qualificationCodes,
          requiredDeliveryDays: selection.deliveryDays,
          quoteDurationMinutes: selection.quoteDurationMinutes,
          evaluationStrategy: selection.evaluationStrategy,
          candidateLimit: selection.candidateLimit,
        },
        conversation: setup.conversation,
        instruction: parsed.message,
      },
      {
        executeTool,
        finalize: (work) => executeAgentAction(
          context,
          "ANALYZE_WITH_DEEPSEEK",
          "模型正在汇总工具结果并生成候选推荐",
          work,
          (deepSeekResult) => ({ summary: `模型已生成 ${deepSeekResult.value.candidates.length} 家候选供应商的推荐说明`, hitCount: deepSeekResult.value.candidates.length }),
        ),
      },
    );
    const candidates = toolState.deliveryCandidates;
    if (!candidates?.length) throw new ApiError("AGENT_OUTPUT_INVALID", "模型工具调用未生成可用候选供应商", 502);
    const descriptions = await executeAgentAction(
      context,
      "VALIDATE_AGENT_OUTPUT",
      "正在校验模型返回结构和供应商白名单",
      async () => {
        const allowed = new Set(candidates.map((candidate) => candidate.supplier_no));
        if (result.value.candidates.length !== candidates.length || result.value.candidates.some((entry) => !allowed.has(entry.supplierNo)) || new Set(result.value.candidates.map((entry) => entry.supplierNo)).size !== candidates.length) {
          throw new ApiError("AGENT_OUTPUT_INVALID", "模型候选清单与服务端白名单不一致", 502);
        }
        return new Map(result.value.candidates.map((entry) => [entry.supplierNo, entry]));
      },
      (validated) => ({ summary: `输出校验通过，${validated.size} 个 supplierNo 均属于本轮服务端白名单`, hitCount: validated.size }),
    );
    const saveActionId = await startAgentAction(context, "SAVE_CANDIDATES", "正在保存本轮候选供应商和 Agent 结论");
    try {
      await withTransaction(async (client) => {
        const ws = await workspace(client, true);
        const latestRun = await one<{ id: string; status: string }>(client, `SELECT id,status FROM agent_runs WHERE request_id=$1 AND run_type='SOURCING' ORDER BY started_at DESC,id DESC LIMIT 1 FOR UPDATE`, [setup.id]);
        if (latestRun.id !== setup.runId || latestRun.status !== "RUNNING") throw new ApiError("ILLEGAL_STATE_TRANSITION", "当前 Agent Run 已不是本需求的有效运行", 409);
        for (const row of candidates) {
          const description = descriptions.get(row.supplier_no)!;
          await client.query(`INSERT INTO sourcing_candidates(workspace_id,request_id,agent_run_id,supplier_id,supplier_type,match_score,qualification_summary,expected_delivery_days,recommendation,risk_summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ws.id, setup.id, setup.runId, row.supplier_id, row.supplier_type, row.match_score, row.qualifications.join("、") || "无特殊资质", row.minimum_delivery_days, description.recommendation, description.riskSummary]);
        }
        const actionUpdated = await client.query(`UPDATE agent_actions SET status='SUCCEEDED',hit_count=$4,summary=$5,finished_at=clock_timestamp() WHERE id=$1 AND request_id=$2 AND agent_run_id=$3 AND status='RUNNING'`, [saveActionId, setup.id, setup.runId, candidates.length, `已保存 ${candidates.length} 家候选供应商及推荐说明`]);
        if (actionUpdated.rowCount !== 1) throw new ApiError("ILLEGAL_STATE_TRANSITION", "候选保存步骤状态无效", 409);
        await client.query(`UPDATE agent_runs SET status='SUCCEEDED',model=$2,provider_request_id=$3,output_hash=$4,input_snapshot=input_snapshot || $5::jsonb,finished_at=clock_timestamp() WHERE id=$1`, [setup.runId, result.model, result.providerRequestId, stableHash(result.value), JSON.stringify({ toolProviderRequestIds: result.providerRequestIds ?? [] })]);
        await client.query(`INSERT INTO agent_messages(workspace_id,request_id,agent_run_id,role,content) VALUES($1,$2,$3,'ASSISTANT',$4)`, [ws.id, setup.id, setup.runId, result.value.summary]);
        await client.query(`UPDATE sourcing_requests SET status='SOURCING_READY',version=version+1,updated_at=clock_timestamp() WHERE id=$1`, [setup.id]);
        await event(client, ws.id, setup.id, "AGENT_SOURCING_COMPLETED", "agent", "模型寻源完成", { runId: setup.runId, candidateCount: candidates.length });
        await bumpRevision(client, ws.id);
      });
    } catch (error) {
      await failAgentAction(context, saveActionId, error).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    await failSourcingRun(context, error, setup);
    throw error;
  }
  return getRequestDetail(requestNo);
}

export async function publishRfq(requestNo: string) {
  const rfqNo = await withTransaction(async (client) => {
    const ws = await workspace(client, true);
    const request = await one<{ id: string; status: string; quote_duration_minutes: number }>(client, `SELECT id,status,quote_duration_minutes FROM sourcing_requests WHERE workspace_id=$1 AND request_no=$2 FOR UPDATE`, [ws.id, requestNo]);
    const existing = (await client.query<{ rfq_no: string }>(`SELECT rfq_no FROM rfqs WHERE request_id=$1`, [request.id])).rows[0];
    if (existing) return existing.rfq_no;
    if (request.status !== "SOURCING_READY") throw new ApiError("ILLEGAL_STATE_TRANSITION", "只有已完成寻源的需求可以发布询价", 409);
    const run = await one<{ id: string; status: string; preserve_previous_candidates: boolean }>(client, `SELECT id,status,coalesce((input_snapshot->>'preservePreviousCandidates')::boolean,false) OR coalesce((input_snapshot->>'adjustmentRejected')::boolean,false) AS preserve_previous_candidates FROM agent_runs WHERE request_id=$1 AND run_type='SOURCING' ORDER BY started_at DESC,id DESC LIMIT 1`, [request.id]);
    if (!run.preserve_previous_candidates && run.status !== "SUCCEEDED") throw new ApiError("ILLEGAL_STATE_TRANSITION", "最新一轮寻源尚未成功，不能发布询价", 409);
    const candidateRunId = run.preserve_previous_candidates
      ? (await client.query<{ id: string }>(`SELECT ar.id FROM agent_runs ar WHERE ar.request_id=$1 AND ar.run_type='SOURCING' AND ar.status='SUCCEEDED' AND ar.id<>$2 AND EXISTS (SELECT 1 FROM sourcing_candidates sc WHERE sc.agent_run_id=ar.id) ORDER BY ar.started_at DESC,ar.id DESC LIMIT 1`, [request.id, run.id])).rows[0]?.id
      : run.id;
    if (!candidateRunId) throw new ApiError("ILLEGAL_STATE_TRANSITION", "当前需求没有可继续使用的成功候选清单", 409);
    const candidates = (await client.query<{ supplier_id: string; supplier_no: string; supplier_type: string; email: string | null }>(`SELECT sc.supplier_id,s.supplier_no,sc.supplier_type,s.email FROM sourcing_candidates sc JOIN suppliers s ON s.id=sc.supplier_id WHERE sc.agent_run_id=$1 AND sc.eligible_for_rfq=true`, [candidateRunId])).rows;
    if (!candidates.length) throw new ApiError("ILLEGAL_STATE_TRANSITION", "没有可以邀请的候选供应商", 409);
    const businessNo = requestNo.startsWith("SR-") ? requestNo.replace("SR-", "RFQ-") : `RFQ-${requestNo}`;
    const fixedDemoDeadline = ["SR-DEMO-0001", "SR-DEMO-0002", "SR-DEMO-0003", "SR-DEMO-0004"].includes(requestNo)
      ? ACTIVE_DEMO_RFQ_DEADLINE
      : null;
    const rfq = await one<{ id: string }>(client, `INSERT INTO rfqs(workspace_id,rfq_no,request_id,status,deadline_at) VALUES($1,$2,$3,'OPEN',coalesce($4::timestamptz,clock_timestamp()+($5 || ' minutes')::interval)) RETURNING id`, [ws.id, businessNo, request.id, fixedDemoDeadline, request.quote_duration_minutes]);
    for (const candidate of candidates) {
      const invitation = await one<{ id: string }>(client, `INSERT INTO rfq_invitations(workspace_id,rfq_id,supplier_id,invitation_type) VALUES($1,$2,$3,$4) RETURNING id`, [ws.id, rfq.id, candidate.supplier_id, candidate.supplier_type]);
      await client.query(`INSERT INTO notification_records(workspace_id,invitation_id,recipient_address) VALUES($1,$2,$3)`, [ws.id, invitation.id, candidate.email ?? "supplier@example.test"]);
    }
    await client.query(`UPDATE sourcing_requests SET status='BIDDING_OPEN',version=version+1,updated_at=clock_timestamp() WHERE id=$1`, [request.id]);
    await event(client, ws.id, request.id, "RFQ_PUBLISHED", "buyer", "发布询价并生成通知发送记录", { rfqNo: businessNo, invitationCount: candidates.length });
    await bumpRevision(client, ws.id);
    return businessNo;
  });
  void rfqNo;
  return getRequestDetail(requestNo);
}

async function closeLockedRfq(client: PoolClient, ws: { id: string }, rfq: { id: string; request_id: string; status: string }, reason: string) {
  if (rfq.status === "CLOSED") return false;
  const closedAt = (await one<{ now: Date }>(client, `SELECT clock_timestamp() AS now`)).now;
  const quoteSet = await one<{ quote_count: string; current_version_count: string }>(client, `
    SELECT count(DISTINCT q.id)::text AS quote_count,
           count(DISTINCT version.quote_id)::text AS current_version_count
      FROM rfqs r
      LEFT JOIN quotes q ON q.rfq_id=r.id
      LEFT JOIN quote_versions version ON version.quote_id=q.id AND version.version_no=q.current_version
     WHERE r.id=$1
     GROUP BY r.id`, [rfq.id]);
  const quoteCount = Number(quoteSet.quote_count);
  if (Number(quoteSet.current_version_count) !== quoteCount) throw new ApiError("STALE_VERSION", "报价最新版本不完整，请检查数据后重试", 409);
  // revealed_at remains populated for compatibility with the original RFQ
  // state constraint; quote contents are already visible during OPEN.
  await client.query(`UPDATE rfqs SET status='CLOSED',closed_at=$2,close_reason=$3,revealed_at=$2,version=version+1 WHERE id=$1`, [rfq.id, closedAt, reason]);
  await client.query(`INSERT INTO rfq_close_events(workspace_id,rfq_id,close_reason,closed_at,revealed_quote_count,quote_count) VALUES($1,$2,$3,$4,$5,$5)`, [ws.id, rfq.id, reason, closedAt, quoteCount]);
  await client.query(`UPDATE sourcing_requests SET status='EVALUATION_PENDING',version=version+1,updated_at=clock_timestamp() WHERE id=$1`, [rfq.request_id]);
  await event(client, ws.id, rfq.request_id, "RFQ_CLOSED", "buyer", "报价已停止，最终报价集合已冻结", { reason, quoteCount });
  await bumpRevision(client, ws.id);
  return true;
}

export async function closeRfq(rfqNo: string, reason = "EARLY_STOP") {
  const requestNo = await withTransaction(async (client) => {
    const ws = await workspace(client, true);
    const rfq = await one<{ id: string; request_id: string; status: string; revealed_at: Date | null }>(client, `SELECT id,request_id,status,revealed_at FROM rfqs WHERE workspace_id=$1 AND rfq_no=$2 FOR UPDATE`, [ws.id, rfqNo]);
    await closeLockedRfq(client, ws, rfq, reason);
    return (await one<{ request_no: string }>(client, `SELECT request_no FROM sourcing_requests WHERE id=$1`, [rfq.request_id])).request_no;
  });
  return getRequestDetail(requestNo);
}

export async function closeRfqIfExpired(rfqNo: string) {
  const row = (await pool.query<{ expired: boolean }>(`SELECT r.status='OPEN' AND r.deadline_at <= clock_timestamp() AS expired FROM rfqs r JOIN demo_workspaces w ON w.id=r.workspace_id WHERE w.code=$1 AND r.rfq_no=$2`, [WORKSPACE_CODE, rfqNo])).rows[0];
  if (row?.expired) await closeRfq(rfqNo, "DEADLINE_REACHED");
}

export async function closeExpiredRfqs() {
  const rows = (await pool.query<{ rfq_no: string }>(`SELECT r.rfq_no FROM rfqs r JOIN demo_workspaces w ON w.id=r.workspace_id WHERE w.code=$1 AND r.status='OPEN' AND r.deadline_at <= clock_timestamp() ORDER BY r.deadline_at`, [WORKSPACE_CODE])).rows;
  for (const row of rows) await closeRfq(row.rfq_no, "DEADLINE_REACHED");
  return rows.length;
}

export async function getDeepSeekRuntimeStatus() {
  const rows = (await pool.query<{
    status: string;
    model: string;
    provider_request_id: string | null;
    started_at: Date;
    finished_at: Date | null;
    error_code: string | null;
    error_message: string | null;
  }>(`
    SELECT run.status,run.model,run.provider_request_id,run.started_at,run.finished_at,run.error_code,run.error_message
      FROM agent_runs run
      JOIN demo_workspaces workspace ON workspace.id=run.workspace_id
     WHERE workspace.code=$1
       AND coalesce((run.input_snapshot->>'seeded')::boolean,false)=false
     ORDER BY run.started_at DESC,run.id DESC
     LIMIT 50`, [WORKSPACE_CODE])).rows;
  const latest = rows[0] ?? null;
  const lastVerified = rows.find((row) => Boolean(row.provider_request_id)) ?? null;
  const latestFailedConnection = latest
    && !latest.provider_request_id
    && latest.status === "FAILED"
    && latest.error_code === "AGENT_SERVICE_UNAVAILABLE";
  const state = !env.DEEPSEEK_API_KEY
    ? "UNCONFIGURED"
    : latestFailedConnection
      ? "DEGRADED"
      : lastVerified
        ? "VERIFIED"
        : "NOT_VERIFIED";
  return {
    configured: Boolean(env.DEEPSEEK_API_KEY),
    state,
    model: lastVerified?.model ?? latest?.model ?? env.DEEPSEEK_MODEL,
    lastVerifiedAt: lastVerified ? (lastVerified.finished_at ?? lastVerified.started_at).toISOString() : null,
    lastAttemptAt: latest ? (latest.finished_at ?? latest.started_at).toISOString() : null,
    lastError: latestFailedConnection ? latest.error_message : null,
  };
}

type ScoreRow = {
  quote_id: string; quote_version_id: string; quote_no: string; supplier_id: string; supplier_no: string; supplier_name: string; supplier_type: string;
  version_no: number; submitted_at: Date; total_amount: string; delivery_days: number; risk_level: "LOW" | "MEDIUM" | "HIGH"; match_score: string | null;
};

function weights(strategy: string) {
  if (strategy === "PRICE_FIRST") return { price: .60, delivery: .15, match: .15, risk: .10 };
  if (strategy === "DELIVERY_FIRST") return { price: .25, delivery: .50, match: .15, risk: .10 };
  return { price: .40, delivery: .25, match: .20, risk: .15 };
}

function cents(amount: string) {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

type PriceScoredRow = ScoreRow & { priceScore: number };
type DeliveryScoredRow = PriceScoredRow & { deliveryScore: number };
type RiskScoredRow = DeliveryScoredRow & { matchScore: number; riskScore: number };
type RankedScoreRow = RiskScoredRow & { totalScore: number };
type EvaluationFocus = "PRICE" | "DELIVERY" | "MATCH" | "RISK" | "BALANCED";
type EvaluationRiskFocus = Exclude<EvaluationFocus, "BALANCED"> | "NONE";

function calculatePriceScores(rows: ScoreRow[]): PriceScoredRow[] {
  const minimum = rows.reduce((min, row) => cents(row.total_amount) < min ? cents(row.total_amount) : min, cents(rows[0].total_amount));
  return rows.map((row) => {
    const current = cents(row.total_amount);
    const priceScore = Number((minimum * 1_000_000n) / current) / 10_000;
    return { ...row, priceScore };
  });
}

function calculateDeliveryScores(rows: PriceScoredRow[], requiredDeliveryDays: number): DeliveryScoredRow[] {
  return rows.map((row) => ({
    ...row,
    deliveryScore: row.delivery_days <= requiredDeliveryDays ? 100 : requiredDeliveryDays / row.delivery_days * 100,
  }));
}

function calculateMatchAndRiskScores(rows: DeliveryScoredRow[]): RiskScoredRow[] {
  return rows.map((row) => ({
    ...row,
    matchScore: Number(row.match_score ?? 80),
    riskScore: row.risk_level === "LOW" ? 100 : row.risk_level === "MEDIUM" ? 70 : 30,
  }));
}

function applyEvaluationWeights(rows: RiskScoredRow[], strategy: string): RankedScoreRow[] {
  const applied = weights(strategy);
  return rows.map((row) => ({
    ...row,
    totalScore: row.priceScore * applied.price
      + row.deliveryScore * applied.delivery
      + row.matchScore * applied.match
      + row.riskScore * applied.risk,
  })).sort((a, b) => b.totalScore - a.totalScore
    || Number(a.total_amount) - Number(b.total_amount)
    || a.delivery_days - b.delivery_days
    || a.submitted_at.getTime() - b.submitted_at.getTime()
    || a.supplier_no.localeCompare(b.supplier_no)).slice(0, 10);
}

function evidenceBackedEvaluationNarrative(
  row: RankedScoreRow,
  rank: number,
  total: number,
  strengthCode: EvaluationFocus,
  riskCode: EvaluationRiskFocus,
) {
  const scoreEvidence: Record<Exclude<EvaluationFocus, "BALANCED">, string> = {
    PRICE: `价格得分 ${row.priceScore.toFixed(2)}`,
    DELIVERY: `交期得分 ${row.deliveryScore.toFixed(2)}`,
    MATCH: `寻源匹配得分 ${row.matchScore.toFixed(2)}`,
    RISK: `履约风险得分 ${row.riskScore.toFixed(2)}`,
  };
  const strength = strengthCode === "BALANCED"
    ? `分项表现较均衡（价格 ${row.priceScore.toFixed(2)}、交期 ${row.deliveryScore.toFixed(2)}、匹配 ${row.matchScore.toFixed(2)}、风险 ${row.riskScore.toFixed(2)}）`
    : scoreEvidence[strengthCode];
  const recommendation = `综合排名第 ${rank}/${total}，总分 ${row.totalScore.toFixed(2)}；模型重点关注其${strength}。`;
  const riskSummary = riskCode === "NONE"
    ? "模型未标记额外重点风险；采购决策仍应结合合同与履约核验。"
    : `模型建议重点复核${scoreEvidence[riskCode]}对应的业务条件。`;
  return { recommendation, riskSummary };
}

async function loadVerifiedEvaluationQuotes(client: PoolClient, rfqId: string, requestId: string, lockRfq = false) {
  const rfq = await one<{ status: string }>(
    client,
    `SELECT status FROM rfqs WHERE id=$1${lockRfq ? " FOR UPDATE" : ""}`,
    [rfqId],
  );
  if (rfq.status !== "CLOSED") throw new ApiError("ILLEGAL_STATE_TRANSITION", "报价尚未停止，不能评估", 409);
  const integrity = await one<{
    quote_count: string; current_version_count: string; close_event_count: string; close_quote_count: string | null;
  }>(client, `
    SELECT count(DISTINCT q.id)::text AS quote_count,
           count(DISTINCT current_version.quote_id)::text AS current_version_count,
           count(DISTINCT close_event.id)::text AS close_event_count,
           max(close_event.quote_count)::text AS close_quote_count
      FROM rfqs r
      LEFT JOIN quotes q ON q.rfq_id=r.id
      LEFT JOIN quote_versions current_version ON current_version.quote_id=q.id AND current_version.version_no=q.current_version
      LEFT JOIN rfq_close_events close_event ON close_event.rfq_id=r.id
     WHERE r.id=$1
     GROUP BY r.id`, [rfqId]);
  const quoteCount = Number(integrity.quote_count);
  if (!quoteCount) throw new ApiError("NO_VALID_QUOTES", "没有可评估的有效报价", 409);
  const completeQuoteSet = Number(integrity.current_version_count) === quoteCount
    && Number(integrity.close_event_count) === 1
    && Number(integrity.close_quote_count) === quoteCount;
  if (!completeQuoteSet) throw new ApiError("STALE_VERSION", "最终报价集合与关闭记录不一致，请检查后重试", 409);
  const rows = (await client.query<ScoreRow>(`
    SELECT q.id AS quote_id,version.id AS quote_version_id,q.quote_no,q.supplier_id,s.supplier_no,s.name AS supplier_name,s.supplier_type,
           version.version_no,version.submitted_at,version.total_amount::text,version.delivery_days,s.risk_level,
           (SELECT sc.match_score::text
              FROM sourcing_candidates sc
              JOIN agent_runs source_run ON source_run.id=sc.agent_run_id
              JOIN rfqs source_rfq ON source_rfq.request_id=sc.request_id
             WHERE sc.request_id=$2 AND sc.supplier_id=q.supplier_id
               AND source_run.run_type='SOURCING' AND source_run.status='SUCCEEDED'
               AND source_run.finished_at<=source_rfq.created_at
             ORDER BY source_run.finished_at DESC,source_run.id DESC LIMIT 1) AS match_score
      FROM quotes q
      JOIN quote_versions version ON version.quote_id=q.id AND version.version_no=q.current_version
      JOIN suppliers s ON s.id=q.supplier_id
     WHERE q.rfq_id=$1
     ORDER BY version.submitted_at,q.id`, [rfqId, requestId])).rows;
  if (rows.length !== quoteCount) throw new ApiError("STALE_VERSION", "报价集合在评估前发生变化，请重新评估", 409);
  return rows;
}

export async function evaluateRfq(rfqNo: string) {
  await closeRfqIfExpired(rfqNo);
  const setup = await withTransaction(async (client) => {
    const ws = await workspace(client, true);
    const rfq = await one<{ id: string; request_id: string; status: string }>(client, `SELECT id,request_id,status FROM rfqs WHERE workspace_id=$1 AND rfq_no=$2 FOR UPDATE`, [ws.id, rfqNo]);
    if (rfq.status !== "CLOSED") throw new ApiError("ILLEGAL_STATE_TRANSITION", "报价尚未停止，不能评估", 409);
    const request = await one<{ request_no: string; status: string; evaluation_strategy: string; required_delivery_days: number }>(client, `SELECT request_no,status,evaluation_strategy,required_delivery_days FROM sourcing_requests WHERE id=$1 FOR UPDATE`, [rfq.request_id]);
    const existing = (await client.query<{ evaluation_no: string }>(`SELECT evaluation_no FROM evaluations WHERE rfq_id=$1 AND status='SUCCEEDED'`, [rfq.id])).rows[0];
    if (existing) return { existing: true as const, requestNo: request.request_no, evaluationNo: existing.evaluation_no };
    const running = (await client.query<{ evaluation_no: string }>(`SELECT evaluation_no FROM evaluations WHERE rfq_id=$1 AND status='RUNNING'`, [rfq.id])).rows[0];
    if (running) throw new ApiError("ILLEGAL_STATE_TRANSITION", `报价评估 ${running.evaluation_no} 正在执行，请勿重复提交`, 409);
    if (request.status !== "EVALUATION_PENDING") throw new ApiError("ILLEGAL_STATE_TRANSITION", "当前需求不在待评估阶段", 409);
    const quotes = await loadVerifiedEvaluationQuotes(client, rfq.id, rfq.request_id);
    const quoteSetHash = stableHash(quotes.map((row) => [row.quote_id, row.version_no, row.total_amount, row.delivery_days]));
    const run = await one<{ id: string }>(client, `INSERT INTO agent_runs(workspace_id,request_id,run_type,status,model,prompt_version,input_snapshot) VALUES($1,$2,'EVALUATION','RUNNING',$3,'evaluation-v2',$4) RETURNING id`, [ws.id, rfq.request_id, env.DEEPSEEK_MODEL, JSON.stringify({ rfqNo, quoteSetHash, quoteCount: quotes.length })]);
    const evaluationBase = rfqNo.replace("RFQ-", "EV-");
    const attemptCount = Number((await one<{ count: string }>(client, `SELECT count(*)::text AS count FROM evaluations WHERE rfq_id=$1`, [rfq.id])).count);
    const evaluationNo = attemptCount === 0 ? evaluationBase : `${evaluationBase}-R${attemptCount}`;
    const evaluation = await one<{ id: string }>(client, `INSERT INTO evaluations(workspace_id,evaluation_no,request_id,rfq_id,agent_run_id,strategy,status,quote_set_hash) VALUES($1,$2,$3,$4,$5,$6,'RUNNING',$7) RETURNING id`, [ws.id, evaluationNo, rfq.request_id, rfq.id, run.id, request.evaluation_strategy, quoteSetHash]);
    await event(client, ws.id, rfq.request_id, "EVALUATION_STARTED", "buyer", "启动模型报价评估", { rfqNo, runId: run.id });
    await bumpRevision(client, ws.id);
    return { existing: false as const, workspaceId: ws.id, requestId: rfq.request_id, requestNo: request.request_no, rfqId: rfq.id, evaluationId: evaluation.id, evaluationNo, runId: run.id, strategy: request.evaluation_strategy, requiredDeliveryDays: request.required_delivery_days, quoteSetHash, quotes };
  });
  if (setup.existing) return getRequestDetail(setup.requestNo);
  const context: AgentActionContext = { workspaceId: setup.workspaceId, requestId: setup.requestId, runId: setup.runId };
  let saveActionId: string | null = null;
  try {
    const loadedQuotes = await executeAgentAction(
      context,
      "LOAD_CURRENT_QUOTES",
      "正在读取停止报价后的供应商最新有效报价",
      () => withTransaction((client) => loadVerifiedEvaluationQuotes(client, setup.rfqId, setup.requestId)),
      (rows) => ({ summary: `已读取 ${rows.length} 份停止报价后的最终有效报价`, hitCount: rows.length }),
      env.EVALUATION_STEP_DELAY_MS,
    );
    const verifiedQuotes = await executeAgentAction(
      context,
      "VERIFY_QUOTE_SET",
      "正在校验报价最新版本、关闭记录与报价数量",
      async () => {
        const rows = await withTransaction((client) => loadVerifiedEvaluationQuotes(client, setup.rfqId, setup.requestId));
        const currentHash = stableHash(rows.map((row) => [row.quote_id, row.version_no, row.total_amount, row.delivery_days]));
        if (currentHash !== setup.quoteSetHash || currentHash !== stableHash(loadedQuotes.map((row) => [row.quote_id, row.version_no, row.total_amount, row.delivery_days]))) {
          throw new ApiError("STALE_VERSION", "报价集合在评估过程中发生变化，请重新评估", 409);
        }
        return rows;
      },
      (rows) => ({ summary: `${rows.length} 份报价的最新版本与关闭记录数量一致`, hitCount: rows.length }),
      env.EVALUATION_STEP_DELAY_MS,
    );
    const priceScored = await executeAgentAction(
      context,
      "CALCULATE_PRICE_SCORE",
      "正在以最低有效报价为基准计算价格得分",
      async () => calculatePriceScores(verifiedQuotes),
      (rows) => ({ summary: `已完成 ${rows.length} 份报价的价格标准化评分`, hitCount: rows.length }),
      env.EVALUATION_STEP_DELAY_MS,
    );
    const deliveryScored = await executeAgentAction(
      context,
      "CALCULATE_DELIVERY_SCORE",
      `正在按 ${setup.requiredDeliveryDays} 天交付要求计算交期得分`,
      async () => calculateDeliveryScores(priceScored, setup.requiredDeliveryDays),
      (rows) => ({ summary: `${rows.filter((row) => row.delivery_days <= setup.requiredDeliveryDays).length} 家供应商满足目标交期`, hitCount: rows.length }),
      env.EVALUATION_STEP_DELAY_MS,
    );
    const riskScored = await executeAgentAction(
      context,
      "CALCULATE_MATCH_RISK_SCORE",
      "正在结合寻源匹配度与供应商风险等级计算得分",
      async () => calculateMatchAndRiskScores(deliveryScored),
      (rows) => ({ summary: `已完成 ${rows.length} 家供应商的匹配度与履约风险量化`, hitCount: rows.length }),
      env.EVALUATION_STEP_DELAY_MS,
    );
    const scored = await executeAgentAction(
      context,
      "APPLY_EVALUATION_WEIGHTS",
      "正在应用当前需求的评估权重并生成 Top 10",
      async () => applyEvaluationWeights(riskScored, setup.strategy),
      (rows) => {
        const applied = weights(setup.strategy);
        return { summary: `已按价格 ${applied.price * 100}%、交期 ${applied.delivery * 100}%、匹配 ${applied.match * 100}%、风险 ${applied.risk * 100}% 生成 Top ${rows.length}`, hitCount: rows.length };
      },
      env.EVALUATION_STEP_DELAY_MS,
    );
    const result = await executeAgentAction(
      context,
      "ANALYZE_EVALUATION_WITH_DEEPSEEK",
      `正在调用模型分析 Top ${scored.length} 报价的推荐理由和风险`,
      () => describeEvaluation({ rfqNo, strategy: setup.strategy, ranking: scored.map((row, index) => ({ rank: index + 1, quoteNo: row.quote_no, supplierNo: row.supplier_no, supplierName: row.supplier_name, supplierType: row.supplier_type, totalAmount: row.total_amount, deliveryDays: row.delivery_days, priceScore: row.priceScore.toFixed(2), deliveryScore: row.deliveryScore.toFixed(2), matchScore: row.matchScore.toFixed(2), riskScore: row.riskScore.toFixed(2), totalScore: row.totalScore.toFixed(2) })) }),
      (deepSeekResult) => ({ summary: `模型已生成 ${deepSeekResult.value.items.length} 份推荐与风险说明`, hitCount: deepSeekResult.value.items.length }),
      env.EVALUATION_STEP_DELAY_MS,
    );
    const descriptions = await executeAgentAction(
      context,
      "VALIDATE_EVALUATION_OUTPUT",
      "正在校验模型返回的报价编号、数量和唯一性",
      async () => {
        const allowed = new Set(scored.map((row) => row.quote_no));
        if (result.value.items.length !== scored.length || result.value.items.some((item) => !allowed.has(item.quoteNo)) || new Set(result.value.items.map((item) => item.quoteNo)).size !== scored.length) {
          throw new ApiError("AGENT_OUTPUT_INVALID", "模型评估清单与已验证报价集合不一致", 502);
        }
        return new Map(result.value.items.map((item) => [item.quoteNo, item]));
      },
      (items) => ({ summary: `模型输出与 Top ${items.size} 报价白名单完全一致`, hitCount: items.size }),
      env.EVALUATION_STEP_DELAY_MS,
    );
    saveActionId = await startAgentAction(context, "SAVE_EVALUATION_RANKING", "正在原子保存评估排名并推进采购流程");
    if (env.EVALUATION_STEP_DELAY_MS > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, env.EVALUATION_STEP_DELAY_MS));
    }
    await withTransaction(async (client) => {
      const ws = await workspace(client, true);
      const current = await one<{ hash: string; status: string }>(client, `SELECT quote_set_hash AS hash,status FROM evaluations WHERE id=$1 FOR UPDATE`, [setup.evaluationId]);
      const freshQuotes = await loadVerifiedEvaluationQuotes(client, setup.rfqId, setup.requestId, true);
      const freshHash = stableHash(freshQuotes.map((row) => [row.quote_id, row.version_no, row.total_amount, row.delivery_days]));
      if (current.status !== "RUNNING" || current.hash !== setup.quoteSetHash || freshHash !== setup.quoteSetHash) throw new ApiError("STALE_VERSION", "报价集合已经变化，请重新评估", 409);
      for (let index = 0; index < scored.length; index++) {
        const row = scored[index];
        const description = descriptions.get(row.quote_no)!;
        const narrative = evidenceBackedEvaluationNarrative(row, index + 1, scored.length, description.strengthCode, description.riskCode);
        await client.query(`INSERT INTO evaluation_items(workspace_id,evaluation_id,rfq_id,quote_id,quote_version_id,rank,price_score,delivery_score,match_score,risk_score,total_score,recommendation,risk_summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [ws.id, setup.evaluationId, setup.rfqId, row.quote_id, row.quote_version_id, index + 1, row.priceScore, row.deliveryScore, row.matchScore, row.riskScore, row.totalScore, narrative.recommendation, narrative.riskSummary]);
      }
      await client.query(`UPDATE evaluations SET status='SUCCEEDED',completed_at=clock_timestamp() WHERE id=$1`, [setup.evaluationId]);
      await client.query(`UPDATE agent_runs SET status='SUCCEEDED',model=$2,provider_request_id=$3,output_hash=$4,finished_at=clock_timestamp() WHERE id=$1`, [setup.runId, result.model, result.providerRequestId, stableHash(result.value)]);
      await client.query(`INSERT INTO agent_messages(workspace_id,request_id,agent_run_id,role,content) VALUES($1,$2,$3,'ASSISTANT',$4)`, [ws.id, setup.requestId, setup.runId, `模型已完成 Top ${scored.length} 报价的关注点分析；最终排名、分数和比较结论均由服务端确定性计算。`]);
      const actionUpdated = await client.query(`UPDATE agent_actions SET status='SUCCEEDED',hit_count=$4,summary=$5,finished_at=clock_timestamp() WHERE id=$1 AND request_id=$2 AND agent_run_id=$3 AND status='RUNNING'`, [saveActionId, setup.requestId, setup.runId, scored.length, `已保存 Top ${scored.length} 报价、Agent 建议和分项得分`]);
      if (actionUpdated.rowCount !== 1) throw new ApiError("ILLEGAL_STATE_TRANSITION", "评估结果保存步骤状态无效", 409);
      await client.query(`UPDATE sourcing_requests SET status='AWARD_PENDING',version=version+1,updated_at=clock_timestamp() WHERE id=$1`, [setup.requestId]);
      await event(client, ws.id, setup.requestId, "EVALUATION_COMPLETED", "agent", "模型报价评估完成", { evaluationNo: setup.evaluationNo, quoteCount: scored.length });
      await bumpRevision(client, ws.id);
    });
    saveActionId = null;
  } catch (error) {
    if (saveActionId) await failAgentAction(context, saveActionId, error).catch(() => undefined);
    await withTransaction(async (client) => {
      const ws = await workspace(client, true);
      const apiError = error instanceof ApiError ? error : new ApiError("AGENT_SERVICE_UNAVAILABLE", "Agent 服务不可用", 503);
      await client.query(`UPDATE evaluations SET status='FAILED',completed_at=clock_timestamp() WHERE id=$1 AND status='RUNNING'`, [setup.evaluationId]);
      await client.query(`UPDATE agent_runs SET status='FAILED',error_code=$2,error_message=$3,finished_at=clock_timestamp() WHERE id=$1 AND status='RUNNING'`, [setup.runId, apiError.code, apiError.message]);
      await client.query(`UPDATE agent_actions SET status='FAILED',summary=$2,finished_at=clock_timestamp() WHERE agent_run_id=$1 AND status='RUNNING'`, [setup.runId, apiError.message]);
      await event(client, ws.id, setup.requestId, "EVALUATION_FAILED", "agent", apiError.message, { evaluationNo: setup.evaluationNo, errorCode: apiError.code });
      await bumpRevision(client, ws.id);
    });
    throw (error instanceof ApiError ? error : new ApiError("AGENT_SERVICE_UNAVAILABLE", "Agent 服务不可用", 503));
  }
  return getRequestDetail(setup.requestNo);
}

export async function createPurchaseRequisition(requestNo: string, input: z.infer<typeof awardSchema>) {
  const parsed = awardSchema.parse(input);
  const prNo = await withTransaction(async (client) => {
    const ws = await workspace(client, true);
    const request = await one<{ id: string; status: string; item_name: string; specification_snapshot: string; quantity: string; unit: string }>(client, `SELECT id,status,item_name,specification_snapshot,quantity::text,unit FROM sourcing_requests WHERE workspace_id=$1 AND request_no=$2 FOR UPDATE`, [ws.id, requestNo]);
    const existing = (await client.query<{ pr_no: string }>(`SELECT pr_no FROM purchase_requisitions WHERE request_id=$1`, [request.id])).rows[0];
    if (existing) return existing.pr_no;
    if (request.status !== "AWARD_PENDING") throw new ApiError("ILLEGAL_STATE_TRANSITION", "当前需求不能创建采购申请", 409);
    const winner = await one<{ evaluation_id: string; quote_id: string; rfq_id: string; supplier_id: string; total_amount: string; delivery_days: number }>(client, `
      SELECT ei.evaluation_id,ei.quote_id,ei.rfq_id,q.supplier_id,d.total_amount::text,d.delivery_days
      FROM evaluation_items ei JOIN evaluations e ON e.id=ei.evaluation_id JOIN quotes q ON q.id=ei.quote_id JOIN quote_versions d ON d.id=ei.quote_version_id AND d.quote_id=ei.quote_id
      WHERE e.request_id=$1 AND e.status='SUCCEEDED' AND q.quote_no=$2`, [request.id, parsed.quoteNo]);
    const award = await one<{ id: string }>(client, `INSERT INTO awards(workspace_id,request_id,evaluation_id,quote_id,supplier_id) VALUES($1,$2,$3,$4,$5) RETURNING id`, [ws.id, request.id, winner.evaluation_id, winner.quote_id, winner.supplier_id]);
    const businessNo = requestNo.startsWith("SR-DEMO-") ? `PR-DEMO-${requestNo.slice(-4)}` : requestNo.replace("SR-", "PR-");
    await client.query(`INSERT INTO purchase_requisitions(workspace_id,pr_no,request_id,rfq_id,evaluation_id,award_id,quote_id,supplier_id,item_name,specification,quantity,unit,total_amount,delivery_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [ws.id, businessNo, request.id, winner.rfq_id, winner.evaluation_id, award.id, winner.quote_id, winner.supplier_id, request.item_name, request.specification_snapshot, request.quantity, request.unit, winner.total_amount, winner.delivery_days]);
    await client.query(`UPDATE sourcing_requests SET status='COMPLETED',version=version+1,updated_at=clock_timestamp() WHERE id=$1`, [request.id]);
    await event(client, ws.id, request.id, "PURCHASE_REQUISITION_CREATED", "buyer", "选择唯一中选供应商并创建采购申请 PR", { prNo: businessNo, quoteNo: parsed.quoteNo });
    await bumpRevision(client, ws.id);
    return businessNo;
  });
  void prNo;
  return getRequestDetail(requestNo);
}

async function supplierRecord(supplierNo: string, expectedType?: "INTERNAL" | "EXTERNAL") {
  const row = (await pool.query<{ id: string; workspace_id: string; supplier_no: string; supplier_type: "INTERNAL" | "EXTERNAL"; name: string; region: string; source_platform: string; contact_name: string | null; email: string | null; phone: string | null; registration_enabled: boolean; registered_at: Date | null }>(`
    SELECT s.id,s.workspace_id,s.supplier_no,s.supplier_type,s.name,s.region,s.source_platform,s.contact_name,s.email,s.phone,s.registration_enabled,a.registered_at
    FROM suppliers s JOIN demo_workspaces w ON w.id=s.workspace_id LEFT JOIN external_supplier_accounts a ON a.supplier_id=s.id WHERE w.code=$1 AND s.supplier_no=$2`, [WORKSPACE_CODE, supplierNo])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "供应商不存在", 404);
  if (expectedType && row.supplier_type !== expectedType) throw new ApiError("UNAUTHORIZED", "供应商身份类型不匹配", 403);
  return row;
}

export async function getInternalDemoSuppliers() {
  const rows = (await pool.query(`SELECT s.supplier_no,s.name,s.region,s.contact_name FROM suppliers s JOIN demo_workspaces w ON w.id=s.workspace_id WHERE w.code=$1 AND s.supplier_type='INTERNAL' ORDER BY s.supplier_no`, [WORKSPACE_CODE])).rows;
  return { suppliers: rows.map((row) => ({ supplierNo: row.supplier_no, name: row.name, region: row.region, contactName: row.contact_name })) };
}

export async function createInternalSession(supplierNo: string) {
  const supplier = await supplierRecord(supplierNo, "INTERNAL");
  return { supplier: { supplierNo: supplier.supplier_no, name: supplier.name, region: supplier.region }, session: { supplierNo: supplier.supplier_no, supplierType: "INTERNAL" as const } };
}

export async function getExternalRegistrationProfile() {
  const supplier = await supplierRecord("EXT-SUP-DEMO-004", "EXTERNAL");
  const profile = await one<{
    qualifications: string[];
    risk_level: "LOW" | "MEDIUM" | "HIGH";
    primary_capabilities: string[];
  }>(pool, `
    SELECT
      s.qualifications,
      s.risk_level,
      COALESCE(
        array_agg(sc.description ORDER BY sc.item_code) FILTER (WHERE sc.id IS NOT NULL),
        ARRAY[]::text[]
      ) AS primary_capabilities
    FROM suppliers s
    LEFT JOIN supplier_capabilities sc ON sc.supplier_id=s.id AND sc.workspace_id=s.workspace_id
    WHERE s.id=$1
    GROUP BY s.id,s.qualifications,s.risk_level`, [supplier.id]);
  return {
    supplier: {
      supplierNo: supplier.supplier_no,
      name: supplier.name,
      region: supplier.region,
      sourcePlatform: supplier.source_platform,
      sourceDetail: `${supplier.source_platform}同步资料，最近校验：2026-08-29`,
      unifiedSocialCreditCode: "91330206MA2H8X4N6P",
      address: "浙江省宁波市北仑区春晓大道 88 号",
      qualifications: profile.qualifications,
      riskLevel: profile.risk_level,
      riskSummary: profile.risk_level === "LOW"
        ? "企业信息校验未发现影响本次询价的高风险异常。"
        : "企业信息存在一般风险提示，建议结合报价条件复核。",
      primaryCapabilities: profile.primary_capabilities,
      contactName: supplier.contact_name,
      email: supplier.email,
      registered: Boolean(supplier.registered_at),
      registeredAt: supplier.registered_at?.toISOString() ?? null,
    },
  };
}

export async function registerExternalSupplier(supplierNo: string, input: z.infer<typeof registerSchema>) {
  const parsed = registerSchema.parse(input);
  return withTransaction(async (client) => {
    const ws = await workspace(client, true);
    const supplier = await one<{ id: string; supplier_no: string; name: string; supplier_type: string; registration_enabled: boolean }>(client, `SELECT id,supplier_no,name,supplier_type,registration_enabled FROM suppliers WHERE workspace_id=$1 AND supplier_no=$2 FOR UPDATE`, [ws.id, supplierNo]);
    if (supplier.supplier_type !== "EXTERNAL" || !supplier.registration_enabled || supplier.supplier_no !== "EXT-SUP-DEMO-004") throw new ApiError("SUPPLIER_NOT_REGISTRABLE", "当前供应商不开放直接注册", 403);
    const existing = (await client.query(`SELECT id FROM external_supplier_accounts WHERE supplier_id=$1`, [supplier.id])).rows[0];
    if (existing) throw new ApiError("SUPPLIER_ALREADY_REGISTERED", "当前外部供应商已经完成注册", 409);
    const account = await one<{ registered_at: Date }>(client, `INSERT INTO external_supplier_accounts(workspace_id,supplier_id,contact_name,email,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING registered_at`, [ws.id, supplier.id, parsed.contactName, parsed.email, await hashPassword(parsed.password)]);
    await client.query(`UPDATE suppliers SET contact_name=$2,email=$3 WHERE id=$1`, [supplier.id, parsed.contactName, parsed.email]);
    await event(client, ws.id, null, "EXTERNAL_SUPPLIER_REGISTERED", supplierNo, "外部供应商直接提交资料完成注册", { supplierNo });
    await bumpRevision(client, ws.id);
    return { supplier: { supplierNo, name: supplier.name, contactName: parsed.contactName, email: parsed.email, registeredAt: account.registered_at.toISOString() }, session: { supplierNo, supplierType: "EXTERNAL" as const } };
  });
}

export async function listSupplierRfqs(supplierNo: string, expectedType: "INTERNAL" | "EXTERNAL") {
  await closeExpiredRfqs();
  const supplier = await supplierRecord(supplierNo, expectedType);
  if (expectedType === "EXTERNAL" && !supplier.registered_at) throw new ApiError("REGISTRATION_REQUIRED", "请先完成外部供应商注册", 403);
  const rows = (await pool.query(`
    SELECT r.rfq_no,r.status,r.deadline_at,r.closed_at,sr.request_no,sr.item_name,sr.specification_snapshot,sr.quantity::text,sr.unit,i.invited_at,i.viewed_at,i.submitted_at,q.quote_no,q.receipt_no,
           (SELECT count(*)::int FROM request_attachments ra WHERE ra.request_id=sr.id) AS attachment_count
    FROM rfq_invitations i JOIN rfqs r ON r.id=i.rfq_id JOIN sourcing_requests sr ON sr.id=r.request_id LEFT JOIN quotes q ON q.invitation_id=i.id
    WHERE i.supplier_id=$1 ORDER BY r.created_at DESC`, [supplier.id])).rows;
  return { supplier: { supplierNo, name: supplier.name, supplierType: supplier.supplier_type }, rfqs: rows.map((row) => ({ rfqNo: row.rfq_no, requestNo: row.request_no, status: row.status, itemName: row.item_name, specification: row.specification_snapshot, quantity: row.quantity, unit: row.unit, deadlineAt: row.deadline_at.toISOString(), closedAt: row.closed_at?.toISOString() ?? null, invitedAt: row.invited_at.toISOString(), viewedAt: row.viewed_at?.toISOString() ?? null, submittedAt: row.submitted_at?.toISOString() ?? null, attachmentCount: Number(row.attachment_count ?? 0), quoteReceipt: row.quote_no ? { quoteNo: row.quote_no, receiptNo: row.receipt_no } : null })) };
}

async function supplierRfqRow(supplierNo: string, expectedType: "INTERNAL" | "EXTERNAL", rfqNo: string, lockClient?: PoolClient) {
  const db = lockClient ?? pool;
  const row = (await db.query(`
    SELECT s.id AS supplier_id,s.supplier_no,s.name AS supplier_name,s.supplier_type,a.registered_at,i.id AS invitation_id,i.invited_at,i.viewed_at,i.submitted_at,
           r.id AS rfq_id,r.rfq_no,r.status AS rfq_status,r.deadline_at,r.closed_at,r.close_reason,r.request_id,
           sr.request_no,sr.item_name,sr.specification_snapshot,sr.quantity::text,sr.unit,sr.qualification_codes,sr.required_delivery_days
    FROM suppliers s JOIN demo_workspaces w ON w.id=s.workspace_id
    JOIN rfq_invitations i ON i.supplier_id=s.id JOIN rfqs r ON r.id=i.rfq_id JOIN sourcing_requests sr ON sr.id=r.request_id
    LEFT JOIN external_supplier_accounts a ON a.supplier_id=s.id
    WHERE w.code=$1 AND s.supplier_no=$2 AND s.supplier_type=$3 AND r.rfq_no=$4${lockClient ? " FOR UPDATE OF r,i" : ""}`,
    [WORKSPACE_CODE, supplierNo, expectedType, rfqNo])).rows[0];
  if (!row) throw new ApiError("SUPPLIER_NOT_INVITED", "当前供应商未被该询价邀请", 403);
  if (expectedType === "EXTERNAL" && !row.registered_at) throw new ApiError("REGISTRATION_REQUIRED", "请先完成外部供应商注册", 403);
  return row;
}

export async function getSupplierRfq(supplierNo: string, expectedType: "INTERNAL" | "EXTERNAL", rfqNo: string) {
  await closeRfqIfExpired(rfqNo);
  const row = await supplierRfqRow(supplierNo, expectedType, rfqNo);
  const [attachments, quote] = await Promise.all([
    pool.query(`SELECT id,file_name,mime_type,size_bytes,checksum_sha256 FROM request_attachments WHERE request_id=$1 ORDER BY created_at`, [row.request_id]),
    pool.query(`SELECT q.quote_no,version.receipt_no,version.submitted_at,version.total_amount::text,version.delivery_days,version.remark,version.version_no,version.competitiveness
      FROM quotes q JOIN quote_versions version ON version.quote_id=q.id AND version.version_no=q.current_version WHERE q.invitation_id=$1`, [row.invitation_id]),
  ]);
  return { rfq: { rfqNo: row.rfq_no, requestNo: row.request_no, status: row.rfq_status, deadlineAt: row.deadline_at.toISOString(), closedAt: row.closed_at?.toISOString() ?? null, closeReason: row.close_reason, itemName: row.item_name, specification: row.specification_snapshot, quantity: row.quantity, unit: row.unit, qualificationCodes: row.qualification_codes, requiredDeliveryDays: row.required_delivery_days, invitedAt: row.invited_at.toISOString(), viewedAt: row.viewed_at?.toISOString() ?? null, submittedAt: row.submitted_at?.toISOString() ?? null }, supplier: { supplierNo: row.supplier_no, name: row.supplier_name, supplierType: row.supplier_type }, attachments: attachments.rows.map((attachment) => ({ attachmentId: attachment.id, fileName: attachment.file_name, mimeType: attachment.mime_type, sizeBytes: attachment.size_bytes, checksumSha256: attachment.checksum_sha256 })), quoteReceipt: quote.rows[0] ? { quoteNo: quote.rows[0].quote_no, receiptNo: quote.rows[0].receipt_no, totalAmount: quote.rows[0].total_amount, deliveryDays: quote.rows[0].delivery_days, remark: quote.rows[0].remark, version: quote.rows[0].version_no, competitiveness: quote.rows[0].competitiveness, submittedAt: quote.rows[0].submitted_at.toISOString() } : null };
}

export async function markSupplierRfqViewed(supplierNo: string, expectedType: "INTERNAL" | "EXTERNAL", rfqNo: string) {
  await withTransaction(async (client) => {
    const ws = await workspace(client, true);
    const row = await supplierRfqRow(supplierNo, expectedType, rfqNo, client);
    if (!row.viewed_at) {
      await client.query(`UPDATE rfq_invitations SET viewed_at=clock_timestamp() WHERE id=$1`, [row.invitation_id]);
      await event(client, ws.id, row.request_id, "RFQ_VIEWED", supplierNo, "供应商查看询价", { rfqNo });
      await bumpRevision(client, ws.id);
    }
  });
  return getSupplierRfq(supplierNo, expectedType, rfqNo);
}

type QuoteInsertContext = {
  workspaceId: string;
  requestId: string;
  rfqId: string;
  rfqNo: string;
  invitationId: string;
  supplierId: string;
  supplierNo: string;
  supplierType: "INTERNAL" | "EXTERNAL";
  requiredDeliveryDays: number;
  viewedAt: Date | null;
};

type QuoteCompetitiveness = "HIGH" | "MEDIUM" | "LOW";

async function analyzeQuoteCompetitiveness(
  client: PoolClient,
  rfqId: string,
  excludedQuoteId: string | null,
  payload: z.infer<typeof quoteSchema>,
  requiredDeliveryDays: number,
): Promise<QuoteCompetitiveness> {
  const competitors = (await client.query<{ total_amount: string }>(`
    SELECT version.total_amount::text
      FROM quotes quote
      JOIN quote_versions version ON version.quote_id=quote.id AND version.version_no=quote.current_version
     WHERE quote.rfq_id=$1 AND ($2::uuid IS NULL OR quote.id<>$2)
  `, [rfqId, excludedQuoteId])).rows;
  if (!competitors.length) return payload.deliveryDays <= requiredDeliveryDays ? "MEDIUM" : "LOW";
  const averageCents = competitors.reduce((sum, row) => sum + cents(row.total_amount), 0n) / BigInt(competitors.length);
  const amountCents = cents(payload.totalAmount);
  if (amountCents * 100n <= averageCents * 98n && payload.deliveryDays <= requiredDeliveryDays) return "HIGH";
  if (amountCents * 100n >= averageCents * 105n || payload.deliveryDays > requiredDeliveryDays) return "LOW";
  return "MEDIUM";
}

async function insertSupplierQuoteVersion(
  client: PoolClient,
  context: QuoteInsertContext,
  input: z.infer<typeof quoteSchema>,
  options: { simulated?: boolean } = {},
) {
  const parsed = quoteSchema.parse(input);
  const existing = (await client.query<{ id: string; quote_no: string; current_version: number }>(`
    SELECT id,quote_no,current_version FROM quotes WHERE invitation_id=$1 FOR UPDATE
  `, [context.invitationId])).rows[0];
  if (existing && (existing.current_version >= 2 || options.simulated)) {
    throw new ApiError("QUOTE_ALREADY_SUBMITTED", "该供应商已用完唯一一次重新报价机会", 409);
  }
  const quoteId = existing?.id ?? crypto.randomUUID();
  const quoteNo = existing?.quote_no ?? `QT-LIVE-${quoteId.replaceAll("-", "").toUpperCase()}`;
  const version = existing ? existing.current_version + 1 : 1;
  const receiptNo = `RCPT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const payload = { totalAmount: normalizeMoney(parsed.totalAmount), deliveryDays: parsed.deliveryDays, remark: parsed.remark };
  const payloadSha256 = stableHash(payload);
  const competitiveness = await analyzeQuoteCompetitiveness(client, context.rfqId, existing?.id ?? null, payload, context.requiredDeliveryDays);
  const submittedAt = (await one<{ now: Date }>(client, `SELECT clock_timestamp() AS now`)).now;
  if (existing) {
    await client.query(`UPDATE quotes SET current_version=$2,submitted_at=$3,receipt_no=$4,payload_sha256=$5 WHERE id=$1`, [quoteId, version, submittedAt, receiptNo, payloadSha256]);
  } else {
    await client.query(
      `INSERT INTO quotes(id,workspace_id,quote_no,rfq_id,invitation_id,supplier_id,submitted_at,receipt_no,payload_sha256,current_version)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1)`,
      [quoteId, context.workspaceId, quoteNo, context.rfqId, context.invitationId, context.supplierId, submittedAt, receiptNo, payloadSha256],
    );
  }
  await client.query(
    `INSERT INTO quote_versions(workspace_id,quote_id,version_no,receipt_no,total_amount,delivery_days,remark,competitiveness,submitted_at,payload_sha256,is_simulated)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [context.workspaceId, quoteId, version, receiptNo, payload.totalAmount, payload.deliveryDays, payload.remark, competitiveness, submittedAt, payloadSha256, Boolean(options.simulated)],
  );
  await client.query(
    `UPDATE rfq_invitations
        SET viewed_at=coalesce(viewed_at,$2),submitted_at=$2
      WHERE id=$1`,
    [context.invitationId, submittedAt],
  );
  if (!context.viewedAt) {
    await event(
      client,
      context.workspaceId,
      context.requestId,
      "RFQ_VIEWED",
      context.supplierNo,
      options.simulated ? "供应商查看询价（演示模拟）" : "供应商查看询价",
      { rfqNo: context.rfqNo, simulated: Boolean(options.simulated) },
    );
  }
  await event(
    client,
    context.workspaceId,
    context.requestId,
    version === 1 ? "QUOTE_SUBMITTED" : "QUOTE_REQUOTED",
    context.supplierNo,
    version === 1 ? "供应商提交首次报价" : "供应商提交唯一一次重新报价",
    { rfqNo: context.rfqNo, quoteNo, receiptNo, version, competitiveness, simulated: Boolean(options.simulated) },
  );
  return { quoteNo, receiptNo, submittedAt: submittedAt.toISOString(), version, competitiveness, ...payload };
}

const simulatedUnitPriceCents: Record<string, bigint> = {
  "ITEM-BOLT-M12": 300n,
  "ITEM-PLATE-Q235": 625_000n,
  "ITEM-VALVE-HCV": 280_000n,
};

const simulatedQuoteRemarks = [
  "含税到厂，报价有效期 30 天",
  "含包装与运输，支持按计划分批交付",
  "含出厂检验报告，支持到货验收",
  "常规包装，已预留优先排产窗口",
  "含税含运，提供 12 个月质量保证",
  "按技术协议执行，支持交付进度跟踪",
  "含装卸费用，交付前提供质检资料",
  "价格含税，支持按采购计划分批供货",
] as const;

function scaledDecimal(value: string, scale: number) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0").slice(0, scale));
}

function formatMoneyFromCents(value: bigint) {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

function simulatedQuoteInput(
  itemCode: string,
  quantity: string,
  minimumDeliveryDays: number,
  index: number,
): z.infer<typeof quoteSchema> {
  const unitPrice = simulatedUnitPriceCents[itemCode];
  if (!unitPrice) throw new ApiError("INVALID_INPUT", `物品 ${itemCode} 尚未配置演示报价区间`, 400);
  const quantityThousandths = scaledDecimal(quantity, 3);
  const baseAmountCents = unitPrice * quantityThousandths / 1_000n;
  const variationBasisPoints = 9_400n + BigInt(index) * 230n;
  const variedAmountCents = baseAmountCents * variationBasisPoints / 10_000n + BigInt(index + 1);
  return quoteSchema.parse({
    totalAmount: formatMoneyFromCents(variedAmountCents),
    deliveryDays: Math.min(365, minimumDeliveryDays + index % 3),
    remark: simulatedQuoteRemarks[index % simulatedQuoteRemarks.length],
  });
}

export type SimulateRemainingQuotesSummary = {
  requestNo: string;
  simulatedCount: number;
  registeredExternalCount: number;
  submittedCount: number;
  invitedCount: number;
  closedByDeadline: boolean;
  detail: Awaited<ReturnType<typeof getRequestDetail>>;
};

export async function simulateRemainingQuotesInTransaction(client: PoolClient, rfqNo: string): Promise<SimulateRemainingQuotesSummary> {
    const ws = await workspace(client, true);
    const rfq = await one<{
      id: string;
      request_id: string;
      request_no: string;
      status: string;
      deadline_at: Date;
      item_code: string;
      quantity: string;
      required_delivery_days: number;
    }>(client, `
      SELECT r.id,r.request_id,r.status,r.deadline_at,sr.request_no,sr.item_code,sr.quantity::text,sr.required_delivery_days
        FROM rfqs r
        JOIN sourcing_requests sr ON sr.id=r.request_id
       WHERE r.workspace_id=$1 AND r.rfq_no=$2
       FOR UPDATE OF r`, [ws.id, rfqNo]);
    const databaseClock = await one<{ now: Date }>(client, `SELECT clock_timestamp() AS now`);
    if (rfq.status !== "OPEN") {
      throw new ApiError("RFQ_CLOSED", "报价已经停止，不能再模拟供应商报价", 409);
    }
    const invitations = (await client.query<{
      invitation_id: string;
      supplier_id: string;
      supplier_no: string;
      supplier_name: string;
      supplier_type: "INTERNAL" | "EXTERNAL";
      registration_enabled: boolean;
      contact_name: string | null;
      email: string | null;
      account_id: string | null;
      quote_id: string | null;
      current_version_id: string | null;
      current_version: number | null;
      version_count: number;
      viewed_at: Date | null;
      submitted_at: Date | null;
      minimum_delivery_days: number | null;
    }>(`
      SELECT i.id AS invitation_id,s.id AS supplier_id,s.supplier_no,s.name AS supplier_name,s.supplier_type,
             s.registration_enabled,s.contact_name,s.email,esa.id AS account_id,q.id AS quote_id,i.submitted_at,
             current_version.id AS current_version_id,q.current_version,
             (SELECT count(*)::int FROM quote_versions all_versions WHERE all_versions.quote_id=q.id) AS version_count,
             i.viewed_at,capability.minimum_delivery_days
        FROM rfq_invitations i
        JOIN suppliers s ON s.id=i.supplier_id
        LEFT JOIN supplier_capabilities capability
          ON capability.workspace_id=i.workspace_id
         AND capability.supplier_id=s.id
         AND capability.item_code=$2
        LEFT JOIN external_supplier_accounts esa ON esa.supplier_id=s.id
        LEFT JOIN quotes q ON q.invitation_id=i.id
        LEFT JOIN quote_versions current_version ON current_version.quote_id=q.id AND current_version.version_no=q.current_version
       WHERE i.rfq_id=$1
       ORDER BY s.supplier_type,s.supplier_no
       FOR UPDATE OF i,s`, [rfq.id, rfq.item_code])).rows;
    if (!invitations.length) {
      throw new ApiError("STALE_VERSION", "当前询价没有供应商邀请，无法生成模拟报价", 409);
    }
    const inconsistentInvitation = invitations.find((invitation) => {
      const hasQuote = Boolean(invitation.quote_id);
      return hasQuote !== Boolean(invitation.submitted_at)
        || hasQuote !== Boolean(invitation.current_version_id)
        || (hasQuote && invitation.version_count !== invitation.current_version);
    });
    if (inconsistentInvitation) {
      throw new ApiError("STALE_VERSION", `${inconsistentInvitation.supplier_name} 的报价状态与版本记录不一致，请检查数据后重试`, 409);
    }
    if (rfq.deadline_at.getTime() <= databaseClock.now.getTime()) {
      await closeLockedRfq(client, ws, rfq, "DEADLINE_REACHED");
      const detail = await getRequestDetail(rfq.request_no, client);
      return {
        requestNo: rfq.request_no,
        simulatedCount: 0,
        registeredExternalCount: 0,
        submittedCount: invitations.filter((invitation) => invitation.submitted_at).length,
        invitedCount: invitations.length,
        closedByDeadline: true,
        detail,
      };
    }
    const missing = invitations.filter((invitation) => !invitation.quote_id);
    const missingCapability = invitations.find((invitation) => invitation.minimum_delivery_days == null);
    if (missingCapability) {
      throw new ApiError("STALE_VERSION", `${missingCapability.supplier_name} 缺少当前物品的供应能力记录，无法生成正确报价`, 409);
    }
    const invalidExternal = missing.find((invitation) => invitation.supplier_type === "EXTERNAL" && !invitation.account_id && !invitation.registration_enabled);
    if (invalidExternal) {
      throw new ApiError("REGISTRATION_REQUIRED", `${invalidExternal.supplier_name} 尚未注册且未开放演示注册，无法补齐报价`, 409);
    }
    const demoPasswordHash = missing.some((invitation) => invitation.supplier_type === "EXTERNAL" && !invitation.account_id)
      ? await hashPassword("DemoPass123!")
      : null;
    let registeredExternalCount = 0;
    for (const invitation of missing) {
      if (invitation.supplier_type === "EXTERNAL" && !invitation.account_id) {
        const email = invitation.email ?? `${invitation.supplier_no.toLowerCase()}@example.test`;
        await client.query(
          `INSERT INTO external_supplier_accounts(workspace_id,supplier_id,contact_name,email,password_hash)
           VALUES($1,$2,$3,$4,$5)`,
          [ws.id, invitation.supplier_id, invitation.contact_name ?? `${invitation.supplier_name}联系人`, email, demoPasswordHash],
        );
        await event(client, ws.id, rfq.request_id, "EXTERNAL_SUPPLIER_REGISTERED", invitation.supplier_no, "外部供应商提交演示资料完成注册", { supplierNo: invitation.supplier_no, simulated: true });
        registeredExternalCount += 1;
      }
    }
    for (let index = 0; index < missing.length; index++) {
      const invitation = missing[index];
      await insertSupplierQuoteVersion(
        client,
        {
          workspaceId: ws.id,
          requestId: rfq.request_id,
          rfqId: rfq.id,
          rfqNo,
          invitationId: invitation.invitation_id,
          supplierId: invitation.supplier_id,
          supplierNo: invitation.supplier_no,
          supplierType: invitation.supplier_type,
          requiredDeliveryDays: rfq.required_delivery_days,
          viewedAt: invitation.viewed_at,
        },
        simulatedQuoteInput(rfq.item_code, rfq.quantity, invitation.minimum_delivery_days!, index),
        { simulated: true },
      );
    }
    if (missing.length) {
      await event(client, ws.id, rfq.request_id, "REMAINING_QUOTES_SIMULATED", "buyer-demo-helper", "一键补齐剩余供应商首次报价", {
        rfqNo,
        simulatedCount: missing.length,
        registeredExternalCount,
        supplierNos: missing.map((invitation) => invitation.supplier_no),
      });
      await bumpRevision(client, ws.id);
    }
    const detail = await getRequestDetail(rfq.request_no, client);
    return {
      requestNo: rfq.request_no,
      simulatedCount: missing.length,
      registeredExternalCount,
      submittedCount: invitations.length,
      invitedCount: invitations.length,
      closedByDeadline: false,
      detail,
    };
}

export async function simulateRemainingQuotes(rfqNo: string) {
  const result = await withTransaction((client) => simulateRemainingQuotesInTransaction(client, rfqNo));
  if (result.closedByDeadline) throw new ApiError("RFQ_CLOSED", "报价已到截止时间并自动停止", 409);
  return result;
}

async function ownSupplierQuoteResult(
  db: Pool | PoolClient,
  row: Awaited<ReturnType<typeof supplierRfqRow>>,
  rfqNo: string,
) {
  const versions = (await db.query<{
    quote_no: string; receipt_no: string; submitted_at: Date; total_amount: string; delivery_days: number;
    remark: string; version_no: number; competitiveness: QuoteCompetitiveness | null;
  }>(`
    SELECT q.quote_no,version.receipt_no,version.submitted_at,version.total_amount::text,version.delivery_days,
           version.remark,version.version_no,version.competitiveness
      FROM quotes q
      JOIN quote_versions version ON version.quote_id=q.id
     WHERE q.invitation_id=$1
     ORDER BY version.version_no
  `, [row.invitation_id])).rows;
  if (!versions.length) throw new ApiError("NOT_FOUND", "尚未提交报价", 404);
  const mapped = versions.map((version) => ({
    quoteNo: version.quote_no,
    receiptNo: version.receipt_no,
    submittedAt: version.submitted_at.toISOString(),
    totalAmount: version.total_amount,
    deliveryDays: version.delivery_days,
    remark: version.remark,
    version: version.version_no,
    competitiveness: version.competitiveness,
  }));
  const databaseClock = await one<{ now: Date }>(db, `SELECT clock_timestamp() AS now`);
  const canRequote = mapped.length === 1
    && row.rfq_status === "OPEN"
    && row.deadline_at.getTime() > databaseClock.now.getTime();
  return {
    rfqNo,
    quote: mapped[mapped.length - 1],
    versions: mapped,
    sealed: false as const,
    editable: canRequote,
    canRequote,
    remainingRequotes: canRequote ? 1 as const : 0 as const,
  };
}

export async function submitSupplierQuoteInTransaction(client: PoolClient, supplierNo: string, expectedType: "INTERNAL" | "EXTERNAL", rfqNo: string, input: z.infer<typeof quoteSchema>) {
  const parsed = quoteSchema.parse(input);
  const ws = await workspace(client, true);
  const row = await supplierRfqRow(supplierNo, expectedType, rfqNo, client);
  const databaseClock = await one<{ now: Date }>(client, `SELECT clock_timestamp() AS now`);
  if (row.rfq_status !== "OPEN" || row.deadline_at.getTime() <= databaseClock.now.getTime()) throw new ApiError("RFQ_CLOSED", "报价已经停止", 409);
  await insertSupplierQuoteVersion(client, {
    workspaceId: ws.id,
    requestId: row.request_id,
    rfqId: row.rfq_id,
    rfqNo,
    invitationId: row.invitation_id,
    supplierId: row.supplier_id,
    supplierNo,
    supplierType: expectedType,
    requiredDeliveryDays: row.required_delivery_days,
    viewedAt: row.viewed_at,
  }, parsed);
  await bumpRevision(client, ws.id);
  return ownSupplierQuoteResult(client, row, rfqNo);
}

export async function submitSupplierQuote(supplierNo: string, expectedType: "INTERNAL" | "EXTERNAL", rfqNo: string, input: z.infer<typeof quoteSchema>) {
  await closeRfqIfExpired(rfqNo);
  return withTransaction((client) => submitSupplierQuoteInTransaction(client, supplierNo, expectedType, rfqNo, input));
}

export async function getOwnSupplierQuote(supplierNo: string, expectedType: "INTERNAL" | "EXTERNAL", rfqNo: string) {
  const row = await supplierRfqRow(supplierNo, expectedType, rfqNo);
  return ownSupplierQuoteResult(pool, row, rfqNo);
}

export async function getAttachment(attachmentId: string, supplier?: { supplierNo: string; type: "INTERNAL" | "EXTERNAL" }) {
  const values: unknown[] = [WORKSPACE_CODE, attachmentId];
  let predicate = "";
  if (supplier) { values.push(supplier.supplierNo, supplier.type); predicate = ` AND EXISTS (SELECT 1 FROM rfqs r JOIN rfq_invitations i ON i.rfq_id=r.id JOIN suppliers s ON s.id=i.supplier_id WHERE r.request_id=a.request_id AND s.supplier_no=$3 AND s.supplier_type=$4)`; }
  const row = (await pool.query<{ file_name: string; mime_type: string; content: Buffer }>(`SELECT a.file_name,a.mime_type,a.content FROM request_attachments a JOIN demo_workspaces w ON w.id=a.workspace_id WHERE w.code=$1 AND a.id=$2${predicate}`, values)).rows[0];
  if (!row) throw new ApiError(supplier ? "SUPPLIER_NOT_INVITED" : "NOT_FOUND", supplier ? "当前供应商无权下载该附件" : "附件不存在", supplier ? 403 : 404);
  return row;
}

export async function preflight() {
  const checks: Array<{ name: string; passed: boolean; actual: unknown; expected: unknown }> = [];
  const count = async (sql: string, values: unknown[] = []) => Number((await one<{ count: string }>(pool, sql, values)).count);
  checks.push({ name: "固定需求数量", passed: await count(`SELECT count(*)::text AS count FROM sourcing_requests sr JOIN demo_workspaces w ON w.id=sr.workspace_id WHERE w.code=$1 AND sr.is_seeded=true`, [WORKSPACE_CODE]) === 5, actual: await count(`SELECT count(*)::text AS count FROM sourcing_requests WHERE is_seeded=true`), expected: 5 });
  const stageRows = (await pool.query<{ status: string; count: string }>(`SELECT status,count(*)::text FROM sourcing_requests WHERE is_seeded=true GROUP BY status`)).rows;
  checks.push({ name: "五个阶段完整", passed: ["SOURCING_READY","BIDDING_OPEN","EVALUATION_PENDING","AWARD_PENDING","COMPLETED"].every((status) => stageRows.some((row) => row.status === status && Number(row.count) === 1)), actual: stageRows, expected: "五个阶段各 1 条" });
  const rfq2 = await one<{ deadline_at: Date; invitations: string; quotes: string; versioned: string }>(pool, `SELECT r.deadline_at,count(DISTINCT i.id)::text AS invitations,count(DISTINCT q.id)::text AS quotes,count(DISTINCT version.quote_id)::text AS versioned FROM rfqs r LEFT JOIN rfq_invitations i ON i.rfq_id=r.id LEFT JOIN quotes q ON q.rfq_id=r.id LEFT JOIN quote_versions version ON version.quote_id=q.id AND version.version_no=q.current_version WHERE r.rfq_no='RFQ-DEMO-0002' GROUP BY r.id`);
  checks.push({
    name: "阶段二明文报价基线",
    passed: rfq2.invitations === "6"
      && rfq2.quotes === "2"
      && rfq2.versioned === "2"
      && rfq2.deadline_at.toISOString() === ACTIVE_DEMO_RFQ_DEADLINE,
    actual: rfq2,
    expected: { invitations: "6", quotes: "2", versioned: "2", deadlineAt: ACTIVE_DEMO_RFQ_DEADLINE },
  });
  const orphanQuotes = await count(`SELECT count(*)::text AS count FROM quotes q LEFT JOIN rfq_invitations i ON i.id=q.invitation_id AND i.rfq_id=q.rfq_id AND i.supplier_id=q.supplier_id WHERE i.id IS NULL`);
  checks.push({ name: "报价关联完整", passed: orphanQuotes === 0, actual: orphanQuotes, expected: 0 });
  return { ready: checks.every((check) => check.passed), checks, deepSeekConfigured: Boolean(env.DEEPSEEK_API_KEY), quoteEncryptionConfigured: env.quoteKey.length === 32 };
}

type IdempotencyOptions = {
  allowMissingWorkspace?: boolean;
  sealResponse?: boolean;
  workspaceLifecycle?: "shared" | "exclusive";
  workInTransaction?: boolean;
};

export async function withIdempotency<T>(scope: string, actor: string, key: string | null, requestBody: unknown, work: (client?: PoolClient) => Promise<T>, options: IdempotencyOptions = {}): Promise<T> {
  if (!key) throw new ApiError("INVALID_INPUT", "写接口必须提供 Idempotency-Key", 400);
  const requestHash = stableHash(requestBody);
  const lockIdentity = JSON.stringify([WORKSPACE_CODE, scope, actor, key]);
  const lifecycleMode = options.workspaceLifecycle ?? "shared";
  const client = await pool.connect();
  let discardClient = false;
  let lifecycleLocked = false;
  let idempotencyLocked = false;
  let workTransactionOpen = false;
  try {
    await acquireWorkspaceLifecycleLock(client, lifecycleMode);
    lifecycleLocked = true;
    await client.query(`SELECT pg_advisory_lock(hashtextextended($1,0))`, [lockIdentity]);
    idempotencyLocked = true;
    const ws = options.allowMissingWorkspace ? await maybeWorkspace(client) : await workspace(client);
    const decodeSnapshot = (snapshot: unknown, workspaceId: string) => {
      if (!options.sealResponse) return snapshot as T;
      if (!isSealedJsonSnapshot(snapshot)) throw new ApiError("INTERNAL_ERROR", "密封响应快照格式无效", 500);
      return openJsonSnapshot<T>(snapshot, idempotencyAad(workspaceId, scope, actor, key, requestHash));
    };
    const existing = ws
      ? (await client.query<{ request_hash: string; response_snapshot: unknown }>(`SELECT request_hash,response_snapshot FROM idempotency_records WHERE workspace_id=$1 AND scope=$2 AND actor=$3 AND idempotency_key=$4`, [ws.id, scope, actor, key])).rows[0]
      : undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) throw new ApiError("IDEMPOTENCY_KEY_REUSED", "同一个幂等 Key 不能用于不同请求", 409);
      return decodeSnapshot(existing.response_snapshot, ws!.id);
    }
    if (options.workInTransaction) {
      await client.query("BEGIN");
      workTransactionOpen = true;
    }
    const result = await work(options.workInTransaction ? client : undefined);
    const currentWs = await workspace(client);
    const responseSnapshot = options.sealResponse
      ? sealJsonSnapshot(result, idempotencyAad(currentWs.id, scope, actor, key, requestHash))
      : result;
    await client.query(`INSERT INTO idempotency_records(workspace_id,scope,actor,idempotency_key,request_hash,response_snapshot) VALUES($1,$2,$3,$4,$5,$6)`, [currentWs.id, scope, actor, key, requestHash, JSON.stringify(responseSnapshot)]);
    if (workTransactionOpen) {
      await client.query("COMMIT");
      workTransactionOpen = false;
    }
    return result;
  } catch (error) {
    if (workTransactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discardClient = true;
      }
      workTransactionOpen = false;
    }
    throw error;
  } finally {
    if (idempotencyLocked) {
      try {
        await client.query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`, [lockIdentity]);
      } catch {
        discardClient = true;
      }
    }
    if (lifecycleLocked) {
      try {
        await releaseWorkspaceLifecycleLock(client, lifecycleMode);
      } catch {
        discardClient = true;
      }
    }
    client.release(discardClient);
  }
}
