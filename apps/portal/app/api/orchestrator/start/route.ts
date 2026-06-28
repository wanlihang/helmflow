import { existsSync } from "node:fs";
import { getDb } from "@/lib/db";
import { guardCellOperable } from "@/lib/guard";
import { isString, resolveHelmcodeRoot, resolveSandboxPath } from "@/lib/server-utils";
import {
  type OrchestratorEvent,
  createRunEmitter,
  emitEvent,
  runOrchestrator,
} from "@helmflow/orchestrator";
import { getContractById, getRuntimeSettings } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  contractId?: unknown;
  startNode?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isString(body.contractId) || body.contractId.length === 0) {
    return NextResponse.json({ error: "contractId is required" }, { status: 400 });
  }

  // 起始节点(默认 clarify):Plan 定稿后 Act 可传 "code" 跳过 clarify 直奔执行
  const VALID_START_NODES = ["clarify", "code", "test", "deploy"] as const;
  const startNodeRaw = typeof body.startNode === "string" ? body.startNode : undefined;
  const startNode =
    startNodeRaw && (VALID_START_NODES as readonly string[]).includes(startNodeRaw)
      ? (startNodeRaw as "clarify" | "code" | "test" | "deploy")
      : undefined;

  const db = getDb();
  const contract = getContractById(db, body.contractId);
  if (!contract) {
    return NextResponse.json({ error: `Contract not found: ${body.contractId}` }, { status: 404 });
  }
  if (contract.status !== "approved") {
    return NextResponse.json(
      {
        error: `Contract status must be 'approved' to start full-loop, got '${contract.status}'`,
      },
      { status: 400 },
    );
  }

  // 需求驱动通路:requirement-owned 契约(虚拟 cell)跳过 cell operable guard,
  // approved 即执行资格。矩阵通路仍按 cell scenarioStatus 守卫。
  if (!contract.requirementId) {
    const guard = guardCellOperable(db, contract.cellId);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }
  }

  const sandboxPath = await resolveSandboxPath();
  if (!existsSync(sandboxPath)) {
    return NextResponse.json(
      { error: `project sandbox not found: ${sandboxPath}` },
      { status: 500 },
    );
  }

  const portalCwd = process.cwd();

  // Resolve HelmCode root from project config
  const helmcodeRoot = await resolveHelmcodeRoot();

  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const superRunId = `run-${ts}-${rand}`;

  createRunEmitter(superRunId);

  // 运行参数(平台一等公民,前端 /llm 可配):注入 process.env,供 runOrchestrator/runNode 读取。
  // 单机单用户场景,进程级 env 注入可接受;默认 skip_deploy=on → 最短闭环(test 过即 done)。
  const settings = getRuntimeSettings(db);
  process.env.HELMFLOW_SKIP_DEPLOY = settings.skipDeploy ? "1" : "0";
  process.env.HELMFLOW_TURNS_PER_SESSION = String(settings.turnsPerSession);
  process.env.HELMFLOW_TURN_INTERVAL_MS = String(settings.turnIntervalMs);

  // Wrap orchestrator in error handler so crashes are emitted to SSE
  void (async () => {
    try {
      await runOrchestrator({
        db,
        contractId: body.contractId as string,
        sandboxPath,
        portalCwd,
        superRunId,
        helmcodeRoot,
        ...(startNode ? { startNode } : {}),
        emit: (event: OrchestratorEvent) => {
          emitEvent(superRunId, event);
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitEvent(superRunId, { type: "error", message });
    }
  })();

  return NextResponse.json({
    superRunId,
    contractId: contract.id,
    cellId: contract.cellId,
  });
}
