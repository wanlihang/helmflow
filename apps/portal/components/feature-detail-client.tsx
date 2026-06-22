"use client";

import type { ActivityItem, ContractOverviewItem } from "@/app/features/[id]/page";
import { AddScenarioDialog } from "@/components/add-scenario-dialog";
import { EditFeatureDialog } from "@/components/edit-feature-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import type { Domain, Feature, FeatureStatus } from "@/lib/matrix";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface FeaturePageData {
  feature: Feature;
  domain: Domain | undefined;
  contractsByScenario: ContractOverviewItem[];
  recentActivities: ActivityItem[];
}

const priorityClasses: Record<string, string> = {
  P0: "bg-red-100 text-red-700 border border-red-200",
  P1: "bg-yellow-100 text-yellow-700 border border-yellow-200",
  P2: "bg-gray-100 text-gray-700 border border-gray-200",
};

const AGENT_STATUS_LABEL: Record<FeatureStatus, string> = {
  "not-started": "未启动",
  clarifying: "澄清中",
  "pending-goal": "待 goal",
  implementing: "实施中",
  "tests-pending": "测试待跑",
  "qa-passed": "QA 通过",
  done: "已完成",
  blocked: "受阻",
  abandoned: "已放弃",
};

const CONTRACT_STATUS_BADGE: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  done: "bg-green-100 text-green-700",
  "goal-running": "bg-blue-100 text-blue-700",
  blocked: "bg-red-100 text-red-700",
};

const ACTIVITY_STATE_BADGE: Record<string, string> = {
  running: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  applied: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

const KIND_LABEL: Record<string, string> = {
  require: "需求澄清",
  code: "代码实现",
  test: "测试",
  deploy: "上线",
  analyze: "状态分析",
  "contract-sync": "契约同步",
  verify: "验证",
};

export function FeaturePageClient({ data }: { data: FeaturePageData }) {
  const router = useRouter();
  const { feature, domain, contractsByScenario, recentActivities } = data;
  const [editOpen, setEditOpen] = useState(false);
  const [addScenarioOpen, setAddScenarioOpen] = useState(false);

  const hasImplementation = !!(
    feature.implementation.decider ||
    feature.implementation.acceptor ||
    feature.implementation.handler ||
    feature.implementation.actions.length > 0 ||
    feature.implementation.context
  );

  async function handleArchive() {
    if (!window.confirm(`确认归档功能 "${feature.id}"？归档后首页不再显示。`)) return;
    const res = await fetch(`/api/features/${feature.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error ?? "归档失败");
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
      const d = await res.json();
      alert(d.error ?? "删除失败");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* 面包屑 */}
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span>{domain?.name ?? "未分类"}</span>
        <span className="mx-2">/</span>
        <span className="font-mono text-foreground">{feature.id}</span>
      </nav>

      {/* header */}
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
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${priorityClasses[feature.priority] ?? priorityClasses.P2}`}
          >
            {feature.priority}
          </span>
        </div>
      </header>

      {/* 分层架构归属(分析产出:Decider/Acceptor/Handler/Action) */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold text-muted-foreground">分层架构归属</h2>
        {hasImplementation ? (
          <div className="flex flex-wrap items-start gap-x-5 gap-y-2 text-xs">
            {feature.implementation.decider && (
              <div className="flex items-center gap-2">
                <span className="rounded bg-green-100 px-1.5 py-0.5 font-mono font-semibold text-green-700">
                  Decider
                </span>
                <span className="font-mono text-foreground">{feature.implementation.decider}</span>
              </div>
            )}
            {feature.implementation.acceptor && (
              <div className="flex items-center gap-2">
                <span className="rounded bg-teal-100 px-1.5 py-0.5 font-mono font-semibold text-teal-700">
                  Acceptor
                </span>
                <span className="font-mono text-foreground">{feature.implementation.acceptor}</span>
              </div>
            )}
            {feature.implementation.handler && (
              <div className="flex items-center gap-2">
                <span className="rounded bg-blue-100 px-1.5 py-0.5 font-mono font-semibold text-blue-700">
                  Handler
                </span>
                <span className="font-mono text-foreground">{feature.implementation.handler}</span>
              </div>
            )}
            {feature.implementation.actions.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="rounded bg-purple-100 px-1.5 py-0.5 font-mono font-semibold text-purple-700">
                  Actions
                </span>
                <span className="font-mono text-foreground">
                  {feature.implementation.actions.join(", ")}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            待分析 — 需求澄清或扫码分析后将产出分层归属
          </div>
        )}
      </section>

      {/* 场景列表(含契约列 + 合并状态) */}
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
                <th className="px-3 py-2 text-left font-semibold">状态</th>
                <th className="px-3 py-2 text-center font-semibold">契约</th>
                <th className="px-3 py-2 text-left font-semibold">备注</th>
                <th className="px-3 py-2 text-center font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {feature.scenarios.map((s) => {
                const contract = contractsByScenario.find((c) => c.scenarioName === s.name);
                return (
                  <tr key={s.name} className="border-b border-border">
                    <td className="px-3 py-2">
                      <Link
                        href={`/features/${feature.id}/${encodeURIComponent(s.name)}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {s.name}
                      </Link>
                    </td>
                    {/* 合并状态:主 Badge(业务/治理状态) + 小字 agentStatus */}
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-0.5">
                        <Badge scenario={s.status} />
                        {s.agentStatus !== "not-started" && (
                          <span className="text-[10px] text-muted-foreground">
                            {AGENT_STATUS_LABEL[s.agentStatus] ?? s.agentStatus}
                          </span>
                        )}
                      </div>
                    </td>
                    {/* 契约列 */}
                    <td className="px-3 py-2 text-center">
                      {contract?.status ? (
                        <Link
                          href={`/features/${feature.id}/${encodeURIComponent(s.name)}`}
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold hover:opacity-80 ${CONTRACT_STATUS_BADGE[contract.status] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          {contract.status}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 开发活动概览(聚合该 feature 各 cell 最近 run) */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">开发活动</h2>
        {recentActivities.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            暂无开发活动记录。触发需求/分析/代码节点后,这里会显示该功能点的最近运行。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-3 py-2 text-left font-semibold">状态</th>
                  <th className="px-3 py-2 text-left font-semibold">类型</th>
                  <th className="px-3 py-2 text-left font-semibold">场景</th>
                  <th className="px-3 py-2 text-left font-semibold">时间</th>
                  <th className="px-3 py-2 text-left font-semibold">runId</th>
                </tr>
              </thead>
              <tbody>
                {recentActivities.map((a) => (
                  <tr key={a.runId} className="border-b border-border hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 font-semibold ${ACTIVITY_STATE_BADGE[a.state] ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {a.state === "running" && (
                          <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                        )}
                        {a.state}
                      </span>
                    </td>
                    <td className="px-3 py-2">{KIND_LABEL[a.kind] ?? a.kind}</td>
                    <td className="px-3 py-2 font-mono">{a.scenarioName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{timeAgo(a.startedAt)}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/runs/${a.runId}`}
                        className="font-mono text-blue-600 hover:underline"
                      >
                        {a.runId.slice(0, 16)}…
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <EditFeatureDialog open={editOpen} onOpenChange={setEditOpen} feature={feature} />
      <AddScenarioDialog
        open={addScenarioOpen}
        onOpenChange={setAddScenarioOpen}
        featureId={feature.id}
      />
    </div>
  );
}
