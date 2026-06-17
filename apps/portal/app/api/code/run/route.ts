// 代码节点 API — 加载 HelmCode core/implement skill。

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getContractById, hasRunningRun, updateCellAgentStatus, listRunsByKind, listRunEvents, createRun, createRunEvent, updateRun, ensureVirtualCell } from "@helmflow/storage";
import { HelmcodeManager } from "@helmflow/helmcode-manager";
import {
  runNode,
  type NodeRunEvent,
  type AllowedTool,
} from "@helmflow/agent-runner";
import { getDb } from "@/lib/db";
import { guardCellOperable } from "@/lib/guard";
import { isString, sseEncode, sseResponse, resolveSandboxPath, resolveHelmcodeRoot, createSseHeartbeat } from "@/lib/server-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TURNS = 40;

interface CodeRequestBody {
  contractId?: unknown;
}

// ---------------------------------------------------------------------------
// GET /api/code/run — 恢复最近一次 Code 运行状态
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const contractId = url.searchParams.get("contractId");
  if (!contractId) {
    return NextResponse.json({ error: "contractId is required" }, { status: 400 });
  }

  const db = getDb();
  const runs = listRunsByKind(db, "code", 20);

  let matchedRun: typeof runs[number] | undefined;
  let matchedEvents: Awaited<ReturnType<typeof listRunEvents>> = [];

  for (const r of runs) {
    const events = listRunEvents(db, r.id);
    const startEvent = events.find((ev) => {
      try {
        const p = JSON.parse(ev.payload);
        return p.type === "code-start" && p.contractId === contractId;
      } catch { return false; }
    });
    if (startEvent) {
      matchedRun = r;
      matchedEvents = events;
      break;
    }
  }

  if (!matchedRun) {
    return NextResponse.json({ run: null, events: [], result: null });
  }

  let result: Record<string, unknown> | null = null;
  for (const ev of [...matchedEvents].reverse()) {
    try {
      const p = JSON.parse(ev.payload);
      if (p.type === "done") { result = p as Record<string, unknown>; break; }
    } catch { /* skip */ }
  }

  return NextResponse.json({
    run: {
      id: matchedRun.id,
      state: matchedRun.state,
      startedAt: matchedRun.startedAt,
    },
    events: matchedEvents.map((e) => ({
      id: e.id,
      type: e.eventType,
      payload: JSON.parse(e.payload),
      createdAt: e.createdAt,
    })),
    result,
  });
}

// ---------------------------------------------------------------------------
// POST /api/code/run — 执行代码实现
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  let body: CodeRequestBody;
  try {
    body = (await req.json()) as CodeRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isString(body.contractId) || body.contractId.length === 0) {
    return NextResponse.json({ error: "contractId is required" }, { status: 400 });
  }

  const db = getDb();
  const contract = getContractById(db, body.contractId);
  if (!contract) {
    return NextResponse.json({ error: `Contract not found: ${body.contractId}` }, { status: 404 });
  }
  if (contract.status !== "approved") {
    return NextResponse.json({ error: `Contract must be approved, got '${contract.status}'` }, { status: 400 });
  }

  const guard = guardCellOperable(db, contract.cellId);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  if (hasRunningRun(db, contract.cellId, "code")) {
    return NextResponse.json({ error: "A code run is already in progress for this cell" }, { status: 409 });
  }

  const sandboxPath = await resolveSandboxPath();
  if (!existsSync(sandboxPath)) {
    return NextResponse.json({ error: `Sandbox not found: ${sandboxPath}` }, { status: 500 });
  }

  const helmcodeRoot = await resolveHelmcodeRoot();
  const manager = helmcodeRoot ? new HelmcodeManager({ helmcodeRoot, preset: "java-ddd" }) : undefined;

  let systemPrompt: string;
  try {
    systemPrompt = manager ? manager.loadSkillBody("implement") : "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to load implement SKILL: ${message}` }, { status: 500 });
  }

  // patterns + skill references + standards,统一走 manager(替代硬编码 resolveStandardsRoot)
  const allAdditionalDirs = manager
    ? [manager.resolvePatterns(), ...manager.resolveSkillAdditionalDirs("implement")]
    : [];

  const allowedTools: AllowedTool[] = ["Read", "Write", "Edit", "Bash"];
  const contractMarkdownPath = resolve(process.cwd(), contract.markdownPath);

  const { readFileSync } = require("node:fs");
  const contractMarkdown = readFileSync(contractMarkdownPath, "utf-8");

  const userPrompt = `## 代码实现任务

你正在 \`${sandboxPath}\` 的 sandbox 项目里工作。请按 system prompt (HelmCode implement skill) 的规范,
根据下面这份已审批的行为契约,生成强自包含的代码并自驱编译+测试通过。

- cellId: ${contract.cellId}
- contractId: ${contract.id}

## Approved Contract

${contractMarkdown}

## 关键要求

1. 按 implement skill 的 context-loader 规则加载上下文
2. 生成 Handler/Action/Context + 测试代码
3. 自驱 mvn compile + mvn test 通过 (Tests run >= 1)
4. implement 内置 verify 自愈:编译/测试失败时自动修复
`;

  // 创建 run 记录
  const virtualCellId = ensureVirtualCell(db);
  const run = createRun(db, virtualCellId, "code");

  updateCellAgentStatus(db, contract.cellId, "implementing");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const { start: startHb, stop: stopHb } = createSseHeartbeat(encoder, controller);
      startHb();
      try {
        const sse = (payload: unknown) => {
          // 先持久化(独立 try),再 enqueue — 确保 error/异常路径下事件不丢(运行中心可诊断)
          try {
            createRunEvent(db, run.id, (payload as { type: string }).type, payload);
          } catch {
            // DB 写入失败不应阻塞流
          }
          try {
            controller.enqueue(sseEncode(encoder, payload));
          } catch {
            // controller 已关闭(stream 中断),事件已落库不丢
          }
        };

        sse({ type: "code-start", contractId: contract.id, cellId: contract.cellId });

        try {
          const nodeResult = await runNode({
            cwd: sandboxPath,
            systemPrompt,
            userPrompt,
            allowedTools,
            maxTurns: MAX_TURNS,
            additionalDirectories: allAdditionalDirs,
            onEvent: (event: NodeRunEvent) => {
              if (event.type === "assistant.text") {
                sse({ type: "token", text: event.text });
              } else if (event.type === "tool_use") {
                sse({ type: "tool_use", toolUseId: event.toolUseId, name: event.name, input: event.input });
              } else if (event.type === "tool_result") {
                sse({ type: "tool_result", toolUseId: event.toolUseId, isError: event.isError, preview: event.preview });
              } else if (event.type === "system.init") {
                sse({ type: "system-init", sessionId: event.sessionId, cwd: event.cwd, model: event.model });
              } else if (event.type === "result") {
                sse({ type: "result-cost", success: event.success, turns: event.turns, durationMs: event.durationMs, costUsd: event.costUsd ?? null });
              }
            },
          });

          if (nodeResult.success) {
            updateCellAgentStatus(db, contract.cellId, "tests-pending");
            updateRun(db, run.id, "done");
          } else {
            updateCellAgentStatus(db, contract.cellId, "blocked");
            updateRun(db, run.id, "failed");
          }
          sse({ type: "done", success: nodeResult.success, error: nodeResult.error });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          updateCellAgentStatus(db, contract.cellId, "blocked");
          try { updateRun(db, run.id, "failed"); } catch { /* ignore */ }
          sse({ type: "error", message });
        }
      } finally {
        stopHb();
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      // heartbeat timer cleaned up by stopHb or GC
    },
  });

  return sseResponse(stream);
}