import { z } from "zod";

const localDatabaseUrl = "postgresql://127.0.0.1:5432/haitian_sourcing_demo";
const localQuoteKey = Buffer.from("haitian-demo-sealed-key-32-byte!", "utf8").toString("base64");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  QUOTE_ENCRYPTION_KEY: z.string().min(1),
  QUOTE_KEY_VERSION: z.string().min(1).default("demo-v1"),
  DEMO_SERVICE_TOKEN: z.string().min(8).default("haitian-demo-service-local"),
  DEMO_RESET_ENABLED: z.enum(["true", "false"]).transform((value) => value === "true"),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().min(1).default("deepseek-v4-flash"),
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  SOURCING_TOOL_DELAY_MS: z.coerce.number().int().min(0).max(10000).default(1200),
  EVALUATION_STEP_DELAY_MS: z.coerce.number().int().min(0).max(10000).default(1000),
});

function loadEnv() {
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
    throw new Error("生产环境必须显式配置 DATABASE_URL");
  }
  if (process.env.NODE_ENV === "production" && !process.env.QUOTE_ENCRYPTION_KEY) {
    throw new Error("生产环境必须显式配置 QUOTE_ENCRYPTION_KEY");
  }
  if (process.env.NODE_ENV === "production" && !process.env.DEMO_SERVICE_TOKEN) {
    throw new Error("生产环境必须显式配置 DEMO_SERVICE_TOKEN");
  }

  const parsed = schema.parse({
    DATABASE_URL: process.env.DATABASE_URL ?? localDatabaseUrl,
    QUOTE_ENCRYPTION_KEY: process.env.QUOTE_ENCRYPTION_KEY ?? localQuoteKey,
    QUOTE_KEY_VERSION: process.env.QUOTE_KEY_VERSION,
    DEMO_SERVICE_TOKEN: process.env.DEMO_SERVICE_TOKEN,
    DEMO_RESET_ENABLED: process.env.DEMO_RESET_ENABLED ?? (process.env.NODE_ENV === "production" ? "false" : "true"),
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_TIMEOUT_MS: process.env.DEEPSEEK_TIMEOUT_MS,
    SOURCING_TOOL_DELAY_MS: process.env.SOURCING_TOOL_DELAY_MS ?? (process.env.NODE_ENV === "test" ? "0" : undefined),
    EVALUATION_STEP_DELAY_MS: process.env.EVALUATION_STEP_DELAY_MS ?? (process.env.NODE_ENV === "test" ? "0" : undefined),
  });

  const key = Buffer.from(parsed.QUOTE_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("QUOTE_ENCRYPTION_KEY 必须是 32 字节密钥的 Base64 编码");
  }

  return { ...parsed, quoteKey: key };
}

export const env = loadEnv();
export const WORKSPACE_CODE = "DEMO-DEFAULT";
export const SEED_VERSION = "0002-simple-v2";
export const ACTIVE_DEMO_RFQ_DEADLINE = "2026-09-15T15:59:00.000Z";
