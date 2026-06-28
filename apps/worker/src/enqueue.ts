// 入队扫描:approved 契约 → pipeline_queue(pending)。
// 仅消费人工 approved 契约(保留需求质量门)。同一 contract 已有 pending/running/blocked/failed 则跳过。
// 需求驱动通路(requirement-owned):approved 即资格,无 scenarioStatus 概念。

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
    // 需求驱动通路:requirement-owned 契约,approved 即可入队(不查 scenarioStatus)。
    if (c.requirementId) {
      const row = enqueueIfAbsent(db, {
        cellId: c.cellId,
        contractId: c.id,
        requirementId: c.requirementId,
        maxAttempts,
      });
      if (row) enqueued++;
      continue;
    }
    // 矩阵通路:按 cell scenarioStatus 过滤(仅"需改造/待实现"可执行)。
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
