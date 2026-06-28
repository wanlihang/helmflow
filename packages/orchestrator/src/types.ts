import type { NodeRunEvent } from "@helmflow/agent-runner";
import type { DB } from "@helmflow/storage";
import type { FailReason, PipelineNode } from "./state-machine";

/** 节点类型别名(旧 coder/testgen/qa/committer 已废弃,统一为 PipelineNode) */
export type OrchestratorNode = PipelineNode;

export type OrchestratorEvent =
  | { type: "orchestrator-start"; superRunId: string; cellId: string; contractId: string }
  | { type: "queued"; position: number }
  | { type: "worktree-created"; worktreePath: string; branchName: string }
  | { type: "node-start"; node: PipelineNode; iteration: number; runId: string }
  | { type: "node-event"; node: PipelineNode; event: NodeRunEvent }
  | {
      type: "node-done";
      node: PipelineNode;
      iteration: number;
      runId: string;
      success: boolean;
      turns?: number;
      durationMs?: number;
      costUsd?: number | null;
    }
  | { type: "fix-task-created"; fixTaskId: string; failedAcId: string; routeTo: PipelineNode }
  | { type: "reflection-created"; reflectionId: string; nodeName: string }
  | { type: "loop-iteration"; loop: number; maxLoops: number; routeTo: PipelineNode; infraRetry?: boolean; infraBackoffMs?: number }
  | { type: "escalate"; reason: string; loop: number }
  | { type: "worktree-merge"; success: boolean; error?: string }
  | { type: "worktree-retained"; worktreePath: string; reason: string }
  | {
      type: "pending-confirm";
      runId: string;
      worktreePath: string;
      branchName: string;
      targetBranch: string;
      mode: "local" | "deploy";
    }
  | {
      type: "done";
      success: boolean;
      commitId?: string;
      commitSha?: string;
      prUrl?: string;
      totalLoops: number;
      totalDurationMs: number;
    }
  | { type: "error"; message: string };

export interface OrchestratorOptions {
  db: DB;
  contractId: string;
  sandboxPath: string;
  portalCwd: string;
  superRunId: string;
  /** HelmCode 仓库绝对路径,用于 resolveSkillPath */
  helmcodeRoot?: string;
  /** 起始节点(默认 clarify);Plan 定稿后 Act 可传 code 跳过 clarify */
  startNode?: PipelineNode;
  emit: (event: OrchestratorEvent) => void;
}

export interface NodeRunnerResult {
  success: boolean;
  runId: string;
  /** 失败原因分类 */
  failReason?: FailReason;
  /** Critic issues (旧 node runners 兼容,deprecated) */
  issues?: Array<{ check: string; detail: string }>;
  /** QA report (旧 qa runner 兼容,deprecated) */
  report?: { acResults: Array<{ acId: string; status: string; failureReason?: string; suggestedFix?: string; tests?: string[] }>; escalateAction?: string };
  sha?: string;
  commitMessage?: string;
  commitId?: string;
  prUrl?: string;
  turns?: number;
  durationMs?: number;
  costUsd?: number;
}

/** 所有 node runner 的共有上下文 */
export interface NodeRunnerContext {
  db: DB;
  cellId: string;
  featureName: string;
  domainId: string;
  sandboxPath: string;
  iteration: number;
  helmcodeRoot?: string;
  onEvent: (event: NodeRunEvent) => void;
}