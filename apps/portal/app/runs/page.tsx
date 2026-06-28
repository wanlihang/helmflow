import { PageHeader } from "@/components/page-header";
import { QueuePanel } from "@/components/queue-panel";
import { RunsPanel } from "@/components/runs-panel";
import { getDb } from "@/lib/db";
import { cleanupStaleRuns, getRunsLastActivity, listRecentRuns } from "@helmflow/storage";

export const dynamic = "force-dynamic";

interface RunItem {
  id: string;
  cellId: string;
  kind: string;
  state: string;
  startedAt: string;
  finishedAt: string | null;
  lastActivity: string;
}

export default async function RunsPage() {
  const db = getDb();
  // 入口清理卡死的 run(基于最后活动)
  cleanupStaleRuns(db, 5 * 60 * 1000);

  const rows = listRecentRuns(db, 30);
  const activityMap = getRunsLastActivity(
    db,
    rows.map((r) => r.id),
  );
  const initial: RunItem[] = rows.map((r) => ({
    id: r.id,
    cellId: r.cellId,
    kind: r.kind,
    state: r.state,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    lastActivity: activityMap[r.id] ?? r.startedAt,
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="运行中心"
        description="队列调度与最近运行。卡死的 run 入口自动清理(基于最后活动 5min)。"
      />
      <QueuePanel />
      <RunsPanel initialRuns={initial} />
    </div>
  );
}
