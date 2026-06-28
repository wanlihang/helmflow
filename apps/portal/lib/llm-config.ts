import { type DB, getActiveLLMProvider } from "@helmflow/storage";

/** 官方 anthropic 端点判断(与 packages/agent-runner/src/env.ts 逻辑一致,test 连接选 header 用) */
export function isOfficialAnthropicBase(baseURL?: string): boolean {
  if (!baseURL) return true;
  return /(^|\.)anthropic\.com$/i.test(baseURL);
}

/** 脱敏 apiKey:6 个圆点 + 后 4 位(API 永不回显明文) */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${"•".repeat(6)}${key.slice(-4)}`;
}

/**
 * 把 DB 活跃 provider 同步到 process.env。
 * agent-runner 的 env.ts(buildRunnerEnv)照旧读 HELMFLOW_ANTHROPIC_*,零改动;
 * 有活跃 provider → 覆盖;无活跃 → 不动(回退现有环境变量)。
 * portal/worker 调 runNode 前调一次,active 变更后立即生效。
 */
export function syncActiveLLMToEnv(db: DB): void {
  const active = getActiveLLMProvider(db);
  if (!active) return;
  // 带 HELMFLOW_ 前缀(agent-runner buildRunnerEnv 读)
  process.env.HELMFLOW_ANTHROPIC_API_KEY = active.apiKey;
  process.env.HELMFLOW_ANTHROPIC_BASE_URL = active.baseUrl;
  process.env.HELMFLOW_ANTHROPIC_MODEL = active.model;
  // 无前缀 ANTHROPIC_* —— claude-agent-sdk 的 native binary 子进程实际读这些
  // (它继承父 process.env,而非 SDK 的 options.env)。若不覆盖,.env.local 里残留的
  // 旧配置(如智谱 glm-5.2/open.bigmodel.cn)会让 agent 用错端点+model → 529。
  const official = isOfficialAnthropicBase(active.baseUrl);
  process.env.ANTHROPIC_BASE_URL = active.baseUrl;
  process.env.ANTHROPIC_MODEL = active.model;
  if (official) {
    process.env.ANTHROPIC_API_KEY = active.apiKey;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  } else {
    // 第三方端点用 Bearer(AUTH_TOKEN);清掉 API_KEY 避免 SDK 同时发 x-api-key 头
    process.env.ANTHROPIC_AUTH_TOKEN = active.apiKey;
    delete process.env.ANTHROPIC_API_KEY;
  }
}
