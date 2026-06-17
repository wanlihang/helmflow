/**
 * LLM 辅助匹配 — 纯函数(prompt 构建 + 结果解析),不依赖 agent-runner。
 * 实际 LLM 调用由调用方(portal)用 @helmflow/agent-runner 的 runClassify 发起。
 *
 * 场景:HelmCode 直开的契约(无 matrixCellId)启发式匹配置信度不足时,
 * 用 LLM 把契约语义(Feature 名/领域/问题定义)匹配到 matrix feature 中文名。
 */

import type { HelmcodeContractMeta, MatrixFeature } from "./types";

export interface LlmMatchOutcome {
  cellId: string | null; // 命中 cell,null=LLM 判定无匹配
  confidence: number; // 0..1
  reason: string;
}

/**
 * 构建 LLM 匹配 prompt。给 LLM 契约语义摘要 + matrix features 清单,
 * 要求返回最匹配的 cellId(XML 标签包裹 JSON,便于解析)。
 */
export function buildLlmMatchPrompt(meta: HelmcodeContractMeta, features: MatrixFeature[]): string {
  const featureLines = features
    .flatMap((f) =>
      f.scenarios
        .filter((s) => s.status !== "废弃")
        .map((s) => `- cellId: ${f.id}__${s.name} | feature: ${f.name}(${f.id}) | domain: ${f.domain} | handler: ${f.handler}`),
    )
    .join("\n");

  return `## 任务

判断下方契约对应 matrix 中的哪个 cell(feature × scenario)。基于语义匹配(功能含义、领域、handler)。

## 契约信息
- Feature ID: ${meta.featureId}
- 涉及领域: ${meta.domain || "(未标注)"}
- 短名: ${meta.featureShortName}

## matrix cells 候选
${featureLines}

## 判断规则
- 找出语义最匹配的 cell(功能含义一致,非名字相似)
- 若无任何匹配,cellId 返回 null
- confidence: 匹配置信度 0..1(≥0.6 才建议采纳)

## 输出格式
只输出 <MATCH></MATCH> 标签包裹的 JSON,不要其他内容:

<MATCH>{"cellId":"D-05__正式签约","confidence":0.85,"reason":"契约描述的前进交付对应 matrix 的前进功能"}</MATCH>

无匹配时:
<MATCH>{"cellId":null,"confidence":0,"reason":"无对应功能"}</MATCH>`;
}

/** 从 markdown 中提取第一个代码围栏块(json)内容 */
function extractFence(md: string): string | null {
  const m = md.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return m && m[1] ? m[1].trim() : null;
}

/**
 * 解析 LLM 匹配输出。容忍:<MATCH>标签、代码围栏、裸 JSON。
 * 解析失败或 cellId 不在候选集 → 返回 null cellId。
 */
export function parseLlmMatchResult(
  text: string,
  features: MatrixFeature[],
): LlmMatchOutcome {
  // 1) 提取 <MATCH>...</MATCH>
  let raw: string | null = null;
  const tagM = text.match(/<MATCH>([\s\S]*?)<\/MATCH>/i);
  if (tagM && tagM[1]) {
    raw = tagM[1].trim();
    const fence = extractFence(raw);
    if (fence) raw = fence;
  } else {
    const fence = extractFence(text);
    if (fence) raw = fence;
  }

  if (!raw) {
    return { cellId: null, confidence: 0, reason: "LLM 输出无 MATCH 标签" };
  }

  let parsed: { cellId?: unknown; confidence?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { cellId: null, confidence: 0, reason: "LLM 输出 JSON 解析失败" };
  }

  const cellId = typeof parsed.cellId === "string" ? parsed.cellId : null;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const reason = typeof parsed.reason === "string" ? parsed.reason : "";

  // 校验 cellId 确实在候选集(防 LLM 编造)
  if (cellId !== null) {
    const valid = features.some((f) =>
      f.scenarios.some((s) => `${f.id}__${s.name}` === cellId && s.status !== "废弃"),
    );
    if (!valid) {
      return { cellId: null, confidence: 0, reason: `LLM 返回的 cellId 不在候选集: ${cellId}` };
    }
  }

  return { cellId, confidence, reason };
}
