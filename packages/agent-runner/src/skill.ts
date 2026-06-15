// Skill 加载器:支持从 HelmCode 仓库或本地 .claude/skills/ 加载 SKILL.md。
// 优先从 HelmCode 仓库的 core/<skill>/SKILL.md 加载(HelmFlow 不维护上游 skill),
// fallback 到本地 .claude/skills/<skill>/SKILL.md(仅 deploy 等 HelmFlow 专属 skill)。
// 剥掉首部 yaml frontmatter,把 body 作为 agent system prompt 的 append 段。

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILL_ROOT_ENV = "HELMFLOW_SKILL_ROOT";

function resolveSkillRoot(): string {
  const fromEnv = process.env[SKILL_ROOT_ENV];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // 默认 monorepo 根下的 .claude/skills/。Portal cwd 通常是 apps/portal,
  // 因此 fallback 是回到 ../../
  return join(process.cwd(), "..", "..", ".claude", "skills");
}

/**
 * 解析 skill SKILL.md 的绝对路径。
 * 优先从 HelmCode 仓库 core/<skill>/SKILL.md 加载,
 * fallback 到本地 .claude/skills/<skill>/SKILL.md。
 * 找不到时抛出 Error。
 */
export function resolveSkillPath(
  skillName: string,
  helmcodeRoot?: string,
): string {
  // 1) 优先 HelmCode 仓库
  if (helmcodeRoot) {
    const helmcodePath = join(helmcodeRoot, "core", skillName, "SKILL.md");
    if (existsSync(helmcodePath)) return helmcodePath;
  }

  // 2) fallback: 本地 .claude/skills/
  const root = resolveSkillRoot();
  const localPath = join(root, skillName, "SKILL.md");
  if (existsSync(localPath)) return localPath;

  throw new Error(
    `Skill not found: ${skillName}` +
      (helmcodeRoot ? ` (checked ${helmcodeRoot}/core/${skillName}/SKILL.md and local)` : " (checked local only)"),
  );
}

/**
 * 解析 skill 运行时需要的 additionalDirectories。
 * HelmCode skill 会引用 core/<skill>/references/ 和 standards/,
 * 需要加入 Agent SDK 的可访问目录列表。
 */
export function resolveSkillAdditionalDirs(
  skillName: string,
  helmcodeRoot?: string,
): string[] {
  if (!helmcodeRoot) return [];

  const dirs: string[] = [];
  const referencesDir = join(helmcodeRoot, "core", skillName, "references");
  const standardsDir = join(helmcodeRoot, "standards");

  if (existsSync(referencesDir)) dirs.push(referencesDir);
  if (existsSync(standardsDir)) dirs.push(standardsDir);

  return dirs;
}

/**
 * 加载 SKILL.md body 内容(剥掉 frontmatter)。
 * 兼容旧行为:不传 helmcodeRoot 时从本地加载。
 */
export function loadSkillBody(skillName: string, helmcodeRoot?: string): string {
  const path = resolveSkillPath(skillName, helmcodeRoot);
  const raw = readFileSync(path, "utf-8");
  // 剥掉 ^---\n...\n---\n? 的 frontmatter
  const fmMatch = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return fmMatch ? raw.slice(fmMatch[0].length) : raw;
}