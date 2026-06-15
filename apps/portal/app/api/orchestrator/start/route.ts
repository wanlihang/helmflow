import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { getContractById } from "@helmflow/storage";
import {
  runOrchestrator,
  createRunEmitter,
  emitEvent,
  type OrchestratorEvent,
} from "@helmflow/orchestrator";
import { getDb } from "@/lib/db";
import { guardCellOperable } from "@/lib/guard";
import { isString, resolveSandboxPath, resolveHelmcodeRoot } from "@/lib/server-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  contractId?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isString(body.contractId) || body.contractId.length === 0) {
    return NextResponse.json(
      { error: "contractId is required" },
      { status: 400 },
    );
  }

  const db = getDb();
  const contract = getContractById(db, body.contractId);
  if (!contract) {
    return NextResponse.json(
      { error: `Contract not found: ${body.contractId}` },
      { status: 404 },
    );
  }
  if (contract.status !== "approved") {
    return NextResponse.json(
      {
        error: `Contract status must be 'approved' to start full-loop, got '${contract.status}'`,
      },
      { status: 400 },
    );
  }

  const guard = guardCellOperable(db, contract.cellId);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
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