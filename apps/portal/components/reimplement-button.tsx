"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface ReimplementButtonProps {
  cellId: string;
}

export function ReimplementButton({ cellId }: ReimplementButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze-status/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ cellId, newStatus: "需改造" }] }),
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
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            确定重新实现？将重置为「需改造」状态
          </span>
          <Button size="sm" variant="destructive" onClick={handleConfirm} disabled={submitting}>
            {submitting ? "处理中..." : "确认"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
            取消
          </Button>
        </div>
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            操作失败:{error}
          </div>
        )}
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
      重新实现
    </Button>
  );
}
