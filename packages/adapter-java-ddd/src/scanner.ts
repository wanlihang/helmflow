/**
 * 确定性 Java inventory 扫描器(控制平面回归:analyze 拆分)。
 *
 * 用 Node 遍历 + 正则采集(非 LLM),秒级、稳、零成本、不撞 turn。
 * 产 InventoryItem(7 字段全确定性),供 analyze-status classify 复用。
 * 纯 Node 无 Bash 工具依赖,跨平台。
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, basename, sep } from "node:path";

export interface InventoryItem {
  className: string;
  qualifiedName: string;
  type: "decider" | "acceptor" | "handler" | "action" | "other";
  methods: number;
  todos: number;
  lines: number;
  skeleton: boolean;
}

const JAVA_FILE_RE = /\.java$/;
const SRC_MAIN_JAVA = `${sep}src${sep}main${sep}java${sep}`;

/** 收集 rootDir 下所有 src/main/java 下的 .java 文件(支持多模块) */
function collectJavaFiles(rootDir: string): string[] {
  const out: string[] = [];
  if (!existsSync(rootDir)) return out;

  const walk = (dir: string, depth: number): void => {
    if (depth > 12) return; // 防御性深度限制
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      // 跳过常见无关目录(性能 + 噪音)
      if (name === "node_modules" || name === "target" || name === "build" || name === ".git" || name === ".idea") {
        continue;
      }
      const full = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
      } else if (JAVA_FILE_RE.test(name) && full.includes(SRC_MAIN_JAVA)) {
        out.push(full);
      }
    }
  };
  walk(rootDir, 0);
  return out;
}

/** 从文件内容提取 package 声明 */
function readPackage(content: string): string {
  const m = content.match(/^\s*package\s+([\w.]+)\s*;/m);
  return m && m[1] ? m[1] : "";
}

/** 判断类型:路径优先(多模块包结构准),命名兜底。识别 DDD 四层:decider/acceptor/handler/action */
function classifyType(filePath: string, className: string): InventoryItem["type"] {
  const lower = filePath.toLowerCase();
  if (lower.includes(`${sep}decider${sep}`) || /Decider$/.test(className)) return "decider";
  if (lower.includes(`${sep}acceptor${sep}`) || /Acceptor$/.test(className)) return "acceptor";
  if (lower.includes(`${sep}handler${sep}`) || /Handler$/.test(className)) return "handler";
  if (lower.includes(`${sep}action${sep}`) || /Action$/.test(className)) return "action";
  return "other";
}

/** public 方法数(排除 record/class 声明行、注解行) */
function countMethods(content: string): number {
  const lines = content.split(/\r?\n/);
  let n = 0;
  for (const line of lines) {
    const t = line.trim();
    // public 方法签名:public <type> <name>(  但非 class/record/interface/enum 声明
    if (/^\s*(?:public|protected)\s+/.test(line) && /\w+\s*\([^)]*\)\s*(?:\{|$|throws)/.test(t)) {
      if (!/\b(class|interface|enum|record|new)\b/.test(t)) {
        n++;
      }
    }
  }
  return n;
}

function countTodos(content: string): number {
  const matches = content.match(/TODO|FIXME/gi);
  return matches ? matches.length : 0;
}

/** 有效代码行(去空行 + 去纯注释行) */
function countLines(content: string): number {
  let n = 0;
  for (const raw of content.split(/\r?\n/)) {
    const t = raw.trim();
    if (t === "") continue;
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    n++;
  }
  return n;
}

/**
 * skeleton 判定:方法体仅 return null/0/""/false/throw UnsupportedOperationException/空块/仅 super。
 * 若所有方法体都骨架 → 整个类 skeleton=true。
 * 无方法的类(接口/枚举/纯字段)→ skeleton=false(不是"骨架实现",是结构定义)。
 */
function isSkeleton(content: string, methodCount: number): boolean {
  if (methodCount === 0) return false;

  // 提取所有方法体 { ... }(简单大括号匹配,粗略但够用)
  const bodyRe = /\)\s*(?:throws\s+[\w.,\s]+)?\s*\{([\s\S]*?)^\s*\}/gm;
  const bodies: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = bodyRe.exec(content)) !== null) {
    if (m[1]) bodies.push(m[1]);
  }
  if (bodies.length === 0) return false;

  const skeletonBodyRe = new RegExp(
    "^\\s*(?:" +
      "return\\s+(?:null|0|\"\"|''|false|true|Optional\\.empty|\\{\\s*\\})\\s*;?" + // return 空
      "|throw\\s+new\\s+UnsupportedOperationException" + // 抛未实现
      "|//\\s*(?:TODO|FIXME|not implemented|未实现)" + // 仅注释
      "|return\\s+super\\." + // 仅调 super
      "|\\}" + // 空方法体
    ")\\s*$",
    "m",
  );

  // 所有方法体都骨架 → skeleton=true
  return bodies.every((b) => {
    const trimmed = b.trim();
    if (trimmed === "" || trimmed === "}") return true;
    return skeletonBodyRe.test(trimmed);
  });
}

function scanOne(filePath: string, rootDir: string): InventoryItem {
  const className = basename(filePath).replace(JAVA_FILE_RE, "");
  let content = "";
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    content = "";
  }
  const pkg = readPackage(content);
  const qualifiedName = pkg ? `${pkg}.${className}` : className;
  const type = classifyType(filePath, className);
  const methods = countMethods(content);
  const todos = countTodos(content);
  const lines = countLines(content);
  const skeleton = isSkeleton(content, methods);

  void relative(rootDir, filePath); // 占位(qualifiedName 已含包,rel 仅调试用)
  return { className, qualifiedName, type, methods, todos, lines, skeleton };
}

/**
 * 扫描 rootDir 下所有 src/main/java Java 文件,产 inventory。
 * @param rootDir 项目根(含一个或多个 src/main/java 模块)
 */
export function scanJavaInventory(rootDir: string): InventoryItem[] {
  const files = collectJavaFiles(rootDir);
  return files.map((f) => scanOne(f, rootDir));
}
