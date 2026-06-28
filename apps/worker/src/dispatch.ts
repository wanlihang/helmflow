// 消费/调度:从 pipeline_queue 认领 pending 项,在并发槽内调用 runOrchestrator。
// 单进程内用 activeSlots 控并发(orchestrator 内部也有内存信号量,但跨进程不共享)。
// 限流治理:单次 529 由 runNode 退避处理;连续限流失败触发全局冷却(暂停取新任务,等 RPM 恢复)。

import {
  type DB,
  claimNextPending,
  getActiveLLMProvider,
  markQueueDone,
  markQueueTerminal,
  updateCellAgentStatus,
  updateRequirementAgentStatus,
  updateRequirementStatus,
  getRunById,
  newRunId,
  listReflectionsForWorkUnit,
  type PipelineQueueRow,
  type WorkUnit,
} from "@helmflow/storage";
import { runOrchestrator, type OrchestratorEvent } from "@helmflow/orchestrator";
import type { WorkerConfig } from "./env";

/** 连续限流失败后,全局冷却时长(ms):暂停取新任务,让端点 RPM/TPM 窗口恢复。 */
const GLOBAL_COOLDOWN_MS = 5 * 60_000;
const RATE_LIMIT_RE = /529|429|overloaded|rate.?limit|访问量过大|稍后再试/i;

export interface Dispatcher {
  activeSlots: number;
  maxSlots: number;
  /** 全局冷却到期时间戳(ms);> Date.now() 时 pump 不取新任务。 */
  cooldownUntilMs: number;
}

export function createDispatcher(cfg: WorkerConfig): Dispatcher {
  return { activeSlots: 0, maxSlots: cfg.concurrency, cooldownUntilMs: 0 };
}

/** 是否处于全局冷却(限流恢复期)。 */
export function isInCooldown(disp: Dispatcher): boolean {
  return Date.now() < disp.cooldownUntilMs;
}

/**
 * 认领并启动任务,直到并发槽满、预算超限、全局冷却或无 pending。返回本轮启动数。
 */
export function pump(
  db: DB,
  cfg: WorkerConfig,
  disp: Dispatcher,
  isBudgetExceeded: () => boolean,
): number {
  // 全局冷却:连续限流后暂停取新任务,避免反复撞墙
  if (isInCooldown(disp)) return 0;
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

  // sync DB 活跃 provider 到 env —— 让本轮 runOrchestrator/runNode 用最新 model/key,
  // 而非 worker 启动时的系统 env。portal 切换 provider 后 worker 立即生效(无需重启)。
  const activeLlm = getActiveLLMProvider(db);
  if (activeLlm) {
    process.env.HELMFLOW_ANTHROPIC_API_KEY = activeLlm.apiKey;
    process.env.HELMFLOW_ANTHROPIC_BASE_URL = activeLlm.baseUrl;
    process.env.HELMFLOW_ANTHROPIC_MODEL = activeLlm.model;
    log(`using active provider: ${activeLlm.name} model=${activeLlm.model}`);
  }

  // 推进开发状态:requirement-owned → requirement 状态机;cell-owned → cell agentStatus。
  if (item.requirementId) {
    updateRequirementAgentStatus(db, item.requirementId, "implementing");
    updateRequirementStatus(db, item.requirementId, "running");
  } else {
    updateCellAgentStatus(db, item.cellId, "implementing");
  }

  // 每次执行用新 superRunId(createRun 以此为主键,无 upsert,不可复用)
  const superRunId = newRunId();

  // 事件日志:节点流转 + 限流退避/冷却可见(否则 worker 静默,看不出在等端点)。
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
      case "node-event": {
        // node-event 不落库,但限流退避通知(assistant.text)打出来,让限流期间可见
        const inner = event.event;
        if (
          inner &&
          inner.type === "assistant.text" &&
          RATE_LIMIT_RE.test(inner.text ?? "")
        ) {
          log(inner.text.trim());
        }
        break;
      }
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
    const run = getRunById(db, superRunId);
    if (run?.state === "done") {
      markQueueDone(db, item.id);
      log("done ✓");
      return;
    }
    // 失败:若由端点限流导致 → 触发全局冷却(暂停后续取任务,等 RPM 恢复)
    // 按 workUnit 查本工作单元的最近反思(需求通路多需求共享虚拟 cellId,不能只按 cellId)。
    const failWu: WorkUnit = item.requirementId
      ? { kind: "requirement", requirementId: item.requirementId }
      : { kind: "cell", cellId: item.cellId };
    const latest = listReflectionsForWorkUnit(db, failWu, 1)[0];
    const reasonText = latest ? `${latest.failureSummary} ${latest.reflectionText}` : "";
    if (latest && RATE_LIMIT_RE.test(reasonText)) {
      disp.cooldownUntilMs = Date.now() + GLOBAL_COOLDOWN_MS;
      markQueueTerminal(
        db,
        item.id,
        "blocked",
        `端点限流,触发全局冷却 ${GLOBAL_COOLDOWN_MS / 1000}s(暂停取新任务,等 RPM 恢复)`,
      );
      log(`blocked — 端点限流,全局冷却 ${GLOBAL_COOLDOWN_MS / 1000}s`);
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
