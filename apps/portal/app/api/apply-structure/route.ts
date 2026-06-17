import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createFeatureManual,
  createScenarioManual,
  upsertFeatureScenario,
  updateRun,
  listRunsByKind,
  getRunById,
} from "@helmflow/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// 场景数安全阈值：单个功能点最多允许的场景数
// ---------------------------------------------------------------------------
const MAX_SCENARIOS_PER_FEATURE = 5;

// ---------------------------------------------------------------------------
// 场景名称黑名单：这些词汇模式不应作为独立场景（属于实现分支而非业务维度）
// ---------------------------------------------------------------------------
const SCENARIO_NAME_BLACKLIST_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /审批(通过|驳回|撤消|撤销)/, reason: "审批结果是流程内状态流转，不是业务场景" },
  { pattern: /校验(通过|失败)$/, reason: "校验结果是流程内条件判断，不是业务场景" },
  { pattern: /逆向校验/, reason: "校验结果是流程内条件判断，不是业务场景" },
  { pattern: /(正常|异常)(执行|处理|流程|重抛)/, reason: "异常处理是所有场景共有的实现路径，不是业务场景" },
  { pattern: /业务异常|系统异常/, reason: "异常处理是所有场景共有的实现路径，不是业务场景" },
  { pattern: /节点(通过|驳回|撤消|撤销)/, reason: "节点状态是流程内状态流转，不是业务场景" },
  { pattern: /(协议|签约|价格|产品).*(回调|通知)/, reason: "回调是触发机制，不是业务场景维度" },
  { pattern: /解析为(通过|驳回|撤消|撤销)/, reason: "解析结果是回调处理结果，不是业务场景" },
  { pattern: /状态码为空|记录号为空/, reason: "数据校验是防御性编程，不是业务场景" },
  { pattern: /推进并构建/, reason: "这是后续动作，不是独立的业务场景" },
];

/**
 * 过滤不符合业务场景定义的场景名称
 */
function filterInvalidScenarios(scenarios: ScenarioInput[]): {
  valid: ScenarioInput[];
  filtered: Array<{ name: string; reason: string }>;
} {
  const valid: ScenarioInput[] = [];
  const filtered: Array<{ name: string; reason: string }> = [];

  for (const s of scenarios) {
    const matched = SCENARIO_NAME_BLACKLIST_PATTERNS.find((p) => p.pattern.test(s.name));
    if (matched) {
      filtered.push({ name: s.name, reason: matched.reason });
    } else {
      valid.push(s);
    }
  }

  // 如果过滤后没有场景，保留第一个（即使是命中的），确保至少有一个场景
  if (valid.length === 0 && scenarios.length > 0) {
    valid.push({ ...scenarios[0], name: "默认场景", status: scenarios[0].status || "待实现" });
  }

  return { valid, filtered };
}

// ---------------------------------------------------------------------------
// POST /api/apply-structure — 将审阅后的结构分析结果写入 DB
// ---------------------------------------------------------------------------

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
}

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { projectId, features, runId } = body;

  if (!projectId || !Array.isArray(features) || features.length === 0) {
    return NextResponse.json(
      { error: "projectId 和 features 不能为空" },
      { status: 400 },
    );
  }

  const db = getDb();

  try {
    let createdFeatures = 0;
    let createdScenarios = 0;
    const warnings: Array<{ featureId: string; message: string }> = [];

    for (const f of features) {
      // 场景数量安全检查
      if (f.scenarios.length > MAX_SCENARIOS_PER_FEATURE) {
        warnings.push({
          featureId: f.id,
          message: `场景数 ${f.scenarios.length} 超过阈值 ${MAX_SCENARIOS_PER_FEATURE}，已截断。每个功能点最多 ${MAX_SCENARIOS_PER_FEATURE} 个业务场景。`,
        });
        f.scenarios = f.scenarios.slice(0, MAX_SCENARIOS_PER_FEATURE);
      }

      // 过滤不符合业务场景定义的场景
      const { valid, filtered } = filterInvalidScenarios(f.scenarios);
      if (filtered.length > 0) {
        warnings.push({
          featureId: f.id,
          message: `已过滤非业务场景: ${filtered.map((x) => `${x.name}(${x.reason})`).join("; ")}`,
        });
      }
      f.scenarios = valid;

      // 创建功能点
      try {
        createFeatureManual(db, {
          id: f.id,
          projectId,
          domain: f.domain,
          name: f.name,
          handler: f.handler || "",
          actions: Array.isArray(f.actions) ? f.actions.join(", ") : "",
          context: f.context || f.domain,
          priority: f.priority || "P1",
        });
        createdFeatures++;
      } catch (err) {
        // 如果功能点已存在，跳过（增量场景）
        const msg = (err as Error).message;
        if (!msg.includes("already exists")) {
          throw err;
        }
      }

      // 创建场景
      if (Array.isArray(f.scenarios)) {
        for (const s of f.scenarios) {
          upsertFeatureScenario(db, {
            featureId: f.id,
            scenarioName: s.name,
            scenarioStatus: s.status || "待实现",
            agentStatus: "not-started",
          });
          createdScenarios++;
        }
      }
    }

    // 清除 matrix sync 标记使下次加载时刷新

    // 将对应的 analyze-structure run 标记为 "applied"，避免刷新后重复弹窗。
    // 优先用传入的 runId 精确标记；缺省时回退到最近一次已完成的 analyze-structure run。
    try {
      let marked = false;
      if (runId) {
        const run = getRunById(db, runId);
        if (run && run.kind === "analyze-structure" && (run.state === "done" || run.state === "applied")) {
          updateRun(db, run.id, "applied");
          marked = true;
        }
      }
      if (!marked) {
        const structureRuns = listRunsByKind(db, "analyze-structure", 5);
        for (const r of structureRuns) {
          if (r.state === "done") {
            updateRun(db, r.id, "applied");
            break;
          }
        }
      }
    } catch {
      // 标记失败不应阻塞 apply 操作
    }

    return NextResponse.json({
      ok: true,
      createdFeatures,
      createdScenarios,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
