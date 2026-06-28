// POST /api/requirements/[id]/message — 需求驱动对话式 clarify 的一条消息。
// 每个需求一个长 clarify run:首条 message 创建,后续 resume 同 session、事件追加同一 run。
// 不带「采集覆盖指令」——让 clarify skill 原生 interactive(提问 P0/P1/P2、读代码)。

import { getDb } from "@/lib/db";
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
  createRun,
  createRunEvent,
  getRequirement,
  getRuntimeSettings,
  setRequirementClarifyRun,
  setRequirementSession,
  updateRun,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const { id } = await ctx.params;
  let body: { message?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = isString(body.message) ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const db = getDb();
  const requirement = getRequirement(db, id);
  if (!requirement) {
    return NextResponse.json({ error: `Requirement not found: ${id}` }, { status: 404 });
  }
  if (requirement.status === "abandoned" || requirement.status === "done") {
    return NextResponse.json(
      { error: `Requirement is ${requirement.status}, cannot send message` },
      { status: 400 },
    );
  }

  const sandboxPath = await resolveSandboxPathForProject(requirement.projectId);
  const projectInfo = getProject(requirement.projectId);
  const helmcodeRoot = projectInfo?.helmcodeRoot;
  // HelmcodeManager 统一 skill/references 加载:让模型能 Read contract-template.md /
  // clarification-dimensions.md,而非仅凭 SKILL.md prose 自由发挥格式(否则偏离严重)。
  const manager =
    helmcodeRoot && projectInfo
      ? new HelmcodeManager({ helmcodeRoot, preset: projectInfo.manifest.adapterType })
      : undefined;
  let systemPrompt = "";
  let additionalDirs: string[] = [];
  if (manager) {
    try {
      systemPrompt = manager.loadSkillBody("clarify");
      additionalDirs = manager.resolveSkillAdditionalDirs("clarify");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `Failed to load clarify SKILL: ${msg}` }, { status: 500 });
    }
  }

  // 首条 message 建 clarify run(长 run,事件追加),并挂 in-memory emitter 供 SSE 实时推送。
  let clarifyRunId = requirement.clarifyRunId;
  if (!clarifyRunId) {
    const run = createRun(db, VIRTUAL_CELL_ID, "clarify", undefined, requirement.id);
    clarifyRunId = run.id;
    setRequirementClarifyRun(db, requirement.id, run.id);
    createRunEmitter(run.id);
  } else {
    // 重启后内存 emitter 可能已清理:确保存在,供 SSE 订阅。
    createRunEmitter(clarifyRunId);
  }

  const runId = clarifyRunId;

  // 事件双写:落库(run_events,前端 /runs/[id] 回放 + 重启不丢)+ 内存广播(SSE 实时)。
  const emit = (payload: unknown): void => {
    try {
      createRunEvent(db, runId, (payload as { type: string }).type, payload);
    } catch {
      /* DB 写失败不阻塞 */
    }
    try {
      emitEvent(runId, payload as unknown as OrchestratorEvent);
    } catch {
      /* emitter 缺失/已清理不阻塞 */
    }
  };

  createRunEvent(db, runId, "agent.input", {
    type: "agent.input",
    systemPrompt: requirement.sessionId ? "(resume 续接对话)" : "(新对话)",
    userPrompt: message,
  });

  const settings = getRuntimeSettings(db);
  const resumeSessionId = requirement.sessionId ?? undefined;

  // 后台异步跑,立即返回 runId 让前端 SSE 订阅。
  void (async () => {
    try {
      const result = await runNode({
        cwd: sandboxPath,
        resumeSessionId,
        systemPrompt,
        userPrompt: message,
        allowedTools: ["Read", "Bash", "Glob", "Grep"],
        additionalDirectories: additionalDirs.length > 0 ? additionalDirs : undefined,
        maxTurns: settings.turnsPerSession || 15,
        onEvent: (event: NodeRunEvent) => {
          if (event.type === "system.init" && event.sessionId) {
            setRequirementSession(db, requirement.id, event.sessionId);
            emit({ type: "system-init", sessionId: event.sessionId, model: event.model });
          } else if (event.type === "assistant.text") {
            emit({ type: "token", text: event.text });
          } else if (event.type === "tool_use") {
            emit({
              type: "tool_use",
              toolUseId: event.toolUseId,
              name: event.name,
              input: event.input,
            });
          } else if (event.type === "tool_result") {
            emit({
              type: "tool_result",
              toolUseId: event.toolUseId,
              isError: event.isError,
              preview: event.preview,
            });
          } else if (event.type === "result") {
            emit({
              type: "result-cost",
              success: event.success,
              turns: event.turns,
              durationMs: event.durationMs,
              costUsd: event.costUsd ?? null,
            });
          }
        },
      });

      updateRun(db, runId, result.success ? "done" : "failed");
      emit({
        type: "message-done",
        success: result.success,
        turns: result.turns,
        ...(result.error ? { error: result.error } : {}),
      });
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
