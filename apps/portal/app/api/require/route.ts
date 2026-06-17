// 需求节点 API — 加载 HelmCode core/clarify skill,产出行为契约。

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NextResponse } from "next/server";
import { parseContract } from "@helmflow/contract-schema";
import { runClarifierCritic, type Issue } from "@helmflow/agent-core";
import { HelmcodeManager } from "@helmflow/helmcode-manager";
import { scanJavaInventory } from "@helmflow/adapter-java-ddd";
import {
  runNode,
  runClassify,
  type NodeRunEvent,
} from "@helmflow/agent-runner";
import {
  createAttempt,
  createContract,
  createRun,
  createRunEvent,
  updateAttempt,
  updateRun,
  updateProjectStandards,
  updateFeatureImplementation,
  cellId as makeCellId,
  updateCellAgentStatus,
  listRunsByKind,
  listRunEvents,
} from "@helmflow/storage";
import { loadMatrix, getFeature, getDomainOfFeature, type Feature } from "@/lib/matrix";
import { getDb } from "@/lib/db";
import { guardCellOperable } from "@/lib/guard";
import { isString, sseEncode, sseResponse, resolveHelmcodeRoot, resolveSandboxPath, createSseHeartbeat } from "@/lib/server-utils";

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

  // 场景上下文:按开发治理状态描述(非"重构旧实现")。
  // 需改造=已存在实现但不符规范/契约,需按 HelmCode 标准治理对齐;待实现=尚未落地。
  const impl = args.feature.implementation;
  const hasImpl = impl.handler || impl.actions.length > 0;
  const scenarioContext = args.scenarioStatus === "需改造"
    ? `## 场景上下文\n本功能在「${args.scenarioName}」场景下已存在实现,但需按 HelmCode 规范治理对齐。\n实现定位: handler=${impl.handler || "(未指定)"}, actions=${impl.actions.join(", ") || "(无)"}。\n请基于现有实现行为,产出符合规范的行为契约。`
    : `## 场景上下文\n本功能在「${args.scenarioName}」场景下尚未落地,为待实现需求。`;

  const base = `以下是本次需求澄清的输入。

${scenarioContext}

## userRequest
${trimmed.length > 0 ? trimmed : "(用户未填写,请基于 feature 元数据合理推断)"}

## feature 元数据
- id: ${args.feature.id}
- name: ${args.feature.name}
- scenario: ${args.scenarioName}
- implementation.handler: ${impl.handler || "(空)"}
- implementation.actions: ${impl.actions.length > 0 ? impl.actions.join(", ") : "(空)"}
${hasImpl ? "" : "(注:本功能点尚未指定实现定位,契约可自由设计入口)\n"}
请严格按照系统提示中的格式输出,包含三维度澄清(P0/P1/P2),含 Schema Changes 和 Compatibility Constraints。`;
  return args.reflection === null ? base : `${base}\n\n${args.reflection}`;
}

/**
 * 生成 HelmCode 格式契约头(标题 + 引用块业务元)。
 * 与 helmcode core/clarify/references/contract-template.md 一致;
 * matrixCellId 为 HelmFlow 专属字段(导入时精确命中 cell)。
 *
 * 注:HelmCode 契约的 frontmatter 是模板级元(name/version/description),业务元走引用块。
 * 这里不生成 frontmatter(LLM 产出正文直接跟在引用块后),保持 HelmCode 工具链兼容。
 */
function synthesizeContractHeader(args: {
  featureId: string;
  domain: string;
  matrixCellId: string;
  priority: string;
}): string {
  return [
    `# Feature: ${args.featureId}`,
    "",
    "> 元信息(由 HelmFlow Clarifier 自动填写)",
    `> - Feature ID: ${args.featureId}`,
    `> - 涉及领域: ${args.domain}`,
    "> - 状态: draft",
    `> - matrixCellId: ${args.matrixCellId}`,
    `> - 优先级: ${args.priority || "P1"}`,
    "",
  ].join("\n");
}

/**
 * 把契约写到目标项目 .claude/contracts/{cellId}.md(控制平面原则:产物在目标项目)。
 * 返回绝对路径(作为 contracts.markdownPath + originPath)。
 */
function writeContractFile(args: {
  sandboxPath: string;
  cellId: string;
  markdown: string;
}): { contractId: string; absPath: string } {
  const ts = Date.now().toString(36);
  const contractId = `C-${args.cellId}-${ts}`;
  const dir = join(args.sandboxPath, ".claude", "contracts");
  const absPath = join(dir, `${args.cellId}.md`);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, args.markdown, "utf-8");
  return { contractId, absPath };
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
  // 契约产物写到目标项目 .claude/contracts/(控制平面原则)
  const sandboxPath = await resolveSandboxPath();
  // HelmcodeManager 统一 skill/standards 加载 + 版本感知(第三刀)
  const manager = helmcodeRoot ? new HelmcodeManager({ helmcodeRoot, preset: "java-ddd" }) : undefined;
  const versionInfo = manager?.getVersion();

  let systemPrompt: string;
  try {
    systemPrompt = manager ? manager.loadSkillBody("clarify") : "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to load clarify SKILL: ${message}` },
      { status: 500 },
    );
  }

  const additionalDirs = manager ? manager.resolveSkillAdditionalDirs("clarify") : [];

  const db = getDb();
  // 记录项目当前绑定的 HelmCode 标准版本(可追溯)
  if (versionInfo) {
    updateProjectStandards(db, projectId, {
      helmcodeVersion: versionInfo.helmcode,
      standardsChecksum: versionInfo.checksum,
    });
  }
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

        sse({ type: "require-start", cellId, featureId, scenarioName });

        const runOneAttempt = async (
          iteration: number,
          reflection: string | null,
        ): Promise<{ ok: boolean; markdown: string; issues: Issue[] }> => {
          const attempt = createAttempt(db, run.id, "require", iteration, "running", versionInfo ? { version: versionInfo.helmcode, checksum: versionInfo.checksum } : undefined);
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
          const header = synthesizeContractHeader({
            featureId,
            domain: domain?.id ?? feature.implementation.context,
            matrixCellId: cellId,
            priority: feature.priority,
          });
          const markdown = `${header}${modelMarkdown}`;

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

          const written = writeContractFile({ sandboxPath, cellId, markdown });
          const contract = createContract(db, {
            cellId,
            status: "draft",
            markdownPath: written.absPath,
            contentHash: hashMarkdown(markdown),
            source: "clarifier",
            projectId,
            originPath: written.absPath,
          });
          updateAttempt(db, attempt.id, { status: "passed", outputPath: written.absPath });
          sse({ type: "contract-draft", contractId: contract.id, markdownPath: written.absPath });
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
            // 契约产出成功后,分层分析:推断该需求在 DDD 四层(Decider/Acceptor/Handler/Action)的归属
            try {
              sse({ type: "layer-analysis-start", featureId });
              const inventory = scanJavaInventory(sandboxPath);
              const layerResult = await runClassify({
                cwd: sandboxPath,
                systemPrompt: "你是 DDD 分层架构分析师。基于需求契约和项目代码结构,推断该功能应该落在哪个 Decider/Acceptor/Handler/Action。输出 JSON。",
                userPrompt: buildLayerAnalysisPrompt(feature, inventory),
              });
              const layerImpl = parseLayerAnalysisResult(layerResult.text);
              if (layerImpl) {
                updateFeatureImplementation(db, featureId, {
                  decider: layerImpl.decider ?? "",
                  acceptor: layerImpl.acceptor ?? "",
                  handler: layerImpl.handler ?? "",
                  actions: layerImpl.actions ? JSON.stringify(layerImpl.actions) : "",
                });
                sse({ type: "layer-analysis-done", featureId, implementation: layerImpl });
              }
            } catch (layerErr) {
              // 分层分析失败不阻塞契约产出
              sse({ type: "layer-analysis-skipped", reason: layerErr instanceof Error ? layerErr.message : "unknown" });
            }

            updateRun(db, run.id, "done");
            updateCellAgentStatus(db, cellId, "clarifying");
            sse({ type: "done", runId: run.id, status: "passed" });
          } else {
            updateRun(db, run.id, "failed");
            if (lastMarkdown.length > 0) {
              try {
                const written = writeContractFile({ sandboxPath, cellId, markdown: lastMarkdown });
                createContract(db, {
                  cellId,
                  status: "blocked",
                  markdownPath: written.absPath,
                  contentHash: hashMarkdown(lastMarkdown),
                  source: "clarifier",
                  projectId,
                  originPath: written.absPath,
                });
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
// ---------------------------------------------------------------------------
// 分层分析(契约产出后,推断该需求在 DDD 四层的归属)
// ---------------------------------------------------------------------------

function buildLayerAnalysisPrompt(feature: Feature, inventory: ReturnType<typeof scanJavaInventory>): string {
  // 按 type 分组,只给 handler/action/decider/acceptor(不给 other 噪音)
  const byType = {
    decider: inventory.filter((i) => i.type === "decider").map((i) => i.className),
    acceptor: inventory.filter((i) => i.type === "acceptor").map((i) => i.className),
    handler: inventory.filter((i) => i.type === "handler").map((i) => i.className),
    action: inventory.filter((i) => i.type === "action").map((i) => i.className),
  };

  return `## 任务

基于需求 "${feature.name}"(${feature.id}) 和项目已有的 DDD 分层代码,推断这个需求应该落在哪个 Decider/Acceptor/Handler/Action。

## 项目已有分层类

- Decider: ${byType.decider.join(", ") || "(无)"}
- Acceptor: ${byType.acceptor.join(", ") || "(无)"}
- Handler: ${byType.handler.join(", ") || "(无)"}
- Action: ${byType.action.join(", ") || "(无)"}

## 规则

1. 从已有类中按语义匹配这个功能对应的分层类(最相似的)
2. 如果没有匹配的,根据功能名推断"应该新建的类名"(如 XxxDecider/XxxHandler)
3. actions 是该功能需要的执行步骤类(多个)

## 输出格式

只输出 <LAYER_RESULT> 标签包裹的 JSON:

<LAYER_RESULT>
{"decider":"DeliverDecider","acceptor":"DeliverRecordAcceptor","handler":"SaveDeliverRecordHandler","actions":["SaveDeliverRecordAction","CreateFlowInstanceAction"]}
</LAYER_RESULT>

无匹配时字段留空字符串。`;
}

function parseLayerAnalysisResult(text: string): { decider?: string; acceptor?: string; handler?: string; actions?: string[] } | null {
  const match = text.match(/<LAYER_RESULT>([\s\S]*?)<\/LAYER_RESULT>/);
  if (!match?.[1]) return null;
  try {
    let raw = match[1].trim();
    const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fence?.[1]) raw = fence[1].trim();
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      decider: typeof parsed.decider === "string" ? parsed.decider : undefined,
      acceptor: typeof parsed.acceptor === "string" ? parsed.acceptor : undefined,
      handler: typeof parsed.handler === "string" ? parsed.handler : undefined,
      actions: Array.isArray(parsed.actions) ? parsed.actions.filter((a: unknown) => typeof a === "string") : undefined,
    };
  } catch {
    return null;
  }
}
