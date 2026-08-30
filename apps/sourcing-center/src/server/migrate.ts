import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db";

export async function migrate() {
  const directory = path.join(process.cwd(), "migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(path.join(directory, file), "utf8");
    await pool.query(sql);
  }
}
