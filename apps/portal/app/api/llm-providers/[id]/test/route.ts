import { getDb } from "@/lib/db";
import { isOfficialAnthropicBase } from "@/lib/llm-config";
import { getLLMProviderById } from "@helmflow/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/llm-providers/[id]/test — 测试连接(用配置调一次 /v1/messages,max_tokens:1)
//   按 baseUrl 是否官方选 x-api-key 或 Authorization: Bearer(与 env.ts 一致)
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = getDb();
  const provider = getLLMProviderById(db, id);
  if (!provider) return NextResponse.json({ error: "Provider 不存在" }, { status: 404 });

  const official = isOfficialAnthropicBase(provider.baseUrl);
  const url = `${provider.baseUrl.replace(/\/$/, "")}/v1/messages`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    ...(official ? { "x-api-key": provider.apiKey } : { Authorization: `Bearer ${provider.apiKey}` }),
  };

  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const latencyMs = Date.now() - startedAt;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({
        ok: false,
        latencyMs,
        status: res.status,
        error: (text || res.statusText).slice(0, 200),
      });
    }
    return NextResponse.json({ ok: true, latencyMs });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
