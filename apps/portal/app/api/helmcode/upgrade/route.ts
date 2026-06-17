import { NextResponse } from "next/server";
import { getProject } from "@helmflow/manifest-loader";
import { getCurrentProjectId } from "@/lib/project";
import { performUpgrade } from "@/lib/helmcode-actions";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpgradeBody {
  ref?: unknown;
}

// POST /api/helmcode/upgrade — HelmFlow 代执行 git 升级 helmcode(checkout/pull)+ 采纳 + 记 migration。
// 前端应在调用前先 GET /upgrade-check + /preview 做 dryRun 预览,用户确认后调本接口。
export async function POST(req: Request): Promise<Response> {
  try {
    const projectId = await getCurrentProjectId();
    const projectInfo = getProject(projectId);
    const helmcodeRoot = projectInfo?.helmcodeRoot;
    if (!helmcodeRoot) {
      return NextResponse.json({ error: "项目未配置 helmcode.path" }, { status: 400 });
    }
    const preset = projectInfo?.manifest.adapterType ?? "java-ddd";

    let body: UpgradeBody = {};
    try { body = await req.json() as UpgradeBody; } catch { /* 无 body 用默认 */ }
    const ref = typeof body.ref === "string" && body.ref.length > 0 ? body.ref : "main";

    const outcome = performUpgrade({ db: getDb(), helmcodeRoot, preset, projectId, ref });

    return NextResponse.json({
      upgrade: {
        fromHead: outcome.upgrade.fromHead.slice(0, 12),
        toHead: outcome.upgrade.toHead.slice(0, 12),
        action: outcome.upgrade.action,
        error: outcome.upgrade.error ?? null,
      },
      version: {
        helmcode: outcome.preview.currentVersion.helmcode,
        checksum: outcome.preview.currentVersion.checksum,
      },
      diff: { changed: outcome.preview.diff.changed, added: outcome.preview.diff.added, removed: outcome.preview.diff.removed, all: outcome.preview.diff.all },
      impact: { total: outcome.preview.impact.total, affectedCells: outcome.preview.impact.affectedCells.map((c) => c.cellId) },
      migrationId: outcome.migrationId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
