import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  AllowedTool,
  NodeRunEvent,
  NodeRunOptions,
  NodeRunResult,
} from "./types";
import { buildRunnerEnv, envToProcessEnv } from "./env";

const PREVIEW_MAX = 500;
const DEFAULT_TURNS_PER_SESSION = 15;

// ---------------------------------------------------------------------------
// 限流/过载退避(529/429):端点临时过载时指数退避重试,而非立即 fail。
// 否则 worker 在限流期间会反复无效重试、烧时间却拿不到结果(7×24 鲁棒性关键)。
// ---------------------------------------------------------------------------
const MAX_RATELIMIT_RETRIES = 5;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 120_000;

function isRateLimitError(error: string | undefined): boolean {
  if (!error) return false;
  return /529|429|overloaded|rate.?limit|too many requests|访问量过大|稍后再试/i.test(error);
}

function rateLimitSignal(error: string | undefined): string {
  if (!error) return "unknown";
  const m = error.match(/(529|429)/);
  return m && m[1] ? m[1] : "overloaded";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function previewOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, PREVIEW_MAX);
  try {
    return JSON.stringify(value).slice(0, PREVIEW_MAX);
  } catch {
    return String(value).slice(0, PREVIEW_MAX);
  }
}

function dispatchAssistantBlocks(
  blocks: unknown,
  onEvent: ((e: NodeRunEvent) => void) | undefined,
  textCollector?: string[],
): void {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      onEvent?.({ type: "assistant.text", text: b.text });
      textCollector?.push(b.text);
    } else if (
      b.type === "tool_use" &&
      typeof b.id === "string" &&
      typeof b.name === "string"
    ) {
      onEvent?.({
        type: "tool_use",
        toolUseId: b.id,
        name: b.name,
        input: b.input,
      });
    }
  }
}

function dispatchUserContent(
  content: unknown,
  onEvent: ((e: NodeRunEvent) => void) | undefined,
): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;
    let preview = "";
    if (typeof b.content === "string") {
      preview = previewOf(b.content);
    } else if (Array.isArray(b.content)) {
      const first = b.content[0] as Record<string, unknown> | undefined;
      preview = previewOf(first?.text ?? b.content);
    } else {
      preview = previewOf(b.content);
    }
    onEvent?.({
      type: "tool_result",
      toolUseId: b.tool_use_id,
      isError: b.is_error === true,
      preview,
    });
  }
}

function isMaxTurnsError(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  return /max.*turn|turn.*limit|maximum.*turn/i.test(errorMessage);
}

interface SessionResult {
  success: boolean;
  turns: number;
  durationMs: number;
  costUsd?: number;
  sessionId?: string;
  error?: string;
  hitTurnLimit: boolean;
  lastAssistantText: string;
}

async function runSingleSession(
  opts: NodeRunOptions,
  prompt: string,
  turnsPerSession: number,
  processEnv: Record<string, string>,
  textCollector: string[],
): Promise<SessionResult> {
  const additionalDirectories = opts.additionalDirectories ?? [];
  const startTime = Date.now();
  let sessionId: string | undefined;
  let resultTurns = 0;
  let resultDurationMs = 0;
  let resultCostUsd: number | undefined;
  let success = false;
  let errorMessage: string | undefined;
  const sessionText: string[] = [];

  try {
    const q = query({
      prompt,
      options: {
        cwd: opts.cwd,
        allowedTools: opts.allowedTools as string[],
        maxTurns: turnsPerSession,
        additionalDirectories,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: opts.systemPrompt,
        },
        env: processEnv,
      },
    });

    for await (const msg of q) {
      const m = msg as { type?: string } & Record<string, unknown>;
      if (m.type === "system" && m.subtype === "init") {
        const sysCwd = typeof m.cwd === "string" ? m.cwd : opts.cwd;
        const sysModel = typeof m.model === "string" ? m.model : "(unknown)";
        const sid =
          typeof m.session_id === "string" ? m.session_id : undefined;
        if (sid) sessionId = sid;
        opts.onEvent?.({
          type: "system.init",
          sessionId: sid ?? "",
          cwd: sysCwd,
          model: sysModel,
        });
      } else if (m.type === "assistant") {
        const message = m.message as
          | { content?: unknown }
          | undefined;
        dispatchAssistantBlocks(message?.content, opts.onEvent, sessionText);
      } else if (m.type === "user") {
        const message = m.message as
          | { content?: unknown }
          | undefined;
        dispatchUserContent(message?.content, opts.onEvent);
      } else if (m.type === "result") {
        const subtype =
          typeof m.subtype === "string" ? m.subtype : "error";
        success = subtype === "success";
        resultTurns =
          typeof m.num_turns === "number" ? m.num_turns : resultTurns;
        resultDurationMs =
          typeof m.duration_ms === "number"
            ? m.duration_ms
            : Date.now() - startTime;
        resultCostUsd =
          typeof m.total_cost_usd === "number"
            ? m.total_cost_usd
            : undefined;
        if (!success) {
          errorMessage =
            typeof m.result === "string" ? m.result : `subtype=${subtype}`;
        }
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    success = false;
  }

  if (resultDurationMs === 0) resultDurationMs = Date.now() - startTime;
  textCollector.push(...sessionText);

  return {
    success,
    turns: resultTurns,
    durationMs: resultDurationMs,
    costUsd: resultCostUsd,
    sessionId,
    error: errorMessage,
    hitTurnLimit: !success && isMaxTurnsError(errorMessage),
    lastAssistantText: sessionText.join("").slice(-2000),
  };
}

export async function runNode(opts: NodeRunOptions): Promise<NodeRunResult> {
  const env = buildRunnerEnv();
  const processEnv = envToProcessEnv(env);

  const turnsPerSession = opts.maxTurnsPerSession ?? DEFAULT_TURNS_PER_SESSION;
  const totalBudget = opts.maxTurns;
  const startTime = Date.now();

  let totalTurns = 0;
  let totalCostUsd: number | undefined;
  let lastSessionId: string | undefined;
  let lastSuccess = false;
  let lastError: string | undefined;
  let sessionCount = 0;
  let rateLimitRetries = 0;
  const allText: string[] = [];

  let currentPrompt = opts.userPrompt;

  while (totalTurns < totalBudget) {
    sessionCount++;
    const remaining = totalBudget - totalTurns;
    const sessionTurns = Math.min(turnsPerSession, remaining);

    const sessionResult = await runSingleSession(
      opts,
      currentPrompt,
      sessionTurns,
      processEnv,
      allText,
    );

    totalTurns += sessionResult.turns;
    if (sessionResult.costUsd !== undefined) {
      totalCostUsd = (totalCostUsd ?? 0) + sessionResult.costUsd;
    }
    if (sessionResult.sessionId) {
      lastSessionId = sessionResult.sessionId;
    }

    lastSuccess = sessionResult.success;
    lastError = sessionResult.error;

    if (sessionResult.success) {
      break;
    }

    // 端点限流/过载(529/429):指数退避重试,不消耗 turn budget,避免 worker 反复空转。
    // 退避序列:5s, 10s, 20s, 40s, 80s(封顶 120s);5 次后仍失败才放弃(走正常 fail 路径)。
    if (isRateLimitError(sessionResult.error) && rateLimitRetries < MAX_RATELIMIT_RETRIES) {
      rateLimitRetries++;
      totalTurns -= sessionResult.turns; // 限流未真正执行,回退 turn 计数
      const backoffMs = Math.min(BASE_BACKOFF_MS * 2 ** (rateLimitRetries - 1), MAX_BACKOFF_MS);
      opts.onEvent?.({
        type: "assistant.text",
        text: `\n[端点限流 ${rateLimitSignal(sessionResult.error)},第 ${rateLimitRetries}/${MAX_RATELIMIT_RETRIES} 次退避 ${Math.round(backoffMs / 1000)}s 后重试…]\n`,
      });
      await sleep(backoffMs);
      continue;
    }

    if (!sessionResult.hitTurnLimit) {
      break;
    }

    if (totalTurns >= totalBudget) {
      lastError = `Total turn budget exhausted (${totalBudget} across ${sessionCount} sessions)`;
      break;
    }

    currentPrompt = `继续你上一轮未完成的工作。你之前因为 turn 限制被中断了。

上一轮你最后的输出片段:
---
${sessionResult.lastAssistantText.slice(-1000)}
---

请从中断处继续,完成剩余任务。不要重复已完成的工作。
先用 Read / Bash 检查当前状态,再决定下一步。`;

    opts.onEvent?.({
      type: "assistant.text",
      text: `\n[session ${sessionCount} 因 turn 限制中断,已用 ${totalTurns}/${totalBudget} turns,自动续接...]\n`,
    });
  }

  const totalDurationMs = Date.now() - startTime;

  const result: NodeRunResult = {
    success: lastSuccess,
    turns: totalTurns,
    durationMs: totalDurationMs,
  };
  if (totalCostUsd !== undefined) result.costUsd = totalCostUsd;
  if (lastSessionId) result.sessionId = lastSessionId;
  if (lastError && !lastSuccess) result.error = lastError;

  opts.onEvent?.({
    type: "result",
    success: lastSuccess,
    turns: totalTurns,
    durationMs: totalDurationMs,
    ...(totalCostUsd !== undefined ? { costUsd: totalCostUsd } : {}),
    ...(lastError && !lastSuccess ? { error: lastError } : {}),
  });

  return result;
}

export type { AllowedTool };
