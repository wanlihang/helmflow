import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseContract, type Contract } from "@helmflow/contract-schema";
import {
  createFixTask,
  createReflection,
  createRun,
  createRunEvent,
  getContractById,
  listReflectionsForFeature,
  listFixTasks,
  updateRun,
  updateCellAgentStatus,
  updateFeatureScenarioStatus,
  getCellRow,
  type ContractRow,
} from "@helmflow/storage";
import {
  createWorktree,
  removeWorktree,
  mergeWorktreeIntoMain,
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
import { runRequireNode } from "./node-runners/require";
import { runCodeNode } from "./node-runners/code";
import { runTestNode } from "./node-runners/test";
import { runDeployNode } from "./node-runners/deploy";

interface FeatureInfo {
  id: string;
  name: string;
  domainId: string;
  projectId: string;
  cellId: string;
}

function loadFeatureFromContract(contract: Contract, contractRow: ContractRow): FeatureInfo {
  return {
    id: contract.featureId,
    name: contract.featureId,
    domainId: contract.domain,
    projectId: contractRow.projectId || contract.matrixCellId,
    cellId: contractRow.cellId,
  };
}

export async function runOrchestrator(opts: OrchestratorOptions): Promise<void> {
  const { db, contractId, sandboxPath, portalCwd, superRunId, helmcodeRoot, emit: rawEmit } = opts;

  function emit(event: OrchestratorEvent): void {
    if (event.type !== "node-event") {
      try {
        createRunEvent(db, superRunId, event.type, event);
      } catch {
        // DB write failure should not block orchestration
      }
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
  const feature = loadFeatureFromContract(contract, contractRow);

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
    currentNode: "require",
    startedAt: new Date().toISOString(),
    worktreePath: null,
    status: "running",
  });

  if (queuePos > 0) {
    emit({ type: "queued", position: queuePos });
  }

  const branchName = `helmflow-${feature.cellId}-${superRunId}`;
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

  const superRun = createRun(db, feature.cellId, "full-loop", superRunId);
  emit({
    type: "orchestrator-start",
    superRunId,
    cellId: feature.cellId,
    contractId: contractRow.id,
  });

  const startTime = Date.now();
  let currentNode: PipelineNode = "require";
  let globalLoops = 0;
  const nodeRetries: Record<PipelineNode, number> = {
    require: 0,
    code: 0,
    test: 0,
    deploy: 0,
  };
  const iterations: Record<PipelineNode, number> = {
    require: 0,
    code: 0,
    test: 0,
    deploy: 0,
  };

  try {
    while (globalLoops <= MAX_GLOBAL_LOOPS) {
      iterations[currentNode]++;
      const iteration = iterations[currentNode];

      updateActiveRunNode(superRunId, currentNode);
      emit({ type: "node-start", node: currentNode, iteration, runId: superRun.id });

      let result: NodeRunnerResult;

      switch (currentNode) {
        case "require": {
          const refs = listReflectionsForFeature(db, feature.cellId, 5);
          result = await runRequireNode({
            db,
            cellId: feature.cellId,
            featureName: feature.name,
            domainId: feature.domainId,
            contract,
            contractMarkdown,
            sandboxPath: worktreePath,
            iteration,
            helmcodeRoot,
            reflections: refs,
            onEvent: (ev) => emit({ type: "node-event", node: "require", event: ev }),
          });
          break;
        }
        case "code": {
          const refs = listReflectionsForFeature(db, feature.cellId, 5);
          const fts = listFixTasks(db, feature.cellId);
          result = await runCodeNode({
            db,
            cellId: feature.cellId,
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
      );
      // 终态可配置:HELMFLOW_SKIP_DEPLOY=1 时 test 通过即视为 done,产出"通过测试的
      // 代码"(merge worktree),不进入 deploy 节点(适配无 gh / 内网 GitLab 等场景)。
      if (
        decision.action === "next" &&
        decision.node === "deploy" &&
        process.env.HELMFLOW_SKIP_DEPLOY === "1"
      ) {
        decision = { action: "done" };
      }

      if (decision.action === "done") {
        try {
          mergeWorktreeIntoMain({ worktreePath, sandboxPath, branchName });
          emit({ type: "worktree-merge", success: true });
        } catch (err) {
          const mergeErr = err instanceof Error ? err.message : String(err);
          emit({ type: "worktree-merge", success: false, error: mergeErr });
          emit({ type: "worktree-retained", worktreePath, reason: `Merge failed: ${mergeErr}` });
        }
        // Cleanup worktree independently of merge result
        try {
          removeWorktree({ sandboxPath, worktreePath, branchName });
        } catch (cleanupErr) {
          const cleanupMsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
          emit({ type: "worktree-retained", worktreePath, reason: `Cleanup failed: ${cleanupMsg}` });
        }

        updateRun(db, superRun.id, "done");
        updateCellAgentStatus(db, feature.cellId, "done");
        const cellRow = getCellRow(db, feature.cellId);
        if (cellRow && (cellRow.scenarioStatus === "需改造" || cellRow.scenarioStatus === "待实现")) {
          updateFeatureScenarioStatus(db, cellRow.featureId, cellRow.scenarioName, "已支持");
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
        updateCellAgentStatus(db, feature.cellId, "blocked");
        emit({ type: "escalate", reason: decision.reason ?? "Blocked", loop: globalLoops });
        emit({ type: "worktree-retained", worktreePath, reason: `Blocked: ${decision.reason ?? "unknown"}` });
        emit({ type: "done", success: false, totalLoops: globalLoops, totalDurationMs: Date.now() - startTime });
        return;
      }

      if (decision.action === "retry") {
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
      updateCellAgentStatus(db, feature.cellId, "blocked");
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