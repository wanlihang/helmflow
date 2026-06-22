import { getDb } from "@/lib/db";
import {
  cleanupStaleRuns,
  getRunsLastActivity,
  listRecentRuns,
  listRunningRuns,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5min 无活动判 stale

interface RunOut {
  id: string;
  cellId: string;
  kind: string;
  state: string;
  startedAt: string;
  finishedAt: string | null;
  lastActivity: string;
}

// GET /api/runs?state=running  → 运行中的 run(含最后活动)
// GET /api/runs                 → 最近 N 条 run(含最后活动)
export async function GET(req: Request): Promise<Response> {
  try {
    const db = getDb();
    // 入口先清理卡死的 run(基于最后活动无进展)
    cleanupStaleRuns(db, STALE_THRESHOLD_MS);

    const url = new URL(req.url);
    const state = url.searchParams.get("state");

    const rows = state === "running" ? listRunningRuns(db, 50) : listRecentRuns(db, 30);
    const activityMap = getRunsLastActivity(
      db,
      rows.map((r) => r.id),
    );

    const out: RunOut[] = rows.map((r) => ({
      id: r.id,
      cellId: r.cellId,
      kind: r.kind,
      state: r.state,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      lastActivity: activityMap[r.id] ?? r.startedAt,
    }));

    return NextResponse.json({
      runs: out,
      runningCount: state === "running" ? out.length : listRunningRuns(db, 1000).length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
