// 入队扫描:approved 契约 → pipeline_queue(pending)。
// 仅消费人工 approved 契约(保留需求质量门)。同一 cell 已有 pending/running 则跳过。

import {
  type DB,
  listApprovedContracts,
  getCellRow,
  enqueueIfAbsent,
} from "@helmflow/storage";

const OPERABLE_STATUSES = new Set(["需改造", "待实现"]);

/**
 * 扫描所有 approved 契约,把符合可执行条件的入队。
 * 返回本轮新入队数量。
 */
export function scanAndEnqueue(db: DB, maxAttempts: number): number {
  const contracts = listApprovedContracts(db);
  let enqueued = 0;
  for (const c of contracts) {
    const cell = getCellRow(db, c.cellId);
    if (!cell) continue;
    if (!OPERABLE_STATUSES.has(cell.scenarioStatus)) continue;
    const row = enqueueIfAbsent(db, {
      cellId: c.cellId,
      contractId: c.id,
      maxAttempts,
    });
    if (row) enqueued++;
  }
  return enqueued;
}
