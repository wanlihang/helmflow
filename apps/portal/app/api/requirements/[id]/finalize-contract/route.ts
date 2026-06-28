// POST /api/requirements/[id]/finalize-contract — 显式「生成契约」。
// resume 同一对话 session,发采集覆盖指令让 Claude 按模板输出完整契约 markdown →
// parseContract + runClarifierCritic(2 轮) → 写 R-<id>.md → createContract(draft)。

import { getDb } from "@/lib/db";
import {
  buildReflection,
  CONTRACT_FINALIZE_OVERRIDE,
  hashMarkdown,
  synthesizeRequirementContractHeader,
  validateContractMarkdown,
  writeRequirementContractFile,
} from "@/lib/requirement-contract";
import { isString, resolveSandboxPathForProject } from "@/lib/server-utils";
import { type NodeRunEvent, runNode } from "@helmflow/agent-runner";
import { getProject } from "@helmflow/manifest-loader";
import { HelmcodeManager } from "@helmflow/helmcode-manager";
import {
  type OrchestratorEvent,
  createRunEmitter,
  emitEvent,
  scheduleEmitterCleanup,
} from "@helmflow/orchestrator";
import {
  VIRTUAL_CELL_ID,
  createContract,
  createRun,
  createRunEvent,
  getRequirement,
  getRuntimeSettings,
  updateRequirementAgentStatus,
  updateRequirementStatus,
  updateRun,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROUNDS = 2;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const { id } = await ctx.params;
  const db = getDb();
  const requirement = getRequirement(db, id);
  if (!requirement) {
    return NextResponse.json({ error: `Requirement not found: ${id}` }, { status: 404 });
  }
  if (!requirement.sessionId) {
    return NextResponse.json(
      { error: "需要先发送至少一条消息开始对话,再生成契约" },
      { status: 400 },
    );
  }
  if (requirement.status === "abandoned" || requirement.status === "done") {
    return NextResponse.json(
      { error: `Requirement is ${requirement.status}` },
      { status: 400 },
    );
  }

  const sandboxPath = await resolveSandboxPathForProject(requirement.projectId);
  const projectInfo = getProject(requirement.projectId);
  const helmcodeRoot = projectInfo?.helmcodeRoot;
  // HelmcodeManager 加载 clarify references(契约模板),让模型 finalize 时有固定格式靶子。
  const manager =
    helmcodeRoot && projectInfo
      ? new HelmcodeManager({ helmcodeRoot, preset: projectInfo.manifest.adapterType })
      : undefined;

  let skillBody = "";
  let additionalDirs: string[] = [];
  if (manager) {
    try {
      skillBody = manager.loadSkillBody("clarify");
      additionalDirs = manager.resolveSkillAdditionalDirs("clarify");
    } catch {
      /* skill 缺失不阻塞 finalize,靠 override 指令兜底格式 */
    }
  }

  const settings = getRuntimeSettings(db);

  // finalize 用独立 run(kind=clarify)记录"生成契约"事件流,不污染主对话 run。
  const run = createRun(db, VIRTUAL_CELL_ID, "clarify", undefined, requirement.id);
  createRunEmitter(run.id);
  const runId = run.id;

  const emit = (payload: unknown): void => {
    try {
      createRunEvent(db, runId, (payload as { type: string }).type, payload);
    } catch {
      /* ignore */
    }
    try {
      emitEvent(runId, payload as unknown as OrchestratorEvent);
    } catch {
      /* ignore */
    }
  };

  emit({ type: "finalize-start", requirementId: requirement.id });

  const buildFinalizePrompt = (reflection: string | null): string => {
    const base = `## 生成契约任务

基于我们上面的对话,为需求「${requirement.title}」产出完整的行为契约 markdown。
${requirement.description ? `\n需求描述:${requirement.description}\n` : ""}
请综合对话中已澄清的问题定义、状态机、业务规则、验收条件,输出完整契约。`;
    const suffix = CONTRACT_FINALIZE_OVERRIDE;
    return reflection === null ? `${base}${suffix}` : `${base}\n\n${reflection}${suffix}`;
  };

  const runOneRound = async (
    reflection: string | null,
  ): Promise<{ ok: boolean; markdown: string; issues: { check: string; detail: string }[] }> => {
    const collected: string[] = [];
    const result = await runNode({
      cwd: sandboxPath,
      resumeSessionId: requirement.sessionId ?? undefined,
      systemPrompt: skillBody,
      userPrompt: buildFinalizePrompt(reflection),
      allowedTools: ["Read", "Bash", "Glob", "Grep"],
      additionalDirectories: additionalDirs.length > 0 ? additionalDirs : undefined,
      maxTurns: settings.turnsPerSession || 15,
      onEvent: (event: NodeRunEvent) => {
        if (event.type === "assistant.text") {
          collected.push(event.text);
          emit({ type: "token", text: event.text });
        } else if (event.type === "tool_use") {
          emit({ type: "tool_use", toolUseId: event.toolUseId, name: event.name, input: event.input });
        } else if (event.type === "tool_result") {
          emit({ type: "tool_result", toolUseId: event.toolUseId, isError: event.isError, preview: event.preview });
        }
      },
    });

    if (!result.success) {
      return {
        ok: false,
        markdown: collected.join(""),
        issues: [{ check: "finalize-failed", detail: result.error ?? "agent run failed" }],
      };
    }

    const modelMarkdown = collected.join("");
    const header = synthesizeRequirementContractHeader(requirement.id, requirement.title);
    const markdown = `${header}${modelMarkdown}`;
    const v = validateContractMarkdown(markdown);
    return { ok: v.ok, markdown, issues: v.issues };
  };

  // 后台异步执行,立即返回 runId。
  void (async () => {
    try {
      let outcome = await runOneRound(null);
      for (let round = 2; round <= MAX_ROUNDS && !outcome.ok; round++) {
        emit({ type: "critic-fail", round, issues: outcome.issues });
        outcome = await runOneRound(buildReflection(outcome.issues));
      }

      if (outcome.ok) {
        const absPath = writeRequirementContractFile({
          sandboxPath,
          requirementId: requirement.id,
          markdown: outcome.markdown,
        });
        const contract = createContract(db, {
          cellId: VIRTUAL_CELL_ID,
          requirementId: requirement.id,
          status: "draft",
          markdownPath: absPath,
          contentHash: hashMarkdown(outcome.markdown),
          source: "clarifier",
          projectId: requirement.projectId,
          originPath: absPath,
        });
        updateRequirementStatus(db, requirement.id, "contract-draft");
        updateRequirementAgentStatus(db, requirement.id, "clarifying");
        updateRun(db, runId, "done");
        emit({ type: "contract-draft", contractId: contract.id, markdownPath: absPath });
        emit({ type: "finalize-done", ok: true, contractId: contract.id });
      } else {
        updateRun(db, runId, "failed");
        emit({ type: "critic-fail", round: MAX_ROUNDS, issues: outcome.issues });
        emit({ type: "finalize-done", ok: false, issues: outcome.issues });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        updateRun(db, runId, "failed");
      } catch {
        /* ignore */
      }
      emit({ type: "error", message: msg });
    } finally {
      scheduleEmitterCleanup(runId);
    }
  })();

  return NextResponse.json({ runId, requirementId: requirement.id });
}
