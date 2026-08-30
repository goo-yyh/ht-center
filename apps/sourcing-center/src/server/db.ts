import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env, WORKSPACE_CODE } from "./env";

declare global {
  var __haitianDemoPool: Pool | undefined;
}

export const pool = globalThis.__haitianDemoPool ?? new Pool({ connectionString: env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") globalThis.__haitianDemoPool = pool;

export const WORKSPACE_LIFECYCLE_LOCK_NAMESPACE = "haitian-demo-fixtures";

export async function lockWorkspaceLifecycleForTransaction(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [WORKSPACE_LIFECYCLE_LOCK_NAMESPACE, WORKSPACE_CODE]);
}

export async function acquireWorkspaceLifecycleLock(client: PoolClient, mode: "shared" | "exclusive") {
  const sql = mode === "shared"
    ? "SELECT pg_advisory_lock_shared(hashtext($1),hashtext($2))"
    : "SELECT pg_advisory_lock(hashtext($1),hashtext($2))";
  await client.query(sql, [WORKSPACE_LIFECYCLE_LOCK_NAMESPACE, WORKSPACE_CODE]);
}

export async function releaseWorkspaceLifecycleLock(client: PoolClient, mode: "shared" | "exclusive") {
  const sql = mode === "shared"
    ? "SELECT pg_advisory_unlock_shared(hashtext($1),hashtext($2))"
    : "SELECT pg_advisory_unlock(hashtext($1),hashtext($2))";
  await client.query(sql, [WORKSPACE_LIFECYCLE_LOCK_NAMESPACE, WORKSPACE_CODE]);
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function one<T extends QueryResultRow>(client: PoolClient | Pool, sql: string, values: unknown[] = []): Promise<T> {
  const result = await client.query<T>(sql, values);
  if (result.rowCount !== 1) throw new Error(`Expected one row, received ${result.rowCount ?? 0}`);
  return result.rows[0];
}

export async function maybeOne<T extends QueryResultRow>(client: PoolClient | Pool, sql: string, values: unknown[] = []): Promise<T | null> {
  const result = await client.query<T>(sql, values);
  if ((result.rowCount ?? 0) > 1) throw new Error(`Expected zero or one row, received ${result.rowCount}`);
  return result.rows[0] ?? null;
}

export async function workspace(client: PoolClient | Pool, lock = false) {
  return one<{ id: string; revision: string }>(
    client,
    `SELECT id, revision::text FROM demo_workspaces WHERE code=$1${lock ? " FOR UPDATE" : ""}`,
    [WORKSPACE_CODE],
  );
}

export async function maybeWorkspace(client: PoolClient | Pool, lock = false) {
  return maybeOne<{ id: string; revision: string }>(
    client,
    `SELECT id, revision::text FROM demo_workspaces WHERE code=$1${lock ? " FOR UPDATE" : ""}`,
    [WORKSPACE_CODE],
  );
}

export async function bumpRevision(client: PoolClient, workspaceId: string) {
  const row = await one<{ revision: string }>(
    client,
    "UPDATE demo_workspaces SET revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 RETURNING revision::text",
    [workspaceId],
  );
  return Number(row.revision);
}
