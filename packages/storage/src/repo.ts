import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import type { DB } from "./db";
import {
  features,
  featureScenarios,
  runs,
  nodeAttempts,
  contracts,
  commits,
  fixTasks,
  reflections,
  runEvents,
  projects,
  type FeatureRow,
  type FeatureScenarioRow,
  type RunRow,
  type NodeAttemptRow,
  type ContractRow,
  type CommitRow,
  type FixTaskRow,
  type ReflectionRow,
  type RunEventRow,
  type ProjectRow,
} from "./schema";

// ---------------------------------------------------------------------------
// id 生成器
// ---------------------------------------------------------------------------
function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function newRunId(): string {
  const ts = Date.now().toString(36);
  return `run-${ts}-${shortId()}`;
}

function newAttemptId(runId: string, iteration: number): string {
  return `attempt-${runId}-${iteration}`;
}

// ---------------------------------------------------------------------------
// features — 功能点元数据 CRUD (不再承载 agent status)
// ---------------------------------------------------------------------------

export interface UpsertFeatureArgs {
  id: string;
  projectId: string;
  domain: string;
  name: string;
  status?: string;
  handler?: string;
  actions?: string;
  context?: string;
  priority?: string;
  legacyFlowCode?: string;
  legacyActivities?: string;
  updatedAt?: string;
}

export function getFeatureRow(db: DB, id: string): FeatureRow | undefined {
  return db.select().from(features).where(eq(features.id, id)).get();
}

export function upsertFeature(db: DB, args: UpsertFeatureArgs): FeatureRow {
  const now = args.updatedAt ?? new Date().toISOString();
  // Atomic upsert using INSERT OR REPLACE to avoid TOCTOU race condition
  const existing = getFeatureRow(db, args.id);
  if (existing) {
    // 不覆盖已有的非空值(仅当新值非空时才写入)
    const setValues: Record<string, unknown> = {
      projectId: args.projectId,
      domain: args.domain,
      name: args.name,
      status: args.status ?? existing.status,
      updatedAt: now,
    };
    if (args.handler) setValues.handler = args.handler;
    if (args.actions) setValues.actions = args.actions;
    if (args.context) setValues.context = args.context;
    if (args.priority) setValues.priority = args.priority;
    if (args.legacyFlowCode) setValues.legacyFlowCode = args.legacyFlowCode;
    if (args.legacyActivities) setValues.legacyActivities = args.legacyActivities;
    db.update(features)
      .set(setValues)
      .where(eq(features.id, args.id))
      .run();
  } else {
    // Use INSERT OR IGNORE to handle race: if another process inserted between
    // our read and write, the insert is safely ignored.
    try {
      db.insert(features)
        .values({
          id: args.id,
          projectId: args.projectId,
          domain: args.domain,
          name: args.name,
          status: args.status ?? null,
          handler: args.handler ?? "",
          actions: args.actions ?? "",
          context: args.context ?? "",
          priority: args.priority ?? "",
          legacyFlowCode: args.legacyFlowCode ?? "",
          legacyActivities: args.legacyActivities ?? "",
          updatedAt: now,
        })
        .run();
    } catch (err: unknown) {
      // Unique constraint violation — another process inserted first.
      // Fall through to re-read the row.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("UNIQUE constraint")) throw err;
    }
  }
  const row = getFeatureRow(db, args.id);
  if (!row) throw new Error(`upsertFeature: row not found after upsert: ${args.id}`);
  return row;
}

export function updateFeatureScenarios(
  db: DB,
  featureId: string,
  scenariosJson: string,
): void {
  db.update(features)
    .set({ scenariosJson, updatedAt: new Date().toISOString() })
    .where(eq(features.id, featureId))
    .run();
}

// ---------------------------------------------------------------------------
// features — Goal 13: 手动创建 / 编辑 / 归档 / 查询
// ---------------------------------------------------------------------------

export interface CreateFeatureManualArgs {
  id: string;
  projectId: string;
  domain: string;
  name: string;
  handler?: string;
  actions?: string;
  context?: string;
  priority?: string;
  legacyFlowCode?: string;
  legacyActivities?: string;
}

export function createFeatureManual(db: DB, args: CreateFeatureManualArgs): FeatureRow {
  const now = new Date().toISOString();
  // 检查 id 是否已存在
  const existing = getFeatureRow(db, args.id);
  if (existing) {
    throw new Error(`createFeatureManual: feature already exists: ${args.id}`);
  }
  db.insert(features)
    .values({
      id: args.id,
      projectId: args.projectId,
      domain: args.domain,
      name: args.name,
      status: null,
      handler: args.handler ?? "",
      actions: args.actions ?? "",
      context: args.context ?? "",
      priority: args.priority ?? "",
      legacyFlowCode: args.legacyFlowCode ?? "",
      legacyActivities: args.legacyActivities ?? "",
      updatedAt: now,
    })
    .run();
  const row = getFeatureRow(db, args.id);
  if (!row) throw new Error(`createFeatureManual: row not found: ${args.id}`);
  return row;
}

export interface UpdateFeatureMetaArgs {
  name?: string;
  handler?: string;
  actions?: string;
  context?: string;
  priority?: string;
  legacyFlowCode?: string;
  legacyActivities?: string;
  domain?: string;
}

export function updateFeatureMeta(db: DB, featureId: string, args: UpdateFeatureMetaArgs): FeatureRow {
  const setValues: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (args.name !== undefined) setValues.name = args.name;
  if (args.handler !== undefined) setValues.handler = args.handler;
  if (args.actions !== undefined) setValues.actions = args.actions;
  if (args.context !== undefined) setValues.context = args.context;
  if (args.priority !== undefined) setValues.priority = args.priority;
  if (args.legacyFlowCode !== undefined) setValues.legacyFlowCode = args.legacyFlowCode;
  if (args.legacyActivities !== undefined) setValues.legacyActivities = args.legacyActivities;
  if (args.domain !== undefined) setValues.domain = args.domain;
  db.update(features).set(setValues).where(eq(features.id, featureId)).run();
  const row = getFeatureRow(db, featureId);
  if (!row) throw new Error(`updateFeatureMeta: row not found: ${featureId}`);
  return row;
}

export function archiveFeature(db: DB, featureId: string): FeatureRow {
  const now = new Date().toISOString();
  db.update(features)
    .set({ status: "archived", updatedAt: now })
    .where(eq(features.id, featureId))
    .run();
  // 把所有关联场景也标废弃
  db.update(featureScenarios)
    .set({ scenarioStatus: "废弃", updatedAt: now })
    .where(eq(featureScenarios.featureId, featureId))
    .run();
  const row = getFeatureRow(db, featureId);
  if (!row) throw new Error(`archiveFeature: row not found: ${featureId}`);
  return row;
}

export function listActiveFeatures(db: DB, projectId: string): FeatureRow[] {
  return db
    .select()
    .from(features)
    .where(
      and(
        eq(features.projectId, projectId),
        ne(features.status, "archived"),
      ),
    )
    .all();
}

// ---------------------------------------------------------------------------
// feature_scenarios — Goal 13: 手动创建 / 删除
// ---------------------------------------------------------------------------

export interface CreateScenarioManualArgs {
  featureId: string;
  scenarioName: string;
  scenarioStatus: string;
}

export function createScenarioManual(db: DB, args: CreateScenarioManualArgs): FeatureScenarioRow {
  const id = cellId(args.featureId, args.scenarioName);
  const now = new Date().toISOString();
  const existing = getCellRow(db, id);
  if (existing) {
    throw new Error(`createScenarioManual: scenario already exists: ${id}`);
  }
  db.insert(featureScenarios)
    .values({
      id,
      featureId: args.featureId,
      scenarioName: args.scenarioName,
      scenarioStatus: args.scenarioStatus,
      agentStatus: "not-started",
      note: "",
      archived: 0,
      updatedAt: now,
    })
    .run();
  const row = getCellRow(db, id);
  if (!row) throw new Error(`createScenarioManual: row not found: ${id}`);
  return row;
}

export function deleteScenario(db: DB, cellIdValue: string): void {
  db.delete(featureScenarios).where(eq(featureScenarios.id, cellIdValue)).run();
}

// ---------------------------------------------------------------------------
// feature_scenarios — Cell CRUD
// ---------------------------------------------------------------------------

export function cellId(featureId: string, scenarioName: string): string {
  return `${featureId}__${scenarioName}`;
}

export interface UpsertFeatureScenarioArgs {
  featureId: string;
  scenarioName: string;
  scenarioStatus: string;
  agentStatus?: string;
  note?: string;
}

export function getCellRow(db: DB, id: string): FeatureScenarioRow | undefined {
  return db.select().from(featureScenarios).where(eq(featureScenarios.id, id)).get();
}

export function upsertFeatureScenario(
  db: DB,
  args: UpsertFeatureScenarioArgs,
): FeatureScenarioRow {
  const id = cellId(args.featureId, args.scenarioName);
  const now = new Date().toISOString();
  const existing = getCellRow(db, id);

  if (existing) {
    db.update(featureScenarios)
      .set({
        scenarioStatus: args.scenarioStatus,
        agentStatus: args.agentStatus ?? existing.agentStatus,
        note: args.note ?? existing.note,
        updatedAt: now,
      })
      .where(eq(featureScenarios.id, id))
      .run();
  } else {
    try {
      db.insert(featureScenarios)
        .values({
          id,
          featureId: args.featureId,
          scenarioName: args.scenarioName,
          scenarioStatus: args.scenarioStatus,
          agentStatus: args.agentStatus ?? "not-started",
          note: args.note ?? "",
          updatedAt: now,
        })
        .run();
    } catch (err: unknown) {
      // UNIQUE constraint — another process inserted first
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("UNIQUE constraint")) throw err;
    }
  }
  const row = getCellRow(db, id);
  if (!row) throw new Error(`upsertFeatureScenario: row not found: ${id}`);
  return row;
}

export function getFeatureScenario(
  db: DB,
  featureId: string,
  scenarioName: string,
): FeatureScenarioRow | undefined {
  return getCellRow(db, cellId(featureId, scenarioName));
}

export function listFeatureScenarios(
  db: DB,
  featureId: string,
): FeatureScenarioRow[] {
  return db
    .select()
    .from(featureScenarios)
    .where(eq(featureScenarios.featureId, featureId))
    .all();
}

export function updateCellAgentStatus(
  db: DB,
  id: string,
  agentStatus: string,
): void {
  db.update(featureScenarios)
    .set({ agentStatus, updatedAt: new Date().toISOString() })
    .where(eq(featureScenarios.id, id))
    .run();
}

export function updateFeatureScenarioStatus(
  db: DB,
  featureId: string,
  scenarioName: string,
  scenarioStatus: string,
  note?: string,
): void {
  const id = cellId(featureId, scenarioName);
  const setValues: Record<string, string> = {
    scenarioStatus,
    updatedAt: new Date().toISOString(),
  };
  if (note !== undefined) setValues.note = note;
  db.update(featureScenarios)
    .set(setValues)
    .where(eq(featureScenarios.id, id))
    .run();
}

// ---------------------------------------------------------------------------
// runs — 关联到 cellId
// ---------------------------------------------------------------------------

export type RunKind = "clarifier" | "coder" | "testgen" | "qa" | "committer" | "full-loop" | "analyze" | "analyze-structure" | "require" | "code" | "test" | "deploy" | "verify";
export type RunState = "running" | "done" | "failed" | "applied";

export function hasRunningRun(db: DB, cellId: string, kind: RunKind): boolean {
  const row = db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.cellId, cellId), eq(runs.kind, kind), eq(runs.state, "running")))
    .limit(1)
    .get();
  return !!row;
}

// ---------------------------------------------------------------------------
// 虚拟 Cell — 为不关联特定 feature/scenario 的 run 提供 FK 占位
// (如 analyze-structure 这类项目级操作)
// ---------------------------------------------------------------------------

const VIRTUAL_FEATURE_ID = "__system__";
const VIRTUAL_CELL_ID = "__system____virtual__";

/**
 * 确保虚拟 feature + cell 存在，并返回虚拟 cellId。
 * 幂等：重复调用安全。
 */
export function ensureVirtualCell(db: DB): string {
  const now = new Date().toISOString();

  // 1) 确保 feature 存在
  if (!getFeatureRow(db, VIRTUAL_FEATURE_ID)) {
    db.insert(features)
      .values({
        id: VIRTUAL_FEATURE_ID,
        projectId: "__system__",
        domain: "system",
        name: "System Virtual Feature",
        status: "archived",
        handler: "",
        actions: "",
        context: "",
        priority: "",
        legacyFlowCode: "",
        legacyActivities: "",
        updatedAt: now,
      })
      .run();
  }

  // 2) 确保 cell 存在
  if (!getCellRow(db, VIRTUAL_CELL_ID)) {
    db.insert(featureScenarios)
      .values({
        id: VIRTUAL_CELL_ID,
        featureId: VIRTUAL_FEATURE_ID,
        scenarioName: "virtual",
        scenarioStatus: "虚拟",
        agentStatus: "not-started",
        note: "系统虚拟 cell，用于项目级操作",
        archived: 1,
        updatedAt: now,
      })
      .run();
  }

  return VIRTUAL_CELL_ID;
}

export function createRun(db: DB, cellId: string, kind: RunKind, explicitId?: string): RunRow {
  const id = explicitId ?? newRunId();
  const startedAt = new Date().toISOString();
  db.insert(runs)
    .values({
      id,
      cellId,
      kind,
      state: "running",
      startedAt,
      finishedAt: null,
    })
    .run();
  const row = db.select().from(runs).where(eq(runs.id, id)).get();
  if (!row) throw new Error(`createRun: row not found: ${id}`);
  return row;
}

export function updateRun(db: DB, runId: string, state: RunState): void {
  const finishedAt = state === "running" ? null : new Date().toISOString();
  db.update(runs).set({ state, finishedAt }).where(eq(runs.id, runId)).run();
}

// ---------------------------------------------------------------------------
// node_attempts
// ---------------------------------------------------------------------------

export type AttemptStatus = "running" | "passed" | "failed";

export function createAttempt(
  db: DB,
  runId: string,
  nodeName: string,
  iteration: number,
  status: AttemptStatus = "running",
): NodeAttemptRow {
  const id = newAttemptId(runId, iteration);
  const startedAt = new Date().toISOString();
  db.insert(nodeAttempts)
    .values({
      id,
      runId,
      nodeName,
      iteration,
      status,
      outputPath: null,
      startedAt,
      finishedAt: null,
    })
    .run();
  const row = db.select().from(nodeAttempts).where(eq(nodeAttempts.id, id)).get();
  if (!row) throw new Error(`createAttempt: row not found: ${id}`);
  return row;
}

export interface UpdateAttemptArgs {
  status: AttemptStatus;
  outputPath?: string | null;
}

export function updateAttempt(db: DB, attemptId: string, args: UpdateAttemptArgs): void {
  const finishedAt = args.status === "running" ? null : new Date().toISOString();
  db.update(nodeAttempts)
    .set({
      status: args.status,
      outputPath: args.outputPath ?? null,
      finishedAt,
    })
    .where(eq(nodeAttempts.id, attemptId))
    .run();
}

// ---------------------------------------------------------------------------
// contracts — 关联到 cellId
// ---------------------------------------------------------------------------

export type ContractStatus = "draft" | "approved" | "done" | "blocked" | "abandoned";

export interface CreateContractArgs {
  cellId: string;
  status: ContractStatus;
  markdownPath: string;
  contentHash: string;
}

function newContractId(cellId: string): string {
  return `C-${cellId}-${shortId()}`;
}

export function createContract(db: DB, args: CreateContractArgs): ContractRow {
  const id = newContractId(args.cellId);
  const createdAt = new Date().toISOString();
  db.insert(contracts)
    .values({
      id,
      cellId: args.cellId,
      status: args.status,
      markdownPath: args.markdownPath,
      contentHash: args.contentHash,
      createdAt,
      approvedAt: null,
    })
    .run();
  const row = db.select().from(contracts).where(eq(contracts.id, id)).get();
  if (!row) throw new Error(`createContract: row not found: ${id}`);
  return row;
}

export function getContractById(db: DB, contractId: string): ContractRow | undefined {
  return db.select().from(contracts).where(eq(contracts.id, contractId)).get();
}

export function getLatestContract(db: DB, cellId: string): ContractRow | undefined {
  return db
    .select()
    .from(contracts)
    .where(eq(contracts.cellId, cellId))
    .orderBy(desc(contracts.createdAt))
    .limit(1)
    .get();
}

export function updateContractStatus(
  db: DB,
  contractId: string,
  status: ContractStatus,
  approvedAt?: string,
): ContractRow {
  const setValues: Partial<{ status: ContractStatus; approvedAt: string }> = { status };
  if (status === "approved") {
    setValues.approvedAt = approvedAt ?? new Date().toISOString();
  }
  db.update(contracts).set(setValues).where(eq(contracts.id, contractId)).run();
  const row = getContractById(db, contractId);
  if (!row) throw new Error(`updateContractStatus: row not found: ${contractId}`);
  return row;
}

// ---------------------------------------------------------------------------
// commits — 关联到 cellId
// ---------------------------------------------------------------------------

export interface CreateCommitArgs {
  cellId: string;
  contractId: string;
  coderRunId?: string | null;
  testgenRunId?: string | null;
  qaRunId?: string | null;
  committerRunId: string;
  gitSha: string;
  message: string;
}

function newCommitId(): string {
  return `COM-${shortId().toUpperCase()}`;
}

export function createCommit(db: DB, args: CreateCommitArgs): CommitRow {
  const id = newCommitId();
  const createdAt = new Date().toISOString();
  db.insert(commits)
    .values({
      id,
      cellId: args.cellId,
      contractId: args.contractId,
      coderRunId: args.coderRunId ?? null,
      testgenRunId: args.testgenRunId ?? null,
      qaRunId: args.qaRunId ?? null,
      committerRunId: args.committerRunId,
      gitSha: args.gitSha,
      message: args.message,
      createdAt,
    })
    .run();
  const row = db.select().from(commits).where(eq(commits.id, id)).get();
  if (!row) throw new Error(`createCommit: row not found: ${id}`);
  return row;
}

export function getLatestCommit(db: DB, cellId: string): CommitRow | undefined {
  return db
    .select()
    .from(commits)
    .where(eq(commits.cellId, cellId))
    .orderBy(desc(commits.createdAt))
    .limit(1)
    .get();
}

export function getLatestRunByKind(db: DB, cellId: string, kind: RunKind): RunRow | undefined {
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.cellId, cellId), eq(runs.kind, kind)))
    .orderBy(desc(runs.startedAt))
    .limit(1)
    .get();
}

// ---------------------------------------------------------------------------
// fix_tasks — 关联到 cellId
// ---------------------------------------------------------------------------

export interface CreateFixTaskArgs {
  cellId: string;
  sourceRunId: string;
  failedAcId: string;
  expectedBehavior: string;
  actualBehavior: string;
  evidence: string;
}

function newFixTaskId(): string {
  return `FT-${shortId().toUpperCase()}`;
}

export function createFixTask(db: DB, args: CreateFixTaskArgs): FixTaskRow {
  const id = newFixTaskId();
  const createdAt = new Date().toISOString();
  db.insert(fixTasks)
    .values({
      id,
      cellId: args.cellId,
      sourceRunId: args.sourceRunId,
      failedAcId: args.failedAcId,
      expectedBehavior: args.expectedBehavior,
      actualBehavior: args.actualBehavior,
      evidence: args.evidence,
      createdAt,
    })
    .run();
  const row = db.select().from(fixTasks).where(eq(fixTasks.id, id)).get();
  if (!row) throw new Error(`createFixTask: row not found: ${id}`);
  return row;
}

export function listFixTasks(db: DB, cellId: string): FixTaskRow[] {
  return db
    .select()
    .from(fixTasks)
    .where(eq(fixTasks.cellId, cellId))
    .orderBy(desc(fixTasks.createdAt))
    .all();
}

// ---------------------------------------------------------------------------
// reflections — 关联到 cellId
// ---------------------------------------------------------------------------

export interface CreateReflectionArgs {
  cellId: string;
  attemptId?: string | null;
  nodeName: string;
  criticName?: string | null;
  failureSummary: string;
  reflectionText: string;
}

function newReflectionId(): string {
  return `REF-${shortId().toUpperCase()}`;
}

export function createReflection(db: DB, args: CreateReflectionArgs): ReflectionRow {
  const id = newReflectionId();
  const createdAt = new Date().toISOString();
  db.insert(reflections)
    .values({
      id,
      cellId: args.cellId,
      attemptId: args.attemptId ?? null,
      nodeName: args.nodeName,
      criticName: args.criticName ?? null,
      failureSummary: args.failureSummary,
      reflectionText: args.reflectionText,
      createdAt,
    })
    .run();
  const row = db.select().from(reflections).where(eq(reflections.id, id)).get();
  if (!row) throw new Error(`createReflection: row not found: ${id}`);
  return row;
}

export function listReflectionsForFeature(db: DB, cellId: string, limit = 5): ReflectionRow[] {
  return db
    .select()
    .from(reflections)
    .where(eq(reflections.cellId, cellId))
    .orderBy(desc(reflections.createdAt))
    .limit(limit)
    .all();
}

// ---------------------------------------------------------------------------
// run_events
// ---------------------------------------------------------------------------

export function createRunEvent(db: DB, runId: string, eventType: string, payload: unknown): void {
  const createdAt = new Date().toISOString();
  db.insert(runEvents)
    .values({ runId, eventType, payload: JSON.stringify(payload), createdAt })
    .run();
}

export function listRunEvents(db: DB, runId: string, afterId?: number): RunEventRow[] {
  const rows = db.select().from(runEvents).where(eq(runEvents.runId, runId)).all();
  if (afterId !== undefined) {
    return rows.filter((r) => r.id > afterId);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

export interface CreateProjectArgs {
  id: string;
  name: string;
  adapterType: string;
  sandboxPath: string;
  standardsRoot?: string | null;
  featureMatrixPath: string;
  repoUrl?: string | null;
  description?: string | null;
  manifestPath: string;
}

export function createProject(db: DB, args: CreateProjectArgs): ProjectRow {
  const registeredAt = new Date();
  db.insert(projects)
    .values({
      id: args.id,
      name: args.name,
      adapterType: args.adapterType,
      sandboxPath: args.sandboxPath,
      standardsRoot: args.standardsRoot ?? null,
      featureMatrixPath: args.featureMatrixPath,
      repoUrl: args.repoUrl ?? null,
      description: args.description ?? null,
      manifestPath: args.manifestPath,
      status: "active",
      registeredAt,
    })
    .run();
  const row = db.select().from(projects).where(eq(projects.id, args.id)).get();
  if (!row) throw new Error(`createProject: row not found: ${args.id}`);
  return row;
}

export function getProjectById(db: DB, id: string): ProjectRow | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export function listProjectsDb(db: DB): ProjectRow[] {
  return db.select().from(projects).where(eq(projects.status, "active")).all();
}

export interface UpdateProjectArgs {
  name?: string;
  adapterType?: string;
  sandboxPath?: string;
  standardsRoot?: string | null;
  featureMatrixPath?: string;
  repoUrl?: string | null;
  description?: string | null;
}

export function updateProject(db: DB, id: string, args: UpdateProjectArgs): ProjectRow {
  const setValues: Record<string, unknown> = {};
  if (args.name !== undefined) setValues.name = args.name;
  if (args.adapterType !== undefined) setValues.adapterType = args.adapterType;
  if (args.sandboxPath !== undefined) setValues.sandboxPath = args.sandboxPath;
  if (args.standardsRoot !== undefined) setValues.standardsRoot = args.standardsRoot;
  if (args.featureMatrixPath !== undefined) setValues.featureMatrixPath = args.featureMatrixPath;
  if (args.repoUrl !== undefined) setValues.repoUrl = args.repoUrl;
  if (args.description !== undefined) setValues.description = args.description;
  if (Object.keys(setValues).length > 0) {
    db.update(projects).set(setValues).where(eq(projects.id, id)).run();
  }
  const row = getProjectById(db, id);
  if (!row) throw new Error(`updateProject: row not found: ${id}`);
  return row;
}

export function softDeleteProject(db: DB, id: string): ProjectRow {
  db.update(projects).set({ status: "inactive" }).where(eq(projects.id, id)).run();
  const row = getProjectById(db, id);
  if (!row) throw new Error(`softDeleteProject: row not found: ${id}`);
  return row;
}

export function reactivateProject(db: DB, id: string): ProjectRow {
  db.update(projects).set({ status: "active", registeredAt: new Date() }).where(eq(projects.id, id)).run();
  const row = getProjectById(db, id);
  if (!row) throw new Error(`reactivateProject: row not found: ${id}`);
  return row;
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

export function cleanupStaleRuns(db: DB, thresholdMs: number): void {
  const cutoff = new Date(Date.now() - thresholdMs).toISOString();
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.update(nodeAttempts)
      .set({ status: "failed", finishedAt: now })
      .where(and(eq(nodeAttempts.status, "running"), lt(nodeAttempts.startedAt, cutoff)))
      .run();
    tx.update(runs)
      .set({ state: "failed", finishedAt: now })
      .where(and(eq(runs.state, "running"), lt(runs.startedAt, cutoff)))
      .run();
  });
}

export function countFeaturesByProject(db: DB, projectId: string): number {
  return db.select().from(features).where(eq(features.projectId, projectId)).all().length;
}

export function countFeaturesByStatus(db: DB, projectId: string): Record<string, number> {
  const rows = db.select().from(features).where(eq(features.projectId, projectId)).all();
  const byStatus: Record<string, number> = {};
  for (const r of rows) {
    if (r.status) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }
  return byStatus;
}

export function listRunsByKind(db: DB, kind: string, limit = 20): RunRow[] {
  return db
    .select()
    .from(runs)
    .where(eq(runs.kind, kind))
    .orderBy(desc(runs.startedAt))
    .limit(limit)
    .all();
}

export function getRunById(db: DB, runId: string): RunRow | undefined {
  return db.select().from(runs).where(eq(runs.id, runId)).get();
}

export function listRunsForCell(db: DB, cellId: string): RunRow[] {
  return db.select().from(runs).where(eq(runs.cellId, cellId)).all();
}

export function listAttemptsForRuns(db: DB, runIds: string[]): NodeAttemptRow[] {
  if (runIds.length === 0) return [];
  return db.select().from(nodeAttempts).where(inArray(nodeAttempts.runId, runIds)).all();
}

export function listContractsForCell(db: DB, cellId: string): ContractRow[] {
  return db.select().from(contracts).where(eq(contracts.cellId, cellId)).all();
}

export function listCommitsForCell(db: DB, cellId: string): CommitRow[] {
  return db.select().from(commits).where(eq(commits.cellId, cellId)).all();
}
