// terminal-server 入口:WebSocket(127.0.0.1 only)+ node-pty spawn claude(透传 shell env)。
// 前端只传 projectId,后端校验解析 sandboxPath 后 spawn,防路径穿越。

import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { createDb, type DB } from "@helmflow/storage";
import { loadConfig } from "./config";
import {
  killAll,
  killSession,
  sessionCount,
  spawnSession,
  startIdleWatcher,
  touchSession,
} from "./pty-pool";
import { resolveSandboxForProjectId } from "./sandbox";

const MAX_SESSIONS = 8;

const cfg = loadConfig();
const db: DB = createDb(cfg.dbPath);
startIdleWatcher(cfg.idleTimeoutMs);

// 启动日志:打印实际 claude 二进制 + 检测到的端点配置,供肉眼确认走的是哪条路(cmux 不 529 / .env.local)。
console.log(`[terminal] claude binary = ${cfg.claudeBin}`);
console.log(
  `[terminal] ANTHROPIC_BASE_URL = ${process.env.ANTHROPIC_BASE_URL ?? "(unset, 走默认/订阅)"}  ANTHROPIC_MODEL = ${process.env.ANTHROPIC_MODEL ?? "(unset)"}`,
);
console.log(
  `[terminal] listening ws://127.0.0.1:${cfg.port} (localhost only, max ${MAX_SESSIONS} sessions, idle ${Math.round(cfg.idleTimeoutMs / 60000)}min)`,
);

const wss = new WebSocketServer({
  host: "127.0.0.1",
  port: cfg.port,
  maxPayload: 4 * 1024 * 1024,
});

wss.on("error", (err) => {
  console.error("[terminal] ws server error:", err.message);
  killAll();
  process.exit(1);
});

interface ClientMsg {
  type?: string;
  data?: string;
  cols?: number;
  rows?: number;
}

wss.on("connection", (ws: WebSocket, req) => {
  if (sessionCount() >= MAX_SESSIONS) {
    ws.close(4029, "too many sessions");
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const projectId = url.searchParams.get("projectId") ?? "";
  const cols = Number(url.searchParams.get("cols")) || 80;
  const rows = Number(url.searchParams.get("rows")) || 24;

  let sandbox: string;
  try {
    sandbox = resolveSandboxForProjectId(db, cfg, projectId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[terminal] reject projectId=${projectId}: ${msg}`);
    ws.close(4001, msg);
    return;
  }

  const sessionId = randomUUID();
  console.log(
    `[terminal] connect session=${sessionId.slice(0, 8)} project=${projectId} cwd=${sandbox}`,
  );

  let pty;
  try {
    pty = spawnSession(sessionId, cfg.claudeBin, {
      cwd: sandbox,
      cols,
      rows,
      onExit: (code) => {
        console.log(
          `[terminal] claude exited session=${sessionId.slice(0, 8)} code=${code}`,
        );
        if (ws.readyState === WebSocket.OPEN) ws.close(4000, "claude exited");
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ws.close(4002, `spawn failed: ${msg}`);
    return;
  }

  // PTY → 浏览器(下行 stdout)
  pty.onData((data) => {
    touchSession(sessionId);
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  // 浏览器 → PTY(上行:JSON 协议 {type:'stdin'|'resize'})
  ws.on("message", (msg) => {
    touchSession(sessionId);
    try {
      const m = JSON.parse(msg.toString()) as ClientMsg;
      if (m.type === "resize" && m.cols && m.rows) {
        try {
          pty.resize(m.cols, m.rows);
        } catch {
          // ignore resize error
        }
      } else if (m.type === "stdin" && typeof m.data === "string") {
        pty.write(m.data);
      }
    } catch {
      // 忽略非 JSON 消息
    }
  });

  ws.on("close", () => {
    console.log(`[terminal] disconnect session=${sessionId.slice(0, 8)}`);
    killSession(sessionId);
  });
  ws.on("error", () => killSession(sessionId));
});

process.on("SIGINT", () => {
  killAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  killAll();
  process.exit(0);
});
