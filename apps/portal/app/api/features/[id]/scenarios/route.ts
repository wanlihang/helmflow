import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createScenarioManual, getFeatureRow } from "@helmflow/storage";
import { resetMatrixSyncFlag } from "@/lib/sync-matrix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// POST /api/features/[id]/scenarios — 添加场景
// ---------------------------------------------------------------------------
export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const { id: featureId } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scenarioName = typeof body.scenarioName === "string" ? body.scenarioName.trim() : "";
  if (!scenarioName) {
    return NextResponse.json({ error: "场景名称不能为空" }, { status: 400 });
  }

  const scenarioStatus =
    typeof body.scenarioStatus === "string" ? body.scenarioStatus : "待实现";

  const db = getDb();
  const feature = getFeatureRow(db, featureId);
  if (!feature || feature.status === "archived") {
    return NextResponse.json({ error: "功能不存在或已归档" }, { status: 404 });
  }

  try {
    const scenario = createScenarioManual(db, {
      featureId,
      scenarioName,
      scenarioStatus,
    });
    resetMatrixSyncFlag();
    return NextResponse.json({ scenario }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("already exists")) {
      return NextResponse.json({ error: "场景已存在" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
