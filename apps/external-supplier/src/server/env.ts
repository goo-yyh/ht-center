import 'server-only';
import { z } from 'zod';

const envSchema = z.object({
  CORE_API_URL: z.string().url().default('http://127.0.0.1:3000/api/demo/v1'),
  DEMO_SERVICE_TOKEN: z.string().min(1, 'DEMO_SERVICE_TOKEN 未配置'),
  DEMO_SESSION_SECRET: z.string().min(16, 'DEMO_SESSION_SECRET 至少需要 16 个字符'),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (!cachedEnv) {
    const production = process.env.NODE_ENV === 'production';
    cachedEnv = envSchema.parse({
      CORE_API_URL: process.env.CORE_API_URL,
      DEMO_SERVICE_TOKEN: process.env.DEMO_SERVICE_TOKEN ?? (production ? undefined : 'haitian-demo-service-local'),
      DEMO_SESSION_SECRET:
        process.env.DEMO_SESSION_SECRET ?? (production ? undefined : 'haitian-demo-session-secret-local-2026'),
    });
  }
  return cachedEnv;
}

export function resetServerEnvForTests(): void {
  cachedEnv = undefined;
}
