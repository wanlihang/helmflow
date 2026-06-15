"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditFeatureDialog } from "@/components/edit-feature-dialog";
import { AddScenarioDialog } from "@/components/add-scenario-dialog";
import type { Feature, Domain } from "@/lib/matrix";

interface FeaturePageClientProps {
  feature: Feature;
  domain: Domain | undefined;
}

const priorityClasses: Record<string, string> = {
  P0: "bg-red-100 text-red-700 border border-red-200",
  P1: "bg-yellow-100 text-yellow-700 border border-yellow-200",
  P2: "bg-gray-100 text-gray-700 border border-gray-200",
};

export function FeaturePageClient({ feature, domain }: FeaturePageClientProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [addScenarioOpen, setAddScenarioOpen] = useState(false);

  const hasLegacy = !!(feature.legacy.flowCode || feature.legacy.activities.length > 0);
  const hasTarget = !!(feature.target.handler || feature.target.actions.length > 0 || feature.target.context);

  async function handleArchive() {
    if (!window.confirm(`确认归档功能 "${feature.id}"？归档后首页不再显示。`)) return;
    const res = await fetch(`/api/features/${feature.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error ?? "归档失败");
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function handleDeleteScenario(scenarioName: string) {
    if (!window.confirm(`确认删除场景 "${scenarioName}"？此操作不可撤销。`)) return;
    const res = await fetch(
      `/api/features/${feature.id}/scenarios/${encodeURIComponent(scenarioName)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const data = await res.json();
      alert(data.error ?? "删除失败");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span>{domain?.name ?? "未分类"}</span>
        <span className="mx-2">/</span>
        <span className="font-mono text-foreground">{feature.id}</span>
      </nav>

      <header className="space-y-3 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="font-mono text-muted-foreground">{feature.id}</span>{" "}
            <span>{feature.name}</span>
          </h1>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            编辑
          </Button>
          <Button variant="outline" size="sm" onClick={handleArchive}>
            归档
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
              priorityClasses[feature.priority] ?? priorityClasses.P2
            }`}
          >
            {feature.priority}
          </span>
          {feature.target.handler && (
            <span className="font-mono text-xs text-muted-foreground">
              → {feature.target.handler}
            </span>
          )}
        </div>
      </header>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">场景列表</h2>
          <button
            type="button"
            className="text-sm text-blue-600 hover:underline cursor-pointer"
            onClick={() => setAddScenarioOpen(true)}
          >
            + 添加场景
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-3 py-2 text-left font-semibold">场景</th>
                <th className="px-3 py-2 text-center font-semibold">业务状态</th>
                <th className="px-3 py-2 text-center font-semibold">开发状态</th>
                <th className="px-3 py-2 text-left font-semibold">备注</th>
                <th className="px-3 py-2 text-center font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {feature.scenarios.map((s) => (
                <tr key={s.name} className="border-b border-border">
                  <td className="px-3 py-2">
                    <Link
                      href={`/features/${feature.id}/${encodeURIComponent(s.name)}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Badge scenario={s.status} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Badge status={s.agentStatus} />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{s.note}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline cursor-pointer"
                      onClick={() => handleDeleteScenario(s.name)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 只有当 Legacy 或 Target 有实质内容时才展示元数据区块 */}
      {hasLegacy && hasTarget && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {hasLegacy && (
            <div className="space-y-2">
              <h2 className="text-base font-semibold">Legacy</h2>
              <pre className="rounded-md border border-border bg-muted p-3 text-xs whitespace-pre-wrap">
                {JSON.stringify({ flowCode: feature.legacy.flowCode, activities: feature.legacy.activities }, null, 2)}
              </pre>
            </div>
          )}
          {hasTarget && (
            <div className="space-y-2">
              <h2 className="text-base font-semibold">Target</h2>
              <pre className="rounded-md border border-border bg-muted p-3 text-xs whitespace-pre-wrap">
                {JSON.stringify({ handler: feature.target.handler, actions: feature.target.actions, context: feature.target.context }, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}
      {/* 提示：可通过「编辑」按钮补充 Legacy/Target 元数据 */}
      {!hasLegacy && !hasTarget && (
        <section className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          暂无 Legacy / Target 元数据，点击「编辑」按钮补充
        </section>
      )}

      <EditFeatureDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        feature={feature}
      />
      <AddScenarioDialog
        open={addScenarioOpen}
        onOpenChange={setAddScenarioOpen}
        featureId={feature.id}
      />
    </div>
  );
}
