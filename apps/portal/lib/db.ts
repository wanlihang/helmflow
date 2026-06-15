import { join } from "node:path";
import { createDb, cleanupStaleRuns, type DB } from "@helmflow/storage";

export type { DB };

const DB_PATH = join(process.cwd(), "data", "helmflow.db");

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
