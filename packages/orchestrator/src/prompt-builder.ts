import type { FixTaskRow, ReflectionRow } from "@helmflow/storage";

export function buildReflectionAppendix(
  reflections: ReflectionRow[],
): string {
  if (reflections.length === 0) return "";
  const lines = reflections.map(
    (r) =>
      `[${r.id}] ${r.createdAt} | ${r.nodeName}${r.criticName ? ` failed ${r.criticName}` : ""}\n"${r.reflectionText}"`,
  );
  return `\n\n## Past Reflections (must avoid repeating these mistakes)\n\n${lines.join("\n\n")}\n\nApply these lessons to your work. Do not repeat the same mistakes.\n`;
}

export function buildFixTaskAppendix(fixTasks: FixTaskRow[]): string {
  if (fixTasks.length === 0) return "";
  const lines = fixTasks.map(
    (ft) =>
      `### Fix Task ${ft.id}\n- failedAcId: ${ft.failedAcId}\n- expectedBehavior: ${ft.expectedBehavior}\n- actualBehavior: ${ft.actualBehavior}\n- evidence: ${ft.evidence}`,
  );
  return `\n\n## Fix Tasks (from QA failures — you must address these)\n\n${lines.join("\n\n")}\n`;
}
