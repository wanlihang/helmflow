import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { features, featureScenarios, cellId as makeCellId, listFeatureScenarios } from "@helmflow/storage";
import { getProject } from "@helmflow/manifest-loader";
import { getDb } from "./db";
import { syncMatrixToDb } from "./sync-matrix";

export interface Legacy {
  flowCode: string;
  activities: string[];
}

export interface Target {
  handler: string;
  actions: string[];
  context: string;
}

export type FeatureStatus =
  | "not-started"
  | "clarifying"
  | "pending-goal"
  | "implementing"
  | "tests-pending"
  | "qa-passed"
  | "done"
  | "blocked"
  | "abandoned";

export type FeaturePriority = "P0" | "P1" | "P2";

export type ScenarioStatus = "已支持" | "需改造" | "待实现" | "废弃";

export interface Scenario {
  name: string;
  status: ScenarioStatus;
  agentStatus: FeatureStatus;
  note: string;
}

export interface Feature {
  id: string;
  name: string;
  legacy: Legacy;
  target: Target;
  priority: FeaturePriority;
  scenarios: Scenario[];
}

export interface Domain {
  id: string;
  name: string;
  features: Feature[];
}

export interface FeatureMatrix {
  project: string;
  sandboxPath?: string;
  description?: string;
  schemaVersion: number;
  domains: Domain[];
}

export interface Cell {
  feature: Feature;
  scenario: Scenario;
  cellId: string;
}

const FEATURE_STATUSES: readonly FeatureStatus[] = [
  "not-started",
  "clarifying",
  "pending-goal",
  "implementing",
  "tests-pending",
  "qa-passed",
  "done",
  "blocked",
  "abandoned",
];

function isFeatureStatus(s: string): s is FeatureStatus {
  return (FEATURE_STATUSES as readonly string[]).includes(s);
}

/** 安全解析 JSON string,失败返回 fallback */
function safeJsonParse<T>(str: string, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

const DEFAULT_MATRIX_PATH = join(process.cwd(), "data", "feature-matrix.yaml");

interface RawYamlDomain {
  id: string;
  name: string;
}

interface RawYamlMatrix {
  project: string;
  description?: string;
  schemaVersion?: number;
  domains: RawYamlDomain[];
}

/** 读取 YAML 获取 description / sandboxPath / domain names / schemaVersion (仅作为元数据补充) */
function loadYamlMeta(projectId?: string): {
  description?: string;
  sandboxPath?: string;
  schemaVersion: number;
  domainNameMap: Map<string, string>;
  project: string;
} {
  let matrixPath = DEFAULT_MATRIX_PATH;
  let sandboxPath: string | undefined;
  if (projectId) {
    try {
      const project = getProject(projectId);
      if (project) {
        const monorepoRoot = resolve(process.cwd(), "..", "..");
        matrixPath = resolve(monorepoRoot, project.manifest.featureMatrixPath);
        sandboxPath = project.manifest.sandboxPath;
      }
    } catch { /* fallback */ }
  }
  try {
    const rawText = readFileSync(matrixPath, "utf-8");
    const raw = parse(rawText) as RawYamlMatrix;
    const domainNameMap = new Map<string, string>();
    for (const d of raw.domains ?? []) {
      domainNameMap.set(d.id, d.name);
    }
    return {
      description: raw.description,
      sandboxPath,
      schemaVersion: raw.schemaVersion ?? 2,
      domainNameMap,
      project: raw.project,
    };
  } catch {
    return { schemaVersion: 2, domainNameMap: new Map(), project: projectId ?? "mycmdeliverhub" };
  }
}

/**
 * 从 DB 构建 FeatureMatrix。
 * 先调用 syncMatrixToDb 确保 YAML 已 seed 到 DB,
 * 然后纯从 DB 的 features + feature_scenarios 表构建完整结构。
 */
export function loadMatrix(projectId?: string): FeatureMatrix {
  // 确保 YAML 数据已 seed 到 DB
  syncMatrixToDb(projectId);

  const db = getDb();

  // 读出所有 feature 行(排除 archived)
  const allFeatureRows = db.select().from(features).all();
  const effectiveProjectId = projectId ?? "mycmdeliverhub";
  const featureRows = allFeatureRows.filter(
    (r) => r.projectId === effectiveProjectId && r.status !== "archived",
  );

  // 按 domain 分组,保持 domain 出现顺序
  const domainOrder: string[] = [];
  const domainFeatureMap = new Map<string, Feature[]>();
  for (const row of featureRows) {
    if (!domainFeatureMap.has(row.domain)) {
      domainOrder.push(row.domain);
      domainFeatureMap.set(row.domain, []);
    }
    const f: Feature = {
      id: row.id,
      name: row.name,
      legacy: {
        flowCode: row.legacyFlowCode ?? "",
        activities: safeJsonParse<string[]>(row.legacyActivities ?? "", []),
      },
      target: {
        handler: row.handler ?? "",
        actions: safeJsonParse<string[]>(row.actions ?? "", []),
        context: row.context ?? "",
      },
      priority: (row.priority as FeaturePriority) || "P2",
      scenarios: [],
    };

    // 查询该 feature 的所有场景(排除 archived)
    const scenarioRows = listFeatureScenarios(db, row.id).filter((sr) => !sr.archived);
    f.scenarios = scenarioRows.map((sr) => ({
      name: sr.scenarioName,
      status: sr.scenarioStatus as ScenarioStatus,
      agentStatus: isFeatureStatus(sr.agentStatus) ? sr.agentStatus : "not-started",
      note: sr.note,
    }));

    domainFeatureMap.get(row.domain)!.push(f);
  }

  // 从 YAML 获取 domain names 和 description
  const meta = loadYamlMeta(projectId);
  const domains: Domain[] = domainOrder.map((domainId) => ({
    id: domainId,
    name: meta.domainNameMap.get(domainId) ?? domainId,
    features: domainFeatureMap.get(domainId) ?? [],
  }));

  return {
    project: effectiveProjectId,
    sandboxPath: meta.sandboxPath,
    description: meta.description,
    schemaVersion: meta.schemaVersion,
    domains,
  };
}

export function getFeature(id: string, projectId?: string): Feature | undefined {
  const matrix = loadMatrix(projectId);
  for (const domain of matrix.domains) {
    const found = domain.features.find((f) => f.id === id);
    if (found) return found;
  }
  return undefined;
}

export function getCell(featureId: string, scenarioName: string, projectId?: string): Cell | undefined {
  const feature = getFeature(featureId, projectId);
  if (!feature) return undefined;
  const scenario = feature.scenarios.find((s) => s.name === scenarioName);
  if (!scenario) return undefined;
  return { feature, scenario, cellId: makeCellId(featureId, scenarioName) };
}

export function getDomainOfFeature(id: string, projectId?: string): Domain | undefined {
  const matrix = loadMatrix(projectId);
  return matrix.domains.find((d) => d.features.some((f) => f.id === id));
}

export function getTotalFeatureCount(projectId?: string): number {
  syncMatrixToDb(projectId);
  const db = getDb();
  const effectiveProjectId = projectId ?? "mycmdeliverhub";
  return db
    .select()
    .from(features)
    .all()
    .filter((r) => r.projectId === effectiveProjectId && r.status !== "archived")
    .length;
}

export function getAllScenarioNames(projectId?: string): string[] {
  syncMatrixToDb(projectId);
  const db = getDb();
  const effectiveProjectId = projectId ?? "mycmdeliverhub";
  const featureRows = db
    .select()
    .from(features)
    .all()
    .filter((r) => r.projectId === effectiveProjectId && r.status !== "archived");

  const names = new Set<string>();
  for (const fr of featureRows) {
    const scenarioRows = listFeatureScenarios(db, fr.id).filter((sr) => !sr.archived);
    for (const sr of scenarioRows) {
      names.add(sr.scenarioName);
    }
  }
  return Array.from(names);
}
