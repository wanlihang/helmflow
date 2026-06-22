import { AnalyzeAllButton } from "@/components/analyze-all-button";
import { AnalyzeStructureButton } from "@/components/analyze-structure-button";
import { EmptyMatrixGuide } from "@/components/empty-matrix-guide";
import { FeatureMatrixTable } from "@/components/feature-matrix-table";
import { getAllScenarioNames, getTotalFeatureCount, loadMatrix } from "@/lib/matrix";
import { getCurrentProjectId } from "@/lib/project";

interface FusedStats {
  completed: number;
  inProgress: number;
  notStarted: number;
  blocked: number;
  deprecated: number;
}

function computeFusedStats(matrix: ReturnType<typeof loadMatrix>): FusedStats {
  const stats: FusedStats = {
    completed: 0,
    inProgress: 0,
    notStarted: 0,
    blocked: 0,
    deprecated: 0,
  };
  for (const d of matrix.domains) {
    for (const f of d.features) {
      for (const s of f.scenarios) {
        if (s.status === "废弃") {
          stats.deprecated++;
        } else if (s.status === "已支持") {
          stats.completed++;
        } else if (s.agentStatus === "blocked") {
          stats.blocked++;
        } else if (s.agentStatus === "not-started") {
          stats.notStarted++;
        } else {
          stats.inProgress++;
        }
      }
    }
  }
  return stats;
}

export default async function HomePage() {
  const projectId = await getCurrentProjectId();
  const matrix = loadMatrix(projectId);
  const totalFeatures = getTotalFeatureCount(projectId);
  const scenarioNames = getAllScenarioNames(projectId);
  const stats = computeFusedStats(matrix);

  const isEmpty = matrix.domains.length === 0;

  return (
    <div className="space-y-8">
      {isEmpty ? (
        <EmptyMatrixGuide projectId={projectId} />
      ) : (
        <>
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">
                  <span className="font-mono">{matrix.project}</span>
                </h1>
                <p className="mt-1 text-sm text-muted-foreground font-mono">
                  📁 {matrix.sandboxPath ?? "未配置项目路径"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {matrix.description ?? "Full-Loop AI Coding Platform"} ·{" "}
                  <span className="font-semibold">
                    {matrix.domains.length} 域 {totalFeatures} 功能点
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <AnalyzeStructureButton projectId={projectId} />
                <AnalyzeAllButton />
              </div>
            </div>

            <div className="rounded-md border border-border bg-muted/40 p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">进度图例</div>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-green-500" />
                  <span className="text-xs">已完成</span>
                  <span className="text-xs text-muted-foreground">({stats.completed})</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-blue-500" />
                  <span className="text-xs">进行中</span>
                  <span className="text-xs text-muted-foreground">({stats.inProgress})</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-gray-300" />
                  <span className="text-xs">待开始</span>
                  <span className="text-xs text-muted-foreground">({stats.notStarted})</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-red-500" />
                  <span className="text-xs">受阻</span>
                  <span className="text-xs text-muted-foreground">({stats.blocked})</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-red-200" />
                  <span className="text-xs">废弃</span>
                  <span className="text-xs text-muted-foreground">({stats.deprecated})</span>
                </div>
              </div>
            </div>
          </section>

          <div className="space-y-10">
            {matrix.domains.map((domain) => (
              <FeatureMatrixTable
                key={domain.id}
                domain={domain}
                scenarioNames={scenarioNames}
                projectId={projectId}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
