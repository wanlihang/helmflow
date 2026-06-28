// worker 运行环境装配:
// - 从 monorepo 根定位 portal/.env.local(加载 HELMFLOW_ANTHROPIC_* 等,shell env 优先)
// - 全部用绝对路径解析 DB / sandbox / portal / helmcode,绝不依赖 process.cwd()
//   (portal 的 getDb 写死 cwd,worker 复用会指向错误位置)
// - 与 portal 共享同一个 SQLite 文件(默认 <monorepo>/data/helmflow.db,
//   可用 HELMFLOW_DB_PATH 覆盖;portal 侧 lib/db.ts 也读该 env 以保持一致)

import { createDb, type DB } from "@helmflow/storage";
import { getDefaultProjectId, getProject } from "@helmflow/manifest-loader";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";

export interface WorkerConfig {
  db: DB;
  dbPath: string;
  projectId: string;
  sandboxPath: string;
  portalCwd: string;
  helmcodeRoot?: string;
  workerId: string;
  concurrency: number;
  pollMs: number;
  dailyBudgetUsd?: number;
  maxReattempts: number;
}

function findMonorepoRoot(): string {
  const env = process.env.HELMFLOW_MONOREPO_ROOT;
  if (env && env.length > 0) return resolve(env);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("worker: cannot locate monorepo root (pnpm-workspace.yaml not found)");
}

/** 极简 .env 加载器(零依赖):KEY=VALUE,支持引号与 # 注释。不覆盖已存在的 shell env。 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key.length > 0 && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function loadWorkerConfig(): WorkerConfig {
  const monorepo = findMonorepoRoot();
  loadEnvFile(join(monorepo, "apps", "portal", ".env.local"));

  // 默认指向 portal 的库(apps/portal/data/helmflow.db),零配置与 portal 共享同一 SQLite;
  // 可用 HELMFLOW_DB_PATH(绝对路径)覆盖。
  const dbPath = process.env.HELMFLOW_DB_PATH
    ? resolve(process.env.HELMFLOW_DB_PATH)
    : join(monorepo, "apps", "portal", "data", "helmflow.db");
  const db = createDb(dbPath);

  const projectId = process.env.HELMFLOW_PROJECT_ID || getDefaultProjectId();
  const project = getProject(projectId);
  if (!project) {
    throw new Error(
      `worker: project "${projectId}" not found (check projects/<id>/helmcode.yaml)`,
    );
  }
  const sandboxPath = isAbsolute(project.manifest.sandboxPath)
    ? project.manifest.sandboxPath
    : resolve(monorepo, project.manifest.sandboxPath);
  if (!existsSync(sandboxPath)) {
    throw new Error(`worker: sandboxPath not found: ${sandboxPath}`);
  }

  const portalCwd = process.env.HELMFLOW_PORTAL_ROOT
    ? resolve(process.env.HELMFLOW_PORTAL_ROOT)
    : join(monorepo, "apps", "portal");

  const dailyBudgetRaw = process.env.HELMFLOW_DAILY_BUDGET_USD;
  const dailyBudgetUsd =
    dailyBudgetRaw && dailyBudgetRaw.length > 0 ? Number(dailyBudgetRaw) : undefined;

  // turn 不限制:agent 单 session 跑到自然完成(stop),不切碎、不节流。
  // node-runner 已传 maxTurnsPerSession=最大值;此处不再默认强制小 session。
  // 如需降密集避 RPM,可显式设 HELMFLOW_TURNS_PER_SESSION / HELMFLOW_TURN_INTERVAL_MS。

  return {
    db,
    dbPath,
    projectId,
    sandboxPath,
    portalCwd,
    helmcodeRoot: project.helmcodeRoot,
    workerId: `${process.pid}@${hostname()}`,
    // 默认并发 1:claude-agent-sdk 密集调用易撞端点 RPM/TPM,串行更稳(可按配额调高)
    concurrency: intEnv("HELMFLOW_WORKER_CONCURRENCY", 1),
    pollMs: intEnv("HELMFLOW_WORKER_POLL_MS", 10000),
    dailyBudgetUsd: dailyBudgetUsd !== undefined && Number.isFinite(dailyBudgetUsd)
      ? dailyBudgetUsd
      : undefined,
    maxReattempts: intEnv("HELMFLOW_MAX_REATTEMPTS", 3),
  };
}
