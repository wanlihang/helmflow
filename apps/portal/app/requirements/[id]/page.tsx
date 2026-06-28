// /requirements/[id] — 需求对话页。
// server component:取 requirement + 最新契约(含正文),交给客户端对话组件。

import { RequirementConversationClient } from "@/components/requirement-conversation-client";
import { getDb } from "@/lib/db";
import { getRequirement, getLatestContractWorkUnit } from "@helmflow/storage";
import { readFileSync } from "node:fs";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function RequirementDetailPage({ params }: PageProps) {
  const { id } = await params;
  const db = getDb();
  const requirement = getRequirement(db, id);
  if (!requirement) notFound();

  const latest = getLatestContractWorkUnit(db, { kind: "requirement", requirementId: id });

  let contractMarkdown: string | null = null;
  if (latest) {
    try {
      contractMarkdown = readFileSync(latest.markdownPath, "utf-8");
    } catch {
      contractMarkdown = null;
    }
  }

  return (
    <RequirementConversationClient
      requirement={{
        id: requirement.id,
        title: requirement.title,
        description: requirement.description,
        status: requirement.status,
        agentStatus: requirement.agentStatus,
        projectId: requirement.projectId,
        sessionId: requirement.sessionId,
        clarifyRunId: requirement.clarifyRunId,
      }}
      latestContract={
        latest
          ? {
              id: latest.id,
              status: latest.status,
              markdown: contractMarkdown,
            }
          : null
      }
    />
  );
}
