import { getDb } from "@/lib/db";
import { removeWorktree } from "@helmflow/sandbox-worktree";
import {
  createRunEvent,
  deletePendingMerge,
  getCellRow,
  getPendingMerge,
  getRunById,
  updateCellAgentStatus,
  updateRequirementAgentStatus,
  updateRun,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

// POST /api/runs/[runId]/abort — 放弃合并:删 worktree/分支,run→abandoned,cell/requirement 回退到可重跑。
export async function POST(_req: Request, ctx: RouteParams): Promise<Response> {
  const { runId } = await ctx.params;
  const db = getDb();

  const run = getRunById(db, runId);
  if (!run) {
    return NextResponse.json({ error: `Run not found: ${runId}` }, { status: 404 });
  }
  if (run.state !== "pending-confirm") {
    return NextResponse.json(
      { error: `Run 状态非 pending-confirm(当前 ${run.state}),无法放弃` },
      { status: 400 },
    );
  }
  const pm = getPendingMerge(db, runId);
  if (!pm) {
    return NextResponse.json({ error: "无 pending-merge 记录" }, { status: 404 });
  }

  try {
    removeWorktree({
      sandboxPath: pm.sandboxPath,
      worktreePath: pm.worktreePath,
      branchName: pm.branchName,
    });
  } catch {
    /* 删不掉的 worktree 不阻塞,残留可后续清 */
  }

  updateRun(db, runId, "abandoned");
  if (pm.requirementId) {
    updateRequirementAgentStatus(db, pm.requirementId, "not-started");
  } else {
    updateCellAgentStatus(db, pm.cellId, "not-started");
  }
  createRunEvent(db, runId, "done", {
    type: "done",
    success: false,
    totalLoops: 0,
    totalDurationMs: 0,
  });
  deletePendingMerge(db, runId);

  return NextResponse.json({ ok: true, aborted: true });
}
