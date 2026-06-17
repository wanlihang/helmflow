// 启动崩溃恢复:处理上次进程中断残留的 running 队列项与孤儿 full-loop run。
// attempt 计的是进程崩溃导致的重跑(非业务重试),达 maxAttempts 转 blocked。

import { execFileSync } from "node:child_process";
import {
  type DB,
  listRunningQueue,
  requeueAfterCrash,
  markQueueTerminal,
  listRunningRuns,
  updateRun,
} from "@helmflow/storage";

export interface RecoveryReport {
  requeued: number;
  blocked: number;
  orphanRuns: number;
  worktreesPruned: number;
}

export function recoverFromCrash(db: DB, sandboxPath: string): RecoveryReport {
  const report: RecoveryReport = {
    requeued: 0,
    blocked: 0,
    orphanRuns: 0,
    worktreesPruned: 0,
  };

  // 1) 队列中残留的 running 项 → attempt++ → requeue 或 blocked
  for (const item of listRunningQueue(db)) {
    const attempt = requeueAfterCrash(db, item.id);
    if (attempt < item.maxAttempts) {
      report.requeued++;
      console.log(
        `[recovery] re-queued ${item.id} (attempt ${attempt}/${item.maxAttempts})`,
      );
    } else {
      markQueueTerminal(
        db,
        item.id,
        "blocked",
        `crashed, max attempts (${item.maxAttempts}) reached`,
      );
      report.blocked++;
      console.log(`[recovery] blocked ${item.id} (max attempts reached)`);
    }
  }

  // 2) 孤儿 full-loop run(state=running)→ 标 failed(数据卫生)。
  //    不动 cell agentStatus:被 requeue 的项会在 dispatch claim 时重设。
  const orphanRuns = listRunningRuns(db, 1000).filter((r) => r.kind === "full-loop");
  for (const r of orphanRuns) {
    updateRun(db, r.id, "failed");
    report.orphanRuns++;
  }

  // 3) 清理残留 worktree(best-effort)
  try {
    execFileSync("git", ["worktree", "prune"], {
      cwd: sandboxPath,
      encoding: "utf-8",
      stdio: "ignore",
    });
    report.worktreesPruned++;
  } catch {
    // best-effort:非 git 仓库或无残留时忽略
  }

  return report;
}
