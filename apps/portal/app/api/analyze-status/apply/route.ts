import { NextResponse } from "next/server";
import { updateFeatureScenarioStatus, updateCellAgentStatus, getCellRow, updateRun, getRunById } from "@helmflow/storage";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApplyItem {
  cellId: string;
  newStatus: string;
}

interface RequestBody {
  items?: unknown;
  runId?: unknown;
}

const DOWNGRADE_TARGETS = new Set(["需改造", "待实现"]);

/**
 * 将指定的分析 run 标记为 "applied"，避免页面刷新后重复弹窗。
 * 仅当显式传入 runId 时才标记 —— 手动改状态（cell-status-select / reimplement）
 * 不传 runId，不应影响分析 run 的弹窗状态。
 */
function markAnalyzeRunApplied(db: ReturnType<typeof getDb>, runId?: string) {
  if (!runId || typeof runId !== "string") return;
  try {
    const run = getRunById(db, runId);
    if (run && run.kind === "analyze" && (run.state === "done" || run.state === "applied")) {
      updateRun(db, run.id, "applied");
    }
  } catch {
    // 标记失败不应阻塞 apply 操作
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }

  const db = getDb();
  const applied: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const item of body.items as ApplyItem[]) {
    if (!item.cellId || !item.newStatus) {
      skipped.push(item.cellId ?? "unknown");
      continue;
    }
    try {
      const cell = getCellRow(db, item.cellId);
      if (!cell) {
        skipped.push(item.cellId);
        continue;
      }
      updateFeatureScenarioStatus(db, cell.featureId, cell.scenarioName, item.newStatus);

      if (cell.scenarioStatus === "已支持" && DOWNGRADE_TARGETS.has(item.newStatus)) {
        updateCellAgentStatus(db, item.cellId, "not-started");
      }

      applied.push(item.cellId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${item.cellId}: ${msg}`);
    }
  }

  // 如果有成功应用的项，标记对应的 analyze run 为 "applied"
  if (applied.length > 0) {
    markAnalyzeRunApplied(db, typeof body.runId === "string" ? body.runId : undefined);
  }

  return NextResponse.json({ applied, skipped, errors: errors.length > 0 ? errors : undefined });
}
