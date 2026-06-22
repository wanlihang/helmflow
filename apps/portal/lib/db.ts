import { isAbsolute, join, resolve } from "node:path";
import { type DB, cleanupStaleRuns, createDb } from "@helmflow/storage";

export type { DB };

// 优先 HELMFLOW_DB_PATH(可与 worker 共享同一 SQLite);否则回退 portal 工作目录默认库(向后兼容)。
const DB_PATH = process.env.HELMFLOW_DB_PATH
  ? isAbsolute(process.env.HELMFLOW_DB_PATH)
    ? process.env.HELMFLOW_DB_PATH
    : resolve(process.cwd(), process.env.HELMFLOW_DB_PATH)
  : join(process.cwd(), "data", "helmflow.db");

let cached: DB | null = null;

const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export function getDb(): DB {
  if (cached) return cached;
  cached = createDb(DB_PATH);
  cleanupStaleRuns(cached, STALE_THRESHOLD_MS);
  return cached;
}

export function resetDbCache(): void {
  cached = null;
}
