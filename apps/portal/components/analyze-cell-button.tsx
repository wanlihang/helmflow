"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  useAnalyzeLog,
  formatToolEvent,
  type AnalysisResult as AnalysisResultType,
  type AnalyzeGetResponse,
  type AnalyzeSseEvent,
} from "@/lib/analyze-utils";
import { parseSseChunk, extractSseData } from "@/lib/sse-parse";

interface AnalyzeCellButtonProps {
  cellId: string;
}

type CellResult = Pick<AnalysisResultType, "oldStatus" | "newStatus" | "reason">;

export function AnalyzeCellButton({ cellId }: AnalyzeCellButtonProps) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<CellResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { logLines, logRef, appendLog, appendToken, clearLog } = useAnalyzeLog();
  const lastEventIdRef = useRef<number>(0);
  const activeRunIdRef = useRef<string | null>(null);

  const formatResult = (r: CellResult) =>
    `${r.oldStatus} → ${r.newStatus}`;

  // ---- On mount: restore latest analyze result from DB ----
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const res = await fetch(`/api/analyze-status?cellId=${encodeURIComponent(cellId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as AnalyzeGetResponse;
        if (stopped) return;

        if (!data.run) return;

        // 跳过已应用的分析结果，避免刷新后重复弹窗
        if (data.run.state === "applied") return;

        if (data.run.state === "running") {
          setAnalyzing(true);
          activeRunIdRef.current = data.run.id;
        } else {
          activeRunIdRef.current = data.run.id;
        }

        if (data.events.length > 0) {
          for (const ev of data.events) {
            if (ev.id > lastEventIdRef.current) lastEventIdRef.current = ev.id;
            replayDbEvent(ev);
          }
        }

        if (data.run.state === "done" && data.results.length > 0) {
          const r = data.results[0]!;
          setResult({ oldStatus: r.oldStatus, newStatus: r.newStatus, reason: r.reason });
        }
      } catch {
        // ignore — first load failure is non-critical
      }
    })();
    return () => { stopped = true; };
  }, [cellId]);

  function replayDbEvent(ev: { payload: Record<string, unknown> }) {
    const p = ev.payload as Record<string, any>;
    switch (p.type) {
      case "analyze-start":
        appendLog(`▶ 开始分析 cell: ${cellId}`);
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
        const results = p.results as CellResult[] | undefined;
        if (results && results.length > 0) {
          appendLog(`✅ 分析完成: ${formatResult(results[0]!)}`);
        } else {
          appendLog("✅ 分析完成: 状态无变化");
        }
        if (p.durationMs != null) {
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
    setResult(null);
    clearLog();

    appendLog(`▶ 开始分析 cell: ${cellId}`);

    try {
      const res = await fetch("/api/analyze-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "cell", cellId }),
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
                appendLog(`📋 分析任务启动，共 ${event.totalCells ?? "?"} 个格子`);
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
                  const r = event.results[0]!;
                  setResult({ oldStatus: r.oldStatus, newStatus: r.newStatus, reason: r.reason });
                  appendLog(`✅ 分析完成: ${formatResult(r)}`);
                } else {
                  appendLog("✅ 分析完成: 状态无变化");
                }
                if (event.durationMs != null) {
                  appendLog(`⏱ 耗时 ${(event.durationMs / 1000).toFixed(1)}s · ${event.turns ?? "?"} turns`);
                }
                break;
              case "error":
                setError(event.message ?? "Unknown error");
                appendLog(`❌ 错误: ${event.message ?? "Unknown error"}`);
                break;
            }
          } catch {
            // skip malformed event
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

  const handleApply = async () => {
    if (!result) return;
    try {
      const res = await fetch("/api/analyze-status/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ cellId, newStatus: result.newStatus }],
          runId: activeRunIdRef.current ?? undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(`应用失败: ${(data as { error?: string }).error ?? `HTTP ${res.status}`}`);
        return;
      }
      const data = (await res.json()) as { applied: string[]; skipped: string[]; errors?: string[] };
      if (data.errors && data.errors.length > 0) {
        setError(`应用出错: ${data.errors.join("; ")}`);
        return;
      }
      if (data.skipped?.length > 0) {
        setError(`部分项被跳过: ${data.skipped.join(", ")}`);
      }
      setResult(null);
      router.refresh();
    } catch (err) {
      setError(`应用失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const showLog = analyzing || logLines.length > 0;

  return (
    <div className="inline-flex flex-col items-start gap-2">
      <Button variant="outline" size="sm" onClick={handleAnalyze} disabled={analyzing}>
        {analyzing ? "分析中..." : "重新分析"}
      </Button>

      {showLog && (
        <pre
          ref={logRef}
          className="w-full max-w-lg whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-[11px] leading-relaxed max-h-48 overflow-auto font-mono"
        >
          {logLines.join("\n")}
          {analyzing && <span className="animate-pulse">▍</span>}
        </pre>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}

      {result && (
        <div className="rounded-md border border-border bg-muted p-2 text-xs space-y-1">
          <div>
            {result.oldStatus} → <span className="font-semibold">{result.newStatus}</span>
          </div>
          <div className="text-muted-foreground">{result.reason}</div>
          <div className="flex gap-1 mt-1">
            <button
              type="button"
              className="rounded bg-green-100 px-2 py-0.5 text-green-700 hover:bg-green-200"
              onClick={handleApply}
            >
              应用
            </button>
            <button
              type="button"
              className="rounded bg-gray-100 px-2 py-0.5 text-gray-600 hover:bg-gray-200"
              onClick={() => setResult(null)}
            >
              跳过
            </button>
          </div>
        </div>
      )}
    </div>
  );
}