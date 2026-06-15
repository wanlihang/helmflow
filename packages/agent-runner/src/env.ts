// runtime env 装配:Portal 用 HELMFLOW_ANTHROPIC_* 命名以避免污染外层 ANTHROPIC_*,
// 这里把它们映射回 Agent SDK 期望的 ANTHROPIC_* + 强制注入两个固定 flag:
//  - ANTHROPIC_MODEL=glm-5.1
//  - CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1(智谱 baseURL 下 tool_use 兼容性要求)

const FIXED_MODEL = "glm-5.1";

export interface RunnerEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_MODEL: string;
  CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: string;
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

  const env: RunnerEnv = {
    ANTHROPIC_MODEL: FIXED_MODEL,
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
  };
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken;
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
