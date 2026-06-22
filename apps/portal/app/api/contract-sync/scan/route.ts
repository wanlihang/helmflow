import { runContractSyncScan } from "@/lib/contract-sync-actions";
import { getDb } from "@/lib/db";
import { getCurrentProjectId } from "@/lib/project";
import { resolveSandboxPath } from "@/lib/server-utils";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contract-sync/scan — 扫描目标项目契约,匹配 cell,自动 apply 高置信 matched;
// env HELMFLOW_CONTRACT_SYNC_LLM=1 时对 pending 跑 LLM 辅助匹配。
export async function POST(): Promise<Response> {
  try {
    const db = getDb();
    const projectId = await getCurrentProjectId();
    const sandboxPath = await resolveSandboxPath();

    const outcome = await runContractSyncScan({ db, projectId, sandboxPath });

    // pending 数需减去 LLM 升级的(llm.promoted)
    const pendingFinal = outcome.plan.pending.length - outcome.llm.promoted;
    return NextResponse.json({
      runId: outcome.runId,
      summary: {
        matched: outcome.plan.matched.length + outcome.llm.promoted,
        pending: pendingFinal,
        unmatched: outcome.plan.unmatched.length,
      },
      autoApply: outcome.autoApply,
      llm: outcome.llm,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[contract-sync/scan] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
