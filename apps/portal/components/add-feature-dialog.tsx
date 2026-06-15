"use client";

import { useState } from "react";
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

interface AddFeatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDomain: string;
  projectId: string;
}

export function AddFeatureDialog({
  open,
  onOpenChange,
  defaultDomain,
  projectId,
}: AddFeatureDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [id, setId] = useState("");
  const [domain, setDomain] = useState(defaultDomain);
  const [name, setName] = useState("");
  const [handler, setHandler] = useState("");
  const [actions, setActions] = useState("");
  const [context, setContext] = useState("");
  const [priority, setPriority] = useState("P2");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!id.trim() || !domain.trim() || !name.trim()) {
      setError("ID、域和名称为必填项");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: id.trim(),
          domain: domain.trim(),
          name: name.trim(),
          handler,
          actions,
          context,
          priority,
          projectId,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "创建失败");
      }
      onOpenChange(false);
      // 重置表单
      setId("");
      setName("");
      setHandler("");
      setActions("");
      setContext("");
      setPriority("P2");
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
          <DialogTitle>添加功能</DialogTitle>
          <DialogDescription>在域 &quot;{defaultDomain}&quot; 下创建新功能点</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">功能 ID *</label>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              placeholder="如 D-10"
            />
            <p className="mt-0.5 text-xs text-muted-foreground">创建后不可修改</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">域</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">功能名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              placeholder="如 创建交付需求"
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
                onChange={(e) => setPriority(e.target.value)}
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
              placeholder="ActionA, ActionB"
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
              {loading ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
