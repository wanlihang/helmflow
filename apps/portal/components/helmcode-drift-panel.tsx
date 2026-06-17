"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface DriftPanelProps {
  /** 是否检测到 drift(当前 checksum ≠ 项目绑定) */
  drift: boolean;
  /** 项目是否已绑定过版本(跑过节点/采纳过) */
  bound: boolean;
}

interface PreviewData {
  currentVersion: { helmcode: string; checksum: string; gitHead: string | null };
  diff: { changed: string[]; added: string[]; removed: string[]; all: string[]; error?: string };
  impact: { affectedCells: Array<{ cellId: string; hits: string[]; reason: string }>; total: number };
}

interface UpgradeCheckData {
  localHead: string;
  branch: string;
  hasRemote: boolean;
  remoteHead: string | null;
  behind: number;
  ahead: number;
  hasUpdate: boolean;
  error?: string;
}

export function HelmcodeDriftPanel({ drift, bound }: DriftPanelProps) {
  const router = useRouter();
  const [previewing, setPreviewing] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 升级检查/执行
  const [checking, setChecking] = useState(false);
  const [upgradeInfo, setUpgradeInfo] = useState<UpgradeCheckData | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  const handleUpgradeCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/helmcode/upgrade-check?branch=main");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpgradeInfo(data as UpgradeCheckData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  const handleUpgrade = async () => {
    if (!confirm("确认执行升级?HelmFlow 将在 helmcode 仓库 git checkout/pull main,并重新绑定版本。升级前请确认已 dryRun 预览。")) return;
    setUpgrading(true);
    setError(null);
    try {
      const res = await fetch("/api/helmcode/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpgradeInfo(null);
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpgrading(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setError(null);
    try {
      const res = await fetch("/api/helmcode/preview");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPreview(data as PreviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  };

  const handleAdopt = async () => {
    setAdopting(true);
    setError(null);
    try {
      const res = await fetch("/api/helmcode/adopt", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdopting(false);
    }
  };

  // 检查上游升级(独立区块,始终显示)
  const upgradeBlock = (
    <div className="space-y-2 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">检查上游升级(github)</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleUpgradeCheck} disabled={checking}>
            {checking ? "检查中…" : "检查升级"}
          </Button>
          {upgradeInfo?.hasUpdate && (
            <Button size="sm" onClick={handleUpgrade} disabled={upgrading}>
              {upgrading ? "升级中…" : `升级(+${upgradeInfo.behind} 提交)`}
            </Button>
          )}
        </div>
      </div>
      {upgradeInfo && (
        <div className="text-xs space-y-1">
          {upgradeInfo.error ? (
            <div className="text-yellow-700">{upgradeInfo.error}</div>
          ) : upgradeInfo.hasUpdate ? (
            <div className="text-blue-700">
              ⬆ 上游 <code className="font-mono">origin/{upgradeInfo.branch}</code> 有 <b>{upgradeInfo.behind}</b> 个新提交。
              本地 {upgradeInfo.localHead.slice(0, 8)} → 远程 {(upgradeInfo.remoteHead ?? "").slice(0, 8)}。
              点「升级」HelmFlow 代你 git pull + 重新绑定(升级前可先 dryRun 预览)。
            </div>
          ) : (
            <div className="text-green-700">✓ 已是上游最新(本地与 origin/{upgradeInfo.branch} 一致)。</div>
          )}
        </div>
      )}
    </div>
  );

  // 无 drift 且已绑定 → 一致;但仍展示升级检查区
  if (!drift && bound) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-700 dark:bg-green-950/40 dark:text-green-300">
          ✅ 项目绑定的标准版本与 helmcode 源一致,无 drift。
        </div>
        {upgradeBlock}
        {error && <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {upgradeBlock}
      <div className="space-y-3 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {drift ? "⚠ 标准 drift 检测" : "首次绑定"}
        </h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handlePreview} disabled={previewing}>
            {previewing ? "预览中…" : "预览变更(dryRun)"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {drift
          ? "helmcode 源的 standards 已变化(你手动 git pull/checkout 过)。点预览看改了哪些 pattern、影响哪些 cell,确认后采纳。"
          : "项目尚未绑定标准版本。预览后采纳,建立版本基线。"}
      </p>

      {error && <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

      {preview && (
        <div className="space-y-3 rounded border border-border bg-muted/30 p-3 text-xs">
          <div>
            <span className="text-muted-foreground">当前源版本:</span>{" "}
            <span className="font-mono text-green-600">{preview.currentVersion.helmcode}</span>
            {" / "}
            <span className="font-mono">{preview.currentVersion.checksum.slice(0, 12)}…</span>
            {preview.currentVersion.gitHead && (
              <span className="font-mono text-muted-foreground"> @ {preview.currentVersion.gitHead.slice(0, 12)}</span>
            )}
          </div>

          {preview.diff.error ? (
            <div className="text-yellow-700">diff 不可用: {preview.diff.error}(可能是首次提交,无 fromHead)</div>
          ) : (
            <div className="space-y-1">
              <div className="font-semibold">改动文件({preview.diff.all.length})</div>
              {preview.diff.all.length === 0 ? (
                <div className="text-muted-foreground">无文件改动(checksum 变可能来自 git ref 切换)。</div>
              ) : (
                <ul className="space-y-0.5 font-mono">
                  {preview.diff.changed.map((f) => <li key={`c-${f}`} className="text-yellow-700">M {f}</li>)}
                  {preview.diff.added.map((f) => <li key={`a-${f}`} className="text-green-700">A {f}</li>)}
                  {preview.diff.removed.map((f) => <li key={`r-${f}`} className="text-red-700">D {f}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="space-y-1">
            <div className="font-semibold">影响 cell({preview.impact.total})</div>
            {preview.impact.total === 0 ? (
              <div className="text-muted-foreground">无契约引用被改标准。</div>
            ) : (
              <ul className="space-y-0.5">
                {preview.impact.affectedCells.map((c) => (
                  <li key={c.cellId}>
                    <code className="font-mono">{c.cellId}</code>
                    <span className="text-muted-foreground"> — 命中: {c.hits.join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-border pt-2">
            <Button size="sm" onClick={handleAdopt} disabled={adopting}>
              {adopting ? "采纳中…" : "确认采纳"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreview(null)}>取消</Button>
            <span className="text-xs text-muted-foreground">采纳后更新项目绑定 + 记 migration 历史(不写任何文件)</span>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
