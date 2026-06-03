import { FeatureCard } from "@/components/feature-card";
import type { Domain } from "@/lib/matrix";

interface DomainSectionProps {
  domain: Domain;
}

export function DomainSection({ domain }: DomainSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3 border-b border-border pb-2">
        <h2 className="text-xl font-bold tracking-tight">{domain.name}</h2>
        <span className="font-mono text-sm text-muted-foreground">
          {domain.id} · {domain.features.length} 个功能点
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {domain.features.map((feature) => (
          <FeatureCard key={feature.id} feature={feature} />
        ))}
      </div>
    </section>
  );
}
