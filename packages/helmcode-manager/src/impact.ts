/**
 * Impact — 改动的 standards 文件,影响哪些 cell。
 * 纯逻辑:接收"契约内容快照"(portal 从 DB 读 markdownPath 后注入),grep 引用了被改
 * pattern 文件名(去扩展名)的契约 → 命中的 cell。不依赖 storage(保持 manager 纯净)。
 */

export interface ContractSnapshot {
  cellId: string;
  /** 契约正文(用于 grep pattern 引用) */
  content: string;
}

export interface AffectedCell {
  cellId: string;
  /** 命中的 pattern 名(去 .md) */
  hits: string[];
  reason: string;
}

export interface ImpactResult {
  affectedCells: AffectedCell[];
  total: number;
}

/**
 * @param changedFiles diff 出的 standards 文件(相对 standards/{preset},如 "patterns/decider.md")
 * @param contracts 该项目的契约快照列表(cellId + content)
 */
export function analyzeImpact(changedFiles: string[], contracts: ContractSnapshot[]): ImpactResult {
  if (changedFiles.length === 0 || contracts.length === 0) {
    return { affectedCells: [], total: 0 };
  }

  // pattern 名:取 basename 去扩展名(如 "patterns/decider.md" → "decider"),
  // 也保留全路径片段作为命中关键词
  const keywords = changedFiles.map((f) => {
    const base = f.split("/").pop() ?? f;
    return base.replace(/\.md$/i, "");
  }).filter((k) => k.length > 0);

  const affected: AffectedCell[] = [];
  for (const c of contracts) {
    const hits: string[] = [];
    const lower = c.content.toLowerCase();
    for (const kw of keywords) {
      if (kw && lower.includes(kw.toLowerCase())) {
        hits.push(kw);
      }
    }
    if (hits.length > 0) {
      affected.push({
        cellId: c.cellId,
        hits: Array.from(new Set(hits)),
        reason: `契约引用了被改标准: ${Array.from(new Set(hits)).join(", ")}`,
      });
    }
  }

  return { affectedCells: affected, total: affected.length };
}
