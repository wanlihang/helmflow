"use client";

import { AddFeatureDialog } from "@/components/add-feature-dialog";
import { EditFeatureDialog } from "@/components/edit-feature-dialog";
import { Badge } from "@/components/ui/badge";
import type { Domain, Feature, FeatureStatus, Scenario, ScenarioStatus } from "@/lib/matrix";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface FeatureMatrixTableProps {
  domain: Domain;
  scenarioNames: string[];
  projectId: string;
}

function getFusedBadge(
  scenario: Scenario,
): { type: "scenario"; value: ScenarioStatus } | { type: "agent"; value: FeatureStatus } {
  if (scenario.status === "已支持" || scenario.status === "废弃") {
    return { type: "scenario", value: scenario.status };
  }
  if (scenario.agentStatus === "not-started") {
    return { type: "scenario", value: scenario.status };
  }
  if (scenario.agentStatus === "blocked") {
    return { type: "agent", value: "blocked" };
  }
  return { type: "agent", value: scenario.agentStatus };
}

export function FeatureMatrixTable({ domain, scenarioNames, projectId }: FeatureMatrixTableProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editFeature, setEditFeature] = useState<Feature | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(feature: Feature): Promise<void> {
    setMenuOpenId(null);
    if (
      !window.confirm(
        `确认删除功能「${feature.name}」(${feature.id})？\n删除后首页不再显示(软删除,保留历史运行记录)。`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/features/${feature.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error ?? "删除失败");
        return;
      }
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3 border-b border-border pb-2">
        <h2 className="text-xl font-bold tracking-tight">{domain.name}</h2>
        <span className="font-mono text-sm text-muted-foreground">
          {domain.id} · {domain.features.length} 个功能点
        </span>
        <button
          type="button"
          className="ml-auto text-sm text-blue-600 hover:underline cursor-pointer"
          onClick={() => setAddOpen(true)}
        >
          + 添加功能
        </button>
      </div>
      <div className="overflow-x-auto">
        {/* table-fixed + w-full:ID/功能列固定窄宽,场景列等分剩余空间撑满容器,消除最后一列右侧空白;所有域同列数同容器,列位严格对齐 */}
        <table className="table-fixed w-full border-collapse text-sm">
          <colgroup>
            <col className="w-20" />
            <col className="w-44" />
            {scenarioNames.map((name) => (
              <col key={name} />
            ))}
            <col className="w-12" />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">ID</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">功能</th>
              {scenarioNames.map((name) => (
                <th key={name} className="whitespace-nowrap px-3 py-2 text-center font-semibold">
                  {name}
                </th>
              ))}
              <th className="whitespace-nowrap px-2 py-2 text-center font-semibold"> </th>
            </tr>
          </thead>
          <tbody>
            {domain.features.map((feature) => (
              <tr key={feature.id} className="border-b border-border hover:bg-muted/30">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">
                  <button
                    type="button"
                    className="hover:text-foreground hover:underline cursor-pointer"
                    onClick={() => router.push(`/features/${feature.id}`)}
                  >
                    {feature.id}
                  </button>
                </td>
                <td className="truncate px-3 py-2" title={feature.name}>
                  <button
                    type="button"
                    className="text-left hover:text-blue-600 hover:underline cursor-pointer"
                    onClick={() => router.push(`/features/${feature.id}`)}
                  >
                    {feature.name}
                  </button>
                </td>
                {scenarioNames.map((scenarioName) => {
                  const scenario = feature.scenarios.find((s) => s.name === scenarioName);
                  if (!scenario) {
                    return (
                      <td key={scenarioName} className="px-3 py-2 text-center">
                        <span className="text-muted-foreground">—</span>
                      </td>
                    );
                  }
                  const fused = getFusedBadge(scenario);
                  return (
                    <td key={scenarioName} className="px-3 py-2 text-center">
                      <button
                        type="button"
                        className="cursor-pointer transition-opacity hover:opacity-70"
                        onClick={() =>
                          router.push(`/features/${feature.id}/${encodeURIComponent(scenarioName)}`)
                        }
                      >
                        {fused.type === "scenario" ? (
                          <Badge scenario={fused.value} />
                        ) : (
                          <Badge status={fused.value} />
                        )}
                      </button>
                    </td>
                  );
                })}
                {/* 行操作 ⋯ 菜单(编辑 / 删除) */}
                <td className="relative px-2 py-2 text-center">
                  <button
                    type="button"
                    disabled={deleting}
                    className="rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    onClick={() => setMenuOpenId((cur) => (cur === feature.id ? null : feature.id))}
                  >
                    ⋯
                  </button>
                  {menuOpenId === feature.id && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        aria-hidden
                        onClick={() => setMenuOpenId(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setMenuOpenId(null);
                        }}
                      />
                      <div className="absolute right-2 top-full z-50 mt-1 w-24 rounded-md border border-border bg-card py-1 text-xs shadow-lg">
                        <button
                          type="button"
                          className="block w-full px-3 py-1.5 text-left hover:bg-muted"
                          onClick={() => {
                            setMenuOpenId(null);
                            setEditFeature(feature);
                          }}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-muted"
                          onClick={() => handleDelete(feature)}
                        >
                          删除
                        </button>
                      </div>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AddFeatureDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultDomain={domain.id}
        projectId={projectId}
      />

      {/* 行内编辑(与详情页共用 EditFeatureDialog) */}
      {editFeature && (
        <EditFeatureDialog
          open={true}
          onOpenChange={(next) => {
            if (!next) setEditFeature(null);
          }}
          feature={editFeature}
        />
      )}
    </section>
  );
}
