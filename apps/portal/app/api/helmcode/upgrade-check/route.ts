import { NextResponse } from "next/server";
import { getProject } from "@helmflow/manifest-loader";
import { getCurrentProjectId } from "@/lib/project";
import { checkUpgrade } from "@/lib/helmcode-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/helmcode/upgrade-check?branch=main — 检查 github origin 有没有新版(git fetch + 对比,只读)
export async function GET(req: Request): Promise<Response> {
  try {
    const projectId = await getCurrentProjectId();
    const projectInfo = getProject(projectId);
    const helmcodeRoot = projectInfo?.helmcodeRoot;
    if (!helmcodeRoot) {
      return NextResponse.json({ error: "项目未配置 helmcode.path" }, { status: 400 });
    }
    const url = new URL(req.url);
    const branch = url.searchParams.get("branch") ?? "main";

    const info = checkUpgrade(helmcodeRoot, branch);
    return NextResponse.json(info);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
