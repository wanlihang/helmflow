"use client";

import { Badge } from "@/components/ui/badge";
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
import type { StructureAnalysisResult } from "@/lib/structure-analyzer";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

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

interface StructureReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  result,
  projectId,
  runId,
}: StructureReviewDialogProps) {
  const router = useRouter();
  const [domains, setDomains] = useState<EditableDomain[]>(() => toEditableState(result));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  // ---- 统计 ----
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

  // ---- 收集所有场景名（用于右侧预览） ----
  const allScenarioNames = useMemo(() => {
    const names = new Set<string>();
    for (const d of domains) {
      for (const f of d.features) {
        if (!f.included) continue;
        for (const s of f.scenarios) {
          if (s.included) names.add(s.name);
        }
      }
    }
    return Array.from(names);
  }, [domains]);

  // ---- 确认应用 ----
  async function handleApply() {
    setApplying(true);
    setError("");

    // 收集确认后的结构
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
        body: JSON.stringify({ projectId, features: confirmedFeatures, runId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error((data as { error: string }).error || "应用失败");
      }

      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  // ---- 右侧预览 ----
  function renderPreview() {
    const includedDomains = domains.filter((d) => d.features.some((f) => f.included));

    if (includedDomains.length === 0) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          请勾选至少一个功能点
        </div>
      );
    }

    return (
      <div className="space-y-6 overflow-auto">
        {includedDomains.map((d) => (
          <div key={d.id}>
            <div className="mb-2 text-xs font-semibold text-muted-foreground">
              {d.name} ({d.id})
            </div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-2 py-1 text-left">ID</th>
                  <th className="px-2 py-1 text-left">功能</th>
                  {allScenarioNames.map((name) => (
                    <th key={name} className="px-2 py-1 text-center">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.features
                  .filter((f) => f.included)
                  .map((f) => (
                    <tr key={f.id} className="border-b border-border hover:bg-muted/30">
                      <td className="px-2 py-1 font-mono text-muted-foreground">{f.id}</td>
                      <td className="px-2 py-1">{f.name}</td>
                      {allScenarioNames.map((sn) => {
                        const sc = f.scenarios.find((s) => s.name === sn && s.included);
                        return (
                          <td key={sn} className="px-2 py-1 text-center">
                            {sc ? (
                              <Badge scenario="待实现" />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>审阅项目结构分析结果</DialogTitle>
          <DialogDescription>
            {result.scanSummary?.totalHandlers ?? 0} 个 Handler ·{" "}
            {result.scanSummary?.totalActions ?? 0} 个 Action · {result.domains.length} 个域 · 耗时{" "}
            {((result.scanSummary?.scanDurationMs ?? 0) +
              (result.scanSummary?.classifyDurationMs ?? 0)) /
              1000}
            s
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden grid grid-cols-2 gap-4 min-h-0">
          {/* 左侧：可编辑列表 */}
          <div className="overflow-auto space-y-3 pr-2">
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
                    {d.id} · {d.features.filter((f) => f.included).length}/{d.features.length}{" "}
                    功能点
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

                    {d.features.map((f, fi) => (
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
                                <label className="text-[10px] text-muted-foreground">Handler</label>
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
                                    // actions 是数组，这里需要特殊处理
                                    // 已通过 updateFeatureField 写入字符串，再修正为数组
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
                                  {f.scenarios.length > 3 && (
                                    <span className="ml-1 text-yellow-600 font-normal">
                                      ⚠ {f.scenarios.length} 个（建议 ≤3，仅保留业务维度）
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
                                {f.scenarios.map((s, si) => (
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
                                    <input
                                      className={`${inputCls} flex-1`}
                                      value={s.name}
                                      onChange={(e) =>
                                        updateScenarioName(di, fi, si, e.target.value)
                                      }
                                      disabled={!s.included}
                                    />
                                    {s.confidence === "low" && (
                                      <span className="shrink-0 text-[10px] text-yellow-600">
                                        (低置信度)
                                      </span>
                                    )}
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
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 右侧：矩阵预览 */}
          <div className="overflow-auto rounded-md border border-border bg-muted/20 p-3">
            <h3 className="mb-3 text-xs font-semibold text-muted-foreground">矩阵预览</h3>
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
            将导入 {stats.domainCount} 域 / {stats.featureCount} 功能点 / {stats.scenarioCount} 场景
          </span>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="outline" type="button" disabled={applying}>
                取消
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={applying || stats.featureCount === 0}
              onClick={handleApply}
            >
              {applying ? "应用中..." : "确认应用"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
