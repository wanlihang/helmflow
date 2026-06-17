import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCurrentProjectId } from "@/lib/project";
import { confirmManualMapping } from "@/lib/contract-sync-actions";
import type { HelmcodeStatus } from "@helmflow/contract-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConfirmBody {
  contractFeatureId?: unknown;
  helmcodeStatus?: unknown;
  featureId?: unknown;
  scenarioName?: unknown;
}

const VALID_STATUS = new Set<HelmcodeStatus>([
  "draft",
  "approved",
  "goal-running",
  "done",
]);

// POST /api/contract-sync/confirm — 人工指认 pending 项 → 写映射 + apply + 标 matched
export async function POST(req: Request): Promise<Response> {
  let body: ConfirmBody;
  try {
    body = (await req.json()) as ConfirmBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const contractFeatureId =
    typeof body.contractFeatureId === "string" ? body.contractFeatureId.trim() : "";
  const helmcodeStatus = body.helmcodeStatus;
  const featureId = typeof body.featureId === "string" ? body.featureId.trim() : "";
  const scenarioName = typeof body.scenarioName === "string" ? body.scenarioName.trim() : "";

  if (!contractFeatureId) {
    return NextResponse.json({ error: "contractFeatureId is required" }, { status: 400 });
  }
  if (!featureId) {
    return NextResponse.json({ error: "featureId is required" }, { status: 400 });
  }
  if (!scenarioName) {
    return NextResponse.json({ error: "scenarioName is required" }, { status: 400 });
  }
  if (typeof helmcodeStatus !== "string" || !VALID_STATUS.has(helmcodeStatus as HelmcodeStatus)) {
    return NextResponse.json(
      { error: "helmcodeStatus must be one of draft|approved|goal-running|done" },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const projectId = await getCurrentProjectId();
    const outcome = confirmManualMapping({
      db,
      projectId,
      contractFeatureId,
      helmcodeStatus: helmcodeStatus as HelmcodeStatus,
      featureId,
      scenarioName,
    });
    return NextResponse.json({
      change: outcome.change,
      apply: outcome.apply,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[contract-sync/confirm] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
