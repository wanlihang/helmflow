import { syncActiveLLMToEnv } from "@/lib/llm-config";
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
  if (cached) {
    // 每次请求都同步 active provider 到 env:/llm 页切换 provider 后实时生效;
    // 且 claude-agent-sdk native binary 子进程读无前缀 ANTHROPIC_*,syncActiveLLMToEnv
    // 每次覆盖 .env.local 残留(否则用旧端点+model)。开销可忽略。
    syncActiveLLMToEnv(cached);
    return cached;
  }
  cached = createDb(DB_PATH);
  cleanupStaleRuns(cached, STALE_THRESHOLD_MS);
  syncActiveLLMToEnv(cached);
  return cached;
}

export function resetDbCache(): void {
  cached = null;
}
