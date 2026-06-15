import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createFeatureManual,
  createScenarioManual,
  upsertFeatureScenario,
} from "@helmflow/storage";
import { resetMatrixSyncFlag } from "@/lib/sync-matrix";
import { getCurrentProjectId } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/features — 创建功能(含默认场景)
// ---------------------------------------------------------------------------
export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const domain = typeof body.domain === "string" ? body.domain.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!id || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    return NextResponse.json(
      { error: "功能 ID 格式错误:仅限字母、数字、连字符、下划线" },
      { status: 400 },
    );
  }
  if (!domain) {
    return NextResponse.json({ error: "域不能为空" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "功能名称不能为空" }, { status: 400 });
  }

  const handler = typeof body.handler === "string" ? body.handler : "";
  const actions = typeof body.actions === "string" ? body.actions : "";
  const context = typeof body.context === "string" ? body.context : "";
  const priority = typeof body.priority === "string" ? body.priority : "";
  const legacyFlowCode = typeof body.legacyFlowCode === "string" ? body.legacyFlowCode : "";
  const legacyActivities = typeof body.legacyActivities === "string" ? body.legacyActivities : "";

  const projectId = typeof body.projectId === "string" ? body.projectId : "";

  const db = getDb();
  try {
    const feature = createFeatureManual(db, {
      id,
      projectId: projectId || "mycmdeliverhub",
      domain,
      name,
      handler,
      actions,
      context,
      priority,
      legacyFlowCode,
      legacyActivities,
    });

    // 创建默认场景
    const defaultScenarios = body.defaultScenarios;
    if (Array.isArray(defaultScenarios)) {
      for (const ds of defaultScenarios) {
        if (typeof ds === "object" && ds !== null && typeof (ds as Record<string, unknown>).name === "string") {
          createScenarioManual(db, {
            featureId: id,
            scenarioName: (ds as Record<string, unknown>).name as string,
            scenarioStatus:
              typeof (ds as Record<string, unknown>).status === "string"
                ? ((ds as Record<string, unknown>).status as string)
                : "待实现",
          });
        }
      }
    } else {
      // 无指定场景时,从矩阵中的场景名自动创建
      try {
        const { getAllScenarioNames } = await import("@/lib/matrix");
        const names = getAllScenarioNames(projectId || undefined);
        for (const sn of names) {
          upsertFeatureScenario(db, {
            featureId: id,
            scenarioName: sn,
            scenarioStatus: "待实现",
          });
        }
        if (names.length === 0) {
          createScenarioManual(db, {
            featureId: id,
            scenarioName: "默认",
            scenarioStatus: "待实现",
          });
        }
      } catch {
        createScenarioManual(db, {
          featureId: id,
          scenarioName: "默认",
          scenarioStatus: "待实现",
        });
      }
    }

    // 清除 matrix sync 标记使下次加载时刷新
    resetMatrixSyncFlag();

    return NextResponse.json({ feature }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("already exists")) {
      return NextResponse.json({ error: "功能 ID 已存在" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
