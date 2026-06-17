import { notFound } from "next/navigation";
import { getFeature, getDomainOfFeature, type Feature, type Domain } from "@/lib/matrix";
import { listContractsForFeature, listRunsForFeature, cellId as makeCellId } from "@helmflow/storage";
import { getDb } from "@/lib/db";
import { FeaturePageClient } from "@/components/feature-detail-client";

interface FeaturePageProps {
  params: Promise<{ id: string }>;
}

/** 传给 client 的契约概览(每 scenario 最新契约状态) */
export interface ContractOverviewItem {
  scenarioName: string;
  cellId: string;
  contractId: string | null;
  status: string | null; // draft/approved/done/... null=无契约
}

/** 传给 client 的开发活动(最近 run) */
export interface ActivityItem {
  runId: string;
  cellId: string;
  scenarioName: string;
  kind: string;
  state: string;
  startedAt: string;
}

export interface FeaturePageData {
  feature: Feature;
  domain: Domain | undefined;
  contractsByScenario: ContractOverviewItem[];
  recentActivities: ActivityItem[];
}

export default async function FeaturePage({ params }: FeaturePageProps) {
  const { id } = await params;
  const feature = getFeature(id);
  if (!feature) {
    return notFound();
  }
  const domain = getDomainOfFeature(id);
  const db = getDb();

  // 契约概览:每 scenario 最新契约状态。allContracts 已 ORDER BY createdAt DESC,
  // 每个 cellId 第一次出现即为最新,无需二次 find。
  const allContracts = listContractsForFeature(db, id);
  const latestContractByCell = new Map<string, { id: string; status: string }>();
  for (const c of allContracts) {
    if (!latestContractByCell.has(c.cellId)) {
      latestContractByCell.set(c.cellId, { id: c.id, status: c.status });
    }
  }
  const contractsByScenario: ContractOverviewItem[] = feature.scenarios.map((s) => {
    const cid = makeCellId(id, s.name);
    const latest = latestContractByCell.get(cid);
    return {
      scenarioName: s.name,
      cellId: cid,
      contractId: latest?.id ?? null,
      status: latest?.status ?? null,
    };
  });

  // 开发活动:最近 runs(聚合多 cell)
  const recentRuns = listRunsForFeature(db, id, 15);
  const scenarioByCell = new Map(feature.scenarios.map((s) => [makeCellId(id, s.name), s.name]));
  const recentActivities: ActivityItem[] = recentRuns.map((r) => ({
    runId: r.id,
    cellId: r.cellId,
    scenarioName: scenarioByCell.get(r.cellId) ?? r.cellId,
    kind: r.kind,
    state: r.state,
    startedAt: r.startedAt,
  }));

  const data: FeaturePageData = { feature, domain, contractsByScenario, recentActivities };
  return <FeaturePageClient data={data} />;
}
