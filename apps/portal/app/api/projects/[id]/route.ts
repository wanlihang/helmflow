import { NextResponse } from "next/server";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { getDb } from "@/lib/db";
import {
  getProjectById,
  updateProject as updateProjectDb,
  softDeleteProject,
  countFeaturesByProject,
  countFeaturesByStatus,
} from "@helmflow/storage";
import { loadManifest, type Manifest } from "@helmflow/manifest-loader";
import { stringify as stringifyYaml } from "yaml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MONOREPO_ROOT = resolve(process.cwd(), "..", "..");

// ---------------------------------------------------------------------------
// GET /api/projects/[id] — 项目详情 + feature 统计
// ---------------------------------------------------------------------------
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const db = getDb();
  const project = getProjectById(db, id);
  if (!project || project.status !== "active") {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const byStatus = countFeaturesByStatus(db, id);
  const totalFeatures = countFeaturesByProject(db, id);

  return NextResponse.json({
    project: {
      id: project.id,
      name: project.name,
      adapterType: project.adapterType,
      sandboxPath: project.sandboxPath,
      standardsRoot: project.standardsRoot,
      featureMatrixPath: project.featureMatrixPath,
      repoUrl: project.repoUrl,
      description: project.description,
      manifestPath: project.manifestPath,
      status: project.status,
      registeredAt: project.registeredAt.toISOString(),
      stats: { totalFeatures, byStatus },
    },
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/projects/[id] — 更新项目配置
// ---------------------------------------------------------------------------
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const db = getDb();
  const project = getProjectById(db, id);
  if (!project || project.status !== "active") {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const adapterType =
    typeof body.adapterType === "string" ? body.adapterType : undefined;
  if (adapterType) {
    const VALID_ADAPTERS = ["java-ddd", "node-express"];
    if (!VALID_ADAPTERS.includes(adapterType)) {
      return NextResponse.json(
        { error: `adapterType 必须是: ${VALID_ADAPTERS.join(" / ")}` },
        { status: 400 },
      );
    }
  }

  const sandboxPath =
    typeof body.sandboxPath === "string" ? body.sandboxPath.trim() : undefined;
  if (sandboxPath) {
    const abs = isAbsolute(sandboxPath)
      ? resolve(sandboxPath)
      : resolve(MONOREPO_ROOT, sandboxPath);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      return NextResponse.json(
        { error: `沙箱路径不存在或不是目录: ${sandboxPath}` },
        { status: 400 },
      );
    }
  }

  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const featureMatrixPath =
    typeof body.featureMatrixPath === "string"
      ? body.featureMatrixPath.trim()
      : undefined;
  const standardsRoot =
    typeof body.standardsRoot === "string" ? body.standardsRoot : undefined;
  const repoUrl =
    typeof body.repoUrl === "string" ? body.repoUrl : undefined;
  const description =
    typeof body.description === "string" ? body.description : undefined;

  const updated = updateProjectDb(db, id, {
    name,
    adapterType,
    sandboxPath,
    standardsRoot,
    featureMatrixPath,
    repoUrl,
    description,
  });

  // 覆写 helmcode.yaml
  const manifestPath = project.manifestPath;
  try {
    const existing: Manifest = loadManifest(manifestPath);
    const merged: Record<string, string> = {
      name: name ?? existing.name,
      sandboxPath: sandboxPath ?? existing.sandboxPath,
      adapterType: adapterType ?? existing.adapterType,
      featureMatrixPath: featureMatrixPath ?? existing.featureMatrixPath,
    };
    const std = standardsRoot !== undefined ? standardsRoot : existing.standardsRoot;
    if (std) merged.standardsRoot = std;
    const ru = repoUrl !== undefined ? repoUrl : existing.repoUrl;
    if (ru) merged.repoUrl = ru;
    const desc = description !== undefined ? description : existing.description;
    if (desc) merged.description = desc;

    writeFileSync(manifestPath, stringifyYaml(merged), "utf-8");
  } catch {
    console.warn(`Failed to update manifest: ${manifestPath}`);
  }

  return NextResponse.json({ project: updated });
}

// ---------------------------------------------------------------------------
// DELETE /api/projects/[id] — 注销项目(软删除)
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  if (id === "mycmdeliverhub") {
    return NextResponse.json(
      { error: "默认项目不可注销" },
      { status: 400 },
    );
  }

  const db = getDb();
  const project = getProjectById(db, id);
  if (!project || project.status !== "active") {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const deactivated = softDeleteProject(db, id);

  return NextResponse.json({
    project: {
      id: deactivated.id,
      status: deactivated.status,
    },
  });
}
