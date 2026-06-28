import { getDb } from "@/lib/db";
import { maskApiKey, syncActiveLLMToEnv } from "@/lib/llm-config";
import { getLLMProviderById, setActiveLLMProvider } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/llm-providers/[id]/activate — 设为活跃(互斥)+ 立即 sync env
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = getDb();
  const existing = getLLMProviderById(db, id);
  if (!existing) return NextResponse.json({ error: "Provider 不存在" }, { status: 404 });
  const provider = setActiveLLMProvider(db, id);
  syncActiveLLMToEnv(db); // 立即生效(agent-runner 下次读 env 用新活跃 provider)
  return NextResponse.json({ provider: { ...provider, apiKey: maskApiKey(provider.apiKey) } });
}
