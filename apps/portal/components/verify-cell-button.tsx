"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

interface VerifyCellButtonProps {
  cellId: string;
}

interface AcResult {
  acId: string;
  status: "pass" | "fail" | "no-test";
  testClass?: string;
}

interface VerifyRestoreResponse {
  run: { id: string; state: string; startedAt: string } | null;
  events: Array<{ id: number; type: string; payload: Record<string, unknown>; createdAt: string }>;
  result: { pass?: boolean; acResults?: AcResult[] } | null;
}

export function VerifyCellButton({ cellId }: VerifyCellButtonProps) {
  const [verifying, setVerifying] = useState(false);
  const [results, setResults] = useState<{ pass: boolean; acResults: AcResult[] } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumedRunning, setResumedRunning] = useState(false);

  // ─── On mount: restore latest verify run from DB ──────────────────
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const res = await fetch(`/api/verify-cell?cellId=${encodeURIComponent(cellId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as VerifyRestoreResponse;
        if (stopped || !data.run) return;

        // 回放事件,恢复最后一个 progress 和 verify-done 结果
        let lastProgress: string | null = null;
        for (const ev of data.events) {
          const p = ev.payload;
          if (p.type === "progress" && typeof p.message === "string") {
            lastProgress = p.message;
          } else if (p.type === "verify-done") {
            setResults({
              pass: p.pass === true,
              acResults: Array.isArray(p.acResults) ? (p.acResults as AcResult[]) : [],
            });
          } else if (p.type === "error") {
            setError(typeof p.message === "string" ? p.message : "Unknown error");
          }
        }

        if (data.run.state === "running") {
          setVerifying(true);
          setResumedRunning(true);
          if (lastProgress) setProgress(lastProgress);
        }
      } catch {
        // 首次加载失败不致命
      }
    })();
    return () => { stopped = true; };
  }, [cellId]);

  const handleVerify = async () => {
    setVerifying(true);
    setResumedRunning(false);
    setError(null);
    setResults(null);
    setProgress("启动验证...");

    try {
      const res = await fetch("/api/verify-cell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cellId }),
      });

      if (!res.ok || !res.body) {
        setError(`HTTP ${res.status}`);
        setVerifying(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string;
              message?: string;
              pass?: boolean;
              acResults?: AcResult[];
            };
            if (event.type === "progress" && event.message) {
              setProgress(event.message);
            } else if (event.type === "verify-done") {
              setResults({ pass: event.pass ?? false, acResults: event.acResults ?? [] });
            } else if (event.type === "error") {
              setError(event.message ?? "Unknown error");
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={handleVerify} disabled={verifying && !resumedRunning}>
        {resumedRunning
          ? "🔄 重新验证"
          : verifying
            ? "验证中..."
            : "验证正确性"}
      </Button>

      {resumedRunning && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          ⚠️ 检测到上次验证仍在进行中,可点击「重新验证」重新发起。
        </div>
      )}

      {progress && verifying && (
        <div className="text-xs text-muted-foreground">{progress}</div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {results && (
        <div className={`rounded-md border p-3 text-xs space-y-2 ${
          results.pass
            ? "border-green-200 bg-green-50"
            : "border-red-200 bg-red-50"
        }`}>
          <div className={`font-semibold ${results.pass ? "text-green-700" : "text-red-700"}`}>
            {results.pass ? "验证通过 — 所有 AC 测试正常" : "验证失败 — 部分 AC 测试未通过,建议重新实现"}
          </div>
          {results.acResults.length > 0 && (
            <ul className="space-y-1">
              {results.acResults.map((ac) => (
                <li key={ac.acId} className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${
                    ac.status === "pass" ? "bg-green-500"
                    : ac.status === "fail" ? "bg-red-500"
                    : "bg-gray-400"
                  }`} />
                  <span className="font-mono">{ac.acId}</span>
                  <span className="text-muted-foreground">
                    {ac.status === "no-test" ? "无测试覆盖" : ac.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
