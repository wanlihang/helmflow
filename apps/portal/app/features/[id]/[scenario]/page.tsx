import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parse as parseYaml } from "yaml";
import { parseContract } from "@helmflow/contract-schema";
import {
  getLatestContract,
  getLatestCommit,
  listReflectionsForFeature,
  listRunsForCell,
  listContractsForCell,
  listCommitsForCell,
  type ContractRow,
  type CommitRow,
  type ReflectionRow,
  type RunRow,
} from "@helmflow/storage";
import { ApproveContractButton } from "@/components/approve-contract-button";
import { AnalyzeCellButton } from "@/components/analyze-cell-button";
import { CellFiles } from "@/components/cell-files";
import { CellLifecycleBar } from "@/components/cell-lifecycle-bar";
import { CellStatusSelect } from "@/components/cell-status-select";
import { CellTimeline } from "@/components/cell-timeline";
import { ContractView } from "@/components/contract-view";
import { ReimplementButton } from "@/components/reimplement-button";
import { RunCoderButton } from "@/components/run-coder-button";
import { RunCommitterButton } from "@/components/run-committer-button";
import { RunQaButton } from "@/components/run-qa-button";
import { StartFeatureDialog } from "@/components/start-feature-dialog";
import { StartFullLoopButton } from "@/components/start-full-loop-button";
import { VerifyCellButton } from "@/components/verify-cell-button";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/lib/db";
import { getCell, getDomainOfFeature } from "@/lib/matrix";

interface CellPageProps {
  params: Promise<{ id: string; scenario: string }>;
}

interface LoadedContract {
  row: ContractRow;
  markdown: string | null;
  readError: string | null;
}

interface QaAcResult {
  acId: string;
  status: "pass" | "fail";
  failureReason?: string;
}

interface QaReportSummary {
  featureId: string;
  runAt: string;
  lenient: { totalRun: number; passed: number; failed: number };
  acResults: QaAcResult[];
  gapsDetected: number;
  escalateAction: string;
}

function loadContractForCell(cellId: string): LoadedContract | null {
  try {
    const row = getLatestContract(getDb(), cellId);
    if (!row) return null;
    try {
      const md = readFileSync(join(process.cwd(), row.markdownPath), "utf-8");
      return { row, markdown: md, readError: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { row, markdown: null, readError: message };
    }
  } catch {
    return null;
  }
}

function loadAllContracts(cellId: string): ContractRow[] {
  try {
    return listContractsForCell(getDb(), cellId);
  } catch {
    return [];
  }
}

function loadAllRuns(cellId: string): RunRow[] {
  try {
    return listRunsForCell(getDb(), cellId);
  } catch {
    return [];
  }
}

function loadAllCommits(cellId: string): CommitRow[] {
  try {
    return listCommitsForCell(getDb(), cellId);
  } catch {
    return [];
  }
}

function loadLatestQaReport(cellId: string): QaReportSummary | null {
  try {
    const dir = join(process.cwd(), "data", "qa-reports", cellId);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
    } catch {
      return null;
    }
    if (files.length === 0) return null;
    const sorted = files
      .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const latest = sorted[0];
    if (!latest) return null;
    const raw = readFileSync(join(dir, latest.name), "utf-8");
    return parseYaml(raw) as QaReportSummary;
  } catch {
    return null;
  }
}

function loadReflections(cellId: string): ReflectionRow[] {
  try {
    return listReflectionsForFeature(getDb(), cellId, 5);
  } catch {
    return [];
  }
}

export default async function CellPage({ params }: CellPageProps) {
  const { id, scenario: encodedScenario } = await params;
  const scenarioName = decodeURIComponent(encodedScenario);
  const cell = getCell(id, scenarioName);
  if (!cell) {
    return notFound();
  }

  const { feature, scenario, cellId } = cell;
  const domain = getDomainOfFeature(id);
  const canOperate = scenario.status === "需改造" || scenario.status === "待实现";
  const isSupported = scenario.status === "已支持";
  const isDeprecated = scenario.status === "废弃";

  const contract = loadContractForCell(cellId);
  const allRuns = loadAllRuns(cellId);
  const allContracts = loadAllContracts(cellId);
  const allCommits = loadAllCommits(cellId);
  const latestCommit = allCommits.length > 0
    ? allCommits.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0] ?? null
    : null;
  const qaReport = loadLatestQaReport(cellId);
  const reflections = scenario.agentStatus === "blocked" ? loadReflections(cellId) : [];

  return (
    <div className="space-y-6">
      {/* Section A: 基本信息 */}
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">Home</Link>
        <span className="mx-2">/</span>
        <span>{domain?.name ?? "未分类"}</span>
        <span className="mx-2">/</span>
        <Link href={`/features/${id}`} className="hover:text-foreground font-mono">{id}</Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{scenarioName}</span>
      </nav>

      <header className="space-y-3 border-b border-border pb-4">
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="font-mono text-muted-foreground">{id}</span>{" "}
          <span>{feature.name}</span>{" "}
          <span className="text-lg text-muted-foreground">· {scenarioName}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge scenario={scenario.status} />
          <Badge status={scenario.agentStatus} />
          <span className="font-mono text-xs text-muted-foreground">cell: {cellId}</span>
        </div>

        {/* 生命周期进度条 */}
        <CellLifecycleBar
          scenarioStatus={scenario.status}
          agentStatus={scenario.agentStatus}
          contractStatus={contract?.row.status ?? null}
          hasContract={contract !== null}
        />
      </header>

      {/* 功能概览：所有格子都展示 Target + Legacy 信息 */}
      <section className="grid grid-cols-1 gap-4 border-b border-border pb-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-muted-foreground">目标实现</h2>
          {(feature.target.handler || feature.target.actions.length > 0) ? (
            <div className="space-y-1 text-xs">
              {feature.target.handler && (
                <div className="flex items-start gap-2">
                  <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 font-mono font-semibold text-blue-700">Handler</span>
                  <span className="font-mono text-foreground">{feature.target.handler}</span>
                </div>
              )}
              {feature.target.actions.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="shrink-0 rounded bg-purple-100 px-1.5 py-0.5 font-mono font-semibold text-purple-700">Actions</span>
                  <div className="space-y-0.5">
                    {feature.target.actions.map((a) => (
                      <div key={a} className="font-mono text-foreground">{a}</div>
                    ))}
                  </div>
                </div>
              )}
              {feature.target.context && (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono font-semibold">Context</span>
                  <span className="font-mono">{feature.target.context}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">无专属 handler/action（查询类或通用功能）</div>
          )}
        </div>
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-muted-foreground">旧实现 (Legacy)</h2>
          {(feature.legacy.flowCode || feature.legacy.activities.length > 0) ? (
            <div className="space-y-1 text-xs">
              {feature.legacy.flowCode && (
                <div className="flex items-start gap-2">
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-mono font-semibold text-amber-700">Flow</span>
                  <span className="font-mono text-foreground">{feature.legacy.flowCode}</span>
                </div>
              )}
              {feature.legacy.activities.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 font-mono font-semibold text-orange-700">Activities</span>
                  <div className="space-y-0.5">
                    {feature.legacy.activities.map((a) => (
                      <div key={a} className="font-mono text-foreground">{a}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">无旧实现（全新功能）</div>
          )}
        </div>
      </section>

      {/* 状态提示条 */}
      {isDeprecated && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          此功能已废弃,无需 agent 介入。
        </div>
      )}
      {isSupported && scenario.agentStatus !== "done" && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          此格子已支持。可验证正确性或重新实现。
        </div>
      )}
      {canOperate && scenario.agentStatus === "not-started" && !contract && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          下一步:点击「启动需求」描述你的需求,让 Clarifier 生成行为契约。
        </div>
      )}
      {canOperate && contract?.row.status === "draft" && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          下一步:审阅下方契约草稿,确认无误后点击「审批契约」。
        </div>
      )}
      {canOperate && contract?.row.status === "approved" && scenario.agentStatus === "pending-goal" && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
          下一步:契约已审批,点击「启动全流程」一键执行 需求 → 代码 → 测试 → 上线。
        </div>
      )}

      {/* Section B: 状态操作栏 */}
      <section className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
        <span className="text-xs font-semibold text-muted-foreground">业务状态:</span>
        <CellStatusSelect cellId={cellId} currentStatus={scenario.status} />
        <AnalyzeCellButton cellId={cellId} />
      </section>

      {/* Section C: 契约区 */}
      {contract !== null && (
        <section className="space-y-3 border-b border-border pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">行为契约</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-semibold ${
                contract.row.status === "approved" ? "bg-green-100 text-green-700 border border-green-200"
                : contract.row.status === "blocked" ? "bg-red-100 text-red-700 border border-red-200"
                : "bg-yellow-100 text-yellow-700 border border-yellow-200"
              }`}>
                {contract.row.status}
              </span>
              <span className="font-mono text-muted-foreground">{contract.row.id}</span>
            </div>
          </div>
          {contract.markdown !== null ? (
            (() => {
              const parsed = parseContract(contract.markdown);
              if (parsed.ok) {
                return <ContractView contract={parsed.data} rawMarkdown={contract.markdown} />;
              }
              return (
                <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
                  契约解析失败: {parsed.errors.join("; ")}
                </div>
              );
            })()
          ) : (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
              读取契约文件失败:{contract.readError ?? "未知错误"}
            </div>
          )}
          {canOperate && contract.row.status === "draft" && (
            <ApproveContractButton contractId={contract.row.id} />
          )}
        </section>
      )}

      {/* Section D: Agent 操作区 (仅可操作) */}
      {canOperate && (
        <section className="space-y-3 border-b border-border pb-4">
          <h2 className="text-base font-semibold">Agent 操作</h2>

          {/* 下一步操作提示 */}
          {scenario.agentStatus === "blocked" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              此格子的 Agent 流程受阻。你可以重新运行 Clarifier 生成新契约,或展开手动模式从特定步骤重试。
            </div>
          )}

          {/* 启动需求 (Clarifier): 无契约 / 契约 blocked / 契约 draft 都可重新运行 */}
          {(!contract || contract.row.status === "blocked" || contract.row.status === "draft") && (
            <StartFeatureDialog
              cellId={cellId}
              featureName={feature.name}
              scenarioName={scenarioName}
              existingContract={contract ? { id: contract.row.id, status: contract.row.status, markdown: contract.markdown } : null}
            />
          )}

          {/* 全流程 + 手动模式:契约 approved 时可用 */}
          {contract?.row.status === "approved" && (
            <div className="space-y-3">
              <StartFullLoopButton contractId={contract.row.id} />
              <details className="rounded-md border border-border p-3" open={scenario.agentStatus === "blocked"}>
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                  手动模式(逐步执行 — 需求/代码/测试/上线)
                </summary>
                <div className="mt-3 flex flex-wrap gap-2">
                  <RunCoderButton contractId={contract.row.id} />
                  {(scenario.agentStatus === "tests-pending" || scenario.agentStatus === "blocked") && (
                    <RunQaButton cellId={cellId} />
                  )}
                  {(scenario.agentStatus === "qa-passed" || scenario.agentStatus === "blocked") && (
                    <RunCommitterButton cellId={cellId} />
                  )}
                </div>
              </details>
            </div>
          )}
        </section>
      )}

      {/* Section E: 历史区 */}
      <section className="space-y-4 border-b border-border pb-4">
        <h2 className="text-base font-semibold">历史记录</h2>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">时间线</h3>
            <CellTimeline runs={allRuns} contracts={allContracts} commits={allCommits} />
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">关联代码</h3>
            <CellFiles gitSha={latestCommit?.gitSha ?? null} />
            {latestCommit?.gitSha && (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-muted-foreground">commit:</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{latestCommit.gitSha}</code>
              </div>
            )}
          </div>
        </div>

        {qaReport && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">QA Report</h3>
            <div className="rounded-md border border-border bg-muted p-3 text-xs space-y-2">
              <div className="font-mono text-muted-foreground">
                runAt={qaReport.runAt} · passed={qaReport.lenient.passed} failed={qaReport.lenient.failed}
              </div>
              <ul className="space-y-1">
                {qaReport.acResults.map((ac) => (
                  <li key={ac.acId} className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${ac.status === "pass" ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="font-mono">{ac.acId}</span>
                    <span className="text-muted-foreground">{ac.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {scenario.agentStatus === "blocked" && reflections.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">受阻反思</h3>
            {reflections.map((ref) => (
              <div key={ref.id} className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs space-y-1">
                <div className="font-semibold text-yellow-900">{ref.failureSummary}</div>
                <pre className="whitespace-pre-wrap text-[10px] text-yellow-800 bg-white/60 rounded p-2">
                  {ref.reflectionText}
                </pre>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section F: 已支持格子操作区 */}
      {isSupported && (
        <section className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
          <VerifyCellButton cellId={cellId} />
          <ReimplementButton cellId={cellId} />
        </section>
      )}
    </div>
  );
}
