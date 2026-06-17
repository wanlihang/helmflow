// 测试节点 — 加载 HelmCode core/verify skill,独立回归验证。
// B 方案:implement 已自带 verify 自愈,此节点只做最终确认。
// 全绿 → 通过 / 有失败 → 回退代码节点, failReason="test-failed"

import type { Contract } from "@helmflow/contract-schema";
import { HelmcodeManager } from "@helmflow/helmcode-manager";
import {
  runNode,
  type NodeRunEvent,
} from "@helmflow/agent-runner";
import {
  createAttempt,
  createRun,
  updateAttempt,
  updateRun,
  type DB,
} from "@helmflow/storage";
import type { NodeRunnerResult } from "../types";

const MAX_TURNS = 20;

interface RunTestNodeArgs {
  db: DB;
  cellId: string;
  featureName: string;
  domainId: string;
  contract: Contract;
  contractMarkdown: string;
  sandboxPath: string;
  portalCwd: string;
  iteration: number;
  helmcodeRoot?: string;
  onEvent?: (event: NodeRunEvent) => void;
}

export async function runTestNode(args: RunTestNodeArgs): Promise<NodeRunnerResult> {
  const manager = args.helmcodeRoot ? new HelmcodeManager({ helmcodeRoot: args.helmcodeRoot, preset: "java-ddd" }) : undefined;
  const versionInfo = manager?.getVersion();
  const systemPrompt = manager ? manager.loadSkillBody("verify") : "";
  const skillAdditionalDirs = manager ? manager.resolveSkillAdditionalDirs("verify") : [];

  const run = createRun(args.db, args.cellId, "test");
  const attempt = createAttempt(args.db, run.id, "test", args.iteration, "running", versionInfo ? { version: versionInfo.helmcode, checksum: versionInfo.checksum } : undefined);

  const acIds = args.contract.acceptanceCriteria.map((a) => a.id).join(", ");

  const userPrompt = `## 测试确认任务

你正在 \`${args.sandboxPath}\` 的 sandbox 项目里工作。请按 system prompt (HelmCode verify skill) 的规范,
对以下 feature 进行独立回归验证。

- featureId: \`${args.cellId}\`
- name: \`${args.featureName}\`
- domain: \`${args.domainId}\`
- 覆盖的 AC: ${acIds}

## Contract (参考)

${args.contractMarkdown}

## 验证要求

1. 跑 \`mvn compile\` + \`mvn test\`,确认全绿
2. 验证字段同步:契约中的 Domain Model 字段是否与代码一致
3. 验证架构合规:Handler/Action 结构是否符合 DDD 规范
4. 逐项确认 AC:每条 AC 都有对应测试覆盖且通过
5. 产出验证报告

如果验证通过,输出 \`VERIFICATION_PASSED\` 作为最后一行。
如果任何项失败,输出失败详情和 \`VERIFICATION_FAILED\`。
`;

  try {
    const nodeResult = await runNode({
      cwd: args.sandboxPath,
      systemPrompt,
      userPrompt,
      allowedTools: ["Read", "Bash", "Glob", "Grep"],
      maxTurns: MAX_TURNS,
      additionalDirectories: skillAdditionalDirs.length > 0 ? skillAdditionalDirs : undefined,
      onEvent: args.onEvent,
    });

    const status = nodeResult.success ? "passed" : "failed";
    updateAttempt(args.db, attempt.id, { status });
    updateRun(args.db, run.id, nodeResult.success ? "done" : "failed");

    return {
      success: nodeResult.success,
      runId: run.id,
      failReason: nodeResult.success ? undefined : "test-failed",
      issues: nodeResult.success ? undefined : [{ check: "verify-failed", detail: nodeResult.error ?? "test node failed" }],
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
      failReason: "test-failed",
      issues: [{ check: "test-exception", detail: message }],
    };
  }
}