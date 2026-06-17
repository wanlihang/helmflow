// 消费/调度:从 pipeline_queue 认领 pending 项,在并发槽内调用 runOrchestrator。
// 单进程内用 activeSlots 控并发(orchestrator 内部也有内存信号量,但跨进程不共享)。

import {
  type DB,
  claimNextPending,
  markQueueDone,
  markQueueTerminal,
  updateCellAgentStatus,
  getRunById,
  newRunId,
  type PipelineQueueRow,
} from "@helmflow/storage";
import { runOrchestrator, type OrchestratorEvent } from "@helmflow/orchestrator";
import type { WorkerConfig } from "./env";

export interface Dispatcher {
  activeSlots: number;
  maxSlots: number;
}

export function createDispatcher(cfg: WorkerConfig): Dispatcher {
  return { activeSlots: 0, maxSlots: cfg.concurrency };
}

/**
 * 认领并启动任务,直到并发槽满、预算超限或无 pending。返回本轮启动数。
 */
export function pump(
  db: DB,
  cfg: WorkerConfig,
  disp: Dispatcher,
  isBudgetExceeded: () => boolean,
): number {
  let started = 0;
  while (disp.activeSlots < disp.maxSlots) {
    if (isBudgetExceeded()) break;
    const item = claimNextPending(db, cfg.workerId);
    if (!item) break;
    disp.activeSlots++;
    started++;
    void launchTask(db, cfg, disp, item);
  }
  return started;
}

async function launchTask(
  db: DB,
  cfg: WorkerConfig,
  disp: Dispatcher,
  item: PipelineQueueRow,
): Promise<void> {
  const log = (msg: string): void => console.log(`[worker:${item.id}] ${msg}`);
  log(`claimed contract=${item.contractId} attempt=${item.attempt}/${item.maxAttempts}`);

  updateCellAgentStatus(db, item.cellId, "implementing");

  // 每次执行用新 superRunId(createRun 以此为主键,无 upsert,不可复用)
  const superRunId = newRunId();

  // orchestrator 内部已把非 node-event 事件落 run_events;此处只打简要日志。
  const emit = (event: OrchestratorEvent): void => {
    switch (event.type) {
      case "node-start":
      case "node-done":
      case "loop-iteration":
      case "escalate":
      case "error":
      case "done":
        log(`event ${event.type}`);
        break;
      default:
        break;
    }
  };

  try {
    await runOrchestrator({
      db,
      contractId: item.contractId,
      sandboxPath: cfg.sandboxPath,
      portalCwd: cfg.portalCwd,
      superRunId,
      helmcodeRoot: cfg.helmcodeRoot,
      emit,
    });
    // orchestrator 无返回值;成功与否看 superRunId 对应 run 行(done=成功,failed=blocked)
    const run = getRunById(db, superRunId);
    if (run?.state === "done") {
      markQueueDone(db, item.id);
      log("done ✓");
    } else {
      markQueueTerminal(
        db,
        item.id,
        "blocked",
        `orchestrator ended in state=${run?.state ?? "unknown"}`,
      );
      log("blocked (business failure after orchestrator self-healing)");
    }
  } catch (err) {
    // 进程级异常:不改 queue state,留给下次启动 recovery 按 attempt 处理(更可靠)。
    const message = err instanceof Error ? err.message : String(err);
    log(`crashed mid-run: ${message} — will recover on next startup`);
  } finally {
    disp.activeSlots = Math.max(0, disp.activeSlots - 1);
  }
}
