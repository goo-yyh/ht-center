import { z } from "zod";
import { env } from "./env";
import { ApiError } from "./errors";

const candidateOutput = z.object({
  summary: z.string().min(1).max(1000),
  candidates: z.array(z.object({
    supplierNo: z.string(),
    recommendation: z.string().min(1).max(300),
    riskSummary: z.string().min(1).max(200),
  })),
});

const evaluationOutput = z.object({
  summary: z.string().min(1).max(1000),
  items: z.array(z.object({
    quoteNo: z.string(),
    strengthCode: z.enum(["PRICE", "DELIVERY", "MATCH", "RISK", "BALANCED"]),
    riskCode: z.enum(["PRICE", "DELIVERY", "MATCH", "RISK", "NONE"]),
  })),
});

const agentIntentOutput = z.object({
  intent: z.enum(["RUN_SOURCING", "ADJUST_AND_SOURCE", "CONVERSATION", "OUT_OF_SCOPE"]),
  answer: z.string().min(1).max(1000),
});

export type DeepSeekResult<T> = {
  value: T;
  providerRequestId: string | null;
  providerRequestIds?: string[];
  model: string;
};

type DeepSeekToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type DeepSeekMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls: DeepSeekToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type DeepSeekToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type CompletionMessage = {
  content?: string | null;
  tool_calls?: DeepSeekToolCall[];
};

const completionResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({
      content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({
        id: z.string().min(1),
        type: z.literal("function"),
        function: z.object({
          name: z.string().min(1),
          arguments: z.string(),
        }),
      })).optional(),
    }),
  })).min(1),
});

type CompletionResult = {
  message: CompletionMessage;
  finishReason: string | null;
  providerRequestId: string | null;
  model: string;
};

type CompletionOptions = {
  responseFormat?: { type: "json_object" };
  tools?: DeepSeekToolDefinition[];
  requiredToolName?: string;
};

async function requestCompletion(messages: DeepSeekMessage[], options: CompletionOptions = {}): Promise<CompletionResult> {
  if (!env.DEEPSEEK_API_KEY) {
    throw new ApiError("AGENT_SERVICE_UNAVAILABLE", "尚未配置 DEEPSEEK_API_KEY，不能执行真实 Agent 调用", 503);
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.DEEPSEEK_TIMEOUT_MS);
    try {
      const response = await fetch(`${env.DEEPSEEK_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.DEEPSEEK_MODEL,
          messages,
          temperature: 0.2,
          thinking: { type: "disabled" },
          ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
          ...(options.tools?.length ? {
            tools: options.tools,
            ...(options.requiredToolName ? { tool_choice: { type: "function", function: { name: options.requiredToolName } } } : {}),
          } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const message = await response.text();
        if ([429, 500, 503].includes(response.status) && attempt < 2) {
          lastError = new Error(`DeepSeek ${response.status}: ${message.slice(0, 200)}`);
          continue;
        }
        throw new ApiError("AGENT_SERVICE_UNAVAILABLE", `DeepSeek 调用失败（${response.status}）`, 503);
      }
      const parsedResponse = completionResponseSchema.safeParse(await response.json());
      if (!parsedResponse.success) {
        throw new ApiError("AGENT_OUTPUT_INVALID", "DeepSeek 未返回有效消息", 502, parsedResponse.error.issues);
      }
      const json = parsedResponse.data;
      const choice = json.choices[0];
      return {
        message: choice.message,
        finishReason: choice.finish_reason ?? null,
        providerRequestId: json.id ?? null,
        model: json.model ?? env.DEEPSEEK_MODEL,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = error;
      if (attempt >= 2) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ApiError("AGENT_SERVICE_UNAVAILABLE", lastError instanceof Error ? `DeepSeek 暂时不可用：${lastError.message}` : "DeepSeek 暂时不可用", 503);
}

async function requestJson<T>(system: string, user: string, schema: z.ZodType<T>): Promise<DeepSeekResult<T>> {
  const completion = await requestCompletion(
    [{ role: "system", content: system }, { role: "user", content: user }],
    { responseFormat: { type: "json_object" } },
  );
  const content = completion.message.content;
  if (!content) throw new ApiError("AGENT_OUTPUT_INVALID", "DeepSeek 未返回有效 JSON", 502);
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new ApiError("AGENT_OUTPUT_INVALID", "DeepSeek 返回内容不是合法 JSON", 502); }
  const validated = schema.safeParse(parsed);
  if (!validated.success) throw new ApiError("AGENT_OUTPUT_INVALID", "DeepSeek 返回结构未通过校验", 502, validated.error.issues);
  return { value: validated.data, providerRequestId: completion.providerRequestId, model: completion.model };
}

export type SourcingToolName =
  | "query_internal_suppliers"
  | "query_1688_suppliers"
  | "query_qichacha_suppliers"
  | "query_industry_platform_suppliers"
  | "check_supplier_qualifications"
  | "check_supplier_delivery";

type SourceQueryToolCall = {
  id: string;
  name: "query_internal_suppliers" | "query_1688_suppliers" | "query_qichacha_suppliers" | "query_industry_platform_suppliers";
  arguments: { itemCode: string };
};

type QualificationToolCall = {
  id: string;
  name: "check_supplier_qualifications";
  arguments: { supplierNos: string[]; qualificationCodes: string[] };
};

type DeliveryToolCall = {
  id: string;
  name: "check_supplier_delivery";
  arguments: { supplierNos: string[]; requiredDeliveryDays: number };
};

export type SourcingToolCall = SourceQueryToolCall | QualificationToolCall | DeliveryToolCall;

export type SourcingToolExecutionResult = {
  summary: string;
  suppliers: Array<{
    supplierNo: string;
    supplierType: "INTERNAL" | "EXTERNAL";
    name: string;
    region: string;
    sourcePlatform: string;
    qualifications: string[];
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    minimumDeliveryDays: number;
    matchScore: number;
  }>;
};

type SourcingToolCallbacks = {
  executeTool: (call: SourcingToolCall) => Promise<SourcingToolExecutionResult>;
  finalize: (work: () => Promise<DeepSeekResult<z.infer<typeof candidateOutput>>>) => Promise<DeepSeekResult<z.infer<typeof candidateOutput>>>;
};

const sourceArgumentSchema = z.object({ itemCode: z.string().min(1) }).strict();
const qualificationArgumentSchema = z.object({
  supplierNos: z.array(z.string().min(1)).min(1),
  qualificationCodes: z.array(z.string().min(1)),
}).strict();
const deliveryArgumentSchema = z.object({
  supplierNos: z.array(z.string().min(1)).min(1),
  requiredDeliveryDays: z.number().int().positive(),
}).strict();

const sourcingToolDefinitions: Array<{ name: SourcingToolName; definition: DeepSeekToolDefinition }> = [
  {
    name: "query_internal_suppliers",
    definition: {
      type: "function",
      function: {
        name: "query_internal_suppliers",
        description: "查询海天内部供应商资源湖中具备指定物品供货能力的供应商。",
        parameters: { type: "object", properties: { itemCode: { type: "string", description: "采购目录物品编码" } }, required: ["itemCode"], additionalProperties: false },
      },
    },
  },
  {
    name: "query_1688_suppliers",
    definition: {
      type: "function",
      function: {
        name: "query_1688_suppliers",
        description: "通过 1688 供应商检索接口查询指定物品的外部供应商。",
        parameters: { type: "object", properties: { itemCode: { type: "string", description: "采购目录物品编码" } }, required: ["itemCode"], additionalProperties: false },
      },
    },
  },
  {
    name: "query_qichacha_suppliers",
    definition: {
      type: "function",
      function: {
        name: "query_qichacha_suppliers",
        description: "通过企查查企业信息接口查询具备指定物品能力的外部企业。",
        parameters: { type: "object", properties: { itemCode: { type: "string", description: "采购目录物品编码" } }, required: ["itemCode"], additionalProperties: false },
      },
    },
  },
  {
    name: "query_industry_platform_suppliers",
    definition: {
      type: "function",
      function: {
        name: "query_industry_platform_suppliers",
        description: "通过行业平台爬虫接口查询具备指定物品能力的外部供应商。",
        parameters: { type: "object", properties: { itemCode: { type: "string", description: "采购目录物品编码" } }, required: ["itemCode"], additionalProperties: false },
      },
    },
  },
  {
    name: "check_supplier_qualifications",
    definition: {
      type: "function",
      function: {
        name: "check_supplier_qualifications",
        description: "调用供应商资质核验接口，按采购要求筛选候选供应商。",
        parameters: {
          type: "object",
          properties: {
            supplierNos: { type: "array", items: { type: "string" }, description: "上一步接口返回的全部供应商编号" },
            qualificationCodes: { type: "array", items: { type: "string" }, description: "采购要求的资质编码" },
          },
          required: ["supplierNos", "qualificationCodes"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    name: "check_supplier_delivery",
    definition: {
      type: "function",
      function: {
        name: "check_supplier_delivery",
        description: "调用交付能力核验接口，筛选能在要求天数内交付的供应商。",
        parameters: {
          type: "object",
          properties: {
            supplierNos: { type: "array", items: { type: "string" }, description: "资质核验通过的全部供应商编号" },
            requiredDeliveryDays: { type: "integer", minimum: 1, description: "要求交付天数" },
          },
          required: ["supplierNos", "requiredDeliveryDays"],
          additionalProperties: false,
        },
      },
    },
  },
];

const submitCandidateTool: DeepSeekToolDefinition = {
  type: "function",
  function: {
    name: "submit_candidate_recommendations",
    description: "提交本轮最终候选供应商推荐和风险说明。只能提交工具返回且通过核验的供应商。",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "本轮寻源总结" },
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              supplierNo: { type: "string" },
              recommendation: { type: "string" },
              riskSummary: { type: "string" },
            },
            required: ["supplierNo", "recommendation", "riskSummary"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "candidates"],
      additionalProperties: false,
    },
  },
};

function parseArguments(raw: string) {
  try { return JSON.parse(raw) as unknown; } catch { throw new ApiError("AGENT_OUTPUT_INVALID", "DeepSeek 工具参数不是合法 JSON", 502); }
}

function parseSourcingToolCall(raw: DeepSeekToolCall, expectedName: SourcingToolName): SourcingToolCall {
  if (!raw.id || raw.type !== "function" || raw.function.name !== expectedName) {
    const actualName = raw.function?.name || "<缺失>";
    const actualType = raw.type || "<缺失>";
    throw new ApiError("AGENT_OUTPUT_INVALID", `DeepSeek 未按要求调用工具 ${expectedName}（实际名称 ${actualName}，类型 ${actualType}）`, 502);
  }
  const parsed = parseArguments(raw.function.arguments);
  if (expectedName === "check_supplier_qualifications") {
    const result = qualificationArgumentSchema.safeParse(parsed);
    if (!result.success) throw new ApiError("AGENT_OUTPUT_INVALID", "DeepSeek 资质核验工具参数无效", 502, result.error.issues);
    return { id: raw.id, name: expectedName, arguments: result.data };
  }
  if (expectedName === "check_supplier_delivery") {
    const result = deliveryArgumentSchema.safeParse(parsed);
    if (!result.success) throw new ApiError("AGENT_OUTPUT_INVALID", "DeepSeek 交付核验工具参数无效", 502, result.error.issues);
    return { id: raw.id, name: expectedName, arguments: result.data };
  }
  const result = sourceArgumentSchema.safeParse(parsed);
  if (!result.success) throw new ApiError("AGENT_OUTPUT_INVALID", "DeepSeek 供应商查询工具参数无效", 502, result.error.issues);
  return { id: raw.id, name: expectedName, arguments: result.data };
}

async function requiredToolTurn(messages: DeepSeekMessage[], tool: DeepSeekToolDefinition) {
  const allTools = [...sourcingToolDefinitions.map((entry) => entry.definition), submitCandidateTool];
  messages.push({ role: "user", content: `工具列表中，本步骤必须且只能调用 ${tool.function.name}，请严格使用该工具名称和参数结构。` });
  let lastActualName = "<缺失>";
  let lastActualType = "<缺失>";
  const attemptProviderRequestIds: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const completion = await requestCompletion(messages, { tools: allTools, requiredToolName: tool.function.name });
    if (completion.providerRequestId) attemptProviderRequestIds.push(completion.providerRequestId);
    const calls = completion.message.tool_calls;
    const call = calls?.[0];
    lastActualName = call?.function?.name || "<缺失>";
    lastActualType = call?.type || "<缺失>";
    if (completion.finishReason === "tool_calls" && calls?.length === 1 && call?.function.name === tool.function.name) {
      messages.push({ role: "assistant", content: completion.message.content ?? null, tool_calls: calls });
      return { completion, call, attemptProviderRequestIds };
    }
    messages.push({ role: "user", content: `上一次工具调用无效。请重新调用当前步骤指定的 ${tool.function.name}，不要调用其他工具。` });
  }
  throw new ApiError("AGENT_OUTPUT_INVALID", `DeepSeek 未按要求调用工具 ${tool.function.name}（实际名称 ${lastActualName}，类型 ${lastActualType}）`, 502);
}

export async function sourceCandidatesWithTools(input: unknown, callbacks: SourcingToolCallbacks) {
  const messages: DeepSeekMessage[] = [
    {
      role: "system",
      content: [
        "你是海天企业采购寻源 Agent，必须通过系统提供的工具逐步完成寻源。",
        "工具列表包含完整寻源流程；每一步只能调用系统在当前消息中明确指定的工具，不得跳过、重复或编造接口结果。",
        "查询结果只能来自 role=tool 返回的数据；不得增加工具未返回的供应商。",
        "资质与交付核验时必须原样传入上一步返回的全部 supplierNo 和采购条件。",
        "最后必须调用 submit_candidate_recommendations，并对全部最终候选各返回一条推荐与风险说明。",
        "不要输出思考过程。",
      ].join("\n"),
    },
    { role: "user", content: `请按以下寻源需求执行工具调用：\n${JSON.stringify(input)}` },
  ];
  const providerRequestIds: string[] = [];
  let model = env.DEEPSEEK_MODEL;

  for (const step of sourcingToolDefinitions) {
    const { completion, call: rawCall, attemptProviderRequestIds } = await requiredToolTurn(messages, step.definition);
    providerRequestIds.push(...attemptProviderRequestIds);
    model = completion.model;
    const call = parseSourcingToolCall(rawCall, step.name);
    const result = await callbacks.executeTool(call);
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
  }

  return callbacks.finalize(async () => {
    const { completion, call, attemptProviderRequestIds } = await requiredToolTurn(messages, submitCandidateTool);
    providerRequestIds.push(...attemptProviderRequestIds);
    if (call.function.name !== submitCandidateTool.function.name) {
      throw new ApiError("AGENT_OUTPUT_INVALID", "DeepSeek 未调用最终候选提交工具", 502);
    }
    const parsed = parseArguments(call.function.arguments);
    const validated = candidateOutput.safeParse(parsed);
    if (!validated.success) throw new ApiError("AGENT_OUTPUT_INVALID", "DeepSeek 最终候选结构未通过校验", 502, validated.error.issues);
    return { value: validated.data, providerRequestId: completion.providerRequestId, providerRequestIds, model: completion.model || model };
  });
}

export function describeCandidates(input: unknown) {
  return requestJson(
    "你是企业采购寻源助手。只能评价输入白名单中的供应商，不得新增供应商。必须对输入 candidates 中的每个 supplierNo 恰好返回一项，不得遗漏或重复。输出 JSON：summary 和 candidates；每项包含 supplierNo、recommendation、riskSummary。不要输出思考过程。",
    JSON.stringify(input),
    candidateOutput,
  );
}

export function classifyAgentIntent(input: unknown) {
  return requestJson(
    [
      "你是海天企业采购寻源 Agent 的意图路由器。",
      "只输出 JSON，包含 intent 和 answer。",
      "intent 只能是：",
      "RUN_SOURCING：用户明确要求查询、匹配、推荐或重新执行供应商寻源；",
      "ADJUST_AND_SOURCE：用户要求修改物品、规格、数量、资质、交期、报价时长、评估策略或候选供应商数量后重新寻源；",
      "CONVERSATION：用户问候、询问 Agent 身份、模型、能力、使用方法，或进行不触发寻源的采购相关交流；",
      "OUT_OF_SCOPE：与采购寻源无关的请求。",
      "answer 是给用户的简短答复。身份或模型问题不要猜测具体模型名称，只说明系统将使用可信运行元数据补充。",
      "不得在 answer 中编造供应商、修改采购条件或声称已经执行任何尚未执行的业务动作。不要输出思考过程。",
    ].join("\n"),
    JSON.stringify(input),
    agentIntentOutput,
  );
}

export function describeEvaluation(input: unknown) {
  return requestJson(
    [
      "你是企业采购报价评估助手。数值排名已经由系统确定，不得修改排名或分数。",
      "只为每份报价选择一个最值得关注的优势代码 strengthCode：PRICE、DELIVERY、MATCH、RISK、BALANCED。",
      "再选择一个需要关注的风险代码 riskCode：PRICE、DELIVERY、MATCH、RISK、NONE。",
      "必须严格根据输入的分项得分选择代码，不得自行编写最低价、最快交付等比较性结论。",
      "输出 JSON：summary 和 items；每项只包含 quoteNo、strengthCode、riskCode。不要输出思考过程。",
    ].join("\n"),
    JSON.stringify(input),
    evaluationOutput,
  );
}
