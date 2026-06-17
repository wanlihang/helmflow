/**
 * helmcode-manager 共享类型。
 * 把 HelmCode 当被管理对象:统一 Resolver + Version Tracker(控制平面回归第三刀核心版)。
 */

/** 管理器构造选项 */
export interface HelmcodeManagerOptions {
  /** HelmCode 仓库根目录(绝对路径) */
  helmcodeRoot: string;
  /** 标准 preset,默认 "java-ddd" */
  preset?: string;
}

/** 版本信息(可追溯每次代码生成用的标准) */
export interface VersionInfo {
  /** helmcode package.json version,如 "3.0.0" */
  helmcode: string;
  /** 标准 preset,如 "java-ddd" */
  preset: string;
  /** standards/{preset} 全文件内容 sha256 聚合(不含 mtime),稳定 64 位 hex */
  checksum: string;
  /** local 源的 git HEAD(可选,git rev-parse 失败时为空) */
  gitHead?: string;
}

/** 更新检测结果(本地内容 drift) */
export interface UpdateInfo {
  /** 当前算出的 checksum */
  current: string;
  /** DB/外部记录的旧 checksum */
  recorded?: string;
  /** 是否检测到 drift(current !== recorded) */
  hasUpdate: boolean;
}
