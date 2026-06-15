import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const WORKTREES_DIR_NAME = "worktrees";
const MAX_WORKTREES = 10;

export interface WorktreeInfo {
  path: string;
  branchName: string;
}

function worktreesRoot(sandboxPath: string): string {
  return join(dirname(resolve(sandboxPath)), WORKTREES_DIR_NAME);
}

export function createWorktree(args: {
  sandboxPath: string;
  branchName: string;
}): WorktreeInfo {
  const { sandboxPath, branchName } = args;
  const root = worktreesRoot(sandboxPath);
  const safeName = branchName.replace(/\//g, "-");
  const wtPath = join(root, safeName);

  cleanupOldWorktrees(sandboxPath);

  execFileSync("git", ["worktree", "add", "-b", branchName, wtPath], {
    cwd: sandboxPath,
    encoding: "utf-8",
  });

  return { path: wtPath, branchName };
}

export function removeWorktree(args: {
  sandboxPath: string;
  worktreePath: string;
  branchName: string;
}): void {
  const { sandboxPath, worktreePath, branchName } = args;
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: sandboxPath,
      encoding: "utf-8",
    });
  } catch {
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd: sandboxPath,
        encoding: "utf-8",
      });
    } catch {
      // ignore
    }
  }
  try {
    execFileSync("git", ["branch", "-D", branchName], {
      cwd: sandboxPath,
      encoding: "utf-8",
    });
  } catch {
    // branch may already be gone
  }
}

export function mergeWorktreeIntoMain(args: {
  worktreePath: string;
  sandboxPath: string;
  branchName: string;
}): void {
  const { sandboxPath, branchName } = args;
  try {
    execFileSync("git", ["merge", "--ff-only", branchName], {
      cwd: sandboxPath,
      encoding: "utf-8",
    });
  } catch {
    execFileSync("git", ["merge", "--no-edit", branchName], {
      cwd: sandboxPath,
      encoding: "utf-8",
    });
  }
}

export function listWorktrees(sandboxPath: string): string[] {
  try {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: sandboxPath,
      encoding: "utf-8",
    });
    const absMainPath = resolve(sandboxPath);
    return output
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice(9))
      .filter((p) => resolve(p) !== absMainPath);
  } catch {
    return [];
  }
}

function cleanupOldWorktrees(sandboxPath: string): void {
  const wts = listWorktrees(sandboxPath);
  if (wts.length < MAX_WORKTREES) return;

  for (let i = 0; i < wts.length - MAX_WORKTREES + 1; i++) {
    const wtPath = wts[i]!;
    try {
      execFileSync("git", ["worktree", "remove", "--force", wtPath], {
        cwd: sandboxPath,
        encoding: "utf-8",
      });
    } catch {
      // best effort
    }
  }
  try {
    execFileSync("git", ["worktree", "prune"], {
      cwd: sandboxPath,
      encoding: "utf-8",
    });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Concurrency semaphore
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 3;

interface QueueEntry {
  resolve: () => void;
}

let activeCount = 0;
const queue: QueueEntry[] = [];

export function getActiveRunCount(): number {
  return activeCount;
}

export function getQueuedCount(): number {
  return queue.length;
}

export async function acquireSemaphore(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return;
  }
  return new Promise<void>((resolve) => {
    queue.push({ resolve });
  });
}

export function releaseSemaphore(): void {
  const next = queue.shift();
  if (next) {
    // activeCount stays the same: the released slot is immediately taken by the queued waiter
    next.resolve();
  } else {
    activeCount = Math.max(0, activeCount - 1);
  }
}

// ---------------------------------------------------------------------------
// Active runs registry
// ---------------------------------------------------------------------------

export interface ActiveRun {
  superRunId: string;
  featureId: string;
  contractId: string;
  currentNode: string;
  startedAt: string;
  worktreePath: string | null;
  status: "running" | "queued";
}

const activeRuns = new Map<string, ActiveRun>();

export function registerActiveRun(run: ActiveRun): void {
  activeRuns.set(run.superRunId, run);
}

export function updateActiveRunNode(superRunId: string, node: string): void {
  const run = activeRuns.get(superRunId);
  if (run) run.currentNode = node;
}

export function updateActiveRunStatus(
  superRunId: string,
  status: "running" | "queued",
): void {
  const run = activeRuns.get(superRunId);
  if (run) run.status = status;
}

export function removeActiveRun(superRunId: string): void {
  activeRuns.delete(superRunId);
}

export function getActiveRuns(): ActiveRun[] {
  return Array.from(activeRuns.values());
}
