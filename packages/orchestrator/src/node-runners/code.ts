// 代码节点 — 加载 HelmCode core/implement skill,生成代码+测试+judgment-log。
// 输入:已审批契约 + standards/java-ddd/
// 输出:源代码 + 测试代码 + 判定日志
// implement 内含 verify 自愈,失败时 failReason="build-failed"

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
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
  type FixTaskRow,
  type ReflectionRow,
} from "@helmflow/storage";
import type { NodeRunnerResult } from "../types";
import {
  buildFixTaskAppendix,
  buildReflectionAppendix,
} from "../prompt-builder";

const MAX_TURNS = 40;

interface RunCodeNodeArgs {
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

function resolveStandardsRoot(): string {
  const env = process.env.HELMFLOW_JAVA_DDD_STANDARDS;
  if (env && env.length > 0) return resolve(env);
  return resolve(process.cwd(), "..", "..", "standards", "java-ddd", "patterns");
}

export async function runCodeNode(args: RunCodeNodeArgs): Promise<NodeRunnerResult> {
  const systemPrompt = loadSkillBody("implement", args.helmcodeRoot);
  const skillAdditionalDirs = resolveSkillAdditionalDirs("implement", args.helmcodeRoot);
  ensureSandboxGitInit(args.sandboxPath);
  const standardsRoot = resolveStandardsRoot();

  const run = createRun(args.db, args.cellId, "code");
  const attempt = createAttempt(args.db, run.id, "code", args.iteration, "running");

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

  const allAdditionalDirs = [standardsRoot, ...skillAdditionalDirs];

  try {
    const nodeResult = await runNode({
      cwd: args.sandboxPath,
      systemPrompt,
      userPrompt,
      allowedTools: ["Read", "Write", "Edit", "Bash"],
      maxTurns: MAX_TURNS,
      additionalDirectories: allAdditionalDirs,
      onEvent: args.onEvent,
    });

    const status = nodeResult.success ? "passed" : "failed";
    updateAttempt(args.db, attempt.id, { status });
    updateRun(args.db, run.id, nodeResult.success ? "done" : "failed");

    return {
      success: nodeResult.success,
      runId: run.id,
      failReason: nodeResult.success ? undefined : "build-failed",
      issues: nodeResult.success ? undefined : [{ check: "implement-failed", detail: nodeResult.error ?? "code node failed" }],
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
      failReason: "build-failed",
      issues: [{ check: "code-exception", detail: message }],
    };
  }
}