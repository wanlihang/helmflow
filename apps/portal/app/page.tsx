import { DomainSection } from "@/components/domain-section";
import { Badge } from "@/components/ui/badge";
import { loadMatrix, getTotalFeatureCount, type FeatureStatus } from "@/lib/matrix";

const STATUS_LEGEND: FeatureStatus[] = [
  "not-started",
  "clarifying",
  "pending-goal",
  "implementing",
  "done",
  "blocked",
  "abandoned",
];

export default function HomePage() {
  const matrix = loadMatrix();
  const totalFeatures = getTotalFeatureCount();

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="font-mono">{matrix.project}</span>
          </h1>
          <p className="mt-1 text-muted-foreground">
            {matrix.description ?? "Full-Loop AI Coding Platform"} ·{" "}
            <span className="font-semibold">
              {matrix.domains.length} 域 {totalFeatures} 功能点
            </span>
          </p>
        </div>

        <div className="rounded-md border border-border bg-muted/40 p-3">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">状态图例</div>
          <div className="flex flex-wrap gap-2">
            {STATUS_LEGEND.map((s) => (
              <Badge key={s} status={s} />
            ))}
          </div>
        </div>
      </section>

      <div className="space-y-10">
        {matrix.domains.map((domain) => (
          <DomainSection key={domain.id} domain={domain} />
        ))}
      </div>
    </div>
  );
}
