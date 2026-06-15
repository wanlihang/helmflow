// Critic 通用类型。所有 deterministic / LLM critic 都返回同一形状,
// 让 orchestrator 不关心具体 critic 实现就能聚合 issues、生成 reflection。

export interface Issue {
  /** 命中的 check 标识,稳定的 kebab-case 字符串,用于 UI 分组与日志检索 */
  check: string;
  /** 给用户 / 给下一轮 Worker 看的中文细节;允许带换行 */
  detail: string;
}

export interface CriticResult {
  pass: boolean;
  issues: Issue[];
}
