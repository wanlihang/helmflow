import { NextResponse } from "next/server";
import { HelmcodeManager } from "@helmflow/helmcode-manager";
import { listProjectsDb } from "@helmflow/storage";
import { getProject } from "@helmflow/manifest-loader";
import { getCurrentProjectId } from "@/lib/project";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProjectVersionOut {
  id: string;
  name: string;
  adapterType: string;
  helmcodeVersion: string | null;
  standardsChecksum: string | null;
  drift: boolean; // 当前 checksum ≠ 项目记录 → 标准 drift
}

interface StatusOut {
  source: "local" | "unconfigured";
  helmcodeRoot: string | null;
  version: string | null;
  preset: string | null;
  checksum: string | null;
  gitHead: string | null;
  projects: ProjectVersionOut[];
}

// GET /api/helmcode/status — 当前绑定的 HelmCode 版本 + 各项目版本 + drift 检测
export async function GET(): Promise<Response> {
  try {
    const projectId = await getCurrentProjectId();
    const projectInfo = getProject(projectId);
    const helmcodeRoot = projectInfo?.helmcodeRoot;

    if (!helmcodeRoot) {
      return NextResponse.json({
        source: "unconfigured",
        helmcodeRoot: null,
        version: null,
        preset: null,
        checksum: null,
        gitHead: null,
        projects: [],
      } satisfies StatusOut);
    }

    const preset = projectInfo?.manifest.adapterType ?? "java-ddd";
    const manager = new HelmcodeManager({ helmcodeRoot, preset });
    const versionInfo = manager.getVersion();
    const currentChecksum = versionInfo.checksum;

    const projects: ProjectVersionOut[] = listProjectsDb(getDb()).map((p) => ({
      id: p.id,
      name: p.name,
      adapterType: p.adapterType,
      helmcodeVersion: p.helmcodeVersion,
      standardsChecksum: p.standardsChecksum,
      // drift: 项目记录了 checksum 且与当前不一致(未记录不算 drift)
      drift: p.standardsChecksum != null && p.standardsChecksum !== currentChecksum,
    }));

    return NextResponse.json({
      source: "local",
      helmcodeRoot,
      version: versionInfo.helmcode,
      preset: versionInfo.preset,
      checksum: currentChecksum,
      gitHead: versionInfo.gitHead ?? null,
      projects,
    } satisfies StatusOut);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
