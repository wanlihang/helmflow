/**
 * Version Tracker — 目录级 checksum + getVersion + checkUpdate。
 *
 * checksum 策略(根治标准 drift):
 *   递归读 standards/{preset} 下所有文件,按相对路径排序,内容 sha256 聚合(不含 mtime)。
 *   同版本多次调用一致;改任一 standards 文件即变。
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { UpdateInfo, VersionInfo } from "./types";

/**
 * 计算目录 checksum:递归收集所有文件相对路径+内容,排序后 sha256 聚合。
 * 不含 mtime(只算内容),保证跨机器/跨时间稳定。
 * 目录不存在时返回空串 hash(而非抛错,适配 preset 未装的情况)。
 */
export function checksumDir(rootDir: string): string {
  if (!existsSync(rootDir)) {
    return createHash("sha256").update("").digest("hex");
  }

  const entries: Array<{ relPath: string; content: string }> = [];
  const walk = (dir: string): void => {
    let list: string[];
    try {
      list = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of list) {
      const full = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        try {
          const content = readFileSync(full);
          entries.push({ relPath: relative(rootDir, full), content: content.toString("utf-8") });
        } catch {
          // 读失败的文件跳过(不污染 checksum)
        }
      }
    }
  };
  walk(rootDir);

  // 按相对路径排序聚合(确定性)
  entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  const hash = createHash("sha256");
  for (const e of entries) {
    hash.update(e.relPath);
    hash.update("\0");
    hash.update(e.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** 读 helmcode package.json version;失败返回 "unknown" */
function readHelmcodeVersion(helmcodeRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(helmcodeRoot, "package.json"), "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** 读 local 源 git HEAD;失败返回 undefined */
function readGitHead(helmcodeRoot: string): string | undefined {
  try {
    const head = execSync("git rev-parse HEAD", {
      cwd: helmcodeRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return head.length > 0 ? head : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 计算当前 HelmCode 版本信息。
 * @param helmcodeRoot HelmCode 仓库根
 * @param preset 标准 preset(如 "java-ddd")
 */
export function getVersion(helmcodeRoot: string, preset: string): VersionInfo {
  return {
    helmcode: readHelmcodeVersion(helmcodeRoot),
    preset,
    checksum: checksumDir(join(helmcodeRoot, "standards", preset)),
    gitHead: readGitHead(helmcodeRoot),
  };
}

/**
 * 检测 drift:当前 checksum vs 外部记录的旧 checksum。
 * helmcode 未发 npm,核心版仅做本地内容 drift 检测(不查 registry)。
 */
export function checkUpdate(currentChecksum: string, recordedChecksum?: string): UpdateInfo {
  if (!recordedChecksum) {
    return { current: currentChecksum, recorded: undefined, hasUpdate: false };
  }
  return {
    current: currentChecksum,
    recorded: recordedChecksum,
    hasUpdate: currentChecksum !== recordedChecksum,
  };
}
