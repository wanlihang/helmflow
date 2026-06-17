import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
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
  contractSyncResults,
  contractCellMappings,
  standardsMigrations,
  pipelineQueue,
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
  type ContractSyncResultRow,
  type ContractCellMappingRow,
  type StandardsMigrationRow,
  type PipelineQueueRow,
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
  decider?: string;
  acceptor?: string;
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
    if (args.decider) setValues.decider = args.decider;
    if (args.acceptor) setValues.acceptor = args.acceptor;
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
          decider: args.decider ?? "",
          acceptor: args.acceptor ?? "",
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
  decider?: string;
  acceptor?: string;
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
      decider: args.decider ?? "",
      acceptor: args.acceptor ?? "",
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
  decider?: string;
  acceptor?: string;
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
  if (args.decider !== undefined) setValues.decider = args.decider;
  if (args.acceptor !== undefined) setValues.acceptor = args.acceptor;
  if (args.priority !== undefined) setValues.priority = args.priority;
  if (args.legacyFlowCode !== undefined) setValues.legacyFlowCode = args.legacyFlowCode;
  if (args.legacyActivities !== undefined) setValues.legacyActivities = args.legacyActivities;
  if (args.domain !== undefined) setValues.domain = args.domain;
  db.update(features).set(setValues).where(eq(features.id, featureId)).run();
  const row = getFeatureRow(db, featureId);
  if (!row) throw new Error(`updateFeatureMeta: row not found: ${featureId}`);
  return row;
}

/**
 * 分析产出写回分层归属(implementation)。
 * 仅更新 decider/acceptor/handler/actions/context,不影响 name/domain/priority 等元数据。
 * 用于:analyze 扫码识别 / require 分层分析 / analyze-structure 推断。
 */
export function updateFeatureImplementation(
  db: DB,
  featureId: string,
  args: {
    decider?: string;
    acceptor?: string;
    handler?: string;
    actions?: string;
    context?: string;
  },
): void {
  const setValues: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (args.decider !== undefined) setValues.decider = args.decider;
  if (args.acceptor !== undefined) setValues.acceptor = args.acceptor;
  if (args.handler !== undefined) setValues.handler = args.handler;
  if (args.actions !== undefined) setValues.actions = args.actions;
  if (args.context !== undefined) setValues.context = args.context;
  if (Object.keys(setValues).length <= 1) return; // 只有 updatedAt,无实质更新
  db.update(features).set(setValues).where(eq(features.id, featureId)).run();
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

export type RunKind = "clarifier" | "coder" | "testgen" | "qa" | "committer" | "full-loop" | "analyze" | "analyze-scan" | "analyze-structure" | "require" | "code" | "test" | "deploy" | "verify" | "contract-sync";
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
  /** 控制平面回归第三刀:本次 attempt 用的 HelmCode 标准版本(可追溯) */
  standards?: { version?: string; checksum?: string },
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
      standardsVersion: standards?.version ?? null,
      standardsChecksum: standards?.checksum ?? null,
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

export type ContractStatus = "draft" | "approved" | "goal-running" | "done" | "blocked" | "abandoned";

export interface CreateContractArgs {
  cellId: string;
  status: ContractStatus;
  markdownPath: string;
  contentHash: string;
  /** 契约来源:clarifier(HelmFlow 自产) | helmcode-import(从目标项目导入)。默认 clarifier */
  source?: "clarifier" | "helmcode-import";
  /** 所属项目 ID(helmcode-import 时填) */
  projectId?: string;
  /** 目标项目契约绝对路径(helmcode-import 时填,即 markdownPath 的来源) */
  originPath?: string;
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
      source: args.source ?? "clarifier",
      projectId: args.projectId ?? "",
      originPath: args.originPath ?? "",
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
// pipeline_queue — 常驻 worker 执行队列(7×24 自主开发)
//   approved 契约 → pending 项;worker 认领 pending→running;执行后 done/blocked。
//   attempt 计的是进程崩溃导致的重跑(非业务重试,业务重试在 orchestrator 内部),
//   达 maxAttempts 转 blocked。
// ---------------------------------------------------------------------------

export type PipelineQueueState = "pending" | "running" | "done" | "failed" | "blocked";

export interface EnqueueArgs {
  cellId: string;
  contractId: string;
  priority?: number;
  maxAttempts?: number;
}

function newQueueItemId(cellId: string): string {
  return `q-${cellId}-${shortId()}`;
}

/**
 * 入队:若该 cell 已有 pending/running 队列项则跳过(返回 null),否则插入 pending。
 * 事务内检查,保证同一 cell 不会被重复入队。
 */
export function enqueueIfAbsent(db: DB, args: EnqueueArgs): PipelineQueueRow | null {
  return db.transaction((tx) => {
    const existing = tx
      .select({ id: pipelineQueue.id })
      .from(pipelineQueue)
      .where(
        and(
          eq(pipelineQueue.cellId, args.cellId),
          inArray(pipelineQueue.state, ["pending", "running"]),
        ),
      )
      .limit(1)
      .get();
    if (existing) return null;
    const now = new Date().toISOString();
    const id = newQueueItemId(args.cellId);
    tx.insert(pipelineQueue)
      .values({
        id,
        cellId: args.cellId,
        contractId: args.contractId,
        state: "pending",
        priority: args.priority ?? 0,
        attempt: 0,
        maxAttempts: args.maxAttempts ?? 3,
        claimedBy: null,
        claimedAt: null,
        lastError: "",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const row = tx.select().from(pipelineQueue).where(eq(pipelineQueue.id, id)).get();
    if (!row) throw new Error(`enqueueIfAbsent: row not found: ${id}`);
    return row;
  });
}

/**
 * 原子认领:取最高优先级、最早创建的 pending,置为 running。
 * SQLite 单写者 + 事务,天然无竞争。无 pending 返回 null。
 */
export function claimNextPending(db: DB, claimedBy: string): PipelineQueueRow | null {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(pipelineQueue)
      .where(eq(pipelineQueue.state, "pending"))
      .orderBy(desc(pipelineQueue.priority), asc(pipelineQueue.createdAt))
      .limit(1)
      .get();
    if (!row) return null;
    const now = new Date().toISOString();
    tx.update(pipelineQueue)
      .set({ state: "running", claimedBy, claimedAt: now, updatedAt: now })
      .where(eq(pipelineQueue.id, row.id))
      .run();
    return { ...row, state: "running", claimedBy, claimedAt: now, updatedAt: now };
  });
}

export function markQueueDone(db: DB, id: string): void {
  const now = new Date().toISOString();
  db.update(pipelineQueue)
    .set({ state: "done", lastError: "", updatedAt: now })
    .where(eq(pipelineQueue.id, id))
    .run();
}

export function markQueueTerminal(
  db: DB,
  id: string,
  state: "failed" | "blocked",
  error: string,
): void {
  const now = new Date().toISOString();
  db.update(pipelineQueue)
    .set({ state, lastError: error, updatedAt: now })
    .where(eq(pipelineQueue.id, id))
    .run();
}

/** 启动恢复用:返回所有 state=running 的队列项(上次崩溃残留)。 */
export function listRunningQueue(db: DB): PipelineQueueRow[] {
  return db.select().from(pipelineQueue).where(eq(pipelineQueue.state, "running")).all();
}

/**
 * 中断恢复:attempt++ 后重排为 pending。返回更新后的 attempt 值。
 * 调用方(recovery)负责判断 attempt 与 maxAttempts 的关系决定 requeue 还是 blocked。
 */
export function requeueAfterCrash(db: DB, id: string): number {
  const now = new Date().toISOString();
  const row = db.select().from(pipelineQueue).where(eq(pipelineQueue.id, id)).get();
  const attempt = (row?.attempt ?? 0) + 1;
  db.update(pipelineQueue)
    .set({
      state: "pending",
      attempt,
      claimedBy: null,
      claimedAt: null,
      lastError: `crashed, re-queued (attempt ${attempt})`,
      updatedAt: now,
    })
    .where(eq(pipelineQueue.id, id))
    .run();
  return attempt;
}

export function listQueue(
  db: DB,
  state?: PipelineQueueState,
  limit = 200,
): PipelineQueueRow[] {
  if (state) {
    return db
      .select()
      .from(pipelineQueue)
      .where(eq(pipelineQueue.state, state))
      .orderBy(desc(pipelineQueue.priority), desc(pipelineQueue.updatedAt))
      .limit(limit)
      .all();
  }
  return db
    .select()
    .from(pipelineQueue)
    .orderBy(desc(pipelineQueue.updatedAt))
    .limit(limit)
    .all();
}

export function countQueueByState(db: DB): Record<PipelineQueueState, number> {
  const out: Record<PipelineQueueState, number> = {
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
    blocked: 0,
  };
  const rows = db
    .select({ state: pipelineQueue.state, n: sql<number>`count(*)` })
    .from(pipelineQueue)
    .groupBy(pipelineQueue.state)
    .all();
  for (const r of rows) {
    if (r.state in out) out[r.state as PipelineQueueState] = r.n;
  }
  return out;
}

/**
 * 预算治理:统计 sinceIso 之后所有 node-done 事件的 costUsd 之和。
 * node-done 事件 payload 含 costUsd(见 orchestrator run-orchestrator.ts emit node-done)。
 * worker/portal 产生的 node-done 都落 run_events,因此跨进程可统计。
 */
export function sumNodeDoneCostSince(db: DB, sinceIso: string): number {
  const rows = db
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .where(
      and(eq(runEvents.eventType, "node-done"), sql`${runEvents.createdAt} >= ${sinceIso}`),
    )
    .all();
  let sum = 0;
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload) as { costUsd?: number };
      if (typeof p.costUsd === "number") sum += p.costUsd;
    } catch {
      // ignore malformed payload
    }
  }
  return sum;
}

/** 入队扫描用:所有 status=approved 的契约。 */
export function listApprovedContracts(db: DB): ContractRow[] {
  return db.select().from(contracts).where(eq(contracts.status, "approved")).all();
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

/**
 * 更新项目当前绑定的 HelmCode 标准版本(控制平面回归第三刀)。
 * run 启动时调用,记录项目用的 helmcode 版本 + standards checksum。
 */
export function updateProjectStandards(
  db: DB,
  id: string,
  args: { helmcodeVersion?: string; standardsChecksum?: string },
): void {
  const setValues: Record<string, string | null> = {};
  if (args.helmcodeVersion !== undefined) setValues.helmcodeVersion = args.helmcodeVersion;
  if (args.standardsChecksum !== undefined) setValues.standardsChecksum = args.standardsChecksum;
  if (Object.keys(setValues).length === 0) return;
  db.update(projects).set(setValues).where(eq(projects.id, id)).run();
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/**
 * 清理卡死的 run/attempt。
 * 判定标准(控制平面):基于"最后活动"而非固定时长 ——
 *   runs: 最后一条 run_events 的时间(run_events.MAX(created_at),无事件 fallback startedAt),
 *         超过 thresholdMs 无进展的 running → failed。
 *   nodeAttempts: 无关联 events 表,沿用 startedAt(子粒度,跑完会更新 status)。
 * 这样有进展的长任务(编译 30min 但持续有事件)不被误杀;真卡死(无新事件)才清。
 */
export function cleanupStaleRuns(db: DB, thresholdMs: number): void {
  const cutoff = new Date(Date.now() - thresholdMs).toISOString();
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.update(nodeAttempts)
      .set({ status: "failed", finishedAt: now })
      .where(and(eq(nodeAttempts.status, "running"), lt(nodeAttempts.startedAt, cutoff)))
      .run();
    // runs: 取所有 running,逐个看最后活动是否超时(无 events 表的便捷 JOIN,逐行判断)
    const runningRows = tx
      .select({ id: runs.id, startedAt: runs.startedAt })
      .from(runs)
      .where(eq(runs.state, "running"))
      .all();
    for (const r of runningRows) {
      const lastEvt = tx
        .select({ createdAt: runEvents.createdAt })
        .from(runEvents)
        .where(eq(runEvents.runId, r.id))
        .orderBy(desc(runEvents.createdAt))
        .limit(1)
        .get();
      const lastActivity = lastEvt?.createdAt ?? r.startedAt;
      if (lastActivity < cutoff) {
        tx.update(runs)
          .set({ state: "failed", finishedAt: now })
          .where(eq(runs.id, r.id))
          .run();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 运行态查询(运行中心用)
// ---------------------------------------------------------------------------

export function listRunningRuns(db: DB, limit = 50): RunRow[] {
  return db
    .select()
    .from(runs)
    .where(eq(runs.state, "running"))
    .orderBy(desc(runs.startedAt))
    .limit(limit)
    .all();
}

export function listRecentRuns(db: DB, limit = 30): RunRow[] {
  return db
    .select()
    .from(runs)
    .orderBy(desc(runs.startedAt))
    .limit(limit)
    .all();
}

/** 批量取多个 run 的最后活动时间(运行中心列表用,避免 N+1) */
export function getRunsLastActivity(db: DB, runIds: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (runIds.length === 0) return out;
  const rows = db
    .select({ runId: runEvents.runId, createdAt: runEvents.createdAt })
    .from(runEvents)
    .where(inArray(runEvents.runId, runIds))
    .all();
  for (const r of rows) {
    const cur = out[r.runId];
    if (!cur || r.createdAt > cur) out[r.runId] = r.createdAt;
  }
  // 无事件的 fallback startedAt
  for (const id of runIds) {
    if (!out[id]) {
      const run = getRunById(db, id);
      out[id] = run?.startedAt ?? new Date(0).toISOString();
    }
  }
  return out;
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

// ---------------------------------------------------------------------------
// feature 级聚合(详情页全景用):通过 listFeatureScenarios 取 cellIds → inArray 查
// ---------------------------------------------------------------------------

/** feature 所有 cellIds(辅助) */
function featureCellIds(db: DB, featureId: string): string[] {
  return listFeatureScenarios(db, featureId).map((s) => s.id);
}

/** 该 feature 所有 cell 的契约(ORDER BY createdAt DESC) */
export function listContractsForFeature(db: DB, featureId: string): ContractRow[] {
  const ids = featureCellIds(db, featureId);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(contracts)
    .where(inArray(contracts.cellId, ids))
    .orderBy(desc(contracts.createdAt))
    .all();
}

/** 该 feature 所有 cell 的 runs(ORDER BY startedAt DESC,限 limit) */
export function listRunsForFeature(db: DB, featureId: string, limit = 50): RunRow[] {
  const ids = featureCellIds(db, featureId);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(runs)
    .where(inArray(runs.cellId, ids))
    .orderBy(desc(runs.startedAt))
    .limit(limit)
    .all();
}

// ---------------------------------------------------------------------------
// contract_sync_results — 契约状态同步引擎扫描快照
// ---------------------------------------------------------------------------

export type ContractSyncState = "matched" | "pending" | "unmatched";

export interface UpsertContractSyncResultArgs {
  projectId: string;
  contractFeatureId: string;
  state: ContractSyncState;
  confidence: number;
  chosenCellId?: string | null;
  mappedFeatureId?: string | null;
  mappedScenarioName?: string | null;
  helmcodeStatus: string;
  targetScenarioStatus?: string | null;
  candidatesJson: string;
  reasonsJson: string;
  scannedAt: string;
}

function contractSyncResultId(projectId: string, contractFeatureId: string): string {
  return `csr-${projectId}-${contractFeatureId}`;
}

/**
 * upsert 一次扫描结果。按 (projectId, contractFeatureId) 唯一约束幂等。
 * 首次插入用传入的 state;已存在则全量覆盖(重扫快照语义)。
 */
export function upsertContractSyncResult(
  db: DB,
  args: UpsertContractSyncResultArgs,
): ContractSyncResultRow {
  const id = contractSyncResultId(args.projectId, args.contractFeatureId);
  const existing = db
    .select({ id: contractSyncResults.id })
    .from(contractSyncResults)
    .where(eq(contractSyncResults.id, id))
    .get();

  if (existing) {
    db.update(contractSyncResults)
      .set({
        state: args.state,
        confidence: args.confidence,
        chosenCellId: args.chosenCellId ?? null,
        mappedFeatureId: args.mappedFeatureId ?? null,
        mappedScenarioName: args.mappedScenarioName ?? null,
        helmcodeStatus: args.helmcodeStatus,
        targetScenarioStatus: args.targetScenarioStatus ?? null,
        candidatesJson: args.candidatesJson,
        reasonsJson: args.reasonsJson,
        scannedAt: args.scannedAt,
      })
      .where(eq(contractSyncResults.id, id))
      .run();
  } else {
    db.insert(contractSyncResults)
      .values({
        id,
        projectId: args.projectId,
        contractFeatureId: args.contractFeatureId,
        state: args.state,
        confidence: args.confidence,
        chosenCellId: args.chosenCellId ?? null,
        mappedFeatureId: args.mappedFeatureId ?? null,
        mappedScenarioName: args.mappedScenarioName ?? null,
        helmcodeStatus: args.helmcodeStatus,
        targetScenarioStatus: args.targetScenarioStatus ?? null,
        candidatesJson: args.candidatesJson,
        reasonsJson: args.reasonsJson,
        scannedAt: args.scannedAt,
      })
      .run();
  }

  const row = db.select().from(contractSyncResults).where(eq(contractSyncResults.id, id)).get();
  if (!row) throw new Error(`upsertContractSyncResult: row not found: ${id}`);
  return row;
}

export function listSyncResultsByProject(
  db: DB,
  projectId: string,
): ContractSyncResultRow[] {
  return db
    .select()
    .from(contractSyncResults)
    .where(eq(contractSyncResults.projectId, projectId))
    .all();
}

export function listSyncResultsByState(
  db: DB,
  projectId: string,
  state: ContractSyncState,
): ContractSyncResultRow[] {
  return db
    .select()
    .from(contractSyncResults)
    .where(
      and(
        eq(contractSyncResults.projectId, projectId),
        eq(contractSyncResults.state, state),
      ),
    )
    .all();
}

export function getSyncResult(
  db: DB,
  projectId: string,
  contractFeatureId: string,
): ContractSyncResultRow | undefined {
  return db
    .select()
    .from(contractSyncResults)
    .where(eq(contractSyncResults.id, contractSyncResultId(projectId, contractFeatureId)))
    .get();
}

/**
 * 把指定契约的扫描结果标记为 matched(人工确认后调用)。
 */
export function markSyncResultMatched(
  db: DB,
  projectId: string,
  contractFeatureId: string,
  chosenCellId: string,
  mappedFeatureId: string,
  mappedScenarioName: string,
): void {
  db.update(contractSyncResults)
    .set({
      state: "matched",
      confidence: 1.0,
      chosenCellId,
      mappedFeatureId,
      mappedScenarioName,
    })
    .where(eq(contractSyncResults.id, contractSyncResultId(projectId, contractFeatureId)))
    .run();
}

// ---------------------------------------------------------------------------
// contract_cell_mappings — 人工维护的契约 ↔ cell 映射(启发式匹配的确定解覆盖层)
// ---------------------------------------------------------------------------

export interface UpsertContractCellMappingArgs {
  projectId: string;
  contractFeatureId: string;
  featureId: string;
  scenarioName: string;
  note?: string;
}

function contractCellMappingId(projectId: string, contractFeatureId: string): string {
  return `ccm-${projectId}-${contractFeatureId}`;
}

export function upsertContractCellMapping(
  db: DB,
  args: UpsertContractCellMappingArgs,
): ContractCellMappingRow {
  const id = contractCellMappingId(args.projectId, args.contractFeatureId);
  const now = new Date().toISOString();
  const existing = db
    .select({ id: contractCellMappings.id })
    .from(contractCellMappings)
    .where(eq(contractCellMappings.id, id))
    .get();

  if (existing) {
    db.update(contractCellMappings)
      .set({
        featureId: args.featureId,
        scenarioName: args.scenarioName,
        note: args.note ?? "",
      })
      .where(eq(contractCellMappings.id, id))
      .run();
  } else {
    db.insert(contractCellMappings)
      .values({
        id,
        projectId: args.projectId,
        contractFeatureId: args.contractFeatureId,
        featureId: args.featureId,
        scenarioName: args.scenarioName,
        note: args.note ?? "",
        createdAt: now,
      })
      .run();
  }

  const row = db.select().from(contractCellMappings).where(eq(contractCellMappings.id, id)).get();
  if (!row) throw new Error(`upsertContractCellMapping: row not found: ${id}`);
  return row;
}

export function listContractCellMappings(
  db: DB,
  projectId: string,
): ContractCellMappingRow[] {
  return db
    .select()
    .from(contractCellMappings)
    .where(eq(contractCellMappings.projectId, projectId))
    .all();
}

export function getContractCellMapping(
  db: DB,
  projectId: string,
  contractFeatureId: string,
): ContractCellMappingRow | undefined {
  return db
    .select()
    .from(contractCellMappings)
    .where(eq(contractCellMappings.id, contractCellMappingId(projectId, contractFeatureId)))
    .get();
}

// ---------------------------------------------------------------------------
// standards_migrations — HelmCode 标准版本切换审计(控制平面回归第四刀)
// ---------------------------------------------------------------------------

export type MigrationAction = "adopt" | "rollback";

export interface CreateMigrationArgs {
  projectId: string;
  fromChecksum?: string | null;
  toChecksum: string;
  fromGitHead?: string | null;
  toGitHead?: string | null;
  action: MigrationAction;
  changedFilesJson?: string;
  affectedCount?: number;
  operator?: string;
}

export function createMigration(db: DB, args: CreateMigrationArgs): StandardsMigrationRow {
  const id = `sm-${shortId()}`;
  const createdAt = new Date().toISOString();
  db.insert(standardsMigrations)
    .values({
      id,
      projectId: args.projectId,
      fromChecksum: args.fromChecksum ?? null,
      toChecksum: args.toChecksum,
      fromGitHead: args.fromGitHead ?? null,
      toGitHead: args.toGitHead ?? null,
      action: args.action,
      changedFilesJson: args.changedFilesJson ?? "[]",
      affectedCount: args.affectedCount ?? 0,
      operator: args.operator ?? "portal",
      createdAt,
    })
    .run();
  const row = db.select().from(standardsMigrations).where(eq(standardsMigrations.id, id)).get();
  if (!row) throw new Error(`createMigration: row not found: ${id}`);
  return row;
}

export function listMigrations(
  db: DB,
  projectId: string,
  limit = 20,
): StandardsMigrationRow[] {
  return db
    .select()
    .from(standardsMigrations)
    .where(eq(standardsMigrations.projectId, projectId))
    .orderBy(desc(standardsMigrations.createdAt))
    .limit(limit)
    .all();
}

/** 取最近一条 migration(用于 rollback 时定位"上一版") */
export function getLatestMigration(db: DB, projectId: string): StandardsMigrationRow | undefined {
  return db
    .select()
    .from(standardsMigrations)
    .where(eq(standardsMigrations.projectId, projectId))
    .orderBy(desc(standardsMigrations.createdAt))
    .limit(1)
    .get();
}
