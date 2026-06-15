// 测试节点 API — 加载 HelmCode core/verify skill,独立回归验证。
// B 方案:implement 已自带 verify 自愈,此节点只做最终确认。

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getContractById, getLatestContract, hasRunningRun, updateCellAgentStatus, listRunsByKind, listRunEvents, createRun, createRunEvent, updateRun, ensureVirtualCell } from "@helmflow/storage";
import {
  loadSkillBody,
  resolveSkillAdditionalDirs,
  runNode,
  type NodeRunEvent,
  type AllowedTool,
} from "@helmflow/agent-runner";
import { getDb } from "@/lib/db";
import { guardCellOperable } from "@/lib/guard";
import { isString, sseEncode, sseResponse, resolveSandboxPath, resolveHelmcodeRoot, createSseHeartbeat } from "@/lib/server-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TURNS = 20;

interface TestRequestBody {
  contractId?: unknown;
  cellId?: unknown;
}

// ---------------------------------------------------------------------------
// GET /api/test/run — 恢复最近一次 Test 运行状态
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const cellId = url.searchParams.get("cellId");
  if (!cellId) {
    return NextResponse.json({ error: "cellId is required" }, { status: 400 });
  }

  const db = getDb();
  const runs = listRunsByKind(db, "test", 20);

  let matchedRun: typeof runs[number] | undefined;
  let matchedEvents: Awaited<ReturnType<typeof listRunEvents>> = [];

  for (const r of runs) {
    const events = listRunEvents(db, r.id);
    const startEvent = events.find((ev) => {
      try {
        const p = JSON.parse(ev.payload);
        return p.type === "test-start" && p.cellId === cellId;
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
// POST /api/test/run — 执行测试验证
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  let body: TestRequestBody;
  try {
    body = (await req.json()) as TestRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // 兼容两种入参:contractId 直接定位;cellId 解析最新契约
  const db = getDb();
  let contract;
  if (isString(body.contractId) && body.contractId.length > 0) {
    contract = getContractById(db, body.contractId);
  } else if (isString(body.cellId) && body.cellId.length > 0) {
    contract = getLatestContract(db, body.cellId);
  } else {
    return NextResponse.json({ error: "contractId or cellId is required" }, { status: 400 });
  }
  if (!contract) {
    return NextResponse.json({ error: `Contract not found: ${body.contractId ?? body.cellId}` }, { status: 404 });
  }

  const guard = guardCellOperable(db, contract.cellId);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  if (hasRunningRun(db, contract.cellId, "test")) {
    return NextResponse.json({ error: "A test run is already in progress for this cell" }, { status: 409 });
  }

  const sandboxPath = await resolveSandboxPath();
  if (!existsSync(sandboxPath)) {
    return NextResponse.json({ error: `Sandbox not found: ${sandboxPath}` }, { status: 500 });
  }

  const helmcodeRoot = await resolveHelmcodeRoot();

  let systemPrompt: string;
  try {
    systemPrompt = loadSkillBody("verify", helmcodeRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to load verify SKILL: ${message}` }, { status: 500 });
  }

  const skillAdditionalDirs = resolveSkillAdditionalDirs("verify", helmcodeRoot);
  const allowedTools: AllowedTool[] = ["Read", "Bash", "Glob", "Grep"];

  const { readFileSync } = require("node:fs");
  const contractMarkdownPath = resolve(process.cwd(), contract.markdownPath);
  const contractMarkdown = readFileSync(contractMarkdownPath, "utf-8");

  const userPrompt = `## 测试确认任务

你正在 \`${sandboxPath}\` 的 sandbox 项目里工作。请按 system prompt (HelmCode verify skill) 的规范,
对以下 feature 进行独立回归验证。

- cellId: ${contract.cellId}
- contractId: ${contract.id}

## Contract (参考)

${contractMarkdown}

## 验证要求

1. 跑 mvn compile + mvn test,确认全绿
2. 验证字段同步、架构合规
3. 逐项确认 AC 通过

如果验证通过输出 VERIFICATION_PASSED,否则输出 VERIFICATION_FAILED。
`;

  // 创建 run 记录
  const virtualCellId = ensureVirtualCell(db);
  const run = createRun(db, virtualCellId, "test");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const { start: startHb, stop: stopHb } = createSseHeartbeat(encoder, controller);
      startHb();
      try {
        const sse = (payload: unknown) => {
          controller.enqueue(sseEncode(encoder, payload));
          try {
            createRunEvent(db, run.id, (payload as { type: string }).type, payload);
          } catch {
            // DB 写入失败不应阻塞流
          }
        };

        sse({ type: "test-start", contractId: contract.id, cellId: contract.cellId });

        try {
          const nodeResult = await runNode({
            cwd: sandboxPath,
            systemPrompt,
            userPrompt,
            allowedTools,
            maxTurns: MAX_TURNS,
            additionalDirectories: skillAdditionalDirs.length > 0 ? skillAdditionalDirs : undefined,
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
            updateCellAgentStatus(db, contract.cellId, "qa-passed");
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