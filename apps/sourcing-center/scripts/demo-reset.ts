import { resetDemo } from "../src/server/fixtures";
import { pool } from "../src/server/db";

if (!process.argv.includes("--confirm")) {
  console.error("重置会清除现场操作数据。请使用 npm run demo:reset -- --confirm");
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(await resetDemo(), null, 2));
  } finally {
    await pool.end();
  }
}
