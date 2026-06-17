import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listSyncResultsByProject, listSyncResultsByState } from "@helmflow/storage";
import { getCurrentProjectId } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SyncResultOut {
  id: string;
  contractFeatureId: string;
  state: string;
  confidence: number;
  chosenCellId: string | null;
  mappedFeatureId: string | null;
  mappedScenarioName: string | null;
  helmcodeStatus: string;
  targetScenarioStatus: string | null;
  candidates: unknown[];
  reasons: string[];
  scannedAt: string;
}

function mapRow(row: ReturnType<typeof listSyncResultsByProject>[number]): SyncResultOut {
  return {
    id: row.id,
    contractFeatureId: row.contractFeatureId,
    state: row.state,
    confidence: row.confidence,
    chosenCellId: row.chosenCellId,
    mappedFeatureId: row.mappedFeatureId,
    mappedScenarioName: row.mappedScenarioName,
    helmcodeStatus: row.helmcodeStatus,
    targetScenarioStatus: row.targetScenarioStatus,
    candidates: safeParseArray(row.candidatesJson),
    reasons: safeParseArray(row.reasonsJson) as string[],
    scannedAt: row.scannedAt,
  };
}

function safeParseArray(json: string): unknown[] {
  const parsed = safeParse(json);
  return Array.isArray(parsed) ? parsed : [];
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

// GET /api/contract-sync/results?state=matched|pending|unmatched
export async function GET(req: Request): Promise<Response> {
  try {
    const db = getDb();
    const projectId = await getCurrentProjectId();
    const url = new URL(req.url);
    const state = url.searchParams.get("state");

    const rows =
      state === "matched" || state === "pending" || state === "unmatched"
        ? listSyncResultsByState(db, projectId, state)
        : listSyncResultsByProject(db, projectId);

    return NextResponse.json({ results: rows.map(mapRow) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
