"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StructureReviewDialog } from "@/components/structure-review-dialog";
import { parseSseChunk, extractSseData } from "@/lib/sse-parse";
import {
  useAnalyzeLog,
  formatToolEvent,
} from "@/lib/analyze-utils";
import type { StructureAnalysisResult } from "@/lib/structure-analyzer";

interface AnalyzeStructureButtonProps {
  projectId: string;
}

interface StructureGetResponse {
  run: { id: string; state: string; startedAt: string } | null;
  events: Array<{ id: number; type: string; payload: Record<string, unknown>; createdAt: string }>;
  result: StructureAnalysisResult | null;
}

export function AnalyzeStructureButton({
  projectId,
}: AnalyzeStructureButtonProps) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const [structureResult, setStructureResult] =
    useState<StructureAnalysisResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const { logLines, logRef, appendLog, appendToken, clearLog } =
    useAnalyzeLog();

  // ---- On mount: restore latest analyze-structure run from DB ----
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/analyze-structure`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as StructureGetResponse;
        if (stopped) return;

        if (!data.run) return;

        // 跳过已应用的结果，避免刷新后重复弹窗
        if (data.run.state === "applied") return;

        // 如果还在跑 → 恢复 analyzing 状态
        if (data.run.state === "running") {
          setAnalyzing(true);
        }
        setRunId(data.run.id);

        // 回放所有事件到日志
        if (data.events.length > 0) {
          for (const ev of data.events) {
            replayDbEvent(ev.payload);
          }
        }

        // 已完成且有结果 → 恢复结果并弹出审阅对话框
        if (data.run.state === "done" && data.result) {
          setStructureResult(data.result);
          setTimeout(() => setReviewOpen(true), 300);
        }
      } catch {
        // 首次加载失败不致命
      }
    })();
    return () => { stopped = true; };
  }, [projectId]);

  function replayDbEvent(p: Record<string, unknown>) {
    switch (p.type) {
      case "structure-start":
        appendLog(`📋 结构分析启动 (projectId=${p.projectId ?? "?"})`);
        break;
      case "scan-done":
        appendLog(
          `✅ 代码扫描完成，发现 ${p.handlerCount ?? 0} 个 Handler，${p.inventorySize ?? 0} 个类 (${((p.scanDurationMs as number ?? 0) / 1000).toFixed(1)}s)`,
        );
        break;
      case "structure-infer-start":
        appendLog(
          `📋 开始推断结构：${p.handlerCount ?? 0} 个 Handler → 域 / 功能点 / 场景...`,
        );
        break;
      case "tool_use":
        appendLog(formatToolEvent(p.name as string, p.input as Record<string, unknown>));
        break;
      case "tool_result":
        if (p.isError)
          appendLog(`⚠️ 工具失败: ${(p.preview as string ?? "").slice(0, 100)}`);
        break;
      case "token":
        if (p.text) appendToken(p.text as string);
        break;
      case "structure-done": {
        const result = p.result as StructureAnalysisResult | undefined;
        if (result) {
          appendLog(
            `✅ 结构推断完成：${result.domains.length} 域，${result.domains.reduce((acc, d) => acc + d.features.length, 0)} 功能点`,
          );
          if (result.scanSummary) {
            appendLog(
              `⏱ 扫描 ${(result.scanSummary.scanDurationMs / 1000).toFixed(1)}s + 推断 ${(result.scanSummary.classifyDurationMs / 1000).toFixed(1)}s`,
            );
          }
        }
        break;
      }
      case "error":
        setError(p.message as string);
        appendLog(`❌ 错误: ${p.message ?? "Unknown error"}`);
        break;
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);
    setStructureResult(null);
    clearLog();
    appendLog("▶ 开始识别项目结构...");

    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/analyze-structure`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );

      if (!res.ok || !res.body) {
        const data = await res.text();
        setError(`HTTP ${res.status}: ${data}`);
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
            const event = JSON.parse(dataStr) as Record<string, unknown>;
            handleSseEvent(event);
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
  }

  function handleSseEvent(event: Record<string, unknown>) {
    if (typeof event.runId === "string") setRunId(event.runId);
    switch (event.type) {
      case "structure-start":
        appendLog(`📋 结构分析启动 (projectId=${event.projectId ?? "?"})`);
        break;
      case "scan-done":
        appendLog(
          `✅ 代码扫描完成，发现 ${event.handlerCount ?? 0} 个 Handler，${event.inventorySize ?? 0} 个类 (${((event.scanDurationMs as number ?? 0) / 1000).toFixed(1)}s)`,
        );
        break;
      case "structure-infer-start":
        appendLog(
          `📋 开始推断结构：${event.handlerCount ?? 0} 个 Handler → 域 / 功能点 / 场景...`,
        );
        break;
      case "tool_use":
        appendLog(formatToolEvent(event.name as string, event.input as Record<string, unknown>));
        break;
      case "tool_result":
        if (event.isError)
          appendLog(
            `⚠️ 工具失败: ${(event.preview as string ?? "").slice(0, 100)}`,
          );
        break;
      case "token":
        if (event.text) appendToken(event.text as string);
        break;
      case "structure-done": {
        const result = event.result as StructureAnalysisResult;
        setStructureResult(result);
        appendLog(
          `✅ 结构推断完成：${result.domains.length} 域，${result.domains.reduce((acc, d) => acc + d.features.length, 0)} 功能点`,
        );
        if (result.scanSummary) {
          appendLog(
            `⏱ 扫描 ${(result.scanSummary.scanDurationMs / 1000).toFixed(1)}s + 推断 ${(result.scanSummary.classifyDurationMs / 1000).toFixed(1)}s`,
          );
        }
        // 自动弹出审阅对话框
        setTimeout(() => setReviewOpen(true), 500);
        break;
      }
      case "error":
        setError(event.message as string);
        appendLog(`❌ 错误: ${event.message ?? "Unknown error"}`);
        break;
    }
  }

  const showLog = analyzing || logLines.length > 0;

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleAnalyze}
        disabled={analyzing}
      >
        {analyzing ? "识别中..." : "🔍 识别结构"}
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

      {structureResult && (
        <StructureReviewDialog
          open={reviewOpen}
          onOpenChange={(open) => {
            setReviewOpen(open);
            if (!open) {
              router.refresh();
            }
          }}
          result={structureResult}
          projectId={projectId}
          runId={runId ?? undefined}
        />
      )}
    </div>
  );
}
