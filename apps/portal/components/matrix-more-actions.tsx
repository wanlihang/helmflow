"use client";

import { AnalyzeAllButton } from "@/components/analyze-all-button";
import { AnalyzeStructureButton } from "@/components/analyze-structure-button";
import { Button } from "@/components/ui/button";
import { useState } from "react";

/**
 * 矩阵页「更多操作」下拉 —— 低频的结构/状态维护操作收拢于此,
 * 让首页 header 干净(主体是看矩阵)。含:
 *   - 识别结构(结构变更时重新识别 BizScene/Feature/Decider 网格)
 *   - 重新分析状态(全量刷新所有功能点的实现状态)
 * 首次建矩阵的「识别结构」在 EmptyMatrixGuide 里;单 cell 分析在 cell 详情页。
 */
export function MatrixMoreActions({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="outline" size="sm" type="button" onClick={() => setOpen((o) => !o)}>
        ⋯ 更多操作
      </Button>
      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-80 max-h-[70vh] overflow-auto rounded-md border border-border bg-card p-3 shadow-lg">
            <div className="mb-1 text-[10px] text-muted-foreground">结构变更时重新识别矩阵</div>
            <AnalyzeStructureButton projectId={projectId} />
            <div className="mb-1 mt-3 border-t border-border pt-2 text-[10px] text-muted-foreground">
              刷新所有功能点的实现状态(代码 × 契约矩阵)
            </div>
            <AnalyzeAllButton />
          </div>
        </>
      ) : null}
    </div>
  );
}
