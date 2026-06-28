"use client";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface LlmProvider {
  id: string;
  name: string;
  apiKey: string; // 脱敏
  baseUrl: string;
  model: string;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export function LlmProvidersClient({ initialProviders }: { initialProviders: LlmProvider[] }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LlmProvider | null>(null);

  async function refresh() {
    router.refresh();
  }

  async function handleActivate(id: string) {
    const res = await fetch(`/api/llm-providers/${id}/activate`, { method: "POST" });
    if (res.ok) {
      toast.success("已激活", "下次 LLM 调用起生效");
      refresh();
    } else {
      toast.error("激活失败");
    }
  }

  async function handleTest(id: string) {
    toast.info("测试连接中…");
    const res = await fetch(`/api/llm-providers/${id}/test`, { method: "POST" });
    const data = (await res.json()) as { ok: boolean; latencyMs?: number; error?: string };
    if (data.ok) toast.success("连接成功", `${data.latencyMs ?? 0}ms`);
    else toast.error("连接失败", data.error);
  }

  async function handleDelete(p: LlmProvider) {
    const ok = await confirm({
      title: `删除 ${p.name}?`,
      description: "该操作不可恢复。",
      variant: "destructive",
      confirmText: "删除",
    });
    if (!ok) return;
    const res = await fetch(`/api/llm-providers/${p.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("已删除");
      refresh();
    } else {
      const d = (await res.json()) as { error?: string };
      toast.error("删除失败", d.error);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setCreating(true)}>
          + 新增 Provider
        </Button>
      </div>

      {initialProviders.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          尚无 Provider,点击「新增 Provider」配置大模型连接。
        </div>
      ) : null}

      {initialProviders.map((p) => (
        <div key={p.id} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{p.name}</span>
              {p.isActive ? (
                <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                  活跃
                </span>
              ) : null}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" type="button" onClick={() => handleTest(p.id)}>
                测试
              </Button>
              {!p.isActive ? (
                <Button size="sm" variant="outline" type="button" onClick={() => handleActivate(p.id)}>
                  激活
                </Button>
              ) : null}
              <Button size="sm" variant="outline" type="button" onClick={() => setEditing(p)}>
                编辑
              </Button>
              <Button
                size="sm"
                variant="outline"
                type="button"
                disabled={!!p.isActive}
                onClick={() => handleDelete(p)}
              >
                删除
              </Button>
            </div>
          </div>
          <div className="mt-1.5 font-mono text-xs text-muted-foreground">
            {p.baseUrl} · {p.model} · {p.apiKey}
          </div>
        </div>
      ))}

      {(creating || editing) && (
        <ProviderDialog
          provider={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            refresh();
          }}
        />
      )}
      {confirmEl}
    </div>
  );
}

function ProviderDialog({
  provider,
  onClose,
  onSaved,
}: {
  provider: LlmProvider | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(provider?.name ?? "");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [model, setModel] = useState(provider?.model ?? "glm-5.2[1M]");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || !baseUrl.trim()) {
      toast.error("名称和 Base URL 不能为空");
      return;
    }
    if (!provider && !apiKey.trim()) {
      toast.error("新建时 API Key 不能为空");
      return;
    }
    setSaving(true);
    const body: Record<string, string> = { name: name.trim(), baseUrl: baseUrl.trim(), model: model.trim() };
    if (apiKey.trim()) body.apiKey = apiKey.trim(); // 编辑留空=不改
    const res = provider
      ? await fetch(`/api/llm-providers/${provider.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetch("/api/llm-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
    setSaving(false);
    if (res.ok) {
      toast.success("已保存");
      onSaved();
    } else {
      const d = (await res.json()) as { error?: string };
      toast.error("保存失败", d.error);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{provider ? "编辑 Provider" : "新增 Provider"}</DialogTitle>
          <DialogDescription>
            {provider ? "API Key 留空表示不修改。" : "配置一个大模型连接。"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground">名称</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 智谱 GLM / Anthropic 官方" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">API Key</label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider ? "••••••（留空不改）" : "粘贴 API Key"}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Base URL</label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.anthropic.com 或 兼容 endpoint"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Model</label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
