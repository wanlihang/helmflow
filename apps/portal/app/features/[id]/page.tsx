import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonBlock } from "@/components/json-block";
import { StartFeatureDialog } from "@/components/start-feature-dialog";
import { Badge } from "@/components/ui/badge";
import { getDomainOfFeature, getFeature } from "@/lib/matrix";

interface FeaturePageProps {
  params: Promise<{ id: string }>;
}

const priorityClasses: Record<string, string> = {
  P0: "bg-red-100 text-red-700 border border-red-200",
  P1: "bg-yellow-100 text-yellow-700 border border-yellow-200",
  P2: "bg-gray-100 text-gray-700 border border-gray-200",
};

export default async function FeaturePage({ params }: FeaturePageProps) {
  const { id } = await params;
  const feature = getFeature(id);
  if (!feature) {
    notFound();
  }

  const domain = getDomainOfFeature(id);

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
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="font-mono text-muted-foreground">{feature.id}</span>{" "}
          <span>{feature.name}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge status={feature.status} />
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

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold">Legacy</h2>
            <span className="font-mono text-xs text-muted-foreground">flow + activities</span>
          </div>
          <JsonBlock
            data={{
              flowCode: feature.legacy.flowCode,
              activities: feature.legacy.activities,
            }}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold">Target</h2>
            <span className="font-mono text-xs text-muted-foreground">handler + actions</span>
          </div>
          <JsonBlock
            data={{
              handler: feature.target.handler,
              actions: feature.target.actions,
              context: feature.target.context,
            }}
          />
        </div>
      </section>

      <footer className="flex justify-end border-t border-border pt-4">
        <StartFeatureDialog feature={feature} />
      </footer>
    </div>
  );
}
