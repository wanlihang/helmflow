/**
 * helmcode 版本管理编排(控制平面回归第四刀)。
 * 直接读源架构:不写文件。adopt/rollback 只更新 DB 绑定 + 记 migration 历史。
 * manager(diff/impact/version)是纯计算,本层组合 manager + storage。
 */

import { HelmcodeManager, diffStandards, analyzeImpact, checkUpdateRemote, upgradeTo, type ContractSnapshot, type DiffResult, type ImpactResult, type VersionInfo, type RemoteUpdateInfo, type UpgradeResult } from "@helmflow/helmcode-manager";
import {
  type DB,
  createMigration,
  getLatestMigration,
  getProjectById,
  listActiveFeatures,
  listContractsForCell,
  listFeatureScenarios,
  updateProjectStandards,
} from "@helmflow/storage";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface PreviewArgs {
  db: DB;
  helmcodeRoot: string;
  preset: string;
  projectId: string;
  /** 起 git head(项目当前绑定的 toGitHead,或缺省用 HEAD~1) */
  fromGitHead?: string;
}

export interface PreviewOutcome {
  diff: DiffResult;
  impact: ImpactResult;
  currentVersion: VersionInfo;
}

/** dryRun:算 diff + impact,不落库 */
export function previewStandardsChange(args: PreviewArgs): PreviewOutcome {
  const manager = new HelmcodeManager({ helmcodeRoot: args.helmcodeRoot, preset: args.preset });
  const currentVersion = manager.getVersion();

  // fromGitHead:优先传入,否则取项目最近一次 migration 的 toGitHead,再否则 HEAD~1
  const latest = getLatestMigration(args.db, args.projectId);
  const fromHead = args.fromGitHead ?? latest?.toGitHead ?? "HEAD~1";

  const diff = diffStandards(args.helmcodeRoot, args.preset, fromHead);

  // impact:扫该项目的契约正文
  const contracts = loadProjectContractSnapshots(args.db, args.projectId);
  const impact = analyzeImpact(diff.all, contracts);

  return { diff, impact, currentVersion };
}

function loadProjectContractSnapshots(db: DB, projectId: string): ContractSnapshot[] {
  const snapshots: ContractSnapshot[] = [];
  const features = listActiveFeatures(db, projectId);
  for (const feature of features) {
    const cells = listFeatureScenarios(db, feature.id);
    for (const cell of cells) {
      const cellContracts = listContractsForCell(db, cell.id);
      // 取该 cell 最新一份契约的正文
      const latest = cellContracts.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))[0];
      if (!latest) continue;
      try {
        const mdPath = isAbsolute(latest.markdownPath)
          ? latest.markdownPath
          : join(process.cwd(), latest.markdownPath);
        const content = readFileSync(mdPath, "utf-8");
        snapshots.push({ cellId: cell.id, content });
      } catch {
        // 读失败的契约跳过
      }
    }
  }
  return snapshots;
}

export interface AdoptArgs {
  db: DB;
  helmcodeRoot: string;
  preset: string;
  projectId: string;
}

export interface AdoptOutcome {
  version: VersionInfo;
  migrationId: string;
  affectedCount: number;
}

/**
 * 采纳当前 helmcode 源版本:更新 projects 绑定 + 记 migration(action=adopt)。
 * 前置:用户已在 helmcode 仓库手动 git 切换到目标版本。HelmFlow 不改 git、不改文件。
 */
export function adoptVersion(args: AdoptArgs): AdoptOutcome {
  const { db, projectId } = args;
  const manager = new HelmcodeManager({ helmcodeRoot: args.helmcodeRoot, preset: args.preset });
  const version = manager.getVersion();

  const project = getProjectById(db, projectId);
  const fromChecksum = project?.standardsChecksum ?? null;
  const fromGitHead = getLatestMigration(db, projectId)?.toGitHead ?? null;

  // diff(用于记录 changedFiles + affectedCount)
  const fromHead = fromGitHead ?? "HEAD~1";
  const diff = diffStandards(args.helmcodeRoot, args.preset, fromHead);
  const contracts = loadProjectContractSnapshots(db, projectId);
  const impact = analyzeImpact(diff.all, contracts);

  // 更新 projects 绑定
  updateProjectStandards(db, projectId, {
    helmcodeVersion: version.helmcode,
    standardsChecksum: version.checksum,
  });

  // 记 migration
  const migration = createMigration(db, {
    projectId,
    fromChecksum,
    toChecksum: version.checksum,
    fromGitHead,
    toGitHead: version.gitHead ?? null,
    action: "adopt",
    changedFilesJson: JSON.stringify(diff.all),
    affectedCount: impact.total,
  });

  return { version, migrationId: migration.id, affectedCount: impact.total };
}

export interface RollbackOutcome {
  migrationId: string;
  message: string;
}

/**
 * 回滚记录:用户已在 helmcode 手动 git checkout 回旧版,HelmFlow 重新绑定到"上一版"。
 * 取最近一条 adopt migration 的 fromChecksum/fromGitHead 作为回滚目标,记一条 rollback。
 * 不写文件。
 */
export function rollbackVersion(db: DB, projectId: string): RollbackOutcome {
  // 找最近一条 adopt(作为回滚目标:它的 from 就是回滚后的版本)
  const latest = getLatestMigration(db, projectId);
  if (!latest || latest.action !== "adopt" || !latest.fromChecksum) {
    return { migrationId: "", message: "无可用回滚目标(需先有 adopt 记录且带 fromChecksum)" };
  }

  const currentProject = getProjectById(db, projectId);
  const currentChecksum = currentProject?.standardsChecksum ?? null;
  const currentGitHead = latest.toGitHead ?? null;

  // projects 绑定恢复到上一版
  updateProjectStandards(db, projectId, {
    standardsChecksum: latest.fromChecksum,
  });

  createMigration(db, {
    projectId,
    fromChecksum: currentChecksum,
    toChecksum: latest.fromChecksum,
    fromGitHead: currentGitHead,
    toGitHead: latest.fromGitHead ?? null,
    action: "rollback",
    affectedCount: 0,
  });

  return { migrationId: latest.id, message: "已记录回滚(请确认 helmcode 仓库已 git checkout 到旧版)" };
}

// ---------------------------------------------------------------------------
// 检查升级(git 远程)+ 执行升级(git checkout/pull + 采纳 + 记 migration)
// ---------------------------------------------------------------------------

/** 检查上游(github origin)有没有新版:git fetch + 对比 HEAD vs origin/<branch> */
export function checkUpgrade(helmcodeRoot: string, branch = "main"): RemoteUpdateInfo {
  return checkUpdateRemote(helmcodeRoot, branch);
}

export interface PerformUpgradeArgs {
  db: DB;
  helmcodeRoot: string;
  preset: string;
  projectId: string;
  /** 目标 ref(branch/tag/commit),默认 "main" */
  ref?: string;
}

export interface PerformUpgradeOutcome {
  upgrade: UpgradeResult;
  /** 升级后 dryRun 预览(改了哪些 + 影响哪些 cell) */
  preview: PreviewOutcome;
  migrationId: string;
  /** 是否已采纳(更新 projects 绑定) */
  adopted: boolean;
}

/**
 * 执行升级:HelmFlow 代你 git checkout/pull helmcode 仓库 → 重新 getVersion →
 * dryRun 预览 diff+impact → 采纳(更新 projects 绑定 + 记 migration)。
 * 回滚:rollbackVersion(基于 migration 的 fromGitHead,用户调 upgradeTo 回旧版)。
 */
export function performUpgrade(args: PerformUpgradeArgs): PerformUpgradeOutcome {
  const { db, projectId, helmcodeRoot, preset } = args;
  const ref = args.ref ?? "main";

  // 1) 执行 git 升级
  const upgrade = upgradeTo(helmcodeRoot, ref, true);

  // 2) 升级后重新 getVersion + dryRun 预览
  const preview = previewStandardsChange({ db, helmcodeRoot, preset, projectId });

  // 3) 采纳(更新绑定 + 记 migration)
  const version = preview.currentVersion;
  const project = getProjectById(db, projectId);
  const fromChecksum = project?.standardsChecksum ?? null;
  const fromGitHead = upgrade.fromHead || (getLatestMigration(db, projectId)?.toGitHead ?? null);

  updateProjectStandards(db, projectId, {
    helmcodeVersion: version.helmcode,
    standardsChecksum: version.checksum,
  });

  const migration = createMigration(db, {
    projectId,
    fromChecksum,
    toChecksum: version.checksum,
    fromGitHead,
    toGitHead: version.gitHead ?? upgrade.toHead,
    action: "adopt",
    changedFilesJson: JSON.stringify(preview.diff.all),
    affectedCount: preview.impact.total,
  });

  return {
    upgrade,
    preview,
    migrationId: migration.id,
    adopted: true,
  };
}
