import { NextResponse } from "next/server";
import { runNode, runClassify } from "@helmflow/agent-runner";
import {
  getCellRow,
  createRun,
  createRunEvent,
  updateRun,
  listRunEvents,
  getRunById,
  listRunsByKind,
} from "@helmflow/storage";
import { getDb } from "@/lib/db";
import { loadMatrix, getFeature, type Feature, type Scenario } from "@/lib/matrix";
import { getCurrentProjectId } from "@/lib/project";
import { isString, sseEncode, sseResponse, resolveSandboxPath } from "@/lib/server-utils";

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
}

interface InventoryItem {
  className: string;
  qualifiedName: string;
  type: "handler" | "action" | "other";
  methods: number;
  todos: number;
  lines: number;
  skeleton: boolean;
}

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

function buildClassifyPrompt(inventory: InventoryItem[], cells: CellInfo[]): string {
  const inventoryJson = JSON.stringify(inventory, null, 2);

  const cellLines = cells.map((c) => {
    const handler = c.feature.target.handler || "(无)";
    const actions = c.feature.target.actions.length > 0 ? c.feature.target.actions.join(", ") : "(无)";
    return `- cellId: ${c.cellId} | handler: ${handler} | actions: ${actions} | currentStatus: ${c.scenario.status}`;
  });

  return `## 任务

根据代码扫描结果，判断每个格子的实现状态。

## 扫描结果（代码清单）

\`\`\`json
${inventoryJson}
\`\`\`

## 待分析格子

${cellLines.join("\n")}

## 判断规则

对每个格子：
1. 在扫描结果中查找 target.handler 对应的类（按类名匹配）
2. 在扫描结果中查找 target.actions 对应的类（按类名匹配）
3. 综合判断：
   - Handler 和所有 Actions 都存在，且无 TODO、非骨架 → "已支持"
   - 类存在但有 TODO 或是骨架代码 → "需改造"
   - 关键类不存在 → "待实现"
   - currentStatus 为"废弃" → 保持"废弃"

## 输出格式

输出 JSON 数组，用 \`<ANALYSIS_RESULT>\` 和 \`</ANALYSIS_RESULT>\` 标签包裹：

\`\`\`
<ANALYSIS_RESULT>
[
  {"cellId": "D-01__正式签约", "newStatus": "已支持", "reason": "SaveDeliverRecordHandler 存在且逻辑完整，5 个方法无 TODO"},
  ...
]
</ANALYSIS_RESULT>
\`\`\`

只输出 JSON 数组（带标签），不要其他内容。每个格子都必须有结果。`;
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

function parseAnalysisOutput(text: string): Array<{ cellId: string; newStatus: string; reason: string }> {
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
      (item: unknown): item is { cellId: string; newStatus: string; reason: string } =>
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
        controller.enqueue(sseEncode(encoder, payload));
        // Persist every SSE event to DB for recovery
        try {
          createRunEvent(db, run.id, (payload as { type: string }).type, payload);
        } catch {
          // DB write failure should not block the stream
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
  const userPrompt = buildCellAnalysisPrompt(cellsToAnalyze);
  const systemPrompt = "You are a code analysis assistant. Analyze Java source code to determine implementation status of features. Be precise and factual.";

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

    const results = buildAnalysisResults(parsed, cellsToAnalyze);
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

  // ---- Phase 1: Agent 扫描代码库 ----
  const collectedText: string[] = [];
  let scanSuccess = false;

  try {
    const scanResult = await runNode({
      cwd: sandboxPath,
      systemPrompt: "You are a code scanner. Scan Java source files and produce a structured inventory. Use Glob **/src/main/java/**/*.java to find files. Handle both single-module and multi-module Maven projects. Be thorough — scan all packages.",
      userPrompt: buildScanPrompt(),
      allowedTools: ["Read", "Bash"],
      maxTurns: 12,
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

    if (!scanResult.success) {
      updateRun(db, run.id, "failed");
      sse({ type: "error", message: scanResult.error ?? "Scan phase failed" });
      return;
    }

    scanSuccess = true;
    const inventory = parseInventoryOutput(collectedText.join(""));

    if (inventory.length === 0) {
      // Inventory 解析失败 — fallback 到原有全量 prompt 方式
      sse({ type: "scan-done", inventory: [], scanDurationMs: scanResult.durationMs, fallback: true });
    } else {
      sse({ type: "scan-done", inventory, scanDurationMs: scanResult.durationMs });
    }

    // ---- Phase 2: 轻量 LLM 分类 ----
    if (inventory.length > 0) {
      sse({ type: "classify-start", cellCount: cellsToAnalyze.length });

      const classifyResult = await runClassify({
        cwd: sandboxPath,
        systemPrompt: "You are a precise status classifier. Based on the code inventory, classify each cell's implementation status. Output ONLY the JSON array wrapped in tags, nothing else.",
        userPrompt: buildClassifyPrompt(inventory, cellsToAnalyze),
        maxTokens: 4096,
      });

      const parsed = parseAnalysisOutput(classifyResult.text);
      const results = buildAnalysisResults(parsed, cellsToAnalyze);

      updateRun(db, run.id, "done");
      sse({
        type: "analyze-done",
        results,
        scanDurationMs: scanResult.durationMs,
        classifyDurationMs: classifyResult.durationMs,
        inventorySize: inventory.length,
      });
    } else {
      // Fallback: inventory 为空，用原有全量 prompt 方式
      await runFallbackBulkAnalysis(cellsToAnalyze, sandboxPath, db, run, sse);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try { updateRun(db, run.id, "failed"); } catch { /* ignore */ }
    sse({ type: "error", message });
  }
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

  const userPrompt = buildCellAnalysisPrompt(cellsToAnalyze);
  const systemPrompt = "You are a code analysis assistant. Analyze Java source code to determine implementation status of features. Be precise and factual.";

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

function buildCellAnalysisPrompt(cells: CellInfo[]): string {
  const lines = cells.map((c) => {
    const handler = c.feature.target.handler || "(无)";
    const actions = c.feature.target.actions.length > 0 ? c.feature.target.actions.join(", ") : "(无)";
    return `- cellId: ${c.cellId} | feature: ${c.feature.name} | scenario: ${c.scenario.name} | handler: ${handler} | actions: ${actions} | currentStatus: ${c.scenario.status}`;
  });

  return `## 任务

你是 HelmFlow 状态分析器。请分析当前项目的代码,判断以下每个格子(feature × scenario)的实现状态。

分析维度:
1. 扫描 target.handler 对应的 Java 类是否存在(在 src/main/java 下)
2. 扫描 target.actions 对应的 Java 类是否存在
3. 如果类存在,分析代码逻辑是否完整覆盖该功能(vs 只是骨架/占位/TODO)
4. 如果 currentStatus 是"废弃",保持不动

判断规则:
- 类存在且逻辑完整 → "已支持"
- 类存在但逻辑不完整或不适配 → "需改造"
- 类不存在 → "待实现"
- currentStatus 为"废弃" → 保持"废弃"

## 待分析格子

${lines.join("\n")}

## 输出格式

请输出 JSON 数组,每个元素:
\`\`\`json
[
  {"cellId": "D-01__正式签约", "newStatus": "已支持", "reason": "SaveDeliverRecordHandler 类存在且逻辑完整"},
  ...
]
\`\`\`

只输出 JSON 数组,不要其他内容。用 \`<ANALYSIS_RESULT>\` 和 \`</ANALYSIS_RESULT>\` 标签包裹。`;
}

function buildAnalysisResults(
  parsed: Array<{ cellId: string; newStatus: string; reason: string }>,
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
    });
  }
  return results;
}