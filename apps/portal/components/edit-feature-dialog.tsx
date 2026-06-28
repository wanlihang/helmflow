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
import { Textarea } from "@/components/ui/textarea";
import type { Feature } from "@/lib/matrix";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface EditFeatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: Feature;
}

export function EditFeatureDialog({ open, onOpenChange, feature }: EditFeatureDialogProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState(feature.name);
  const [description, setDescription] = useState(feature.description);
  const [handler, setHandler] = useState(feature.implementation.handler);
  const [actions, setActions] = useState(feature.implementation.actions.join(", "));
  const [context, setContext] = useState(feature.implementation.context);

  useEffect(() => {
    setName(feature.name);
    setDescription(feature.description);
    setHandler(feature.implementation.handler);
    setActions(feature.implementation.actions.join(", "));
    setContext(feature.implementation.context);
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
          description,
          handler,
          actions,
          context,
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
          <DialogDescription>修改功能名称与描述(功能 ID 不可改)</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="edit-feature-name">
              功能名称
            </label>
            <input
              id="edit-feature-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="edit-feature-desc">
              功能描述
            </label>
            <Textarea
              id="edit-feature-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="用一句话描述这个功能点要做什么..."
            />
          </div>

          {/* 实现定位(可选,通常由需求澄清/扫码分析自动产出) */}
          <details className="rounded-md border border-border p-2">
            <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
              实现定位(高级 · 通常由分析自动产出)
            </summary>
            <div className="mt-2 space-y-2">
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="edit-feature-handler">
                  Handler
                </label>
                <input
                  id="edit-feature-handler"
                  type="text"
                  value={handler}
                  onChange={(e) => setHandler(e.target.value)}
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="edit-feature-actions">
                  Actions (逗号分隔)
                </label>
                <input
                  id="edit-feature-actions"
                  type="text"
                  value={actions}
                  onChange={(e) => setActions(e.target.value)}
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="edit-feature-context">
                  Context
                </label>
                <input
                  id="edit-feature-context"
                  type="text"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
                />
              </div>
            </div>
          </details>

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
