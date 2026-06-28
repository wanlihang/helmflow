// 测试/判定节点 — 加载 HelmCode core/verify skill,独立回归验证 + 产出结构化判定产物(QA report)。
// B 方案:implement 已自带 verify 自愈,此节点做最终独立判定(judge)。
// 产物:QA report YAML 写到 data/qa-reports/{key}/,场景页/合并门槛面板展示。
// 成败依据 <VERIFY_REPORT> 的 verdict(修正旧版"agent 自然停就算过"的判定 bug)。
// 全绿 → 通过 / 有失败 → 回退代码节点, failReason="test-failed",result.report 触发 fix-task 回路。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { Contract } from "@helmflow/contract-schema";
import { HelmcodeManager } from "@helmflow/helmcode-manager";
import {
  classifyError,
  runNode,
  type NodeRunEvent,
} from "@helmflow/agent-runner";
import { mapFailReason } from "./fail-reason";
import { buildTestCheckPrompt, getSelfCheckRounds, runSelfCheck } from "./self-check";
import {
  createAttempt,
  createRun,
  updateAttempt,
  updateRun,
  type DB,
} from "@helmflow/storage";
import type { NodeRunnerResult } from "../types";

// 不限制 turn:单 session 跑到自然完成(stop),不切碎。
const MAX_TURNS = Number.MAX_SAFE_INTEGER;

interface ParsedAcResult {
  acId?: string;
  status?: string;
  evidence?: string;
}
interface ParsedVerifyReport {
  verdict?: "pass" | "fail";
  summary?: string;
  acResults?: ParsedAcResult[];
}

/** 从 agent 输出文本提取 <VERIFY_REPORT>JSON</VERIFY_REPORT>。 */
function extractVerifyReport(text: string): ParsedVerifyReport | null {
  const m = text.match(/<VERIFY_REPORT>\s*([\s\S]*?)<\/VERIFY_REPORT>/);
  if (!m?.[1]) return null;
  try {
    let raw = m[1].trim();
    const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fence?.[1]) raw = fence[1].trim();
    const parsed = JSON.parse(raw) as ParsedVerifyReport;
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

/** QA 产物落盘 key:需求走 req-<id>,cell 走 cellId。 */
function qaReportKey(cellId: string, requirementId?: string | null): string {
  return requirementId ? `req-${requirementId}` : cellId;
}

interface RunTestNodeArgs {
  db: DB;
  cellId: string;
  /** 需求驱动通路:requirement-owned 时填 requirementId */
  requirementId?: string | null;
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

  const run = createRun(args.db, args.cellId, "test", undefined, args.requirementId ?? undefined);
  const attempt = createAttempt(args.db, run.id, "test", args.iteration, "running", versionInfo ? { version: versionInfo.helmcode, checksum: versionInfo.checksum } : undefined);

  const acIds = args.contract.acceptanceCriteria.map((a) => a.id).join(", ");

  const userPrompt = `## 测试确认任务

你正在 \`${args.sandboxPath}\` 的 sandbox 项目里工作。请按 system prompt (HelmCode verify skill) 的规范,
对以下 feature 进行独立回归验证(判定/judge)。

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
4. 逐项判定 AC:每条 AC 是否有对应测试覆盖且通过

## 判定产物(必须输出)

在回复最后输出一个判定块,供平台采集为测试产物(不要用工具写文件,直接输出此 JSON 块):

<VERIFY_REPORT>
{"verdict":"pass 或 fail","summary":"一句话总体结论","acResults":[{"acId":"AC-001","status":"pass 或 fail","evidence":"依据(测试名/行号/原因)"}]}
</VERIFY_REPORT>

- verdict=pass 当且仅当所有 AC 均通过且编译测试全绿;否则 fail。
- acResults 必须覆盖上述每一条 AC。
`;

  const collectedText: string[] = [];

  try {
    const nodeResult = await runNode({
      cwd: args.sandboxPath,
      systemPrompt,
      userPrompt,
      allowedTools: ["Read", "Bash", "Glob", "Grep"],
      maxTurns: MAX_TURNS,
      maxTurnsPerSession: MAX_TURNS,
      additionalDirectories: skillAdditionalDirs.length > 0 ? skillAdditionalDirs : undefined,
      onEvent: (event: NodeRunEvent) => {
        if (event.type === "assistant.text") collectedText.push(event.text);
        args.onEvent?.(event);
      },
    });

    const fullText = collectedText.join("");
    const report = extractVerifyReport(fullText);

    // 判定依据:结构化 verdict 优先 → 文本 VERIFICATION_PASSED/FAILED 兜底 → runNode.success 末位
    let success: boolean;
    if (report?.verdict) {
      success = report.verdict === "pass";
    } else if (/VERIFICATION_FAILED/i.test(fullText)) {
      success = false;
    } else if (/VERIFICATION_PASSED/i.test(fullText)) {
      success = true;
    } else {
      success = nodeResult.success;
    }

    // 写 QA 产物 YAML(无论成败,都落盘供展示)
    const acResults = (report?.acResults ?? []).map((a) => ({
      acId: a.acId ?? "(unknown)",
      status: a.status === "fail" ? "fail" : "pass",
      failureReason: a.status === "fail" ? a.evidence ?? "" : undefined,
    }));
    const passed = acResults.filter((a) => a.status === "pass").length;
    const failed = acResults.filter((a) => a.status === "fail").length;
    try {
      const key = qaReportKey(args.cellId, args.requirementId);
      const dir = join(args.portalCwd, "data", "qa-reports", key);
      const qaReport = {
        featureId: args.requirementId ?? args.cellId,
        runAt: new Date().toISOString(),
        verdict: success ? "pass" : "fail",
        summary: report?.summary ?? "",
        lenient: { totalRun: acResults.length, passed, failed },
        acResults,
        gapsDetected: 0,
        escalateAction: success ? "none" : "route-to-code",
      };
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${run.id}.yaml`), stringifyYaml(qaReport), "utf-8");
    } catch {
      /* 产物落盘失败不阻塞判定 */
    }

    // 对抗式自检:测试通过后,resume 续接对照 AC 找测试覆盖遗漏(默认1轮,可配,封顶3)。自检失败不阻塞。
    let checkTurns = 0;
    let checkDurationMs = 0;
    let checkCostUsd = 0;
    if (success) {
      const rounds = getSelfCheckRounds();
      if (rounds > 0) {
        try {
          const chk = await runSelfCheck({
            sandboxPath: args.sandboxPath,
            systemPrompt,
            primarySessionId: nodeResult.sessionId,
            rounds,
            prompt: buildTestCheckPrompt(args.contract),
            onEvent: args.onEvent,
          });
          checkTurns = chk.turns;
          checkDurationMs = chk.durationMs;
          checkCostUsd = chk.costUsd ?? 0;
        } catch {
          // 自检失败不阻塞
        }
      }
    }

    const status = success ? "passed" : "failed";
    updateAttempt(args.db, attempt.id, { status });
    updateRun(args.db, run.id, success ? "done" : "failed");

    return {
      success,
      runId: run.id,
      failReason: mapFailReason(success, nodeResult.errorKind, "test-failed"),
      issues: success
        ? undefined
        : [
            {
              check: "verify-failed",
              detail: report?.summary ?? (failed > 0 ? `${failed} 个 AC 未通过` : "test node failed"),
            },
          ],
      // result.report 触发 orchestrator 的 fix-task 回路(失败 AC → 回 code 节点)
      report:
        acResults.length > 0
          ? {
              acResults: acResults.map((a) => ({
                acId: a.acId,
                status: a.status,
                failureReason: a.failureReason,
              })),
              escalateAction: success ? "none" : "route-to-code",
            }
          : undefined,
      turns: nodeResult.turns + checkTurns,
      durationMs: nodeResult.durationMs + checkDurationMs,
      costUsd: (nodeResult.costUsd ?? 0) + checkCostUsd || undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateAttempt(args.db, attempt.id, { status: "failed" });
    updateRun(args.db, run.id, "failed");
    return {
      success: false,
      runId: run.id,
      failReason: classifyError(message) === "transient-infra" ? "infra-error" : "test-failed",
      issues: [{ check: "test-exception", detail: message }],
    };
  }
}
