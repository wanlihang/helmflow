import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

// 把契约 md 里的 status 改成 newStatus,兼容两种格式:
//   1) HelmCode 中文元信息:  > - 状态: draft   /   > 状态: draft
//   2) 标准 yaml frontmatter: status: draft
// 未命中已知格式则原样返回(不强行改,避免破坏文件)。
function rewriteStatusInMarkdown(md: string, newStatus: string): string {
  const helmRe = /^(>\s*-?\s*状态:\s*)(\S+)\s*$/m;
  if (helmRe.test(md)) {
    return md.replace(helmRe, `$1${newStatus}`);
  }
  const yamlRe = /^(status:\s*)(\S+)\s*$/m;
  if (yamlRe.test(md)) {
    return md.replace(yamlRe, `$1${newStatus}`);
  }
  return md;
}

/** 回写契约 md 文件 status(让 DB 与 md 一致)。best-effort:失败返回 false,不阻塞审批(DB 是权威)。 */
export function rewriteContractMdStatus(markdownPath: string, newStatus: string): boolean {
  try {
    const mdPath = isAbsolute(markdownPath) ? markdownPath : join(process.cwd(), markdownPath);
    const md = readFileSync(mdPath, "utf-8");
    const rewritten = rewriteStatusInMarkdown(md, newStatus);
    if (rewritten !== md) {
      writeFileSync(mdPath, rewritten, "utf-8");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
