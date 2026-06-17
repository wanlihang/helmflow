/**
 * 文件系统扫描 — 读目标项目 .claude/contracts/。
 *
 * 策略:
 *   1. registry.md 存在 → 解析得 Feature ID 清单 → 逐个找 {F-ID}-{short}.md
 *   2. registry.md 缺失 → readdir 匹配 /^F\d{3}-.+\.md$/
 *   3. .claude/contracts/ 不存在 → contractsDir=null 空扫(不报错,UI 友好提示)
 *
 * 只读不写目标项目。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHelmcodeContract, parseRegistry } from "./parse";
import type { ScanOptions, ScanReport } from "./types";

const CONTRACTS_DIR = ".claude/contracts";
const REGISTRY_FILE = "registry.md";
const FEATURE_FILE_RE = /^F\d{3}-.+\.md$/i;

/**
 * registry 里的契约路径列可能是相对路径或文件名,尝试在 contractsDir 下定位。
 */
function resolveContractFile(
  contractsDir: string,
  hint: string,
): string | null {
  const fileName = hint.split("/").pop() ?? hint;
  // 1) 直接用 hint 在 contractsDir 找
  const direct = join(contractsDir, fileName);
  if (existsSync(direct)) return direct;
  // 2) 用 Feature ID 前缀模糊匹配 registry 给的 name 可能不全
  const fidMatch = fileName.match(/^(F\d{3})/i);
  if (fidMatch && fidMatch[1]) {
    const prefix = fidMatch[1];
    try {
      const candidates = readdirSync(contractsDir).filter(
        (f) => f.toUpperCase().startsWith(prefix.toUpperCase()) && f.endsWith(".md"),
      );
      if (candidates.length > 0) return join(contractsDir, candidates[0]!);
    } catch {
      // ignore
    }
  }
  return null;
}

function parseFile(filePath: string, contractsDir: string, report: ScanReport): void {
  let markdown: string;
  try {
    markdown = readFileSync(filePath, "utf-8");
  } catch {
    report.parseFailures.push({ filePath, errors: ["读取文件失败"] });
    return;
  }
  const result = parseHelmcodeContract(markdown, filePath);
  if (result.ok) {
    report.metas.push(result.data);
  } else {
    report.parseFailures.push({ filePath, errors: result.errors });
  }
}

export function scanHelmcodeContracts(opts: ScanOptions): ScanReport {
  const contractsDir = join(opts.sandboxPath, CONTRACTS_DIR);
  const report: ScanReport = {
    contractsDir: null,
    registryPath: null,
    metas: [],
    parseFailures: [],
  };

  if (!existsSync(contractsDir)) {
    // 目标项目未安装 HelmCode 或无契约产物 — 空扫,不报错
    return report;
  }
  report.contractsDir = contractsDir;

  const registryPath = join(contractsDir, REGISTRY_FILE);
  let filesToParse: string[] = [];

  if (existsSync(registryPath)) {
    report.registryPath = registryPath;
    let registryMarkdown: string;
    try {
      registryMarkdown = readFileSync(registryPath, "utf-8");
      const registryRows = parseRegistry(registryMarkdown);
      for (const row of registryRows) {
        // registry 行为契约列可能含路径;用 Feature ID 兜底匹配
        const resolved = resolveContractFile(contractsDir, row.featureId);
        if (resolved) {
          filesToParse.push(resolved);
        }
      }
    } catch {
      // registry 读失败 → 降级扫目录
    }
  }

  // registry 未命中或缺失 → 扫目录
  if (filesToParse.length === 0) {
    try {
      const entries = readdirSync(contractsDir);
      filesToParse = entries
        .filter((f) => FEATURE_FILE_RE.test(f))
        .map((f) => join(contractsDir, f));
    } catch {
      // 目录读取失败 — 返回已收集的(可能为空)
      return report;
    }
  }

  // 去重(同一文件可能被 registry + 目录两次命中)
  const seen = new Set<string>();
  for (const f of filesToParse) {
    if (seen.has(f)) continue;
    seen.add(f);
    parseFile(f, contractsDir, report);
  }

  return report;
}
