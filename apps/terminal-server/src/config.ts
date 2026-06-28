// terminal-server 配置:端口 / idle 超时 / claude 二进制 / monorepo root / db 路径。
// 复刻 apps/worker/src/env.ts 的 findMonorepoRoot(只取配置,不跑调度)。

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface TerminalConfig {
  port: number;
  idleTimeoutMs: number;
  claudeBin: string;
  monorepoRoot: string;
  dbPath: string;
}

export function findMonorepoRoot(): string {
  const env = process.env.HELMFLOW_MONOREPO_ROOT;
  if (env && env.length > 0) return resolve(env);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "terminal-server: cannot locate monorepo root (pnpm-workspace.yaml not found)",
  );
}

/** 解析 claude 二进制:CLAUDE_BIN 显式指定 → which claude → 报错。 */
function findClaudeBin(): string {
  const custom = process.env.CLAUDE_BIN;
  if (custom && custom.length > 0) return custom;
  try {
    const p = execSync("which claude", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (p.length > 0) return p;
  } catch {
    // fallthrough
  }
  throw new Error(
    "terminal-server: claude binary not found. Install Claude Code or set CLAUDE_BIN.",
  );
}

export function loadConfig(): TerminalConfig {
  const monorepoRoot = findMonorepoRoot();
  const dbPath = process.env.HELMFLOW_DB_PATH
    ? resolve(process.env.HELMFLOW_DB_PATH)
    : join(monorepoRoot, "apps", "portal", "data", "helmflow.db");
  return {
    port: Number(process.env.HELMFLOW_TERMINAL_PORT) || 3001,
    idleTimeoutMs:
      Number(process.env.HELMFLOW_TERMINAL_IDLE_TIMEOUT_MS) || 30 * 60_000,
    claudeBin: findClaudeBin(),
    monorepoRoot,
    dbPath,
  };
}
