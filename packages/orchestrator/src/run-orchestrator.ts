import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseContract, type Contract } from "@helmflow/contract-schema";
import {
  createFixTask,
  createPendingMerge,
  createReflection,
  createRun,
  createRunEvent,
  getCellRow,
  getContractById,
  getProjectById,
  getRequirement,
  listFixTasksWorkUnit,
  listReflectionsForWorkUnit,
  updateCellAgentStatus,
  updateFeatureScenarioStatus,
  updateRequirementAgentStatus,
  updateRequirementStatus,
  updateRun,
  type ContractRow,
  type DB,
  type RequirementAgentStatus,
  type WorkUnit,
} from "@helmflow/storage";
import {
  createWorktree,
  removeWorktree,
  acquireSemaphore,
  releaseSemaphore,
  registerActiveRun,
  updateActiveRunNode,
  updateActiveRunStatus,
  removeActiveRun,
  getQueuedCount,
} from "@helmflow/sandbox-worktree";
import { nextNode, MAX_GLOBAL_LOOPS, MAX_RETRIES, type PipelineNode } from "./state-machine";
import type { OrchestratorEvent, OrchestratorOptions, NodeRunnerResult } from "./types";

// 新 4 节点 runners
import { runClarifyNode } from "./node-runners/clarify";
import { runCodeNode } from "./node-runners/code";
import { runTestNode } from "./node-runners/test";
import { runDeployNode } from "./node-runners/deploy";

/**
 * 流水线节点 → cell agentStatus 映射。
 * 每个节点开始时推进 cell 的开发状态,使功能点详情/生命周期条与 run 页面 pipeline 保持一致
 * (解决"功能点状态与全流程状态不一致"):clarify→澄清中, code→实施中, test→测试待跑, deploy→QA通过。
 * done/blocked 仍由 runOrchestrator 末尾统一设置(覆盖)。
 */
const NODE_AGENT_STATUS: Record<PipelineNode, string> = {
  clarify: "clarifying",
  code: "implementing",
  test: "tests-pending",
  deploy: "qa-passed",
};

interface FeatureInfo {
  id: string;
  name: string;
  domainId: string;
  projectId: string;
  cellId: string;
  /** 需求驱动通路:requirement-owned 时填 requirementId,否则 null */
  requirementId: string | null;
  isRequirement: boolean;
}

function loadFeatureFromContract(
  db: DB,
  contract: Contract,
  contractRow: ContractRow,
): FeatureInfo {
  // 需求驱动通路:requirement-owned 契约(cellId 为虚拟 cell 脊柱)
  if (contractRow.requirementId) {
    const req = getRequirement(db, contractRow.requirementId);
    return {
      id: contractRow.requirementId,
      name: req?.title ?? contract.featureId,
      domainId: contract.domain || "需求驱动",
      projectId: contractRow.projectId || req?.projectId || "",
      cellId: contractRow.cellId,
      requirementId: contractRow.requirementId,
      isRequirement: true,
    };
  }
  return {
    id: contract.featureId,
    name: contract.featureId,
    domainId: contract.domain,
    projectId: contractRow.projectId || contract.matrixCellId,
    cellId: contractRow.cellId,
    requirementId: null,
    isRequirement: false,
  };
}

export async function runOrchestrator(opts: OrchestratorOptions): Promise<void> {
  const { db, contractId, sandboxPath, portalCwd, superRunId, helmcodeRoot, emit: rawEmit } = opts;

  function emit(event: OrchestratorEvent): void {
    // 所有事件(含 node-event)都持久化到父 run,使 worker 触发 / portal 重启后
    // 走 DB 轮询的客户端仍能看到各节点的 agent 对话(token/tool_use/tool_result)。
    try {
      createRunEvent(db, superRunId, event.type, event);
    } catch {
      // DB write failure should not block orchestration
    }
    rawEmit(event);
  }

  const contractRow = getContractById(db, contractId);
  if (!contractRow) {
    emit({ type: "error", message: `Contract not found: ${contractId}` });
    return;
  }

  let contractMarkdown: string;
  try {
    // 兼容绝对路径(目标项目 HelmCode 导入契约)与相对路径(基于 portalCwd)。
    // 注意 node path.join 对绝对第二参当相对拼接,必须显式判断。
    const contractPath = isAbsolute(contractRow.markdownPath)
      ? contractRow.markdownPath
      : join(portalCwd, contractRow.markdownPath);
    contractMarkdown = readFileSync(contractPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message: `Failed to read contract: ${message}` });
    return;
  }

  const parsed = parseContract(contractMarkdown);
  if (!parsed.ok) {
    emit({ type: "error", message: `Contract unparseable: ${parsed.errors.join("; ")}` });
    return;
  }
  const contract = parsed.data;
  const feature = loadFeatureFromContract(db, contract, contractRow);

  // 工作单元(cell 矩阵通路 | requirement 需求驱动通路)。决定 runs/reflections/fixTasks 归属。
  const workUnit: WorkUnit = feature.isRequirement
    ? { kind: "requirement", requirementId: feature.requirementId! }
    : { kind: "cell", cellId: feature.cellId };

  /**
   * 统一推进开发状态:cell→cellAgentStatus,requirement→requirementAgentStatus。
   * requirement 的 agentStatus 枚举不含 tests-pending/qa-passed,统一收敛为 implementing。
   */
  const setAgentStatus = (status: string): void => {
    if (feature.isRequirement && feature.requirementId) {
      const reqStatus: RequirementAgentStatus =
        status === "done"
          ? "done"
          : status === "blocked"
            ? "blocked"
            : status === "clarifying"
              ? "clarifying"
              : "implementing";
      updateRequirementAgentStatus(db, feature.requirementId, reqStatus);
    } else {
      updateCellAgentStatus(db, feature.cellId, status);
    }
  };

  // NOTE: registerActiveRun is delayed until after semaphore acquisition
  // to avoid leaving stale entries if acquireSemaphore fails.
  let queuePos: number;
  try {
    queuePos = getQueuedCount();
  } catch {
    queuePos = 0;
  }

  let semaphoreAcquired = false;
  try {
    await acquireSemaphore();
    semaphoreAcquired = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message: `Semaphore acquisition failed: ${message}` });
    return;
  }

  registerActiveRun({
    superRunId,
    featureId: feature.id,
    contractId: contractRow.id,
    currentNode: opts.startNode ?? "clarify",
    startedAt: new Date().toISOString(),
    worktreePath: null,
    status: "running",
  });

  if (queuePos > 0) {
    emit({ type: "queued", position: queuePos });
  }

  // 分支名带可读时间戳(YYYYMMDD-HHMMSS,本地时,到秒),便于区分并行任务;superRunId 保证唯一 + 可追溯到 run
  const branchStamp = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  })();
  const branchName = feature.isRequirement
    ? `helmflow-req-${branchStamp}-${feature.requirementId}-${superRunId}`
    : `helmflow-${branchStamp}-${feature.cellId}-${superRunId}`;
  let worktreePath: string;
  try {
    const wt = createWorktree({ sandboxPath, branchName });
    worktreePath = wt.path;
    emit({ type: "worktree-created", worktreePath: wt.path, branchName: wt.branchName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    releaseSemaphore();
    removeActiveRun(superRunId);
    emit({ type: "error", message: `Failed to create worktree: ${message}` });
    return;
  }

  const superRun = createRun(
    db,
    feature.cellId,
    "full-loop",
    superRunId,
    feature.requirementId ?? undefined,
  );
  emit({
    type: "orchestrator-start",
    superRunId,
    cellId: feature.cellId,
    contractId: contractRow.id,
  });

  const startTime = Date.now();
  // 需求驱动通路:契约已由对话 clarify 产出,startNode 默认 code(跳过 clarify 节点)。
  let currentNode: PipelineNode = opts.startNode ?? (feature.isRequirement ? "code" : "clarify");
  let globalLoops = 0;
  const nodeRetries: Record<PipelineNode, number> = {
    clarify: 0,
    code: 0,
    test: 0,
    deploy: 0,
  };
  const iterations: Record<PipelineNode, number> = {
    clarify: 0,
    code: 0,
    test: 0,
    deploy: 0,
  };
  // infra(529/网络)独立重试计数:不进 nodeRetries/globalLoops/iterations,
  // 避免基础设施错误污染业务回路预算。配合 state-machine 的 infra-error 路由。
  const infraRetries: Record<PipelineNode, number> = {
    clarify: 0,
    code: 0,
    test: 0,
    deploy: 0,
  };

  try {
    while (globalLoops <= MAX_GLOBAL_LOOPS) {
      iterations[currentNode]++;
      const iteration = iterations[currentNode];

      updateActiveRunNode(superRunId, currentNode);
      // 推进 cell/requirement 的开发状态,与 run 页面 pipeline 同步
      setAgentStatus(NODE_AGENT_STATUS[currentNode]);
      emit({ type: "node-start", node: currentNode, iteration, runId: superRun.id });

      let result: NodeRunnerResult;

      switch (currentNode) {
        case "clarify": {
          const refs = listReflectionsForWorkUnit(db, workUnit, 5);
          result = await runClarifyNode({
            db,
            cellId: feature.cellId,
            requirementId: feature.requirementId ?? undefined,
            featureName: feature.name,
            domainId: feature.domainId,
            contract,
            contractMarkdown,
            sandboxPath: worktreePath,
            iteration,
            helmcodeRoot,
            reflections: refs,
            onEvent: (ev) => emit({ type: "node-event", node: "clarify", event: ev }),
          });
          break;
        }
        case "code": {
          const refs = listReflectionsForWorkUnit(db, workUnit, 5);
          const fts = listFixTasksWorkUnit(db, workUnit);
          result = await runCodeNode({
            db,
            cellId: feature.cellId,
            requirementId: feature.requirementId ?? undefined,
            featureName: feature.name,
            domainId: feature.domainId,
            contract,
            contractMarkdown,
            sandboxPath: worktreePath,
            iteration,
            helmcodeRoot,
            reflections: refs,
            fixTasks: fts,
            onEvent: (ev) => emit({ type: "node-event", node: "code", event: ev }),
          });
          break;
        }
        case "test": {
          result = await runTestNode({
            db,
            cellId: feature.cellId,
            requirementId: feature.requirementId ?? undefined,
            featureName: feature.name,
            domainId: feature.domainId,
            contract,
            contractMarkdown,
            sandboxPath: worktreePath,
            portalCwd,
            iteration,
            helmcodeRoot,
            onEvent: (ev) => emit({ type: "node-event", node: "test", event: ev }),
          });
          break;
        }
        case "deploy": {
          result = await runDeployNode({
            db,
            cellId: feature.cellId,
            requirementId: feature.requirementId ?? undefined,
            featureName: feature.name,
            domainId: feature.domainId,
            contract,
            contractRow,
            sandboxPath: worktreePath,
            iteration,
            helmcodeRoot,
            onEvent: (ev) => emit({ type: "node-event", node: "deploy", event: ev }),
          });
          break;
        }
      }

      emit({
        type: "node-done",
        node: currentNode,
        iteration,
        runId: result.runId,
        success: result.success,
        turns: result.turns,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
      });

      const outcome = result.success ? "pass" : "fail";

      // 失败时:写 reflection,创建 fix tasks
      if (!result.success) {
        // 需求/代码/测试节点失败 → reflection
        if (currentNode !== "deploy") {
          const ref = createReflection(db, {
            cellId: feature.cellId,
            requirementId: feature.requirementId ?? null,
            nodeName: currentNode,
            failureSummary: result.failReason ?? (result.issues?.map((i) => i.detail).join("; ") || "node failed"),
            reflectionText: result.issues?.map((i) => `[${i.check}] ${i.detail}`).join("\n") ?? result.failReason ?? "unknown failure",
          });
          emit({ type: "reflection-created", reflectionId: ref.id, nodeName: currentNode });
        }

        // 测试节点失败且有 AC 级别结果 → fix tasks
        if (currentNode === "test" && result.report) {
          const failedAcs = result.report.acResults.filter((a) => a.status === "fail");
          for (const ac of failedAcs) {
            const ft = createFixTask(db, {
              cellId: feature.cellId,
              requirementId: feature.requirementId ?? null,
              sourceRunId: result.runId,
              failedAcId: ac.acId,
              expectedBehavior: `AC ${ac.acId} should pass`,
              actualBehavior: ac.failureReason ?? "test failed",
              evidence: ac.tests?.join(", ") ?? "",
            });
            emit({ type: "fix-task-created", fixTaskId: ft.id, failedAcId: ac.acId, routeTo: "code" });
          }
        }
      }

      let decision = nextNode(
        currentNode,
        outcome,
        result.failReason,
        nodeRetries[currentNode],
        globalLoops,
        nodeRetries,
        infraRetries[currentNode],
      );
      // 【人工确认合并门槛】test 通过后一律停到 pending-confirm:不自动 merge、不跑 deploy 节点。
      // worktree 保留,merge/deploy 由 POST /api/runs/[id]/confirm-merge 在人工确认后触发。
      if (currentNode === "test" && outcome === "pass") {
        const targetBranch = getProjectById(db, feature.projectId)?.mergeBranch ?? "main";
        const mode: "local" | "deploy" =
          process.env.HELMFLOW_SKIP_DEPLOY === "1" ? "local" : "deploy";
        try {
          createPendingMerge(db, {
            runId: superRun.id,
            cellId: feature.cellId,
            requirementId: feature.requirementId,
            projectId: feature.projectId,
            sandboxPath,
            worktreePath,
            branchName,
            targetBranch,
            mode,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          emit({ type: "error", message: `Failed to record pending-merge: ${msg}` });
        }
        updateRun(db, superRun.id, "pending-confirm");
        emit({
          type: "pending-confirm",
          runId: superRun.id,
          worktreePath,
          branchName,
          targetBranch,
          mode,
        });
        // 不 merge/deploy、不动 cell/req 终态(留 tests-pending),保留 worktree;finally 会释放信号量 + removeActiveRun
        return;
      }

      // 终态可配置:HELMFLOW_SKIP_DEPLOY=1 时 test 通过即视为 done。
      // 注意:正常 test-pass 已被上方 pending-confirm 拦截,此分支仅边缘路径(如 startNode=deploy)可达。
      if (
        decision.action === "next" &&
        decision.node === "deploy" &&
        process.env.HELMFLOW_SKIP_DEPLOY === "1"
      ) {
        decision = { action: "done" };
      }

      if (decision.action === "done") {
        // 边缘路径兜底:只做终态收敛 + worktree 清理,不自动 merge(合并统一由 confirm API 负责)。
        try {
          removeWorktree({ sandboxPath, worktreePath, branchName });
        } catch (cleanupErr) {
          const cleanupMsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
          emit({ type: "worktree-retained", worktreePath, reason: `Cleanup failed: ${cleanupMsg}` });
        }

        updateRun(db, superRun.id, "done");
        setAgentStatus("done");
        if (feature.isRequirement && feature.requirementId) {
          updateRequirementStatus(db, feature.requirementId, "done");
        } else {
          const cellRow = getCellRow(db, feature.cellId);
          if (cellRow && (cellRow.scenarioStatus === "需改造" || cellRow.scenarioStatus === "待实现")) {
            updateFeatureScenarioStatus(db, cellRow.featureId, cellRow.scenarioName, "已支持");
          }
        }
        emit({
          type: "done",
          success: true,
          commitId: result.commitId,
          commitSha: result.sha,
          prUrl: result.prUrl,
          totalLoops: globalLoops,
          totalDurationMs: Date.now() - startTime,
        });
        return;
      }

      if (decision.action === "blocked") {
        updateRun(db, superRun.id, "failed");
        setAgentStatus("blocked");
        if (feature.isRequirement && feature.requirementId) {
          updateRequirementStatus(db, feature.requirementId, "blocked");
        }
        emit({ type: "escalate", reason: decision.reason ?? "Blocked", loop: globalLoops });
        emit({ type: "worktree-retained", worktreePath, reason: `Blocked: ${decision.reason ?? "unknown"}` });
        emit({ type: "done", success: false, totalLoops: globalLoops, totalDurationMs: Date.now() - startTime });
        return;
      }

      if (decision.action === "retry") {
        if (decision.reason === "infra-error") {
          // infra(529/网络):当前节点原地退避重试。不消耗业务 retry、不进 globalLoops、不增 iteration。
          infraRetries[currentNode]++;
          const backoffMs = Number(process.env.HELMFLOW_INFRA_BACKOFF_MS) || 30_000;
          emit({
            type: "loop-iteration",
            loop: globalLoops,
            maxLoops: MAX_GLOBAL_LOOPS,
            routeTo: decision.node!,
            infraRetry: true,
            infraBackoffMs: backoffMs,
          });
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          currentNode = decision.node!; // == current,原地重试
          continue;
        }
        nodeRetries[decision.node!]++;
        globalLoops++;

        emit({ type: "loop-iteration", loop: globalLoops, maxLoops: MAX_GLOBAL_LOOPS, routeTo: decision.node! });
        currentNode = decision.node!;
        continue;
      }

      // "next" — 推进到下一节点
      if (decision.action === "next" && decision.node) {
        currentNode = decision.node;
        continue;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      updateRun(db, superRun.id, "failed");
      setAgentStatus("blocked");
      if (feature.isRequirement && feature.requirementId) {
        updateRequirementStatus(db, feature.requirementId, "blocked");
      }
    } catch {
      // ignore DB error during cleanup
    }
    emit({ type: "worktree-retained", worktreePath, reason: `Exception: ${message}` });
    emit({ type: "error", message });
    emit({ type: "done", success: false, totalLoops: globalLoops, totalDurationMs: Date.now() - startTime });
  } finally {
    if (semaphoreAcquired) {
      releaseSemaphore();
    }
    removeActiveRun(superRunId);
  }
}