// 轻量 LLM 分类调用 — 统一走 Agent SDK (runNode)，不再依赖 @anthropic-ai/sdk。
// 用 maxTurns=1 + allowedTools=[] 实现单轮纯文本补全，保持与 runNode 相同的鉴权链路。

import { runNode } from "./runner";
import type { NodeRunEvent } from "./types";

export interface ClassifyOptions {
  /** Agent 子进程 cwd，默认 process.cwd() */
  cwd?: string;
  /** system prompt（分类规则 / 角色定义） */
  systemPrompt: string;
  /** user message（待分类数据 + 指令） */
  userPrompt: string;
  /** 最大输出 token 数（仅供参考，Agent SDK 不直接控制此值） */
  maxTokens?: number;
}

export interface ClassifyResult {
  /** 模型回复文本 */
  text: string;
  /** 耗时 ms */
  durationMs: number;
}

export async function runClassify(opts: ClassifyOptions): Promise<ClassifyResult> {
  const collectedText: string[] = [];

  const result = await runNode({
    cwd: opts.cwd ?? process.cwd(),
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
    allowedTools: [],          // 纯文本补全，不需要工具
    maxTurns: 1,               // 单轮即止
    onEvent: (event: NodeRunEvent) => {
      if (event.type === "assistant.text") {
        collectedText.push(event.text);
      }
    },
  });

  if (!result.success) {
    throw new Error(`runClassify agent failed: ${result.error ?? "unknown"}`);
  }

  return {
    text: collectedText.join(""),
    durationMs: result.durationMs,
  };
}
