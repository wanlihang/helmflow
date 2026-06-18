"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { parseSseChunk, extractSseData } from "@/lib/sse-parse";

interface ConversationTurn {
  role: "input" | "assistant" | "tool" | "result";
  content: string;
  toolName?: string;
  toolInput?: string;
  isError?: boolean;
}

interface ConversationViewProps {
  runId: string;
}

/**
 * Claude Code 终端式对话展示。
 * 从 run_events(stream API)读取事件,重构为对话流:
 * agent.input → assistant.text(聚合) → tool_use + tool_result(配对) → result
 */
export function ConversationView({ runId }: ConversationViewProps) {
  const router = useRouter();
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [sseStatus, setSseStatus] = useState<"connecting" | "streaming" | "done" | "offline">("connecting");
  const [injectInput, setInjectInput] = useState("");
  const [injecting, setInjecting] = useState(false);
  const [injectError, setInjectError] = useState<string | null>(null);

  const processEvent = useCallback((payload: Record<string, unknown>) => {
    setTurns((prev) => {
      const next = [...prev];
      switch (payload.type) {
        case "agent.input": {
          // 合并到 input turn
          next.push({ role: "input", content: payload.userPrompt as string || "", });
          break;
        }
        case "token":
        case "assistant.text": {
          const text = payload.text as string;
          if (!text) break;
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            last.content += text;
          } else {
            next.push({ role: "assistant", content: text });
          }
          break;
        }
        case "tool_use": {
          next.push({
            role: "tool",
            content: "",
            toolName: payload.name as string,
            toolInput: typeof payload.input === "string"
              ? payload.input.slice(0, 200)
              : JSON.stringify(payload.input ?? {}).slice(0, 200),
          });
          break;
        }
        case "tool_result": {
          const last = next[next.length - 1];
          if (last && last.role === "tool") {
            last.content = (payload.preview as string || "").slice(0, 300);
            last.isError = payload.isError === true;
          }
          break;
        }
        case "result": {
          const success = payload.success === true;
          next.push({
            role: "result",
            content: success
              ? `✅ 完成 · ${payload.turns ?? "?"} turns${payload.costUsd ? ` · $${(payload.costUsd as number).toFixed(4)}` : ""}`
              : `❌ 失败: ${payload.error ?? "unknown"}`,
          });
          break;
        }
      }
      return next;
    });
  }, []);

  // 加载历史事件 + 实时流
  useEffect(() => {
    let stopped = false;
    let afterId = 0;
    const decoder = new TextDecoder();
    let buffer = "";

    const connect = async () => {
      try {
        setSseStatus("connecting");
        const streamUrl = afterId > 0
          ? `/api/runs/${runId}/stream?afterId=${afterId}`
          : `/api/runs/${runId}/stream`;
        const res = await fetch(streamUrl);
        if (!res.ok || !res.body) {
          setSseStatus("offline");
          return;
        }
        setSseStatus("streaming");
        const reader = res.body.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const { messages, remainder } = parseSseChunk(buffer, chunk);
          buffer = remainder;
          for (const msg of messages) {
            const dataStr = extractSseData(msg);
            if (!dataStr) continue;
            // heartbeat
            if (dataStr.startsWith(":")) continue;
            // id: N (track cursor)
            const idMatch = msg.match(/^id:\s*(\d+)/m);
            if (idMatch?.[1]) afterId = Number(idMatch[1]);
            try {
              const event = JSON.parse(dataStr);
              if (stopped) return;
              processEvent(event);
            } catch { /* skip malformed */ }
          }
        }
        if (!stopped) setSseStatus("done");
      } catch {
        if (!stopped) setSseStatus("offline");
      }
    };

    connect();
    return () => { stopped = true; };
  }, [runId, processEvent]);

  const handleInject = async () => {
    const msg = injectInput.trim();
    if (!msg) return;
    setInjecting(true);
    setInjectError(null);
    try {
      // 追加一条 user turn 到对话
      setTurns((prev) => [...prev, { role: "input", content: `[人工注入] ${msg}` }]);

      const res = await fetch(`/api/runs/${runId}/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      // inject 成功后,新 turn 会通过 stream 自动追加(如果 session resume 成功)
      setInjectInput("");
      // 如果返回了新 runId,刷新看新 run
      if (data.newRunId) {
        router.push(`/runs/${data.newRunId}`);
      }
    } catch (err) {
      setInjectError(err instanceof Error ? err.message : String(err));
    } finally {
      setInjecting(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 对话流(Claude Code 终端式) */}
      <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-zinc-950 p-4 text-xs font-mono space-y-2">
        {turns.length === 0 && (
          <div className="text-zinc-500">
            {sseStatus === "streaming" ? "等待事件..." : sseStatus === "offline" ? "无实时流(DB 同步中)" : "连接中..."}
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i}>
            {turn.role === "input" && (
              <div className="text-blue-400">
                <span className="text-blue-600">❯ </span>
                <span className="whitespace-pre-wrap">{turn.content || "(空)"}</span>
              </div>
            )}
            {turn.role === "assistant" && turn.content && (
              <div className="text-zinc-200 whitespace-pre-wrap">
                {turn.content}
              </div>
            )}
            {turn.role === "tool" && (
              <div className="pl-4 border-l-2 border-zinc-700">
                <div className="text-amber-400">
                  📎 {turn.toolName}
                  {turn.toolInput && <span className="text-zinc-500"> {turn.toolInput}</span>}
                </div>
                {turn.content && (
                  <div className={`text-zinc-400 whitespace-pre-wrap text-[10px] mt-0.5 ${turn.isError ? "text-red-400" : ""}`}>
                    {turn.isError ? "❌ " : ""}{turn.content}
                  </div>
                )}
              </div>
            )}
            {turn.role === "result" && (
              <div className={`font-semibold ${turn.content.startsWith("✅") ? "text-green-400" : "text-red-400"}`}>
                {turn.content}
              </div>
            )}
          </div>
        ))}
        {sseStatus === "streaming" && (
          <div className="text-zinc-500 animate-pulse">▍</div>
        )}
      </div>

      {/* 状态栏 */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className={`inline-flex items-center gap-1 ${sseStatus === "streaming" ? "text-green-600" : ""}`}>
          {sseStatus === "streaming" && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />}
          {sseStatus}
        </span>
        <span>{turns.filter(t => t.role === "assistant").length} 条回复</span>
        <span>{turns.filter(t => t.role === "tool").length} 次工具调用</span>
      </div>

      {/* 人工注入 */}
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
        <input
          type="text"
          value={injectInput}
          onChange={(e) => setInjectInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleInject(); } }}
          placeholder="输入消息给模型(人工干预)..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          disabled={injecting}
        />
        <button
          onClick={handleInject}
          disabled={injecting || !injectInput.trim()}
          className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {injecting ? "发送中..." : "发送"}
        </button>
      </div>
      {injectError && <div className="text-xs text-red-600">{injectError}</div>}
    </div>
  );
}
