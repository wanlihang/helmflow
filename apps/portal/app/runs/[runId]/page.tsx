"use client";

import { ConversationView } from "@/components/conversation-view";
import { PendingMergePanel } from "@/components/pending-merge-panel";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

interface NodeState {
  node: string;
  status: "pending" | "running" | "passed" | "failed";
  iteration: number;
  runId?: string;
  turns?: number;
  durationMs?: number;
  costUsd?: number | null;
}

type SseEvent =
  | { type: "orchestrator-start"; superRunId: string; featureId: string; contractId: string }
  | { type: "queued"; position: number }
  | { type: "worktree-created"; worktreePath: string; branchName: string }
  | { type: "node-start"; node: string; iteration: number; runId: string }
  | { type: "node-event"; node: string; event: { type: string; [k: string]: unknown } }
  | {
      type: "node-done";
      node: string;
      iteration: number;
      runId: string;
      success: boolean;
      turns?: number;
      durationMs?: number;
      costUsd?: number | null;
    }
  | { type: "fix-task-created"; fixTaskId: string; failedAcId: string; routeTo: string }
  | { type: "reflection-created"; reflectionId: string; nodeName: string }
  | { type: "loop-iteration"; loop: number; maxLoops: number; routeTo: string; infraRetry?: boolean; infraBackoffMs?: number }
  | { type: "escalate"; reason: string; loop: number }
  | { type: "worktree-merge"; success: boolean; error?: string }
  | { type: "worktree-retained"; worktreePath: string; reason: string }
  | {
      type: "done";
      success: boolean;
      commitId?: string;
      commitSha?: string;
      totalLoops: number;
      totalDurationMs: number;
    }
  | { type: "error"; message: string };

interface LogEntry {
  time: string;
  text: string;
  level: "info" | "warn" | "error" | "success";
}

interface RunApiResponse {
  run: {
    id: string;
    featureId: string;
    kind: string;
    state: string;
    startedAt: string;
    finishedAt: string | null;
  };
  nodes: Record<
    string,
    {
      status: "pending" | "running" | "passed" | "failed";
      iteration: number;
      runId?: string;
      turns?: number;
      durationMs?: number;
      costUsd?: number | null;
    }
  >;
  isActive: boolean;
  currentNode: string | null;
  events?: Array<{
    id: number;
    type: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
}

const NODE_LABELS: Record<string, string> = {
  clarify: "需求澄清",
  code: "代码实现",
  test: "测试验证",
  deploy: "上线部署",
};

const NODE_ORDER = ["clarify", "code", "test", "deploy"];

const statusColors: Record<string, string> = {
  pending: "bg-gray-200 text-gray-600",
  running: "bg-blue-500 text-white animate-pulse",
  passed: "bg-green-500 text-white",
  failed: "bg-red-500 text-white",
};

function parseSseLine(line: string): SseEvent | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6)) as SseEvent;
  } catch {
    return null;
  }
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function now(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

/**
 * Build a dedup key for a given event so that DB-polling and SSE
 * channels never produce duplicate log entries.
 */
function eventKey(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case "node-start":
      return `ns:${p.node}:${p.iteration}`;
    case "node-done":
      return `nd:${p.node}:${p.iteration}`;
    case "done":
      return `done:${p.success}`;
    case "orchestrator-start":
      return `os:${p.superRunId}`;
    case "worktree-created":
      return `wt:${p.branchName}`;
    case "fix-task-created":
      return `ft:${p.fixTaskId}`;
    case "reflection-created":
      return `rf:${p.reflectionId}`;
    case "loop-iteration":
      return `li:${p.loop}:${p.routeTo}`;
    case "escalate":
      return `esc:${p.reason}`;
    case "worktree-merge":
      return `wm:${p.success}`;
    case "worktree-retained":
      return `wr:${p.worktreePath}`;
    case "error":
      return `err:${p.message}`;
    case "queued":
      return `q:${p.position}`;
    default:
      // One-shot events that won't duplicate — use timestamp
      return `${type}:${Date.now()}`;
  }
}

/** SSE reconnect interval in milliseconds */
const SSE_RETRY_MS = 5000;

interface RunPageProps {
  params: Promise<{ runId: string }>;
}

export default function RunPage({ params }: RunPageProps) {
  const [runId, setRunId] = useState<string>("");
  const [featureId, setFeatureId] = useState<string>("");
  const [contractId, setContractId] = useState<string>("");
  const [runState, setRunState] = useState<string>("");
  const [runKind, setRunKind] = useState<string>("");
  const [nodes, setNodes] = useState<Record<string, NodeState>>(() => {
    const init: Record<string, NodeState> = {};
    for (const n of NODE_ORDER) {
      init[n] = { node: n, status: "pending", iteration: 0 };
    }
    return init;
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [final, setFinal] = useState<{
    success: boolean;
    commitSha?: string;
    totalLoops: number;
    totalDurationMs: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // M8: Plan(clarify)run 完成后,从 contract-draft 事件取 markdownPath,展示契约产物入口。
  const [contractDraft, setContractDraft] = useState<{
    contractId?: string;
    markdownPath?: string;
  } | null>(null);
  const [sseStatus, setSseStatus] = useState<
    "connecting" | "streaming" | "done" | "offline" | "reconnecting"
  >("connecting");
  const logEndRef = useRef<HTMLDivElement>(null);
  const lastEventIdRef = useRef<number>(0);
  // Dedup set — prevents both DB-polling and SSE from adding the same log
  const seenKeys = useRef(new Set<string>());

  // ---- Resolve runId from params ----
  useEffect(() => {
    let cancelled = false;
    params.then(({ runId: id }) => {
      if (!cancelled) setRunId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  // ---- Stable addLog that deduplicates ----
  const addLog = useCallback((level: LogEntry["level"], text: string, dedupKey?: string) => {
    if (dedupKey) {
      if (seenKeys.current.has(dedupKey)) return;
      seenKeys.current.add(dedupKey);
    }
    setLogs((prev) => [...prev, { time: now(), text, level }]);
  }, []);

  // ---- Stable handler for events from SSE ----
  const handleSseEvent = useCallback(
    (ev: SseEvent) => {
      switch (ev.type) {
        case "queued":
          addLog("info", `Queued — position ${ev.position} in line`, `q:${ev.position}`);
          break;
        case "worktree-created":
          addLog("info", `Worktree created: ${ev.branchName}`, `wt:${ev.branchName}`);
          break;
        case "orchestrator-start":
          setFeatureId(ev.featureId);
          setContractId(ev.contractId);
          addLog(
            "info",
            `Orchestrator started · feature=${ev.featureId} contract=${ev.contractId}`,
            `os:${ev.superRunId}`,
          );
          break;
        case "node-start":
          setNodes((prev) => ({
            ...prev,
            [ev.node]: {
              ...prev[ev.node]!,
              status: "running",
              iteration: ev.iteration,
              runId: ev.runId,
            },
          }));
          addLog(
            "info",
            `${NODE_LABELS[ev.node] ?? ev.node} started (iteration ${ev.iteration})`,
            `ns:${ev.node}:${ev.iteration}`,
          );
          break;
        case "node-done":
          setNodes((prev) => ({
            ...prev,
            [ev.node]: {
              ...prev[ev.node]!,
              status: ev.success ? "passed" : "failed",
              iteration: ev.iteration,
              runId: ev.runId,
              turns: ev.turns,
              durationMs: ev.durationMs,
              costUsd: ev.costUsd,
            },
          }));
          addLog(
            ev.success ? "success" : "warn",
            `${NODE_LABELS[ev.node] ?? ev.node} ${ev.success ? "passed" : "failed"} · turns=${ev.turns ?? "?"} duration=${ev.durationMs ? fmtDuration(ev.durationMs) : "?"}`,
            `nd:${ev.node}:${ev.iteration}`,
          );
          break;
        case "fix-task-created":
          addLog(
            "warn",
            `Fix task ${ev.fixTaskId} for ${ev.failedAcId} → route to ${ev.routeTo}`,
            `ft:${ev.fixTaskId}`,
          );
          break;
        case "reflection-created":
          addLog(
            "info",
            `Reflection ${ev.reflectionId} saved for ${ev.nodeName}`,
            `rf:${ev.reflectionId}`,
          );
          break;
        case "loop-iteration": {
          if (ev.infraRetry) {
            addLog(
              "warn",
              `⏳ 端点限流/网络 → infra 退避 ${Math.round((ev.infraBackoffMs ?? 0) / 1000)}s 后原地重试 ${ev.routeTo}(独立计数,不耗业务重试)`,
              `li:infra:${ev.loop}:${ev.routeTo}`,
            );
          } else {
            addLog(
              "warn",
              `Loop ${ev.loop}/${ev.maxLoops} — retrying from ${ev.routeTo}`,
              `li:${ev.loop}:${ev.routeTo}`,
            );
          }
          const routeIdx = NODE_ORDER.indexOf(ev.routeTo);
          if (routeIdx >= 0) {
            setNodes((prev) => {
              const next = { ...prev };
              for (let i = routeIdx; i < NODE_ORDER.length; i++) {
                const n = NODE_ORDER[i]!;
                next[n] = { ...next[n]!, status: "pending" };
              }
              return next;
            });
          }
          break;
        }
        case "escalate":
          addLog("error", `Escalated: ${ev.reason} (loop ${ev.loop})`, `esc:${ev.reason}`);
          break;
        case "worktree-merge":
          addLog(
            ev.success ? "success" : "warn",
            ev.success
              ? "Worktree merged into main sandbox"
              : `Worktree merge failed: ${ev.error ?? "unknown"}`,
            `wm:${ev.success}`,
          );
          break;
        case "worktree-retained":
          addLog("warn", `Worktree retained: ${ev.reason}`, `wr:${ev.worktreePath}`);
          break;
        case "done":
          setFinal({
            success: ev.success,
            commitSha: ev.commitSha,
            totalLoops: ev.totalLoops,
            totalDurationMs: ev.totalDurationMs,
          });
          setSseStatus("done");
          addLog(
            ev.success ? "success" : "error",
            ev.success
              ? `Done! commit=${ev.commitSha ?? "?"} loops=${ev.totalLoops} total=${fmtDuration(ev.totalDurationMs)}`
              : `Blocked after ${ev.totalLoops} loops · total=${fmtDuration(ev.totalDurationMs)}`,
            `done:${ev.success}`,
          );
          break;
        case "error":
          setError(ev.message);
          addLog("error", `Error: ${ev.message}`, `err:${ev.message}`);
          break;
        default:
          break;
      }
    },
    [addLog],
  );

  // ---- DB polling: load historical state + events ----
  useEffect(() => {
    if (!runId) return;

    let stopped = false;

    async function pollDb() {
      try {
        const afterId = lastEventIdRef.current;
        const url = afterId > 0 ? `/api/runs/${runId}?afterId=${afterId}` : `/api/runs/${runId}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as RunApiResponse;
        if (stopped) return;

        setFeatureId(data.run.featureId);
        setRunState(data.run.state);
        setRunKind(data.run.kind);

        // Restore node states from DB
        const restored: Record<string, NodeState> = {};
        for (const n of NODE_ORDER) {
          const ns = data.nodes[n];
          restored[n] = {
            node: n,
            status: ns?.status ?? "pending",
            iteration: ns?.iteration ?? 0,
            runId: ns?.runId,
            turns: ns?.turns,
            durationMs: ns?.durationMs,
            costUsd: ns?.costUsd,
          };
        }
        setNodes((prev) => {
          const merged: Record<string, NodeState> = {};
          for (const n of NODE_ORDER) {
            const fromDb = restored[n]!;
            const fromSse = prev[n]!;
            merged[n] = {
              ...fromSse,
              status: fromDb.status !== "pending" ? fromDb.status : fromSse.status,
              iteration: Math.max(fromDb.iteration, fromSse.iteration),
              runId: fromDb.runId ?? fromSse.runId,
              // DB 是已完成节点的权威来源(跨进程/断线恢复);DB 无值时回落 SSE
              turns: fromDb.turns ?? fromSse.turns,
              durationMs: fromDb.durationMs ?? fromSse.durationMs,
              costUsd: fromDb.costUsd ?? fromSse.costUsd,
            };
          }
          return merged;
        });

        // Replay DB events as log entries (deduplicated via seenKeys)
        if (data.events && data.events.length > 0) {
          for (const ev of data.events) {
            if (ev.id > lastEventIdRef.current) {
              lastEventIdRef.current = ev.id;
            }
            replayDbEvent(ev.type, ev.payload);
          }
        }

        if (
          data.run.state === "done" ||
          data.run.state === "applied" ||
          data.run.state === "failed"
        ) {
          setSseStatus("done");
        }
      } catch {
        // ignore
      }
    }

    /** Convert a DB event row into a log entry, using seenKeys for dedup. */
    function replayDbEvent(type: string, p: Record<string, unknown>) {
      const key = eventKey(type, p);
      if (seenKeys.current.has(key)) return;
      seenKeys.current.add(key);

      switch (type) {
        case "orchestrator-start":
          if (typeof p.contractId === "string") setContractId(p.contractId);
          addLog("info", `Orchestrator started · feature=${p.featureId ?? "?"}`);
          break;
        case "contract-draft":
          // M8: Plan 产物 — 记下 markdownPath,用于契约产物区入口。
          setContractDraft({
            contractId: typeof p.contractId === "string" ? p.contractId : undefined,
            markdownPath: typeof p.markdownPath === "string" ? p.markdownPath : undefined,
          });
          addLog(
            "success",
            `契约草稿已产出${typeof p.contractId === "string" ? ` · ${p.contractId}` : ""}`,
          );
          break;
        case "worktree-created":
          addLog("info", `Worktree: ${p.branchName ?? "?"}`);
          break;
        case "node-start":
          addLog(
            "info",
            `${NODE_LABELS[p.node as string] ?? p.node} started (iter ${p.iteration ?? "?"})`,
          );
          break;
        case "node-done":
          addLog(
            p.success ? "success" : "warn",
            `${NODE_LABELS[p.node as string] ?? p.node} ${p.success ? "passed" : "failed"} · turns=${p.turns ?? "?"}`,
          );
          break;
        case "fix-task-created":
          addLog("warn", `Fix task for ${p.failedAcId ?? "?"} → ${p.routeTo ?? "?"}`);
          break;
        case "reflection-created":
          addLog("info", `Reflection saved for ${p.nodeName ?? "?"}`);
          break;
        case "loop-iteration":
          if (p.infraRetry) {
            addLog("warn", `⏳ infra 退避 ${Math.round((Number(p.infraBackoffMs ?? 0)) / 1000)}s 后重试 ${p.routeTo ?? "?"}`);
          } else {
            addLog("warn", `Loop ${p.loop ?? "?"}/${p.maxLoops ?? "?"} → ${p.routeTo ?? "?"}`);
          }
          break;
        case "escalate":
          addLog("error", `Escalated: ${p.reason ?? "?"}`);
          break;
        case "worktree-merge":
          addLog(
            p.success ? "success" : "warn",
            p.success ? "Merged" : `Merge failed: ${p.error ?? "?"}`,
          );
          break;
        case "worktree-retained":
          addLog("warn", `Worktree retained: ${p.reason ?? "?"}`);
          break;
        case "done":
          setFinal({
            success: p.success as boolean,
            commitSha: p.commitSha as string | undefined,
            totalLoops: (p.totalLoops as number) ?? 0,
            totalDurationMs: (p.totalDurationMs as number) ?? 0,
          });
          addLog(
            p.success ? "success" : "error",
            p.success
              ? `Done! commit=${p.commitSha ?? "?"}`
              : `Blocked (${p.totalLoops ?? 0} loops)`,
          );
          break;
        case "error":
          setError(p.message as string);
          addLog("error", `Error: ${p.message ?? "?"}`);
          break;
      }
    }

    pollDb();

    const interval = setInterval(() => {
      if (stopped) return;
      if (sseStatusRef.current === "done") return;
      pollDb();
    }, 3000);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [runId, addLog]);

  // Keep a ref to sseStatus so the polling interval callback always
  // sees the latest value without re-creating the interval.
  const sseStatusRef = useRef(sseStatus);
  sseStatusRef.current = sseStatus;
  // 仅在 done 状态翻转时才重新订阅(避免 streaming/reconnecting 等中间态频繁重连)
  const isDone = sseStatus === "done";

  // ---- SSE subscription with auto-reconnect ----
  useEffect(() => {
    if (!runId) return;
    if (isDone) return;

    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function subscribe() {
      try {
        // Pass afterId cursor so the stream endpoint can replay missed events from DB
        const afterId = lastEventIdRef.current > 0 ? lastEventIdRef.current : undefined;
        const streamUrl = afterId
          ? `/api/runs/${runId}/stream?afterId=${afterId}`
          : `/api/runs/${runId}/stream`;

        const res = await fetch(streamUrl, {
          signal: controller.signal,
        });

        if (!res.ok) {
          if (res.status === 404) {
            // Run may still be starting up, or may have finished.
            // If the run is still "running" in DB, retry later.
            if (sseStatusRef.current !== "done") {
              setSseStatus("reconnecting");
              retryTimer = setTimeout(() => subscribe(), SSE_RETRY_MS);
            } else {
              setSseStatus("offline");
            }
            return;
          }
          setError(`SSE connect failed: HTTP ${res.status}`);
          return;
        }

        if (!res.body) return;
        setSseStatus("streaming");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nlIdx = buffer.indexOf("\n");
          while (nlIdx >= 0) {
            const line = buffer.slice(0, nlIdx).replace(/\r$/, "");
            buffer = buffer.slice(nlIdx + 1);
            nlIdx = buffer.indexOf("\n");

            // Skip SSE "id:" lines (used for cursor, not events)
            if (line.startsWith("id: ")) continue;

            const ev = parseSseLine(line);
            if (!ev) continue;
            handleSseEvent(ev);
          }
        }

        // Stream ended normally — if run is not done, reconnect
        if (sseStatusRef.current !== "done") {
          setSseStatus("reconnecting");
          retryTimer = setTimeout(() => subscribe(), SSE_RETRY_MS);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : String(err);
        if (sseStatusRef.current !== "done") {
          setSseStatus("reconnecting");
          addLog("warn", `SSE disconnected: ${msg} — retrying...`);
          retryTimer = setTimeout(() => subscribe(), SSE_RETRY_MS);
        }
      }
    }

    // Small delay to let DB state load first
    const initialTimer = setTimeout(() => subscribe(), 500);

    return () => {
      clearTimeout(initialTimer);
      if (retryTimer) clearTimeout(retryTimer);
      controller.abort();
    };
  }, [runId, isDone, handleSseEvent, addLog]);

  // ---- Auto-scroll logs ----
  // 依赖 logs 仅用于在日志变化时触发滚动到底部(函数体内不读取 logs)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 故意以 logs 为触发器
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const totalCost = Object.values(nodes).reduce((sum, n) => sum + (n.costUsd ?? 0), 0);
  const totalTurns = Object.values(nodes).reduce((sum, n) => sum + (n.turns ?? 0), 0);

  const statusText =
    runState === "pending-confirm"
      ? "待确认合并"
      : runState === "abandoned"
        ? "已放弃"
        : sseStatus === "streaming"
          ? "streaming..."
          : sseStatus === "done"
            ? final?.success
              ? "done"
              : "blocked"
            : sseStatus === "reconnecting"
              ? "reconnecting..."
              : sseStatus === "offline"
                ? "offline (syncing via DB)"
                : "connecting...";

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>
        {featureId && (
          <>
            <span className="mx-2">/</span>
            <Link
              href={
                featureId.includes("__")
                  ? `/features/${featureId.split("__")[0]}/${encodeURIComponent(featureId.split("__")[1])}`
                  : `/features/${featureId}`
              }
              className="hover:text-foreground"
            >
              {featureId}
            </Link>
          </>
        )}
        <span className="mx-2">/</span>
        <span className="font-mono text-foreground">{runId || "..."}</span>
      </nav>

      <header className="space-y-2 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* M8: Plan/Act 徽标 */}
          {runKind && (
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                runKind === "clarify"
                  ? "bg-blue-100 text-blue-700 border border-blue-200"
                  : "bg-purple-100 text-purple-700 border border-purple-200"
              }`}
            >
              {runKind === "clarify" ? "Plan · 需求澄清" : "Act · 执行"}
            </span>
          )}
          {/* M8: 常驻返回详情页入口(不依赖 run 是否结束) */}
          {featureId && (
            <Link
              href={
                featureId.includes("__")
                  ? `/features/${featureId.split("__")[0]}/${encodeURIComponent(featureId.split("__")[1])}`
                  : `/features/${featureId}`
              }
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← 返回详情页
            </Link>
          )}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {runKind === "full-loop"
            ? "Full-Loop Run"
            : runKind === "analyze" || runKind === "analyze-scan"
              ? "状态分析"
              : runKind === "clarify"
                ? "需求澄清"
                : runKind === "code"
                  ? "代码实现"
                  : runKind === "test"
                    ? "测试验证"
                    : runKind === "deploy"
                      ? "上线部署"
                      : runKind === "contract-sync"
                        ? "契约同步"
                        : runKind
                          ? runKind
                          : "Run"}
        </h1>
        <div className="flex flex-wrap gap-2 text-xs font-mono text-muted-foreground">
          <span>run={runId || "..."}</span>
          {featureId && <span>feature={featureId}</span>}
          {contractId && <span>contract={contractId}</span>}
          <span
            className={
              sseStatus === "streaming"
                ? "text-green-600"
                : sseStatus === "reconnecting"
                  ? "text-yellow-600 animate-pulse"
                  : sseStatus === "offline"
                    ? "text-yellow-600"
                    : ""
            }
          >
            {statusText}
          </span>
        </div>
      </header>

      {/* Pipeline(仅 Full-Loop) */}
      {runKind === "full-loop" && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Pipeline</h2>
          <div className="flex items-center gap-1">
            {NODE_ORDER.map((n, idx) => {
              const state = nodes[n]!;
              return (
                <div key={n} className="flex items-center gap-1">
                  <div className="flex flex-col items-center">
                    <div
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${statusColors[state.status]}`}
                    >
                      {NODE_LABELS[n]}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                      {state.iteration > 0 && `iter=${state.iteration}`}
                      {state.turns !== undefined && ` t=${state.turns}`}
                      {state.durationMs !== undefined && ` ${fmtDuration(state.durationMs)}`}
                      {state.costUsd !== undefined && state.costUsd !== null && state.costUsd > 0
                        ? ` $${state.costUsd.toFixed(3)}`
                        : ""}
                    </div>
                  </div>
                  {idx < NODE_ORDER.length - 1 && <div className="w-8 h-px bg-border" />}
                </div>
              );
            })}
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            total turns={totalTurns} · cost=${totalCost.toFixed(4)}
            {final &&
              ` · duration=${fmtDuration(final.totalDurationMs)} · loops=${final.totalLoops}`}
          </div>
        </section>
      )}

      {/* Reconnecting / Offline banners */}
      {sseStatus === "reconnecting" && !final && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 flex items-center gap-2">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          正在重新连接实时流... 后台仍在执行，数据库每 3 秒同步最新状态。
        </div>
      )}

      {sseStatus === "offline" && !final && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700">
          Orchestrator 正在后台运行中。通过数据库持续同步最新状态，无需手动刷新。
        </div>
      )}

      {/* M8: 契约产物区(Plan/clarify 专属)。
          contract-draft 事件到达后展示入口;最小版跳详情页契约区查看/审批。 */}
      {contractDraft && featureId && (
        <section className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 space-y-2">
          <div className="font-semibold">契约已产出</div>
          <div className="text-xs font-mono text-blue-700">
            {contractDraft.contractId ? `contract=${contractDraft.contractId}` : "契约草稿已落库"}
          </div>
          <Link
            href={
              featureId.includes("__")
                ? `/features/${featureId.split("__")[0]}/${encodeURIComponent(featureId.split("__")[1])}`
                : `/features/${featureId}`
            }
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            查看契约 →
          </Link>
        </section>
      )}

      {runState === "pending-confirm" && <PendingMergePanel runId={runId} />}

      {runState === "abandoned" && (
        <div className="rounded-md border border-zinc-300 bg-zinc-100 p-4 text-sm text-zinc-700">
          <div className="font-semibold text-base">已放弃合并</div>
          <div className="mt-1 text-xs">
            本次 worktree 分支已删除,run 标记为已放弃。可重新发起需求/全流程。
          </div>
        </div>
      )}

      {final && (
        <div
          className={`rounded-md border p-4 text-sm ${
            final.success
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <div className="font-semibold text-base">
            {final.success ? "Full-Loop Complete" : "Blocked — Escalate to Human"}
          </div>
          {final.commitSha && (
            <div className="mt-1 font-mono">
              Commit: <code className="font-bold">{final.commitSha}</code>
            </div>
          )}
          {!final.success && (
            <div className="mt-2 text-xs">
              查看下方 Event Log 了解失败原因。失败的节点会显示具体 check 和 detail。
            </div>
          )}
          <div className="mt-1 text-[10px] text-muted-foreground font-mono">
            loops={final.totalLoops} · total={fmtDuration(final.totalDurationMs)}
          </div>
          {featureId && (
            <div className="mt-3">
              <Link
                href={
                  featureId.includes("__")
                    ? `/features/${featureId.split("__")[0]}/${encodeURIComponent(featureId.split("__")[1])}`
                    : `/features/${featureId}`
                }
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                返回详情页
              </Link>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <div className="font-semibold">Error</div>
          <div className="mt-1 font-mono break-words whitespace-pre-wrap">{error}</div>
        </div>
      )}

      {/* 对话式展示(Claude Code 终端风格) */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">对话记录</h2>
        <ConversationView runId={runId} />
      </section>
    </div>
  );
}
