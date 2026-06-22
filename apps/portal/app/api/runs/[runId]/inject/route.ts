import { getDb } from "@/lib/db";
import { getCurrentProjectId } from "@/lib/project";
import { resolveSandboxPath } from "@/lib/server-utils";
import { runNode } from "@helmflow/agent-runner";
import { createRun, createRunEvent, getRunById, updateRun } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InjectBody {
  message?: unknown;
}

// POST /api/runs/[runId]/inject — 人工注入消息(resume session 续接)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await params;

  let body: InjectBody;
  try {
    body = (await req.json()) as InjectBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  try {
    const db = getDb();
    const originalRun = getRunById(db, runId);
    if (!originalRun) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // 从原 run 的 system.init 事件获取 sessionId
    // (当前 sessionId 在 run_events 的 system.init payload 里)
    // 如果找不到 sessionId,返回提示(无法 resume)
    const projectId = await getCurrentProjectId();
    const sandboxPath = await resolveSandboxPath();

    // 创建新 run(注入续接)
    const injectRun = createRun(db, originalRun.cellId, "analyze"); // 用 analyze kind(轻量)

    createRunEvent(db, injectRun.id, "agent.input", {
      type: "agent.input",
      systemPrompt: "(人工注入续接)",
      userPrompt: message,
    });

    // 在后台异步执行(不阻塞响应)
    // 注意:这里用 runNode 发新 prompt,Claude Agent SDK 会用 cwd 环境运行
    // 真正的 session resume 需要 sessionId,但当前 Claude Agent SDK 的 query()
    // 不直接暴露 resume 参数。作为 MVP,这里以新 session 发送用户消息。
    // TODO: 后续用 SDK 的 resume 能力实现真正的上下文续接。
    (async () => {
      try {
        const result = await runNode({
          cwd: sandboxPath,
          systemPrompt:
            "你是 HelmFlow 的人工干预助手。用户对正在进行的任务有补充信息,请基于用户输入继续协助。",
          userPrompt: `用户补充信息:\n${message}`,
          allowedTools: ["Read", "Bash", "Grep", "Glob"],
          maxTurns: 10,
          onEvent: (event) => {
            try {
              if (event.type === "assistant.text") {
                createRunEvent(db, injectRun.id, "token", { type: "token", text: event.text });
              } else if (event.type === "tool_use") {
                createRunEvent(db, injectRun.id, "tool_use", {
                  type: "tool_use",
                  name: event.name,
                  input: event.input,
                });
              } else if (event.type === "tool_result") {
                createRunEvent(db, injectRun.id, "tool_result", {
                  type: "tool_result",
                  isError: event.isError,
                  preview: event.preview,
                });
              }
            } catch {
              /* ignore */
            }
          },
        });

        createRunEvent(db, injectRun.id, "result", {
          type: "result",
          success: result.success,
          turns: result.turns,
          durationMs: result.durationMs,
          ...(result.error ? { error: result.error } : {}),
        });

        updateRun(db, injectRun.id, result.success ? "done" : "failed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        createRunEvent(db, injectRun.id, "error", { type: "error", message: msg });
        updateRun(db, injectRun.id, "failed");
      }
    })();

    return NextResponse.json({
      newRunId: injectRun.id,
      message: "注入已启动,查看新 run 的对话",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
