import { cookies } from "next/headers";
import {
  listProjects,
  getDefaultProjectId,
} from "@helmflow/manifest-loader";
import { getDb } from "@/lib/db";
import {
  listProjectsDb,
  createProject,
  getProjectById,
  reactivateProject,
} from "@helmflow/storage";

const COOKIE_NAME = "helmflow_project";

/**
 * 将文件系统中有 manifest 但尚未注册到 DB 的项目自动注册到 DB。
 * 以 DB 为唯一数据源，文件系统仅为引导来源。
 */
export function syncFilesystemProjects(): void {
  const db = getDb();
  const existing = listProjectsDb(db);
  const existingIds = new Set(existing.map((p) => p.id));

  const fsProjects = listProjects();
  for (const p of fsProjects) {
    if (existingIds.has(p.id)) continue;

    // 检查是否有 inactive 记录，可以重新激活
    const existingRow = getProjectById(db, p.id);
    if (existingRow) {
      if (existingRow.status !== "active") {
        reactivateProject(db, p.id);
      }
      continue;
    }

    // 全新注册
    createProject(db, {
      id: p.id,
      name: p.manifest.name,
      adapterType: p.manifest.adapterType,
      sandboxPath: p.manifest.sandboxPath,
      standardsRoot: p.manifest.standardsRoot ?? null,
      featureMatrixPath: p.manifest.featureMatrixPath,
      repoUrl: p.manifest.repoUrl ?? null,
      description: p.manifest.description ?? null,
      manifestPath: p.manifestPath,
    });
  }
}

export async function getCurrentProjectId(): Promise<string> {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(COOKIE_NAME);
    if (cookie?.value) {
      // 确保 DB 中有完整项目列表
      syncFilesystemProjects();

      const db = getDb();
      const activeProjects = listProjectsDb(db);
      if (activeProjects.some((p) => p.id === cookie.value)) {
        return cookie.value;
      }
    }
  } catch {
    // cookies() may fail in some contexts
  }
  return getDefaultProjectId();
}

export function getProjectList(): Array<{ id: string; name: string }> {
  // 先同步文件系统项目到 DB，确保 DB 是完整的
  try {
    syncFilesystemProjects();
  } catch {
    // 同步失败不应阻塞列表展示
  }

  // 从 DB 读取（唯一数据源）
  try {
    const db = getDb();
    const activeProjects = listProjectsDb(db);
    if (activeProjects.length > 0) {
      return activeProjects.map((p) => ({ id: p.id, name: p.name }));
    }
  } catch {
    // DB 不可用
  }

  // 兜底
  return [{ id: "mycmdeliverhub", name: "mycmdeliverhub" }];
}
