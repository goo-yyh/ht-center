import { migrate } from "../src/server/migrate";
import { pool } from "../src/server/db";

try {
  await migrate();
  console.log("数据库迁移完成");
} finally {
  await pool.end();
}
