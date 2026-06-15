"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface ApproveContractButtonProps {
  contractId: string;
}

export function ApproveContractButton({
  contractId,
}: ApproveContractButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const json = (await res.json()) as { error?: string };
          if (json.error) detail = `${detail} — ${json.error}`;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={onClick} disabled={submitting}>
        {submitting ? "审批中..." : "审批契约"}
      </Button>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
