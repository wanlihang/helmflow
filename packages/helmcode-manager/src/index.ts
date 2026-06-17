/**
 * @helmflow/helmcode-manager — HelmCode 资源管理中间层(控制平面回归第三刀核心版)。
 *
 * 统一 Resolver(替代散落的硬编码路径)+ Version Tracker(目录级 checksum)+ checkUpdate(drift 检测)。
 * 纯 Node 库,不依赖 next/agent-runner。
 */

export { HelmcodeManager } from "./resolver";
export { checksumDir, getVersion } from "./version";
export { diffStandards } from "./diff";
export type { DiffResult } from "./diff";
export { analyzeImpact } from "./impact";
export type { ContractSnapshot, AffectedCell, ImpactResult } from "./impact";
export { checkUpdateRemote, upgradeTo } from "./upgrade";
export type { RemoteUpdateInfo, UpgradeResult } from "./upgrade";
export type {
  HelmcodeManagerOptions,
  VersionInfo,
  UpdateInfo,
} from "./types";
