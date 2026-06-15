import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const ManifestSchema = z.object({
  name: z.string().min(1),
  sandboxPath: z.string().min(1),
  adapterType: z.enum(["java-ddd", "node-express"]),
  standardsRoot: z.string().optional(),
  featureMatrixPath: z.string().min(1),
  repoUrl: z.string().optional(),
  description: z.string().optional(),
  helmcode: z
    .object({
      /** HelmCode 仓库路径,相对于 helmcode.yaml 所在目录 */
      path: z.string().min(1),
    })
    .optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export interface ProjectInfo {
  id: string;
  manifest: Manifest;
  manifestPath: string;
  /** 解析后的 HelmCode 仓库绝对路径(仅当 manifest.helmcode.path 存在时) */
  helmcodeRoot?: string;
}

const MANIFEST_FILENAME = "helmcode.yaml";

function resolveProjectsRoot(): string {
  const env = process.env.HELMFLOW_PROJECTS_ROOT;
  if (env && env.length > 0) return resolve(env);
  return resolve(process.cwd(), "..", "..", "projects");
}

/**
 * 解析 HelmCode 仓库绝对路径。
 * manifest.helmcode.path 是相对路径,基于 helmcode.yaml 所在目录。
 */
export function resolveHelmcodeRoot(projectInfo: ProjectInfo): string | undefined {
  if (!projectInfo.manifest.helmcode?.path) return undefined;
  const manifestDir = resolve(projectInfo.manifestPath, "..");
  return resolve(manifestDir, projectInfo.manifest.helmcode.path);
}

export function loadManifest(manifestPath: string): Manifest {
  const raw = readFileSync(manifestPath, "utf-8");
  const parsed = parseYaml(raw);
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map(
      (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
    );
    throw new Error(`Invalid helmcode.yaml: ${errors.join("; ")}`);
  }
  return result.data;
}

export function listProjects(): ProjectInfo[] {
  const root = resolveProjectsRoot();
  if (!existsSync(root)) return [];

  const entries = readdirSync(root);
  const projects: ProjectInfo[] = [];

  for (const entry of entries) {
    const dir = join(root, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const manifestPath = join(dir, MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) continue;

    try {
      const manifest = loadManifest(manifestPath);
      const info: ProjectInfo = {
        id: entry,
        manifest,
        manifestPath,
      };
      // 解析 HelmCode 路径
      const helmcodeRoot = resolveHelmcodeRoot(info);
      if (helmcodeRoot) info.helmcodeRoot = helmcodeRoot;
      projects.push(info);
    } catch (err) {
      console.warn(`[manifest-loader] Skipping ${entry}:`, err);
    }
  }

  return projects;
}

export function getProject(projectId: string): ProjectInfo | undefined {
  return listProjects().find((p) => p.id === projectId);
}

const DEFAULT_PROJECT_ID = "mycmdeliverhub";

export function getDefaultProjectId(): string {
  const projects = listProjects();
  if (projects.length === 0) return DEFAULT_PROJECT_ID;
  const defaultProject = projects.find((p) => p.id === DEFAULT_PROJECT_ID);
  return defaultProject ? DEFAULT_PROJECT_ID : projects[0]!.id;
}

// ---------------------------------------------------------------------------
// createManifest — 注册新项目:创建目录 + 写入 helmcode.yaml
// ---------------------------------------------------------------------------
export interface CreateManifestInput {
  name: string;
  sandboxPath: string;
  adapterType: "java-ddd" | "node-express";
  standardsRoot?: string;
  featureMatrixPath: string;
  repoUrl?: string;
  description?: string;
  helmcode?: { path: string };
}

const PROJECT_ID_RE = /^[a-zA-Z0-9_\-]+$/;

function validateProjectId(projectId: string): void {
  if (!PROJECT_ID_RE.test(projectId)) {
    throw new Error(
      `Invalid projectId "${projectId}": must be alphanumeric, hyphens, or underscores only`,
    );
  }
}

export function createManifest(
  projectId: string,
  input: CreateManifestInput,
): string {
  validateProjectId(projectId);
  const root = resolveProjectsRoot();
  const dir = join(root, projectId);
  mkdirSync(dir, { recursive: true });

  const manifestPath = join(dir, MANIFEST_FILENAME);
  // 已存在时覆写(支持 inactive 项目重新激活)

  // 只写入 ManifestSchema 已知字段,忽略 undefined
  const yamlObj: Record<string, unknown> = {
    name: input.name,
    sandboxPath: input.sandboxPath,
    adapterType: input.adapterType,
    featureMatrixPath: input.featureMatrixPath,
  };
  if (input.standardsRoot) yamlObj.standardsRoot = input.standardsRoot;
  if (input.repoUrl) yamlObj.repoUrl = input.repoUrl;
  if (input.description) yamlObj.description = input.description;
  if (input.helmcode) yamlObj.helmcode = input.helmcode;

  writeFileSync(manifestPath, stringifyYaml(yamlObj), "utf-8");
  return manifestPath;
}

// ---------------------------------------------------------------------------
// deleteManifest — 删除项目清单目录
// ---------------------------------------------------------------------------
export function deleteManifest(projectId: string): void {
  validateProjectId(projectId);
  const root = resolveProjectsRoot();
  const dir = join(root, projectId);
  const resolved = resolve(dir);
  if (!resolved.startsWith(resolve(root))) {
    throw new Error(`deleteManifest: path escapes projects root`);
  }
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
