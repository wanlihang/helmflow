// 需求驱动通路 — 需求 CRUD 入口。
// POST /api/requirements : 建需求(title/description/projectId?),status=clarifying,不开 run。
// GET  /api/requirements : 列出当前项目(或 ?projectId=)的需求。

import { getDb } from "@/lib/db";
import { getCurrentProjectId } from "@/lib/project";
import { isString } from "@/lib/server-utils";
import {
  createRequirement,
  listRequirementsByProject,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveProjectId(bodyProjectId?: unknown, queryProjectId?: string | null): Promise<string> {
  if (isString(bodyProjectId) && bodyProjectId.length > 0) return bodyProjectId;
  if (queryProjectId && queryProjectId.length > 0) return queryProjectId;
  return getCurrentProjectId();
}

// POST — 建需求
export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = isString(body.title) ? body.title.trim() : "";
  if (!title || title.length > 200) {
    return NextResponse.json({ error: "title 不能为空且不超过 200 字符" }, { status: 400 });
  }
  const description = isString(body.description) ? body.description : "";

  const projectId = await resolveProjectId(body.projectId);

  const db = getDb();
  const requirement = createRequirement(db, { projectId, title, description });
  return NextResponse.json({ requirement }, { status: 201 });
}

// GET — 列需求
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectId = await resolveProjectId(undefined, url.searchParams.get("projectId"));

  const db = getDb();
  const requirements = listRequirementsByProject(db, projectId);
  return NextResponse.json({ requirements, projectId });
}
