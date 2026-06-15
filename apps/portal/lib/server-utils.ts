/**
 * 服务端共享工具函数 — 从各 API 路由中提取的公共逻辑。
 * 仅用于 Next.js API route (Node.js runtime)。
 */

import { resolve, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { getCurrentProjectId } from "@/lib/project";
import { getProject } from "@helmflow/manifest-loader";
import { getDb } from "@/lib/db";
import { getProjectById } from "@helmflow/storage";

// ─── 类型守卫 ─────────────────────────────────────────────────────────

export function isString(v: unknown): v is string {
  return typeof v === "string";
}

// ─── SSE 工具 ─────────────────────────────────────────────────────────

export function sseEncode(encoder: TextEncoder, payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** 创建标准 SSE Response (text/event-stream + no-cache + no-buffering) */
export function sseResponse(
  body: ReadableStream<Uint8Array>,
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * 为 SSE ReadableStream 添加心跳保活。
 * Agent SDK 调用期间可能有长时间无输出的暂停(10-60s)，
 * 心跳防止浏览器/代理认为连接空闲而断开。
 *
 * 用法:
 *   const { startHeartbeat, stopHeartbeat } = createSseHeartbeat(encoder, controller);
 *   // ... 在 ReadableStream 的 start() 里调用 startHeartbeat()
 *   // ... 在 finally 里调用 stopHeartbeat()
 */
export function createSseHeartbeat(
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController<Uint8Array>,
  intervalMs = 15_000,
) {
  let timer: ReturnType<typeof setInterval> | undefined;

  return {
    start() {
      timer = setInterval(() => {
        try {
          // SSE comment line — ignored by EventSource but keeps connection alive
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(timer);
        }
      }, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}

// ─── 沙箱路径解析 ──────────────────────────────────────────────────────

/**
 * 从 DB 项目配置读取 sandboxPath 并解析为绝对路径。
 * 支持：
 *   - 绝对路径: /Users/xxx/my-project → 直接使用
 *   - 相对路径: ./apps/my-project → 基于 monorepo root 解析
 *   - 环境变量覆盖: HELMFLOW_SAMPLE_JAVA_PATH
 *   - 未配置 → 抛错(项目必须显式注册 sandboxPath)
 */
export async function resolveSandboxPathForProject(projectId: string): Promise<string> {
  // 1. 环境变量覆盖（向后兼容）
  const env = process.env.HELMFLOW_SAMPLE_JAVA_PATH;
  if (env && env.length > 0) return resolve(env);

  // 2. 从 DB 读取项目的 sandboxPath
  try {
    const db = getDb();
    const project = getProjectById(db, projectId);
    if (project?.sandboxPath) {
      const sp = project.sandboxPath;
      // 绝对路径直接用
      if (isAbsolute(sp)) {
        if (existsSync(sp)) return sp;
      } else {
        // 相对路径基于 monorepo root 解析
        const monorepoRoot = resolve(process.cwd(), "..", "..");
        const abs = resolve(monorepoRoot, sp);
        if (existsSync(abs)) return abs;
      }
    }
  } catch {
    // DB 读取失败，继续回落
  }

  // 3. 未配置 sandboxPath — 不再回退到内置 sandbox-java,直接抛错
  //    (sandbox-java 是早期最小验证骨架,现已移除;项目必须显式配置 sandboxPath)
  throw new Error(
    `Project "${projectId}" has no sandboxPath configured (DB or manifest). Register the project with a valid project path.`,
  );
}

/**
 * async 版：从当前 cookie 上下文获取项目 sandbox 路径。
 * 优先使用环境变量，然后从 DB/manifest 读取项目配置的 sandboxPath。
 * 未配置时抛错(不再回退到内置 sandbox-java)。
 */
export async function resolveSandboxPath(): Promise<string> {
  const env = process.env.HELMFLOW_SAMPLE_JAVA_PATH;
  if (env && env.length > 0) return resolve(env);

  const projectId = await getCurrentProjectId();

  try {
    const db = getDb();
    const project = getProjectById(db, projectId);
    if (project?.sandboxPath) {
      const sp = project.sandboxPath;
      if (isAbsolute(sp)) return resolve(sp);
      return resolve(process.cwd(), "..", "..", sp);
    }
  } catch {
    // DB 读取失败，继续回落到 manifest
  }

  const project = getProject(projectId);
  if (project?.manifest?.sandboxPath) {
    const sp = project.manifest.sandboxPath;
    if (isAbsolute(sp)) return resolve(sp);
    return resolve(process.cwd(), "..", "..", sp);
  }

  throw new Error(
    `Project "${projectId}" has no sandboxPath configured (DB or manifest). Register the project with a valid project path.`,
  );
}

/** @deprecated 旧命名,请用 resolveSandboxPathForProject */
export const resolveSandboxJavaPath = resolveSandboxPath;

// ─── HelmCode Root 解析 ───────────────────────────────────────────────

/**
 * 从当前项目配置中读取 helmcodeRoot。
 * 失败时静默返回 undefined(非致命)。
 */
export async function resolveHelmcodeRoot(): Promise<string | undefined> {
  try {
    const projectId = await getCurrentProjectId();
    const project = getProject(projectId);
    return project?.helmcodeRoot;
  } catch {
    return undefined;
  }
}