import { getDb } from "@/lib/db";
import { loadMatrix } from "@/lib/matrix";
import {
  archiveFeature,
  archiveFeatureScenario,
  createFeatureManual,
  deleteScenario,
  getFeatureRow,
  getFeatureScenario,
  getRunById,
  listFeatureScenarios,
  listRunsByKind,
  updateFeatureMeta,
  updateRun,
  upsertFeatureScenario,
} from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SCENARIOS_PER_FEATURE = 5;

type Strategy = "smart" | "add-only" | "overwrite";

interface ScenarioInput {
  name: string;
  status: string;
}

interface FeatureInput {
  id: string;
  name: string;
  domain: string;
  domainName: string;
  handler: string;
  actions: string[];
  context: string;
  priority: string;
  scenarios: ScenarioInput[];
}

interface RequestBody {
  projectId: string;
  features: FeatureInput[];
  runId?: string;
  strategy?: Strategy;
  archiveStale?: boolean;
}

// ---------------------------------------------------------------------------
// POST /api/apply-structure — 保护性合并:按 strategy 写入,保护已治理状态
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { projectId, features, runId } = body;
  const strategy: Strategy =
    body.strategy === "add-only" || body.strategy === "overwrite" ? body.strategy : "smart";
  const archiveStale = body.archiveStale !== false; // 默认 true

  if (!projectId || !Array.isArray(features) || features.length === 0) {
    return NextResponse.json({ error: "projectId 和 features 不能为空" }, { status: 400 });
  }

  const db = getDb();

  try {
    const addedFeatures: string[] = [];
    const preservedFeatures: string[] = [];
    const updatedFeatures: string[] = [];
    const archivedFeatures: string[] = [];
    let addedScenarios = 0;
    let removedScenarios = 0;
    const warnings: Array<{ featureId: string; message: string }> = [];

    const incomingIds = new Set<string>();

    for (const f of features) {
      incomingIds.add(f.id);

      if (f.scenarios.length > MAX_SCENARIOS_PER_FEATURE) {
        warnings.push({
          featureId: f.id,
          message: `场景数 ${f.scenarios.length} 超过阈值 ${MAX_SCENARIOS_PER_FEATURE},已截断。`,
        });
        f.scenarios = f.scenarios.slice(0, MAX_SCENARIOS_PER_FEATURE);
      }

      const existingFeature = getFeatureRow(db, f.id);
      const actionsStr = Array.isArray(f.actions) ? f.actions.join(", ") : "";

      if (!existingFeature) {
        // 新增 feature + 全部场景
        createFeatureManual(db, {
          id: f.id,
          projectId,
          domain: f.domain,
          name: f.name,
          handler: f.handler || "",
          actions: actionsStr,
          context: f.context || f.domain,
          priority: f.priority || "P1",
        });
        addedFeatures.push(f.id);
        for (const s of f.scenarios) {
          upsertFeatureScenario(db, {
            featureId: f.id,
            scenarioName: s.name,
            scenarioStatus: s.status || "待实现",
            agentStatus: "not-started",
          });
          addedScenarios++;
        }
        continue;
      }

      // feature 已存在
      if (strategy === "overwrite") {
        // 覆盖:更新元数据 + 场景状态重置为分析值(治理状态丢失)
        updateFeatureMeta(db, f.id, {
          name: f.name,
          handler: f.handler || "",
          actions: actionsStr,
          context: f.context || f.domain,
          priority: f.priority || "P1",
          domain: f.domain,
        });
        updatedFeatures.push(f.id);
        for (const s of f.scenarios) {
          upsertFeatureScenario(db, {
            featureId: f.id,
            scenarioName: s.name,
            scenarioStatus: s.status || "待实现",
            agentStatus: "not-started",
          });
        }
      } else {
        // smart / add-only:保留已存在的 feature 与已治理状态
        preservedFeatures.push(f.id);
        if (strategy === "smart") {
          // 只新增 DB 没有的场景,已有的一律不动(保护 status/agentStatus/note)
          for (const s of f.scenarios) {
            const exSc = getFeatureScenario(db, f.id, s.name);
            if (!exSc) {
              upsertFeatureScenario(db, {
                featureId: f.id,
                scenarioName: s.name,
                scenarioStatus: s.status || "待实现",
                agentStatus: "not-started",
              });
              addedScenarios++;
            }
          }
        }
        // add-only:已存在 feature 的场景一律不动
      }
    }

    // stale 处理:DB 活跃但 incoming 不再识别的项
    if (archiveStale && strategy !== "add-only") {
      const activeFeatures = loadMatrix(projectId).domains.flatMap((d) => d.features);
      for (const af of activeFeatures) {
        const incomingFeature = features.find((f) => f.id === af.id);
        if (!incomingFeature) {
          // stale feature:归档(feature 级,连带场景标废弃)
          archiveFeature(db, af.id);
          archivedFeatures.push(af.id);
          continue;
        }
        // feature 保留,检查场景级 stale
        const incomingScnNames = new Set(incomingFeature.scenarios.map((s) => s.name));
        const scnRows = listFeatureScenarios(db, af.id).filter((sr) => !sr.archived);
        for (const sr of scnRows) {
          if (!incomingScnNames.has(sr.scenarioName)) {
            if (strategy === "overwrite") {
              deleteScenario(db, sr.id); // 覆盖语义:硬删
            } else {
              archiveFeatureScenario(db, af.id, sr.scenarioName); // smart:归档
            }
            removedScenarios++;
          }
        }
      }
    }

    // 标记 analyze-structure run 为 applied(避免刷新重复弹窗)
    try {
      let marked = false;
      if (runId) {
        const run = getRunById(db, runId);
        if (
          run &&
          run.kind === "analyze-structure" &&
          (run.state === "done" || run.state === "applied")
        ) {
          updateRun(db, run.id, "applied");
          marked = true;
        }
      }
      if (!marked) {
        for (const r of listRunsByKind(db, "analyze-structure", 5)) {
          if (r.state === "done") {
            updateRun(db, r.id, "applied");
            break;
          }
        }
      }
    } catch {
      // 标记失败不阻塞 apply
    }

    return NextResponse.json({
      ok: true,
      strategy,
      summary: {
        addedFeatures,
        preservedFeatures,
        updatedFeatures,
        archivedFeatures,
        addedScenarios,
        removedScenarios,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
