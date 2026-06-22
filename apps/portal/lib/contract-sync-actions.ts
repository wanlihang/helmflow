/**
 * 契约同步 — portal 侧薄封装。
 * 把 portal 的 Feature/Scenario 投影成 contract-sync 的 MatrixFeature,
 * 注入 getDb + sandboxPath + 人工映射表,供 API route 调用。
 */

import { type Feature, loadMatrix } from "@/lib/matrix";
import { runClassify } from "@helmflow/agent-runner";
import {
  type ManualMapping,
  type MatrixFeature,
  type SyncPlan,
  type SyncPlanChange,
  type ScenarioStatus as SyncScenarioStatus,
  applySync,
  buildLlmMatchPrompt,
  buildManualChange,
  importContractIfNeeded,
  mapHelmcodeStatusToScenario,
  parseLlmMatchResult,
  planSync,
} from "@helmflow/contract-sync";
import {
  type DB,
  createRun,
  ensureVirtualCell,
  listContractCellMappings,
  listSyncResultsByState,
  markSyncResultMatched,
  updateRun,
  upsertContractCellMapping,
  upsertContractSyncResult,
} from "@helmflow/storage";

const LLM_MATCH_THRESHOLD = 0.6;

function toMatrixFeatures(features: Feature[]): MatrixFeature[] {
  return features.map((f) => ({
    id: f.id,
    name: f.name,
    domain: f.implementation.context || "",
    handler: f.implementation.handler,
    actions: f.implementation.actions,
    scenarios: f.scenarios.map((s) => ({
      name: s.name,
      status: s.status as SyncScenarioStatus,
    })),
  }));
}

function loadManualMap(db: DB, projectId: string): ManualMapping {
  const map: ManualMapping = {};
  for (const m of listContractCellMappings(db, projectId)) {
    map[m.contractFeatureId] = {
      featureId: m.featureId,
      scenarioName: m.scenarioName,
    };
  }
  return map;
}

export interface RunScanArgs {
  db: DB;
  projectId: string;
  sandboxPath: string;
}

export interface ScanOutcome {
  runId: string;
  plan: SyncPlan;
  /** 自动应用(高置信 matched)的 apply 结果 */
  autoApply: { applied: string[]; skipped: string[]; errors: string[] };
  /** LLM 辅助匹配结果(env HELMFLOW_CONTRACT_SYNC_LLM=1 时启用) */
  llm: {
    enabled: boolean;
    promoted: number;
    details: Array<{ contractFeatureId: string; cellId: string; confidence: number }>;
  };
}

/**
 * 执行一次同步扫描:建 run → planSync → 自动 apply 高置信 matched → (可选)LLM 辅助匹配 pending。
 * 保留 run 记录用于追溯(kind=contract-sync,挂在虚拟 cell 上)。
 *
 * LLM 辅助:env HELMFLOW_CONTRACT_SYNC_LLM=1 时,对 pending 契约调 runClassify 做语义匹配,
 * confidence≥阈值则升级为 matched 并 apply。减少待人工确认项。
 */
export async function runContractSyncScan(args: RunScanArgs): Promise<ScanOutcome> {
  const { db, projectId, sandboxPath } = args;
  const matrix = loadMatrix(projectId);
  const features = matrix.domains.flatMap((d) => d.features);
  const manualMap = loadManualMap(db, projectId);
  const matrixFeatures = toMatrixFeatures(features);

  const virtualCell = ensureVirtualCell(db);
  const run = createRun(db, virtualCell, "contract-sync");

  try {
    const plan = planSync({
      db,
      projectId,
      sandboxPath,
      features: matrixFeatures,
      manualMap,
    });

    // 高置信 matched 自动 apply
    let autoApply = { applied: [] as string[], skipped: [] as string[], errors: [] as string[] };
    if (plan.matched.length > 0) {
      autoApply = applySync(db, plan.matched);
    }

    // LLM 辅助匹配 pending(env 开关)
    const llmEnabled = process.env.HELMFLOW_CONTRACT_SYNC_LLM === "1";
    const llm = { enabled: llmEnabled, promoted: 0, details: [] as ScanOutcome["llm"]["details"] };

    if (llmEnabled && plan.pending.length > 0) {
      const llmChanges: SyncPlanChange[] = [];
      for (const r of plan.pending) {
        try {
          const { text } = await runClassify({
            cwd: sandboxPath,
            systemPrompt:
              "你是契约匹配助手。根据契约语义(功能含义、领域、handler)判断它对应哪个 matrix cell。只输出指定格式。",
            userPrompt: buildLlmMatchPrompt(r.meta, matrixFeatures),
          });
          const outcome = parseLlmMatchResult(text, matrixFeatures);
          if (outcome.cellId && outcome.confidence >= LLM_MATCH_THRESHOLD) {
            // 采纳 LLM 匹配,升级为 matched
            const [fid, ...sParts] = outcome.cellId.split("__");
            const scenarioName = sParts.join("__");
            if (fid && scenarioName) {
              markSyncResultMatched(
                db,
                projectId,
                r.contractFeatureId,
                outcome.cellId,
                fid,
                scenarioName,
              );
              // LLM 选的 cell 若不同于启发式 chosen,补 import 正文到新 cell(详情页可见)
              importContractIfNeeded(db, projectId, outcome.cellId, r.meta);
              llmChanges.push({
                cellId: outcome.cellId,
                featureId: fid,
                scenarioName,
                from: "待实现",
                to: mapHelmcodeStatusToScenario(r.meta.status),
                confidence: outcome.confidence,
                helmcodeStatus: r.meta.status,
              });
              llm.details.push({
                contractFeatureId: r.contractFeatureId,
                cellId: outcome.cellId,
                confidence: outcome.confidence,
              });
            }
          }
        } catch {
          // 单个契约 LLM 失败不影响其他
        }
      }
      if (llmChanges.length > 0) {
        applySync(db, llmChanges);
        llm.promoted = llmChanges.length;
      }
    }

    updateRun(db, run.id, "done");
    return { runId: run.id, plan, autoApply, llm };
  } catch (err) {
    updateRun(db, run.id, "failed");
    throw err;
  }
}

export interface ConfirmArgs {
  db: DB;
  projectId: string;
  contractFeatureId: string;
  helmcodeStatus: import("@helmflow/contract-sync").HelmcodeStatus;
  featureId: string;
  scenarioName: string;
}

/**
 * 人工指认 pending 项 → 写人工映射 + apply 该 cell + 标记 result matched。
 */
export function confirmManualMapping(args: ConfirmArgs): {
  change: SyncPlanChange;
  apply: { applied: string[]; skipped: string[]; errors: string[] };
} {
  const { db, projectId } = args;
  // 1) 写人工映射(后续扫描命中此映射,自动 matched)
  upsertContractCellMapping(db, {
    projectId,
    contractFeatureId: args.contractFeatureId,
    featureId: args.featureId,
    scenarioName: args.scenarioName,
    note: "manual-confirm",
  });

  // 2) 构造变更并 apply
  const change = buildManualChange(
    { status: args.helmcodeStatus, featureId: args.contractFeatureId },
    args.featureId,
    args.scenarioName,
  );
  const apply = applySync(db, [change]);

  // 3) 标记 contract_sync_results 为 matched
  markSyncResultMatched(
    db,
    projectId,
    args.contractFeatureId,
    change.cellId,
    args.featureId,
    args.scenarioName,
  );

  return { change, apply };
}
