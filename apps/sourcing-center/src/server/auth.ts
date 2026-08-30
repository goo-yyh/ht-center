import type { NextRequest } from "next/server";
import { ApiError } from "./errors";
import { env } from "./env";

export function requireServiceToken(request: NextRequest) {
  if (request.headers.get("x-demo-service-token") !== env.DEMO_SERVICE_TOKEN) {
    throw new ApiError("UNAUTHORIZED", "供应商服务凭证无效", 401);
  }
}

export function supplierNumber(request: NextRequest, expectedType?: "INTERNAL" | "EXTERNAL") {
  requireServiceToken(request);
  const supplierNo = request.headers.get("x-demo-supplier-no");
  if (!supplierNo) throw new ApiError("UNAUTHORIZED", "缺少供应商身份", 401);
  if (expectedType && !supplierNo.startsWith(expectedType === "INTERNAL" ? "INT-" : "EXT-")) {
    throw new ApiError("UNAUTHORIZED", "供应商身份类型不匹配", 403);
  }
  return supplierNo;
}
