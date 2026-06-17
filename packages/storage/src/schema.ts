import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// features — 功能点元数据(分组维度,不承载 agent status)
// handler/actions/context = 实现定位锚点(implementation),非"重构目标"。
// ---------------------------------------------------------------------------
export const features = sqliteTable("features", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  domain: text("domain").notNull(),
  name: text("name").notNull(),
  status: text("status"),
  scenariosJson: text("scenarios_json"),
  handler: text("handler").notNull().default(""),
  actions: text("actions").notNull().default(""),
  context: text("context").notNull().default(""),
  decider: text("decider").notNull().default(""),
  acceptor: text("acceptor").notNull().default(""),
  priority: text("priority").notNull().default(""),
  /** @deprecated 旧"重构"语境残留(legacy 旧实现)。新模型已去 legacy/target 二元,不再读取/写入。保留列仅为历史可追溯。 */
  legacyFlowCode: text("legacy_flow_code").notNull().default(""),
  /** @deprecated 同上 */
  legacyActivities: text("legacy_activities").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// feature_scenarios — Cell: 每个格子(feature × scenario)是独立工作单元
//   id = "<featureId>__<scenarioName>"
//   scenarioStatus: 已支持 | 需改造 | 待实现 | 废弃 (业务维度)
//   agentStatus: not-started | clarifying | ... | done (开发维度)
// ---------------------------------------------------------------------------
export const featureScenarios = sqliteTable("feature_scenarios", {
  id: text("id").primaryKey(),
  featureId: text("feature_id")
    .notNull()
    .references(() => features.id),
  scenarioName: text("scenario_name").notNull(),
  scenarioStatus: text("scenario_status").notNull(),
  agentStatus: text("agent_status").notNull().default("not-started"),
  note: text("note").notNull().default(""),
  archived: integer("archived").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// runs — 一次 agent 节点调用,关联到 cell
// ---------------------------------------------------------------------------
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  cellId: text("cell_id")
    .notNull()
    .references(() => featureScenarios.id),
  kind: text("kind").notNull(),
  state: text("state").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});

// ---------------------------------------------------------------------------
// node_attempts — 单次 run 中 worker / critic 的尝试明细
// ---------------------------------------------------------------------------
export const nodeAttempts = sqliteTable("node_attempts", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  nodeName: text("node_name").notNull(),
  iteration: integer("iteration").notNull(),
  status: text("status").notNull(),
  outputPath: text("output_path"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  // 控制平面回归第三刀:记录本次 attempt 用的 HelmCode 标准版本(可追溯)
  standardsVersion: text("standards_version"),
  standardsChecksum: text("standards_checksum"),
});

// ---------------------------------------------------------------------------
// contracts — Clarifier 输出 + Critic 通过后落库的契约,关联到 cell
// ---------------------------------------------------------------------------
export const contracts = sqliteTable("contracts", {
  id: text("id").primaryKey(),
  cellId: text("cell_id")
    .notNull()
    .references(() => featureScenarios.id),
  status: text("status").notNull(),
  markdownPath: text("markdown_path").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: text("created_at").notNull(),
  approvedAt: text("approved_at"),
  // 控制平面回归追加列(DDL 幂等 ALTER 在 db.ts;第一刀不写入,为第二刀铺路)
  source: text("source").notNull().default("clarifier"),
  projectId: text("project_id").notNull().default(""),
  originPath: text("origin_path").notNull().default(""),
});

// ---------------------------------------------------------------------------
// commits — Committer 节点完成后落库的追溯链,关联到 cell
// ---------------------------------------------------------------------------
export const commits = sqliteTable("commits", {
  id: text("id").primaryKey(),
  cellId: text("cell_id")
    .notNull()
    .references(() => featureScenarios.id),
  contractId: text("contract_id")
    .notNull()
    .references(() => contracts.id),
  coderRunId: text("coder_run_id"),
  testgenRunId: text("testgen_run_id"),
  qaRunId: text("qa_run_id"),
  committerRunId: text("committer_run_id").notNull(),
  gitSha: text("git_sha").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
});

export type FeatureRow = typeof features.$inferSelect;
export type FeatureInsert = typeof features.$inferInsert;
export type FeatureScenarioRow = typeof featureScenarios.$inferSelect;
export type FeatureScenarioInsert = typeof featureScenarios.$inferInsert;
export type RunRow = typeof runs.$inferSelect;
export type RunInsert = typeof runs.$inferInsert;
export type NodeAttemptRow = typeof nodeAttempts.$inferSelect;
export type NodeAttemptInsert = typeof nodeAttempts.$inferInsert;
export type ContractRow = typeof contracts.$inferSelect;
export type ContractInsert = typeof contracts.$inferInsert;
export type CommitRow = typeof commits.$inferSelect;
export type CommitInsert = typeof commits.$inferInsert;

// ---------------------------------------------------------------------------
// fix_tasks — QA 失败时生成的修复任务,关联到 cell
// ---------------------------------------------------------------------------
export const fixTasks = sqliteTable("fix_tasks", {
  id: text("id").primaryKey(),
  cellId: text("cell_id")
    .notNull()
    .references(() => featureScenarios.id),
  sourceRunId: text("source_run_id").notNull(),
  failedAcId: text("failed_ac_id").notNull(),
  expectedBehavior: text("expected_behavior").notNull(),
  actualBehavior: text("actual_behavior").notNull(),
  evidence: text("evidence").notNull(),
  createdAt: text("created_at").notNull(),
});

export type FixTaskRow = typeof fixTasks.$inferSelect;
export type FixTaskInsert = typeof fixTasks.$inferInsert;

// ---------------------------------------------------------------------------
// reflections — 节点失败时的反思记录,关联到 cell
// ---------------------------------------------------------------------------
export const reflections = sqliteTable("reflections", {
  id: text("id").primaryKey(),
  cellId: text("cell_id")
    .notNull()
    .references(() => featureScenarios.id),
  attemptId: text("attempt_id"),
  nodeName: text("node_name").notNull(),
  criticName: text("critic_name"),
  failureSummary: text("failure_summary").notNull(),
  reflectionText: text("reflection_text").notNull(),
  createdAt: text("created_at").notNull(),
});

export type ReflectionRow = typeof reflections.$inferSelect;
export type ReflectionInsert = typeof reflections.$inferInsert;

// ---------------------------------------------------------------------------
// run_events — orchestrator 事件持久化(跟 run 走,不变)
// ---------------------------------------------------------------------------
export const runEvents = sqliteTable("run_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});

export type RunEventRow = typeof runEvents.$inferSelect;
export type RunEventInsert = typeof runEvents.$inferInsert;

// ---------------------------------------------------------------------------
// projects — 注册到 HelmFlow 的应用项目
// ---------------------------------------------------------------------------
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  adapterType: text("adapter_type").notNull(),
  sandboxPath: text("sandbox_path").notNull(),
  standardsRoot: text("standards_root"),
  featureMatrixPath: text("feature_matrix_path").notNull(),
  repoUrl: text("repo_url"),
  description: text("description"),
  manifestPath: text("manifest_path").notNull(),
  status: text("status").notNull().default("active"),
  registeredAt: integer("registered_at", { mode: "timestamp" }).notNull(),
  // 控制平面回归第三刀:项目当前绑定的 HelmCode 标准版本(per-project 版本感知)
  helmcodeVersion: text("helmcode_version"),
  standardsChecksum: text("standards_checksum"),
});

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectInsert = typeof projects.$inferInsert;

// ---------------------------------------------------------------------------
// contract_sync_results — 契约状态同步引擎扫描快照(每次扫描 upsert,幂等)
//   一个目标项目契约(HelmCode F-ID)→ HelmFlow matrix cell 的匹配结果
// ---------------------------------------------------------------------------
export const contractSyncResults = sqliteTable("contract_sync_results", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  contractFeatureId: text("contract_feature_id").notNull(),
  state: text("state").notNull(), // matched | pending | unmatched
  confidence: real("confidence").notNull(),
  chosenCellId: text("chosen_cell_id"),
  mappedFeatureId: text("mapped_feature_id"),
  mappedScenarioName: text("mapped_scenario_name"),
  helmcodeStatus: text("helmcode_status").notNull(), // done|approved|goal-running|draft
  targetScenarioStatus: text("target_scenario_status"), // 已支持|需改造|待实现
  candidatesJson: text("candidates_json").notNull().default("[]"),
  reasonsJson: text("reasons_json").notNull().default("[]"),
  scannedAt: text("scanned_at").notNull(),
});

export type ContractSyncResultRow = typeof contractSyncResults.$inferSelect;
export type ContractSyncResultInsert = typeof contractSyncResults.$inferInsert;

// ---------------------------------------------------------------------------
// contract_cell_mappings — 人工维护的"契约 Feature ID ↔ matrix cell"映射
//   HelmCode 用 F001-name,HelmFlow matrix 用 D-01;此表由 HelmFlow(控制平面)维护,
//   HelmCode 侧无感知。是启发式匹配的"确定解"覆盖层。
// ---------------------------------------------------------------------------
export const contractCellMappings = sqliteTable("contract_cell_mappings", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  contractFeatureId: text("contract_feature_id").notNull(),
  featureId: text("feature_id").notNull(),
  scenarioName: text("scenario_name").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export type ContractCellMappingRow = typeof contractCellMappings.$inferSelect;
export type ContractCellMappingInsert = typeof contractCellMappings.$inferInsert;

// ---------------------------------------------------------------------------
// standards_migrations — HelmCode 标准版本切换审计(控制平面回归第四刀)
//   每次 adopt(用户手动 git 切换后采纳)/rollback 都新增一行,不删旧(可追溯)。
//   直接读源架构:HelmFlow 不写文件,本表是版本切换的唯一历史凭证。
// ---------------------------------------------------------------------------
export const standardsMigrations = sqliteTable("standards_migrations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  fromChecksum: text("from_checksum"),
  toChecksum: text("to_checksum").notNull(),
  fromGitHead: text("from_git_head"),
  toGitHead: text("to_git_head"),
  action: text("action").notNull(), // adopt | rollback
  changedFilesJson: text("changed_files_json").notNull().default("[]"),
  affectedCount: integer("affected_count").notNull().default(0),
  operator: text("operator").notNull().default("portal"),
  createdAt: text("created_at").notNull(),
});

export type StandardsMigrationRow = typeof standardsMigrations.$inferSelect;
export type StandardsMigrationInsert = typeof standardsMigrations.$inferInsert;

// ---------------------------------------------------------------------------
// pipeline_queue — 常驻 worker 的执行队列(7×24 自主开发能力)
//   每个 approved 契约 → 一条队列项。worker 认领 pending→running,执行 runOrchestrator
//   后落 done/blocked。attempt 计的是进程崩溃导致的重跑(非业务重试),达 maxAttempts 转 blocked。
// ---------------------------------------------------------------------------
export const pipelineQueue = sqliteTable("pipeline_queue", {
  id: text("id").primaryKey(),
  cellId: text("cell_id")
    .notNull()
    .references(() => featureScenarios.id),
  contractId: text("contract_id")
    .notNull()
    .references(() => contracts.id),
  state: text("state").notNull(), // pending | running | done | failed | blocked
  priority: integer("priority").notNull().default(0),
  attempt: integer("attempt").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  claimedBy: text("claimed_by"),
  claimedAt: text("claimed_at"),
  lastError: text("last_error").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type PipelineQueueRow = typeof pipelineQueue.$inferSelect;
export type PipelineQueueInsert = typeof pipelineQueue.$inferInsert;
