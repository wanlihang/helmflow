"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";

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
  | { type: "loop-iteration"; loop: number; maxLoops: number; routeTo: string }
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
  nodes: Record<string, {
    status: "pending" | "running" | "passed" | "failed";
    iteration: number;
    runId?: string;
    turns?: number;
    durationMs?: number;
  }>;
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
  coder: "Coder",
  testgen: "TestGen",
  qa: "QA",
  committer: "Committer",
};

const NODE_ORDER = ["coder", "testgen", "qa", "committer"];

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
    return () => { cancelled = true; };
  }, [params]);

  // ---- Stable addLog that deduplicates ----
  const addLog = useCallback(
    (level: LogEntry["level"], text: string, dedupKey?: string) => {
      if (dedupKey) {
        if (seenKeys.current.has(dedupKey)) return;
        seenKeys.current.add(dedupKey);
      }
      setLogs((prev) => [...prev, { time: now(), text, level }]);
    },
    [],
  );

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
          addLog("info", `Orchestrator started · feature=${ev.featureId} contract=${ev.contractId}`, `os:${ev.superRunId}`);
          break;
        case "node-start":
          setNodes((prev) => ({
            ...prev,
            [ev.node]: { ...prev[ev.node]!, status: "running", iteration: ev.iteration, runId: ev.runId },
          }));
          addLog("info", `${NODE_LABELS[ev.node] ?? ev.node} started (iteration ${ev.iteration})`, `ns:${ev.node}:${ev.iteration}`);
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
          addLog("warn", `Fix task ${ev.fixTaskId} for ${ev.failedAcId} → route to ${ev.routeTo}`, `ft:${ev.fixTaskId}`);
          break;
        case "reflection-created":
          addLog("info", `Reflection ${ev.reflectionId} saved for ${ev.nodeName}`, `rf:${ev.reflectionId}`);
          break;
        case "loop-iteration": {
          addLog("warn", `Loop ${ev.loop}/${ev.maxLoops} — retrying from ${ev.routeTo}`, `li:${ev.loop}:${ev.routeTo}`);
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
            ev.success ? "Worktree merged into main sandbox" : `Worktree merge failed: ${ev.error ?? "unknown"}`,
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
        const url = afterId > 0
          ? `/api/runs/${runId}?afterId=${afterId}`
          : `/api/runs/${runId}`;
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

        if (data.run.state === "done" || data.run.state === "applied" || data.run.state === "failed") {
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
        case "worktree-created":
          addLog("info", `Worktree: ${p.branchName ?? "?"}`);
          break;
        case "node-start":
          addLog("info", `${NODE_LABELS[p.node as string] ?? p.node} started (iter ${p.iteration ?? "?"})`);
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
          addLog("warn", `Loop ${p.loop ?? "?"}/${p.maxLoops ?? "?"} → ${p.routeTo ?? "?"}`);
          break;
        case "escalate":
          addLog("error", `Escalated: ${p.reason ?? "?"}`);
          break;
        case "worktree-merge":
          addLog(p.success ? "success" : "warn", p.success ? "Merged" : `Merge failed: ${p.error ?? "?"}`);
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
          addLog(p.success ? "success" : "error", p.success ? `Done! commit=${p.commitSha ?? "?"}` : `Blocked (${p.totalLoops ?? 0} loops)`);
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

  // ---- SSE subscription with auto-reconnect ----
  useEffect(() => {
    if (!runId) return;
    if (sseStatus === "done") return;

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
  }, [runId, sseStatus === "done", handleSseEvent, addLog]);

  // ---- Auto-scroll logs ----
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const totalCost = Object.values(nodes).reduce(
    (sum, n) => sum + (n.costUsd ?? 0),
    0,
  );
  const totalTurns = Object.values(nodes).reduce(
    (sum, n) => sum + (n.turns ?? 0),
    0,
  );

  const statusText =
    sseStatus === "streaming"
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
            <Link href={featureId.includes("__") ? `/features/${featureId.split("__")[0]}/${encodeURIComponent(featureId.split("__")[1])}` : `/features/${featureId}`} className="hover:text-foreground">
              {featureId}
            </Link>
          </>
        )}
        <span className="mx-2">/</span>
        <span className="font-mono text-foreground">{runId || "..."}</span>
      </nav>

      <header className="space-y-2 border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight">
          {runKind === "full-loop" ? "Full-Loop Run"
           : runKind === "analyze" || runKind === "analyze-scan" ? "状态分析"
           : runKind === "require" ? "需求澄清"
           : runKind === "code" ? "代码实现"
           : runKind === "test" ? "测试验证"
           : runKind === "deploy" ? "上线部署"
           : runKind === "contract-sync" ? "契约同步"
           : runKind ? runKind : "Run"}
        </h1>
        <div className="flex flex-wrap gap-2 text-xs font-mono text-muted-foreground">
          <span>run={runId || "..."}</span>
          {featureId && <span>feature={featureId}</span>}
          {contractId && <span>contract={contractId}</span>}
          <span className={
            sseStatus === "streaming"
              ? "text-green-600"
              : sseStatus === "reconnecting"
                ? "text-yellow-600 animate-pulse"
                : sseStatus === "offline"
                  ? "text-yellow-600"
                  : ""
          }>
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
                {idx < NODE_ORDER.length - 1 && (
                  <div className="w-8 h-px bg-border" />
                )}
              </div>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          total turns={totalTurns} · cost=${totalCost.toFixed(4)}
          {final && ` · duration=${fmtDuration(final.totalDurationMs)} · loops=${final.totalLoops}`}
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
                href={featureId.includes("__") ? `/features/${featureId.split("__")[0]}/${encodeURIComponent(featureId.split("__")[1])}` : `/features/${featureId}`}
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

      {/* Event log */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Event Log</h2>
        <div className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 text-xs font-mono space-y-0.5">
          {logs.length === 0 && (
            <div className="text-muted-foreground">
              {sseStatus === "reconnecting"
                ? "正在连接..."
                : sseStatus === "offline"
                  ? "后台运行中，数据库每 3 秒同步"
                  : "Waiting for events..."}
            </div>
          )}
          {logs.map((l, i) => (
            <div
              key={i}
              className={
                l.level === "error"
                  ? "text-red-600"
                  : l.level === "warn"
                    ? "text-yellow-600"
                    : l.level === "success"
                      ? "text-green-600"
                      : "text-foreground"
              }
            >
              <span className="text-muted-foreground">{l.time}</span> {l.text}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </section>
    </div>
  );
}
