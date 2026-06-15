import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// features — 功能点元数据(分组维度,不再承载 agent status)
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
  priority: text("priority").notNull().default(""),
  legacyFlowCode: text("legacy_flow_code").notNull().default(""),
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
});

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectInsert = typeof projects.$inferInsert;
