// HelmFlow node-runner 对外契约。把 Agent SDK 流式事件规格化成 5 类节点事件,
// 上层 Portal 只需要消费这 5 类(转 SSE 给前端),不再耦合 SDK 内部消息形态。

export type AllowedTool =
  | "Read"
  | "Write"
  | "Edit"
  | "Bash"
  | "Glob"
  | "Grep";

export interface NodeRunOptions {
  // 子进程 cwd。Bash / Read / Write 默认基于此目录。
  cwd: string;
  // system prompt — 由调用方拼好(可来自 SKILL.md 或外部模板),agent-runner 不再
  // 关心 SKILL 文件解析。
  systemPrompt: string;
  // 单次 user message
  userPrompt: string;
  // SDK allowedTools 白名单。Clarifier 通常只给 Read;Coder 给 Read/Write/Edit/Bash。
  allowedTools: AllowedTool[];
  // 总 turns 预算(跨所有 session 累加)
  maxTurns: number;
  // SDK 单 session 允许的最大 turns。受 API tier 限制时降低此值(默认 5)。
  // runNode 会自动开多个 session 直到总 turns 达到 maxTurns 预算或任务完成。
  maxTurnsPerSession?: number;
  // 允许 Bash / Write 触及 cwd 之外的额外目录(给 Coder 看 standards 用)
  additionalDirectories?: string[];
  // 流式事件回调。返回 false 可早停(暂未启用,占位)。
  onEvent?: (event: NodeRunEvent) => void;
  // 续接已有 session(claude-agent-sdk resume):传 sessionId 则 query resume 续上下文,
  // 用于交互式注入(用户在 run-detail 手动续聊/输 /命令)。不传则新 session。
  resumeSessionId?: string;
}

// phase 标记事件来自主实现(primary)还是对抗式自检(self-check)轮,前端据此区分展示。
export type NodeRunEvent = {
  phase?: "primary" | "self-check";
} & (
  | { type: "system.init"; sessionId: string; cwd: string; model: string }
  | { type: "agent.input"; systemPrompt: string; userPrompt: string }
  | { type: "assistant.text"; text: string }
  | {
      type: "tool_use";
      toolUseId: string;
      name: string;
      // 工具入参摘要(供 UI 展示,不必全量);文本 / 路径优先
      input: unknown;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      // 工具回执的 string / object 形态
      isError: boolean;
      // 文本预览(裁剪到 ~500 chars,UI 不需要全量)
      preview: string;
    }
  | {
      type: "result";
      success: boolean;
      turns: number;
      durationMs: number;
      costUsd?: number;
      // SDK 报错时,error message 透出供 UI 调试
      error?: string;
    }
);

/** 错误归类:transient-infra=529/网络等可退避重试的基础设施错误;fatal=业务失败。 */
export type ErrorKind = "transient-infra" | "fatal";

export interface NodeRunResult {
  success: boolean;
  turns: number;
  durationMs: number;
  costUsd?: number;
  sessionId?: string;
  error?: string;
  /** 失败时的错误归类(供 orchestrator 区分 infra 退避重试 vs 业务回退)。success 时不设。 */
  errorKind?: ErrorKind;
}
