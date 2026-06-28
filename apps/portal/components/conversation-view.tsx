"use client";

import { extractSseData, parseSseChunk } from "@/lib/sse-parse";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface ConversationTurn {
  role: "input" | "assistant" | "tool" | "result" | "status";
  content: string;
  toolName?: string;
  toolInput?: string;
  isError?: boolean;
  /** agent.input 携带的 system prompt(调用模型时传的完整系统提示),折叠展示 */
  systemPrompt?: string;
  statusType?: string;
  /** primary=主实现,self-check=对抗式自检轮(前端据此区分展示,紫色 🔍 标记) */
  phase?: "primary" | "self-check";
}

/** 把编排/状态事件(require-start, scan-done, classify-cell-*, node-start, loop-iteration 等)摘要成一行 */
function summarizeStatus(payload: Record<string, unknown>): string {
  const parts: string[] = [payload.type as string];
  for (const k of [
    "cellId",
    "node",
    "progress",
    "scope",
    "phase",
    "iteration",
    "loop",
    "maxLoops",
    "model",
    "reason",
    "routeTo",
  ]) {
    if (payload[k] !== undefined) parts.push(`${k}=${payload[k]}`);
  }
  return parts.join(" ");
}

/**
 * 将单个事件 payload 追加(或合并)到 turns 数组(就地修改 next)。
 * agent 层事件 → 对话块(input/assistant/tool/result);其余编排事件 → status(运行过程)。
 */
function applyEvent(next: ConversationTurn[], payload: Record<string, unknown>): void {
  switch (payload.type) {
    case "agent.input": {
      next.push({
        role: "input",
        content: (payload.userPrompt as string) || "",
        systemPrompt: (payload.systemPrompt as string) || undefined,
        phase: payload.phase as ConversationTurn["phase"],
      });
      break;
    }
    case "token":
    case "assistant.text": {
      const text = payload.text as string;
      if (!text) break;
      const phase = payload.phase as ConversationTurn["phase"];
      const last = next[next.length - 1];
      // 同 phase 连续 assistant 文本合并;跨 phase(主→自检)新开一块,避免混并
      if (last && last.role === "assistant" && last.phase === phase) {
        last.content += text;
      } else {
        next.push({ role: "assistant", content: text, phase });
      }
      break;
    }
    case "tool_use": {
      next.push({
        role: "tool",
        content: "",
        toolName: payload.name as string,
        toolInput:
          typeof payload.input === "string"
            ? payload.input.slice(0, 300)
            : JSON.stringify(payload.input ?? {}).slice(0, 300),
        phase: payload.phase as ConversationTurn["phase"],
      });
      break;
    }
    case "tool_result": {
      // 配对:合并到最近的 tool_use 卡片(输入已记,这里补结果)
      const last = next[next.length - 1];
      if (last && last.role === "tool") {
        last.content = ((payload.preview as string) || "").slice(0, 500);
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
    case "error": {
      next.push({ role: "result", content: `❌ 失败: ${payload.message ?? "unknown"}` });
      break;
    }
    default: {
      // 编排/状态事件 → 运行过程(归折叠区,不混进对话)
      next.push({
        role: "status",
        content: summarizeStatus(payload),
        statusType: payload.type as string,
      });
    }
  }
}

interface ConversationViewProps {
  runId: string;
}

/**
 * 对话记录 — Claude Code 风格:块状分区(用户/系统/模型/工具/结果)+ 运行过程折叠区 + 人工输入。
 * agent.input → assistant(聚合) → tool_use+tool_result(配对卡片) → result;编排事件归运行过程。
 */
export function ConversationView({ runId }: ConversationViewProps) {
  const router = useRouter();
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [sseStatus, setSseStatus] = useState<"connecting" | "streaming" | "done" | "offline">(
    "connecting",
  );
  const [injectInput, setInjectInput] = useState("");
  const [injecting, setInjecting] = useState(false);
  const [injectError, setInjectError] = useState<string | null>(null);

  const processEvent = useCallback((payload: Record<string, unknown>) => {
    setTurns((prev) => {
      const next = [...prev];
      // node-event 容器:full-loop 父 run 把各节点 agent 对话事件包在 event 字段里,解包后按普通事件渲染。
      if (payload.type === "node-event" && payload.event) {
        applyEvent(next, payload.event as Record<string, unknown>);
      } else {
        applyEvent(next, payload);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let stopped = false;
    let afterId = 0;
    const decoder = new TextDecoder();
    let buffer = "";

    const connect = async () => {
      try {
        setSseStatus("connecting");
        const streamUrl =
          afterId > 0 ? `/api/runs/${runId}/stream?afterId=${afterId}` : `/api/runs/${runId}/stream`;
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
            if (dataStr.startsWith(":")) continue; // heartbeat
            const idMatch = msg.match(/^id:\s*(\d+)/m);
            if (idMatch?.[1]) afterId = Number(idMatch[1]);
            try {
              const event = JSON.parse(dataStr);
              if (stopped) return;
              processEvent(event);
            } catch {
              /* skip malformed */
            }
          }
        }
        if (!stopped) setSseStatus("done");
      } catch {
        if (!stopped) setSseStatus("offline");
      }
    };

    connect();
    return () => {
      stopped = true;
    };
  }, [runId, processEvent]);

  const handleInject = async () => {
    const msg = injectInput.trim();
    if (!msg) return;
    setInjecting(true);
    setInjectError(null);
    try {
      setTurns((prev) => [...prev, { role: "input", content: `[人工注入] ${msg}` }]);
      const res = await fetch(`/api/runs/${runId}/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setInjectInput("");
      if (data.newRunId) router.push(`/runs/${data.newRunId}`);
    } catch (err) {
      setInjectError(err instanceof Error ? err.message : String(err));
    } finally {
      setInjecting(false);
    }
  };

  // 对话块(不含 status) + 运行过程(status)
  const dialogTurns = turns.filter((t) => t.role !== "status");
  const statusTurns = turns.filter((t) => t.role === "status");
  const assistantCount = turns.filter((t) => t.role === "assistant").length;
  const toolCount = turns.filter((t) => t.role === "tool").length;

  return (
    <div className="space-y-3">
      <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-zinc-950 p-4 text-xs font-mono">
        {dialogTurns.length === 0 && statusTurns.length === 0 && (
          <div className="text-zinc-500">
            {sseStatus === "streaming"
              ? "等待事件..."
              : sseStatus === "offline"
                ? "无实时流(DB 同步中)"
                : "连接中..."}
          </div>
        )}

        <div className="space-y-3">
          {dialogTurns.map((turn, i) => {
            if (turn.role === "input") {
              const isCheck = turn.phase === "self-check";
              return (
                <div
                  key={i}
                  className={`rounded border p-2 ${isCheck ? "border-purple-900/40 bg-purple-950/10" : "border-blue-900/40 bg-blue-950/20"}`}
                >
                  <div
                    className={`mb-1 text-[10px] font-semibold ${isCheck ? "text-purple-400" : "text-blue-400"}`}
                  >
                    {isCheck ? "🔍 自检指令" : "❯ 用户"}
                  </div>
                  {turn.systemPrompt && (
                    <details className="mb-1">
                      <summary className="cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-400">
                        📜 系统提示({turn.systemPrompt.length} 字符,点击展开)
                      </summary>
                      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap text-[10px] text-zinc-500">
                        {turn.systemPrompt}
                      </pre>
                    </details>
                  )}
                  <div className="whitespace-pre-wrap text-blue-300">
                    {turn.content || "(空)"}
                  </div>
                </div>
              );
            }
            if (turn.role === "assistant" && turn.content) {
              const isCheck = turn.phase === "self-check";
              return (
                <div
                  key={i}
                  className={`rounded border p-2 ${isCheck ? "border-purple-700/50 bg-purple-950/10" : "border-zinc-800"}`}
                >
                  <div
                    className={`mb-1 text-[10px] font-semibold ${isCheck ? "text-purple-400" : "text-zinc-400"}`}
                  >
                    {isCheck ? "🔍 自检" : "✦ 模型"}
                  </div>
                  <div className="whitespace-pre-wrap text-zinc-200">{turn.content}</div>
                </div>
              );
            }
            if (turn.role === "tool") {
              const isCheck = turn.phase === "self-check";
              return (
                <div
                  key={i}
                  className={`rounded border p-2 ${isCheck ? "border-purple-900/40 bg-purple-950/10" : "border-amber-900/40 bg-amber-950/10"}`}
                >
                  <div
                    className={`text-[10px] font-semibold ${isCheck ? "text-purple-400" : "text-amber-400"}`}
                  >
                    {isCheck ? "🔍 自检工具" : "📎 工具"} {turn.toolName}
                  </div>
                  {turn.toolInput && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-400">
                        输入
                      </summary>
                      <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-zinc-400">
                        {turn.toolInput}
                      </pre>
                    </details>
                  )}
                  {turn.content && (
                    <details open={turn.isError} className="mt-0.5">
                      <summary className="cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-400">
                        {turn.isError ? "结果(错误)" : "结果"}
                      </summary>
                      <pre
                        className={`mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] ${turn.isError ? "text-red-400" : "text-zinc-400"}`}
                      >
                        {turn.isError ? "❌ " : ""}
                        {turn.content}
                      </pre>
                    </details>
                  )}
                </div>
              );
            }
            if (turn.role === "result") {
              return (
                <div
                  key={i}
                  className={`rounded p-2 font-semibold ${turn.content.startsWith("✅") ? "bg-green-950/30 text-green-400" : "bg-red-950/30 text-red-400"}`}
                >
                  {turn.content}
                </div>
              );
            }
            return null;
          })}
          {sseStatus === "streaming" && (
            <div className="text-zinc-500 animate-pulse">▍</div>
          )}
        </div>

        {/* 运行过程(编排/状态事件,折叠) */}
        {statusTurns.length > 0 && (
          <details className="mt-3 border-t border-zinc-800 pt-2">
            <summary className="cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-400">
              ⚙ 运行过程({statusTurns.length} 条事件,点击展开)
            </summary>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-zinc-600">
              {statusTurns.map((s, i) => `${s.content}`).join("\n")}
            </pre>
          </details>
        )}
      </div>

      {/* 状态栏 */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span
          className={`inline-flex items-center gap-1 ${sseStatus === "streaming" ? "text-green-600" : ""}`}
        >
          {sseStatus === "streaming" && (
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
          )}
          {sseStatus}
        </span>
        <span>{assistantCount} 条回复</span>
        <span>{toolCount} 次工具调用</span>
        {statusTurns.length > 0 && <span>· {statusTurns.length} 条运行事件</span>}
      </div>

      {/* 人工输入(inject) */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <input
            type="text"
            value={injectInput}
            onChange={(e) => setInjectInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleInject();
              }
            }}
            placeholder="输入 /clarify、/goal 或补充信息…（Enter 发送，续接会话）"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            disabled={injecting}
          />
          <button
            type="button"
            onClick={handleInject}
            disabled={injecting || !injectInput.trim()}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {injecting ? "发送中..." : "发送"}
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground">
          resume 续接原会话上下文;支持 /clarify、/goal 等命令(claude_code 能力)
        </div>
        {injectError && <div className="text-xs text-red-600">{injectError}</div>}
      </div>
    </div>
  );
}
