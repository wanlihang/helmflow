"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface StartFeatureDialogProps {
  cellId: string;
  featureName: string;
  scenarioName: string;
  /** If a contract already exists for this cell, pass it so the dialog can
   *  show the result immediately instead of a blank form. */
  existingContract?: {
    id: string;
    status: string;
    markdown: string | null;
  } | null;
}

type SseEvent =
  | { type: "token"; text: string }
  | {
      type: "done";
      runId?: string;
      status?: "passed" | "blocked";
      issues?: Array<{ check: string; detail: string }>;
    }
  | { type: "error"; message: string }
  | { type: "retry-start"; round: number; reflection: string }
  | {
      type: "critic-fail";
      round: number;
      issues: Array<{ check: string; detail: string }>;
    }
  | { type: "contract-draft"; contractId: string; markdownPath: string }
  | {
      type: "system-init";
      sessionId: string;
      cwd: string;
      model: string;
    }
  | {
      type: "tool_use";
      toolUseId: string;
      name: string;
      input: unknown;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      isError: boolean;
      preview: string;
    }
  | {
      type: "result-cost";
      success: boolean;
      turns: number;
      durationMs: number;
      costUsd: number | null;
    };

interface ToolCallEntry {
  toolUseId: string;
  name: string;
  inputSummary: string;
  resultPreview?: string;
  isError?: boolean;
}

function summarizeToolInput(name: string, input: unknown): string {
  if (input === null || input === undefined) return "";
  if (typeof input !== "object") return String(input).slice(0, 120);
  const obj = input as Record<string, unknown>;
  if (name === "Read" && typeof obj.file_path === "string") return obj.file_path;
  if (name === "Bash" && typeof obj.command === "string")
    return obj.command.slice(0, 120);
  try {
    return JSON.stringify(obj).slice(0, 120);
  } catch {
    return "";
  }
}

function parseSseLine(line: string): SseEvent | null {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6).trim();
  if (payload.length === 0) return null;
  try {
    return JSON.parse(payload) as SseEvent;
  } catch {
    return null;
  }
}

export function StartFeatureDialog({
  cellId,
  featureName,
  scenarioName,
  existingContract,
}: StartFeatureDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userRequest, setUserRequest] = useState("");
  const [clarifying, setClarifying] = useState(false);
  const [clarifierOutput, setClarifierOutput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [criticIssues, setCriticIssues] = useState<
    Array<{ round: number; issues: Array<{ check: string; detail: string }> }>
  >([]);
  const [finalStatus, setFinalStatus] = useState<
    "passed" | "blocked" | null
  >(null);
  const [tools, setTools] = useState<ToolCallEntry[]>([]);
  const [sessionInfo, setSessionInfo] = useState<{
    cwd: string;
    model: string;
  } | null>(null);
  const [costInfo, setCostInfo] = useState<{
    turns: number;
    durationMs: number;
    costUsd: number | null;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  
  const abortStream = () => {
    if (abortRef.current !== null) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      abortStream();
    };
  }, []);

  // ─── On mount: restore latest Clarifier run from DB ───────────────
  // 若上次运行还在 running(但 SSE 已断)或已完成,自动打开对话框并回放状态。
  const [resumedRunning, setResumedRunning] = useState(false);

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const res = await fetch(`/api/require?cellId=${encodeURIComponent(cellId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          run: { id: string; state: string; startedAt: string } | null;
          events: Array<{ type: string; payload: Record<string, unknown> }>;
        };
        if (stopped || !data.run) return;

        // 仅当上次 run 仍在进行中时才自动打开对话框(核心:刷新能看到任务进行中);
        // done/failed 不打扰 — 详情页会通过 router.refresh 展示契约/状态,用户可手动打开查看历史
        const isRunning = data.run.state === "running";
        const hasStreamContent = data.events.some((e) =>
          e.type === "token" || e.type === "tool_use" || e.type === "done" || e.type === "contract-draft",
        );
        if (!hasStreamContent) return;
        if (isRunning) setOpen(true);

        // 回放事件(无论是否打开对话框,都先回放,用户手动打开时即可看到)
        let aggregated = "";
        for (const ev of data.events) {
          const p = ev.payload;
          if (p.type === "token" && typeof p.text === "string") {
            aggregated += p.text;
            setClarifierOutput(aggregated);
          } else if (p.type === "system-init") {
            const cwd = typeof p.cwd === "string" ? p.cwd : "";
            const model = typeof p.model === "string" ? p.model : "";
            if (cwd && model) setSessionInfo({ cwd, model });
          } else if (p.type === "tool_use") {
            const name = typeof p.name === "string" ? p.name : "";
            setTools((prev) => [
              ...prev,
              {
                toolUseId: typeof p.toolUseId === "string" ? p.toolUseId : "",
                name,
                inputSummary: summarizeToolInput(name, p.input),
              },
            ]);
          } else if (p.type === "retry-start") {
            // 多轮重试:清空上一轮的 token 聚合,只展示最新一轮输出
            aggregated = "";
            setClarifierOutput("");
          } else if (p.type === "critic-fail") {
            setCriticIssues((prev) => [
              ...prev,
              {
                round: typeof p.round === "number" ? p.round : 0,
                issues: Array.isArray(p.issues) ? (p.issues as Array<{ check: string; detail: string }>) : [],
              },
            ]);
          } else if (p.type === "done") {
            setFinalStatus(p.status === "blocked" ? "blocked" : "passed");
          }
        }

        if (data.run.state === "running") {
          setResumedRunning(true);
          setClarifying(true);
        }
      } catch {
        // 首次加载失败不致命
      }
    })();
    return () => { stopped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellId]);

  // Don't reset everything on close — keep the result visible on reopen.
  // Only reset the "input" state, not the "output" state.
  const resetInput = () => {
    setUserRequest("");
  };

  const resetAll = () => {
    abortStream();
    setUserRequest("");
    setClarifying(false);
    setResumedRunning(false);
    setClarifierOutput("");
    setErrorMessage(null);
    setCriticIssues([]);
    setFinalStatus(null);
    setTools([]);
    setSessionInfo(null);
    setCostInfo(null);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // Closing the dialog — just abort the stream but keep output visible
      abortStream();
      setClarifying(false);
    }
  };

  const runClarifier = async () => {
    setErrorMessage(null);
    setCriticIssues([]);
    setFinalStatus(null);
    setResumedRunning(false);
    setTools([]);
    setSessionInfo(null);
    setCostInfo(null);
    setClarifying(true);
    setClarifierOutput("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/require", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId: cellId.split("__")[0], scenarioName, userRequest }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const json = (await res.json()) as { error?: string };
          if (json.error) detail = `${detail} — ${json.error}`;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }
      if (!res.body) {
        throw new Error("响应体为空,无法读取 SSE 流");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let aggregated = "";
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

          if (ev.type === "token") {
            aggregated += ev.text;
            setClarifierOutput(aggregated);
          } else if (ev.type === "system-init") {
            setSessionInfo({ cwd: ev.cwd, model: ev.model });
          } else if (ev.type === "tool_use") {
            setTools((prev) => [
              ...prev,
              {
                toolUseId: ev.toolUseId,
                name: ev.name,
                inputSummary: summarizeToolInput(ev.name, ev.input),
              },
            ]);
          } else if (ev.type === "tool_result") {
            setTools((prev) =>
              prev.map((t) =>
                t.toolUseId === ev.toolUseId
                  ? { ...t, resultPreview: ev.preview, isError: ev.isError }
                  : t,
              ),
            );
          } else if (ev.type === "result-cost") {
            setCostInfo({
              turns: ev.turns,
              durationMs: ev.durationMs,
              costUsd: ev.costUsd,
            });
          } else if (ev.type === "retry-start") {
            aggregated = "";
            setClarifierOutput("");
          } else if (ev.type === "critic-fail") {
            setCriticIssues((prev) => [
              ...prev,
              { round: ev.round, issues: ev.issues },
            ]);
          } else if (ev.type === "contract-draft") {
            router.refresh();
          } else if (ev.type === "done") {
            if (ev.status === "blocked") {
              setFinalStatus("blocked");
            } else {
              setFinalStatus("passed");
            }
            router.refresh();
            finished = true;
            break;
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // user closed dialog; swallow
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage(message);
      }
    } finally {
      abortRef.current = null;
      setClarifying(false);
    }
  };

  // Determine if we have a "completed" result to show (from this session or existing)
  const hasCompletedResult = finalStatus !== null || (existingContract && !clarifying && !clarifierOutput);
  const displayStatus = finalStatus ?? (existingContract?.status === "draft" ? "passed" as const : existingContract?.status === "blocked" ? "blocked" as const : null);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="lg">启动需求</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            <span className="font-mono">{cellId}</span> · {featureName}
          </DialogTitle>
          <DialogDescription>
            描述需求,运行 Clarifier 生成 Problem / State Machine / Business Rules /
            Acceptance Criteria / API Contract / Domain Model。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {resumedRunning && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              ⚠️ 检测到上次 Clarifier 运行仍在进行中(SSE 连接已断)。可填写需求后点击「运行 Clarifier」重新发起。
            </div>
          )}
          {/* Input area: only show when no result is displayed or user wants to re-run */}
          {(!hasCompletedResult || clarifying) && (
            <>
              <label className="block text-sm font-medium" htmlFor="userRequest">
                你的需求描述
              </label>
              <Textarea
                id="userRequest"
                value={userRequest}
                onChange={(e) => setUserRequest(e.target.value)}
                disabled={clarifying}
                placeholder={`例如:为 ${featureName} 增加 XX 行为,需考虑 YY 边界条件...`}
                rows={4}
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={runClarifier} disabled={clarifying && !resumedRunning} variant="default">
                  {resumedRunning
                    ? "🔄 重新运行 Clarifier"
                    : clarifying
                      ? "Clarifier 运行中..."
                      : "运行 Clarifier"}
                </Button>
              </div>
            </>
          )}

          {errorMessage && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <div className="font-semibold">Clarifier 调用失败</div>
              <div className="mt-1 font-mono break-words">{errorMessage}</div>
            </div>
          )}

          {sessionInfo && (
            <div className="rounded-md border border-border bg-muted/50 p-2 text-xs text-muted-foreground font-mono">
              session · model={sessionInfo.model} · cwd={sessionInfo.cwd}
            </div>
          )}

          {tools.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">
                工具调用流 ({tools.length})
              </div>
              <ul className="space-y-1 max-h-40 overflow-auto rounded-md border border-border bg-muted p-2 text-xs font-mono">
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
                  </li>
                ))}
              </ul>
            </div>
          )}

          {costInfo && (
            <div className="rounded-md border border-border bg-muted/40 p-2 text-[10px] text-muted-foreground font-mono">
              turns={costInfo.turns} · duration=
              {Math.round(costInfo.durationMs / 100) / 10}s · cost=
              {costInfo.costUsd !== null
                ? `$${costInfo.costUsd.toFixed(4)}`
                : "?"}
            </div>
          )}

          {criticIssues.length > 0 && (
            <div className="space-y-2">
              {criticIssues.map((c) => (
                <div
                  key={c.round}
                  className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800"
                >
                  <div className="font-semibold">
                    Critic 第 {c.round} 轮失败 · {c.issues.length} 项
                  </div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {c.issues.map((i, idx) => (
                      <li key={`${c.round}-${idx}`}>
                        <code className="font-mono">{i.check}</code> — {i.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {displayStatus === "blocked" && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              连续 2 轮 Critic 未通过,feature 已被标记为 <code>blocked</code>。
              请关闭对话框查看详情页提示,或重试更清晰的需求描述。
            </div>
          )}
          {displayStatus === "passed" && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-700">
              ✅ Critic 通过,契约草稿已落库。关闭对话框可在详情页审批。
            </div>
          )}

          {/* Show existing contract if we have one and no active streaming output */}
          {hasCompletedResult && !clarifying && existingContract?.markdown && !clarifierOutput && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">
                已有契约 ({existingContract.id})
              </div>
              <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-xs leading-relaxed max-h-96 overflow-auto">
                {existingContract.markdown}
              </pre>
            </div>
          )}

          {clarifierOutput && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">
                Clarifier 输出 {clarifying ? "(streaming...)" : "(完成)"}
              </div>
              <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-xs leading-relaxed max-h-96 overflow-auto">
                {clarifierOutput}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter>
          {/* Allow re-running after completion */}
          {hasCompletedResult && !clarifying && (
            <Button
              variant="outline"
              onClick={() => {
                resetAll();
              }}
            >
              重新运行
            </Button>
          )}
          <DialogClose asChild>
            <Button variant="outline" disabled={clarifying}>
              关闭
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
