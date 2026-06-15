import type { NodeRunEvent } from "@helmflow/agent-runner";
import type { DB } from "@helmflow/storage";
import type { FailReason, PipelineNode } from "./state-machine";

/** 旧 4 节点类型(向后兼容,deprecated) */
export type OrchestratorNode = PipelineNode | "coder" | "testgen" | "qa" | "committer";

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
  | { type: "loop-iteration"; loop: number; maxLoops: number; routeTo: PipelineNode }
  | { type: "escalate"; reason: string; loop: number }
  | { type: "worktree-merge"; success: boolean; error?: string }
  | { type: "worktree-retained"; worktreePath: string; reason: string }
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