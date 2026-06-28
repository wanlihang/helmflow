// projectId → sandboxPath 安全校验。前端只传 projectId,后端查 DB/manifest 解析,
// 绝不直接信任前端字符串,防路径穿越 / 任意 cwd 执行。
// 复刻 apps/portal/lib/server-utils.ts 的 resolveSandboxPathForProject。

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { getProject } from "@helmflow/manifest-loader";
import { getProjectById, type DB } from "@helmflow/storage";
import type { TerminalConfig } from "./config";

const PROJECT_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function resolveSandboxForProjectId(
  db: DB,
  cfg: TerminalConfig,
  projectId: string,
): string {
  if (!projectId || !PROJECT_ID_RE.test(projectId)) {
    throw new Error(`invalid projectId: ${projectId}`);
  }

  // 1. DB projects.sandboxPath
  try {
    const project = getProjectById(db, projectId);
    if (project?.sandboxPath) {
      const sp = project.sandboxPath;
      const abs = isAbsolute(sp) ? sp : resolve(cfg.monorepoRoot, sp);
      if (existsSync(abs)) return abs;
    }
  } catch {
    // DB 读失败 → 回落 manifest
  }

  // 2. manifest sandboxPath
  const manifestProject = getProject(projectId);
  if (manifestProject?.manifest?.sandboxPath) {
    const sp = manifestProject.manifest.sandboxPath;
    const abs = isAbsolute(sp) ? sp : resolve(cfg.monorepoRoot, sp);
    if (existsSync(abs)) return abs;
  }

  throw new Error(
    `Project "${projectId}" has no valid sandboxPath (DB or manifest).`,
  );
}
