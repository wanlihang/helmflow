// PTY 生命周期管理:每个 WS 连接一个 claude PTY,断开 / 空闲超时 kill,防泄漏。

import { spawn as ptySpawn, type IPty } from "node-pty";

interface PtySession {
  pty: IPty;
  lastActivity: number;
}

const sessions = new Map<string, PtySession>();
let idleWatcher: ReturnType<typeof setInterval> | undefined;

/** 启动全局空闲扫描(每分钟):超 idleTimeoutMs 的 session kill。 */
export function startIdleWatcher(idleTimeoutMs: number): void {
  if (idleWatcher) return;
  idleWatcher = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.lastActivity > idleTimeoutMs) {
        console.log(`[terminal] idle-kill session=${id.slice(0, 8)}`);
        try {
          s.pty.kill();
        } catch {
          // ignore
        }
        sessions.delete(id);
      }
    }
  }, 60_000);
}

export function touchSession(id: string): void {
  const s = sessions.get(id);
  if (s) s.lastActivity = Date.now();
}

interface SpawnOpts {
  cwd: string;
  cols: number;
  rows: number;
  onExit: (code: number) => void;
}

export function spawnSession(id: string, bin: string, opts: SpawnOpts): IPty {
  // 过滤 undefined 值:process.env 可能含 undefined,posix_spawnp 不接受。
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  // 用 bash -c 启动:claude 多为 shebang 脚本(cmux wrapper=bash / nvm 真身=node),
  // 直接 posix_spawnp 易 ENOEXEC;bash 负责解析 shebang + PATH。bin 是 trusted 路径,无注入风险。
  const pty = ptySpawn("/bin/bash", ["-c", bin], {
    name: "xterm-256color",
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
    // 纯透传启动 shell 的 env:用户在 cmux 里启 terminal-server → claude 继承 cmux 的不 529 配置。
    // 刻意不调 syncActiveLLMToEnv / 不读 DB provider,避免覆盖成 SDK 那条易 529 配置。
    env: cleanEnv,
  });
  sessions.set(id, { pty, lastActivity: Date.now() });
  pty.onExit(({ exitCode }) => {
    sessions.delete(id);
    opts.onExit(exitCode);
  });
  return pty;
}

export function killSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.pty.kill();
  } catch {
    // ignore
  }
  sessions.delete(id);
}

export function killAll(): void {
  for (const id of [...sessions.keys()]) killSession(id);
  if (idleWatcher) {
    clearInterval(idleWatcher);
    idleWatcher = undefined;
  }
}

export function sessionCount(): number {
  return sessions.size;
}
