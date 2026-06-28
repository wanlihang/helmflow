import { getDb } from "@/lib/db";
import { getRunById, listRunEvents, listStructuralRunEvents } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 新 4 节点流水线(与 orchestrator state-machine 的 NODES 对齐)。
// 旧的 coder/testgen/qa/committer 已废弃 —— orchestrator 只发 clarify/code/test/deploy。
const PIPELINE_NODES = ["clarify", "code", "test", "deploy"] as const;
type NodeStatus = "pending" | "running" | "passed" | "failed";

interface NodeState {
  status: NodeStatus;
  iteration: number;
  runId?: string;
  turns?: number;
  durationMs?: number;
  costUsd?: number | null;
}

interface RouteParams {
  params: Promise<{ runId: string }>;
}

/**
 * 按持久化的 run_events 重建节点状态(弃用旧的 childRuns/attempts 方案)。
 * 旧方案除节点名错外,还会把同一 cell 历史所有 run 的子 run 串在一起、归属错乱;
 * 事件天然按 run_id=superRunId 归属,且 worker 进程跑的 full-loop 也把事件落库,
 * portal 轮询 DB 即可看到 clarify/code/test/deploy 实时进度 —— 不依赖进程内 activeRun。
 */
function reconstructNodes(events: ReturnType<typeof listRunEvents>): {
  nodes: Record<string, NodeState>;
  currentNode: string | null;
} {
  const nodes: Record<string, NodeState> = {};
  for (const n of PIPELINE_NODES) {
    nodes[n] = { status: "pending", iteration: 0 };
  }
  let currentNode: string | null = null;

  for (const ev of events) {
    const type = ev.eventType;
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(ev.payload);
    } catch {
      continue;
    }
    const node = typeof p.node === "string" ? p.node : null;

    if (type === "node-start" && node && node in nodes) {
      nodes[node] = {
        ...nodes[node],
        status: "running",
        iteration: typeof p.iteration === "number" ? p.iteration : nodes[node].iteration,
        runId: typeof p.runId === "string" ? p.runId : nodes[node].runId,
      };
      currentNode = node;
    } else if (type === "node-done" && node && node in nodes) {
      nodes[node] = {
        ...nodes[node],
        status: p.success === true ? "passed" : "failed",
        iteration: typeof p.iteration === "number" ? p.iteration : nodes[node].iteration,
        runId: typeof p.runId === "string" ? p.runId : nodes[node].runId,
        turns: typeof p.turns === "number" ? p.turns : nodes[node].turns,
        durationMs: typeof p.durationMs === "number" ? p.durationMs : nodes[node].durationMs,
        costUsd: typeof p.costUsd === "number" ? p.costUsd : nodes[node].costUsd,
      };
    } else if (type === "loop-iteration") {
      // 回路:从 routeTo 起的后续节点重置为 pending(保留 iteration)
      const routeTo = typeof p.routeTo === "string" ? p.routeTo : null;
      if (routeTo) {
        const idx = (PIPELINE_NODES as readonly string[]).indexOf(routeTo);
        if (idx >= 0) {
          for (let i = idx; i < PIPELINE_NODES.length; i++) {
            const n = PIPELINE_NODES[i];
            nodes[n] = { ...nodes[n], status: "pending" };
          }
        }
      }
    }
  }

  return { nodes, currentNode };
}

export async function GET(req: Request, context: RouteParams): Promise<Response> {
  const { runId } = await context.params;
  const db = getDb();

  const run = getRunById(db, runId);
  if (!run) {
    return NextResponse.json({ error: `Run not found: ${runId}` }, { status: 404 });
  }

  // 节点状态重建:只查结构化事件(避免每次轮询全量加载上千条 node-event)
  const structuralEvents = listStructuralRunEvents(db, runId);
  const { nodes: nodeStates, currentNode } = reconstructNodes(structuralEvents);

  // events 字段:按 afterId 增量返回全量事件类型(前端日志回放去重用)
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
    isActive: run.state === "running",
    currentNode,
    events: events.map((e) => ({
      id: e.id,
      type: e.eventType,
      payload: JSON.parse(e.payload),
      createdAt: e.createdAt,
    })),
  });
}
