"use client";

import { useEffect, useState } from "react";

/** 顶部"运行中(N)"徽章。5s 轮询 /api/runs?state=running 取数量,N>0 高亮链 /runs。 */
export function RunningBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/runs?state=running");
        const data = await res.json();
        if (!stopped) setCount(typeof data.runningCount === "number" ? data.runningCount : 0);
      } catch {
        // 忽略
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  if (!count || count === 0) {
    return (
      <a className="hover:text-foreground" href="/runs">
        运行中心
      </a>
    );
  }

  return (
    <a
      className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-200 dark:bg-blue-950/40 dark:text-blue-300"
      href="/runs"
    >
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
      运行中 {count}
    </a>
  );
}
