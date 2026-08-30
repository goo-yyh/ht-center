import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sourceCandidatesWithTools,
  type SourcingToolCall,
  type SourcingToolExecutionResult,
} from "../../src/server/deepseek";
import { env } from "../../src/server/env";

type CompletionRequest = {
  thinking: { type: string };
  messages: Array<{
    role: string;
    tool_calls?: Array<{ function: { name: string } }>;
    tool_call_id?: string;
  }>;
  tools: Array<{ function: { name: string } }>;
  tool_choice: { function: { name: string } };
  response_format?: unknown;
};

const originalApiKey = env.DEEPSEEK_API_KEY;

afterEach(() => {
  env.DEEPSEEK_API_KEY = originalApiKey;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DeepSeek 寻源工具协议", () => {
  it("拒绝臆造工具并重试，随后按 assistant/tool 协议完成全部步骤", async () => {
    env.DEEPSEEK_API_KEY = "test-deepseek-key";
    const requests: CompletionRequest[] = [];
    const expectedChoices = [
      "query_internal_suppliers",
      "query_internal_suppliers",
      "query_1688_suppliers",
      "query_qichacha_suppliers",
      "query_industry_platform_suppliers",
      "check_supplier_qualifications",
      "check_supplier_delivery",
      "submit_candidate_recommendations",
    ];
    const supplierNos = ["INT-001", "EXT-1688", "EXT-QCC", "EXT-INDUSTRY"];

    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as CompletionRequest;
      requests.push(body);
      const requestIndex = requests.length - 1;
      const requiredName = body.tool_choice.function.name;
      const actualName = requestIndex === 0 ? "query_global_suppliers" : requiredName;
      let args: Record<string, unknown>;
      if (actualName.startsWith("query_")) {
        args = { itemCode: "ITEM-001" };
      } else if (actualName === "check_supplier_qualifications") {
        args = { supplierNos, qualificationCodes: ["ISO9001"] };
      } else if (actualName === "check_supplier_delivery") {
        args = { supplierNos, requiredDeliveryDays: 15 };
      } else {
        args = {
          summary: "已通过工具完成寻源。",
          candidates: supplierNos.map((supplierNo) => ({
            supplierNo,
            recommendation: "供货能力与采购条件匹配",
            riskSummary: "风险较低",
          })),
        };
      }
      return new Response(JSON.stringify({
        id: `provider-${requestIndex + 1}`,
        model: "deepseek-v4-flash",
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: `call-${requestIndex + 1}`,
              type: "function",
              function: { name: actualName, arguments: JSON.stringify(args) },
            }],
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const suppliers = new Map<string, SourcingToolExecutionResult["suppliers"][number]>();
    const executedCalls: SourcingToolCall[] = [];
    const sourceSupplierNos: Record<string, string> = {
      query_internal_suppliers: supplierNos[0],
      query_1688_suppliers: supplierNos[1],
      query_qichacha_suppliers: supplierNos[2],
      query_industry_platform_suppliers: supplierNos[3],
    };
    const result = await sourceCandidatesWithTools(
      { request: { itemCode: "ITEM-001", qualificationCodes: ["ISO9001"], requiredDeliveryDays: 15 } },
      {
        executeTool: async (call) => {
          executedCalls.push(call);
          if (call.name.startsWith("query_")) {
            const supplierNo = sourceSupplierNos[call.name];
            const supplier = {
              supplierNo,
              supplierType: call.name === "query_internal_suppliers" ? "INTERNAL" as const : "EXTERNAL" as const,
              name: supplierNo,
              region: "浙江",
              sourcePlatform: call.name,
              qualifications: ["ISO9001"],
              riskLevel: "LOW" as const,
              minimumDeliveryDays: 10,
              matchScore: 90,
            };
            suppliers.set(supplierNo, supplier);
            return { summary: "查询完成", suppliers: [supplier] };
          }
          if (!("supplierNos" in call.arguments)) throw new Error("核验工具缺少 supplierNos");
          return {
            summary: "核验完成",
            suppliers: call.arguments.supplierNos.map((supplierNo) => suppliers.get(supplierNo)!),
          };
        },
        finalize: async (work) => work(),
      },
    );

    expect(requests.map((request) => request.tool_choice.function.name)).toEqual(expectedChoices);
    expect(requests.every((request) => request.thinking.type === "disabled")).toBe(true);
    expect(requests.every((request) => request.tools.length === 7 && request.response_format === undefined)).toBe(true);
    expect(requests[2].messages.some((message) => message.role === "assistant" && message.tool_calls?.[0]?.function.name === "query_internal_suppliers")).toBe(true);
    expect(requests[2].messages.some((message) => message.role === "tool" && message.tool_call_id === "call-2")).toBe(true);
    expect(executedCalls.map((call) => call.name)).toEqual(expectedChoices.slice(1, -1));
    expect(result.value.candidates.map((candidate) => candidate.supplierNo)).toEqual(supplierNos);
    expect(result.providerRequestIds).toEqual(expectedChoices.map((_, index) => `provider-${index + 1}`));
  });
});
