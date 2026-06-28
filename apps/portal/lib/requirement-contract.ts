// 需求驱动通路 — 契约定稿共享 helpers(对话式 clarify 的 finalize 阶段使用)。
// 与 clarify/route.ts 的单 shot 版同源,但需求用 requirementId 作 featureId、域固定"需求驱动"。

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Issue, runClarifierCritic } from "@helmflow/agent-core";
import { parseContract } from "@helmflow/contract-schema";

/** HelmCode 契约 header(引用块业务元)。需求用 requirementId 作 Feature ID。 */
export function synthesizeRequirementContractHeader(
  requirementId: string,
  title: string,
): string {
  return [
    `# Feature: ${requirementId}`,
    "",
    "> 元信息(由 HelmFlow 需求驱动 Clarifier 自动填写)",
    `> - Feature ID: ${requirementId}`,
    `> - 名称: ${title}`,
    "> - 涉及领域: 需求驱动",
    "> - 状态: draft",
    "",
  ].join("\n");
}

/** 把契约写到目标项目 .claude/contracts/{requirementId}.md(R- 前缀命名空间,区别 cell 的 D-XX__xxx.md)。 */
export function writeRequirementContractFile(args: {
  sandboxPath: string;
  requirementId: string;
  markdown: string;
}): string {
  const dir = join(args.sandboxPath, ".claude", "contracts");
  const absPath = join(dir, `${args.requirementId}.md`);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, args.markdown, "utf-8");
  return absPath;
}

export function hashMarkdown(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex").slice(0, 16);
}

/**
 * 采集覆盖指令:finalize 阶段追加到 user prompt,禁止工具、强制一次输出完整契约 markdown。
 * 对话阶段(message)不加此指令,让 clarify skill 原生 interactive(提问/读代码)。
 */
export const CONTRACT_FINALIZE_OVERRIDE =
  "\n\n---\n【HelmFlow 采集覆盖指令(优先级最高,覆盖上文任何「写文件」要求)】\n" +
  "禁止使用任何工具(Bash/Write/Edit 等)。将完整的行为契约 markdown 直接作为回复正文输出,须依次包含:\n" +
  "# Feature 标题;引用块业务元(> - Feature ID / > - 涉及领域 / > - 状态);## 问题定义;## 状态机;## 业务规则(BR-xxx,每条可验证);## 验收条件(AC-xxx,≥3 条,每条可验证);## API 契约;## 领域模型。\n" +
  "回复正文会被原样采集为契约——不要输出思考过程或解释,不要调用工具,一次性输出完整契约 markdown。";

export function buildReflection(issues: Issue[]): string {
  return [
    "## 上一轮 Critic 反馈(本轮重写时严格修复以下问题)",
    ...issues.map((i) => `- [${i.check}] ${i.detail}`),
  ].join("\n");
}

export interface ValidateResult {
  ok: boolean;
  markdown: string;
  issues: Issue[];
}

/** 跑 parseContract + runClarifierCritic。 */
export function validateContractMarkdown(markdown: string): ValidateResult {
  const parsed = parseContract(markdown);
  if (!parsed.ok) {
    return {
      ok: false,
      markdown,
      issues: parsed.errors.map((e) => ({ check: "contract-parse", detail: e })),
    };
  }
  const critic = runClarifierCritic(parsed.data);
  if (!critic.pass) {
    return { ok: false, markdown, issues: critic.issues };
  }
  return { ok: true, markdown, issues: [] };
}
