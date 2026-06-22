/**
 * inventory 缓存读取(analyze 拆分用)。
 * scan 阶段(analyze-scan run)产 inventory,存该 run 的 scan-done event payload。
 * classify 阶段从这里读最近一份 inventory 复用(不重复扫)。
 *
 * InventoryItem 类型统一从 @helmflow/adapter-java-ddd 导入(scanner 是权威定义)。
 */

import type { InventoryItem } from "@helmflow/adapter-java-ddd";
import type { DB } from "@helmflow/storage";
import { listRunEvents, listRunsByKind } from "@helmflow/storage";

export type { InventoryItem };

/**
 * 取最近一次 analyze-scan run 的 scan-done event,解析其 inventory。
 * @returns inventory 数组;无缓存返回 null
 */
export function getLatestScanInventory(db: DB): InventoryItem[] | null {
  const scanRuns = listRunsByKind(db, "analyze-scan", 10);
  for (const r of scanRuns) {
    if (r.state !== "done" && r.state !== "applied") continue;
    const events = listRunEvents(db, r.id);
    for (const ev of events) {
      try {
        const payload = JSON.parse(ev.payload);
        if (payload.type === "scan-done" && Array.isArray(payload.inventory)) {
          return payload.inventory as InventoryItem[];
        }
      } catch {
        // skip
      }
    }
  }
  return null;
}
