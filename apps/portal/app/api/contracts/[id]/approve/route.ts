import { getDb } from "@/lib/db";
import {
  getContractById,
  getLatestContract,
  updateCellAgentStatus,
  updateContractStatus,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

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
      { error: `Contract status must be 'draft' to approve, got '${contract.status}'` },
      { status: 400 },
    );
  }

  const latest = getLatestContract(db, contract.cellId);
  const isLatest = latest?.id === contract.id;

  const updated = updateContractStatus(db, id, "approved");
  if (isLatest) {
    updateCellAgentStatus(db, contract.cellId, "pending-goal");
  }

  return NextResponse.json({
    contract: updated,
    note: isLatest
      ? "Latest contract approved; cell agent status advanced to pending-goal."
      : "Historical draft approved; cell agent status unchanged.",
  });
}
