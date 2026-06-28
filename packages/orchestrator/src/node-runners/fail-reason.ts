// failReason 映射:把 agent-runner 的 errorKind 翻译成 orchestrator 的 FailReason。
// 复用于 clarify/code/test/deploy 四节点,集中"transient-infra → infra-error"判定,
// 避免每个 runner 各写一遍。

import type { ErrorKind } from "@helmflow/agent-runner";
import type { FailReason } from "../state-machine";

/**
 * transient-infra(529/网络) → infra-error(当前节点原地退避重试,不回退上游);
 * 否则用各节点传入的 fatalReason(走原有业务回退路由)。
 * success 时返回 undefined。
 */
export function mapFailReason(
  success: boolean,
  errorKind: ErrorKind | undefined,
  fatalReason: FailReason,
): FailReason | undefined {
  if (success) return undefined;
  return errorKind === "transient-infra" ? "infra-error" : fatalReason;
}
