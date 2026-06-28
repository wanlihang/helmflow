// 4 节点 Pipeline 状态机:clarify → code → test → deploy
// 取代旧的 coder/testgen/qa/committer 序列。
// 需求/代码/测试三节点消费 HelmCode Skills,上线节点消费本地 helmflow-deploy skill。
// 失败回路:每节点有独立 max retry,全局有跨节点回路上限。

export const NODES = ["clarify", "code", "test", "deploy"] as const;

export type PipelineNode = (typeof NODES)[number];

/**
 * 失败原因分类,用于决定回退策略。
 */
export type FailReason =
  | "spec-rejected"   // 需求 Critic 不通过 → 回退 clarify
  | "build-failed"    // implement 自愈失败 → 回退 code
  | "test-failed"     // verify 有失败 → 回退 code
  | "git-error"      // deploy git 操作失败 → 回退 deploy
  | "infra-error";   // 529/网络等 transient → 当前节点原地退避重试(不回退、独立计数)

/**
 * 每节点最大重试次数。
 */
const MAX_RETRIES: Record<PipelineNode, number> = {
  clarify: 3,
  code: 3,
  test: 3,
  deploy: 2,
};

/** 全局跨节点回路上限 */
const MAX_GLOBAL_LOOPS = 5;

/** 单节点 infra(529/网络)独立重试上限:不消耗业务 MAX_RETRIES、不进 globalLoops。
 *  可用 HELMFLOW_INFRA_RETRIES 覆盖。 */
const MAX_INFRA_RETRIES = Number(process.env.HELMFLOW_INFRA_RETRIES ?? 3);

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
  /** 当前节点的 infra(529/网络)重试计数,独立于业务 retry。 */
  infraRetryCount?: number,
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

  // infra-error(529/网络):当前节点原地退避重试,不回退上游、不消耗业务 retry、不进 globalLoops。
  // 必须在 globalLoops 检查之前,否则 infra 失败会被全局回路预算误杀。
  if (failReason === "infra-error") {
    const infraRetries = infraRetryCount ?? 0;
    if (infraRetries >= MAX_INFRA_RETRIES) {
      return {
        action: "blocked",
        reason: `Infra retry limit reached (${MAX_INFRA_RETRIES})`,
      };
    }
    return { action: "retry", node: current, reason: "infra-error" };
  }

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
      routeTo = "clarify";
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

export { MAX_RETRIES, MAX_GLOBAL_LOOPS, MAX_INFRA_RETRIES };