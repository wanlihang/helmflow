"use client";

import { timeAgo } from "@/lib/format";
import { useEffect, useState } from "react";

interface QueueItem {
  id: string;
  cellId: string;
  contractId: string;
  state: string;
  priority: number;
  attempt: number;
  maxAttempts: number;
  lastError: string;
  updatedAt: string;
}

interface QueueData {
  counts: Record<string, number>;
  items: QueueItem[];
}

const STATE_STYLE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  done: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  blocked: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-semibold ${cls}`}>
      {label}
    </span>
  );
}

export function QueuePanel() {
  const [data, setData] = useState<QueueData | null>(null);

  useEffect(() => {
    let stopped = false;
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch("/api/queue");
        const d = (await res.json()) as QueueData;
        if (!stopped) setData(d);
      } catch {
        // 忽略单次失败
      }
    };
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const counts = data?.counts ?? { pending: 0, running: 0, done: 0, failed: 0, blocked: 0 };
  const activeItems = (data?.items ?? []).filter((i) => i.state !== "done").slice(0, 20);
  const pending = counts.pending ?? 0;
  const running = counts.running ?? 0;
  const blocked = counts.blocked ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">开发队列(Worker)</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge label={`待执行 ${pending}`} cls={STATE_STYLE.pending} />
          <Badge label={`运行中 ${running}`} cls={STATE_STYLE.running} />
          <Badge label={`阻塞 ${blocked}`} cls={STATE_STYLE.blocked} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        常驻 worker 自动消费 <strong>已审批</strong> 契约,7×24 排队执行
        clarify→code→test→deploy。启动 worker:
        <code className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          pnpm worker:start
        </code>
      </p>

      {pending + running + blocked === 0 ? (
        <div className="rounded-md border border-border bg-muted p-4 text-center text-sm text-muted-foreground">
          队列为空。审批一份契约后,worker 会自动入队执行。
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">状态</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">Cell</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">Contract</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">重跑</th>
                <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">更新</th>
              </tr>
            </thead>
            <tbody>
              {activeItems.map((i) => (
                <tr key={i.id} className="border-b border-border hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${STATE_STYLE[i.state] ?? "bg-gray-100 text-gray-600"}`}
                    >
                      {i.state === "running" && (
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                      )}
                      {i.state}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{i.cellId}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {i.contractId.slice(0, 20)}…
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {i.attempt}/{i.maxAttempts}
                    {i.state === "blocked" && i.lastError ? (
                      <span className="ml-1 text-red-600" title={i.lastError}>
                        ⚠
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {timeAgo(i.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
