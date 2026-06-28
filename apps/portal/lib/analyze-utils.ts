"use client";

import { useRef, useState } from "react";

// ─── Log utilities shared by AnalyzeCellButton and AnalyzeAllButton ────

const EMOJI_LINE_RE = /^[📋📂⚡🔧⚠️✅❌⏱▶]/u;

export interface ContractCheckItem {
  id: string;
  landed: boolean;
  note?: string;
}

export interface ContractCheck {
  rules: ContractCheckItem[];
  criteria: ContractCheckItem[];
}

export interface AnalysisResult {
  cellId: string;
  featureId: string;
  scenarioName: string;
  oldStatus: string;
  newStatus: string;
  reason: string;
  /** true=确定性判定(代码×契约矩阵,未走 LLM);false/undefined=LLM 契约验证 */
  deterministic?: boolean;
  /** 有契约且走 LLM 验证(D 组合)时,逐条 BR/AC 落地情况 */
  contractCheck?: ContractCheck;
}

export interface DbEvent {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AnalyzeRunMeta {
  id: string;
  state: string;
  startedAt: string;
  cellId?: string;
}

export interface AnalyzeGetResponse {
  run: AnalyzeRunMeta | null;
  events: DbEvent[];
  results: AnalysisResult[];
}

export interface AnalyzeSseEvent {
  type: string;
  runId?: string;
  results?: AnalysisResult[];
  message?: string;
  text?: string;
  totalCells?: number;
  turns?: number;
  durationMs?: number;
  scanDurationMs?: number;
  classifyDurationMs?: number;
  inventorySize?: number;
  scope?: string;
  phase?: string;
  cellCount?: number;
  inventory?: unknown[];
  fallback?: boolean;
  name?: string;
  input?: Record<string, unknown>;
  isError?: boolean;
  preview?: string;
}

export function formatToolEvent(name: string, input: Record<string, unknown> | undefined): string {
  if (name === "Read") {
    const path =
      typeof input?.file_path === "string"
        ? input.file_path.replace(/^.*\/src\//, "src/")
        : String(input?.file_path ?? "");
    return `📂 读取: ${path}`;
  }
  if (name === "Bash") {
    const cmd =
      typeof input?.command === "string"
        ? (input.command.split("\n")[0] ?? "")
        : String(input?.command ?? "");
    return `⚡ 执行: ${cmd.slice(0, 120)}`;
  }
  return `🔧 ${name}(${JSON.stringify(input ?? {}).slice(0, 80)})`;
}

export function useAnalyzeLog(maxLines = 200) {
  const [logLines, setLogLines] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  const appendLog = (line: string) => {
    setLogLines((prev) => {
      const next = [...prev, line];
      if (next.length > maxLines) return next.slice(-maxLines);
      return next;
    });
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    });
  };

  const appendToken = (text: string) => {
    setLogLines((prev) => {
      if (prev.length === 0) return [text];
      const last = prev[prev.length - 1]!;
      if (EMOJI_LINE_RE.test(last)) return [...prev, text];
      return [...prev.slice(0, -1), last + text];
    });
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    });
  };

  const clearLog = () => setLogLines([]);

  return { logLines, logRef, appendLog, appendToken, clearLog };
}
