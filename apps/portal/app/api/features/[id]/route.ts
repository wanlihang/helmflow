import { getDb } from "@/lib/db";
import {
  archiveFeature,
  getFeatureRow,
  listFeatureScenarios,
  updateFeatureMeta,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// GET /api/features/[id] — 功能详情
// ---------------------------------------------------------------------------
export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const { id } = await ctx.params;
  const db = getDb();
  const feature = getFeatureRow(db, id);
  if (!feature || feature.status === "archived") {
    return NextResponse.json({ error: "功能不存在" }, { status: 404 });
  }
  const scenarios = listFeatureScenarios(db, id).filter((s) => !s.archived);
  return NextResponse.json({ feature, scenarios });
}

// ---------------------------------------------------------------------------
// PATCH /api/features/[id] — 编辑元数据
// ---------------------------------------------------------------------------
export async function PATCH(req: Request, ctx: RouteContext): Promise<Response> {
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDb();
  const existing = getFeatureRow(db, id);
  if (!existing) {
    return NextResponse.json({ error: "功能不存在" }, { status: 404 });
  }

  // ID 不可改,忽略 body.id
  const updateArgs: Record<string, string> = {};
  if (typeof body.name === "string" && body.name.trim()) updateArgs.name = body.name.trim();
  if (typeof body.description === "string") updateArgs.description = body.description;
  if (typeof body.handler === "string") updateArgs.handler = body.handler;
  if (typeof body.actions === "string") updateArgs.actions = body.actions;
  if (typeof body.context === "string") updateArgs.context = body.context;
  if (typeof body.priority === "string") updateArgs.priority = body.priority;
  if (typeof body.domain === "string") updateArgs.domain = body.domain;

  if (Object.keys(updateArgs).length === 0) {
    return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
  }

  const updated = updateFeatureMeta(db, id, updateArgs);
  return NextResponse.json({ feature: updated });
}

// ---------------------------------------------------------------------------
// DELETE /api/features/[id] — 归档功能
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  const { id } = await ctx.params;
  const db = getDb();
  const existing = getFeatureRow(db, id);
  if (!existing) {
    return NextResponse.json({ error: "功能不存在" }, { status: 404 });
  }
  if (existing.status === "archived") {
    return NextResponse.json({ error: "功能已归档" }, { status: 400 });
  }
  const archived = archiveFeature(db, id);
  return NextResponse.json({ feature: archived });
}
