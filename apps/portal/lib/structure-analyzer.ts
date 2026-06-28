/**
 * 项目结构分析器 — 确定性提取标准 Java DDD 项目的「场景 × 功能点」矩阵。
 *
 * 标准项目(由 ArchUnit 架构测试约束、各 BC 同构)的业务结构有确定性权威来源：
 *   - 场景(X 轴) = BizScene enum                (shared/scene/BizScene.java)
 *   - 功能点(Y 轴) = 各域 XxxFeature enum       ({domain}/decider/XxxFeature.java)
 *   - 单元格(场景,功能点) → Handler = DefaultXxxDecider 的 switch(scene){switch(feature)} 网格
 *
 * 因此不再用 LLM 猜 businessDimensions —— 直接解析 Java 源码,与代码 1:1。
 */

import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// 类型(结构保持不变,下游 dialog / apply-structure / storage 均兼容)
// ---------------------------------------------------------------------------

export interface InferredScenario {
  name: string;
  status: string;
  confidence: "high" | "low";
  branchHint?: string;
}

export interface InferredFeature {
  id: string;
  name: string;
  domain: string;
  domainName: string;
  handler: string;
  actions: string[];
  context: string;
  priority: string;
  scenarios: InferredScenario[];
}

export interface StructureAnalysisResult {
  domains: Array<{
    id: string;
    name: string;
    features: InferredFeature[];
  }>;
  scanSummary: {
    totalDomains: number;
    totalFeatures: number;
    totalScenes: number;
    durationMs: number;
    /** @deprecated 旧 UI 过渡期兼容(= totalFeatures) */
    totalHandlers: number;
    /** @deprecated 旧 UI 过渡期兼容(=0,确定性解析不再采集 Action 清单) */
    totalActions: number;
    /** @deprecated 旧 UI 过渡期兼容(= durationMs) */
    scanDurationMs: number;
    /** @deprecated 旧 UI 过渡期兼容(=0,已无独立 infer 阶段) */
    classifyDurationMs: number;
  };
}

// ---------------------------------------------------------------------------
// 域名映射(与 lib/matrix.ts 的 DOMAIN_NAMES 保持一致 + product)
// ---------------------------------------------------------------------------

// 与 lib/matrix.ts 的 DOMAIN_NAMES 保持一致(+ product)
const DOMAIN_LABELS: Record<string, string> = {
  deliver: "交付管理",
  mapping: "产品映射",
  pricing: "价格配置",
  signing: "签约",
  product: "产品映射管理",
  ops: "运维",
  shared: "共享",
};

// feature.id 前缀(域 → 编号前缀)
const DOMAIN_PREFIX: Record<string, string> = {
  deliver: "D",
  signing: "S",
  product: "PD",
  pricing: "PR",
  ops: "O",
  shared: "SH",
  mapping: "P",
};

// ---------------------------------------------------------------------------
// 文件查找(原生 fs 递归,不引入 glob 依赖)
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".git", "target", "build", ".idea", "out", "dist"]);

async function findJavaFiles(
  root: string,
  predicate: (name: string) => boolean,
): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let ents: Dirent[];
    try {
      ents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name));
      } else if (e.isFile() && e.name.endsWith(".java") && predicate(e.name)) {
        out.push(join(dir, e.name));
      }
    }
  }

  await walk(root);
  return out;
}

async function readUtf8(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/** 从路径 .../application/{domain}/decider/Xxx.java 提取 domain */
function extractDomainFromPath(p: string): string | null {
  const segs = p.split("/");
  const i = segs.lastIndexOf("decider");
  return i > 0 ? segs[i - 1] : null;
}

// ---------------------------------------------------------------------------
// 纯解析函数
// ---------------------------------------------------------------------------

/**
 * 解析 BizScene.java,提取全部业务场景。
 * 形如: FORMAL_SIGN("FORMAL_SIGN", "正式签约")
 */
export function extractBizScenes(src: string): Array<{ code: string; name: string }> {
  const block = src.match(/enum\s+BizScene\s*\{([\s\S]*?)\n\}/)?.[1];
  if (!block) return [];
  const re = /(\w+)\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
  const out: Array<{ code: string; name: string }> = [];
  for (const m of block.matchAll(re)) {
    out.push({ code: m[2], name: m[3] });
  }
  return out;
}

/**
 * 解析 XxxFeature.java,提取全部功能点及其 javadoc 中文名。
 * 形如:
 *   /** 创建交付需求 *\/
 *   CREATE,
 */
export function extractFeatureEnum(src: string): Array<{ name: string; label: string }> {
  const block = src.match(/enum\s+\w*Feature\s*\{([\s\S]*?)\n\}/)?.[1];
  if (!block) return [];
  const out: Array<{ name: string; label: string }> = [];
  const seen = new Set<string>();

  // 主: 单行 javadoc + 大写枚举名 (方法的 javadoc 后跟 public/private 等小写关键字,不会误匹配)
  const reDoc = /\/\*\*\s*([^*]+?)\s*\*\/\s*([A-Z][A-Z0-9_]*)\b/g;
  for (const m of block.matchAll(reDoc)) {
    const name = m[2];
    if (!seen.has(name)) {
      seen.add(name);
      out.push({ name, label: m[1].trim() });
    }
  }

  // 兜底: 无 javadoc 的裸枚举值 (行级,排除方法体里的 return XXX;)
  const reBare = /^\s*([A-Z][A-Z0-9_]*)\s*(?:\([^)]*\))?\s*[,;]?\s*$/gm;
  for (const m of block.matchAll(reBare)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push({ name: m[1], label: m[1] });
    }
  }

  return out;
}

/**
 * 解析 DefaultXxxDecider.java 的 switch(feature) 网格,得 feature → {handler, active}。
 * 当前单场景(BizScene 仅 FORMAL_SIGN),所有 feature case 都归属该场景;
 * 未来多场景时需按 chooseForXxx(feature) 方法分块关联。
 *
 * active=false 的判定由调用方完成:Feature enum 全集中不在 grid 里的 = 未接入(注释/缺 case)。
 */
export function extractDeciderGrid(src: string): Map<string, { handler: string; active: boolean }> {
  const grid = new Map<string, { handler: string; active: boolean }>();

  // 1. @Resource 注入: handlerVar → Handler 类名
  const injects = new Map<string, string>();
  const reInj = /@Resource\s+(?:private\s+)?(\w+)\s+(\w+)\s*;/g;
  for (const m of src.matchAll(reInj)) {
    injects.set(m[2], m[1]);
  }

  // 2. 在每个 switch(feature){...} 块内,行级扫活跃 case FEATURE: return handlerVar;
  //    (整行 // 注释的 case —— 如被注释掉的 QT_FUSION_AUTO —— 自然跳过,故不会进 grid)
  const reBlock = /switch\s*\(\s*feature\s*\)\s*\{([\s\S]*?)\n\s*\}/g;
  for (const featureBlock of src.matchAll(reBlock)) {
    const lines = featureBlock[1].split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      const cased = trimmed.match(/^case\s+([A-Z][A-Z0-9_]*)\s*:/);
      if (!cased) continue;
      const feature = cased[1];

      // return handlerVar; 可能在本行或随后几行
      let handlerVar: string | null = null;
      const sameLine = trimmed.match(/return\s+(\w+)\s*;/);
      if (sameLine) {
        handlerVar = sameLine[1];
      } else {
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const lt = lines[j].trim();
          if (lt === "" || lt.startsWith("//") || lt.startsWith("*")) continue;
          const r = lt.match(/^return\s+(\w+)\s*;/);
          if (r) handlerVar = r[1];
          break;
        }
      }
      const className = handlerVar ? (injects.get(handlerVar) ?? handlerVar) : "";
      // 仅当 return 的是注入字段(Handler)时算有效;方法调用(如 chooseForFormalSign)不会匹配 return \w+;
      if (handlerVar) {
        grid.set(feature, { handler: className, active: true });
      }
    }
  }

  return grid;
}

// ---------------------------------------------------------------------------
// 顶层:分析整个项目
// ---------------------------------------------------------------------------

function makeFeatureId(domain: string, idx: number): string {
  const prefix = DOMAIN_PREFIX[domain] ?? domain.toUpperCase().slice(0, 2);
  return `${prefix}-${String(idx + 1).padStart(2, "0")}`;
}

/**
 * 确定性分析标准项目结构,产出「场景 × 功能点」矩阵。
 * @param sandboxPath 项目根(含 app/application/... 标准 DDD 结构)
 */
export async function analyzeProjectStructure(
  sandboxPath: string,
): Promise<StructureAnalysisResult> {
  const startedAt = Date.now();

  // 1. 定位标准文件
  const [bizSceneFiles, featureFiles, deciderFiles] = await Promise.all([
    findJavaFiles(sandboxPath, (n) => n === "BizScene.java"),
    findJavaFiles(sandboxPath, (n) => /^\w+Feature\.java$/.test(n)),
    findJavaFiles(sandboxPath, (n) => /^Default\w*Decider\.java$/.test(n)),
  ]);

  // 2. BizScene 场景全集
  const bizScenes =
    bizSceneFiles[0] !== undefined ? extractBizScenes(await readUtf8(bizSceneFiles[0])) : [];
  if (bizScenes.length === 0) {
    throw new Error("未找到 BizScene.java 或解析不到业务场景枚举(非标准 DDD 项目?)");
  }

  // 3. 按 domain 归并 feature enum 文件与 decider 文件
  const domainFiles = new Map<string, { feature?: string; decider?: string }>();
  for (const f of featureFiles) {
    const dom = extractDomainFromPath(f);
    if (!dom) continue;
    domainFiles.set(dom, { ...domainFiles.get(dom), feature: f });
  }
  for (const f of deciderFiles) {
    const dom = extractDomainFromPath(f);
    if (!dom) continue;
    domainFiles.set(dom, { ...domainFiles.get(dom), decider: f });
  }

  // 4. 组装每个域
  const domains: StructureAnalysisResult["domains"] = [];
  let totalFeatures = 0;

  for (const [domain, files] of domainFiles) {
    const featureEnum = files.feature ? extractFeatureEnum(await readUtf8(files.feature)) : [];
    if (featureEnum.length === 0) continue;

    const grid = files.decider
      ? extractDeciderGrid(await readUtf8(files.decider))
      : new Map<string, { handler: string; active: boolean }>();

    const features: InferredFeature[] = featureEnum.map((fe, idx) => {
      const cell = grid.get(fe.name);
      const scenarios: InferredScenario[] = bizScenes.map((s) => ({
        name: s.name,
        status: "待实现",
        confidence: cell?.active ? "high" : "low",
        branchHint: cell?.active ? s.code : "Decider 网格未接入(TODO)",
      }));
      return {
        id: makeFeatureId(domain, idx),
        name: fe.label,
        domain,
        domainName: DOMAIN_LABELS[domain] ?? domain,
        handler: cell?.handler ?? "",
        actions: [],
        context: domain,
        priority: "P1",
        scenarios,
      };
    });

    domains.push({
      id: domain,
      name: DOMAIN_LABELS[domain] ?? domain,
      features,
    });
    totalFeatures += features.length;
  }

  if (domains.length === 0) {
    throw new Error("未找到任何 *Feature.java 功能点枚举(非标准 DDD 项目?)");
  }

  const durationMs = Date.now() - startedAt;

  return {
    domains,
    scanSummary: {
      totalDomains: domains.length,
      totalFeatures,
      totalScenes: bizScenes.length,
      durationMs,
      // 旧 UI 过渡期兼容
      totalHandlers: totalFeatures,
      totalActions: 0,
      scanDurationMs: durationMs,
      classifyDurationMs: 0,
    },
  };
}
