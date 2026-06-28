// GET /api/requirements/[id] — 需求详情:requirement + 最新契约(若有)。

import { getDb } from "@/lib/db";
import { getRequirement, getLatestContractWorkUnit } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const { id } = await ctx.params;
  if (!id || id.length === 0) {
    return NextResponse.json({ error: "requirement id is required" }, { status: 400 });
  }

  const db = getDb();
  const requirement = getRequirement(db, id);
  if (!requirement) {
    return NextResponse.json({ error: `Requirement not found: ${id}` }, { status: 404 });
  }

  const latestContract = getLatestContractWorkUnit(db, {
    kind: "requirement",
    requirementId: id,
  });

  return NextResponse.json({
    requirement,
    latestContract: latestContract
      ? {
          id: latestContract.id,
          status: latestContract.status,
          markdownPath: latestContract.markdownPath,
          createdAt: latestContract.createdAt,
          approvedAt: latestContract.approvedAt,
        }
      : null,
  });
}
