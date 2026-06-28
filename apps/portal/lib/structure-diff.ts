/**
 * 结构差异计算 — 比对「新分析结果(incoming)」与「DB 现有结构(existing)」,
 * 为审阅弹窗的「保护性合并」提供逐项分类(added/preserved/conflict/stale)。
 *
 * 纯函数,不碰 DB。incoming 来自 analyzeProjectStructure,existing 来自
 * /api/projects/[id]/existing-structure。
 */

import type { StructureAnalysisResult } from "./structure-analyzer";

// ---------------------------------------------------------------------------
// existing 结构(精简,从 existing-structure API 来)
// ---------------------------------------------------------------------------

export interface ExistingScenario {
  name: string;
  status: string;
  agentStatus: string;
  note: string;
  archived: boolean;
}

export interface ExistingFeature {
  id: string;
  domain: string;
  name: string;
  handler: string;
  scenarios: Record<string, ExistingScenario>; // scenarioName -> scenario
}

export interface ExistingStructure {
  features: Record<string, ExistingFeature>; // featureId -> feature
}

// ---------------------------------------------------------------------------
// diff 类型
// ---------------------------------------------------------------------------

export type DiffKind = "added" | "preserved" | "conflict";

export interface ScenarioDiff {
  name: string;
  kind: DiffKind;
  incomingStatus?: string;
  existing?: ExistingScenario;
}

export interface FeatureDiff {
  featureId: string;
  kind: DiffKind;
  incoming: { name: string; handler: string; domain: string };
  existing?: ExistingFeature;
  scenarios: ScenarioDiff[]; // incoming 的 scenarios(逐个对照 existing)
}

export interface StaleScenario {
  featureId: string;
  scenario: ExistingScenario;
}

export interface StructureDiff {
  features: FeatureDiff[]; // incoming 每个 feature 的 diff
  staleFeatures: ExistingFeature[]; // DB 有、incoming 无(整 feature 候选归档)
  staleScenarios: StaleScenario[]; // 某 feature 下 DB 有、incoming 无的场景
  summary: {
    added: number;
    preserved: number;
    conflict: number;
    staleFeatures: number;
    staleScenarios: number;
  };
}

// ---------------------------------------------------------------------------
// 辅助:判断 scenario 是否已被治理(非默认值) — overwrite 二次确认用
// ---------------------------------------------------------------------------

export function isGoverned(s: ExistingScenario): boolean {
  return (
    s.status !== "待实现" ||
    s.agentStatus !== "not-started" ||
    (s.note?.length ?? 0) > 0
  );
}

// ---------------------------------------------------------------------------
// 核心:计算差异
// ---------------------------------------------------------------------------

export function diffStructure(
  incoming: StructureAnalysisResult,
  existing: ExistingStructure,
): StructureDiff {
  const features: FeatureDiff[] = [];
  const staleScenarios: StaleScenario[] = [];
  let added = 0;
  let preserved = 0;
  let conflict = 0;

  const incomingIds = new Set<string>();

  for (const d of incoming.domains) {
    for (const f of d.features) {
      incomingIds.add(f.id);
      const ex = existing.features[f.id];

      if (!ex) {
        // 新增 feature:所有场景都是 added
        features.push({
          featureId: f.id,
          kind: "added",
          incoming: { name: f.name, handler: f.handler, domain: d.id },
          scenarios: f.scenarios.map((s) => ({
            name: s.name,
            kind: "added" as const,
            incomingStatus: s.status,
          })),
        });
        added++;
        continue;
      }

      // feature 已存在:scenario 级逐个对照
      const scnDiffs: ScenarioDiff[] = [];
      for (const s of f.scenarios) {
        const exSc = ex.scenarios[s.name];
        if (!exSc || exSc.archived) {
          scnDiffs.push({ name: s.name, kind: "added", incomingStatus: s.status });
        } else {
          scnDiffs.push({ name: s.name, kind: "preserved", incomingStatus: s.status, existing: exSc });
        }
      }
      // 该 feature 下 stale scenarios(existing 有、incoming 无、未归档)
      for (const [scName, exSc] of Object.entries(ex.scenarios)) {
        if (exSc.archived) continue;
        if (!f.scenarios.some((s) => s.name === scName)) {
          staleScenarios.push({ featureId: f.id, scenario: exSc });
        }
      }

      // 结构冲突:name 或 handler 变了
      const structChanged = ex.name !== f.name || ex.handler !== f.handler;
      const kind: DiffKind = structChanged ? "conflict" : "preserved";
      features.push({
        featureId: f.id,
        kind,
        incoming: { name: f.name, handler: f.handler, domain: d.id },
        existing: ex,
        scenarios: scnDiffs,
      });
      if (kind === "preserved") preserved++;
      else conflict++;
    }
  }

  // stale features:DB 有、incoming 无(整 feature 候选归档)
  const staleFeatures: ExistingFeature[] = [];
  for (const [id, ex] of Object.entries(existing.features)) {
    if (!incomingIds.has(id)) staleFeatures.push(ex);
  }

  return {
    features,
    staleFeatures,
    staleScenarios,
    summary: {
      added,
      preserved,
      conflict,
      staleFeatures: staleFeatures.length,
      staleScenarios: staleScenarios.length,
    },
  };
}
