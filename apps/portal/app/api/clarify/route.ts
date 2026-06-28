// clarify(需求澄清)节点 API — 加载 HelmCode core/clarify skill,产出行为契约。

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDb } from "@/lib/db";
import { guardCellOperable } from "@/lib/guard";
import { type Feature, getDomainOfFeature, getFeature, loadMatrix } from "@/lib/matrix";
import { isString, resolveHelmcodeRoot, resolveSandboxPath } from "@/lib/server-utils";
import { scanJavaInventory } from "@helmflow/adapter-java-ddd";
import { type Issue, runClarifierCritic } from "@helmflow/agent-core";
import { type NodeRunEvent, runClassify, runNode } from "@helmflow/agent-runner";
import { parseContract } from "@helmflow/contract-schema";
import { HelmcodeManager } from "@helmflow/helmcode-manager";
import {
  type OrchestratorEvent,
  createRunEmitter,
  emitEvent,
  scheduleEmitterCleanup,
} from "@helmflow/orchestrator";
import {
  createAttempt,
  createContract,
  createRun,
  createRunEvent,
  listRunEvents,
  listRunsByKind,
  cellId as makeCellId,
  updateAttempt,
  updateCellAgentStatus,
  updateFeatureImplementation,
  updateProjectStandards,
  updateRun,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

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
  const header = "## 上一轮 Critic 反馈(请在本轮重写时严格修复以下问题)";
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
  const scenarioContext =
    args.scenarioStatus === "需改造"
      ? `## 场景上下文\n本功能在「${args.scenarioName}」场景下已存在实现,但需按 HelmCode 规范治理对齐。\n实现定位: handler=${impl.handler || "(未指定)"}, actions=${impl.actions.join(", ") || "(无)"}。\n请基于现有实现行为,产出符合规范的行为契约。`
      : `## 场景上下文\n本功能在「${args.scenarioName}」场景下尚未落地,为待实现需求。`;

  // 功能点的大致描述(用户填写) —— 作为需求澄清的高优先级上下文
  const descBlock =
    args.feature.description.trim().length > 0
      ? `## 功能描述\n${args.feature.description.trim()}\n\n`
      : "";

  const base = `以下是本次需求澄清的输入。

${descBlock}${scenarioContext}

## userRequest
${trimmed.length > 0 ? trimmed : "(用户未填写,请基于功能描述与 feature 元数据合理推断)"}

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
}): string {
  return [
    `# Feature: ${args.featureId}`,
    "",
    "> 元信息(由 HelmFlow Clarifier 自动填写)",
    `> - Feature ID: ${args.featureId}`,
    `> - 涉及领域: ${args.domain}`,
    "> - 状态: draft",
    `> - matrixCellId: ${args.matrixCellId}`,
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
// GET /api/clarify — 恢复最近一次 Clarifier 运行状态
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const cellId = url.searchParams.get("cellId");
  if (!cellId) {
    return NextResponse.json({ error: "cellId is required" }, { status: 400 });
  }

  const db = getDb();
  const runs = listRunsByKind(db, "clarify", 20);

  let matchedRun: (typeof runs)[number] | undefined;
  let matchedEvents: Awaited<ReturnType<typeof listRunEvents>> = [];

  // P1.3: 聚合该 cell 的历史需求列表(供前端"历史需求"回填)。
  interface HistoryItem {
    runId: string;
    userRequest: string;
    state: string;
    startedAt: string;
  }
  const history: HistoryItem[] = [];

  for (const r of runs) {
    const events = listRunEvents(db, r.id);
    const startEvent = events.find((ev) => {
      try {
        const p = JSON.parse(ev.payload);
        return p.type === "require-start" && p.cellId === cellId;
      } catch {
        return false;
      }
    });
    if (!startEvent) continue;
    // 第一个匹配仍作为 matchedRun(详细回放用),与原语义一致
    if (!matchedRun) {
      matchedRun = r;
      matchedEvents = events;
    }
    // 取该 run 最后一次 require-input 作为用户需求
    let userRequest = "";
    for (const ev of events) {
      try {
        const p = JSON.parse(ev.payload);
        if (p.type === "require-input" && typeof p.userRequest === "string")
          userRequest = p.userRequest;
      } catch {
        /* skip */
      }
    }
    history.push({ runId: r.id, userRequest, state: r.state, startedAt: r.startedAt });
  }

  // 按时间倒序(最近在前)
  history.sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));

  if (!matchedRun) {
    return NextResponse.json({ run: null, events: [], result: null, history: [] });
  }

  let result: Record<string, unknown> | null = null;
  for (const ev of [...matchedEvents].reverse()) {
    try {
      const p = JSON.parse(ev.payload);
      if (p.type === "done" || p.type === "contract-draft") {
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
    history,
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
  const manager = helmcodeRoot
    ? new HelmcodeManager({ helmcodeRoot, preset: "java-ddd" })
    : undefined;
  const versionInfo = manager?.getVersion();

  let systemPrompt: string;
  try {
    systemPrompt = manager ? manager.loadSkillBody("clarify") : "";
    // clarify skill 默认指导 agent 把契约写到文件(.claude/contracts/),但 require 通过
    // assistant.text 采集契约正文(见 runOneAttempt 的 collected)。若不 override,agent 会用
    // Bash 写文件、assistant.text 只剩思考过程 → collected 拿到对话垃圾 → 污染契约落库。
    // 追加覆盖指令:禁止写文件,把完整契约 markdown 输出到回复正文。
    if (systemPrompt) {
      systemPrompt +=
        "\n\n---\n【HelmFlow 采集覆盖指令(优先级最高,覆盖上文任何「写文件/产出文件到 .claude/contracts/」要求)】\n" +
        "禁止使用任何工具(Bash/Write/Edit 等)创建或写入文件。将完整的行为契约 markdown 直接作为你的回复正文(assistant text)输出,须依次包含:\n" +
        "# Feature 标题;引用块业务元(> - Feature ID / > - 涉及领域 / > - 状态);## 问题定义;## 状态机;## 业务规则;## 验收条件;## API 契约;## 领域模型。\n" +
        "【ID 格式强约束(违反会被解析器直接拒绝,本轮判失败)】业务规则与验收条件用 markdown 无序列表,每条 id 必须严格如下,不得有任何变体:\n" +
        "  - BR-001: 规则描述(BR- + 三位数字,至少 1 条)\n" +
        "  - BR-002: ...\n" +
        "  - AC-001: 可验证的验收条件描述(AC- + 三位数字,至少 1 条)\n" +
        "  - AC-002: ...\n" +
        "严禁 AC-1/AC01/AC-A/验收条件1/BR1 等其他写法;businessRules 数组至少 1 条、acceptanceCriteria 至少 1 条。\n" +
        "你的回复正文会被原样采集为契约内容——不要输出思考过程、寒暄或解释,不要调用写文件工具,一次性输出完整契约 markdown。";
    }
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
  const run = createRun(db, cellId, "clarify");

  createRunEvent(db, run.id, "require-input", {
    type: "require-input",
    featureId,
    scenarioName,
    userRequest,
  });

  createRunEmitter(run.id);
  // 事件双写:落库(run_events,前端 /runs/[id] 回放) + 内存广播(run emitters,run 页 SSE 实时)。
  const emit = (payload: unknown): void => {
    try {
      createRunEvent(db, run.id, (payload as { type: string }).type, payload);
    } catch {
      // DB 写入失败不应阻塞后台任务
    }
    try {
      emitEvent(run.id, payload as unknown as OrchestratorEvent);
    } catch {
      // emitter 不存在/已清理,事件已落库不丢
    }
  };

  // 后台异步执行 Clarifier,立即返回 runId 让前端跳 run 页实时观看。
  void (async () => {
    try {
      emit({ type: "require-start", cellId, featureId, scenarioName });

      const runOneAttempt = async (
        iteration: number,
        reflection: string | null,
      ): Promise<{ ok: boolean; markdown: string; issues: Issue[] }> => {
        const attempt = createAttempt(
          db,
          run.id,
          "clarify",
          iteration,
          "running",
          versionInfo
            ? { version: versionInfo.helmcode, checksum: versionInfo.checksum }
            : undefined,
        );
        const userPrompt = buildUserPrompt({
          feature,
          scenarioName,
          scenarioStatus: guard.cell.scenarioStatus,
          userRequest,
          reflection,
        });
        const collected: string[] = [];

        let nodeResult: Awaited<ReturnType<typeof runNode>>;
        try {
          nodeResult = await runNode({
            cwd: sandboxPath,
            systemPrompt,
            userPrompt,
            allowedTools: ["Read", "Bash", "Glob", "Grep"],
            maxTurns: MAX_TURNS_PER_ROUND,
            additionalDirectories: additionalDirs.length > 0 ? additionalDirs : undefined,
            onEvent: (event: NodeRunEvent) => {
              if (event.type === "assistant.text") {
                collected.push(event.text);
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
              } else if (event.type === "system.init") {
                emit({
                  type: "system-init",
                  sessionId: event.sessionId,
                  cwd: event.cwd,
                  model: event.model,
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
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          updateAttempt(db, attempt.id, { status: "failed" });
          return {
            ok: false,
            markdown: collected.join(""),
            issues: [{ check: "agent-runner-exception", detail: message }],
          };
        }

        if (!nodeResult.success) {
          updateAttempt(db, attempt.id, { status: "failed" });
          return {
            ok: false,
            markdown: collected.join(""),
            issues: [
              { check: "agent-runner-failed", detail: nodeResult.error ?? "agent run failed" },
            ],
          };
        }

        const modelMarkdown = collected.join("");
        const header = synthesizeContractHeader({
          featureId,
          domain: domain?.id ?? feature.implementation.context,
          matrixCellId: cellId,
        });
        const markdown = `${header}${modelMarkdown}`;

        const parsed = parseContract(markdown);
        if (!parsed.ok) {
          updateAttempt(db, attempt.id, { status: "failed" });
          return {
            ok: false,
            markdown,
            issues: parsed.errors.map((e) => ({ check: "contract-parse", detail: e })),
          };
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
        emit({ type: "contract-draft", contractId: contract.id, markdownPath: written.absPath });
        return { ok: true, markdown, issues: [] };
      };

      try {
        let lastIssues: Issue[] = [];
        let lastMarkdown = "";
        let success = false;
        for (let round = 1; round <= MAX_ROUNDS; round++) {
          if (round > 1) {
            emit({ type: "retry-start", round, reflection: buildReflection(lastIssues) });
          }
          const reflection = round === 1 ? null : buildReflection(lastIssues);
          const outcome = await runOneAttempt(round, reflection);
          lastMarkdown = outcome.markdown;
          if (outcome.ok) {
            success = true;
            break;
          }
          lastIssues = outcome.issues;
          emit({ type: "critic-fail", round, issues: outcome.issues });
        }

        if (success) {
          // 契约产出成功后,分层分析:推断该需求在 DDD 四层(Decider/Acceptor/Handler/Action)的归属
          try {
            emit({ type: "layer-analysis-start", featureId });
            const inventory = scanJavaInventory(sandboxPath);
            const layerResult = await runClassify({
              cwd: sandboxPath,
              systemPrompt:
                "你是 DDD 分层架构分析师。基于需求契约和项目代码结构,推断该功能应该落在哪个 Decider/Acceptor/Handler/Action。输出 JSON。",
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
              emit({ type: "layer-analysis-done", featureId, implementation: layerImpl });
            }
          } catch (layerErr) {
            // 分层分析失败不阻塞契约产出
            emit({
              type: "layer-analysis-skipped",
              reason: layerErr instanceof Error ? layerErr.message : "unknown",
            });
          }

          updateRun(db, run.id, "done");
          updateCellAgentStatus(db, cellId, "clarifying");
          emit({ type: "done", runId: run.id, status: "passed" });
        } else {
          updateRun(db, run.id, "failed");
          // 失败兜底:仅在最后一次产物仍能解析为合法契约时才落库。否则 lastMarkdown 是
          // 对话日志/思考过程(clarify agent 把契约写文件、assistant.text 只剩思考时),
          // 落库会污染 contracts 表 —— 历史 source=clarifier/blocked 的空壳即来源于此。
          if (lastMarkdown.length > 0 && parseContract(lastMarkdown).ok) {
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
            } catch {
              /* ignore */
            }
          }
          updateCellAgentStatus(db, cellId, "blocked");
          emit({ type: "done", runId: run.id, status: "blocked", issues: lastIssues });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          updateRun(db, run.id, "failed");
          updateCellAgentStatus(db, cellId, "blocked");
        } catch {
          /* ignore */
        }
        emit({ type: "error", message });
      }
    } finally {
      // 后台任务结束:调度清理该 run 的内存 emitter(延迟,供 SSE 尾部事件消费)。
      scheduleEmitterCleanup(run.id);
    }
  })();

  return NextResponse.json({ runId: run.id, cellId });
}
// ---------------------------------------------------------------------------
// 分层分析(契约产出后,推断该需求在 DDD 四层的归属)
// ---------------------------------------------------------------------------

function buildLayerAnalysisPrompt(
  feature: Feature,
  inventory: ReturnType<typeof scanJavaInventory>,
): string {
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

function parseLayerAnalysisResult(
  text: string,
): { decider?: string; acceptor?: string; handler?: string; actions?: string[] } | null {
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
      actions: Array.isArray(parsed.actions)
        ? parsed.actions.filter((a: unknown) => typeof a === "string")
        : undefined,
    };
  } catch {
    return null;
  }
}
