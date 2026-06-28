// 代码节点 — 加载 HelmCode core/implement skill,生成代码+测试+judgment-log。
// 输入:已审批契约 + standards/java-ddd/
// 输出:源代码 + 测试代码 + 判定日志
// implement 内含 verify 自愈,失败时 failReason="build-failed"

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Contract } from "@helmflow/contract-schema";
import { HelmcodeManager } from "@helmflow/helmcode-manager";
import {
  classifyError,
  runNode,
  type NodeRunEvent,
} from "@helmflow/agent-runner";
import { mapFailReason } from "./fail-reason";
import { buildCodeCheckPrompt, getSelfCheckRounds, runSelfCheck } from "./self-check";
import {
  createAttempt,
  createRun,
  updateAttempt,
  updateRun,
  type DB,
  type FixTaskRow,
  type ReflectionRow,
} from "@helmflow/storage";
import type { NodeRunnerResult } from "../types";
import {
  buildFixTaskAppendix,
  buildReflectionAppendix,
} from "../prompt-builder";

// 不限制 turn:单 session 跑到自然完成(stop),不切碎。
const MAX_TURNS = Number.MAX_SAFE_INTEGER;

interface RunCodeNodeArgs {
  db: DB;
  cellId: string;
  /** 需求驱动通路:requirement-owned 时填 requirementId */
  requirementId?: string | null;
  featureName: string;
  domainId: string;
  contract: Contract;
  contractMarkdown: string;
  sandboxPath: string;
  iteration: number;
  helmcodeRoot?: string;
  reflections?: ReflectionRow[];
  fixTasks?: FixTaskRow[];
  onEvent?: (event: NodeRunEvent) => void;
}

function ensureSandboxGitInit(sandboxPath: string): void {
  if (existsSync(join(sandboxPath, ".git"))) return;
  execFileSync("git", ["init", "-q"], { cwd: sandboxPath });
  execFileSync("git", ["add", "-A"], { cwd: sandboxPath });
  try {
    execFileSync("git", ["config", "user.email", "coder@helmflow.local"], {
      cwd: sandboxPath,
    });
    execFileSync("git", ["config", "user.name", "HelmFlow Code Node"], {
      cwd: sandboxPath,
    });
  } catch {
    // ignore
  }
  execFileSync(
    "git",
    ["commit", "-q", "--allow-empty", "-m", "baseline before HelmFlow Code Node"],
    { cwd: sandboxPath },
  );
}

export async function runCodeNode(args: RunCodeNodeArgs): Promise<NodeRunnerResult> {
  const manager = args.helmcodeRoot ? new HelmcodeManager({ helmcodeRoot: args.helmcodeRoot, preset: "java-ddd" }) : undefined;
  const versionInfo = manager?.getVersion();
  const systemPrompt = manager ? manager.loadSkillBody("implement") : "";
  // patterns + skill references + standards,统一走 manager(替代硬编码 resolveStandardsRoot)
  const allAdditionalDirs = manager
    ? [manager.resolvePatterns(), ...manager.resolveSkillAdditionalDirs("implement")]
    : [];
  ensureSandboxGitInit(args.sandboxPath);

  const run = createRun(args.db, args.cellId, "code", undefined, args.requirementId ?? undefined);
  const attempt = createAttempt(args.db, run.id, "code", args.iteration, "running", versionInfo ? { version: versionInfo.helmcode, checksum: versionInfo.checksum } : undefined);

  const reflectionAppendix = buildReflectionAppendix(args.reflections ?? []);
  const fixTaskAppendix = buildFixTaskAppendix(args.fixTasks ?? []);

  const userPrompt = `## 代码实现任务

你正在 \`${args.sandboxPath}\` 的 sandbox 项目里工作。请按 system prompt (HelmCode implement skill) 的规范,
根据下面这份已审批的行为契约,生成强自包含的代码并自驱编译+测试通过。

- featureId: ${args.cellId}
- name: ${args.featureName}
- domain: ${args.domainId}

## Approved Contract

${args.contractMarkdown}
${fixTaskAppendix}${reflectionAppendix}

## 关键要求

1. 按 implement skill 的 context-loader 规则加载上下文
2. 生成 Handler/Action/Context + 测试代码
3. 自驱 \`mvn compile\` + \`mvn test\` 通过 (Tests run >= 1)
4. 如有决策,产出 judgment-log (JD-NNN)
5. implement 内置 verify 自愈:编译/测试失败时自动修复
`;

  try {
    const nodeResult = await runNode({
      cwd: args.sandboxPath,
      systemPrompt,
      userPrompt,
      allowedTools: ["Read", "Write", "Edit", "Bash"],
      maxTurns: MAX_TURNS,
      maxTurnsPerSession: MAX_TURNS,
      additionalDirectories: allAdditionalDirs,
      onEvent: args.onEvent,
    });

    // 对抗式自检:主实现成功后,resume 续接对照 BR/AC 找遗漏(默认1轮,env
    // HELMFLOW_SELF_CHECK_ROUNDS 可配,封顶3)。依据 Self-Refine:第1轮收益最大;
    // Reflexion:对抗式 framing 缓解 sycophancy。自检失败不阻塞主结果。
    let checkTurns = 0;
    let checkDurationMs = 0;
    let checkCostUsd = 0;
    if (nodeResult.success) {
      const rounds = getSelfCheckRounds();
      if (rounds > 0) {
        try {
          const chk = await runSelfCheck({
            sandboxPath: args.sandboxPath,
            systemPrompt,
            primarySessionId: nodeResult.sessionId,
            rounds,
            prompt: buildCodeCheckPrompt(args.contract),
            onEvent: args.onEvent,
          });
          checkTurns = chk.turns;
          checkDurationMs = chk.durationMs;
          checkCostUsd = chk.costUsd ?? 0;
        } catch {
          // 自检失败不阻塞:主实现已成功,自检仅额外补全
        }
      }
    }

    const status = nodeResult.success ? "passed" : "failed";
    updateAttempt(args.db, attempt.id, { status });
    updateRun(args.db, run.id, nodeResult.success ? "done" : "failed");

    const totalCostUsd = (nodeResult.costUsd ?? 0) + checkCostUsd;
    return {
      success: nodeResult.success,
      runId: run.id,
      failReason: mapFailReason(nodeResult.success, nodeResult.errorKind, "build-failed"),
      issues: nodeResult.success ? undefined : [{ check: "implement-failed", detail: nodeResult.error ?? "code node failed" }],
      turns: nodeResult.turns + checkTurns,
      durationMs: nodeResult.durationMs + checkDurationMs,
      costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateAttempt(args.db, attempt.id, { status: "failed" });
    updateRun(args.db, run.id, "failed");
    return {
      success: false,
      runId: run.id,
      failReason: classifyError(message) === "transient-infra" ? "infra-error" : "build-failed",
      issues: [{ check: "code-exception", detail: message }],
    };
  }
}