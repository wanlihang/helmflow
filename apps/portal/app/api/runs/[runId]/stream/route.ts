import { getRunEmitter, scheduleEmitterCleanup } from "@helmflow/orchestrator";
import type { OrchestratorEvent } from "@helmflow/orchestrator";
import { getDb } from "@/lib/db";
import { listRunEvents } from "@helmflow/storage";
import { sseEncode, sseResponse } from "@/lib/server-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StreamRouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(
  req: Request,
  context: StreamRouteParams,
): Promise<Response> {
  const { runId } = await context.params;

  // Parse ?afterId= cursor for catch-up replay from DB
  const url = new URL(req.url);
  const afterIdStr = url.searchParams.get("afterId");
  const afterId = afterIdStr ? Number(afterIdStr) : undefined;
  const validAfterId =
    afterId !== undefined && Number.isFinite(afterId) && afterId > 0
      ? afterId
      : undefined;

  const emitter = getRunEmitter(runId);
  if (!emitter) {
    return new Response(
      JSON.stringify({ error: `No active run: ${runId}` }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // ---- Phase 1: Catch-up from DB ---------------------------------
      // Send all historical events after the cursor so the client sees
      // everything it missed while disconnected.
      // NOTE: DB-replayed events use a different SSE format (with `id:` field)
      // so we keep direct encoder.encode here rather than sseEncode.
      if (validAfterId !== undefined) {
        try {
          const db = getDb();
          const historical = listRunEvents(db, runId, validAfterId);
          for (const ev of historical) {
            try {
              controller.enqueue(
                encoder.encode(`data: ${ev.payload}\nid: ${ev.id}\n\n`),
              );
            } catch {
              // controller already closed — stop replaying
              return;
            }
          }
        } catch {
          // DB read failure — skip catch-up, go straight to live
        }
      }

      // ---- Phase 2: Live subscription via emitter ---------------------
      const onEvent = (event: OrchestratorEvent) => {
        try {
          controller.enqueue(sseEncode(encoder, event));
        } catch {
          // controller already closed
        }

        if (event.type === "done" || event.type === "error") {
          try {
            controller.close();
          } catch {
            // already closed
          }
          emitter.removeListener("event", onEvent);
          scheduleEmitterCleanup(runId);
        }
      };

      emitter.on("event", onEvent);

      // If the request is aborted, clean up
      req.signal.addEventListener("abort", () => {
        emitter.removeListener("event", onEvent);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return sseResponse(stream);
}