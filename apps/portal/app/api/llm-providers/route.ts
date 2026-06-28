import { getDb } from "@/lib/db";
import { maskApiKey } from "@/lib/llm-config";
import { createLLMProvider, listLLMProviders } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/llm-providers — 列表(apiKey 脱敏,不回显明文)
export async function GET(): Promise<Response> {
  const db = getDb();
  const providers = listLLMProviders(db).map((p) => ({ ...p, apiKey: maskApiKey(p.apiKey) }));
  return NextResponse.json({ providers });
}

// POST /api/llm-providers — 创建 provider
export async function POST(req: Request): Promise<Response> {
  let body: { name?: unknown; apiKey?: unknown; baseUrl?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const model =
    typeof body.model === "string" && body.model.trim() ? body.model.trim() : "glm-5.2[1M]";

  if (!name) return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
  if (!apiKey) return NextResponse.json({ error: "API Key 不能为空" }, { status: 400 });
  if (!baseUrl) return NextResponse.json({ error: "Base URL 不能为空" }, { status: 400 });

  const db = getDb();
  const provider = createLLMProvider(db, { name, apiKey, baseUrl, model });
  return NextResponse.json(
    { provider: { ...provider, apiKey: maskApiKey(provider.apiKey) } },
    { status: 201 },
  );
}
