import { HelmcodeManager } from "@helmflow/helmcode-manager";
import { listProjectsDb, listMigrations } from "@helmflow/storage";
import { getProject } from "@helmflow/manifest-loader";
import { getCurrentProjectId } from "@/lib/project";
import { getDb } from "@/lib/db";
import { HelmcodeDriftPanel } from "@/components/helmcode-drift-panel";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  name: string;
  adapterType: string;
  helmcodeVersion: string | null;
  standardsChecksum: string | null;
  drift: boolean;
}

interface MigrationRow {
  id: string;
  action: string;
  fromChecksum: string | null;
  toChecksum: string;
  fromGitHead: string | null;
  toGitHead: string | null;
  affectedCount: number;
  createdAt: string;
}

interface PageData {
  configured: boolean;
  helmcodeRoot: string | null;
  version: string | null;
  preset: string | null;
  checksum: string | null;
  gitHead: string | null;
  projects: ProjectRow[];
  /** 当前项目是否 drift(用于 DriftPanel) */
  currentDrift: boolean;
  /** 当前项目是否已绑定版本 */
  currentBound: boolean;
  migrations: MigrationRow[];
}

async function loadPageData(): Promise<PageData> {
  const projectId = await getCurrentProjectId();
  const projectInfo = getProject(projectId);
  const helmcodeRoot = projectInfo?.helmcodeRoot;

  if (!helmcodeRoot) {
    return { configured: false, helmcodeRoot: null, version: null, preset: null, checksum: null, gitHead: null, projects: [], currentDrift: false, currentBound: false, migrations: [] };
  }

  const preset = projectInfo?.manifest.adapterType ?? "java-ddd";
  const manager = new HelmcodeManager({ helmcodeRoot, preset });
  const versionInfo = manager.getVersion();
  const currentChecksum = versionInfo.checksum;
  const db = getDb();

  const projects: ProjectRow[] = listProjectsDb(db).map((p) => ({
    id: p.id,
    name: p.name,
    adapterType: p.adapterType,
    helmcodeVersion: p.helmcodeVersion,
    standardsChecksum: p.standardsChecksum,
    drift: p.standardsChecksum != null && p.standardsChecksum !== currentChecksum,
  }));

  const current = projects.find((p) => p.id === projectId);
  const currentBound = current?.standardsChecksum != null;

  const migrations: MigrationRow[] = listMigrations(db, projectId, 20).map((m) => ({
    id: m.id,
    action: m.action,
    fromChecksum: m.fromChecksum ? m.fromChecksum.slice(0, 12) : null,
    toChecksum: m.toChecksum.slice(0, 12),
    fromGitHead: m.fromGitHead ? m.fromGitHead.slice(0, 12) : null,
    toGitHead: m.toGitHead ? m.toGitHead.slice(0, 12) : null,
    affectedCount: m.affectedCount,
    createdAt: m.createdAt,
  }));

  return {
    configured: true,
    helmcodeRoot,
    version: versionInfo.helmcode,
    preset: versionInfo.preset,
    checksum: currentChecksum,
    gitHead: versionInfo.gitHead ?? null,
    projects,
    currentDrift: current?.drift ?? false,
    currentBound,
    migrations,
  };
}

export default async function HelmcodePage() {
  const data = await loadPageData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">标准版本中心</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          HelmFlow 通过 HelmCode 仓库获取编码标准与 skill。这里展示当前绑定的 HelmCode 版本(控制平面回归第三刀)。
        </p>
      </div>

      {!data.configured ? (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-200">
          ⚠️ 当前项目未配置 <code>helmcode.path</code>(helmcode.yaml)。HelmCode 标准加载、契约生成将不可用。
        </div>
      ) : (
        <>
          {/* 全局源信息 */}
          <section className="rounded-md border border-border bg-card p-4 space-y-3">
            <h2 className="text-base font-semibold">HelmCode 源(本地)</h2>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <Info label="路径" value={<code className="font-mono text-xs">{data.helmcodeRoot}</code>} />
              <Info label="版本" value={data.version ? <span className="font-mono font-semibold text-green-600">{data.version}</span> : "未知"} />
              <Info label="标准 preset" value={<code className="font-mono text-xs">{data.preset}</code>} />
              <Info label="Git HEAD" value={data.gitHead ? <code className="font-mono text-xs">{data.gitHead.slice(0, 12)}</code> : "—"} />
              <Info label="standards checksum" value={<code className="font-mono text-xs break-all">{data.checksum?.slice(0, 16)}…</code>} />
            </div>
            <p className="text-xs text-muted-foreground">
              checksum 是 <code>standards/{data.preset}</code> 全文件内容 sha256 聚合(不含 mtime)。helmcode 改了标准 → checksum 变 → 下方项目 drift 标记。
            </p>
          </section>

          {/* drift 预览/采纳(当前项目) */}
          <HelmcodeDriftPanel drift={data.currentDrift} bound={data.currentBound} />

          {/* 项目绑定版本 */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold">项目绑定版本</h2>
            {data.projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">无已注册项目。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-3 py-2 text-left font-semibold">项目</th>
                      <th className="px-3 py-2 text-left font-semibold">adapter</th>
                      <th className="px-3 py-2 text-left font-semibold">绑定的 helmcode 版本</th>
                      <th className="px-3 py-2 text-left font-semibold">checksum</th>
                      <th className="px-3 py-2 text-center font-semibold">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.projects.map((p) => (
                      <tr key={p.id} className="border-b border-border">
                        <td className="px-3 py-2">
                          <span className="font-medium">{p.name}</span>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{p.id}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{p.adapterType}</td>
                        <td className="px-3 py-2">
                          {p.helmcodeVersion
                            ? <span className="font-mono text-green-600">{p.helmcodeVersion}</span>
                            : <span className="text-muted-foreground text-xs">未记录(尚未跑过节点)</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {p.standardsChecksum ? `${p.standardsChecksum.slice(0, 12)}…` : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {p.drift
                            ? <span className="inline-flex items-center rounded-md bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">⚠ 标准 drift</span>
                            : p.standardsChecksum
                              ? <span className="inline-flex items-center rounded-md bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">一致</span>
                              : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              跑一次需求/代码节点后,对应项目会记录当前 helmcode 版本与 checksum(可追溯「这代码按哪版标准生成」)。
            </p>
          </section>

          {/* 版本切换 changelog */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold">版本切换历史</h2>
            {data.migrations.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无版本切换记录。drift 预览采纳后,这里会留下审计历史。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-3 py-2 text-left font-semibold">动作</th>
                      <th className="px-3 py-2 text-left font-semibold">from</th>
                      <th className="px-3 py-2 text-left font-semibold">to</th>
                      <th className="px-3 py-2 text-left font-semibold">影响 cell</th>
                      <th className="px-3 py-2 text-left font-semibold">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.migrations.map((m) => (
                      <tr key={m.id} className="border-b border-border">
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-semibold ${
                            m.action === "adopt" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                          }`}>
                            {m.action}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">
                          {m.fromChecksum ?? "—"}{m.fromGitHead ? ` @${m.fromGitHead}` : ""}
                        </td>
                        <td className="px-3 py-2 font-mono">{m.toChecksum}{m.toGitHead ? ` @${m.toGitHead}` : ""}</td>
                        <td className="px-3 py-2">{m.affectedCount}</td>
                        <td className="px-3 py-2 text-muted-foreground">{new Date(m.createdAt).toLocaleString("zh-CN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">{label}:</span>
      <span>{value}</span>
    </div>
  );
}
