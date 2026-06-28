import { getDb } from "@/lib/db";
import { rewriteContractMdStatus } from "@/lib/contract-md";
import { getContractById, updateContractStatus } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/contracts/[id]/reject — 拒绝契约:draft → abandoned。
// 与 approve 对称,但不推进 cell agent status(重跑 clarify 会生新 draft)。
// abandoned 契约仍在 cell 时间线可见,getLatestContract 取最新。
export async function POST(_req: Request, ctx: RouteContext): Promise<Response> {
  const { id } = await ctx.params;
  if (!id || id.length === 0) {
    return NextResponse.json({ error: "contract id is required" }, { status: 400 });
  }

  const db = getDb();
  const contract = getContractById(db, id);
  if (!contract) {
    return NextResponse.json({ error: `Contract not found: ${id}` }, { status: 404 });
  }
  if (contract.status !== "draft") {
    return NextResponse.json(
      { error: `Contract status must be 'draft' to reject, got '${contract.status}'` },
      { status: 400 },
    );
  }

  const updated = updateContractStatus(db, id, "abandoned");
  const mdRewritten = rewriteContractMdStatus(contract.markdownPath, "abandoned");

  return NextResponse.json({
    contract: updated,
    mdRewritten,
    note: "Contract rejected (abandoned); cell status unchanged. Re-run clarify to produce a new draft.",
  });
}
