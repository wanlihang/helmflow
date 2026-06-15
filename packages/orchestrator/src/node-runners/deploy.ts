// 上线节点 — 加载 helmflow-deploy skill,commit+push+创建 PR。
// 这是 HelmFlow 独有的 skill,不从 HelmCode 加载。
// 失败时 failReason="git-error"

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Contract } from "@helmflow/contract-schema";
import {
  loadSkillBody,
  runNode,
  type NodeRunEvent,
} from "@helmflow/agent-runner";
import {
  createAttempt,
  createCommit,
  createRun,
  getLatestRunByKind,
  updateAttempt,
  updateRun,
  type DB,
  type ContractRow,
} from "@helmflow/storage";
import type { NodeRunnerResult } from "../types";

const MAX_TURNS = 12;

interface RunDeployNodeArgs {
  db: DB;
  cellId: string;
  featureName: string;
  domainId: string;
  contract: Contract;
  contractRow: ContractRow;
  sandboxPath: string;
  iteration: number;
  helmcodeRoot?: string;
  onEvent?: (event: NodeRunEvent) => void;
}

function extractCommitSha(text: string): string | null {
  const m = text.match(/<COMMIT_SHA>([0-9a-fA-F]{7,40})<\/COMMIT_SHA>/);
  return m && m[1] ? m[1].slice(0, 7) : null;
}

function extractPrUrl(text: string): string | null {
  const m = text.match(/<PR_URL>([^<]+)<\/PR_URL>/);
  return m && m[1] ? m[1].trim() : null;
}

function readGitLogLatest(sandboxPath: string): { sha: string; message: string } | null {
  try {
    const sha = execFileSync("git", ["log", "-1", "--format=%h"], {
      cwd: sandboxPath,
      encoding: "utf-8",
    }).trim();
    const message = execFileSync("git", ["log", "-1", "--format=%B"], {
      cwd: sandboxPath,
      encoding: "utf-8",
    }).trim();
    return { sha, message };
  } catch {
    return null;
  }
}

export async function runDeployNode(args: RunDeployNodeArgs): Promise<NodeRunnerResult> {
  // helmflow-deploy 是本地 skill,fallback 到 .claude/skills/
  const systemPrompt = loadSkillBody("helmflow-deploy", args.helmcodeRoot);

  if (!existsSync(join(args.sandboxPath, ".git"))) {
    return {
      success: false,
      runId: "",
      failReason: "git-error",
      issues: [{ check: "no-git-repo", detail: "sandbox is not a git repo" }],
    };
  }

  const coderRun = getLatestRunByKind(args.db, args.cellId, "code");
  const testRun = getLatestRunByKind(args.db, args.cellId, "test");

  const run = createRun(args.db, args.cellId, "deploy");
  const attempt = createAttempt(args.db, run.id, "deploy", args.iteration, "running");

  const acIds = args.contract.acceptanceCriteria.map((a) => a.id);

  const userPrompt = `## 上线任务

你正在 \`${args.sandboxPath}\` 的 sandbox 项目里工作。请按 system prompt (helmflow-deploy skill) 的规范,
把当前改动 commit + push + 创建 PR。

- featureId: \`${args.cellId}\`
- name: \`${args.featureName}\`
- domain: \`${args.domainId}\`
- contractId: \`${args.contractRow.id}\`
- contract markdown: \`${args.contractRow.markdownPath}\`
- codeRunId: \`${coderRun?.id ?? "(unknown)"}\`
- testRunId: \`${testRun?.id ?? "(unknown)"}\`
- 覆盖的 AC:${acIds.join(", ")}

按 SKILL 中的工作流执行:
1. git status --porcelain 确认变更范围
2. git diff 确认内容匹配 feature
3. git checkout -b feat/<featureId>-<scenarioName>
4. git add src/
5. git commit (Conventional Commits 格式,含 contractId+AC 列表)
6. git push origin <branch>
7. 创建 PR (通过 gh CLI)
8. 输出 <PR_URL>...</PR_URL>
`;

  const collectedText: string[] = [];

  try {
    const nodeResult = await runNode({
      cwd: args.sandboxPath,
      systemPrompt,
      userPrompt,
      allowedTools: ["Read", "Bash"],
      maxTurns: MAX_TURNS,
      onEvent: (event: NodeRunEvent) => {
        if (event.type === "assistant.text") {
          collectedText.push(event.text);
        }
        args.onEvent?.(event);
      },
    });

    if (!nodeResult.success) {
      updateAttempt(args.db, attempt.id, { status: "failed" });
      updateRun(args.db, run.id, "failed");
      return {
        success: false,
        runId: run.id,
        failReason: "git-error",
        issues: [{ check: "deploy-failed", detail: nodeResult.error ?? "deploy node failed" }],
        turns: nodeResult.turns,
        durationMs: nodeResult.durationMs,
        costUsd: nodeResult.costUsd,
      };
    }

    const fullText = collectedText.join("");
    const sha = extractCommitSha(fullText) ?? readGitLogLatest(args.sandboxPath)?.sha ?? null;
    const message = readGitLogLatest(args.sandboxPath)?.message ?? "(git log failed)";
    const prUrl = extractPrUrl(fullText);

    if (!sha) {
      updateAttempt(args.db, attempt.id, { status: "failed" });
      updateRun(args.db, run.id, "failed");
      return {
        success: false,
        runId: run.id,
        failReason: "git-error",
        issues: [{ check: "no-commit-sha", detail: "Cannot extract commit SHA from model output or git log" }],
        turns: nodeResult.turns,
        durationMs: nodeResult.durationMs,
        costUsd: nodeResult.costUsd,
      };
    }

    if (!message.includes(args.contractRow.id)) {
      updateAttempt(args.db, attempt.id, { status: "failed" });
      updateRun(args.db, run.id, "failed");
      return {
        success: false,
        runId: run.id,
        sha,
        commitMessage: message,
        failReason: "git-error",
        issues: [{ check: "missing-contract-id", detail: `commit message missing contractId (${args.contractRow.id})` }],
        turns: nodeResult.turns,
        durationMs: nodeResult.durationMs,
        costUsd: nodeResult.costUsd,
      };
    }

    const commitRow = createCommit(args.db, {
      cellId: args.cellId,
      contractId: args.contractRow.id,
      coderRunId: coderRun?.id ?? null,
      testgenRunId: testRun?.id ?? null,
      qaRunId: null,
      committerRunId: run.id,
      gitSha: sha,
      message,
    });

    updateAttempt(args.db, attempt.id, { status: "passed", outputPath: sha });
    updateRun(args.db, run.id, "done");

    return {
      success: true,
      runId: run.id,
      sha,
      commitMessage: message,
      commitId: commitRow.id,
      prUrl: prUrl ?? undefined,
      turns: nodeResult.turns,
      durationMs: nodeResult.durationMs,
      costUsd: nodeResult.costUsd,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    updateAttempt(args.db, attempt.id, { status: "failed" });
    updateRun(args.db, run.id, "failed");
    return {
      success: false,
      runId: run.id,
      failReason: "git-error",
      issues: [{ check: "deploy-exception", detail: errMsg }],
    };
  }
}