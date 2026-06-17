import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { deleteScenario, cellId as makeCellId, getCellRow, getFeatureRow } from "@helmflow/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// DELETE /api/features/[id]/scenarios/[name] — 删除场景
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  const { id: featureId, name: scenarioName } = await ctx.params;
  const decodedName = decodeURIComponent(scenarioName);

  const db = getDb();

  // 验证 feature 存在
  const feature = getFeatureRow(db, featureId);
  if (!feature) {
    return NextResponse.json({ error: "功能不存在" }, { status: 404 });
  }

  const cid = makeCellId(featureId, decodedName);
  const existing = getCellRow(db, cid);
  if (!existing) {
    return NextResponse.json({ error: "场景不存在" }, { status: 404 });
  }

  deleteScenario(db, cid);
  return NextResponse.json({ deleted: cid });
}
