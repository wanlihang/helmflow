"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useState } from "react";

export interface RuntimeSettings {
  skipDeploy: number;
  turnsPerSession: number;
  turnIntervalMs: number;
}

export function RuntimeSettingsClient({ initialSettings }: { initialSettings: RuntimeSettings }) {
  const toast = useToast();
  const [skipDeploy, setSkipDeploy] = useState(initialSettings.skipDeploy === 1);
  const [turnsPerSession, setTurnsPerSession] = useState(String(initialSettings.turnsPerSession));
  const [turnIntervalMs, setTurnIntervalMs] = useState(String(initialSettings.turnIntervalMs));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/runtime-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skipDeploy,
          turnsPerSession: Number(turnsPerSession),
          turnIntervalMs: Number(turnIntervalMs),
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      toast.success("已保存", "下次「启动全流程」时生效");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("保存失败", message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-border p-5">
      <div>
        <h2 className="text-lg font-semibold">运行设置</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          控制「启动全流程」的执行参数。这里配置后由平台注入,不再依赖 .env.local 手改 —— 这正是把平台"用起来"的一等配置。
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox checked={skipDeploy} onChange={(e) => setSkipDeploy(e.target.checked)} className="mt-0.5" />
        <div>
          <div className="text-sm font-medium">跳过上线节点 (SKIP_DEPLOY)</div>
          <div className="text-xs text-muted-foreground">
            开启后:测试节点通过即视为完成并自动合并 worktree,不进入 deploy(无需 gh/GitLab)。强烈建议保持开启 —— 先跑通最短闭环。
          </div>
        </div>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1.5">
          <div className="text-sm font-medium">单会话轮次 (turns/session)</div>
          <Input
            type="number"
            min={0}
            value={turnsPerSession}
            onChange={(e) => setTurnsPerSession(e.target.value)}
          />
          <div className="text-xs text-muted-foreground">
            每个 agent 会话的最大轮次。0 = 用默认(15)。worker 旧默认 2 会把 agent 憋死,这里放开。
          </div>
        </label>
        <label className="space-y-1.5">
          <div className="text-sm font-medium">会话间隔 (ms)</div>
          <Input
            type="number"
            min={0}
            value={turnIntervalMs}
            onChange={(e) => setTurnIntervalMs(e.target.value)}
          />
          <div className="text-xs text-muted-foreground">
            多会话续接之间的等待。0 = 不等待(模拟人工节奏只为绕限流,稳定端点无需)。
          </div>
        </label>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存运行设置"}
        </Button>
      </div>
    </div>
  );
}
