// HelmFlow 常驻 worker —— 把"一键跑"升级为"自己排队跑"。
//
// 职责:
// 1. 启动崩溃恢复(recovery)
// 2. 周期 enqueue loop:approved 契约 → pipeline_queue
// 3. 周期 dispatch loop:认领 pending → runOrchestrator(并发槽限流)
// 4. 日预算治理:超限暂停取新任务
//
// 与 portal 共享同一 SQLite;事件已落 run_events,portal 通过 DB 重放观测。

import { loadWorkerConfig } from "./env";
import { scanAndEnqueue } from "./enqueue";
import { createDispatcher, pump } from "./dispatch";
import { recoverFromCrash } from "./recovery";
import {
  createBudgetGuard,
  refreshSpent,
  isBudgetExceeded,
} from "./budget";

async function main(): Promise<void> {
  const cfg = loadWorkerConfig();
  console.log(
    `[worker] starting id=${cfg.workerId} concurrency=${cfg.concurrency} poll=${cfg.pollMs}ms project=${cfg.projectId}`,
  );
  console.log(`[worker] db=${cfg.dbPath}`);
  console.log(`[worker] sandbox=${cfg.sandboxPath}`);
  if (cfg.helmcodeRoot) console.log(`[worker] helmcodeRoot=${cfg.helmcodeRoot}`);
  if (cfg.dailyBudgetUsd !== undefined) {
    console.log(`[worker] daily budget=$${cfg.dailyBudgetUsd}`);
  }

  // 1) 启动崩溃恢复
  const report = recoverFromCrash(cfg.db, cfg.sandboxPath);
  if (report.requeued || report.blocked || report.orphanRuns) {
    console.log(
      `[worker] recovery: requeued=${report.requeued} blocked=${report.blocked} orphanRuns=${report.orphanRuns} worktreesPruned=${report.worktreesPruned}`,
    );
  }

  // 2) 预算 + 调度器
  const budget = createBudgetGuard(cfg.dailyBudgetUsd);
  refreshSpent(cfg.db, budget);
  const disp = createDispatcher(cfg);

  let stopping = false;

  const tick = (): void => {
    if (stopping) return;
    try {
      const enqueued = scanAndEnqueue(cfg.db, cfg.maxReattempts);
      if (enqueued > 0) console.log(`[worker] enqueued ${enqueued} new item(s)`);

      refreshSpent(cfg.db, budget);
      if (isBudgetExceeded(budget)) {
        console.log(
          `[worker] budget exceeded ($${budget.spentUsd.toFixed(4)} >= $${cfg.dailyBudgetUsd}), pausing dispatch`,
        );
        return;
      }

      const started = pump(cfg.db, cfg, disp, () => isBudgetExceeded(budget));
      if (started > 0) {
        console.log(
          `[worker] started ${started} task(s), active=${disp.activeSlots}/${disp.maxSlots}`,
        );
      }
    } catch (err) {
      console.error("[worker] tick error:", err instanceof Error ? err.message : err);
    }
  };

  // 立即跑一次,再周期跑
  tick();
  const timer: ReturnType<typeof setInterval> = setInterval(tick, cfg.pollMs);

  // 优雅退出:停止取新任务,给在跑的任务收尾时间
  const shutdown = (sig: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] received ${sig}, draining (active=${disp.activeSlots})...`);
    clearInterval(timer);
    setTimeout(() => {
      console.log("[worker] exited");
      process.exit(0);
    }, 5000);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
