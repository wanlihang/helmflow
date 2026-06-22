/**
 * 契约状态同步引擎 — 共享类型
 *
 * 控制平面回归第一刀:从目标项目 .claude/contracts/ 扫描 HelmCode 直开产出的契约,
 * 匹配到 HelmFlow matrix cell,把契约 status 反向同步为 cell 的 scenarioStatus。
 *
 * 本包是纯逻辑库(DB 操作通过注入的 DB 类型),不依赖 Next.js / portal。
 */

import type { DB } from "@helmflow/storage";

// HelmCode 契约状态枚举(见 helmcode core/clarify/SKILL.md)
export type HelmcodeStatus = "draft" | "approved" | "goal-running" | "done";

// HelmFlow matrix 业务状态
export type ScenarioStatus = "已支持" | "需改造" | "待实现" | "废弃";

// 同步三态
export type MatchState = "matched" | "pending" | "unmatched";

/**
 * 契约同步引擎用到的 matrix feature 最小投影。
 * portal 侧 loadMatrix() 得到的 Feature 结构兼容,调用方负责映射。
 * (本包不依赖 portal 的 matrix.ts,避免反向依赖)
 */
export interface MatrixFeature {
  id: string; // "D-01"
  name: string; // 中文名
  domain: string; // "deliver"
  handler: string; // target.handler
  actions: string[]; // target.actions
  scenarios: Array<{
    name: string;
    status: ScenarioStatus;
  }>;
}

/** 一份 HelmCode 契约解析后的元信息 */
export interface HelmcodeContractMeta {
  featureId: string; // "F001-recon-task" (引用块 Feature ID 原值)
  featureShortName: string; // "recon-task" (去 F001- 前缀,匹配用)
  domain: string; // "recon" (涉及领域)
  status: HelmcodeStatus;
  /** HelmFlow 专属字段(仅 HelmFlow 自产契约携带):精确命中 cell,格式 "D-01__正式签约" */
  matrixCellId: string;
  /**
   * 正文里抓到的所有 `[A-Z]{1,3}-\d{2}` token(去重,含 AC-00/DR-XX 等编号噪声)。
   * match 阶段用 `includes(feature.id)` 只匹配真实 matrix feature(D-/P-/PR-),噪声自动过滤。
   * 用于「覆盖 D-01 创建」这类契约自声明的 cell 关联(老契约元信息无 matrixCellId 时的关键信号)。
   */
  rawCellRefs: string[];
  acCount: number;
  brCount: number;
  hasDomainModel: boolean;
  filePath: string; // 绝对路径
}

/** registry.md 表格一行 */
export interface RegistryRow {
  featureId: string;
  name: string;
  status: string;
  updatedAt: string;
}

export type ParseHelmcodeResult =
  | { ok: true; data: HelmcodeContractMeta }
  | { ok: false; errors: string[] };

export interface ScanOptions {
  sandboxPath: string;
}

export interface ScanParseFailure {
  filePath: string;
  errors: string[];
}

export interface ScanReport {
  contractsDir: string | null; // null = 目标项目未装 HelmCode / 无契约产物
  registryPath: string | null;
  metas: HelmcodeContractMeta[];
  parseFailures: ScanParseFailure[];
}

/** 匹配候选 cell */
export interface CellCandidate {
  featureId: string;
  scenarioName: string;
  cellId: string;
  score: number;
  reasons: string[];
}

/** 单个契约的匹配结果 */
export interface MatchResult {
  contractFeatureId: string;
  meta: HelmcodeContractMeta;
  state: MatchState;
  chosen: CellCandidate | null; // matched 时有
  candidates: CellCandidate[]; // pending 时按 score 降序
  confidence: number;
}

/** 人工映射表:契约 Feature ID → cell */
export interface ManualMapping {
  [contractFeatureId: string]: {
    featureId: string;
    scenarioName: string;
  };
}

export interface MatchInputs {
  metas: HelmcodeContractMeta[];
  features: MatrixFeature[];
  manualMap: ManualMapping;
}

/** 同步计划中,某个 cell 的目标状态变更 */
export interface SyncPlanChange {
  cellId: string;
  featureId: string;
  scenarioName: string;
  from: ScenarioStatus;
  to: ScenarioStatus;
  confidence: number;
  helmcodeStatus: HelmcodeStatus;
}

export interface SyncPlan {
  matched: SyncPlanChange[];
  pending: MatchResult[];
  unmatched: MatchResult[];
  scannedAt: string;
}

export interface ApplyReport {
  applied: string[]; // cellId
  skipped: string[];
  errors: string[];
}

// 重新导出 DB 类型,供 portal 注入
export type { DB };
