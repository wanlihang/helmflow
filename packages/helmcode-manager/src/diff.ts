/**
 * Diff — 对比 helmcode 仓库两个 git ref 的 standards/{preset} 改了哪些文件。
 * 只读 git(用 git diff --name-status,不 checkout),零破坏。
 */

import { execSync } from "node:child_process";

export interface DiffResult {
  changed: string[]; // 修改(相对 standards/{preset} 路径)
  added: string[];
  removed: string[];
  all: string[]; // changed+added+removed 去重
  /** git 失败时的错误信息(不抛,降级返回空 diff) */
  error?: string;
}

/**
 * 用 git diff --name-status <from> <to> -- standards/<preset> 列出文件变更。
 * @param helmcodeRoot helmcode 仓库根
 * @param preset 标准 preset
 * @param fromGitHead 起 ref(commit/tag/branch)
 * @param toGitHead 止 ref;缺省用工作区(HEAD vs working tree)
 */
export function diffStandards(
  helmcodeRoot: string,
  preset: string,
  fromGitHead: string,
  toGitHead?: string,
): DiffResult {
  const scope = `standards/${preset}`;
  const result: DiffResult = { changed: [], added: [], removed: [], all: [] };

  // git diff --name-status <from> <to> -- <scope>
  // toGitHead 缺省:对比 from vs 工作区(unstaged+staged)
  const refs = toGitHead ? `${fromGitHead} ${toGitHead}` : `${fromGitHead}`;
  const cmd = `git diff --name-status ${refs} -- ${scope}`;

  let out: string;
  try {
    out = execSync(cmd, {
      cwd: helmcodeRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...result, error: `git diff 失败: ${msg.split("\n")[0]}` };
  }

  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 格式: M\tpath / A\tpath / D\tpath / R100\told\tnew
    const parts = trimmed.split("\t");
    const status = parts[0] ?? "";
    const file = (parts[1] ?? parts[2] ?? "").replace(/^standards\/[^/]+\//, "");
    if (!file) continue;
    if (status.startsWith("A")) result.added.push(file);
    else if (status.startsWith("D")) result.removed.push(file);
    else result.changed.push(file); // M / R / C 等都算 changed
  }

  result.all = Array.from(new Set([...result.changed, ...result.added, ...result.removed]));
  return result;
}

// 对比两 git head 的便捷封装已移除 — 消费方直接用 diffStandards(helmcodeRoot, preset, fromHead, toHead)。

