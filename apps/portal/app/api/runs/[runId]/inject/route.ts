import { existsSync } from "node:fs";
import { getDb } from "@/lib/db";
import { resolveSandboxPath } from "@/lib/server-utils";
import { runNode } from "@helmflow/agent-runner";
import { createRun, createRunEvent, getRunById, listRunEvents, updateRun } from "@helmflow/storage";
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

    const sandboxPath = await resolveSandboxPath();

    // 从原 run 的 system.init 事件拿 sessionId,用于 resume 续接(SDK 0.3.162 支持 resume)
    const origEvents = listRunEvents(db, originalRun.id);
    let sessionId: string | null = null;
    for (const ev of origEvents) {
      try {
        const p = JSON.parse(ev.payload);
        // system.init 在 node-event 的 event 字段里(orchestrator 包装),也可能顶层;两种都查
        const inner = p.event && typeof p.event === "object" ? p.event : p;
        if (inner.type === "system.init" && typeof inner.sessionId === "string" && inner.sessionId) {
          sessionId = inner.sessionId;
          break;
        }
      } catch {
        /* ignore */
      }
    }

    // resume session 按 cwd 索引(~/.claude/projects/<cwd-hash>/<sessionId>.jsonl),cwd 必须是
    // 原 session 的 worktree,否则 "No conversation found"。从 worktree-created 拿原 worktree;
    // worktree 已清理则退回 sandboxPath(resume 会自然失败 → 走新 session)。
    let worktreePath: string | null = null;
    for (const ev of origEvents) {
      try {
        const p = JSON.parse(ev.payload);
        if (p.type === "worktree-created" && typeof p.worktreePath === "string") {
          worktreePath = p.worktreePath;
          break;
        }
      } catch {
        /* ignore */
      }
    }
    const resumeCwd = worktreePath && existsSync(worktreePath) ? worktreePath : sandboxPath;

    // 创建新 run(注入续接)
    const injectRun = createRun(db, originalRun.cellId, "analyze");

    createRunEvent(db, injectRun.id, "agent.input", {
      type: "agent.input",
      systemPrompt: sessionId ? "(resume 续接原 session)" : "(新 session,原 run 无 sessionId)",
      userPrompt: message,
    });

    // 后台异步:resume 续接原 session(用户可输 /clarify /goal,被 claude_code preset 识别)。
    // 有 sessionId → resume 续上下文;无 → 退回新 session(preset 仍支持 /命令)。
    const resumeSessionId = sessionId ?? undefined;
    (async () => {
      try {
        const result = await runNode({
          cwd: resumeCwd,
          resumeSessionId,
          systemPrompt: "",
          userPrompt: message,
          allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
          maxTurns: 500,
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
