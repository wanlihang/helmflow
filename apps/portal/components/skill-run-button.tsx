"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface SkillRunButtonProps {
  label: string;
  endpoint: string;
  body: Record<string, unknown>;
  /** 响应里取 run id 的字段名(orchestrator=superRunId, clarify=runId) */
  runIdField?: string;
  /** Plan=clarify(蓝),Act=执行(紫) */
  variant?: "plan" | "act";
}

// 通用 skill 触发按钮:点击 → POST 后台异步 → 立即跳 run 页(命令行式实时看 + inject 介入)。
// 复制自 StartFullLoopButton 的跳转模式,泛化成所有 AI 操作(clarify/全流程/...)统一入口。
export function SkillRunButton({
  label,
  endpoint,
  body,
  runIdField = "superRunId",
  variant = "act",
}: SkillRunButtonProps) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) detail = `${detail} — ${j.error}`;
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      const data = (await res.json()) as Record<string, unknown>;
      const runId = data[runIdField];
      if (typeof runId !== "string" || runId.length === 0) {
        throw new Error(`响应缺少 ${runIdField}`);
      }
      router.push(`/runs/${runId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStarting(false);
    }
  };

  const colorClass =
    variant === "plan" ? "bg-blue-600 hover:bg-blue-700" : "bg-purple-600 hover:bg-purple-700";

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={starting} size="lg" className={colorClass}>
        {starting ? "启动中..." : label}
      </Button>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
