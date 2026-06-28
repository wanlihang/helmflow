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
import { useRouter } from "next/navigation";
import { useState } from "react";

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

  const [domain, setDomain] = useState(defaultDomain);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // 弹窗每次打开时,把域重置为所在域(避免上次残留)
  function handleOpenChange(next: boolean) {
    if (next) setDomain(defaultDomain);
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("功能名称为必填项");
      return;
    }
    if (!domain.trim()) {
      setError("域不能为空");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domain.trim(),
          name: name.trim(),
          description,
          projectId,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "创建失败");
      }
      onOpenChange(false);
      // 重置表单
      setName("");
      setDescription("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加功能</DialogTitle>
          <DialogDescription>
            在域 &quot;{defaultDomain}&quot; 下创建新功能点 · 编号自动生成
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="add-feature-name">
              功能名称 *
            </label>
            <input
              id="add-feature-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              placeholder="如 创建交付需求"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="add-feature-desc">
              功能描述
            </label>
            <Textarea
              id="add-feature-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="用一句话描述这个功能点要做什么(后续需求澄清会基于它展开)..."
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="add-feature-domain">
              所属域
            </label>
            <input
              id="add-feature-domain"
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            />
            <p className="mt-0.5 text-xs text-muted-foreground">
              编号按域前缀自动生成(如 {defaultDomain.slice(0, 1).toUpperCase() || "D"}-10),无需手填
            </p>
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
