/**
 * HelmCode 契约解析 — 与 packages/contract-schema 的 parseContract 并存。
 *
 * HelmCode 契约格式(见 helmcode core/clarify/references/contract-template.md):
 *   - 业务元在引用块 `> - Feature ID:` / `> - 涉及领域:` / `> - 状态:`
 *   - frontmatter 是模板级元(name/version/description),非业务元
 *   - 章节:问题定义/业务规则/验收条件/领域模型/...
 * 与 HelmFlow 现有 ContractSchema(6 章节 + frontmatter 业务元)不兼容,故独立解析。
 */

import { z } from "zod";
import type {
  HelmcodeContractMeta,
  HelmcodeStatus,
  ParseHelmcodeResult,
  RegistryRow,
} from "./types";

const HelmcodeStatusSchema = z.enum([
  "draft",
  "approved",
  "goal-running",
  "done",
]);

/**
 * 从引用块提取业务元。宽松匹配 `>` 后可选空白 + `-` + key + 冒号 + value。
 * 支持中英文 key(FEature ID / 涉及领域 / 状态)。
 */
function extractQuoteField(md: string, key: string): string | null {
  // `key` 是中文或英文,正则转义
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `^>\\s*-?\\s*${escaped}\\s*[:：]\\s*(.+?)\\s*$`,
    "im",
  );
  const m = md.match(re);
  return m && m[1] ? m[1].trim() : null;
}

function splitSections(body: string): Map<string, string> {
  const lines = body.split(/\r?\n/);
  const sections = new Map<string, string>();
  let cur: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur !== null) sections.set(cur, buf.join("\n").trim());
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (m && m[1]) {
      flush();
      cur = m[1].trim();
    } else if (cur !== null) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

function countMatches(block: string | undefined, re: RegExp): number {
  if (!block) return 0;
  const matches = block.match(new RegExp(re.source, "g"));
  return matches ? matches.length : 0;
}

/**
 * 解析一份 HelmCode 契约 markdown。
 * @param markdown 契约正文
 * @param filePath 该契约的绝对路径(仅用于回填 meta.filePath)
 */
export function parseHelmcodeContract(
  markdown: string,
  filePath: string,
): ParseHelmcodeResult {
  const errors: string[] = [];

  // Feature ID:引用块优先,fallback 文件名
  let featureId =
    extractQuoteField(markdown, "Feature ID") ??
    extractQuoteField(markdown, "Feature Id") ??
    "";

  const domain =
    extractQuoteField(markdown, "涉及领域") ??
    extractQuoteField(markdown, "领域") ??
    "";

  const statusRaw =
    extractQuoteField(markdown, "状态") ??
    extractQuoteField(markdown, "Status") ??
    "";

  // matrixCellId:HelmFlow 专属字段(自产契约携带,导入时精确命中 cell)。可选。
  const matrixCellId = extractQuoteField(markdown, "matrixCellId") ?? "";

  // 正文 cell 引用:抓全文所有 [A-Z]{1,3}-\d{2} token(去重)。老契约元信息无 matrixCellId 时,
  // 正文「覆盖 D-01 创建」这类自声明是关键匹配信号。含 AC-00/DR-XX 等噪声,match 阶段按 feature.id 过滤。
  const rawCellRefs = Array.from(new Set(markdown.match(/\b[A-Z]{1,3}-\d{2}\b/g) ?? []));

  if (!featureId) {
    // fallback:从引用块 `# Feature: F001-recon-task` 标题提取
    const titleM = markdown.match(/^#\s+Feature:\s*(\S+)\s*$/m);
    featureId = titleM && titleM[1] ? titleM[1] : "";
  }

  if (!featureId) {
    errors.push("缺少 Feature ID(引用块 `> - Feature ID:` 或标题 `# Feature:`)");
  }

  const statusParse = HelmcodeStatusSchema.safeParse(statusRaw);
  if (!statusParse.success) {
    errors.push(
      `status 非法或缺失(期望 draft|approved|goal-running|done,实际 "${statusRaw}")`,
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // featureShortName: 去 F001- / F001_ 前缀
  const shortName = featureId.replace(/^F\d+[-_]/i, "");

  const sections = splitSections(markdown);
  const brCount = countMatches(sections.get("业务规则"), /-+\s*\*?\*?BR-\d{3}/);
  const acCount = countMatches(sections.get("验收条件"), /AC-\d{3}/);
  const hasDomainModel = sections.has("领域模型");

  const meta: HelmcodeContractMeta = {
    featureId,
    featureShortName: shortName,
    domain: domain || "",
    status: statusParse.data as HelmcodeStatus,
    matrixCellId,
    rawCellRefs,
    acCount,
    brCount,
    hasDomainModel,
    filePath,
  };

  return { ok: true, data: meta };
}

/**
 * 解析 registry.md 表格。表头:Feature ID | 名称 | 状态 | 行为契约 | 判断日志 | 创建时间 | 更新时间
 * 容错:仅取 Feature ID / 名称 / 状态 / 更新时间;列数不足或分隔行跳过。
 */
export function parseRegistry(markdown: string): RegistryRow[] {
  const rows: RegistryRow[] = [];
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    // 跳过表头 / 分隔行
    const first = cells[0] ?? "";
    if (
      /feature\s*id/i.test(first) ||
      /^[-:\s]+$/.test(first) ||
      first === ""
    ) {
      continue;
    }
    // 至少看起来像 F###-xxx
    if (!/^F\d{3}/i.test(first)) continue;
    rows.push({
      featureId: first,
      name: cells[1] ?? "",
      status: cells[2] ?? "",
      updatedAt: cells[6] ?? cells[5] ?? cells[4] ?? "",
    });
  }
  return rows;
}
