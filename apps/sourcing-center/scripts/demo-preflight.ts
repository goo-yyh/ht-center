import { initializeDemo } from "../src/server/fixtures";
import { pool } from "../src/server/db";
import { preflight } from "../src/server/services";

try {
  await initializeDemo();
  const result = await preflight();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 1;
} finally {
  await pool.end();
}
