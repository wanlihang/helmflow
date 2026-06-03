import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Feature } from "@/lib/matrix";

interface FeatureCardProps {
  feature: Feature;
}

const priorityClasses: Record<string, string> = {
  P0: "bg-red-100 text-red-700 border border-red-200",
  P1: "bg-yellow-100 text-yellow-700 border border-yellow-200",
  P2: "bg-gray-100 text-gray-700 border border-gray-200",
};

export function FeatureCard({ feature }: FeatureCardProps) {
  return (
    <Link
      href={`/features/${feature.id}`}
      className="feature-card block transition-shadow hover:shadow-md"
    >
      <Card className="h-full">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm">
              <span className="font-mono text-muted-foreground">{feature.id}</span>{" "}
              <span>{feature.name}</span>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </Link>
  );
}
