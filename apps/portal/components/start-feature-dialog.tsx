"use client";

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
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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

/** P1.1: 需求草稿的 localStorage 键,按 cellId 隔离。 */
function draftKey(cellId: string): string {
  return `helmflow:draft:require:${cellId}`;
}

/** P1.3: 历史 require run 的摘要(用于"历史需求"回填)。 */
interface RequireHistoryItem {
  runId: string;
  userRequest: string;
  state: string;
  startedAt: string;
}

export function StartFeatureDialog({
  cellId,
  featureName,
  scenarioName,
}: StartFeatureDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userRequest, setUserRequest] = useState("");
  const [clarifying, setClarifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  // P1.3: 该 cell 的历史需求列表(从 GET /api/clarify 的 history 字段加载)
  const [history, setHistory] = useState<RequireHistoryItem[]>([]);

  useEffect(() => {
    let stopped = false;
    // P1.1: 优先读本地草稿(含未提交编辑,比 DB 新),同步、在 fetch 之前执行。
    if (typeof window !== "undefined") {
      const draft = window.localStorage.getItem(draftKey(cellId));
      if (draft && draft.length > 0) setUserRequest(draft);
    }
    (async () => {
      try {
        const res = await fetch(`/api/clarify?cellId=${encodeURIComponent(cellId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          run: { id: string; state: string; startedAt: string } | null;
          events: Array<{ type: string; payload: Record<string, unknown> }>;
          history?: RequireHistoryItem[];
        };
        if (stopped) return;
        if (Array.isArray(data.history)) setHistory(data.history);
        if (!data.run) return;

        // P0/P1.1: 回填上次需求。若有本地草稿(未提交编辑)则保留草稿,不让 DB 覆盖。
        // require-input 事件在 POST /api/clarify 时即落库;529 立即失败也能回填。
        const hasLocalDraft =
          typeof window !== "undefined" &&
          (window.localStorage.getItem(draftKey(cellId)) ?? "").length > 0;
        if (!hasLocalDraft) {
          for (const ev of data.events) {
            const p = ev.payload;
            if (
              p.type === "require-input" &&
              typeof p.userRequest === "string" &&
              p.userRequest.length > 0
            ) {
              setUserRequest(p.userRequest);
            }
          }
        }

        // M7: 提交即跳 run 页,对话框不再回放流式输出。
        // 仅当上次 run 仍在进行中时提示用户(并恢复可重投),其余状态不打扰。
        if (data.run.state === "running") {
          setResumedRunning(true);
        }
      } catch {
        // 首次加载失败不致命
      }
    })();
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellId]);

  // P1.1: 防抖持久化草稿到 localStorage(按 cellId 隔离),刷新/崩溃不丢未提交的编辑。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = draftKey(cellId);
    const t = window.setTimeout(() => {
      if (userRequest.trim().length > 0) {
        window.localStorage.setItem(key, userRequest);
      } else {
        window.localStorage.removeItem(key);
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [userRequest, cellId]);

  // Don't reset everything on close — keep the result visible on reopen.
  // Only reset the "input" state, not the "output" state.
  const resetInput = () => {
    setUserRequest("");
    // P1.1: 清空输入同时清掉本地草稿
    if (typeof window !== "undefined") window.localStorage.removeItem(draftKey(cellId));
  };

  // 清空「输出」状态,但保留 userRequest —— 供"用同样需求重新运行"。
  // 想清空输入请用输入框旁的「清空」按钮(resetInput)。
  const resetAll = () => {
    abortStream();
    setClarifying(false);
    setResumedRunning(false);
    setErrorMessage(null);
  };

  // P1.3: 点击某条历史需求 → 回填到输入框;顺带清输出回到可编辑/可运行态。
  const applyHistory = (req: string) => {
    resetAll();
    setUserRequest(req);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // Closing the dialog — just abort the stream but keep output visible
      abortStream();
      setClarifying(false);
    }
  };

  // M7: clarify 已改为「后台异步 + 返回 {runId, cellId} JSON」。
  // 提交后拿 runId 直接跳 run 页实时观看,不再在对话框内读 SSE 流。
  const runClarifier = async () => {
    setErrorMessage(null);
    setClarifying(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/clarify", {
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

      const data = (await res.json()) as { runId?: string; cellId?: string };
      if (!data.runId) {
        throw new Error("响应缺少 runId,无法跳转运行页");
      }

      // 成功提交:清草稿(DB 已落 require-input),关闭对话框并跳 run 页。
      if (typeof window !== "undefined") window.localStorage.removeItem(draftKey(cellId));
      setOpen(false);
      router.push(`/runs/${data.runId}`);
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

  // M7: 提交即跳 run 页,对话框不再承载结果展示。
  const isFailed = errorMessage !== null;

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
            描述需求,运行 Clarifier 生成 Problem / State Machine / Business Rules / Acceptance
            Criteria / API Contract / Domain Model。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {resumedRunning && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              ⚠️ 检测到上次 Clarifier 运行仍在进行中。可点击「运行 Clarifier」重新发起,或前往运行页查看进度。
            </div>
          )}
          {/* Input area: 首次 / 重跑 / 失败态都显示。失败态下带着保留的需求 +「用同样需求重试」。 */}
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
              <Button
                onClick={runClarifier}
                disabled={clarifying && !resumedRunning}
                variant="default"
              >
                {resumedRunning
                  ? "🔄 重新运行 Clarifier"
                  : clarifying
                    ? "Clarifier 运行中..."
                    : isFailed
                      ? "🔄 用同样需求重试"
                      : "运行 Clarifier"}
              </Button>
              {userRequest.trim().length > 0 && !clarifying && (
                <Button onClick={resetInput} variant="ghost" size="sm">
                  清空
                </Button>
              )}
            </div>
          </>

          {/* P1.3: 历史需求列表,点击回填到输入框 */}
          {history.length > 0 && (
            <details className="rounded-md border border-border bg-muted/30 p-2 text-xs">
              <summary className="cursor-pointer select-none font-medium text-muted-foreground">
                📋 历史需求({history.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {history.map((h) => (
                  <li key={h.runId}>
                    <button
                      type="button"
                      onClick={() => applyHistory(h.userRequest)}
                      disabled={clarifying}
                      className="flex w-full items-start gap-2 rounded p-1 text-left hover:bg-muted disabled:opacity-50"
                    >
                      <span
                        className={`mt-0.5 shrink-0 rounded px-1 text-[10px] font-semibold ${
                          h.state === "done"
                            ? "bg-green-100 text-green-700"
                            : h.state === "failed"
                              ? "bg-red-100 text-red-700"
                              : "bg-zinc-200 text-zinc-700"
                        }`}
                      >
                        {h.state}
                      </span>
                      <span className="whitespace-pre-wrap break-all text-foreground">
                        {h.userRequest.slice(0, 80) || "(空)"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {errorMessage && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <div className="font-semibold">Clarifier 调用失败</div>
              <div className="mt-1 font-mono break-words">{errorMessage}</div>
            </div>
          )}
        </div>

        <DialogFooter>
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
