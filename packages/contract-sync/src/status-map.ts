/**
 * HelmCode 契约 status → HelmFlow scenarioStatus 映射。
 *
 * 映射规则(用户确认):
 *   done          → 已支持   (开发已完成)
 *   approved      → 已支持   (契约已审批,视为可达成)
 *   goal-running  → 需改造   (HelmFlow 无 goal-running,映射需改造)
 *   draft         → 待实现   (契约草稿,功能未实现)
 */
import type { HelmcodeStatus, ScenarioStatus } from "./types";

const STATUS_MAP: Record<HelmcodeStatus, ScenarioStatus> = {
  done: "已支持",
  approved: "已支持",
  "goal-running": "需改造",
  draft: "待实现",
};

export function mapHelmcodeStatusToScenario(status: HelmcodeStatus): ScenarioStatus {
  return STATUS_MAP[status];
}
