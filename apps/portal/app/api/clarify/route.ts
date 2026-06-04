import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { buildClarifierSystemPrompt, buildClarifierUserPrompt } from "@/lib/clarifier-prompt";
import { getFeature } from "@/lib/matrix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "claude-opus-4-7";
const MAX_TOKENS = 4096;

interface ClarifyRequestBody {
  featureId?: unknown;
  userRequest?: unknown;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function encode(encoder: TextEncoder, payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(req: Request): Promise<Response> {
  let body: ClarifyRequestBody;
  try {
    body = (await req.json()) as ClarifyRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isString(body.featureId) || body.featureId.length === 0) {
    return NextResponse.json({ error: "featureId is required" }, { status: 400 });
  }
  if (!isString(body.userRequest)) {
    return NextResponse.json({ error: "userRequest is required" }, { status: 400 });
  }

  const feature = getFeature(body.featureId);
  if (!feature) {
    return NextResponse.json(
      { error: `Feature not found: ${body.featureId}` },
      { status: 404 },
    );
  }

  const apiKey =
    process.env.HELMFLOW_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  const authToken =
    process.env.HELMFLOW_ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey && !authToken) {
    return NextResponse.json(
      {
        error:
          "HELMFLOW_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) must be set in .env.local",
      },
      { status: 500 },
    );
  }

  const baseURL =
    process.env.HELMFLOW_ANTHROPIC_BASE_URL ||
    process.env.ANTHROPIC_BASE_URL ||
    undefined;
  const model = process.env.CLARIFIER_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({
    apiKey: apiKey ?? null,
    authToken: authToken ?? null,
    baseURL,
  });
  const systemPrompt = buildClarifierSystemPrompt();
  const userPrompt = buildClarifierUserPrompt(feature, body.userRequest);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const messageStream = client.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        });

        for await (const event of messageStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(
              encode(encoder, { type: "token", text: event.delta.text }),
            );
          }
        }

        controller.enqueue(encode(encoder, { type: "done" }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(encode(encoder, { type: "error", message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
