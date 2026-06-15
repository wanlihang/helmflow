"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { AddFeatureDialog } from "@/components/add-feature-dialog";
import type { Domain, Scenario, ScenarioStatus, FeatureStatus } from "@/lib/matrix";

interface FeatureMatrixTableProps {
  domain: Domain;
  scenarioNames: string[];
  projectId: string;
}

function getFusedBadge(scenario: Scenario): { type: "scenario"; value: ScenarioStatus } | { type: "agent"; value: FeatureStatus } {
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
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">ID</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">功能</th>
              {scenarioNames.map((name) => (
                <th key={name} className="whitespace-nowrap px-3 py-2 text-center font-semibold">
                  {name}
                </th>
              ))}
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
                <td className="whitespace-nowrap px-3 py-2">
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
                        onClick={() => router.push(`/features/${feature.id}/${encodeURIComponent(scenarioName)}`)}
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
    </section>
  );
}
