import { getDb } from "@/lib/db";
import {
  createFeatureManual,
  createScenarioManual,
  generateFeatureId,
  upsertFeatureScenario,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/features — 创建功能(含默认场景)
//   用户只输入 名称 + 描述 + 域;编号(ID)按"域前缀+递增序号"自动生成。
// ---------------------------------------------------------------------------
export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const domain = typeof body.domain === "string" ? body.domain.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!domain) {
    return NextResponse.json({ error: "域不能为空" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "功能名称不能为空" }, { status: 400 });
  }

  const description = typeof body.description === "string" ? body.description : "";
  const projectId = (typeof body.projectId === "string" ? body.projectId : "") || "mycmdeliverhub";

  const db = getDb();
  try {
    // 编号自动生成(域前缀 + 递增序号,含 archived 统计 → 软删除不影响编号)
    const id = generateFeatureId(db, projectId, domain);

    const feature = createFeatureManual(db, {
      id,
      projectId,
      domain,
      name,
      description,
    });

    // 创建默认场景
    const defaultScenarios = body.defaultScenarios;
    if (Array.isArray(defaultScenarios)) {
      for (const ds of defaultScenarios) {
        if (
          typeof ds === "object" &&
          ds !== null &&
          typeof (ds as Record<string, unknown>).name === "string"
        ) {
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

    return NextResponse.json({ feature }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("already exists")) {
      return NextResponse.json({ error: "功能 ID 已存在" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
