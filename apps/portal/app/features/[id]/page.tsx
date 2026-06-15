import { notFound } from "next/navigation";
import { getFeature, getDomainOfFeature } from "@/lib/matrix";
import { FeaturePageClient } from "@/components/feature-detail-client";

interface FeaturePageProps {
  params: Promise<{ id: string }>;
}

export default async function FeaturePage({ params }: FeaturePageProps) {
  const { id } = await params;
  const feature = getFeature(id);
  if (!feature) {
    return notFound();
  }

  const domain = getDomainOfFeature(id);

  return <FeaturePageClient feature={feature} domain={domain} />;
}
