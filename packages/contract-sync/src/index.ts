/**
 * @helmflow/contract-sync — 契约状态同步引擎(控制平面回归第一刀)
 *
 * 从目标项目 .claude/contracts/ 扫描 HelmCode 直开产出的契约,匹配到 HelmFlow matrix
 * cell,把契约 status 反向同步为 cell 的 scenarioStatus。纯逻辑库,DB 通过注入。
 */

export { parseHelmcodeContract, parseRegistry } from "./parse";
export { scanHelmcodeContracts } from "./scan";
export { mapHelmcodeStatusToScenario } from "./status-map";
export { matchContractsToMatrix } from "./match";
export { planSync, applySync, buildManualChange, importContractIfNeeded } from "./sync";
export type { PlanSyncArgs } from "./sync";
export { buildLlmMatchPrompt, parseLlmMatchResult } from "./llm-match";
export type { LlmMatchOutcome } from "./llm-match";
export type {
  HelmcodeStatus,
  ScenarioStatus,
  MatchState,
  MatrixFeature,
  HelmcodeContractMeta,
  RegistryRow,
  ParseHelmcodeResult,
  ScanOptions,
  ScanReport,
  ScanParseFailure,
  CellCandidate,
  MatchResult,
  ManualMapping,
  MatchInputs,
  SyncPlanChange,
  SyncPlan,
  ApplyReport,
} from "./types";
