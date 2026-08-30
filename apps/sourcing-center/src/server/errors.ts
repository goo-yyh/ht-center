import { ZodError } from "zod";

export type ErrorCode =
  | "INVALID_INPUT" | "NOT_FOUND" | "ILLEGAL_STATE_TRANSITION" | "STALE_VERSION"
  | "SUPPLIER_NOT_INVITED" | "REGISTRATION_REQUIRED" | "SUPPLIER_NOT_REGISTRABLE"
  | "SUPPLIER_ALREADY_REGISTERED" | "RFQ_CLOSED" | "QUOTE_ALREADY_SUBMITTED"
  | "SEALED_CONTENT_FORBIDDEN" | "NO_VALID_QUOTES" | "AGENT_SERVICE_UNAVAILABLE"
  | "AGENT_OUTPUT_INVALID" | "IDEMPOTENCY_KEY_REUSED" | "UNAUTHORIZED" | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) return new ApiError("INVALID_INPUT", "提交的数据不符合要求", 400, error.issues);
  if (error && typeof error === "object" && "code" in error) {
    const pgCode = String((error as { code: unknown }).code);
    if (pgCode === "23505") return new ApiError("ILLEGAL_STATE_TRANSITION", "该操作已经完成或数据重复", 409);
    if (pgCode === "23503" || pgCode === "23514") return new ApiError("INVALID_INPUT", "数据违反业务约束", 400);
  }
  console.error("[sourcing-api]", error instanceof Error ? error.message : error);
  return new ApiError("INTERNAL_ERROR", "服务暂时不可用，请稍后重试", 500);
}
