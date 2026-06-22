"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ScenarioStatus } from "@/lib/matrix";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface AddScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureId: string;
}

const STATUS_OPTIONS: ScenarioStatus[] = ["待实现", "需改造", "已支持", "废弃"];

export function AddScenarioDialog({ open, onOpenChange, featureId }: AddScenarioDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioStatus, setScenarioStatus] = useState<ScenarioStatus>("待实现");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scenarioName.trim()) {
      setError("场景名称不能为空");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/features/${featureId}/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioName: scenarioName.trim(),
          scenarioStatus,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "创建失败");
      }
      onOpenChange(false);
      setScenarioName("");
      setScenarioStatus("待实现");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加场景</DialogTitle>
          <DialogDescription>为功能 {featureId} 添加新场景</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">场景名称 *</label>
            <input
              type="text"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              placeholder="如 正式签约"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">初始状态</label>
            <select
              value={scenarioStatus}
              onChange={(e) => setScenarioStatus(e.target.value as ScenarioStatus)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
