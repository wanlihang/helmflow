import { getDb } from "@/lib/db";
import { maskApiKey } from "@/lib/llm-config";
import { deleteLLMProvider, getLLMProviderById, updateLLMProvider } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/llm-providers/[id] — 详情(apiKey 脱敏)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = getDb();
  const provider = getLLMProviderById(db, id);
  if (!provider) return NextResponse.json({ error: "Provider 不存在" }, { status: 404 });
  return NextResponse.json({ provider: { ...provider, apiKey: maskApiKey(provider.apiKey) } });
}

// PATCH /api/llm-providers/[id] — 更新(apiKey 留空 = 不改)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = getDb();
  const existing = getLLMProviderById(db, id);
  if (!existing) return NextResponse.json({ error: "Provider 不存在" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const args: { name?: string; apiKey?: string; baseUrl?: string; model?: string } = {};
  if (typeof body.name === "string" && body.name.trim()) args.name = body.name.trim();
  if (typeof body.apiKey === "string" && body.apiKey.trim()) args.apiKey = body.apiKey.trim();
  if (typeof body.baseUrl === "string" && body.baseUrl.trim()) args.baseUrl = body.baseUrl.trim();
  if (typeof body.model === "string" && body.model.trim()) args.model = body.model.trim();

  if (Object.keys(args).length === 0) {
    return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
  }

  const updated = updateLLMProvider(db, id, args);
  return NextResponse.json({ provider: { ...updated, apiKey: maskApiKey(updated.apiKey) } });
}

// DELETE /api/llm-providers/[id] — 删除(禁删活跃项)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = getDb();
  const existing = getLLMProviderById(db, id);
  if (!existing) return NextResponse.json({ error: "Provider 不存在" }, { status: 404 });
  if (existing.isActive) {
    return NextResponse.json({ error: "不能删除活跃 provider,请先切换到其他 provider" }, { status: 400 });
  }
  deleteLLMProvider(db, id);
  return NextResponse.json({ ok: true });
}
