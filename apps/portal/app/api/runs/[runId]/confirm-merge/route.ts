import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { getDb } from "@/lib/db";
import { resolveHelmcodeRoot } from "@/lib/server-utils";
import { parseContract } from "@helmflow/contract-schema";
import { runDeployNode } from "@helmflow/orchestrator";
import { mergeWorktreeIntoMain, removeWorktree } from "@helmflow/sandbox-worktree";
import {
  type ContractRow,
  type WorkUnit,
  createRunEvent,
  deletePendingMerge,
  getCellRow,
  getLatestContractWorkUnit,
  getPendingMerge,
  getRequirement,
  getRunById,
  updateCellAgentStatus,
  updateFeatureScenarioStatus,
  updateRequirementAgentStatus,
  updateRequirementStatus,
  updateRun,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

/** run 终态收敛(合并/上线成功后):cell→已支持/done 或 requirement→done,并落 done 事件供前端轮询。 */
function finalizeDone(
  db: ReturnType<typeof getDb>,
  runId: string,
  cellId: string,
  requirementId: string | null,
  extra: { commitSha?: string; prUrl?: string },
): void {
  updateRun(db, runId, "done");
  if (requirementId) {
    updateRequirementStatus(db, requirementId, "done");
    updateRequirementAgentStatus(db, requirementId, "done");
  } else {
    updateCellAgentStatus(db, cellId, "done");
    const cellRow = getCellRow(db, cellId);
    if (cellRow && (cellRow.scenarioStatus === "需改造" || cellRow.scenarioStatus === "待实现")) {
      updateFeatureScenarioStatus(db, cellRow.featureId, cellRow.scenarioName, "已支持");
    }
  }
  createRunEvent(db, runId, "done", {
    type: "done",
    success: true,
    commitSha: extra.commitSha,
    prUrl: extra.prUrl,
    totalLoops: 0,
    totalDurationMs: 0,
  });
}

// POST /api/runs/[runId]/confirm-merge — 人工确认合并/上线。
//   mode=local: merge worktree→targetBranch + 清理 + done。
//   mode=deploy: 异步跑 deploy 节点(出 PR)→ 成功后 done(前端轮询 run_events 看进度)。
export async function POST(_req: Request, ctx: RouteParams): Promise<Response> {
  const { runId } = await ctx.params;
  const db = getDb();

  const run = getRunById(db, runId);
  if (!run) {
    return NextResponse.json({ error: `Run not found: ${runId}` }, { status: 404 });
  }
  if (run.state !== "pending-confirm") {
    return NextResponse.json(
      { error: `Run 状态非 pending-confirm(当前 ${run.state}),无法确认合并` },
      { status: 400 },
    );
  }
  const pm = getPendingMerge(db, runId);
  if (!pm) {
    return NextResponse.json({ error: "无 pending-merge 记录(可能已被处理)" }, { status: 404 });
  }

  // ---- mode=local: 同步合并到目标分支 ----
  if (pm.mode === "local") {
    try {
      mergeWorktreeIntoMain({
        worktreePath: pm.worktreePath,
        sandboxPath: pm.sandboxPath,
        branchName: pm.branchName,
        targetBranch: pm.targetBranch,
      });
      createRunEvent(db, runId, "worktree-merge", { type: "worktree-merge", success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      createRunEvent(db, runId, "worktree-merge", {
        type: "worktree-merge",
        success: false,
        error: msg,
      });
      createRunEvent(db, runId, "worktree-retained", {
        type: "worktree-retained",
        worktreePath: pm.worktreePath,
        reason: `Merge failed: ${msg}`,
      });
      // 合并失败:保留 worktree + pending 状态,等人工处理或重试
      return NextResponse.json({ error: `合并失败: ${msg}(worktree 已保留)` }, { status: 500 });
    }
    try {
      removeWorktree({
        sandboxPath: pm.sandboxPath,
        worktreePath: pm.worktreePath,
        branchName: pm.branchName,
      });
    } catch {
      /* 清理失败不阻塞,worktree 残留可后续清 */
    }
    finalizeDone(db, runId, pm.cellId, pm.requirementId, {});
    deletePendingMerge(db, runId);
    return NextResponse.json({
      ok: true,
      mode: "local",
      merged: true,
      targetBranch: pm.targetBranch,
    });
  }

  // ---- mode=deploy: 异步跑 deploy 节点(出 PR) ----
  const wu: WorkUnit = pm.requirementId
    ? { kind: "requirement", requirementId: pm.requirementId }
    : { kind: "cell", cellId: pm.cellId };
  const contractRow: ContractRow | undefined = getLatestContractWorkUnit(db, wu);
  if (!contractRow) {
    return NextResponse.json(
      { error: "未找到该工作单元的契约,无法跑 deploy 节点" },
      { status: 404 },
    );
  }
  // 读契约正文
  let contractMarkdown = "";
  try {
    const mdPath = isAbsolute(contractRow.markdownPath)
      ? contractRow.markdownPath
      : join(process.cwd(), contractRow.markdownPath);
    contractMarkdown = readFileSync(mdPath, "utf-8");
  } catch {
    return NextResponse.json(
      { error: `读取契约失败: ${contractRow.markdownPath}` },
      { status: 500 },
    );
  }
  const parsed = parseContract(contractMarkdown);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: `契约解析失败: ${parsed.errors.join("; ")}` },
      { status: 500 },
    );
  }
  const req = pm.requirementId ? getRequirement(db, pm.requirementId) : undefined;
  const helmcodeRoot = await resolveHelmcodeRoot();

  // 异步跑 deploy 节点(不阻塞响应;前端轮询 run_events 看 done)
  void (async () => {
    try {
      const result = await runDeployNode({
        db,
        cellId: pm.cellId,
        requirementId: pm.requirementId,
        featureName: req?.title ?? pm.cellId,
        domainId: parsed.data.domain ?? "需求驱动",
        contract: parsed.data,
        contractRow,
        sandboxPath: pm.worktreePath,
        iteration: 1,
        helmcodeRoot,
        onEvent: (ev) => {
          try {
            createRunEvent(db, runId, "node-event", {
              type: "node-event",
              node: "deploy",
              event: ev,
            });
          } catch {
            /* ignore */
          }
        },
      });
      if (result.success) {
        finalizeDone(db, runId, pm.cellId, pm.requirementId, {
          commitSha: result.sha,
          prUrl: result.prUrl,
        });
        deletePendingMerge(db, runId);
      } else {
        // deploy 失败:保留 pending-confirm 供重试
        createRunEvent(db, runId, "error", {
          type: "error",
          message: `deploy 节点失败: ${result.issues?.[0]?.detail ?? "unknown"}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      createRunEvent(db, runId, "error", { type: "error", message: `deploy 异常: ${msg}` });
    }
  })();

  return NextResponse.json({ ok: true, mode: "deploy", started: true });
}
