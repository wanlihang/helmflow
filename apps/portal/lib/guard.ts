import { type FeatureScenarioRow, getCellRow } from "@helmflow/storage";
import type { DB } from "@helmflow/storage";

const OPERABLE_STATUSES = new Set(["需改造", "待实现"]);

export function guardCellOperable(
  db: DB,
  cellId: string,
): { ok: true; cell: FeatureScenarioRow } | { ok: false; error: string; status: number } {
  const cell = getCellRow(db, cellId);
  if (!cell) {
    return { ok: false, error: `Cell not found: ${cellId}`, status: 404 };
  }
  if (!OPERABLE_STATUSES.has(cell.scenarioStatus)) {
    return {
      ok: false,
      error: `Cell scenario status "${cell.scenarioStatus}" does not allow agent operations. Only "需改造" and "待实现" cells can be operated.`,
      status: 400,
    };
  }
  return { ok: true, cell };
}
