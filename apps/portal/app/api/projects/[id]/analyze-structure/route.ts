import { getDb } from "@/lib/db";
import { resolveSandboxPathForProject, sseEncode, sseResponse } from "@/lib/server-utils";
import {
  type ScannedClass,
  type ScannedHandler,
  type StructureAnalysisResult,
  buildInferPrompt,
  buildScanPrompt,
  parseHandlerOutput,
  parseInventoryOutput,
  parseStructureResult,
} from "@/lib/structure-analyzer";
import { runClassify, runNode } from "@helmflow/agent-runner";
import {
  createRun,
  createRunEvent,
  ensureVirtualCell,
  listRunEvents,
  listRunsByKind,
  updateRun,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/projects/[id]/analyze-structure — 恢复最近一次分析状态
// ---------------------------------------------------------------------------

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await params;
  const db = getDb();

  // 取最近 analyze-structure 类型的 run
  const runs = listRunsByKind(db, "analyze-structure", 20);

  // 找到属于当前项目的 run（通过 structure-start 事件的 projectId 匹配）
  let matchedRun: (typeof runs)[number] | undefined;
  let matchedEvents: Awaited<ReturnType<typeof listRunEvents>> = [];

  for (const r of runs) {
    const events = listRunEvents(db, r.id);
    // 检查 structure-start 事件的 projectId
    const startEvent = events.find((ev) => {
      try {
        const p = JSON.parse(ev.payload);
        return p.type === "structure-start" && p.projectId === projectId;
      } catch {
        return false;
      }
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

  // 从 events 中逆序提取 structure-done 的 result
  let result: StructureAnalysisResult | null = null;
  for (const ev of [...matchedEvents].reverse()) {
    try {
      const p = JSON.parse(ev.payload);
      if (p.type === "structure-done" && p.result) {
        result = p.result as StructureAnalysisResult;
        break;
      }
    } catch {
      /* skip */
    }
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
// POST /api/projects/[id]/analyze-structure — 分析项目结构
// ---------------------------------------------------------------------------

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await params;

  try {
    const sandboxPath = await resolveSandboxPathForProject(projectId);
    const db = getDb();

    // runs 表 FK 指向 feature_scenarios，用虚拟 cell 占位
    const virtualCellId = ensureVirtualCell(db);
    const run = createRun(db, virtualCellId, "analyze-structure");

    const encoder = new TextEncoder();
    const HEARTBEAT_INTERVAL_MS = 15_000;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // SSE heartbeat — keep connection alive during long agent pauses
        heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            clearInterval(heartbeatTimer);
          }
        }, HEARTBEAT_INTERVAL_MS);

        const sse = (payload: unknown) => {
          try {
            createRunEvent(db, run.id, (payload as { type: string }).type, payload);
          } catch {
            // DB 写入失败不应阻塞流
          }
          try {
            controller.enqueue(sseEncode(encoder, payload));
          } catch {
            // controller 已关闭,事件已落库不丢
          }
        };

        try {
          await runStructureAnalysis(sandboxPath, db, run.id, projectId, sse);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          try {
            controller.enqueue(sseEncode(encoder, { type: "error", message: msg }));
          } catch {
            // controller already closed
          }
        } finally {
          clearInterval(heartbeatTimer);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
      cancel() {
        clearInterval(heartbeatTimer);
      },
    });

    return sseResponse(stream);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analyze-structure POST] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// 核心分析流程
// ---------------------------------------------------------------------------

async function runStructureAnalysis(
  sandboxPath: string,
  db: ReturnType<typeof getDb>,
  runId: string,
  projectId: string,
  sse: (payload: unknown) => void,
): Promise<void> {
  sse({
    type: "structure-start",
    runId,
    projectId,
    phase: "scan",
  });

  // ---- Phase 1: Agent 扫描代码库 ----
  const collectedText: string[] = [];

  try {
    const scanResult = await runNode({
      cwd: sandboxPath,
      systemPrompt:
        "You are a Java code structure scanner. Scan all Java source files thoroughly and produce a complete inventory. Use Glob to find all .java files (pattern: **/src/main/java/**/*.java or **/*.java). Read every file found — do not stop early. Handle both single-module and multi-module (e.g. app/bootstrap/src, app/domain/src) Maven projects.",
      userPrompt: buildScanPrompt(),
      allowedTools: ["Read", "Bash", "Glob", "Grep"],
      maxTurns: 20,
      onEvent: (event) => {
        if (event.type === "assistant.text") {
          collectedText.push(event.text);
          sse({ type: "token", text: event.text });
        } else if (event.type === "tool_use") {
          sse({ type: "tool_use", name: event.name, input: event.input });
        } else if (event.type === "tool_result") {
          sse({
            type: "tool_result",
            isError: event.isError,
            preview: event.preview,
          });
        }
      },
    });

    if (!scanResult.success) {
      updateRun(db, runId, "failed");
      sse({ type: "error", message: scanResult.error ?? "Scan phase failed" });
      return;
    }

    const fullText = collectedText.join("");
    const inventory = parseInventoryOutput(fullText);
    const handlers = parseHandlerOutput(fullText);

    sse({
      type: "scan-done",
      inventorySize: inventory.length,
      handlerCount: handlers.length,
      scanDurationMs: scanResult.durationMs,
    });

    // ---- Phase 2: 推断域 / 功能点 / 场景 ----
    if (inventory.length === 0 && handlers.length === 0) {
      updateRun(db, runId, "failed");
      sse({
        type: "error",
        message: "扫描结果为空，无法推断项目结构",
      });
      return;
    }

    sse({
      type: "structure-infer-start",
      inventorySize: inventory.length,
      handlerCount: handlers.length,
    });

    const classifyResult = await runClassify({
      cwd: sandboxPath,
      systemPrompt:
        "You are a DDD architecture analyst. Based on the code inventory and handler analysis, infer the domain structure, feature points, and business scenarios of a Java DDD project. Output ONLY the JSON wrapped in XML tags, nothing else.",
      userPrompt: buildInferPrompt(inventory, handlers),
      maxTokens: 8192,
    });

    const structureResult = parseStructureResult(classifyResult.text);

    if (!structureResult) {
      updateRun(db, runId, "failed");
      sse({
        type: "error",
        message: "结构推断解析失败，无法识别有效的项目结构",
      });
      return;
    }

    // 补充 summary
    structureResult.scanSummary = {
      totalHandlers: handlers.length,
      totalActions: inventory.filter((c) => c.type === "action").length,
      totalDomains: structureResult.domains.length,
      scanDurationMs: scanResult.durationMs,
      classifyDurationMs: classifyResult.durationMs,
    };

    updateRun(db, runId, "done");
    sse({
      type: "structure-done",
      result: structureResult,
      scanDurationMs: scanResult.durationMs,
      classifyDurationMs: classifyResult.durationMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      updateRun(db, runId, "failed");
    } catch {
      /* ignore */
    }
    sse({ type: "error", message });
  }
}
