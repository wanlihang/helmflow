"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Feature, FeaturePriority } from "@/lib/matrix";

interface EditFeatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: Feature;
}

export function EditFeatureDialog({
  open,
  onOpenChange,
  feature,
}: EditFeatureDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState(feature.name);
  const [handler, setHandler] = useState(feature.implementation.handler);
  const [actions, setActions] = useState(feature.implementation.actions.join(", "));
  const [context, setContext] = useState(feature.implementation.context);
  const [priority, setPriority] = useState<FeaturePriority>(feature.priority);

  useEffect(() => {
    setName(feature.name);
    setHandler(feature.implementation.handler);
    setActions(feature.implementation.actions.join(", "));
    setContext(feature.implementation.context);
    setPriority(feature.priority);
  }, [feature]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("名称不能为空");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/features/${feature.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          handler,
          actions,
          context,
          priority,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "更新失败");
      }
      onOpenChange(false);
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
          <DialogTitle>编辑功能 — {feature.id}</DialogTitle>
          <DialogDescription>修改功能元数据(功能 ID 不可改)</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">功能名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Handler</label>
              <input
                type="text"
                value={handler}
                onChange={(e) => setHandler(e.target.value)}
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as FeaturePriority)}
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              >
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Actions (逗号分隔)</label>
            <input
              type="text"
              value={actions}
              onChange={(e) => setActions(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Context</label>
            <input
              type="text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
