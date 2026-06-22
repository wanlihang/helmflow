import { NextResponse } from "next/server";
import { runNode, runClassify } from "@helmflow/agent-runner";
import { scanJavaInventory, type InventoryItem } from "@helmflow/adapter-java-ddd";
import {
  getCellRow,
  createRun,
  createRunEvent,
  updateRun,
  ensureVirtualCell,
  updateCellAgentStatus,
  updateFeatureScenarioStatus,
  updateFeatureImplementation,
  listRunEvents,
  getRunById,
  listRunsByKind,
  getLatestContract,
} from "@helmflow/storage";
import { getDb } from "@/lib/db";
import { loadMatrix, getFeature, type Feature, type Scenario } from "@/lib/matrix";
import { getCurrentProjectId } from "@/lib/project";
import { isString, sseEncode, sseResponse, resolveSandboxPath } from "@/lib/server-utils";
import { isAbsolute, join } from "node:path";
import { readFileSync } from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestBody {
  scope?: unknown;
  domainId?: unknown;
  cellId?: unknown;
}

interface AnalysisResult {
  cellId: string;
  featureId: string;
  scenarioName: string;
  oldStatus: string;
  newStatus: string;
  reason: string;
  implementation?: { decider?: string; acceptor?: string; handler?: string; actions?: string[] };
}

/** LLM 分析输出(parseAnalysisOutput 解析) */
interface AnalysisOutput {
  cellId: string;
  newStatus: string;
  reason: string;
  implementation?: { decider?: string; acceptor?: string; handler?: string; actions?: string[] };
}

// InventoryItem 类型从 @helmflow/adapter-java-ddd 导入(scanJavaInventory 产出)

interface CellInfo {
  cellId: string;
  feature: Feature;
  scenario: Scenario;
}

// ---------------------------------------------------------------------------
// Prompt builders — Phase 1 (scan)
// ---------------------------------------------------------------------------

function buildScanPrompt(): string {
  return `## 任务

扫描项目中所有 Java 源文件，生成一份结构化的类清单（inventory）。

### 扫描策略
- **单模块**：扫描 src/main/java
- **多模块**：扫描所有子模块下的 src/main/java（如 app/*/src/main/java）
- 使用 Glob **/src/main/java/**/*.java 或 **/*.java 找到所有 Java 文件
- 不要遗漏任何子目录

扫描规则：
1. 对每个类记录：类名、完整包名、是否是 Handler 或 Action、公共方法数量、TODO/FIXME 数量、有效代码行数、是否是骨架代码
2. "骨架代码"判断：方法体只有 return null / return 0 / return "" / throw new UnsupportedOperationException / 空块 / 仅调用 super

## 输出格式

输出 JSON 数组，用 \`<INVENTORY>\` 和 \`</INVENTORY>\` 标签包裹：

\`\`\`
<INVENTORY>
[
  {"className": "SaveDeliverRecordHandler", "qualifiedName": "com.example.handler.SaveDeliverRecordHandler", "type": "handler", "methods": 5, "todos": 0, "lines": 120, "skeleton": false},
  {"className": "CreateOrderAction", "qualifiedName": "com.example.action.CreateOrderAction", "type": "action", "methods": 2, "todos": 3, "lines": 45, "skeleton": true},
  ...
]
</INVENTORY>
\`\`\`

只输出 JSON 数组（带标签），不要其他内容。尽可能完整地覆盖所有 Java 文件。`;
}

// ---------------------------------------------------------------------------
// Prompt builders — Phase 2 (classify)
// ---------------------------------------------------------------------------

/**
 * 读取 cell 对应的行为契约全文(权威依据)。无契约返回 null(classify 回退纯 inventory)。
 * 复用 verify-cell 的 getLatestContract 模式;markdownPath 可能绝对(DB 实测)或相对,显式判断
 * 避开 node path.join 把绝对第二参当相对拼接的陷阱。
 */
function loadContractMd(db: ReturnType<typeof getDb>, cellId: string): string | null {
  const row = getLatestContract(db, cellId);
  if (!row?.markdownPath) return null;
  const p = isAbsolute(row.markdownPath) ? row.markdownPath : join(process.cwd(), row.markdownPath);
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function buildClassifyPrompt(inventory: InventoryItem[], cells: CellInfo[], contracts: Map<string, string>): string {
  const inventoryJson = JSON.stringify(inventory, null, 2);

  const cellLines = cells.map((c) => {
    // 不依赖预设 implementation(可能为空)——给 LLM feature name/domain 让它从 inventory 语义匹配
    const base = `- cellId: ${c.cellId} | feature: ${c.feature.name}(${c.feature.id}) | domain: ${c.feature.implementation.context || c.feature.id.split("-")[0]} | currentStatus: ${c.scenario.status}`;
    const contract = contracts.get(c.cellId);
    // 有契约:附全文作为权威依据(含 BR/AC/分层);无契约:仅按 inventory 判断
    return contract
      ? `${base}\n\n#### 该 cell 的行为契约(权威依据)\n${contract}`
      : `${base}\n(无行为契约,仅按 inventory 语义判断)`;
  });

  return `## 任务

根据代码扫描结果(inventory),为每个功能点匹配 DDD 分层归属(Decider/Acceptor/Handler/Action)并判断实现状态。

## 扫描结果（代码清单,含分层类型）

\`\`\`json
${inventoryJson}
\`\`\`

## 待分析格子

${cellLines.join("\n")}

## 判断规则

对每个格子,从 inventory 中按功能语义匹配该功能的分层链路:
1. 在 type=decider 的类里找该功能对应的 Decider
2. 在 type=acceptor 的类里找该功能对应的 Acceptor
3. 在 type=handler 的类里找该功能对应的 Handler(主入口)
4. 在 type=action 的类里找该功能对应的 Actions(执行步骤)
5. 综合判断状态:
   - Handler + 主要 Actions 都存在,且无 TODO、非骨架 → "已支持"
   - 类存在但有 TODO 或骨架代码 → "需改造"
   - 关键类不存在 → "待实现"
   - currentStatus 为"废弃" → 保持"废弃"

## 输出格式

输出 JSON 数组,用 \`<ANALYSIS_RESULT>\` 和 \`</ANALYSIS_RESULT>\` 标签包裹。每个格子必须有结果,含匹配到的分层链路:

\`\`\`
<ANALYSIS_RESULT>
[
  {"cellId": "D-01__正式签约", "newStatus": "已支持", "reason": "SaveDeliverRecordHandler 存在且逻辑完整",
   "implementation": {"decider": "DeliverDecider", "acceptor": "DeliverRecordAcceptor", "handler": "SaveDeliverRecordHandler", "actions": ["SaveDeliverRecordAction", "CreateFlowInstanceAction"]}},
  {"cellId": "P-01__正式签约", "newStatus": "待实现", "reason": "未找到对应类", "implementation": {}},
  ...
]
</ANALYSIS_RESULT>
\`\`\`

只输出 JSON 数组(带标签),不要其他内容。implementation 字段:匹配到的类名填上,没匹配到的留空对象或不填该字段。`;
}

// ---------------------------------------------------------------------------
// Output parsers
// ---------------------------------------------------------------------------

function parseInventoryOutput(text: string): InventoryItem[] {
  const match = text.match(/<INVENTORY>([\s\S]*?)<\/INVENTORY>/);
  if (!match || !match[1]) return [];
  try {
    let raw = match[1].trim();
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fenceMatch && fenceMatch[1]) {
      raw = fenceMatch[1].trim();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is InventoryItem =>
        typeof item === "object" && item !== null && "className" in item,
    );
  } catch {
    return [];
  }
}

function parseAnalysisOutput(text: string): AnalysisOutput[] {
  const match = text.match(/<ANALYSIS_RESULT>([\s\S]*?)<\/ANALYSIS_RESULT>/);
  if (!match || !match[1]) return [];
  try {
    let raw = match[1].trim();
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fenceMatch && fenceMatch[1]) {
      raw = fenceMatch[1].trim();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is AnalysisOutput =>
        typeof item === "object" &&
        item !== null &&
        "cellId" in item &&
        "newStatus" in item &&
        "reason" in item,
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET: 查询最近一次分析的状态 + 结果，供前端刷新恢复
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const db = getDb();
  const url = new URL(req.url);

  const cellId = url.searchParams.get("cellId");
  const afterIdStr = url.searchParams.get("afterId");
  const afterId = afterIdStr ? Number(afterIdStr) : undefined;
  const validAfterId = afterId !== undefined && Number.isFinite(afterId) && afterId > 0 ? afterId : undefined;

  // Find the most recent analyze run (optionally filtered by cellId)
  const analyzeRuns = listRunsByKind(db, "analyze", 50);
  const filtered = cellId
    ? analyzeRuns.filter((r) => r.cellId === cellId)
    : analyzeRuns;
  const latestRun = filtered[0];

  if (!latestRun) {
    return NextResponse.json({ run: null, events: [], results: [] });
  }

  const events = listRunEvents(db, latestRun.id, validAfterId);

  // Extract results from the latest analyze-done event
  const results: AnalysisResult[] = [];
  for (const ev of [...events].reverse()) {
    try {
      const payload = JSON.parse(ev.payload);
      if (payload.type === "analyze-done" && Array.isArray(payload.results)) {
        results.push(...payload.results);
        break;
      }
    } catch { /* skip */ }
  }

  return NextResponse.json({
    run: {
      id: latestRun.id,
      state: latestRun.state,
      startedAt: latestRun.startedAt,
      cellId: latestRun.cellId,
    },
    events: events.map((e) => ({
      id: e.id,
      type: e.eventType,
      payload: JSON.parse(e.payload),
      createdAt: e.createdAt,
    })),
    results,
  });
}

// ---------------------------------------------------------------------------
// POST: 执行分析（两阶段 for bulk，单阶段 for cell）
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const scope = isString(body.scope) ? body.scope : "all";
    const projectId = await getCurrentProjectId();
    const matrix = loadMatrix(projectId);
    const db = getDb();

  // ---- Collect cells to analyze ----
  let cellsToAnalyze: CellInfo[] = [];

  if (scope === "cell" && isString(body.cellId)) {
    const row = getCellRow(db, body.cellId);
    if (!row) {
      return NextResponse.json({ error: `Cell not found: ${body.cellId}` }, { status: 404 });
    }
    if (row.scenarioStatus === "废弃") {
      return NextResponse.json({ results: [], message: "废弃格子跳过分析" });
    }
    const feature = getFeature(row.featureId, projectId);
    if (feature) {
      const scenario = feature.scenarios.find((s) => s.name === row.scenarioName);
      if (scenario) {
        cellsToAnalyze.push({ cellId: body.cellId, feature, scenario });
      }
    }
  } else if (scope === "domain" && isString(body.domainId)) {
    const domain = matrix.domains.find((d) => d.id === body.domainId);
    if (!domain) {
      return NextResponse.json({ error: `Domain not found: ${body.domainId}` }, { status: 404 });
    }
    for (const f of domain.features) {
      for (const s of f.scenarios) {
        if (s.status !== "废弃") {
          cellsToAnalyze.push({ cellId: `${f.id}__${s.name}`, feature: f, scenario: s });
        }
      }
    }
  } else {
    for (const d of matrix.domains) {
      for (const f of d.features) {
        for (const s of f.scenarios) {
          if (s.status !== "废弃") {
            cellsToAnalyze.push({ cellId: `${f.id}__${s.name}`, feature: f, scenario: s });
          }
        }
      }
    }
  }

  if (cellsToAnalyze.length === 0) {
    return NextResponse.json({ results: [], message: "No cells to analyze" });
  }

  const sandboxPath = await resolveSandboxPath();

  // Create a run record for persistence
  // 注意：runs.cellId 有 FK 约束引用 feature_scenarios.id，必须使用真实存在的 cellId
  const runCellId = scope === "cell" && isString(body.cellId) ? body.cellId : cellsToAnalyze[0].cellId;
  const run = createRun(db, runCellId, "analyze");

  const encoder = new TextEncoder();
  const HEARTBEAT_MS = 15_000;
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
      }, HEARTBEAT_MS);

      const sse = (payload: unknown) => {
        // 先持久化(独立 try),再 enqueue —— 确保 error/异常路径下事件不丢(运行中心可诊断)
        try {
          createRunEvent(db, run.id, (payload as { type: string }).type, payload);
        } catch {
          // DB write failure should not block the stream
        }
        try {
          controller.enqueue(sseEncode(encoder, payload));
        } catch {
          // controller 已关闭(stream 中断),事件已落库不丢
        }
      };

      try {
        if (scope === "cell") {
          await runCellAnalysis(cellsToAnalyze, sandboxPath, db, run, sse);
        } else {
          await runBulkAnalysis(cellsToAnalyze, sandboxPath, db, run, sse);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          controller.enqueue(sseEncode(encoder, { type: "error", message: msg }));
        } catch { /* already closed */ }
      } finally {
        clearInterval(heartbeatTimer);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      clearInterval(heartbeatTimer);
    },
  });

  return sseResponse(stream);
  } catch (err) {
    // 顶层兜底：捕获 import / 初始化阶段异常，返回可读错误
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analyze-status POST] Unhandled error:", message, err instanceof Error ? err.stack : "");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// 单格分析（原有逻辑）
// ---------------------------------------------------------------------------

async function runCellAnalysis(
  cellsToAnalyze: CellInfo[],
  sandboxPath: string,
  db: ReturnType<typeof getDb>,
  run: { id: string },
  sse: (payload: unknown) => void,
): Promise<void> {
  // 读取各 cell 的行为契约(若已建立映射),作为权威依据注入 prompt
  const contracts = new Map<string, string>();
  for (const c of cellsToAnalyze) {
    const md = loadContractMd(db, c.cellId);
    if (md) contracts.set(c.cellId, md);
  }
  const userPrompt = buildCellAnalysisPrompt(cellsToAnalyze, contracts);
  const systemPrompt = "You are a code analysis assistant. 对照每个 cell 的行为契约(若有)判断实现状态:契约的 BR/AC 是「实现该满足什么」的权威,用 Read/Bash 在代码中逐条验证是否落地;契约指定的分层(Decider/Acceptor/Handler/Action)为权威归属,确认其存在与逻辑完整性(无 TODO、非骨架)。状态:契约 BR/AC 全部落地且分层完整→已支持;部分缺失或骨架→需改造;关键类缺失→待实现;currentStatus 为废弃→保持废弃。无契约时按代码扫描判断。Be precise and factual.";

  sse({ type: "analyze-start", runId: run.id, totalCells: cellsToAnalyze.length, scope: "cell" });

  const collectedText: string[] = [];
  try {
    const nodeResult = await runNode({
      cwd: sandboxPath,
      systemPrompt,
      userPrompt,
      allowedTools: ["Read", "Bash"],
      maxTurns: 15,
      onEvent: (event) => {
        if (event.type === "assistant.text") {
          collectedText.push(event.text);
          sse({ type: "token", text: event.text });
        } else if (event.type === "tool_use") {
          sse({ type: "tool_use", name: event.name, input: event.input });
        } else if (event.type === "tool_result") {
          sse({ type: "tool_result", isError: event.isError, preview: event.preview });
        }
      },
    });

    if (!nodeResult.success) {
      updateRun(db, run.id, "failed");
      sse({ type: "error", message: nodeResult.error ?? "Analysis agent failed" });
      return;
    }

    const fullText = collectedText.join("");
    const parsed = parseAnalysisOutput(fullText);

    // 写回分析产出的分层归属(不论状态是否变更,implementation 是独立产出)
    for (const item of parsed) {
      if (!item.implementation) continue;
      const cellInfo = cellsToAnalyze.find((c) => c.cellId === item.cellId);
      if (!cellInfo) continue;
      updateFeatureImplementation(db, cellInfo.feature.id, {
        decider: item.implementation.decider ?? "",
        acceptor: item.implementation.acceptor ?? "",
        handler: item.implementation.handler ?? "",
        actions: item.implementation.actions ? JSON.stringify(item.implementation.actions) : "",
      });
    }

    const results = buildAnalysisResults(parsed, cellsToAnalyze);

    // apply 状态变更(降级重置语义)
    for (const r of results) {
      const existing = getCellRow(db, r.cellId);
      if (!existing) continue;
      updateFeatureScenarioStatus(db, r.featureId, r.scenarioName, r.newStatus);
      if (existing.scenarioStatus === "已支持" && (r.newStatus === "需改造" || r.newStatus === "待实现")) {
        updateCellAgentStatus(db, r.cellId, "not-started");
      }
    }

    updateRun(db, run.id, "done");
    sse({ type: "analyze-done", results, turns: nodeResult.turns, durationMs: nodeResult.durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try { updateRun(db, run.id, "failed"); } catch { /* ignore */ }
    sse({ type: "error", message });
  }
}

// ---------------------------------------------------------------------------
// 全量/域分析：两阶段（扫描 + 分类）
// ---------------------------------------------------------------------------

async function runBulkAnalysis(
  cellsToAnalyze: CellInfo[],
  sandboxPath: string,
  db: ReturnType<typeof getDb>,
  run: { id: string },
  sse: (payload: unknown) => void,
): Promise<void> {
  sse({ type: "analyze-start", runId: run.id, totalCells: cellsToAnalyze.length, scope: "bulk", phase: "scan" });

  // ---- Phase 1: 确定性脚本扫描(秒级,零 LLM 成本,不撞 turn) ----
  let inventory: InventoryItem[] = [];
  let scanDurationMs = 0;
  let scanFallback = false;
  const scanStart = Date.now();
  try {
    inventory = scanJavaInventory(sandboxPath);
    scanDurationMs = Date.now() - scanStart;
  } catch (err) {
    sse({ type: "scan-failed-script", message: err instanceof Error ? err.message : String(err) });
  }

  // 脚本返回空 → 降级 LLM scan(runNode,maxTurns 20 + 自动续 session)
  if (inventory.length === 0) {
    sse({ type: "scan-fallback-llm", reason: "脚本 scan 返回空,降级 LLM 扫描" });
    scanFallback = true;
    const collectedText: string[] = [];
    try {
      const scanResult = await runNode({
        cwd: sandboxPath,
        systemPrompt: "You are a code scanner. Scan Java source files and produce a structured inventory. Use Glob to find **/src/main/java/**/*.java. Handle single-module and multi-module Maven projects. Be thorough.",
        userPrompt: buildScanPrompt(),
        allowedTools: ["Read", "Bash"],
        maxTurns: 20,
        onEvent: (event) => {
          if (event.type === "assistant.text") { collectedText.push(event.text); sse({ type: "token", text: event.text }); }
          else if (event.type === "tool_use") { sse({ type: "tool_use", name: event.name, input: event.input }); }
          else if (event.type === "tool_result") { sse({ type: "tool_result", isError: event.isError, preview: event.preview }); }
        },
      });
      scanDurationMs = Date.now() - scanStart;
      if (!scanResult.success) {
        updateRun(db, run.id, "failed");
        sse({ type: "error", message: scanResult.error ?? "LLM scan fallback failed" });
        return;
      }
      inventory = parseInventoryOutput(collectedText.join(""));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try { updateRun(db, run.id, "failed"); } catch { /* ignore */ }
      sse({ type: "error", message });
      return;
    }
  }

  // scan-done(脚本 inventory 缓存到 event,classify 复用)
  sse({ type: "scan-done", inventory, scanDurationMs, fallback: scanFallback, inventorySize: inventory.length });

  // inventory 仍空 → 最终降级全量 prompt
  if (inventory.length === 0) {
    await runFallbackBulkAnalysis(cellsToAnalyze, sandboxPath, db, run, sse);
    return;
  }

  // ---- Phase 2: per-cell classify(拆分!每 cell 独立 run,故障隔离) ----
  sse({ type: "classify-start", cellCount: cellsToAnalyze.length, perCell: true });
  const allResults: AnalysisResult[] = [];
  const classifySystemPrompt = "You are a precise status classifier. 优先对照该 cell 的行为契约判断:用契约的 BR/AC 作为「实现该满足什么」的权威,在 inventory(代码清单)中逐条验证是否落地;契约指定的分层(Decider/Acceptor/Handler/Action)为权威归属,在 inventory 中确认其存在与逻辑完整性(无 TODO、非骨架)。状态:契约 BR/AC 全部落地且分层完整→已支持;部分缺失或骨架→需改造;关键类缺失→待实现;currentStatus 为废弃→保持废弃。无契约时回退纯 inventory 语义匹配。输出仍为 <ANALYSIS_RESULT> 标签包裹的 JSON 数组,只输出该数组。";

  /** 529 限流自动重试(指数退避: 3s→6s→12s, 最多 3 次) */
  async function runClassifyWithRetry(opts: { cwd: string; systemPrompt: string; userPrompt: string }, sseFn: (p: unknown) => void): Promise<{ text: string; durationMs: number }> {
    const MAX_RETRIES = 3;
    const delays = [3000, 6000, 12000];
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await runClassify(opts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 529 = GLM 限流,可重试;其他错误直接抛
        if (!msg.includes("529") || attempt === MAX_RETRIES) throw err;
        sseFn({ type: "classify-retry", attempt: attempt + 1, maxRetries: MAX_RETRIES, delay: delays[attempt], reason: "GLM 529 限流" });
        await new Promise((r) => setTimeout(r, delays[attempt]!));
      }
    }
    throw new Error("runClassify exhausted retries");
  }

  for (let cellIdx = 0; cellIdx < cellsToAnalyze.length; cellIdx++) {
    const cell = cellsToAnalyze[cellIdx];

    // cell 间限速(非首个 cell 前等 2s,避免密集触发 GLM 限流)
    if (cellIdx > 0) {
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 每 cell 独立 analyze run(真实 cellId,运行中心逐 cell 可观测)
    let cellRun: { id: string } | null = null;
    // per-cell sse:事件双写(主 run + per-cell run,这样运行中心点 per-cell 也能看内容)
    const cellSse = (payload: unknown) => {
      sse(payload); // 写到主 run(总览用)
      if (cellRun) {
        try { createRunEvent(db, cellRun.id, (payload as { type: string }).type, payload); } catch { /* ignore */ }
      }
    };
    try {
      cellRun = createRun(db, cell.cellId, "analyze");
      cellSse({ type: "classify-cell-start", cellId: cell.cellId, runId: cellRun.id, progress: `${cellIdx + 1}/${cellsToAnalyze.length}` });

      // 读取该 cell 的行为契约(若已建立映射),作为 classify 的权威依据注入 prompt
      const contracts = new Map<string, string>();
      const contractMd = loadContractMd(db, cell.cellId);
      if (contractMd) contracts.set(cell.cellId, contractMd);

      const classifyResult = await runClassifyWithRetry({
        cwd: sandboxPath,
        systemPrompt: classifySystemPrompt,
        userPrompt: buildClassifyPrompt(inventory, [cell], contracts),
      }, cellSse);
      const parsed = parseAnalysisOutput(classifyResult.text);

      // 写回分层归属(独立于状态变更)
      for (const item of parsed) {
        if (!item.implementation) continue;
        updateFeatureImplementation(db, cell.feature.id, {
          decider: item.implementation.decider ?? "",
          acceptor: item.implementation.acceptor ?? "",
          handler: item.implementation.handler ?? "",
          actions: item.implementation.actions ? JSON.stringify(item.implementation.actions) : "",
        });
      }

      const results = buildAnalysisResults(parsed, [cell]);

      // apply 状态变更
      for (const r of results) {
        const existing = getCellRow(db, r.cellId);
        if (!existing) continue;
        updateFeatureScenarioStatus(db, r.featureId, r.scenarioName, r.newStatus);
        if (existing.scenarioStatus === "已支持" && (r.newStatus === "需改造" || r.newStatus === "待实现")) {
          updateCellAgentStatus(db, r.cellId, "not-started");
        }
      }
      allResults.push(...results);
      updateRun(db, cellRun.id, "done");
      cellSse({ type: "classify-cell-done", cellId: cell.cellId, runId: cellRun.id, results, durationMs: classifyResult.durationMs });
    } catch (err) {
      // 单 cell 失败不影响其他 cell(故障隔离)
      const message = err instanceof Error ? err.message : String(err);
      if (cellRun) { try { updateRun(db, cellRun.id, "failed"); } catch { /* ignore */ } }
      cellSse({ type: "classify-cell-failed", cellId: cell.cellId, message });
    }
  }

  updateRun(db, run.id, "done");
  sse({ type: "analyze-done", results: allResults, scanDurationMs, inventorySize: inventory.length, perCell: true });
}

// ---------------------------------------------------------------------------
// Fallback: 全量 prompt 方式（inventory 解析失败时降级）
// ---------------------------------------------------------------------------

async function runFallbackBulkAnalysis(
  cellsToAnalyze: CellInfo[],
  sandboxPath: string,
  db: ReturnType<typeof getDb>,
  run: { id: string },
  sse: (payload: unknown) => void,
): Promise<void> {
  sse({ type: "classify-start", cellCount: cellsToAnalyze.length, fallback: true });

  // 读取各 cell 的行为契约(若已建立映射),作为权威依据注入 prompt
  const contracts = new Map<string, string>();
  for (const c of cellsToAnalyze) {
    const md = loadContractMd(db, c.cellId);
    if (md) contracts.set(c.cellId, md);
  }
  const userPrompt = buildCellAnalysisPrompt(cellsToAnalyze, contracts);
  const systemPrompt = "You are a code analysis assistant. 对照每个 cell 的行为契约(若有)判断实现状态:契约的 BR/AC 是「实现该满足什么」的权威,用 Read/Bash 在代码中逐条验证是否落地;契约指定的分层(Decider/Acceptor/Handler/Action)为权威归属,确认其存在与逻辑完整性(无 TODO、非骨架)。状态:契约 BR/AC 全部落地且分层完整→已支持;部分缺失或骨架→需改造;关键类缺失→待实现;currentStatus 为废弃→保持废弃。无契约时按代码扫描判断。Be precise and factual.";

  const collectedText: string[] = [];
  const nodeResult = await runNode({
    cwd: sandboxPath,
    systemPrompt,
    userPrompt,
    allowedTools: ["Read", "Bash"],
    maxTurns: 15,
    onEvent: (event) => {
      if (event.type === "assistant.text") {
        collectedText.push(event.text);
        sse({ type: "token", text: event.text });
      } else if (event.type === "tool_use") {
        sse({ type: "tool_use", name: event.name, input: event.input });
      } else if (event.type === "tool_result") {
        sse({ type: "tool_result", isError: event.isError, preview: event.preview });
      }
    },
  });

  if (!nodeResult.success) {
    updateRun(db, run.id, "failed");
    sse({ type: "error", message: nodeResult.error ?? "Fallback analysis failed" });
    return;
  }

  const fullText = collectedText.join("");
  const parsed = parseAnalysisOutput(fullText);
  const results = buildAnalysisResults(parsed, cellsToAnalyze);
  updateRun(db, run.id, "done");
  sse({ type: "analyze-done", results, turns: nodeResult.turns, durationMs: nodeResult.durationMs, fallback: true });
}

// ---------------------------------------------------------------------------
// 共享 prompt / result builder
// ---------------------------------------------------------------------------

function buildCellAnalysisPrompt(cells: CellInfo[], contracts: Map<string, string>): string {
  const lines = cells.map((c) => {
    const base = `- cellId: ${c.cellId} | feature: ${c.feature.name}(${c.feature.id}) | domain: ${c.feature.implementation.context || c.feature.id.split("-")[0]} | currentStatus: ${c.scenario.status}`;
    const contract = contracts.get(c.cellId);
    return contract
      ? `${base}\n\n#### 该 cell 的行为契约(权威依据)\n${contract}`
      : `${base}\n(无行为契约,仅按代码扫描判断)`;
  });

  return `## 任务

你是 HelmFlow 状态分析器。请分析当前项目的代码,判断以下每个格子(feature × scenario)的实现状态,并匹配 DDD 分层归属。

分析维度:
1. 扫描 src/main/java 下该功能对应的 Decider/Acceptor/Handler/Action 类是否存在
2. 如果类存在,分析代码逻辑是否完整覆盖该功能(vs 只是骨架/占位/TODO)
3. 如果 currentStatus 是"废弃",保持不动

判断规则:
- Handler + 主要 Actions 都存在且逻辑完整 → "已支持"
- 类存在但逻辑不完整或骨架 → "需改造"
- 关键类不存在 → "待实现"
- currentStatus 为"废弃" → 保持"废弃"

## 待分析格子

${lines.join("\n")}

## 输出格式

用 \`<ANALYSIS_RESULT>\` 和 \`</ANALYSIS_RESULT>\` 标签包裹 JSON 数组,含匹配到的分层链路:

\`\`\`
<ANALYSIS_RESULT>
[
  {"cellId": "D-01__正式签约", "newStatus": "已支持", "reason": "SaveDeliverRecordHandler 类存在且逻辑完整",
   "implementation": {"decider":"DeliverDecider","acceptor":"DeliverRecordAcceptor","handler":"SaveDeliverRecordHandler","actions":["SaveDeliverRecordAction"]}},
  ...
]
</ANALYSIS_RESULT>
\`\`\`

只输出 JSON 数组(带标签)。implementation:匹配到的类名填,没匹配留空对象。`;
}

function buildAnalysisResults(
  parsed: AnalysisOutput[],
  cellsToAnalyze: CellInfo[],
): AnalysisResult[] {
  const results: AnalysisResult[] = [];
  for (const item of parsed) {
    const cellInfo = cellsToAnalyze.find((c) => c.cellId === item.cellId);
    if (!cellInfo) continue;
    const oldStatus = cellInfo.scenario.status;
    if (oldStatus === item.newStatus) continue;
    results.push({
      cellId: item.cellId,
      featureId: cellInfo.feature.id,
      scenarioName: cellInfo.scenario.name,
      oldStatus,
      newStatus: item.newStatus,
      reason: item.reason,
      implementation: item.implementation,
    });
  }
  return results;
}