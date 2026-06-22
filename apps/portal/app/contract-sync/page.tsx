import { existsSync } from "node:fs";
import { join } from "node:path";
import { ContractSyncPanel } from "@/components/contract-sync-panel";
import { getDb } from "@/lib/db";
import { loadMatrix } from "@/lib/matrix";
import { getCurrentProjectId } from "@/lib/project";
import { resolveSandboxPath } from "@/lib/server-utils";
import { listSyncResultsByProject } from "@helmflow/storage";

export const dynamic = "force-dynamic";

interface PageData {
  projectId: string;
  sandboxPath: string;
  contractsInstalled: boolean;
  features: Array<{
    id: string;
    name: string;
    domain: string;
    scenarios: Array<{ name: string; status: string }>;
  }>;
  lastScannedAt: string | null;
}

async function loadPageData(): Promise<PageData> {
  const db = getDb();
  const projectId = await getCurrentProjectId();
  const sandboxPath = await resolveSandboxPath();
  const matrix = loadMatrix(projectId);

  const features = matrix.domains.flatMap((d) =>
    d.features.map((f) => ({
      id: f.id,
      name: f.name,
      domain: d.name,
      scenarios: f.scenarios.map((s) => ({ name: s.name, status: s.status })),
    })),
  );

  const results = listSyncResultsByProject(db, projectId);
  const lastScannedAt =
    results.length > 0
      ? results.reduce((max, r) => (r.scannedAt > max ? r.scannedAt : max), results[0]!.scannedAt)
      : null;

  return {
    projectId,
    sandboxPath,
    contractsInstalled: existsSync(join(sandboxPath, ".claude", "contracts")),
    features,
    lastScannedAt,
  };
}

export default async function ContractSyncPage() {
  const data = await loadPageData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">契约状态同步</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          扫描目标项目{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{data.sandboxPath}</code>{" "}
          /.claude/contracts/ 下 HelmCode 直开产出的契约,匹配到功能点并同步开发状态。
        </p>
      </div>

      {!data.contractsInstalled && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-200">
          ⚠️ 目标项目未检测到 <code>.claude/contracts/</code> 目录(可能未安装 HelmCode
          或尚无契约产物)。扫描将返回空结果。
        </div>
      )}

      <ContractSyncPanel
        projectId={data.projectId}
        features={data.features}
        lastScannedAt={data.lastScannedAt}
      />
    </div>
  );
}
