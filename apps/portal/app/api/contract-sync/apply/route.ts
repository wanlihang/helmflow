import { getDb } from "@/lib/db";
import { getCurrentProjectId } from "@/lib/project";
import { type HelmcodeStatus, applySync, buildManualChange } from "@helmflow/contract-sync";
import { getCellRow, getSyncResult } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApplyBody {
  contractFeatureIds?: unknown;
}

const VALID_STATUS: HelmcodeStatus[] = ["draft", "approved", "goal-running", "done"];

// POST /api/contract-sync/apply — 批量 apply 一批契约的同步结果(按 contractFeatureId)
// 适用场景:pending 项未自动 apply,用户审阅后批量采纳。
export async function POST(req: Request): Promise<Response> {
  let body: ApplyBody;
  try {
    body = (await req.json()) as ApplyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.contractFeatureIds) ? body.contractFeatureIds : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "contractFeatureIds array is required" }, { status: 400 });
  }

  try {
    const db = getDb();
    const projectId = await getCurrentProjectId();

    const changes = [];
    for (const id of ids) {
      if (typeof id !== "string") continue;
      const result = getSyncResult(db, projectId, id);
      if (!result || !result.mappedFeatureId || !result.mappedScenarioName) continue;
      if (!VALID_STATUS.includes(result.helmcodeStatus as HelmcodeStatus)) continue;

      // 校验目标 cell 存在
      const cellId = `${result.mappedFeatureId}__${result.mappedScenarioName}`;
      if (!getCellRow(db, cellId)) continue;

      changes.push(
        buildManualChange(
          {
            status: result.helmcodeStatus as HelmcodeStatus,
            featureId: result.contractFeatureId,
          },
          result.mappedFeatureId,
          result.mappedScenarioName,
        ),
      );
    }

    const report = applySync(db, changes);
    return NextResponse.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[contract-sync/apply] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
