// 需求节点 API — 加载 HelmCode core/clarify skill,产出行为契约。

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NextResponse } from "next/server";
import { parseContract } from "@helmflow/contract-schema";
import { runClarifierCritic, type Issue } from "@helmflow/agent-core";
import {
  loadSkillBody,
  resolveSkillAdditionalDirs,
  runNode,
  type NodeRunEvent,
} from "@helmflow/agent-runner";
import {
  createAttempt,
  createContract,
  createRun,
  createRunEvent,
  updateAttempt,
  updateRun,
  cellId as makeCellId,
  updateCellAgentStatus,
  listRunsByKind,
  listRunEvents,
} from "@helmflow/storage";
import { loadMatrix, getFeature, getDomainOfFeature, type Feature } from "@/lib/matrix";
import { getDb } from "@/lib/db";
import { guardCellOperable } from "@/lib/guard";
import { isString, sseEncode, sseResponse, resolveHelmcodeRoot, createSseHeartbeat } from "@/lib/server-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROUNDS = 2;
const MAX_TURNS_PER_ROUND = 8;

interface RequireRequestBody {
  featureId?: unknown;
  scenarioName?: unknown;
  userRequest?: unknown;
}

function buildReflection(issues: Issue[]): string {
  const header =
    "## 上一轮 Critic 反馈(请在本轮重写时严格修复以下问题)";
  const lines = issues.map((i) => `- [${i.check}] ${i.detail}`);
  return [header, ...lines].join("\n");
}

function buildUserPrompt(args: {
  feature: Feature;
  scenarioName: string;
  scenarioStatus: string;
  userRequest: string;
  reflection: string | null;
}): string {
  const trimmed = args.userRequest.trim();

  const scenarioContext = args.scenarioStatus === "需改造"
    ? `## 场景上下文\n本功能在「${args.scenarioName}」场景下已有旧实现,需改造。\nLegacy: flowCode=${args.feature.legacy.flowCode || "(空)"}, activities=${args.feature.legacy.activities.join(", ") || "(空)"}。\n请基于现有行为做渐进式改造设计。`
    : `## 场景上下文\n本功能在「${args.scenarioName}」场景下为全新需求,无旧代码。`;

  const base = `以下是本次需求澄清的输入。

${scenarioContext}

## userRequest
${trimmed.length > 0 ? trimmed : "(用户未填写,请基于 feature 元数据合理推断)"}

## feature 元数据
- id: ${args.feature.id}
- name: ${args.feature.name}
- scenario: ${args.scenarioName}
- legacy.flowCode: ${args.feature.legacy.flowCode || "(空)"}
- target.handler: ${args.feature.target.handler || "(空)"}
- target.actions: ${args.feature.target.actions.length > 0 ? args.feature.target.actions.map((a) => a).join(", ") : "(空)"}

请严格按照系统提示中的格式输出,包含三维度澄清(P0/P1/P2),含 Schema Changes 和 Compatibility Constraints。`;
  return args.reflection === null ? base : `${base}\n\n${args.reflection}`;
}

function synthesizeFrontmatter(args: {
  featureId: string;
  project: string;
  domain: string;
}): string {
  const createdAt = new Date().toISOString();
  return [
    "---",
    `featureId: ${args.featureId}`,
    "status: draft",
    `project: ${args.project}`,
    `createdAt: ${createdAt}`,
    `domain: ${args.domain}`,
    `matrixCellId: ${args.featureId}`,
    "---",
    "",
  ].join("\n");
}

function writeContractFile(args: {
  cellId: string;
  markdown: string;
}): { contractId: string; relPath: string } {
  const ts = Date.now().toString(36);
  const contractId = `C-${args.cellId}-${ts}`;
  const relPath = join("data", "contracts", args.cellId, `${contractId}.md`);
  const absPath = join(process.cwd(), relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, args.markdown, "utf-8");
  return { contractId, relPath };
}

function hashMarkdown(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// GET /api/require — 恢复最近一次 Clarifier 运行状态
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const cellId = url.searchParams.get("cellId");
  if (!cellId) {
    return NextResponse.json({ error: "cellId is required" }, { status: 400 });
  }

  const db = getDb();
  const runs = listRunsByKind(db, "require", 20);

  let matchedRun: typeof runs[number] | undefined;
  let matchedEvents: Awaited<ReturnType<typeof listRunEvents>> = [];

  for (const r of runs) {
    const events = listRunEvents(db, r.id);
    const startEvent = events.find((ev) => {
      try {
        const p = JSON.parse(ev.payload);
        return p.type === "require-start" && p.cellId === cellId;
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
      if (p.type === "done" || p.type === "contract-draft") { result = p as Record<string, unknown>; break; }
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

export async function POST(req: Request): Promise<Response> {
  let body: RequireRequestBody;
  try {
    body = (await req.json()) as RequireRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isString(body.featureId) || body.featureId.length === 0) {
    return NextResponse.json({ error: "featureId is required" }, { status: 400 });
  }
  if (!isString(body.scenarioName) || body.scenarioName.length === 0) {
    return NextResponse.json({ error: "scenarioName is required" }, { status: 400 });
  }
  if (!isString(body.userRequest)) {
    return NextResponse.json({ error: "userRequest is required" }, { status: 400 });
  }

  const featureId = body.featureId;
  const scenarioName = body.scenarioName;
  const userRequest = body.userRequest;
  const cellId = makeCellId(featureId, scenarioName);

  const guard = guardCellOperable(getDb(), cellId);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const feature = getFeature(featureId);
  if (!feature) {
    return NextResponse.json({ error: `Feature not found: ${featureId}` }, { status: 404 });
  }

  const domain = getDomainOfFeature(featureId);
  const projectId = loadMatrix().project;

  const helmcodeRoot = await resolveHelmcodeRoot();

  let systemPrompt: string;
  try {
    systemPrompt = loadSkillBody("clarify", helmcodeRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to load clarify SKILL: ${message}` },
      { status: 500 },
    );
  }

  const additionalDirs = helmcodeRoot
    ? (() => {
        const dirs: string[] = [];
        const refsDir = join(helmcodeRoot, "core", "clarify", "references");
        const stdDir = join(helmcodeRoot, "standards");
        const { existsSync } = require("node:fs");
        if (existsSync(refsDir)) dirs.push(refsDir);
        if (existsSync(stdDir)) dirs.push(stdDir);
        return dirs;
      })()
    : [];

  const db = getDb();
  const run = createRun(db, cellId, "require");

  createRunEvent(db, run.id, "require-input", {
    type: "require-input",
    featureId,
    scenarioName,
    userRequest,
  });

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

        sse({ type: "require-start", cellId, featureId, scenarioName });

        const runOneAttempt = async (
          iteration: number,
          reflection: string | null,
        ): Promise<{ ok: boolean; markdown: string; issues: Issue[] }> => {
          const attempt = createAttempt(db, run.id, "require", iteration, "running");
          const userPrompt = buildUserPrompt({
            feature,
            scenarioName,
            scenarioStatus: guard.cell.scenarioStatus,
            userRequest,
            reflection,
          });
          const collected: string[] = [];

          let nodeResult;
          try {
            nodeResult = await runNode({
              cwd: process.cwd(),
              systemPrompt,
              userPrompt,
              allowedTools: ["Read", "Bash", "Glob", "Grep"],
              maxTurns: MAX_TURNS_PER_ROUND,
              additionalDirectories: additionalDirs.length > 0 ? additionalDirs : undefined,
              onEvent: (event: NodeRunEvent) => {
                if (event.type === "assistant.text") {
                  collected.push(event.text);
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
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            updateAttempt(db, attempt.id, { status: "failed" });
            return { ok: false, markdown: collected.join(""), issues: [{ check: "agent-runner-exception", detail: message }] };
          }

          if (!nodeResult.success) {
            updateAttempt(db, attempt.id, { status: "failed" });
            return { ok: false, markdown: collected.join(""), issues: [{ check: "agent-runner-failed", detail: nodeResult.error ?? "agent run failed" }] };
          }

          const modelMarkdown = collected.join("");
          const frontmatter = synthesizeFrontmatter({ featureId, project: projectId, domain: domain?.id ?? feature.target.context });
          const markdown = `${frontmatter}${modelMarkdown}`;

          const parsed = parseContract(markdown);
          if (!parsed.ok) {
            updateAttempt(db, attempt.id, { status: "failed" });
            return { ok: false, markdown, issues: parsed.errors.map((e) => ({ check: "contract-parse", detail: e })) };
          }
          const critic = runClarifierCritic(parsed.data);
          if (!critic.pass) {
            updateAttempt(db, attempt.id, { status: "failed" });
            return { ok: false, markdown, issues: critic.issues };
          }

          const written = writeContractFile({ cellId, markdown });
          const contract = createContract(db, { cellId, status: "draft", markdownPath: written.relPath, contentHash: hashMarkdown(markdown) });
          updateAttempt(db, attempt.id, { status: "passed", outputPath: written.relPath });
          sse({ type: "contract-draft", contractId: contract.id, markdownPath: written.relPath });
          return { ok: true, markdown, issues: [] };
        };

        try {
          let lastIssues: Issue[] = [];
          let lastMarkdown = "";
          let success = false;
          for (let round = 1; round <= MAX_ROUNDS; round++) {
            if (round > 1) {
              sse({ type: "retry-start", round, reflection: buildReflection(lastIssues) });
            }
            const reflection = round === 1 ? null : buildReflection(lastIssues);
            const outcome = await runOneAttempt(round, reflection);
            lastMarkdown = outcome.markdown;
            if (outcome.ok) { success = true; break; }
            lastIssues = outcome.issues;
            sse({ type: "critic-fail", round, issues: outcome.issues });
          }

          if (success) {
            updateRun(db, run.id, "done");
            updateCellAgentStatus(db, cellId, "clarifying");
            sse({ type: "done", runId: run.id, status: "passed" });
          } else {
            updateRun(db, run.id, "failed");
            if (lastMarkdown.length > 0) {
              try {
                const written = writeContractFile({ cellId, markdown: lastMarkdown });
                createContract(db, { cellId, status: "blocked", markdownPath: written.relPath, contentHash: hashMarkdown(lastMarkdown) });
              } catch { /* ignore */ }
            }
            updateCellAgentStatus(db, cellId, "blocked");
            sse({ type: "done", runId: run.id, status: "blocked", issues: lastIssues });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          try { updateRun(db, run.id, "failed"); updateCellAgentStatus(db, cellId, "blocked"); } catch { /* ignore */ }
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