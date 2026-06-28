import { getDb } from "@/lib/db";
import { rewriteContractMdStatus } from "@/lib/contract-md";
import {
  getContractById,
  getLatestContract,
  getLatestContractWorkUnit,
  updateCellAgentStatus,
  updateContractStatus,
  updateRequirementAgentStatus,
  updateRequirementStatus,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/contracts/[id]/approve — 批准契约:draft → approved。
// 最新契约 approve 后 cell agent status 推进 pending-goal(可进 Act 执行);
// md 文件 status 回写(共享 contract-md),best-effort。
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

  const updated = updateContractStatus(db, id, "approved");

  // 需求驱动通路(requirement-owned):更新 requirement 状态,不碰 cellStatus(虚拟 cell)。
  // 矩阵通路(cell-owned):原逻辑,推进 cell agentStatus。
  let isLatest = false;
  let owner: "requirement" | "cell" = "cell";
  if (contract.requirementId) {
    owner = "requirement";
    const latest = getLatestContractWorkUnit(db, {
      kind: "requirement",
      requirementId: contract.requirementId,
    });
    isLatest = latest?.id === contract.id;
    if (isLatest) {
      updateRequirementStatus(db, contract.requirementId, "approved");
      updateRequirementAgentStatus(db, contract.requirementId, "pending-goal");
    }
  } else {
    const latest = getLatestContract(db, contract.cellId);
    isLatest = latest?.id === contract.id;
    if (isLatest) {
      updateCellAgentStatus(db, contract.cellId, "pending-goal");
    }
  }

  // 回写 md 文件 status(共享 contract-md),best-effort
  const mdRewritten = rewriteContractMdStatus(contract.markdownPath, "approved");

  return NextResponse.json({
    contract: updated,
    mdRewritten,
    note: isLatest
      ? owner === "requirement"
        ? "Latest requirement contract approved; requirement status advanced to approved/pending-goal."
        : "Latest contract approved; cell agent status advanced to pending-goal."
      : "Historical draft approved; owner status unchanged.",
  });
}
