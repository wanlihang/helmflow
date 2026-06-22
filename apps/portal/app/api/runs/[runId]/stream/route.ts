import { getDb } from "@/lib/db";
import { createSseHeartbeat, sseEncode, sseResponse } from "@/lib/server-utils";
import {
  type OrchestratorEvent,
  getRunEmitter,
  scheduleEmitterCleanup,
} from "@helmflow/orchestrator";
import { listRunEvents } from "@helmflow/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StreamRouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(req: Request, context: StreamRouteParams): Promise<Response> {
  const { runId } = await context.params;

  const url = new URL(req.url);
  const afterIdStr = url.searchParams.get("afterId");
  const cursor0 =
    afterIdStr && Number.isFinite(Number(afterIdStr)) && Number(afterIdStr) > 0
      ? Number(afterIdStr)
      : 0;

  const encoder = new TextEncoder();
  const db = getDb();
  const emitter = getRunEmitter(runId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastId = cursor0;
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          closed = true;
          return false;
        }
      };
      const safeClose = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // ---- 内存 emitter 存在(portal 自身触发):可选 catch-up + live ----
      if (emitter) {
        // 断线重连:补发 cursor 之后的历史事件
        if (cursor0 > 0) {
          try {
            for (const ev of listRunEvents(db, runId, lastId)) {
              if (!safeEnqueue(encoder.encode(`data: ${ev.payload}\nid: ${ev.id}\n\n`))) return;
              lastId = ev.id;
              if (ev.eventType === "done" || ev.eventType === "error") {
                safeClose();
                return;
              }
            }
          } catch {
            // DB 读失败:跳过 catch-up,直接 live
          }
        }

        const onEvent = (event: OrchestratorEvent): void => {
          if (!safeEnqueue(sseEncode(encoder, event))) return;
          if (event.type === "done" || event.type === "error") {
            emitter.removeListener("event", onEvent);
            scheduleEmitterCleanup(runId);
            safeClose();
          }
        };
        emitter.on("event", onEvent);
        req.signal.addEventListener("abort", () => {
          emitter.removeListener("event", onEvent);
          scheduleEmitterCleanup(runId);
          safeClose();
        });
        return;
      }

      // ---- 内存 emitter 不存在(worker 触发 / portal 重启后):DB 轮询兜底 ----
      // 先补发历史,再周期增量轮询,直到出现 done/error 或连接关闭。
      const heartbeat = createSseHeartbeat(encoder, controller, 15000);
      heartbeat.start();

      let terminated = false;
      try {
        for (const ev of listRunEvents(db, runId, lastId)) {
          if (!safeEnqueue(encoder.encode(`data: ${ev.payload}\nid: ${ev.id}\n\n`))) {
            heartbeat.stop();
            return;
          }
          lastId = ev.id;
          if (ev.eventType === "done" || ev.eventType === "error") terminated = true;
        }
      } catch {
        // 初始读失败:交给轮询重试
      }
      if (terminated) {
        heartbeat.stop();
        safeClose();
        return;
      }

      const timer = setInterval(() => {
        let end = false;
        try {
          for (const ev of listRunEvents(db, runId, lastId)) {
            if (!safeEnqueue(encoder.encode(`data: ${ev.payload}\nid: ${ev.id}\n\n`))) {
              end = true;
              break;
            }
            lastId = ev.id;
            if (ev.eventType === "done" || ev.eventType === "error") end = true;
          }
        } catch {
          // 忽略单次读失败,下轮重试
        }
        if (end) {
          clearInterval(timer);
          heartbeat.stop();
          safeClose();
        }
      }, 2000);

      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
        heartbeat.stop();
        safeClose();
      });
    },
  });

  return sseResponse(stream);
}
