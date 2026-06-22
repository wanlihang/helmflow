// 上线节点 API — 加载 helmflow-deploy skill,commit+push+创建 PR。

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "@/lib/db";
import { guardCellOperable } from "@/lib/guard";
import {
  createSseHeartbeat,
  isString,
  resolveHelmcodeRoot,
  resolveSandboxPath,
  sseEncode,
  sseResponse,
} from "@/lib/server-utils";
import {
  type AllowedTool,
  type NodeRunEvent,
  loadSkillBody,
  runNode,
} from "@helmflow/agent-runner";
import {
  createRun,
  createRunEvent,
  ensureVirtualCell,
  getContractById,
  getLatestContract,
  hasRunningRun,
  listRunEvents,
  listRunsByKind,
  updateCellAgentStatus,
  updateRun,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TURNS = 12;

interface DeployRequestBody {
  contractId?: unknown;
  cellId?: unknown;
}

// ---------------------------------------------------------------------------
// GET /api/deploy/run — 恢复最近一次 Deploy 运行状态
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const cellId = url.searchParams.get("cellId");
  if (!cellId) {
    return NextResponse.json({ error: "cellId is required" }, { status: 400 });
  }

  const db = getDb();
  const runs = listRunsByKind(db, "deploy", 20);

  let matchedRun: (typeof runs)[number] | undefined;
  let matchedEvents: Awaited<ReturnType<typeof listRunEvents>> = [];

  for (const r of runs) {
    const events = listRunEvents(db, r.id);
    const startEvent = events.find((ev) => {
      try {
        const p = JSON.parse(ev.payload);
        return p.type === "deploy-start" && p.cellId === cellId;
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

  let result: Record<string, unknown> | null = null;
  for (const ev of [...matchedEvents].reverse()) {
    try {
      const p = JSON.parse(ev.payload);
      if (p.type === "done") {
        result = p as Record<string, unknown>;
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
// POST /api/deploy/run — 执行部署
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  let body: DeployRequestBody;
  try {
    body = (await req.json()) as DeployRequestBody;
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
    return NextResponse.json(
      { error: `Contract not found: ${body.contractId ?? body.cellId}` },
      { status: 404 },
    );
  }

  const guard = guardCellOperable(db, contract.cellId);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  if (hasRunningRun(db, contract.cellId, "deploy")) {
    return NextResponse.json(
      { error: "A deploy run is already in progress for this cell" },
      { status: 409 },
    );
  }

  const sandboxPath = await resolveSandboxPath();
  if (!existsSync(sandboxPath)) {
    return NextResponse.json({ error: `Sandbox not found: ${sandboxPath}` }, { status: 500 });
  }

  if (!existsSync(resolve(sandboxPath, ".git"))) {
    return NextResponse.json({ error: "Sandbox is not a git repo" }, { status: 500 });
  }

  const helmcodeRoot = await resolveHelmcodeRoot();

  let systemPrompt: string;
  try {
    systemPrompt = loadSkillBody("helmflow-deploy", helmcodeRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to load helmflow-deploy SKILL: ${message}` },
      { status: 500 },
    );
  }

  const allowedTools: AllowedTool[] = ["Read", "Bash"];

  const { readFileSync } = require("node:fs");
  const contractMarkdownPath = resolve(process.cwd(), contract.markdownPath);
  const contractMarkdown = readFileSync(contractMarkdownPath, "utf-8");

  // Parse AC IDs from contract
  const acMatch = [...contractMarkdown.matchAll(/AC-\d{3}/g)].map((m) => m[0]);
  const acIds = [...new Set(acMatch)].join(", ");

  const userPrompt = `## 上线任务

你正在 \`${sandboxPath}\` 的 sandbox 项目里工作。请按 system prompt (helmflow-deploy skill) 的规范,
把当前改动 commit + push + 创建 PR。

- cellId/featureId: ${contract.cellId}
- contractId: ${contract.id}
- contract markdown: ${contract.markdownPath}
- 覆盖的 AC: ${acIds}

按 SKILL 工作流:git status → git diff → git checkout -b feat/... → git add src/ → git commit → git push → 创建 PR → 输出 <COMMIT_SHA> 和 <PR_URL>
`;

  // 创建 run 记录
  const virtualCellId = ensureVirtualCell(db);
  const run = createRun(db, virtualCellId, "deploy");

  const collectedText: string[] = [];
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

        sse({ type: "deploy-start", contractId: contract.id, cellId: contract.cellId });

        try {
          const nodeResult = await runNode({
            cwd: sandboxPath,
            systemPrompt,
            userPrompt,
            allowedTools,
            maxTurns: MAX_TURNS,
            onEvent: (event: NodeRunEvent) => {
              if (event.type === "assistant.text") {
                collectedText.push(event.text);
                sse({ type: "token", text: event.text });
              } else if (event.type === "tool_use") {
                sse({
                  type: "tool_use",
                  toolUseId: event.toolUseId,
                  name: event.name,
                  input: event.input,
                });
              } else if (event.type === "tool_result") {
                sse({
                  type: "tool_result",
                  toolUseId: event.toolUseId,
                  isError: event.isError,
                  preview: event.preview,
                });
              } else if (event.type === "system.init") {
                sse({
                  type: "system-init",
                  sessionId: event.sessionId,
                  cwd: event.cwd,
                  model: event.model,
                });
              } else if (event.type === "result") {
                sse({
                  type: "result-cost",
                  success: event.success,
                  turns: event.turns,
                  durationMs: event.durationMs,
                  costUsd: event.costUsd ?? null,
                });
              }
            },
          });

          const fullText = collectedText.join("");
          const prUrlMatch = fullText.match(/<PR_URL>([^<]+)<\/PR_URL>/);
          const commitShaMatch = fullText.match(/<COMMIT_SHA>([0-9a-fA-F]{7,40})<\/COMMIT_SHA>/);
          const prUrl = prUrlMatch?.[1]?.trim();
          const commitSha = commitShaMatch?.[1]?.slice(0, 7);

          if (nodeResult.success) {
            updateCellAgentStatus(db, contract.cellId, "done");
            updateRun(db, run.id, "done");
          } else {
            updateCellAgentStatus(db, contract.cellId, "blocked");
            updateRun(db, run.id, "failed");
          }

          sse({
            type: "done",
            success: nodeResult.success,
            error: nodeResult.error,
            commitSha,
            prUrl,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          updateCellAgentStatus(db, contract.cellId, "blocked");
          try {
            updateRun(db, run.id, "failed");
          } catch {
            /* ignore */
          }
          sse({ type: "error", message });
        }
      } finally {
        stopHb();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // heartbeat timer cleaned up by stopHb or GC
    },
  });

  return sseResponse(stream);
}
