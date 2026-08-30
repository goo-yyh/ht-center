import { initializeDemo } from "../src/server/fixtures";
import { pool } from "../src/server/db";

try {
  console.log(JSON.stringify(await initializeDemo(), null, 2));
} finally {
  await pool.end();
}
