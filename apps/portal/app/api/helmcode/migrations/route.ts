import { NextResponse } from "next/server";
import { listMigrations } from "@helmflow/storage";
import { getCurrentProjectId } from "@/lib/project";
import { rollbackVersion } from "@/lib/helmcode-actions";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/helmcode/migrations — changelog(版本切换审计历史)
export async function GET(): Promise<Response> {
  try {
    const projectId = await getCurrentProjectId();
    const rows = listMigrations(getDb(), projectId, 30);
    return NextResponse.json({
      migrations: rows.map((r) => ({
        id: r.id,
        action: r.action,
        fromChecksum: r.fromChecksum ? r.fromChecksum.slice(0, 12) : null,
        toChecksum: r.toChecksum.slice(0, 12),
        fromGitHead: r.fromGitHead ? r.fromGitHead.slice(0, 12) : null,
        toGitHead: r.toGitHead ? r.toGitHead.slice(0, 12) : null,
        changedFiles: safeParse(r.changedFilesJson),
        affectedCount: r.affectedCount,
        operator: r.operator,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/helmcode/migrations — 回滚记录(用户已手动 git checkout 回旧版,HelmFlow 重新绑定)
export async function POST(): Promise<Response> {
  try {
    const projectId = await getCurrentProjectId();
    const outcome = rollbackVersion(getDb(), projectId);
    return NextResponse.json(outcome);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function safeParse(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
