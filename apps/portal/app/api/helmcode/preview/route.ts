import { getDb } from "@/lib/db";
import { previewStandardsChange } from "@/lib/helmcode-actions";
import { getCurrentProjectId } from "@/lib/project";
import { getProject } from "@helmflow/manifest-loader";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/helmcode/preview?from=<gitHead> — dryRun:diff(改了哪些 pattern) + impact(影响哪些 cell)。不落库。
export async function GET(req: Request): Promise<Response> {
  try {
    const projectId = await getCurrentProjectId();
    const projectInfo = getProject(projectId);
    const helmcodeRoot = projectInfo?.helmcodeRoot;
    if (!helmcodeRoot) {
      return NextResponse.json({ error: "项目未配置 helmcode.path" }, { status: 400 });
    }
    const preset = projectInfo?.manifest.adapterType ?? "java-ddd";
    const url = new URL(req.url);
    const fromGitHead = url.searchParams.get("from") ?? undefined;

    const outcome = previewStandardsChange({
      db: getDb(),
      helmcodeRoot,
      preset,
      projectId,
      fromGitHead,
    });

    return NextResponse.json({
      currentVersion: {
        helmcode: outcome.currentVersion.helmcode,
        preset: outcome.currentVersion.preset,
        checksum: outcome.currentVersion.checksum,
        gitHead: outcome.currentVersion.gitHead ?? null,
      },
      diff: outcome.diff,
      impact: outcome.impact,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
