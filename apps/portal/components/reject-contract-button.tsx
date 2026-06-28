"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface RejectContractButtonProps {
  contractId: string;
}

// 拒绝契约(draft → abandoned):与 ApproveContractButton 对称,但不推进 cell。
// 重跑 clarify 会生成新 draft。仅 draft 状态显示(cell 页守卫)。
export function RejectContractButton({ contractId }: RejectContractButtonProps) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (!window.confirm("拒绝该契约?(draft → abandoned。可重新澄清生成新草案)")) {
      return;
    }
    setRejecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/reject`, { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRejecting(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        onClick={handleClick}
        disabled={rejecting}
        className="border border-red-300 text-red-700 hover:bg-red-50"
      >
        {rejecting ? "拒绝中..." : "拒绝契约"}
      </Button>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
