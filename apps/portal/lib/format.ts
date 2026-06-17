/**
 * 共享格式化工具(前端组件复用)。
 */

/** 相对时间:"3s 前" / "5min 前" / "2h 前" / "3d 前"。 */
export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 0) return "刚刚";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s 前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min 前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h 前`;
  return `${Math.floor(h / 24)}d 前`;
}
