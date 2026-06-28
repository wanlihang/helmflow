import { getProject } from "@helmflow/manifest-loader";
import {
  featureScenarios,
  features,
  listFeatureScenarios,
  cellId as makeCellId,
} from "@helmflow/storage";
import { getDb } from "./db";

/**
 * 分层架构归属(implementation) — 功能点在 DDD 四层结构(Decider/Acceptor/Handler/Action)里的位置。
 * 由分析产出(analyze 扫码识别 / require 分层分析 / analyze-structure 推断),非 matrix.yaml 预设。
 * 新需求澄清后才产出;存量代码扫码识别;未分析时各字段为空。
 */
export interface Implementation {
  decider: string; // 决策层(走哪个分支)
  acceptor: string; // 接收/校验层
  handler: string; // 业务编排层
  actions: string[]; // 执行步骤
  context: string; // 所属域
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

// ScenarioStatus 字符串 token 不变(133 处引用 + DB + contract-sync status_map + LLM 输出依赖);
// 语义为「开发治理状态」:已支持=已实现维护态 / 需改造=已实现待治理对齐 / 待实现=未落地 / 废弃=下线。
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
  description: string;
  implementation: Implementation;
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

// 域名称内置映射(yaml 退役后,domain 中文名从这取;未知域用 id 本身)
const DOMAIN_NAMES: Record<string, string> = {
  deliver: "交付管理",
  mapping: "产品映射",
  pricing: "价格配置",
  signing: "签约",
  product: "产品映射管理",
  ops: "运维",
  shared: "共享",
};

/**
 * 从 manifest 读项目元信息(yaml 退役后不再读 yaml)。
 */
function loadProjectMeta(projectId?: string): {
  description?: string;
  sandboxPath?: string;
  domainNameMap: Map<string, string>;
  project: string;
} {
  let sandboxPath: string | undefined;
  let description: string | undefined;
  if (projectId) {
    try {
      const project = getProject(projectId);
      if (project) {
        sandboxPath = project.manifest.sandboxPath;
        description = project.manifest.description;
      }
    } catch {
      /* fallback */
    }
  }
  return {
    description,
    sandboxPath,
    domainNameMap: new Map(Object.entries(DOMAIN_NAMES)),
    project: projectId ?? "mycmdeliverhub",
  };
}

/**
 * 从 DB 构建 FeatureMatrix(yaml 退役:纯 DB 读,不再 seed)。
 */
export function loadMatrix(projectId?: string): FeatureMatrix {
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
      description: row.description ?? "",
      implementation: {
        decider: row.decider ?? "",
        acceptor: row.acceptor ?? "",
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

  // 从 manifest 获取 domain names 和 description(yaml 退役)
  const meta = loadProjectMeta(projectId);
  const domains: Domain[] = domainOrder.map((domainId) => ({
    id: domainId,
    name: meta.domainNameMap.get(domainId) ?? domainId,
    features: domainFeatureMap.get(domainId) ?? [],
  }));

  return {
    project: effectiveProjectId,
    sandboxPath: meta.sandboxPath,
    description: meta.description,
    schemaVersion: 3,
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

export function getCell(
  featureId: string,
  scenarioName: string,
  projectId?: string,
): Cell | undefined {
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
  const db = getDb();
  const effectiveProjectId = projectId ?? "mycmdeliverhub";
  return db
    .select()
    .from(features)
    .all()
    .filter((r) => r.projectId === effectiveProjectId && r.status !== "archived").length;
}

export function getAllScenarioNames(projectId?: string): string[] {
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
