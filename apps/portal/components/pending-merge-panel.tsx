"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface QaAcResult {
  acId: string;
  status: string;
  failureReason?: string;
}
interface QaReport {
  verdict?: string;
  summary?: string;
  lenient?: { totalRun: number; passed: number; failed: number };
  acResults?: QaAcResult[];
}
interface PendingMerge {
  pending: boolean;
  runState?: string;
  branchName?: string;
  targetBranch?: string;
  worktreePath?: string;
  mode?: "local" | "deploy";
  diffStat?: string;
  files?: Array<{ status: string; path: string }>;
  targetAheadBy?: number;
  qaReport?: QaReport | null;
}

/**
 * 待人工确认合并面板:test 通过后 run 停在 pending-confirm,此面板展示
 * worktree 相对目标分支的 diff,并提供「确认合并 / 放弃」操作。
 */
export function PendingMergePanel({ runId }: { runId: string }) {
  const router = useRouter();
  const [data, setData] = useState<PendingMerge | null>(null);
  const [busy, setBusy] = useState<"confirm" | "abort" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/pending-merge`, { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as PendingMerge;
        if (!stopped) setData(d);
      } catch {
        /* ignore */
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [runId]);

  const confirm = async () => {
    setBusy("confirm");
    setMsg(null);
    try {
      const res = await fetch(`/api/runs/${runId}/confirm-merge`, { method: "POST" });
      const d = (await res.json()) as {
        ok?: boolean;
        started?: boolean;
        merged?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      if (d.started) {
        // mode=deploy 异步出 PR:面板继续轮询,run 转.done 后本面板会因 runState 变化而消失
        setMsg("已启动 deploy 节点(出 PR),请稍候…");
        setBusy(null);
      } else {
        router.refresh();
      }
    } catch (err) {
      setMsg((err as Error).message);
      setBusy(null);
    }
  };

  const abort = async () => {
    if (!window.confirm("确认放弃合并?将删除本次 worktree 分支(run 标记为已放弃)。")) return;
    setBusy("abort");
    setMsg(null);
    try {
      const res = await fetch(`/api/runs/${runId}/abort`, { method: "POST" });
      const d = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
      setBusy(null);
    }
  };

  if (!data || !data.pending) {
    return null;
  }

  const ahead = data.targetAheadBy ?? 0;

  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-base">⏸ 待确认合并</span>
        <span className="text-xs">test 已通过,代码改动已就绪,等待你确认后才合并/上线</span>
      </div>
      <div className="text-xs font-mono text-amber-800">
        分支 <code className="font-bold">{data.branchName}</code> → 合并到{" "}
        <code className="font-bold">{data.targetBranch}</code> · 模式{" "}
        {data.mode === "deploy" ? "deploy(出 PR)" : "local(本地 merge)"}
        {ahead > 0 && (
          <span className="ml-2 text-red-700">
            ⚠ 目标分支领先 {ahead} 个提交,合并将产生 merge commit
          </span>
        )}
      </div>

      {data.qaReport && (
        <div className="rounded border border-amber-200 bg-white/70 p-3 text-xs">
          <div className="mb-1 flex flex-wrap items-center gap-2 font-semibold">
            <span>⚖ judge 判定(test 节点)</span>
            <span className={data.qaReport.verdict === "pass" ? "text-green-700" : "text-red-700"}>
              {data.qaReport.verdict === "pass" ? "✅ 通过" : "❌ 未通过"}
            </span>
            {data.qaReport.lenient && (
              <span className="font-normal text-muted-foreground">
                (AC: {data.qaReport.lenient.passed} 通过 / {data.qaReport.lenient.failed} 失败 / 共{" "}
                {data.qaReport.lenient.totalRun})
              </span>
            )}
          </div>
          {data.qaReport.summary && (
            <div className="mb-1 text-amber-900">{data.qaReport.summary}</div>
          )}
          {data.qaReport.acResults && data.qaReport.acResults.length > 0 && (
            <ul className="space-y-0.5 font-mono text-[11px]">
              {data.qaReport.acResults.map((a) => (
                <li key={a.acId}>
                  <span className={a.status === "pass" ? "text-green-700" : "text-red-700"}>
                    {a.status === "pass" ? "✓" : "✗"}
                  </span>{" "}
                  {a.acId}
                  {a.status === "fail" && a.failureReason && (
                    <span className="text-muted-foreground"> — {a.failureReason}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data.diffStat && data.diffStat.length > 0 ? (
        <details open className="rounded border border-amber-200 bg-white/60">
          <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold">
            变更预览(相对 {data.targetBranch})
          </summary>
          <pre className="overflow-auto whitespace-pre-wrap px-3 py-2 text-[11px] leading-relaxed font-mono text-amber-900">
            {data.diffStat}
          </pre>
          {data.files && data.files.length > 0 && (
            <ul className="border-t border-amber-200 px-3 py-2 text-[11px] font-mono">
              {data.files.slice(0, 50).map((f) => (
                <li key={f.path}>
                  <span className="mr-2 inline-block w-4 text-center">{f.status}</span>
                  {f.path}
                </li>
              ))}
              {data.files.length > 50 && (
                <li className="text-muted-foreground">…共 {data.files.length} 个文件</li>
              )}
            </ul>
          )}
        </details>
      ) : (
        <div className="text-xs text-amber-700">
          无相对目标分支的变更(可能已合并或 diff 计算失败)。
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={confirm} disabled={busy !== null} size="sm">
          {busy === "confirm" ? "处理中..." : data.mode === "deploy" ? "确认 → 出 PR" : "确认合并"}
        </Button>
        <Button onClick={abort} disabled={busy !== null} variant="outline" size="sm">
          {busy === "abort" ? "处理中..." : "放弃"}
        </Button>
        {msg && <span className="text-xs text-red-700">{msg}</span>}
      </div>
    </div>
  );
}
