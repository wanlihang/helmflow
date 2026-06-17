/**
 * Upgrade — 检查上游新版(git fetch)+ 执行升级(git checkout/pull)。
 *
 * 直接读源架构下,升级 helmcode = 在 helmcode 仓库 git 操作。本模块:
 *   - checkUpdateRemote:git fetch + 对比本地 HEAD vs origin/<branch>,返回 ahead/behind/最新 commit。
 *   - upgradeTo:git checkout <ref> + (可选) git pull。HelmFlow 代执行。
 *
 * 安全:dryRun 在调用方做(调 diffStandards 预览);本模块只负责执行 git。
 * 回滚:调用方记 migration(旧 gitHead),rollback = upgradeTo(旧 head)。
 */

import { execSync } from "node:child_process";

function git(args: string[], cwd: string): string {
  return execSync(`git ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export interface RemoteUpdateInfo {
  /** 当前本地 HEAD */
  localHead: string;
  /** 当前分支 */
  branch: string;
  /** 远程跟踪分支是否存在 */
  hasRemote: boolean;
  /** 远程 origin/<branch> 的最新 commit(无 remote 时 null) */
  remoteHead: string | null;
  /** 本地落后远程的提交数(>0 表示有新版可拉) */
  behind: number;
  /** 本地领先远程的提交数 */
  ahead: number;
  /** 是否有升级可用 */
  hasUpdate: boolean;
  /** 错误信息(fetch 失败等,不抛) */
  error?: string;
}

/**
 * 检查上游新版:git fetch origin + 对比本地 HEAD vs origin/<branch>。
 * 只读对比(不 checkout/不 pull)。fetch 是网络操作但不改工作区。
 */
export function checkUpdateRemote(helmcodeRoot: string, branch = "main"): RemoteUpdateInfo {
  const localHead = safeGit(["rev-parse", "HEAD"], helmcodeRoot);
  if (!localHead) {
    return { localHead: "", branch, hasRemote: false, remoteHead: null, behind: 0, ahead: 0, hasUpdate: false, error: "git rev-parse HEAD 失败(非 git 仓库?)" };
  }

  // git fetch origin(网络;失败降级)
  try {
    git(["fetch", "origin", "--quiet"], helmcodeRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { localHead, branch, hasRemote: false, remoteHead: null, behind: 0, ahead: 0, hasUpdate: false, error: `git fetch 失败(可能无网/无权限): ${msg.split("\n")[0]}` };
  }

  // 远程 HEAD
  const remoteHead = safeGit(["rev-parse", `origin/${branch}`], helmcodeRoot);
  if (!remoteHead) {
    return { localHead, branch, hasRemote: true, remoteHead: null, behind: 0, ahead: 0, hasUpdate: false, error: `origin/${branch} 不存在` };
  }

  // ahead/behind
  const counts = safeGit(["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`], helmcodeRoot);
  let ahead = 0;
  let behind = 0;
  if (counts) {
    const [a, b] = counts.split(/\s+/);
    ahead = Number.parseInt(a ?? "0", 10) || 0;
    behind = Number.parseInt(b ?? "0", 10) || 0;
  }

  return {
    localHead,
    branch,
    hasRemote: true,
    remoteHead,
    behind,
    ahead,
    hasUpdate: behind > 0,
  };
}

export interface UpgradeResult {
  /** 升级前的 HEAD */
  fromHead: string;
  /** 升级后的 HEAD */
  toHead: string;
  /** 实际执行的 git 命令摘要 */
  action: string;
  error?: string;
}

/**
 * 执行升级:git checkout <ref> 到 helmcode 仓库。
 * @param ref git ref(branch/tag/commit),如 "main" / "v3.2.0" / origin/main。默认 "main" + pull。
 * @param pull checkout 后是否 git pull(仅 ref 是当前分支时)
 */
export function upgradeTo(helmcodeRoot: string, ref = "main", pull = true): UpgradeResult {
  const fromHead = safeGit(["rev-parse", "HEAD"], helmcodeRoot);
  if (!fromHead) {
    return { fromHead: "", toHead: "", action: "", error: "非 git 仓库" };
  }

  try {
    git(["checkout", ref], helmcodeRoot);
    let action = `git checkout ${ref}`;
    if (pull) {
      try {
        git(["pull", "--ff-only", "--quiet"], helmcodeRoot);
        action += " && git pull --ff-only";
      } catch {
        // pull 失败(无 upstream/冲突)不阻塞,checkout 已生效
      }
    }
    const toHead = safeGit(["rev-parse", "HEAD"], helmcodeRoot) ?? fromHead;
    return { fromHead, toHead, action };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { fromHead, toHead: fromHead, action: `git checkout ${ref}`, error: msg.split("\n")[0] };
  }
}

function safeGit(args: string[], cwd: string): string {
  try {
    return git(args, cwd);
  } catch {
    return "";
  }
}
