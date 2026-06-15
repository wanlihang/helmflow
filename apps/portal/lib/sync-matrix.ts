import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse } from "yaml";
import {
  upsertFeature,
  updateFeatureScenarios,
  getCellRow,
} from "@helmflow/storage";
import { getProject } from "@helmflow/manifest-loader";
import { getDb, type DB } from "./db";

const DEFAULT_MATRIX_PATH = join(process.cwd(), "data", "feature-matrix.yaml");

function resolveMatrixPath(projectId?: string): string {
  if (projectId) {
    try {
      const project = getProject(projectId);
      if (project) {
        const monorepoRoot = resolve(process.cwd(), "..", "..");
        return resolve(monorepoRoot, project.manifest.featureMatrixPath);
      }
    } catch {
      // fallback
    }
  }
  return DEFAULT_MATRIX_PATH;
}

interface RawScenario {
  name: string;
  status: string;
  note?: string;
}

interface RawTarget {
  handler?: string;
  actions?: string[];
  context?: string;
}

interface RawLegacy {
  flowCode?: string;
  activities?: string[];
}

interface RawFeature {
  id: string;
  name: string;
  legacy?: RawLegacy;
  target?: RawTarget;
  priority?: string;
  scenarios?: RawScenario[];
}

interface RawMatrix {
  project: string;
  schemaVersion?: number;
  domains: Array<{
    id: string;
    features: RawFeature[];
  }>;
}

const syncedSet = new Set<string>();

/**
 * 安全同步 scenario 到 DB。
 * 关键区别于 upsertFeatureScenario: 如果 DB 中该行已存在,
 * **不覆盖 scenarioStatus** —— 因为 apply API 可能已经更新了状态。
 * 仅在行不存在时（首次 seed）才使用 YAML 的 status。
 */
function safeSyncScenario(
  db: DB,
  featureId: string,
  scenarioName: string,
  yamlStatus: string,
  note: string,
): void {
  const { cellId } = require("@helmflow/storage") as typeof import("@helmflow/storage");
  const id = cellId(featureId, scenarioName);
  const existing = getCellRow(db, id);

  if (existing) {
    // 行已存在 — 不覆盖 scenarioStatus, 仅更新 note（如果非空）
    // 不做任何更新，保留 DB 中的当前状态
    return;
  }

  // 行不存在 — 首次 seed, 使用 YAML 值创建
  const { featureScenarios } = require("@helmflow/storage") as typeof import("@helmflow/storage");
  const now = new Date().toISOString();
  db.insert(featureScenarios)
    .values({
      id,
      featureId,
      scenarioName,
      scenarioStatus: yamlStatus,
      agentStatus: "not-started",
      note: note ?? "",
      updatedAt: now,
    })
    .run();
}

export function syncMatrixToDb(projectId?: string): void {
  const key = projectId ?? "__default__";
  if (syncedSet.has(key)) return;
  syncedSet.add(key);

  const db = getDb();
  const matrixPath = resolveMatrixPath(projectId);

  let matrix: RawMatrix;
  try {
    const raw = readFileSync(matrixPath, "utf-8");
    matrix = parse(raw) as RawMatrix;
  } catch {
    return;
  }

  const projectName = projectId ?? matrix.project;
  const domains = matrix.domains ?? [];
  for (const domain of domains) {
    for (const f of domain.features) {
      upsertFeature(db, {
        id: f.id,
        projectId: projectName,
        domain: domain.id,
        name: f.name,
        handler: f.target?.handler ?? "",
        actions: f.target?.actions ? JSON.stringify(f.target.actions) : "",
        context: f.target?.context ?? "",
        priority: f.priority ?? "",
        legacyFlowCode: f.legacy?.flowCode ?? "",
        legacyActivities: f.legacy?.activities ? JSON.stringify(f.legacy.activities) : "",
      });

      if (f.scenarios && f.scenarios.length > 0) {
        // 更新 scenarios_json 元数据列（不包含业务状态）
        updateFeatureScenarios(db, f.id, JSON.stringify(f.scenarios));
        // 安全同步 scenario 行 — 不覆盖已有的 scenarioStatus
        for (const s of f.scenarios) {
          safeSyncScenario(db, f.id, s.name, s.status, s.note ?? "");
        }
      }
    }
  }
}

export function resetMatrixSyncFlag(): void {
  syncedSet.clear();
}
