// 预算治理:基于 run_events 中 node-done 事件的 costUsd 统计当日花费,
// 超 HELMFLOW_DAILY_BUDGET_USD 则暂停取新任务(已在 running 的不中断)。

import { type DB, sumNodeDoneCostSince } from "@helmflow/storage";

export interface BudgetGuard {
  dailyBudgetUsd?: number;
  spentUsd: number;
}

/** 本地时区当日 0 点的 ISO 时间(预算按本地日历日重置)。 */
function startOfDayIso(): string {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  ).toISOString();
}

export function createBudgetGuard(dailyBudgetUsd?: number): BudgetGuard {
  return { dailyBudgetUsd, spentUsd: 0 };
}

export function refreshSpent(db: DB, guard: BudgetGuard): number {
  guard.spentUsd = sumNodeDoneCostSince(db, startOfDayIso());
  return guard.spentUsd;
}

/** 是否超预算(返回 true 表示应暂停取新任务)。未设上限时永返回 false。 */
export function isBudgetExceeded(guard: BudgetGuard): boolean {
  if (guard.dailyBudgetUsd === undefined) return false;
  return guard.spentUsd >= guard.dailyBudgetUsd;
}
