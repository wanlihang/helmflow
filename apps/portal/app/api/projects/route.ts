import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { getDb } from "@/lib/db";
import { syncFilesystemProjects } from "@/lib/project";
import { type CreateManifestInput, createManifest, listProjects } from "@helmflow/manifest-loader";
import {
  countFeaturesByProject,
  createProject,
  getProjectById,
  listProjectsDb,
  reactivateProject,
  updateProject,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 相对路径的基准目录：sandboxPath 支持绝对路径(任意位置)和相对路径(基于 monorepo root) */
const MONOREPO_ROOT = resolve(process.cwd(), "..", "..");

const ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * 递归搜索目录树中是否存在 src/main/java, 最多搜 maxDepth 层。
 * 匹配: src/main/java, {asterisk}/src/main/java, {asterisk}/{asterisk}/src/main/java 等
 */
function hasJavaSrc(dir: string, maxDepth: number): boolean {
  if (existsSync(resolve(dir, "src", "main", "java"))) return true;
  if (maxDepth <= 0) return false;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
      if (hasJavaSrc(resolve(dir, entry.name), maxDepth - 1)) return true;
    }
  } catch {
    // permission denied etc
  }
  return false;
}

// ---------------------------------------------------------------------------
// POST /api/projects — 注册新项目
// ---------------------------------------------------------------------------
export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const adapterType = typeof body.adapterType === "string" ? body.adapterType : "";
  const sandboxPath = typeof body.sandboxPath === "string" ? body.sandboxPath.trim() : "";

  if (!id || !ID_RE.test(id) || id.length < 2 || id.length > 64) {
    return NextResponse.json(
      { error: "项目 ID 格式错误:仅限小写字母、数字、连字符,2-64 字符" },
      { status: 400 },
    );
  }
  if (!name || name.length > 200) {
    return NextResponse.json({ error: "项目名称不能为空,且不超过 200 字符" }, { status: 400 });
  }
  const VALID_ADAPTERS = ["java-ddd", "node-express"];
  if (!VALID_ADAPTERS.includes(adapterType)) {
    return NextResponse.json(
      { error: `adapterType 必须是: ${VALID_ADAPTERS.join(" / ")}` },
      { status: 400 },
    );
  }
  if (!sandboxPath) {
    return NextResponse.json({ error: "项目路径不能为空" }, { status: 400 });
  }

  // 支持绝对路径(任意位置)和相对路径(基于 monorepo root)
  const absSandboxPath = isAbsolute(sandboxPath)
    ? resolve(sandboxPath)
    : resolve(MONOREPO_ROOT, sandboxPath);
  if (!existsSync(absSandboxPath) || !statSync(absSandboxPath).isDirectory()) {
    return NextResponse.json(
      { error: `项目路径不存在或不是目录: ${sandboxPath}` },
      { status: 400 },
    );
  }

  // 对于 java-ddd 适配器, 验证是否包含 Java 源码
  // 支持三种结构:
  //   单模块: src/main/java
  //   多模块一层: <module>/src/main/java
  //   多模块两层: app/<module>/src/main/java (如 DDD 分层)
  if (adapterType === "java-ddd") {
    const hasSrc = hasJavaSrc(absSandboxPath, 3);
    if (!hasSrc) {
      return NextResponse.json(
        { error: `未找到 Java 源码 (src/main/java)。请确认路径指向 Maven 项目根目录` },
        { status: 400 },
      );
    }
  }

  // yaml 退役:featureMatrixPath 不再强制(留空默认,DB 唯一数据源)
  const featureMatrixPath =
    typeof body.featureMatrixPath === "string" && body.featureMatrixPath.trim()
      ? body.featureMatrixPath.trim()
      : "";

  // 唯一性:DB active 或 文件系统存在(且非 inactive 重激活场景)
  const db = getDb();
  const existingDb = getProjectById(db, id);
  if (existingDb && existingDb.status === "active") {
    return NextResponse.json({ error: "项目 ID 已存在" }, { status: 409 });
  }
  // 仅当 DB 无记录时才检查文件系统(inactive 重激活时文件可能仍在)
  if (!existingDb) {
    const fileProjects = listProjects();
    if (fileProjects.some((p) => p.id === id)) {
      return NextResponse.json({ error: "项目 ID 已存在" }, { status: 409 });
    }
  }

  // 写 helmcode.yaml
  const manifestInput: CreateManifestInput = {
    name,
    sandboxPath,
    adapterType: adapterType as "java-ddd" | "node-express",
    featureMatrixPath,
    standardsRoot: typeof body.standardsRoot === "string" ? body.standardsRoot : undefined,
    repoUrl: typeof body.repoUrl === "string" ? body.repoUrl : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
  };

  let manifestPath: string;
  try {
    manifestPath = createManifest(id, manifestInput);
  } catch (err) {
    return NextResponse.json({ error: `写入清单失败: ${(err as Error).message}` }, { status: 500 });
  }

  // 创建空 feature matrix
  if (featureMatrixPath === `projects/${id}/feature-matrix.yaml`) {
    const absMatrix = resolve(MONOREPO_ROOT, featureMatrixPath);
    if (!existsSync(absMatrix)) {
      mkdirSync(dirname(absMatrix), { recursive: true });
      writeFileSync(absMatrix, `project: ${id}\ndomains: []\n`, "utf-8");
    }
  }

  // 写 DB:如果已有 inactive 记录则重新激活,否则新建
  let project;
  if (existingDb && existingDb.status === "inactive") {
    updateProject(db, id, {
      name,
      adapterType,
      sandboxPath,
      standardsRoot: manifestInput.standardsRoot ?? null,
      featureMatrixPath,
      repoUrl: manifestInput.repoUrl ?? null,
      description: manifestInput.description ?? null,
    });
    project = reactivateProject(db, id);
  } else {
    project = createProject(db, {
      id,
      name,
      adapterType,
      sandboxPath,
      standardsRoot: manifestInput.standardsRoot ?? null,
      featureMatrixPath,
      repoUrl: manifestInput.repoUrl ?? null,
      description: manifestInput.description ?? null,
      manifestPath,
    });
  }

  return NextResponse.json({ project }, { status: 201 });
}

// ---------------------------------------------------------------------------
// GET /api/projects — 列出活跃项目
// ---------------------------------------------------------------------------
export async function GET(): Promise<Response> {
  // 确保 DB 中有完整项目列表
  try {
    syncFilesystemProjects();
  } catch {
    // 同步失败不应阻塞
  }

  const db = getDb();
  const activeProjects = listProjectsDb(db);

  const result = activeProjects.map((p) => ({
    id: p.id,
    name: p.name,
    adapterType: p.adapterType,
    featureCount: countFeaturesByProject(db, p.id),
    registeredAt: p.registeredAt.toISOString(),
  }));

  return NextResponse.json({ projects: result });
}
