// 需求节点 — 加载 HelmCode core/clarify skill,产出行为契约。
// 输入:用户自然语言需求 + Feature 元数据
// 输出:行为契约 (含 domain model / schema changes / compatibility)
// 失败时 failReason="spec-rejected"

import type { Contract } from "@helmflow/contract-schema";
import {
  loadSkillBody,
  resolveSkillAdditionalDirs,
  runNode,
  type NodeRunEvent,
} from "@helmflow/agent-runner";
import {
  createAttempt,
  createRun,
  updateAttempt,
  updateRun,
  type DB,
  type ReflectionRow,
} from "@helmflow/storage";
import type { NodeRunnerResult } from "../types";
import { buildReflectionAppendix } from "../prompt-builder";

const MAX_TURNS = 25;

interface RunRequireNodeArgs {
  db: DB;
  cellId: string;
  featureName: string;
  domainId: string;
  contract: Contract;
  contractMarkdown: string;
  sandboxPath: string;
  iteration: number;
  helmcodeRoot?: string;
  reflections?: ReflectionRow[];
  onEvent?: (event: NodeRunEvent) => void;
}

export async function runRequireNode(args: RunRequireNodeArgs): Promise<NodeRunnerResult> {
  const systemPrompt = loadSkillBody("clarify", args.helmcodeRoot);
  const additionalDirs = resolveSkillAdditionalDirs("clarify", args.helmcodeRoot);

  const run = createRun(args.db, args.cellId, "require");
  const attempt = createAttempt(args.db, run.id, "require", args.iteration, "running");

  const reflectionAppendix = buildReflectionAppendix(args.reflections ?? []);

  const acIds = args.contract.acceptanceCriteria.map((a) => a.id).join(", ");
  const brIds = args.contract.businessRules.map((b) => b.id).join(", ");

  const userPrompt = `## 需求澄清任务

你正在为 HelmFlow 平台的需求节点工作。请按 system prompt (HelmCode clarify skill) 的规范,
对以下 feature 进行需求澄清,产出完整的行为契约。

- featureId: \`${args.cellId}\`
- name: \`${args.featureName}\`
- domain: \`${args.domainId}\`
- 已有 AC: ${acIds || "(无)"}
- 已有 BR: ${brIds || "(无)"}

## 已有契约内容 (参考/改进)

${args.contractMarkdown}
${reflectionAppendix}

## 要求

1. 按三维度框架澄清 (P0 范围/规则/AC, P1 API边界/兼容, P2 性能/安全)
2. 产出完整的行为契约,包含:
   - Problem Definition
   - State Machine
   - Business Rules (BR-NNN)
   - Acceptance Criteria (AC-NNN, 含可验证关键字)
   - API Contract
   - Domain Model
   - Schema Changes (如有)
   - Compatibility Constraints (如有)
3. 如果已有契约内容足够精确,请确认并补充缺失部分
`;

  try {
    const nodeResult = await runNode({
      cwd: args.sandboxPath,
      systemPrompt,
      userPrompt,
      allowedTools: ["Read", "Bash", "Glob", "Grep"],
      maxTurns: MAX_TURNS,
      additionalDirectories: additionalDirs.length > 0 ? additionalDirs : undefined,
      onEvent: args.onEvent,
    });

    const status = nodeResult.success ? "passed" : "failed";
    updateAttempt(args.db, attempt.id, { status });
    updateRun(args.db, run.id, nodeResult.success ? "done" : "failed");

    return {
      success: nodeResult.success,
      runId: run.id,
      failReason: nodeResult.success ? undefined : "spec-rejected",
      issues: nodeResult.success ? undefined : [{ check: "clarify-failed", detail: nodeResult.error ?? "require node failed" }],
      turns: nodeResult.turns,
      durationMs: nodeResult.durationMs,
      costUsd: nodeResult.costUsd,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateAttempt(args.db, attempt.id, { status: "failed" });
    updateRun(args.db, run.id, "failed");
    return {
      success: false,
      runId: run.id,
      failReason: "spec-rejected",
      issues: [{ check: "require-exception", detail: message }],
    };
  }
}