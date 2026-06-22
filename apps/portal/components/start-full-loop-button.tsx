"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface StartFullLoopButtonProps {
  contractId: string;
}

export function StartFullLoopButton({ contractId }: StartFullLoopButtonProps) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/orchestrator/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId }),
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
      const data = (await res.json()) as { superRunId: string };
      router.push(`/runs/${data.superRunId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStarting(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button onClick={handleClick} disabled={starting} size="lg">
        {starting ? "启动中..." : "启动全流程"}
      </Button>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
