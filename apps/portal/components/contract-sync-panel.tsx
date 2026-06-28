"use client";

import { ContractRenderDialog } from "@/components/contract-render-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface FeatureOption {
  id: string;
  name: string;
  domain: string;
  scenarios: Array<{ name: string; status: string }>;
}

interface Candidate {
  featureId: string;
  scenarioName: string;
  cellId: string;
  score: number;
  reasons: string[];
}

interface SyncResult {
  id: string;
  contractFeatureId: string;
  state: "matched" | "pending" | "unmatched";
  confidence: number;
  chosenCellId: string | null;
  mappedFeatureId: string | null;
  mappedScenarioName: string | null;
  helmcodeStatus: string;
  targetScenarioStatus: string | null;
  candidates: Candidate[];
  reasons: string[];
  scannedAt: string;
}

interface PanelProps {
  projectId: string;
  features: FeatureOption[];
  lastScannedAt: string | null;
}

const STATE_LABEL: Record<string, { text: string; cls: string }> = {
  matched: {
    text: "已同步",
    cls: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  },
  pending: {
    text: "待确认",
    cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300",
  },
  unmatched: {
    text: "未匹配",
    cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  },
};

const STATUS_BADGE: Record<string, string> = {
  done: "bg-green-100 text-green-700",
  approved: "bg-green-100 text-green-700",
  "goal-running": "bg-yellow-100 text-yellow-700",
  draft: "bg-gray-100 text-gray-600",
};

export function ContractSyncPanel({ projectId, features, lastScannedAt }: PanelProps) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<SyncResult[] | null>(null);
  const [summary, setSummary] = useState<{
    matched: number;
    pending: number;
    unmatched: number;
  } | null>(null);
  const [autoApply, setAutoApply] = useState<{
    applied: string[];
    skipped: string[];
    errors: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // 待确认项的临时选择:contractFeatureId → { featureId, scenarioName }
  const [pendingPick, setPendingPick] = useState<
    Record<string, { featureId: string; scenarioName: string }>
  >({});
  // 「查看契约」弹窗:当前查看的契约正文 + 正在加载的 contractFeatureId
  const [viewContract, setViewContract] = useState<string | null>(null);
  const [loadingContract, setLoadingContract] = useState<string | null>(null);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/contract-sync/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      setSummary(data.summary);
      setAutoApply(data.autoApply);

      // 拉取最新结果
      const r2 = await fetch("/api/contract-sync/results");
      const d2 = await r2.json();
      setResults(d2.results ?? []);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  // 初次加载时若有历史扫描结果,拉取展示
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/contract-sync/results");
        const d = await r.json();
        if (cancelled) return;
        const list: SyncResult[] = d.results ?? [];
        if (list.length > 0) {
          setResults(list);
          setSummary({
            matched: list.filter((x) => x.state === "matched").length,
            pending: list.filter((x) => x.state === "pending").length,
            unmatched: list.filter((x) => x.state === "unmatched").length,
          });
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConfirm = async (r: SyncResult) => {
    const pick = pendingPick[r.contractFeatureId];
    if (!pick) {
      setError("请先选择功能点和场景");
      return;
    }
    setConfirmingId(r.id);
    setError(null);
    try {
      const res = await fetch("/api/contract-sync/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractFeatureId: r.contractFeatureId,
          helmcodeStatus: r.helmcodeStatus,
          featureId: pick.featureId,
          scenarioName: pick.scenarioName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      // 刷新结果
      const r2 = await fetch("/api/contract-sync/results");
      const d2 = await r2.json();
      setResults(d2.results ?? []);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmingId(null);
    }
  };

  const handleView = async (featureId: string) => {
    setLoadingContract(featureId);
    setError(null);
    try {
      const res = await fetch(
        `/api/contract-sync/contract?featureId=${encodeURIComponent(featureId)}`,
      );
      const data = (await res.json()) as { markdown?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setViewContract(data.markdown ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingContract(null);
    }
  };

  const renderRow = (r: SyncResult, actionable: boolean) => (
    <div key={r.id} className="rounded-md border border-border bg-card p-3 text-sm space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-xs font-semibold">{r.contractFeatureId}</code>
        <Badge
          variant="outline"
          className={STATUS_BADGE[r.helmcodeStatus] ?? "bg-gray-100 text-gray-600"}
        >
          HelmCode: {r.helmcodeStatus}
        </Badge>
        {r.targetScenarioStatus && (
          <Badge
            variant="outline"
            className="bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
          >
            → {r.targetScenarioStatus}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          置信度 {(r.confidence * 100).toFixed(0)}%
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={loadingContract === r.contractFeatureId}
          onClick={() => handleView(r.contractFeatureId)}
        >
          {loadingContract === r.contractFeatureId ? "加载中…" : "查看契约"}
        </Button>
      </div>

      {r.state === "matched" && r.mappedFeatureId && (
        <div className="text-xs text-muted-foreground">
          目标 cell: <code className="font-mono">{r.chosenCellId}</code>
          {r.reasons.length > 0 && <span> · {r.reasons.join(" / ")}</span>}
        </div>
      )}

      {actionable && (r.state === "pending" || r.state === "unmatched") && (
        <div className="space-y-2 border-t border-border pt-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">指认功能点:</span>
            <select
              className="rounded border border-border bg-background px-2 py-1 text-xs"
              defaultValue=""
              onChange={(e) => {
                const fid = e.target.value;
                const feat = features.find((f) => f.id === fid);
                const sname = feat?.scenarios.find((s) => s.status !== "废弃")?.name ?? "";
                setPendingPick((p) => ({
                  ...p,
                  [r.contractFeatureId]: { featureId: fid, scenarioName: sname },
                }));
              }}
            >
              <option value="" disabled>
                选择功能点…
              </option>
              {features.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id} · {f.name} ({f.domain})
                </option>
              ))}
            </select>
            {pendingPick[r.contractFeatureId]?.featureId && (
              <select
                className="rounded border border-border bg-background px-2 py-1 text-xs"
                value={pendingPick[r.contractFeatureId]?.scenarioName ?? ""}
                onChange={(e) =>
                  setPendingPick((p) => ({
                    ...p,
                    [r.contractFeatureId]: {
                      featureId: p[r.contractFeatureId]?.featureId ?? "",
                      scenarioName: e.target.value,
                    },
                  }))
                }
              >
                {features
                  .find((f) => f.id === pendingPick[r.contractFeatureId]?.featureId)
                  ?.scenarios.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
              </select>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={confirmingId === r.id || !pendingPick[r.contractFeatureId]?.featureId}
              onClick={() => handleConfirm(r)}
            >
              {confirmingId === r.id ? "确认中…" : "确认同步"}
            </Button>
          </div>
          {r.candidates.length > 0 && (
            <div className="text-xs text-muted-foreground">
              候选:
              {r.candidates.map((c) => (
                <span key={c.cellId} className="ml-2">
                  <code className="font-mono">{c.featureId}</code> ({(c.score * 100).toFixed(0)}%)
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {r.state === "unmatched" && (
        <div className="text-xs text-muted-foreground">未自动匹配,可在上方手动指认功能点。</div>
      )}
    </div>
  );

  const matched = (results ?? []).filter((r) => r.state === "matched");
  const pending = (results ?? []).filter((r) => r.state === "pending");
  const unmatched = (results ?? []).filter((r) => r.state === "unmatched");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleScan} disabled={scanning}>
          {scanning ? "扫描中…" : "扫描契约"}
        </Button>
        {lastScannedAt && (
          <span className="text-xs text-muted-foreground">
            上次扫描: {new Date(lastScannedAt).toLocaleString("zh-CN")}
          </span>
        )}
        {summary && (
          <span className="text-xs text-muted-foreground">
            本次:已同步 {summary.matched} / 待确认 {summary.pending} / 未匹配 {summary.unmatched}
            {autoApply && autoApply.applied.length > 0 && (
              <span className="ml-1 text-green-600">·自动应用 {autoApply.applied.length} 项</span>
            )}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {results && results.length === 0 && (
        <div className="rounded-md border border-border bg-muted p-4 text-sm text-muted-foreground">
          暂无契约扫描结果。点击「扫描契约」从目标项目 .claude/contracts/ 拉取。
        </div>
      )}

      {matched.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Badge className={STATE_LABEL.matched.cls}>已同步 {matched.length}</Badge>
          </h2>
          <div className="grid gap-2">{matched.map((r) => renderRow(r, false))}</div>
        </section>
      )}

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Badge className={STATE_LABEL.pending.cls}>待确认 {pending.length}</Badge>
          </h2>
          <p className="text-xs text-muted-foreground">
            以下契约匹配置信度不足或存在多候选,请人工指认目标功能点后确认同步。
          </p>
          <div className="grid gap-2">{pending.map((r) => renderRow(r, true))}</div>
        </section>
      )}

      {unmatched.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Badge className={STATE_LABEL.unmatched.cls}>未匹配 {unmatched.length}</Badge>
          </h2>
          <p className="text-xs text-muted-foreground">
            以下契约未找到对应功能点,已跳过(不强求全部对应)。
          </p>
          <div className="grid gap-2">{unmatched.map((r) => renderRow(r, true))}</div>
        </section>
      )}

      {viewContract !== null && (
        <ContractRenderDialog
          rawMarkdown={viewContract}
          open={true}
          onOpenChange={(o) => {
            if (!o) setViewContract(null);
          }}
        />
      )}
    </div>
  );
}
