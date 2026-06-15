"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StructureReviewDialog } from "@/components/structure-review-dialog";
import { parseSseChunk, extractSseData } from "@/lib/sse-parse";
import { useAnalyzeLog, formatToolEvent } from "@/lib/analyze-utils";
import type { StructureAnalysisResult } from "@/lib/structure-analyzer";
import { AddFeatureDialog } from "@/components/add-feature-dialog";

interface EmptyMatrixGuideProps {
  projectId: string;
}

interface StructureGetResponse {
  run: { id: string; state: string; startedAt: string } | null;
  events: Array<{ id: number; type: string; payload: Record<string, unknown>; createdAt: string }>;
  result: StructureAnalysisResult | null;
}

export function EmptyMatrixGuide({ projectId }: EmptyMatrixGuideProps) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const [structureResult, setStructureResult] =
    useState<StructureAnalysisResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumedRunning, setResumedRunning] = useState(false);
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

        // 回放所有历史事件到日志（无论什么状态都先回放）
        if (data.events.length > 0) {
          for (const ev of data.events) {
            replayDbEvent(ev.payload);
          }
        }

        if (data.run.state === "running") {
          // 之前的分析还在跑但 SSE 已断，恢复 analyzing 状态让用户看到进度日志
          // 用户可以点击"重新分析"按钮发起新一轮分析
          setAnalyzing(true);
          setResumedRunning(true);
          appendLog("⚠️ 检测到上次分析仍在进行中，可等待或点击按钮重新分析");
        } else if (data.run.state === "done" && data.result) {
          // 已完成且有结果 → 恢复结果并弹出审阅对话框
          setStructureResult(data.result);
          setRunId(data.run.id);
          setTimeout(() => setReviewOpen(true), 300);
        } else if (data.run.state === "applied") {
          // 已应用的分析结果，不弹窗
        } else if (data.run.state === "failed") {
          setError("上次分析未成功，请重试");
        }
      } catch {
        // 首次加载失败不致命
      }
    })();
    return () => { stopped = true; };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  function replayDbEvent(p: Record<string, unknown>) {
    if (typeof p.runId === "string") setRunId(p.runId);
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
    setResumedRunning(false);
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
            if (typeof event.runId === "string") setRunId(event.runId);
            switch (event.type) {
              case "structure-start":
                appendLog(`📋 结构分析启动...`);
                break;
              case "scan-done":
                appendLog(
                  `✅ 扫描完成：${event.handlerCount ?? 0} Handler，${event.inventorySize ?? 0} 个类`,
                );
                break;
              case "structure-infer-start":
                appendLog(`📋 推断域 / 功能点 / 场景...`);
                break;
              case "tool_use":
                appendLog(
                  formatToolEvent(
                    event.name as string,
                    event.input as Record<string, unknown>,
                  ),
                );
                break;
              case "tool_result":
                if (event.isError)
                  appendLog(
                    `⚠️ ${(event.preview as string ?? "").slice(0, 80)}`,
                  );
                break;
              case "token":
                if (event.text) appendToken(event.text as string);
                break;
              case "structure-done": {
                const result = event.result as StructureAnalysisResult;
                setStructureResult(result);
                const totalFeatures = result.domains.reduce(
                  (acc, d) => acc + d.features.length,
                  0,
                );
                appendLog(
                  `✅ 完成：${result.domains.length} 域 / ${totalFeatures} 功能点`,
                );
                setTimeout(() => setReviewOpen(true), 300);
                break;
              }
              case "error":
                setError(event.message as string);
                appendLog(`❌ ${event.message ?? "Error"}`);
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
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="max-w-md text-center space-y-4">
        <div className="text-4xl">🗺️</div>
        <h2 className="text-xl font-semibold">项目矩阵为空</h2>
        <p className="text-sm text-muted-foreground">
          注册项目后，HelmFlow 可以自动分析代码结构，识别功能点和场景，
          快速生成功能点×场景的业务全景矩阵。
        </p>

        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={handleAnalyze} disabled={analyzing && !resumedRunning}>
            {analyzing && !resumedRunning
              ? "正在分析..."
              : resumedRunning
                ? "🔄 重新分析"
                : "🔍 分析项目结构（推荐）"}
          </Button>
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            ✏️ 手动添加功能点
          </Button>
        </div>

        {/* 分析日志 */}
        {(analyzing || logLines.length > 0) && (
          <pre
            ref={logRef}
            className="mt-4 w-full whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-[11px] leading-relaxed max-h-40 overflow-auto text-left font-mono"
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
      </div>

      {/* 手动添加功能点 */}
      <AddFeatureDialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) router.refresh();
        }}
        defaultDomain="default"
        projectId={projectId}
      />

      {/* 结构分析审阅 */}
      {structureResult && (
        <StructureReviewDialog
          open={reviewOpen}
          onOpenChange={(open) => {
            setReviewOpen(open);
            if (!open) router.refresh();
          }}
          result={structureResult}
          projectId={projectId}
          runId={runId ?? undefined}
        />
      )}
    </div>
  );
}
