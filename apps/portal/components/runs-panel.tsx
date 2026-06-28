"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface RunItem {
  id: string;
  cellId: string;
  kind: string;
  state: string;
  startedAt: string;
  finishedAt: string | null;
  lastActivity: string;
}

const KIND_LABEL: Record<string, string> = {
  clarify: "需求澄清",
  code: "代码实现",
  test: "测试",
  deploy: "上线",
  analyze: "状态分析",
  "contract-sync": "契约同步",
  clarifier: "Clarifier",
  coder: "Coder",
  testgen: "TestGen",
  qa: "QA",
  committer: "Committer",
  verify: "验证",
  "full-loop": "全流程",
};

const STATE_STYLE: Record<string, string> = {
  running: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  done: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  applied: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  "pending-confirm": "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  abandoned: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};
import { timeAgo } from "@/lib/format";

function isStale(lastActivity: string): boolean {
  const diff = Date.now() - new Date(lastActivity).getTime();
  return Number.isFinite(diff) && diff > 5 * 60 * 1000;
}

export function RunsPanel({ initialRuns }: { initialRuns: RunItem[] }) {
  const [runs, setRuns] = useState<RunItem[]>(initialRuns);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/runs");
        const data = await res.json();
        if (!stopped && Array.isArray(data.runs)) setRuns(data.runs as RunItem[]);
      } catch {
        // 忽略单次失败
      }
    };
    const timer = setInterval(poll, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const running = runs.filter((r) => r.state === "running");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">运行中心</h1>
        {running.length > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            {running.length} 个运行中
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">无运行中任务</span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        所有 AI
        调用(Clarifier/Coder/分析/契约同步…)的运行态。「最后活动」判断是否真在执行:新鲜=执行中,5min
        无活动=疑似卡住(自动清理)。
      </p>

      {runs.length === 0 ? (
        <div className="rounded-md border border-border bg-muted p-6 text-center text-sm text-muted-foreground">
          暂无运行记录。触发一次需求/分析/代码节点后,这里会显示运行态。
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">状态</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">类型</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">Cell</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">最后活动</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">开始</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">runId</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const active = r.state === "running";
                const stale = active && isStale(r.lastActivity);
                return (
                  <tr key={r.id} className="border-b border-border hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${STATE_STYLE[r.state] ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {active && (
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${stale ? "bg-yellow-500" : "animate-pulse bg-blue-500"}`}
                          />
                        )}
                        {stale ? "疑似卡住" : r.state}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.cellId}</td>
                    <td
                      className={`px-3 py-2 text-xs ${stale ? "text-yellow-600 font-semibold" : active ? "text-blue-600" : "text-muted-foreground"}`}
                    >
                      {timeAgo(r.lastActivity)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {timeAgo(r.startedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/runs/${r.id}`}
                        className="font-mono text-xs text-blue-600 hover:underline"
                      >
                        {r.id.slice(0, 18)}…
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
