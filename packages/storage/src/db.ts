import type BetterSqlite3 from "better-sqlite3";
import { createRequire } from "node:module";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

declare const __non_webpack_require__:
  | ((id: string) => unknown)
  | undefined;

function loadBetterSqlite3(): typeof BetterSqlite3 {
  const requireFn =
    typeof __non_webpack_require__ === "function"
      ? __non_webpack_require__
      : createRequire(import.meta.url);
  return requireFn("better-sqlite3") as typeof BetterSqlite3;
}

const Database = loadBetterSqlite3();

export type DB = BetterSQLite3Database<typeof schema>;

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT,
  scenarios_json TEXT,
  handler TEXT NOT NULL DEFAULT '',
  actions TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT '',
  legacy_flow_code TEXT NOT NULL DEFAULT '',
  legacy_activities TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_scenarios (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL REFERENCES features(id),
  scenario_name TEXT NOT NULL,
  scenario_status TEXT NOT NULL,
  agent_status TEXT NOT NULL DEFAULT 'not-started',
  note TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feature_scenarios_feature_id ON feature_scenarios(feature_id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL REFERENCES feature_scenarios(id),
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_cell_id ON runs(cell_id);

CREATE TABLE IF NOT EXISTS node_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  node_name TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  status TEXT NOT NULL,
  output_path TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  standards_version TEXT,
  standards_checksum TEXT
);

CREATE INDEX IF NOT EXISTS idx_node_attempts_run_id ON node_attempts(run_id);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL REFERENCES feature_scenarios(id),
  status TEXT NOT NULL,
  markdown_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_contracts_cell_id ON contracts(cell_id);

CREATE TABLE IF NOT EXISTS commits (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL REFERENCES feature_scenarios(id),
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  coder_run_id TEXT,
  testgen_run_id TEXT,
  qa_run_id TEXT,
  committer_run_id TEXT NOT NULL,
  git_sha TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commits_cell_id ON commits(cell_id);

CREATE TABLE IF NOT EXISTS fix_tasks (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL REFERENCES feature_scenarios(id),
  source_run_id TEXT NOT NULL,
  failed_ac_id TEXT NOT NULL,
  expected_behavior TEXT NOT NULL,
  actual_behavior TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fix_tasks_cell_id ON fix_tasks(cell_id);

CREATE TABLE IF NOT EXISTS reflections (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL REFERENCES feature_scenarios(id),
  attempt_id TEXT,
  node_name TEXT NOT NULL,
  critic_name TEXT,
  failure_summary TEXT NOT NULL,
  reflection_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reflections_cell_id ON reflections(cell_id);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  sandbox_path TEXT NOT NULL,
  standards_root TEXT,
  feature_matrix_path TEXT NOT NULL,
  repo_url TEXT,
  description TEXT,
  manifest_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  registered_at INTEGER NOT NULL,
  helmcode_version TEXT,
  standards_checksum TEXT
);

CREATE TABLE IF NOT EXISTS contract_sync_results (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  contract_feature_id TEXT NOT NULL,
  state TEXT NOT NULL,
  confidence REAL NOT NULL,
  chosen_cell_id TEXT,
  mapped_feature_id TEXT,
  mapped_scenario_name TEXT,
  helmcode_status TEXT NOT NULL,
  target_scenario_status TEXT,
  candidates_json TEXT NOT NULL DEFAULT '[]',
  reasons_json TEXT NOT NULL DEFAULT '[]',
  scanned_at TEXT NOT NULL,
  UNIQUE(project_id, contract_feature_id)
);

CREATE INDEX IF NOT EXISTS idx_csr_project_state ON contract_sync_results(project_id, state);

CREATE TABLE IF NOT EXISTS contract_cell_mappings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  contract_feature_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  scenario_name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(project_id, contract_feature_id)
);

CREATE INDEX IF NOT EXISTS idx_ccm_project ON contract_cell_mappings(project_id);

CREATE TABLE IF NOT EXISTS standards_migrations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_checksum TEXT,
  to_checksum TEXT NOT NULL,
  from_git_head TEXT,
  to_git_head TEXT,
  action TEXT NOT NULL,
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  affected_count INTEGER NOT NULL DEFAULT 0,
  operator TEXT NOT NULL DEFAULT 'portal',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sm_project ON standards_migrations(project_id);

CREATE TABLE IF NOT EXISTS pipeline_queue (
  id TEXT PRIMARY KEY,
  cell_id TEXT NOT NULL REFERENCES feature_scenarios(id),
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  state TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  claimed_by TEXT,
  claimed_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_queue_state ON pipeline_queue(state);
CREATE INDEX IF NOT EXISTS idx_pipeline_queue_cell_id ON pipeline_queue(cell_id);
`;

const MIGRATION_DDL = `
-- Goal 13: features 新列
ALTER TABLE features ADD COLUMN handler TEXT NOT NULL DEFAULT '';
ALTER TABLE features ADD COLUMN actions TEXT NOT NULL DEFAULT '';
ALTER TABLE features ADD COLUMN context TEXT NOT NULL DEFAULT '';
ALTER TABLE features ADD COLUMN priority TEXT NOT NULL DEFAULT '';
ALTER TABLE features ADD COLUMN legacy_flow_code TEXT NOT NULL DEFAULT '';
ALTER TABLE features ADD COLUMN legacy_activities TEXT NOT NULL DEFAULT '';
-- 分层归属扩展(Decider/Acceptor)
ALTER TABLE features ADD COLUMN decider TEXT NOT NULL DEFAULT '';
ALTER TABLE features ADD COLUMN acceptor TEXT NOT NULL DEFAULT '';
-- Goal 13: feature_scenarios 新列
ALTER TABLE feature_scenarios ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
-- 控制平面回归: contracts 加列(为 HelmCode 契约导入铺路,第一刀不写入)
ALTER TABLE contracts ADD COLUMN source TEXT NOT NULL DEFAULT 'clarifier';
ALTER TABLE contracts ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
ALTER TABLE contracts ADD COLUMN origin_path TEXT NOT NULL DEFAULT '';
-- 控制平面回归第三刀: 版本感知(projects + node_attempts)
ALTER TABLE projects ADD COLUMN helmcode_version TEXT;
ALTER TABLE projects ADD COLUMN standards_checksum TEXT;
ALTER TABLE node_attempts ADD COLUMN standards_version TEXT;
ALTER TABLE node_attempts ADD COLUMN standards_checksum TEXT;
`;

const cache = new Map<string, DB>();

export function createDb(path: string): DB {
  const cached = cache.get(path);
  if (cached) return cached;
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(SCHEMA_DDL);
  // 运行增量迁移 — 逐条执行,各自忽略 "duplicate column"(列已存在),其它错误抛出。
  // 先整体剥离 SQL 行注释(-- ...),再按分号切分,避免注释与语句混在同一块导致误跳过。
  const noComments = MIGRATION_DDL
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  for (const stmt of noComments.split(";")) {
    const trimmed = stmt.trim();
    if (trimmed.length === 0) continue;
    try {
      sqlite.exec(trimmed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("duplicate column name")) {
        throw err; // re-throw real migration failures
      }
    }
  }
  const db = drizzle(sqlite, { schema });
  cache.set(path, db);
  return db;
}
