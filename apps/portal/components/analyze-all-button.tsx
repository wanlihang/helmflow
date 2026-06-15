"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  useAnalyzeLog,
  formatToolEvent,
  type AnalysisResult,
  type AnalyzeGetResponse,
  type AnalyzeSseEvent,
} from "@/lib/analyze-utils";
import { parseSseChunk, extractSseData } from "@/lib/sse-parse";

export function AnalyzeAllButton() {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<AnalysisResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { logLines, logRef, appendLog, appendToken, clearLog } = useAnalyzeLog();
  const lastEventIdRef = useRef<number>(0);
  const activeRunIdRef = useRef<string | null>(null);

  // ---- On mount: restore in-progress or completed analyze run from DB ----
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const res = await fetch("/api/analyze-status");
        if (!res.ok) return;
        const data = (await res.json()) as AnalyzeGetResponse;
        if (stopped) return;

        if (!data.run) return;

        // 跳过已应用的分析结果，避免刷新后重复弹窗
        if (data.run.state === "applied") return;

        // 如果还在跑 → 恢复 analyzing 状态
        if (data.run.state === "running") {
          setAnalyzing(true);
        }
        activeRunIdRef.current = data.run.id;

        // 回放所有事件到日志（无论 running 还是 done）
        if (data.events.length > 0) {
          for (const ev of data.events) {
            if (ev.id > lastEventIdRef.current) lastEventIdRef.current = ev.id;
            replayDbEvent(ev);
          }
        }

        // 已完成且有结果且未被应用 → 恢复结果弹窗
        if (data.run.state === "done" && data.results.length > 0) {
          setResults(data.results);
        }
      } catch {
        // ignore
      }
    })();
    return () => { stopped = true; };
  }, []);

  function replayDbEvent(ev: { payload: Record<string, unknown> }) {
    const p = ev.payload as Record<string, any>;
    switch (p.type) {
      case "analyze-start":
        if (p.phase === "scan") {
          appendLog(`📋 代码扫描启动 (scope=${p.scope ?? "?"})，共 ${p.totalCells ?? "?"} 个格子待分类`);
        } else {
          appendLog(`📋 分析任务启动，共 ${p.totalCells ?? "?"} 个格子 (scope=${p.scope ?? "?"})`);
        }
        break;
      case "scan-done": {
        const inv = p.inventory as unknown[];
        const fb = p.fallback ? "（降级模式）" : "";
        appendLog(`✅ 代码扫描完成${fb}，发现 ${inv?.length ?? 0} 个类 (${((p.scanDurationMs ?? 0) / 1000).toFixed(1)}s)`);
        break;
      }
      case "classify-start":
        appendLog(`📋 基于扫描结果分类 ${p.cellCount ?? "?"} 个格子状态...${p.fallback ? "（降级模式）" : ""}`);
        break;
      case "tool_use":
        appendLog(formatToolEvent(p.name ?? "?", p.input));
        break;
      case "tool_result":
        if (p.isError) appendLog(`⚠️ 工具失败: ${(p.preview ?? "").slice(0, 100)}`);
        break;
      case "token":
        if (p.text) appendToken(p.text);
        break;
      case "analyze-done": {
        const res = p.results as AnalysisResult[] | undefined;
        if (res && res.length > 0) {
          appendLog(`✅ 分析完成: 发现 ${res.length} 项状态变更`);
          for (const r of res) {
            appendLog(`  · ${r.cellId}: ${r.oldStatus} → ${r.newStatus} (${r.reason})`);
          }
        } else {
          appendLog("✅ 分析完成: 无状态变更");
        }
        if (p.scanDurationMs != null && p.classifyDurationMs != null) {
          appendLog(`⏱ 扫描 ${(p.scanDurationMs / 1000).toFixed(1)}s + 分类 ${(p.classifyDurationMs / 1000).toFixed(1)}s · 清单 ${p.inventorySize ?? "?"} 个类`);
        } else if (p.durationMs != null) {
          appendLog(`⏱ 耗时 ${(p.durationMs / 1000).toFixed(1)}s · ${p.turns ?? "?"} turns`);
        }
        break;
      }
      case "error":
        setError(p.message as string);
        appendLog(`❌ 错误: ${p.message ?? "Unknown error"}`);
        break;
    }
  }

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError(null);
    setResults(null);
    clearLog();

    appendLog("▶ 开始全量分析...");

    try {
      const res = await fetch("/api/analyze-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      });

      if (!res.ok || !res.body) {
        setError(`HTTP ${res.status}`);
        setAnalyzing(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const { messages, remainder } = parseSseChunk(buffer, chunk);
        buffer = remainder;
        for (const msg of messages) {
          const dataStr = extractSseData(msg);
          if (!dataStr) continue;
          try {
            const event = JSON.parse(dataStr) as AnalyzeSseEvent;
            if (event.runId) activeRunIdRef.current = event.runId;
            switch (event.type) {
              case "analyze-start":
                if (event.phase === "scan") {
                  appendLog(`📋 代码扫描启动 (scope=${event.scope ?? "?"})，共 ${event.totalCells ?? "?"} 个格子待分类`);
                } else {
                  appendLog(`📋 分析任务启动，共 ${event.totalCells ?? "?"} 个格子 (scope=${event.scope ?? "?"})`);
                }
                break;
              case "scan-done": {
                const inv = event.inventory as unknown[] | undefined;
                const fb = event.fallback ? "（降级模式）" : "";
                appendLog(`✅ 代码扫描完成${fb}，发现 ${inv?.length ?? 0} 个类 (${((event.scanDurationMs ?? 0) / 1000).toFixed(1)}s)`);
                break;
              }
              case "classify-start":
                appendLog(`📋 基于扫描结果分类 ${event.cellCount ?? "?"} 个格子状态...${event.fallback ? "（降级模式）" : ""}`);
                break;
              case "tool_use":
                appendLog(formatToolEvent(event.name ?? "?", event.input));
                break;
              case "tool_result":
                if (event.isError) appendLog(`⚠️ 工具失败: ${(event.preview ?? "").slice(0, 100)}`);
                break;
              case "token":
                if (event.text) appendToken(event.text);
                break;
              case "analyze-done":
                if (event.results && event.results.length > 0) {
                  setResults(event.results);
                  appendLog(`✅ 分析完成: 发现 ${event.results.length} 项状态变更`);
                  for (const r of event.results) {
                    appendLog(`  · ${r.cellId}: ${r.oldStatus} → ${r.newStatus} (${r.reason})`);
                  }
                } else {
                  appendLog("✅ 分析完成: 无状态变更");
                }
                if (event.scanDurationMs != null && event.classifyDurationMs != null) {
                  appendLog(`⏱ 扫描 ${(event.scanDurationMs / 1000).toFixed(1)}s + 分类 ${(event.classifyDurationMs / 1000).toFixed(1)}s · 清单 ${event.inventorySize ?? "?"} 个类`);
                } else if (event.durationMs != null) {
                  appendLog(`⏱ 耗时 ${(event.durationMs / 1000).toFixed(1)}s · ${event.turns ?? "?"} turns`);
                }
                break;
              case "error":
                setError(event.message ?? "Unknown error");
                appendLog(`❌ 错误: ${event.message ?? "Unknown error"}`);
                break;
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      appendLog(`❌ 请求失败: ${msg}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleApplyAll = async () => {
    if (!results || results.length === 0) return;
    try {
      const res = await fetch("/api/analyze-status/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: results.map((r) => ({ cellId: r.cellId, newStatus: r.newStatus })),
          runId: activeRunIdRef.current ?? undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        appendLog(`❌ 应用失败: ${(data as { error?: string }).error ?? `HTTP ${res.status}`}`);
        return;
      }
      setResults(null);
      clearLog();
      router.refresh();
    } catch (err) {
      appendLog(`❌ 应用失败: ${(err as Error).message}`);
    }
  };

  const handleApplyOne = async (cellId: string, newStatus: string) => {
    try {
      const res = await fetch("/api/analyze-status/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ cellId, newStatus }],
          runId: activeRunIdRef.current ?? undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        appendLog(`❌ 应用失败: ${cellId} — ${(data as { error?: string }).error ?? `HTTP ${res.status}`}`);
        return;
      }
      const remaining = results?.filter((r) => r.cellId !== cellId) ?? [];
      setResults(remaining.length > 0 ? remaining : null);
      appendLog(`✅ 已应用: ${cellId}`);
      if (remaining.length === 0) {
        clearLog();
        router.refresh();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog(`❌ 应用失败: ${cellId} — ${msg}`);
    }
  };

  const showLog = analyzing || logLines.length > 0;

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleAnalyze}
        disabled={analyzing}
      >
        {analyzing ? "分析中..." : "重新分析状态"}
      </Button>

      {showLog && (
        <pre
          ref={logRef}
          className="mt-2 w-full max-w-2xl whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-[11px] leading-relaxed max-h-48 overflow-auto font-mono"
        >
          {logLines.join("\n")}
          {analyzing && <span className="animate-pulse">▍</span>}
        </pre>
      )}

      {error && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {results && results.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-h-[80vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-white p-4 shadow-lg">
            <h3 className="mb-3 text-lg font-semibold">分析结果 — {results.length} 项变更</h3>
            <div className="space-y-2">
              {results.map((r) => (
                <div key={r.cellId} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs">
                  <div className="flex-1">
                    <div className="font-mono font-semibold">{r.cellId}</div>
                    <div className="text-muted-foreground">
                      {r.oldStatus} → <span className="font-semibold text-foreground">{r.newStatus}</span>
                    </div>
                    <div className="text-muted-foreground">{r.reason}</div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="rounded bg-green-100 px-2 py-1 text-green-700 hover:bg-green-200"
                      onClick={() => handleApplyOne(r.cellId, r.newStatus)}
                    >
                      应用
                    </button>
                    <button
                      type="button"
                      className="rounded bg-gray-100 px-2 py-1 text-gray-600 hover:bg-gray-200"
                      onClick={() => setResults((prev) => prev?.filter((x) => x.cellId !== r.cellId) ?? null)}
                    >
                      跳过
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setResults(null)}>
                关闭
              </Button>
              <Button size="sm" onClick={handleApplyAll}>
                全部应用
              </Button>
            </div>
          </div>
        </div>
      )}

      {results && results.length === 0 && (
        <div className="mt-2 rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-700">
          分析完成,无状态变更。
        </div>
      )}
    </div>
  );
}