/**
 * 同步编排 — scan → match → 记录结果(planSync) / 写状态(applySync)。
 *
 * applySync 复用 analyze-status/apply 的降级重置语义:
 *   当 cell 从「已支持」降到「需改造/待实现」时,agentStatus 重置为 not-started。
 * (因本包不依赖 portal,降级判定逻辑在此内联,保持与 apps/portal/.../apply 一致。)
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type DB,
  type ContractStatus,
  createContract,
  getCellRow,
  getLatestContract,
  updateCellAgentStatus,
  updateFeatureScenarioStatus,
  upsertContractSyncResult,
} from "@helmflow/storage";
import { matchContractsToMatrix } from "./match";
import { scanHelmcodeContracts } from "./scan";
import { mapHelmcodeStatusToScenario } from "./status-map";
import type {
  ApplyReport,
  HelmcodeContractMeta,
  HelmcodeStatus,
  ManualMapping,
  MatchResult,
  MatrixFeature,
  ScenarioStatus,
  SyncPlan,
  SyncPlanChange,
} from "./types";

const DOWNGRADE_TARGETS = new Set<ScenarioStatus>(["需改造", "待实现"]);

/** HelmCode status → contracts 表 ContractStatus(英文枚举,子集直接对应) */
const HELMCODE_TO_CONTRACT_STATUS: Record<HelmcodeStatus, ContractStatus> = {
  draft: "draft",
  approved: "approved",
  "goal-running": "goal-running",
  done: "done",
};

/**
 * 把一份 HelmCode 契约正文 import 进 contracts 表(幂等)。
 * 仅当目标 cell 存在且内容变化时新增一行;markdownPath/originPath 存目标项目绝对路径。
 */
export function importContractIfNeeded(
  db: DB,
  projectId: string,
  cellId: string,
  meta: HelmcodeContractMeta,
): void {
  // cell 必须存在(contracts.cellId 有 FK)
  if (!getCellRow(db, cellId)) return;

  let content: string;
  let hash: string;
  try {
    content = readFileSync(meta.filePath, "utf-8");
    hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch {
    return; // 读失败静默跳过
  }

  // 幂等:同 cell 最新契约若来源相同且内容未变则跳过
  const latest = getLatestContract(db, cellId);
  if (latest && latest.originPath === meta.filePath && latest.contentHash === hash) {
    return;
  }

  createContract(db, {
    cellId,
    status: HELMCODE_TO_CONTRACT_STATUS[meta.status],
    markdownPath: meta.filePath,
    contentHash: hash,
    source: "helmcode-import",
    projectId,
    originPath: meta.filePath,
  });
}

export interface PlanSyncArgs {
  db: DB;
  projectId: string;
  sandboxPath: string;
  features: MatrixFeature[];
  manualMap: ManualMapping;
}

/**
 * 扫描 + 匹配 + 写 contract_sync_results(不写 scenarioStatus)。
 * 高置信 matched 不在此 apply —— 由调用方决定是否 applySync。
 * 返回 SyncPlan 供 API 层决定后续动作。
 */
export function planSync(args: PlanSyncArgs): SyncPlan {
  const { db, projectId, features, manualMap } = args;
  const scannedAt = new Date().toISOString();

  const report = scanHelmcodeContracts({ sandboxPath: args.sandboxPath });
  const matchResults = matchContractsToMatrix({
    metas: report.metas,
    features,
    manualMap,
  });

  // 写 contract_sync_results(每个契约一行,幂等 upsert)+ 正文 import(matched/pending)
  for (const r of matchResults) {
    upsertContractSyncResult(db, {
      projectId,
      contractFeatureId: r.contractFeatureId,
      state: r.state,
      confidence: r.confidence,
      chosenCellId: r.chosen?.cellId ?? null,
      mappedFeatureId: r.chosen?.featureId ?? null,
      mappedScenarioName: r.chosen?.scenarioName ?? null,
      helmcodeStatus: r.meta.status,
      targetScenarioStatus: mapHelmcodeStatusToScenario(r.meta.status),
      candidatesJson: JSON.stringify(r.candidates),
      reasonsJson: JSON.stringify(r.chosen?.reasons ?? []),
      scannedAt,
    });

    // matched/pending 且有命中 cell → 把契约正文 import 进 contracts 表(详情页可见)
    if ((r.state === "matched" || r.state === "pending") && r.chosen?.cellId) {
      importContractIfNeeded(db, projectId, r.chosen.cellId, r.meta);
    }
  }

  const matched: SyncPlanChange[] = [];
  const pending: MatchResult[] = [];
  const unmatched: MatchResult[] = [];

  for (const r of matchResults) {
    if (r.state === "matched" && r.chosen) {
      const cellId = r.chosen.cellId;
      const existing = cellId ? getCellRow(db, cellId) : undefined;
      matched.push({
        cellId,
        featureId: r.chosen.featureId,
        scenarioName: r.chosen.scenarioName,
        from: (existing?.scenarioStatus as ScenarioStatus) ?? "待实现",
        to: mapHelmcodeStatusToScenario(r.meta.status),
        confidence: r.confidence,
        helmcodeStatus: r.meta.status,
      });
    } else if (r.state === "pending") {
      pending.push(r);
    } else {
      unmatched.push(r);
    }
  }

  return { matched, pending, unmatched, scannedAt };
}

/**
 * 把一批 cell 的 scenarioStatus 写回 DB。
 * 仅写入 matched(已确认)的;调用方负责传入选定的 cellId 列表。
 * 复用降级重置语义:从「已支持」降到「需改造/待实现」时重置 agentStatus。
 */
export function applySync(
  db: DB,
  changes: SyncPlanChange[],
): ApplyReport {
  const applied: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const c of changes) {
    if (!c.cellId) {
      skipped.push(c.featureId);
      continue;
    }
    try {
      const cell = getCellRow(db, c.cellId);
      if (!cell) {
        skipped.push(c.cellId);
        continue;
      }
      updateFeatureScenarioStatus(db, c.featureId, c.scenarioName, c.to);

      // 降级重置:已支持 → 需改造/待实现 时,agentStatus 回到 not-started
      if (cell.scenarioStatus === "已支持" && DOWNGRADE_TARGETS.has(c.to)) {
        updateCellAgentStatus(db, c.cellId, "not-started");
      }
      applied.push(c.cellId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${c.cellId}: ${msg}`);
    }
  }

  return { applied, skipped, errors: errors.length > 0 ? errors : [] };
}

/** 把单个 pending 结果(人工指认后)转为 SyncPlanChange */
export function buildManualChange(
  meta: { status: import("./types").HelmcodeStatus; featureId: string },
  targetFeatureId: string,
  targetScenarioName: string,
): SyncPlanChange {
  return {
    cellId: `${targetFeatureId}__${targetScenarioName}`,
    featureId: targetFeatureId,
    scenarioName: targetScenarioName,
    from: "待实现",
    to: mapHelmcodeStatusToScenario(meta.status),
    confidence: 1.0,
    helmcodeStatus: meta.status,
  };
}

export type { HelmcodeContractMeta };
