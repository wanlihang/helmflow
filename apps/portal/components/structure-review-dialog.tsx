"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type ExistingStructure,
  type StructureDiff,
  diffStructure,
  isGoverned,
} from "@/lib/structure-diff";
import type { StructureAnalysisResult } from "@/lib/structure-analyzer";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// 可编辑的结构数据
// ---------------------------------------------------------------------------

interface EditableScenario {
  name: string;
  status: string;
  confidence: "high" | "low";
  branchHint?: string;
  included: boolean;
}

interface EditableFeature {
  id: string;
  name: string;
  domain: string;
  domainName: string;
  handler: string;
  actions: string[];
  context: string;
  priority: string;
  scenarios: EditableScenario[];
  included: boolean;
  expanded: boolean;
}

interface EditableDomain {
  id: string;
  name: string;
  features: EditableFeature[];
  expanded: boolean;
}

type Strategy = "smart" | "add-only" | "overwrite";

interface ApplySummary {
  addedFeatures: string[];
  preservedFeatures: string[];
  updatedFeatures: string[];
  archivedFeatures: string[];
  addedScenarios: number;
  removedScenarios: number;
}

interface StructureReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 应用成功后回调(父组件可据此清除"待审阅"徽标) */
  onApplied?: () => void;
  result: StructureAnalysisResult;
  projectId: string;
  runId?: string;
}

// ---------------------------------------------------------------------------
// 将 API 结果转为可编辑状态
// ---------------------------------------------------------------------------

function toEditableState(result: StructureAnalysisResult): EditableDomain[] {
  return result.domains.map((d) => ({
    id: d.id,
    name: d.name,
    expanded: true,
    features: d.features.map((f) => ({
      ...f,
      included: true,
      expanded: false,
      scenarios: f.scenarios.map((s) => ({
        ...s,
        included: true,
      })),
    })),
  }));
}

// ---------------------------------------------------------------------------
// 差异标记
// ---------------------------------------------------------------------------

function DiffMark({ kind }: { kind: "added" | "preserved" | "conflict" }) {
  if (kind === "added") return <span title="DB 无,将新增">🆕</span>;
  if (kind === "preserved")
    return <span title="DB 已有,保留已治理状态(不被覆盖)">✅</span>;
  return <span title="与 DB 结构不同(name/handler 变),智能合并下保留 DB 的">⚠️</span>;
}

// ---------------------------------------------------------------------------
// 输入框样式
// ---------------------------------------------------------------------------

const inputCls =
  "w-full rounded border border-border bg-transparent px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function StructureReviewDialog({
  open,
  onOpenChange,
  onApplied,
  result,
  projectId,
  runId,
}: StructureReviewDialogProps) {
  const router = useRouter();
  const [domains, setDomains] = useState<EditableDomain[]>(() => toEditableState(result));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  // 合并策略与差异
  const [strategy, setStrategy] = useState<Strategy>("smart");
  const [archiveStale, setArchiveStale] = useState(true);
  const [existing, setExisting] = useState<ExistingStructure | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [applySummary, setApplySummary] = useState<ApplySummary | null>(null);

  // 打开时拉取 DB 现有结构,算差异
  useEffect(() => {
    if (!open) {
      setApplySummary(null);
      setConfirmOverwrite(false);
      return;
    }
    let stopped = false;
    setLoadingExisting(true);
    fetch(`/api/projects/${encodeURIComponent(projectId)}/existing-structure`)
      .then((r) => (r.ok ? r.json() : { features: {} }))
      .then((data: ExistingStructure) => {
        if (!stopped) setExisting(data);
      })
      .catch(() => {
        if (!stopped) setExisting({ features: {} });
      })
      .finally(() => {
        if (!stopped) setLoadingExisting(false);
      });
    return () => {
      stopped = true;
    };
  }, [open, projectId]);

  const diff: StructureDiff | null = useMemo(
    () => (existing ? diffStructure(result, existing) : null),
    [result, existing],
  );

  // featureId -> FeatureDiff,便于列表标记
  const featureDiffMap = useMemo(() => {
    const m = new Map<string, StructureDiff["features"][number]>();
    if (diff) for (const fd of diff.features) m.set(fd.featureId, fd);
    return m;
  }, [diff]);

  // ---- 统计(勾选的) ----
  const stats = useMemo(() => {
    let featureCount = 0;
    let scenarioCount = 0;
    let domainCount = 0;
    for (const d of domains) {
      const includedFeatures = d.features.filter((f) => f.included);
      if (includedFeatures.length > 0) domainCount++;
      featureCount += includedFeatures.length;
      for (const f of includedFeatures) {
        scenarioCount += f.scenarios.filter((s) => s.included).length;
      }
    }
    return { domainCount, featureCount, scenarioCount };
  }, [domains]);

  // ---- 域操作 ----
  function toggleDomain(di: number) {
    setDomains((prev) => prev.map((d, i) => (i === di ? { ...d, expanded: !d.expanded } : d)));
  }

  function updateDomainName(di: number, name: string) {
    setDomains((prev) => prev.map((d, i) => (i === di ? { ...d, name } : d)));
  }

  // ---- 功能点操作 ----
  function toggleFeature(di: number, fi: number) {
    setDomains((prev) =>
      prev.map((d, i) =>
        i === di
          ? {
              ...d,
              features: d.features.map((f, j) => (j === fi ? { ...f, included: !f.included } : f)),
            }
          : d,
      ),
    );
  }

  function expandFeature(di: number, fi: number) {
    setDomains((prev) =>
      prev.map((d, i) =>
        i === di
          ? {
              ...d,
              features: d.features.map((f, j) => (j === fi ? { ...f, expanded: !f.expanded } : f)),
            }
          : d,
      ),
    );
  }

  function updateFeatureField(di: number, fi: number, field: keyof EditableFeature, value: string) {
    setDomains((prev) =>
      prev.map((d, i) =>
        i === di
          ? {
              ...d,
              features: d.features.map((f, j) => (j === fi ? { ...f, [field]: value } : f)),
            }
          : d,
      ),
    );
  }

  // ---- 场景操作 ----
  function toggleScenario(di: number, fi: number, si: number) {
    setDomains((prev) =>
      prev.map((d, i) =>
        i === di
          ? {
              ...d,
              features: d.features.map((f, j) =>
                j === fi
                  ? {
                      ...f,
                      scenarios: f.scenarios.map((s, k) =>
                        k === si ? { ...s, included: !s.included } : s,
                      ),
                    }
                  : f,
              ),
            }
          : d,
      ),
    );
  }

  function updateScenarioName(di: number, fi: number, si: number, name: string) {
    setDomains((prev) =>
      prev.map((d, i) =>
        i === di
          ? {
              ...d,
              features: d.features.map((f, j) =>
                j === fi
                  ? {
                      ...f,
                      scenarios: f.scenarios.map((s, k) => (k === si ? { ...s, name } : s)),
                    }
                  : f,
              ),
            }
          : d,
      ),
    );
  }

  function addScenario(di: number, fi: number) {
    setDomains((prev) =>
      prev.map((d, i) =>
        i === di
          ? {
              ...d,
              features: d.features.map((f, j) =>
                j === fi
                  ? {
                      ...f,
                      scenarios: [
                        ...f.scenarios,
                        {
                          name: "新场景",
                          status: "待实现",
                          confidence: "low" as const,
                          included: true,
                        },
                      ],
                    }
                  : f,
              ),
            }
          : d,
      ),
    );
  }

  function removeScenario(di: number, fi: number, si: number) {
    setDomains((prev) =>
      prev.map((d, i) =>
        i === di
          ? {
              ...d,
              features: d.features.map((f, j) =>
                j === fi
                  ? {
                      ...f,
                      scenarios: f.scenarios.filter((_, k) => k !== si),
                    }
                  : f,
              ),
            }
          : d,
      ),
    );
  }

  // (右侧已改为变更预览,不再需要全局场景列收集)

  // ---- 实际执行 apply ----
  async function doApply() {
    setApplying(true);
    setError("");

    const confirmedFeatures: Array<{
      id: string;
      name: string;
      domain: string;
      domainName: string;
      handler: string;
      actions: string[];
      context: string;
      priority: string;
      scenarios: Array<{ name: string; status: string }>;
    }> = [];

    for (const d of domains) {
      for (const f of d.features) {
        if (!f.included) continue;
        confirmedFeatures.push({
          id: f.id,
          name: f.name,
          domain: d.id,
          domainName: d.name,
          handler: f.handler,
          actions: f.actions,
          context: f.context || d.id,
          priority: f.priority,
          scenarios: f.scenarios
            .filter((s) => s.included)
            .map((s) => ({ name: s.name, status: s.status })),
        });
      }
    }

    try {
      const res = await fetch("/api/apply-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          features: confirmedFeatures,
          runId,
          strategy,
          archiveStale: strategy === "smart" ? archiveStale : false,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error((data as { error: string }).error || "应用失败");
      }

      const data = (await res.json()) as { summary: ApplySummary };
      setApplySummary(data.summary);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  function handleApply() {
    // 全量覆盖需二次确认
    if (strategy === "overwrite" && !confirmOverwrite) {
      setConfirmOverwrite(true);
      return;
    }
    setConfirmOverwrite(false);
    doApply();
  }

  function finishApply() {
    onApplied?.();
    onOpenChange(false);
    router.refresh();
  }

  // overwrite 将丢失治理状态的项(用于二次确认列举)
  const overwriteLossItems = useMemo(() => {
    if (!diff) return [];
    const items: Array<string> = [];
    for (const fd of diff.features) {
      if (fd.kind === "added") continue;
      for (const s of fd.scenarios) {
        if (s.existing && isGoverned(s.existing)) {
          items.push(`${fd.featureId} / ${s.name} [${s.existing.status}]`);
        }
      }
    }
    return items;
  }, [diff]);

  // ---- 右侧:变更预览(git-diff 风格:绿=新增/新值,红=删除/旧值) ----
  function renderPreview() {
    if (loadingExisting) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          正在对比 DB 现有结构…
        </div>
      );
    }
    if (!diff) return null;

    const added = diff.features.filter((f) => f.kind === "added");
    const conflict = diff.features.filter((f) => f.kind === "conflict");
    const preserved = diff.features.filter((f) => f.kind === "preserved");
    const empty =
      added.length === 0 &&
      conflict.length === 0 &&
      preserved.length === 0 &&
      diff.staleFeatures.length === 0 &&
      diff.staleScenarios.length === 0;
    if (empty) {
      return <div className="text-xs text-muted-foreground">无变更(DB 与分析结果一致)</div>;
    }

    const staleAction = strategy === "overwrite" ? "删除" : archiveStale && strategy === "smart" ? "归档" : "标记";

    const base = "font-mono px-2 py-0.5 flex items-center gap-2 text-[11px] leading-relaxed";
    const addCls = `${base} bg-green-50 text-green-800 border-l-2 border-green-400`;
    const oldCls = `${base} bg-red-50/70 text-red-700 border-l-2 border-red-300`;
    const newCls = `${base} bg-green-50/70 text-green-700 border-l-2 border-green-300`;
    const govCls = `${base} bg-amber-50/60 text-amber-700 border-l-2 border-amber-300`;
    const keepCls = `${base} text-muted-foreground border-l-2 border-transparent`;
    const delCls = `${base} bg-red-50 text-red-800 border-l-2 border-red-400`;
    const delStrongCls = `${base} bg-red-100 text-red-900 border-l-2 border-red-500`;

    return (
      <div className="space-y-3 overflow-auto">
        {/* 新增 */}
        {added.length > 0 && (
          <section>
            <div className="text-xs font-semibold text-green-700 mb-1">🆕 新增 {added.length}</div>
            {added.map((f) => (
              <div key={f.featureId} className={addCls}>
                <span className="text-green-500 w-3 shrink-0">+</span>
                <span className="font-semibold w-12 shrink-0">{f.featureId}</span>
                <span className="flex-1 truncate">{f.incoming.name}</span>
                <span className="text-green-600/70 shrink-0">&lt;{f.incoming.handler || "无"}&gt;</span>
              </div>
            ))}
          </section>
        )}

        {/* 修改:git hunk(-旧 +新) + 治理影响(~) */}
        {conflict.length > 0 && (
          <section>
            <div className="text-xs font-semibold text-orange-700 mb-1">
              ✏️ 修改 {conflict.length}
              <span className="ml-1 font-normal opacity-70">
                ({strategy === "smart" ? "智能合并:保留 DB" : "全量覆盖:用新值"})
              </span>
            </div>
            {conflict.map((f) => {
              const govScn = f.scenarios.filter((s) => s.existing && s.existing.status !== "待实现");
              return (
                <div key={f.featureId} className="mb-1">
                  <div className={oldCls}>
                    <span className="text-red-400 w-3 shrink-0">-</span>
                    <span className="font-semibold w-12 shrink-0 opacity-60">{f.featureId}</span>
                    <span className="flex-1 truncate line-through">{f.existing?.name}</span>
                    <span className="opacity-50 shrink-0">&lt;{f.existing?.handler || "(空)"}&gt;</span>
                  </div>
                  <div className={newCls}>
                    <span className="text-green-500 w-3 shrink-0">+</span>
                    <span className="font-semibold w-12 shrink-0 opacity-60">{f.featureId}</span>
                    <span className="flex-1 truncate">{f.incoming.name}</span>
                    <span className="opacity-60 shrink-0">&lt;{f.incoming.handler || "(空)"}&gt;</span>
                  </div>
                  {govScn.map((s) => (
                    <div key={s.name} className={govCls}>
                      <span className="text-amber-400 w-3 shrink-0">~</span>
                      <span className="w-12 shrink-0" />
                      <span className="flex-1">
                        {s.name}: <span className="line-through opacity-60">{s.existing?.status}</span> →{" "}
                        <span className="font-semibold">
                          {strategy === "smart" ? "保留治理" : "重置待实现"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        )}

        {/* 保留治理 */}
        {preserved.length > 0 && (
          <section>
            <div className="text-xs font-semibold text-blue-700 mb-1">✅ 保留治理 {preserved.length}</div>
            {preserved.map((f) => {
              const scnInfo = f.scenarios
                .filter((s) => s.existing)
                .map((s) => `${s.name}=${s.existing?.status}`);
              return (
                <div key={f.featureId} className={keepCls}>
                  <span className="opacity-40 w-3 shrink-0">·</span>
                  <span className="font-semibold w-12 shrink-0">{f.featureId}</span>
                  <span className="flex-1 truncate">{f.incoming.name}</span>
                  <span className="opacity-70 shrink-0">{scnInfo.join(" ")}</span>
                </div>
              );
            })}
          </section>
        )}

        {/* 删除/归档:红行 -,已治理加深红 + ⚠ */}
        {(diff.staleFeatures.length > 0 || diff.staleScenarios.length > 0) && (
          <section>
            <div className="text-xs font-semibold text-red-700 mb-1">
              🗑 {staleAction} {diff.staleFeatures.length} 功能点 / {diff.staleScenarios.length} 场景
            </div>
            {diff.staleFeatures.map((f) => {
              const fGov = Object.values(f.scenarios).filter((s) => !s.archived && s.status !== "待实现");
              const plainStatus = Object.values(f.scenarios).find((s) => !s.archived)?.status;
              return (
                <div key={f.id} className={fGov.length ? delStrongCls : delCls}>
                  <span className="text-red-400 w-3 shrink-0">-</span>
                  <span className="font-semibold w-12 shrink-0">{f.id}</span>
                  <span className="flex-1 truncate line-through">{f.name}</span>
                  {fGov.length > 0 ? (
                    <span className="text-red-600 font-semibold shrink-0">⚠{fGov.map((s) => s.status).join(",")}</span>
                  ) : (
                    <span className="opacity-50 shrink-0">{plainStatus}</span>
                  )}
                </div>
              );
            })}
            {diff.staleScenarios.map((s, i) => (
              <div key={`ss-${i}`} className={s.scenario.status !== "待实现" ? delStrongCls : delCls}>
                <span className="text-red-400 w-3 shrink-0">-</span>
                <span className="font-semibold w-12 shrink-0">{s.featureId}</span>
                <span className="flex-1 truncate line-through">场景 {s.scenario.name}</span>
                <span className="shrink-0">
                  {s.scenario.status !== "待实现" ? (
                    <span className="text-red-600 font-semibold">⚠{s.scenario.status}</span>
                  ) : (
                    <span className="opacity-50">{s.scenario.status}</span>
                  )}
                </span>
              </div>
            ))}
          </section>
        )}
      </div>
    );
  }

  // ---- 差异汇总文案 ----
  const diffSummaryText = diff
    ? `新增 ${diff.summary.added} · 保留 ${diff.summary.preserved}(已治理) · 冲突 ${diff.summary.conflict}` +
      (archiveStale && strategy === "smart"
        ? ` · 将归档 ${diff.summary.staleFeatures} 功能点/${diff.summary.staleScenarios} 场景`
        : "")
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>审阅项目结构分析结果</DialogTitle>
          <DialogDescription>
            {result.domains.length} 个域 · {result.scanSummary?.totalFeatures ?? 0} 个功能点 ·{" "}
            {result.scanSummary?.totalScenes ?? 0} 个场景 · 耗时{" "}
            {((result.scanSummary?.scanDurationMs ?? 0) +
              (result.scanSummary?.classifyDurationMs ?? 0)) /
              1000}
            s
          </DialogDescription>
        </DialogHeader>

        {/* 应用摘要(apply 成功后) */}
        {applySummary && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-800">
            <div className="font-semibold mb-1">✅ 应用完成</div>
            <div>
              新增 {applySummary.addedFeatures.length} 功能点 · 保留{" "}
              {applySummary.preservedFeatures.length} · 更新{" "}
              {applySummary.updatedFeatures.length}
              {applySummary.archivedFeatures.length > 0 &&
                ` · 归档 ${applySummary.archivedFeatures.length} 功能点`}
              {applySummary.removedScenarios > 0 && ` / ${applySummary.removedScenarios} 场景`}
              {" · "}新增 {applySummary.addedScenarios} 场景
            </div>
            <Button size="sm" className="mt-2 h-7" type="button" onClick={finishApply}>
              完成
            </Button>
          </div>
        )}

        {/* 全量覆盖二次确认 */}
        {confirmOverwrite && !applySummary && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <div className="font-semibold mb-1">⚠️ 全量覆盖将丢失已治理状态</div>
            {overwriteLossItems.length > 0 ? (
              <div className="mb-2 max-h-24 overflow-auto">
                以下 {overwriteLossItems.length} 项的治理状态会被重置为「待实现」:
                <div className="mt-1 font-mono">
                  {overwriteLossItems.slice(0, 20).join("、")}
                  {overwriteLossItems.length > 20 ? " …" : ""}
                </div>
              </div>
            ) : (
              <div className="mb-2">无已治理项会被影响。</div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                className="h-7"
                type="button"
                disabled={applying}
                onClick={() => {
                  setConfirmOverwrite(false);
                  doApply();
                }}
              >
                确认覆盖(不可恢复)
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                type="button"
                onClick={() => setConfirmOverwrite(false)}
              >
                取消
              </Button>
            </div>
          </div>
        )}

        {/* 策略 + 归档 */}
        {!applySummary && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
            <span className="font-semibold text-muted-foreground">合并策略:</span>
            {(
              [
                { key: "smart", label: "智能合并", desc: "保留已治理,新增缺失" },
                { key: "add-only", label: "仅新增", desc: "只加,绝不动已有" },
                { key: "overwrite", label: "全量覆盖", desc: "重置(危险)" },
              ] as const
            ).map((opt) => (
              <label key={opt.key} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="strategy"
                  checked={strategy === opt.key}
                  onChange={() => setStrategy(opt.key)}
                  className="accent-blue-600"
                />
                <span>{opt.label}</span>
                <span className="text-muted-foreground">({opt.desc})</span>
              </label>
            ))}
            {strategy === "smart" && (
              <label className="flex items-center gap-1 cursor-pointer ml-auto">
                <input
                  type="checkbox"
                  checked={archiveStale}
                  onChange={(e) => setArchiveStale(e.target.checked)}
                  className="accent-blue-600"
                />
                <span>归档不再识别的功能点/场景</span>
              </label>
            )}
            {strategy === "overwrite" && (
              <span className="ml-auto text-red-600">⚠ 覆盖将丢失已治理状态</span>
            )}
          </div>
        )}

        <div className="flex-1 overflow-hidden grid grid-cols-2 gap-4 min-h-0">
          {/* 左侧:可编辑列表 */}
          <div className="overflow-auto space-y-3 pr-2">
            {loadingExisting && (
              <div className="text-xs text-muted-foreground">正在对比 DB 现有结构…</div>
            )}
            {domains.map((d, di) => (
              <div key={d.id} className="rounded-md border border-border">
                {/* 域头 */}
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30"
                  onClick={() => toggleDomain(di)}
                >
                  <span className="text-xs">{d.expanded ? "▼" : "▶"}</span>
                  <span className="text-sm font-semibold">{d.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {d.id} · {d.features.filter((f) => f.included).length}/{d.features.length} 功能点
                  </span>
                </button>

                {d.expanded && (
                  <div className="border-t border-border px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">域名:</span>
                      <input
                        className={inputCls}
                        value={d.name}
                        onChange={(e) => updateDomainName(di, e.target.value)}
                      />
                    </div>

                    {d.features.map((f, fi) => {
                      const fd = featureDiffMap.get(f.id);
                      return (
                        <div
                          key={f.id}
                          className={`rounded border ${
                            f.included ? "border-border" : "border-border/40 opacity-50"
                          }`}
                        >
                          {/* 功能点头 */}
                          <div className="flex items-center gap-2 px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={f.included}
                              onChange={() => toggleFeature(di, fi)}
                              className="accent-blue-600"
                            />
                            <button
                              type="button"
                              className="font-mono text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => expandFeature(di, fi)}
                            >
                              {f.expanded ? "▼" : "▶"}
                            </button>
                            {fd && <DiffMark kind={fd.kind} />}
                            <span className="font-mono text-xs font-semibold">{f.id}</span>
                            <input
                              className={`${inputCls} flex-1`}
                              value={f.name}
                              onChange={(e) => updateFeatureField(di, fi, "name", e.target.value)}
                              disabled={!f.included}
                            />
                          </div>

                          {/* 功能点展开详情 */}
                          {f.expanded && f.included && (
                            <div className="border-t border-border/50 px-3 py-2 space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] text-muted-foreground">
                                    Handler
                                  </label>
                                  <input
                                    className={inputCls}
                                    value={f.handler}
                                    onChange={(e) =>
                                      updateFeatureField(di, fi, "handler", e.target.value)
                                    }
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] text-muted-foreground">
                                    Actions (逗号分隔)
                                  </label>
                                  <input
                                    className={inputCls}
                                    value={f.actions.join(", ")}
                                    onChange={(e) =>
                                      updateFeatureField(
                                        di,
                                        fi,
                                        "actions" as keyof EditableFeature,
                                        e.target.value,
                                      )
                                    }
                                    onBlur={() => {
                                      setDomains((prev) =>
                                        prev.map((d2, i2) =>
                                          i2 === di
                                            ? {
                                                ...d2,
                                                features: d2.features.map((f2, j2) =>
                                                  j2 === fi
                                                    ? {
                                                        ...f2,
                                                        actions:
                                                          typeof f2.actions === "string"
                                                            ? (f2.actions as unknown as string)
                                                                .split(",")
                                                                .map((a) => a.trim())
                                                                .filter(Boolean)
                                                            : f2.actions,
                                                      }
                                                    : f2,
                                                ),
                                              }
                                            : d2,
                                        ),
                                      );
                                    }}
                                  />
                                </div>
                              </div>

                              {/* 场景列表 */}
                              <div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-semibold text-muted-foreground">
                                    场景
                                    {f.scenarios.length > 5 && (
                                      <span className="ml-1 text-yellow-600 font-normal">
                                        ⚠ {f.scenarios.length} 个
                                      </span>
                                    )}
                                  </span>
                                  <button
                                    type="button"
                                    className="text-[10px] text-blue-600 hover:underline"
                                    onClick={() => addScenario(di, fi)}
                                  >
                                    + 添加场景
                                  </button>
                                </div>
                                <div className="mt-1 space-y-1">
                                  {f.scenarios.map((s, si) => {
                                    const scnDiff = fd?.scenarios.find((x) => x.name === s.name);
                                    return (
                                      <div
                                        key={`${s.name}-${si}`}
                                        className={`flex items-center gap-1.5 rounded px-2 py-1 ${
                                          s.confidence === "low"
                                            ? "border border-dashed border-yellow-300 bg-yellow-50/50"
                                            : ""
                                        } ${!s.included ? "opacity-40" : ""}`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={s.included}
                                          onChange={() => toggleScenario(di, fi, si)}
                                          className="accent-blue-600"
                                        />
                                        {scnDiff && <DiffMark kind={scnDiff.kind} />}
                                        {scnDiff?.existing && (
                                          <span
                                            className="shrink-0 text-[10px] text-muted-foreground"
                                            title="DB 现有治理状态"
                                          >
                                            [{scnDiff.existing.status}]
                                          </span>
                                        )}
                                        <input
                                          className={`${inputCls} flex-1`}
                                          value={s.name}
                                          onChange={(e) =>
                                            updateScenarioName(di, fi, si, e.target.value)
                                          }
                                          disabled={!s.included}
                                        />
                                        {s.branchHint && (
                                          <span className="shrink-0 text-[10px] text-muted-foreground font-mono">
                                            {s.branchHint}
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          className="shrink-0 text-[10px] text-red-400 hover:text-red-600"
                                          onClick={() => removeScenario(di, fi, si)}
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {/* stale 变更已并入右侧「变更预览」的删除区 */}
          </div>

          {/* 右侧:矩阵预览 */}
          <div className="overflow-auto rounded-md border border-border bg-muted/20 p-3">
            <h3 className="mb-3 text-xs font-semibold text-muted-foreground">变更预览 · 应用后将发生</h3>
            {renderPreview()}
          </div>
        </div>

        {/* 错误 */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {applySummary
              ? "应用完成,点「完成」关闭"
              : diffSummaryText || `将导入 ${stats.featureCount} 功能点 / ${stats.scenarioCount} 场景`}
          </span>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="outline" type="button" disabled={applying}>
                {applySummary ? "关闭" : "取消"}
              </Button>
            </DialogClose>
            {!applySummary && (
              <Button
                type="button"
                disabled={applying || stats.featureCount === 0}
                onClick={handleApply}
              >
                {applying
                  ? "应用中..."
                  : strategy === "overwrite"
                    ? "⚠ 全量覆盖"
                    : strategy === "add-only"
                      ? "仅新增应用"
                      : "智能合并应用"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
