"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// ─── SSE utilities (shared by all agent run buttons) ────────────────

export type SseEvent =
  | { type: "system-init"; sessionId: string; cwd: string; model: string }
  | { type: "token"; text: string }
  | { type: "tool_use"; toolUseId: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; isError: boolean; preview: string }
  | {
      type: "result-cost";
      success: boolean;
      turns: number;
      durationMs: number;
      costUsd: number | null;
    }
  | {
      type: "done";
      status: "passed" | "blocked";
      runId: string;
      [key: string]: unknown;
    }
  | { type: "error"; message: string };

/** Agent-start events (coder-start, qa-start, etc.) are ignored by the UI */

export interface ToolCallEntry {
  toolUseId: string;
  name: string;
  inputSummary: string;
  resultPreview?: string;
  isError?: boolean;
}

export function parseSseLine(line: string): SseEvent | null {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6).trim();
  if (payload.length === 0) return null;
  try {
    return JSON.parse(payload) as SseEvent;
  } catch {
    return null;
  }
}

export function summarizeToolInput(name: string, input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input !== "object") return String(input).slice(0, 120);
  const obj = input as Record<string, unknown>;
  if (name === "Bash" && typeof obj.command === "string") {
    return obj.command.slice(0, 120);
  }
  if (name === "Read" && typeof obj.file_path === "string") {
    return obj.file_path;
  }
  if (
    (name === "Write" || name === "Edit") &&
    typeof obj.file_path === "string"
  ) {
    return obj.file_path;
  }
  try {
    return JSON.stringify(obj).slice(0, 120);
  } catch {
    return "";
  }
}

export interface SseRunResult {
  status: "passed" | "blocked";
  runId: string;
  [key: string]: unknown;
}

// ─── Hook: useSseRun ────────────────────────────────────────────────

export interface UseSseRunOptions {
  /** API endpoint, e.g. "/api/code/run" */
  endpoint: string;
  /** JSON body sent as POST */
  body: Record<string, unknown>;
  /** Called when SSE stream ends with a "done" event (after router.refresh) */
  onDone?: (result: SseRunResult) => void;
  /** GET endpoint to restore previous run state on mount (e.g. "/api/code/run?contractId=xxx") */
  restoreEndpoint?: string;
  /** Called when a previous run is restored from DB on mount (run existed, regardless of state) */
  onRestored?: (state: string) => void;
}

export interface UseSseRunReturn {
  running: boolean;
  tokens: string;
  tools: ToolCallEntry[];
  sessionInfo: { cwd: string; model: string } | null;
  final: SseRunResult | null;
  errorMessage: string | null;
  /** True when the running state was restored from DB (SSE 已断，可重新运行) */
  resumedRunning: boolean;
  run: () => Promise<void>;
  reset: () => void;
}

/** DB 恢复响应（所有 GET 端点统一格式） */
interface RestoreResponse {
  run: { id: string; state: string; startedAt: string } | null;
  events: Array<{ id: number; type: string; payload: Record<string, unknown>; createdAt: string }>;
  result: Record<string, unknown> | null;
}

export function useSseRun({
  endpoint,
  body,
  onDone,
  restoreEndpoint,
  onRestored,
}: UseSseRunOptions): UseSseRunReturn {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [tokens, setTokens] = useState("");
  const [tools, setTools] = useState<ToolCallEntry[]>([]);
  const [sessionInfo, setSessionInfo] = useState<{
    cwd: string;
    model: string;
  } | null>(null);
  const [final, setFinal] = useState<SseRunResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resumedRunning, setResumedRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    setRunning(false);
    setResumedRunning(false);
    setTokens("");
    setTools([]);
    setSessionInfo(null);
    setFinal(null);
    setErrorMessage(null);
  };

  // ─── 从 DB 事件回放状态 ───────────────────────────────────────────
  const applyEvent = (ev: SseEvent | Record<string, unknown>) => {
    const type = (ev as { type: string }).type;
    if (type === "token") {
      const text = (ev as { text?: string }).text;
      if (typeof text === "string") setTokens((prev) => prev + text);
    } else if (type === "system-init") {
      const e = ev as { cwd?: string; model?: string };
      if (e.cwd && e.model) setSessionInfo({ cwd: e.cwd, model: e.model });
    } else if (type === "tool_use") {
      const e = ev as { toolUseId: string; name: string; input: unknown };
      const t: ToolCallEntry = {
        toolUseId: e.toolUseId,
        name: e.name,
        inputSummary: summarizeToolInput(e.name, e.input),
      };
      setTools((prev) => [...prev, t]);
    } else if (type === "tool_result") {
      const e = ev as { toolUseId: string; preview?: string; isError?: boolean };
      setTools((prev) =>
        prev.map((t) =>
          t.toolUseId === e.toolUseId
            ? { ...t, resultPreview: e.preview, isError: e.isError }
            : t,
        ),
      );
    } else if (type === "done") {
      const e = ev as Record<string, unknown>;
      // 兼容两种 done 形态:
      //   - require/orchestrator: { status: "passed" | "blocked" }
      //   - code/test/deploy:     { success: boolean }
      const rawStatus = e.status;
      const rawSuccess = e.success;
      const status: "passed" | "blocked" =
        rawStatus === "passed" || rawStatus === "blocked"
          ? rawStatus
          : rawSuccess === true
            ? "passed"
            : "blocked";
      const runId = (typeof e.runId === "string" && e.runId) || "";
      const {
        type: _t,
        status: _s,
        runId: _r,
        success: _su,
        ...rest
      } = e as {
        type: string;
        status?: string;
        runId?: string;
        success?: boolean;
      } & Record<string, unknown>;
      const result: SseRunResult = { status, runId, ...rest };
      setFinal(result);
    } else if (type === "error") {
      setErrorMessage((ev as { message?: string }).message ?? "Unknown error");
    }
  };

  // ─── On mount: restore previous run from DB ───────────────────────
  useEffect(() => {
    if (!restoreEndpoint) return;
    let stopped = false;
    (async () => {
      try {
        const res = await fetch(restoreEndpoint);
        if (!res.ok) return;
        const data = (await res.json()) as RestoreResponse;
        if (stopped || !data.run) return;

        // 回放所有事件
        for (const ev of data.events) {
          applyEvent(ev.payload);
        }

        if (data.run.state === "running") {
          // SSE 已断，恢复 running 状态让用户看到进度并允许重新运行
          setRunning(true);
          setResumedRunning(true);
          onRestored?.(data.run.state);
        } else if (data.run.state === "done" && data.result) {
          // 已完成 → 恢复 final（applyEvent 已处理 done，这里兜底）
          if (!data.events.some((e) => e.type === "done")) {
            applyEvent({ ...data.result, type: "done" });
          }
          onRestored?.(data.run.state);
        } else if (data.run.state === "failed") {
          onRestored?.(data.run.state);
        }
      } catch {
        // 首次加载失败不致命
      }
    })();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreEndpoint]);

  const run = async () => {
    reset();
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) detail = `${detail} — ${j.error}`;
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      if (!res.body) throw new Error("响应体为空,无法读取 SSE 流");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nlIdx = buffer.indexOf("\n");
        while (nlIdx >= 0) {
          const line = buffer.slice(0, nlIdx).replace(/\r$/, "");
          buffer = buffer.slice(nlIdx + 1);
          nlIdx = buffer.indexOf("\n");
          const ev = parseSseLine(line);
          if (!ev) continue;

          applyEvent(ev);

          if (ev.type === "done") {
            // 兼容 status (require/orchestrator) 与 success (code/test/deploy) 两种形态
            const rawSuccess = (ev as { success?: boolean }).success;
            const evStatus = ev.status;
            const status: "passed" | "blocked" =
              evStatus === "passed" || evStatus === "blocked"
                ? evStatus
                : rawSuccess === true
                  ? "passed"
                  : "blocked";
            const runId = ev.runId ?? "";
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { type: _type, status: _status, runId: _runId, success: _su, ...rest } = ev;
            const result: SseRunResult = { status, runId, ...rest };
            onDone?.(result);
            router.refresh();
            finished = true;
            break;
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          }
          // Ignore unknown event types (agent-start, etc.)
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  return {
    running,
    tokens,
    tools,
    sessionInfo,
    final,
    errorMessage,
    resumedRunning,
    run,
    reset,
  };
}

// ─── Reusable RunAgentButton ────────────────────────────────────────

export interface RunAgentButtonProps {
  /** Button label, e.g. "运行 Code" */
  label: string;
  /** Dialog title, e.g. "Code Worker" */
  title: string;
  /** Dialog description */
  description: React.ReactNode;
  /** POST endpoint, e.g. "/api/code/run" */
  endpoint: string;
  /** JSON body for the POST request */
  body: Record<string, unknown>;
  /** Small label shown next to the run button (e.g. "contract: xxx") */
  idLabel: string;
  /** Label type: "contract" or "feature" */
  idType?: "contract" | "feature";
  /** Error title, e.g. "Code 调用失败" */
  errorTitle?: string;
  /** Output stream label, e.g. "Code 文本输出" */
  outputLabel?: string;
  /** Passed status text, e.g. "✅ Code 通过" */
  passedText?: string;
  /** Blocked status text, e.g. "❌ Code 失败" */
  blockedText?: string;
  /** Custom render for the "done" result card (beyond status + stats) */
  renderResult?: (result: SseRunResult) => React.ReactNode;
  /** Callback when run finishes with "done" */
  onDone?: (result: SseRunResult) => void;
  /** GET endpoint to restore previous run state on mount */
  restoreEndpoint?: string;
}

export function RunAgentButton({
  label,
  title,
  description,
  endpoint,
  body,
  idLabel,
  idType = "feature",
  errorTitle,
  outputLabel,
  passedText,
  blockedText,
  renderResult,
  onDone,
  restoreEndpoint,
}: RunAgentButtonProps) {
  const [open, setOpen] = useState(false);
  const { running, tokens, tools, sessionInfo, final, errorMessage, resumedRunning, run, reset } =
    useSseRun({
      endpoint,
      body,
      onDone,
      restoreEndpoint,
      onRestored: (state) => {
        // 仅当上次 run 仍在进行中时自动打开对话框(核心:刷新能看到任务进行中);
        // done/failed 不打扰,用户可手动点开查看历史详情
        if (state === "running") setOpen(true);
      },
    });

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const _errorTitle = errorTitle ?? `${label} 调用失败`;
  const _outputLabel = outputLabel ?? `${label} 文本输出`;
  const _passedText = passedText ?? `✅ ${label} 通过`;
  const _blockedText = blockedText ?? `❌ ${label} 失败`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="default">{label}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {resumedRunning && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              ⚠️ 检测到上次运行仍在进行中(SSE 连接已断)。可点击「重新运行」发起新一轮,或关闭对话框。
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={run} disabled={running && !resumedRunning}>
              {resumedRunning
                ? "🔄 重新运行"
                : running
                  ? "运行中..."
                  : final
                    ? "重跑"
                    : "开始"}
            </Button>
            <span className="text-xs text-muted-foreground self-center font-mono">
              {idType}: {idLabel}
            </span>
          </div>

          {sessionInfo && (
            <div className="rounded-md border border-border bg-muted/50 p-2 text-xs text-muted-foreground font-mono">
              session · model={sessionInfo.model} · cwd={sessionInfo.cwd}
            </div>
          )}

          {errorMessage && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <div className="font-semibold">{_errorTitle}</div>
              <div className="mt-1 font-mono break-words">{errorMessage}</div>
            </div>
          )}

          {tools.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">
                工具调用流 ({tools.length})
              </div>
              <ul className="space-y-1 max-h-72 overflow-auto rounded-md border border-border bg-muted p-2 text-xs font-mono">
                {tools.map((t) => (
                  <li key={t.toolUseId} className="leading-snug">
                    <span
                      className={
                        t.isError
                          ? "text-red-700 font-semibold"
                          : "text-blue-700 font-semibold"
                      }
                    >
                      {t.name}
                    </span>{" "}
                    <span className="text-foreground">{t.inputSummary}</span>
                    {t.resultPreview && (
                      <div className="pl-3 text-[10px] text-muted-foreground break-words">
                        → {t.resultPreview.slice(0, 200)}
                        {t.resultPreview.length > 200 ? "..." : ""}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tokens && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">
                {_outputLabel} {running ? "(streaming...)" : "(完成)"}
              </div>
              <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-xs leading-relaxed max-h-60 overflow-auto">
                {tokens}
              </pre>
            </div>
          )}

          {final && (
            <div
              className={`rounded-md border p-3 text-xs ${
                final.status === "passed"
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              <div className="font-semibold">
                {final.status === "passed" ? _passedText : _blockedText}
              </div>
              {renderResult && renderResult(final)}
              <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                turns={String(final.turns ?? "?")} · duration=
                {typeof final.durationMs === "number"
                  ? `${Math.round(final.durationMs / 100) / 10}s`
                  : "?"}{" "}
                · cost=
                {final.costUsd != null
                  ? `$${Number(final.costUsd).toFixed(4)}`
                  : "?"}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={running}>
              关闭
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}