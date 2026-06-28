import { getDb } from "@/lib/db";
import { getRuntimeSettings, updateRuntimeSettings } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/runtime-settings — 返回平台运行参数(前端 /llm 渲染)
// 附带 runtimeEnv:portal 进程此刻实际生效的 LLM url/model(不返回 key),
// 用于诊断"DB active provider 是否真正覆盖到 agent 子进程"。
export async function GET(): Promise<Response> {
  const db = getDb();
  return NextResponse.json({
    settings: getRuntimeSettings(db),
    runtimeEnv: {
      "HELMFLOW_ANTHROPIC_BASE_URL": process.env.HELMFLOW_ANTHROPIC_BASE_URL ?? "(未设)",
      "HELMFLOW_ANTHROPIC_MODEL": process.env.HELMFLOW_ANTHROPIC_MODEL ?? "(未设)",
      "ANTHROPIC_BASE_URL(无前缀,.env.local可能设此)": process.env.ANTHROPIC_BASE_URL ?? "(未设)",
      "ANTHROPIC_MODEL(无前缀,子进程可能读此)": process.env.ANTHROPIC_MODEL ?? "(未设)",
    },
  });
}

interface PutBody {
  skipDeploy?: unknown;
  turnsPerSession?: unknown;
  turnIntervalMs?: unknown;
}

const toNum = (v: unknown): number | undefined => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : undefined;
  }
  return undefined;
};

// PUT /api/runtime-settings — 更新运行参数(upsert 单例)。下次"启动全流程"时由 start route 注入 env。
export async function PUT(req: Request): Promise<Response> {
  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const skipDeploy =
    typeof body.skipDeploy === "boolean" ? (body.skipDeploy ? 1 : 0) : undefined;
  const turnsPerSession = toNum(body.turnsPerSession);
  const turnIntervalMs = toNum(body.turnIntervalMs);

  const db = getDb();
  const settings = updateRuntimeSettings(db, {
    ...(skipDeploy !== undefined ? { skipDeploy } : {}),
    ...(turnsPerSession !== undefined && turnsPerSession >= 0 ? { turnsPerSession } : {}),
    ...(turnIntervalMs !== undefined && turnIntervalMs >= 0 ? { turnIntervalMs } : {}),
  });
  return NextResponse.json({ settings });
}
