"use client";

import { SkillRunButton } from "@/components/skill-run-button";

interface StartFullLoopButtonProps {
  contractId: string;
  /** Plan 定稿后 Act 传 "code" 跳过 clarify,直奔执行(契约已批准,无需再澄清) */
  startNode?: "code" | "clarify" | "test" | "deploy";
}

// 全流程入口(Act 模式):契约定稿后一键 code→test→deploy。
// 默认含 clarify(全流程);startNode="code" 时跳过 clarify。
// 薄封装 SkillRunButton —— 所有 AI 操作统一"点击跳 run 页"交互。
export function StartFullLoopButton({ contractId, startNode }: StartFullLoopButtonProps) {
  return (
    <SkillRunButton
      label={startNode === "code" ? "启动执行(code→test→deploy)" : "启动全流程"}
      endpoint="/api/orchestrator/start"
      body={{ contractId, ...(startNode ? { startNode } : {}) }}
      runIdField="superRunId"
      variant="act"
    />
  );
}
