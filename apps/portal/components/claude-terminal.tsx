"use client";

// claude 终端:xterm.js ←WebSocket→ terminal-server(node-pty spawn claude)。
// 透传本机 shell 配置(在 cmux 里启动 terminal-server 时复用不 529 路径)。
// SSR 安全:@xterm 顶层访问浏览器全局 self,SSR 评估会 ReferenceError。
// 故顶层只用 import type(编译期移除,不评估 JS),xterm 在 useEffect 内动态 import(client-only)。

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

const PORT = process.env.NEXT_PUBLIC_TERMINAL_PORT || "3001";

interface SessionState {
  term?: Terminal;
  fit?: FitAddon;
  ws?: WebSocket;
  disposers: Array<() => void>;
}

export function ClaudeTerminal({ projectId }: { projectId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !projectId) return;
    let disposed = false;
    const state: SessionState = { disposers: [] };
    const onWinResize = (): void => {
      try {
        state.fit?.fit();
      } catch {
        // ignore
      }
    };

    void (async () => {
      // 动态 import:避免 SSR 评估 @xterm(访问 self)。
      const [{ Terminal: TerminalCtor }, { FitAddon: FitAddonCtor }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !containerRef.current) return;

      const term = new TerminalCtor({
        cursorBlink: true,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 13,
        theme: { background: "#000000", foreground: "#e5e5e5" },
      });
      const fit = new FitAddonCtor();
      term.loadAddon(fit);
      term.open(containerRef.current);
      try {
        fit.fit();
      } catch {
        // 容器未布局好时忽略
      }
      state.term = term;
      state.fit = fit;

      const ws = new WebSocket(
        `ws://127.0.0.1:${PORT}?projectId=${encodeURIComponent(projectId)}&cols=${term.cols}&rows=${term.rows}`,
      );
      state.ws = ws;

      ws.onopen = () => {
        setConnectionError(false);
        term.writeln("\r\n\x1b[32m✓ 已连接 Claude 终端(透传本机 shell 配置)\x1b[0m");
      };
      ws.onmessage = (e) => {
        if (typeof e.data === "string") term.write(e.data);
      };
      ws.onclose = (e) => {
        term.writeln(`\r\n\x1b[31m✕ 连接关闭${e.reason ? `: ${e.reason}` : ""}\x1b[0m`);
      };
      ws.onerror = () => {
        setConnectionError(true);
        term.writeln(
          "\r\n\x1b[31m✕ 连接错误 — 确认 terminal-server 已启动(pnpm terminal:dev)\x1b[0m",
        );
      };

      state.disposers.push(
        term
          .onData((d) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stdin", data: d }));
          })
          .dispose,
        term
          .onResize(({ cols, rows }) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols, rows }));
          })
          .dispose,
      );
      window.addEventListener("resize", onWinResize);
      state.disposers.push(() => window.removeEventListener("resize", onWinResize));
    })();

    return () => {
      disposed = true;
      state.disposers.forEach((d) => d());
      state.ws?.close();
      state.term?.dispose();
    };
  }, [projectId]);

  return (
    <div className="flex flex-col gap-2">
      {connectionError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700">
          ✕ 无法连接终端服务器 <code className="rounded bg-red-100 px-1">ws://127.0.0.1:{PORT}</code>。请先启动 terminal-server:
          <code className="ml-1 rounded bg-red-100 px-1">pnpm terminal:dev</code>
        </div>
      )}
      <div ref={containerRef} className="h-[72vh] w-full bg-black" />
    </div>
  );
}
