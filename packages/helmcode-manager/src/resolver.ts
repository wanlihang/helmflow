/**
 * Resolver — 统一 HelmCode 资源加载入口,干掉消费点散落的硬编码。
 *
 * 替代:
 *   - require/route.ts 手搓的 refsDir/stdDir
 *   - code.ts / code/run/route.ts 重复的 resolveStandardsRoot(../../standards/java-ddd/patterns)
 *   - agent-runner/skill.ts resolveSkillAdditionalDirs(全量 standards,不分 preset)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getVersion } from "./version";
import type { HelmcodeManagerOptions, VersionInfo } from "./types";

export class HelmcodeManager {
  readonly helmcodeRoot: string;
  readonly preset: string;

  constructor(opts: HelmcodeManagerOptions) {
    this.helmcodeRoot = opts.helmcodeRoot;
    this.preset = opts.preset ?? "java-ddd";
  }

  /** standards/{preset} 根目录 */
  resolveStandards(): string {
    return join(this.helmcodeRoot, "standards", this.preset);
  }

  /** standards/{preset}/patterns 目录(替换 code.ts 硬编码) */
  resolvePatterns(): string {
    return join(this.helmcodeRoot, "standards", this.preset, "patterns");
  }

  /** core/{skill}/SKILL.md 路径(不存在抛错) */
  resolveSkillPath(skillName: string): string {
    const p = join(this.helmcodeRoot, "core", skillName, "SKILL.md");
    if (!existsSync(p)) {
      throw new Error(`Skill not found: ${skillName} (expected ${p})`);
    }
    return p;
  }

  /**
   * skill 运行时需要的 additionalDirectories:
   *   core/{skill}/references/ + standards/{preset}
   * (agent-runner 的旧版推全量 standards/,这里收敛到 preset 精确目录)
   */
  resolveSkillAdditionalDirs(skillName: string): string[] {
    const dirs: string[] = [];
    const referencesDir = join(this.helmcodeRoot, "core", skillName, "references");
    const standardsDir = this.resolveStandards();
    if (existsSync(referencesDir)) dirs.push(referencesDir);
    if (existsSync(standardsDir)) dirs.push(standardsDir);
    return dirs;
  }

  /** 加载 SKILL.md body(剥 frontmatter) */
  loadSkillBody(skillName: string): string {
    const path = this.resolveSkillPath(skillName);
    const raw = readFileSync(path, "utf-8");
    const fmMatch = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
    return fmMatch ? raw.slice(fmMatch[0].length) : raw;
  }

  /** 当前版本信息(checksum + helmcode 版本 + git HEAD) */
  getVersion(): VersionInfo {
    return getVersion(this.helmcodeRoot, this.preset);
  }
}
