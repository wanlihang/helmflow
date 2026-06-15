"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ScenarioStatus } from "@/lib/matrix";

interface CellStatusSelectProps {
  cellId: string;
  currentStatus: ScenarioStatus;
}

export function CellStatusSelect({ cellId, currentStatus }: CellStatusSelectProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<ScenarioStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async (newStatus: ScenarioStatus) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze-status/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ cellId, newStatus }] }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setSubmitting(false);
      setConfirming(null);
    }
  };

  if (confirming) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            确认将状态改为「{confirming}」？
          </span>
          <Button size="sm" variant="destructive" onClick={() => handleApply(confirming)} disabled={submitting}>
            {submitting ? "处理中..." : "确认"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
            取消
          </Button>
        </div>
        {error && (
          <div className="text-xs text-red-600">{error}</div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Badge scenario={currentStatus} />
        {currentStatus !== "废弃" && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => setConfirming("废弃")}
          >
            标记废弃
          </Button>
        )}
        {currentStatus === "废弃" && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => setConfirming("待实现")}
          >
            恢复为待实现
          </Button>
        )}
      </div>
      {error && (
        <div className="text-xs text-red-600">{error}</div>
      )}
    </div>
  );
}
