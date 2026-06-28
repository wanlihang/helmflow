"use client";

import { useEffect, useState } from "react";

interface PlantUmlDiagramProps {
  source: string;
}

type DiagramState =
  | { kind: "loading" }
  | { kind: "ok"; svg: string }
  | { kind: "error"; message: string };

// 通过 /api/diagram(服务端代理 Kroki)把 puml 源码渲染成 SVG 内联。
// loading/error/svg 三态,任何一环失败都降级显示源码,不白屏。
export function PlantUmlDiagram({ source }: PlantUmlDiagramProps) {
  const [state, setState] = useState<DiagramState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch("/api/diagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, type: "plantuml", format: "svg" }),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setState({ kind: "error", message: err.error ?? `HTTP ${res.status}` });
          return;
        }
        const svg = await res.text();
        if (!cancelled) setState({ kind: "ok", svg });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: "error", message: "网络错误,无法连接 /api/diagram" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (state.kind === "loading") {
    return (
      <div className="my-2 flex items-center justify-center rounded-md border border-border bg-muted/30 p-6 text-xs text-muted-foreground">
        正在渲染 PlantUML 图…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="my-2 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
        <div className="text-xs font-semibold text-amber-800">
          PlantUML 渲染失败:{state.message}
        </div>
        <div className="text-[11px] text-amber-700">
          请检查 Kroki 服务是否启动(KROKI_ENDPOINT),以及图源语法是否正确。
        </div>
        <pre className="max-h-64 overflow-auto rounded bg-white/60 p-2 text-[10px] leading-relaxed whitespace-pre-wrap">
          {source}
        </pre>
      </div>
    );
  }

  // SVG 来自受信内网 Kroki,用 <img> + data URL 渲染(浏览器不执行 SVG 内脚本,比 dangerouslySetInnerHTML 安全)
  return (
    <div className="my-2 flex justify-center overflow-auto rounded-md border border-border bg-white p-3">
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(state.svg)}`}
        alt="PlantUML 图"
        className="h-auto max-w-full"
      />
    </div>
  );
}
