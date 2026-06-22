import { getDb } from "@/lib/db";
import { adoptVersion } from "@/lib/helmcode-actions";
import { getCurrentProjectId } from "@/lib/project";
import { getProject } from "@helmflow/manifest-loader";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/helmcode/adopt — 采纳当前 helmcode 源版本:更新 projects 绑定 + 记 migration。
// 前置:用户已在 helmcode 仓库手动 git 切换。HelmFlow 不改 git/文件。
export async function POST(): Promise<Response> {
  try {
    const projectId = await getCurrentProjectId();
    const projectInfo = getProject(projectId);
    const helmcodeRoot = projectInfo?.helmcodeRoot;
    if (!helmcodeRoot) {
      return NextResponse.json({ error: "项目未配置 helmcode.path" }, { status: 400 });
    }
    const preset = projectInfo?.manifest.adapterType ?? "java-ddd";

    const outcome = adoptVersion({ db: getDb(), helmcodeRoot, preset, projectId });

    return NextResponse.json({
      migrationId: outcome.migrationId,
      affectedCount: outcome.affectedCount,
      version: {
        helmcode: outcome.version.helmcode,
        checksum: outcome.version.checksum,
        gitHead: outcome.version.gitHead ?? null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
