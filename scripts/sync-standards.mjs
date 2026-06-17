#!/usr/bin/env node
// helmcode:check — 防标准 drift 兜底校验(控制平面回归第四刀)。
//
// 直接读源架构:HelmFlow 无本地 standards 副本,本脚本退化为:
//   1. 验证 projects/*/helmcode.yaml 的 helmcode.path 可达
//   2. 对每个 preset 算 checksum,确认可算且稳定
// 非零退出 = 配置/可达性问题。
//
// 未来若引入本地副本(副本模式),此处扩展为「副本 checksum vs helmcode 源 checksum」一致性校验。

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";

// import.meta.dirname(Node ≥20.11):脚本所在目录(scripts/),ROOT = helmflow 仓库根。
const ROOT = resolve(import.meta.dirname, "..");
const PROJECTS_DIR = join(ROOT, "projects");

// 极简 helmcode.yaml 解析(避免引入 yaml 依赖):仅提取 helmcode.path 与 adapterType。
function parseHelmcodeYaml(text) {
  const get = (key) => {
    const m = text.match(new RegExp(`^\\s*${key}\\s*:\\s*"?([^"\\n]+?)"?\\s*$`, "m"));
    return m ? m[1].trim() : undefined;
  };
  return {
    adapterType: get("adapterType"),
    helmcode: { path: get("path") }, // helmcode: 下的 path(缩进,正则宽松匹配)
  };
}

function checksumDir(dir) {
  if (!existsSync(dir)) return null;
  const entries = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      const st = statSync(f);
      if (st.isDirectory()) walk(f);
      else if (st.isFile()) entries.push({ r: relative(dir, f), c: readFileSync(f, "utf-8") });
    }
  })(dir);
  entries.sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : 0));
  const h = createHash("sha256");
  for (const e of entries) { h.update(e.r); h.update("\0"); h.update(e.c); h.update("\0"); }
  return h.digest("hex");
}

function main() {
  const errors = [];
  let checked = 0;

  if (!existsSync(PROJECTS_DIR)) {
    console.log(`[helmcode:check] 无 projects 目录,跳过(${PROJECTS_DIR})。`);
    process.exit(0);
  }

  for (const entry of readdirSync(PROJECTS_DIR)) {
    const dir = join(PROJECTS_DIR, entry);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, "helmcode.yaml");
    if (!existsSync(manifestPath)) continue;

    let manifest;
    try {
      manifest = parseHelmcodeYaml(readFileSync(manifestPath, "utf-8"));
    } catch (err) {
      errors.push(`${entry}: helmcode.yaml 解析失败 - ${err.message}`);
      continue;
    }

    const relPath = manifest?.helmcode?.path;
    if (!relPath) {
      console.log(`[helmcode:check] ${entry}: 未配置 helmcode.path,跳过。`);
      continue;
    }

    const helmcodeRoot = resolve(dir, relPath);
    if (!existsSync(helmcodeRoot)) {
      errors.push(`${entry}: helmcode.path 不可达 - ${helmcodeRoot}`);
      continue;
    }

    const preset = manifest.adapterType ?? "java-ddd";
    const checksum = checksumDir(join(helmcodeRoot, "standards", preset));
    if (!checksum) {
      errors.push(`${entry}: helmcode 无 standards/${preset} 目录`);
      continue;
    }

    checked++;
    console.log(`[helmcode:check] ${entry}: OK - helmcode ${manifest.helmcode?.version ?? "?"} / ${preset} / ${checksum.slice(0, 16)}…`);
  }

  if (errors.length > 0) {
    console.error(`\n[helmcode:check] ✗ ${errors.length} 个问题:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`\n[helmcode:check] ✓ 校验通过(${checked} 个项目配置可达,checksum 可算)。`);
}

main();
