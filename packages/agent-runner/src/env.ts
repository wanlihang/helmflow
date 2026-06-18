// runtime env 装配:Portal 用 HELMFLOW_ANTHROPIC_* 命名以避免污染外层 ANTHROPIC_*,
// 这里把它们映射回 Agent SDK 期望的 ANTHROPIC_* + 强制注入两个固定 flag:
//  - ANTHROPIC_MODEL=glm-5.2
//  - CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1(智谱 baseURL 下 tool_use 兼容性要求)
//
// 认证方式说明:
//  - 官方 api.anthropic.com 端点:密钥通过 x-api-key 头传递 → 对应 ANTHROPIC_API_KEY
//  - 第三方 Anthropic 兼容端点(如智谱 open.bigmodel.cn/api/anthropic):密钥须通过
//    Authorization: Bearer 头传递 → 对应 ANTHROPIC_AUTH_TOKEN
//  因此检测到非官方 baseURL 时,把 apiKey 自动降级为 authToken,避免 401 无效的 AuthKey。

// 默认对齐 Claude Code opus 映射的 glm-5.2[1M](1M 上下文版):同 key 同端点下,
// 普通 glm-5.2 易触发 529 限流(配额/限流池不同),而 [1M] 变体不限流(实测聊天用此模型)。
// 可用 HELMFLOW_ANTHROPIC_MODEL 覆盖。
const DEFAULT_MODEL = "glm-5.2[1M]";

export interface RunnerEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_MODEL: string;
  CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: string;
}

function isOfficialAnthropicBase(baseURL?: string): boolean {
  if (!baseURL) return true; // 未设 baseURL 走官方默认
  return /(^|\.)anthropic\.com$/i.test(baseURL);
}

export function buildRunnerEnv(): RunnerEnv {
  const apiKey =
    process.env.HELMFLOW_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  const authToken =
    process.env.HELMFLOW_ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_AUTH_TOKEN;
  const baseURL =
    process.env.HELMFLOW_ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL;

  if (!apiKey && !authToken) {
    throw new Error(
      "agent-runner: HELMFLOW_ANTHROPIC_API_KEY (or HELMFLOW_ANTHROPIC_AUTH_TOKEN) must be set",
    );
  }

  const official = isOfficialAnthropicBase(baseURL);
  // 第三方端点用 Bearer(authToken)方式;若只配了 apiKey,自动转成 authToken。
  const effectiveAuthToken =
    authToken || (official ? undefined : apiKey);
  // 官方端点保留 x-api-key(apiKey)方式;第三方端点不设 apiKey 以免 SDK 同时发出 x-api-key 头。
  const effectiveApiKey = official ? apiKey : undefined;

  const env: RunnerEnv = {
    ANTHROPIC_MODEL: process.env.HELMFLOW_ANTHROPIC_MODEL || DEFAULT_MODEL,
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
  };
  if (effectiveApiKey) env.ANTHROPIC_API_KEY = effectiveApiKey;
  if (effectiveAuthToken) env.ANTHROPIC_AUTH_TOKEN = effectiveAuthToken;
  if (baseURL) env.ANTHROPIC_BASE_URL = baseURL;
  return env;
}

// 把 RunnerEnv 合并到当前 process.env 副本上,供 SDK query() 通过子进程继承使用
export function envToProcessEnv(env: RunnerEnv): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") merged[k] = v;
  }
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") merged[k] = v;
  }
  return merged;
}
