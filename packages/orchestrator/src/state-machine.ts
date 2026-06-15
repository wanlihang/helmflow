// 4 节点 Pipeline 状态机:require → code → test → deploy
// 取代旧的 coder/testgen/qa/committer 序列。
// 需求/代码/测试三节点消费 HelmCode Skills,上线节点消费本地 helmflow-deploy skill。
// 失败回路:每节点有独立 max retry,全局有跨节点回路上限。

export const NODES = ["require", "code", "test", "deploy"] as const;

export type PipelineNode = (typeof NODES)[number];

/**
 * 失败原因分类,用于决定回退策略。
 */
export type FailReason =
  | "spec-rejected"   // 需求 Critic 不通过 → 回退 require
  | "build-failed"    // implement 自愈失败 → 回退 code
  | "test-failed"     // verify 有失败 → 回退 code
  | "git-error";      // deploy git 操作失败 → 回退 deploy

/**
 * 每节点最大重试次数。
 */
const MAX_RETRIES: Record<PipelineNode, number> = {
  require: 3,
  code: 3,
  test: 3,
  deploy: 2,
};

/** 全局跨节点回路上限 */
const MAX_GLOBAL_LOOPS = 5;

export interface Transition {
  action: "next" | "done" | "retry" | "blocked";
  node?: PipelineNode;
  reason?: string;
}

/**
 * 决定下一个动作。
 * - pass → 推进到下一节点或 done
 * - fail → 根据当前节点和 failReason 决定回退目标
 * - 超过节点重试上限 → blocked
 * - 超过全局回路上限 → blocked
 */
export function nextNode(
  current: PipelineNode,
  outcome: "pass" | "fail",
  failReason?: FailReason,
  nodeRetryCount?: number,
  globalLoopCount?: number,
  /** Per-node retry counts — when provided, the route-target node's count is
   *  used instead of the caller-supplied `nodeRetryCount`.  This fixes the bug
   *  where callers passed the *current* node's retry count rather than the
   *  target node's. */
  allNodeRetries?: Record<PipelineNode, number>,
): Transition {
  const globalLoops = globalLoopCount ?? 0;

  if (outcome === "pass") {
    const idx = NODES.indexOf(current);
    if (idx === NODES.length - 1) {
      return { action: "done" };
    }
    return { action: "next", node: NODES[idx + 1]! };
  }

  // outcome === "fail"

  // 全局回路超限
  if (globalLoops >= MAX_GLOBAL_LOOPS) {
    return {
      action: "blocked",
      reason: `Global loop limit reached (${MAX_GLOBAL_LOOPS})`,
    };
  }

  // 确定回退目标节点
  let routeTo: PipelineNode;
  switch (failReason) {
    case "spec-rejected":
      routeTo = "require";
      break;
    case "build-failed":
      routeTo = "code";
      break;
    case "test-failed":
      routeTo = "code";
      break;
    case "git-error":
      routeTo = "deploy";
      break;
    default:
      // 无明确 failReason 时回退当前节点
      routeTo = current;
  }

  // 检查节点重试上限 — 使用目标节点的重试计数器
  const retries = allNodeRetries
    ? (allNodeRetries[routeTo] ?? 0)
    : (nodeRetryCount ?? 0);
  const maxRetries = MAX_RETRIES[routeTo];
  if (retries >= maxRetries) {
    return {
      action: "blocked",
      reason: `Node "${routeTo}" retry limit reached (${maxRetries})`,
    };
  }

  return { action: "retry", node: routeTo, reason: failReason };
}

export { MAX_RETRIES, MAX_GLOBAL_LOOPS };