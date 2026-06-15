import { NextResponse } from "next/server";
import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, isAbsolute } from "node:path";
import { homedir } from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/fs/browse?path=... — 列出指定路径下的目录
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rawPath = url.searchParams.get("path") ?? "";

  // 默认路径：用户 home 目录
  const home = homedir();
  let absPath: string;

  if (!rawPath || rawPath === "~") {
    absPath = home;
  } else if (rawPath.startsWith("~/")) {
    absPath = join(home, rawPath.slice(2));
  } else if (isAbsolute(rawPath)) {
    absPath = resolve(rawPath);
  } else {
    absPath = resolve(home, rawPath);
  }

  if (!existsSync(absPath)) {
    return NextResponse.json(
      { error: `路径不存在: ${rawPath}`, path: absPath },
      { status: 404 },
    );
  }

  if (!statSync(absPath).isDirectory()) {
    return NextResponse.json(
      { error: `不是目录: ${rawPath}`, path: absPath },
      { status: 400 },
    );
  }

  // 列出子目录
  const entries: Array<{
    name: string;
    path: string;
    hasChildren: boolean;
    isProject: boolean;
  }> = [];

  try {
    const items = readdirSync(absPath).sort((a, b) => {
      // 目录优先，然后按名称
      const aDir = isDirectorySafe(join(absPath, a));
      const bDir = isDirectorySafe(join(absPath, b));
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b);
    });

    for (const item of items) {
      // 跳过隐藏目录（以 . 开头，但 . 和 .. 除外）
      if (item.startsWith(".")) continue;

      const fullPath = join(absPath, item);
      if (!isDirectorySafe(fullPath)) continue;

      // 检测是否像是一个可识别的项目
      const isProject =
        isJavaProject(fullPath) ||
        isNodeProject(fullPath) ||
        isGitRepo(fullPath);

      // 检测是否有子目录（用于显示展开箭头）
      let hasChildren = false;
      try {
        hasChildren = readdirSync(fullPath).some(
          (child) => !child.startsWith(".") && isDirectorySafe(join(fullPath, child)),
        );
      } catch {
        // permission denied etc
      }

      entries.push({
        name: item,
        path: fullPath,
        hasChildren,
        isProject,
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: `无法读取目录: ${(err as Error).message}`, path: absPath },
      { status: 403 },
    );
  }

  // 常用快捷路径
  const shortcuts: Array<{ label: string; path: string }> = [];
  shortcuts.push({ label: "🏠 Home", path: home });
  shortcuts.push({ label: "📁 Desktop", path: join(home, "Desktop") });
  shortcuts.push({ label: "📁 Documents", path: join(home, "Documents") });
  shortcuts.push({ label: "📁 Downloads", path: join(home, "Downloads") });

  // 检测 IdeaProjects 目录
  const ideaPath = join(home, "IdeaProjects");
  if (existsSync(ideaPath) && statSync(ideaPath).isDirectory()) {
    shortcuts.push({ label: "💡 IdeaProjects", path: ideaPath });
  }
  // 检测 Projects 目录
  const projectsPath = join(home, "Projects");
  if (existsSync(projectsPath) && statSync(projectsPath).isDirectory()) {
    shortcuts.push({ label: "📁 Projects", path: projectsPath });
  }
  // 检测 workspace 目录
  const wsPath = join(home, "workspace");
  if (existsSync(wsPath) && statSync(wsPath).isDirectory()) {
    shortcuts.push({ label: "📁 workspace", path: wsPath });
  }

  return NextResponse.json({
    currentPath: absPath,
    parentPath: absPath === "/" ? null : resolve(absPath, ".."),
    entries,
    shortcuts,
  });
}

function isDirectorySafe(fullPath: string): boolean {
  try {
    return statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

function isJavaProject(dir: string): boolean {
  return (
    existsSync(join(dir, "pom.xml")) ||
    existsSync(join(dir, "build.gradle")) ||
    existsSync(join(dir, "build.gradle.kts"))
  );
}

function isNodeProject(dir: string): boolean {
  return existsSync(join(dir, "package.json"));
}

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}
