import { getDb } from "@/lib/db";
import { getActiveRuns } from "@helmflow/sandbox-worktree";
import { getRunById, listAttemptsForRuns, listRunEvents, listRunsForCell } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(req: Request, context: RouteParams): Promise<Response> {
  const { runId } = await context.params;
  const db = getDb();

  const run = getRunById(db, runId);

  if (!run) {
    return NextResponse.json({ error: `Run not found: ${runId}` }, { status: 404 });
  }

  const cellId = run.cellId;

  const childRuns = listRunsForCell(db, cellId)
    .filter((r) => r.kind !== "full-loop")
    .sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));

  const childRunIds = childRuns.map((r) => r.id);
  const attempts = listAttemptsForRuns(db, childRunIds);

  const activeRun = getActiveRuns().find(
    (ar) => ar.superRunId === runId || cellId.startsWith(ar.featureId + "__"),
  );

  const nodeStates: Record<
    string,
    {
      status: "pending" | "running" | "passed" | "failed";
      iteration: number;
      runId?: string;
    }
  > = {
    coder: { status: "pending", iteration: 0 },
    testgen: { status: "pending", iteration: 0 },
    qa: { status: "pending", iteration: 0 },
    committer: { status: "pending", iteration: 0 },
  };

  for (const cr of childRuns) {
    const kind = cr.kind as string;
    if (!(kind in nodeStates)) continue;
    const current = nodeStates[kind]!;

    const nodeAttemptList = attempts.filter((a) => a.runId === cr.id);
    const maxIter =
      nodeAttemptList.length > 0 ? Math.max(...nodeAttemptList.map((a) => a.iteration)) : 1;

    if (cr.state === "running") {
      current.status = "running";
    } else if (cr.state === "done" || cr.state === "applied") {
      current.status = "passed";
    } else if (cr.state === "failed") {
      current.status = "failed";
    }
    current.iteration = Math.max(current.iteration, maxIter);
    current.runId = cr.id;
  }

  if (activeRun && activeRun.status === "running") {
    const currentNode = activeRun.currentNode;
    if (currentNode in nodeStates) {
      const ns = nodeStates[currentNode]!;
      if (ns.status === "pending") {
        ns.status = "running";
        ns.iteration = Math.max(ns.iteration, 1);
      }
    }
  }

  // Load persisted events from DB
  const url = new URL(req.url);
  const afterIdParam = url.searchParams.get("afterId");
  const afterId = afterIdParam !== null ? Number.parseInt(afterIdParam, 10) : undefined;
  const events = listRunEvents(db, runId, afterId);

  return NextResponse.json({
    run: {
      id: run.id,
      cellId: run.cellId,
      featureId: run.cellId,
      kind: run.kind,
      state: run.state,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    nodes: nodeStates,
    isActive: activeRun !== undefined,
    currentNode: activeRun?.currentNode ?? null,
    events: events.map((e) => ({
      id: e.id,
      type: e.eventType,
      payload: JSON.parse(e.payload),
      createdAt: e.createdAt,
    })),
  });
}
