import { readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { AnalyzeCellButton } from "@/components/analyze-cell-button";
import { ApproveContractButton } from "@/components/approve-contract-button";
import { CellFiles } from "@/components/cell-files";
import { CellLifecycleBar } from "@/components/cell-lifecycle-bar";
import { CellStatusSelect } from "@/components/cell-status-select";
import { CellTimeline } from "@/components/cell-timeline";
import { ContractRenderDialog } from "@/components/contract-render-dialog";
import { ContractFallbackView, ContractView } from "@/components/contract-view";
import { ReimplementButton } from "@/components/reimplement-button";
import { RejectContractButton } from "@/components/reject-contract-button";
import { StartFeatureDialog } from "@/components/start-feature-dialog";
import { StartFullLoopButton } from "@/components/start-full-loop-button";
import { Badge } from "@/components/ui/badge";
import { VerifyCellButton } from "@/components/verify-cell-button";
import { getDb } from "@/lib/db";
import { getCell, getDomainOfFeature } from "@/lib/matrix";
import { parseContract } from "@helmflow/contract-schema";
import { parseHelmcodeContract } from "@helmflow/contract-sync";
import {
  type CommitRow,
  type ContractRow,
  type ReflectionRow,
  type RunRow,
  getLatestCommit,
  getLatestContract,
  getLatestRequireInput,
  listCommitsForCell,
  listContractsForCell,
  listReflectionsForFeature,
  listRunsForCell,
} from "@helmflow/storage";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parse as parseYaml } from "yaml";

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
      // 兼容绝对路径(目标项目 HelmCode 导入契约)与相对路径(历史 Clarifier 产出)
      const mdPath = isAbsolute(row.markdownPath)
        ? row.markdownPath
        : join(process.cwd(), row.markdownPath);
      const md = readFileSync(mdPath, "utf-8");
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
  // 最近一次「启动需求」输入的原始需求(常驻展示,关闭弹窗后仍可见)
  let requireInput: { runId: string; userRequest: string; startedAt: string } | null = null;
  try {
    requireInput = getLatestRequireInput(getDb(), cellId);
  } catch {
    requireInput = null;
  }
  const allRuns = loadAllRuns(cellId);
  const allContracts = loadAllContracts(cellId);
  const allCommits = loadAllCommits(cellId);
  const latestCommit =
    allCommits.length > 0
      ? (allCommits.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0] ?? null)
      : null;
  const qaReport = loadLatestQaReport(cellId);
  const reflections = scenario.agentStatus === "blocked" ? loadReflections(cellId) : [];

  return (
    <div className="space-y-6">
      {/* 面包屑 */}
      <nav className="text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span>{domain?.name ?? "未分类"}</span>
        <span className="mx-2">/</span>
        <Link href={`/features/${id}`} className="hover:text-foreground font-mono">
          {id}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{scenarioName}</span>
      </nav>

      {/* ① 当前状态 + 引导 */}
      <header className="space-y-3 border-b border-border pb-4">
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="font-mono text-muted-foreground">{id}</span> <span>{feature.name}</span>{" "}
          <span className="text-lg text-muted-foreground">· {scenarioName}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge scenario={scenario.status} />
          {scenario.agentStatus !== "not-started" && scenario.agentStatus !== "done" && (
            <Badge status={scenario.agentStatus} />
          )}
        </div>

        {/* 生命周期进度条 */}
        <CellLifecycleBar
          scenarioStatus={scenario.status}
          agentStatus={scenario.agentStatus}
          contractStatus={contract?.row.status ?? null}
          hasContract={contract !== null}
        />
      </header>

      {/* 需求描述(最近一次「启动需求」输入的原文,常驻可见) */}
      {requireInput ? (
        <section className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground">需求描述</h2>
            <span className="font-mono text-[10px] text-muted-foreground">
              {requireInput.startedAt}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm">{requireInput.userRequest}</p>
        </section>
      ) : (
        canOperate && (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            尚未输入需求 · 点下方「启动需求」描述你要实现的行为。
          </div>
        )
      )}

      {/* 分层归属精简(链接 feature 页看全) */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">分层归属:</span>
        {feature.implementation.decider ||
        feature.implementation.acceptor ||
        feature.implementation.handler ? (
          <Link
            href={`/features/${id}`}
            className="flex items-center gap-1 font-mono text-blue-600 hover:underline"
          >
            {feature.implementation.decider && <span>{feature.implementation.decider}</span>}
            {feature.implementation.acceptor && (
              <>
                {" → "}
                <span>{feature.implementation.acceptor}</span>
              </>
            )}
            {feature.implementation.handler && (
              <>
                {" → "}
                <span>{feature.implementation.handler}</span>
              </>
            )}
          </Link>
        ) : (
          <span className="text-muted-foreground">待分析</span>
        )}
      </div>

      {/* 生命周期引导:根据状态提示 + 操作按钮 */}
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2.5">
        {canOperate &&
          (!contract || contract.row.status === "blocked" || contract.row.status === "draft") && (
            <StartFeatureDialog
              cellId={cellId}
              featureName={feature.name}
              scenarioName={scenarioName}
              existingContract={
                contract
                  ? {
                      id: contract.row.id,
                      status: contract.row.status,
                      markdown: contract.markdown,
                    }
                  : null
              }
            />
          )}
        {canOperate && contract?.row.status === "approved" && (
          // 契约已 approved(Plan 定稿)→ Act 从 code 起,跳过 clarify
          <StartFullLoopButton contractId={contract.row.id} startNode="code" />
        )}
        {isSupported && (
          <>
            <VerifyCellButton cellId={cellId} />
            <ReimplementButton cellId={cellId} />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <CellStatusSelect cellId={cellId} currentStatus={scenario.status} />
          <AnalyzeCellButton cellId={cellId} />
        </div>
      </div>

      {scenario.agentStatus === "blocked" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Agent 流程受阻。可重新启动需求生成新契约,或修改状态后重试全流程。
        </div>
      )}
      {isDeprecated && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          此功能已废弃,不纳入开发管理。
        </div>
      )}

      {/* ② 契约(需求规格) */}
      {contract !== null && (
        <section className="space-y-3 border-b border-border pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">行为契约</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 font-semibold ${
                  contract.row.status === "approved" || contract.row.status === "done"
                    ? "bg-green-100 text-green-700 border border-green-200"
                    : contract.row.status === "goal-running"
                      ? "bg-blue-100 text-blue-700 border border-blue-200"
                      : contract.row.status === "blocked"
                        ? "bg-red-100 text-red-700 border border-red-200"
                        : "bg-yellow-100 text-yellow-700 border border-yellow-200"
                }`}
              >
                {contract.row.status}
              </span>
              <span className="font-mono text-muted-foreground">{contract.row.id}</span>
              {contract.markdown !== null && (
                <ContractRenderDialog rawMarkdown={contract.markdown} />
              )}
            </div>
          </div>
          {contract.markdown !== null ? (
            (() => {
              const parsed = parseContract(contract.markdown);
              if (parsed.ok) {
                return <ContractView contract={parsed.data} />;
              }
              // 结构化解析失败(HelmCode 格式或老英文契约)→ 元信息+原文兜底
              const hc = parseHelmcodeContract(contract.markdown, contract.row.markdownPath);
              if (hc.ok) {
                return <ContractFallbackView meta={hc.data} />;
              }
              return (
                <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
                  契约结构化解析失败(可能为非标准格式),可点上方「查看完整契约」弹窗查看原文。
                </div>
              );
            })()
          ) : (
            <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
              读取契约文件失败:{contract.readError ?? "未知错误"}
            </div>
          )}
          {canOperate && contract.row.status === "draft" && (
            <div className="flex gap-2">
              <ApproveContractButton contractId={contract.row.id} />
              <RejectContractButton contractId={contract.row.id} />
            </div>
          )}
        </section>
      )}

      {/* ③ 历史与验证 */}
      <section className="space-y-4 border-b border-border pb-4">
        <h2 className="text-base font-semibold">历史与验证</h2>

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
                <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  {latestCommit.gitSha}
                </code>
              </div>
            )}
          </div>
        </div>

        {qaReport && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">QA Report</h3>
            <div className="rounded-md border border-border bg-muted p-3 text-xs space-y-2">
              <div className="font-mono text-muted-foreground">
                runAt={qaReport.runAt} · passed={qaReport.lenient.passed} failed=
                {qaReport.lenient.failed}
              </div>
              <ul className="space-y-1">
                {qaReport.acResults.map((ac) => (
                  <li key={ac.acId} className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${ac.status === "pass" ? "bg-green-500" : "bg-red-500"}`}
                    />
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
              <div
                key={ref.id}
                className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs space-y-1"
              >
                <div className="font-semibold text-yellow-900">{ref.failureSummary}</div>
                <pre className="whitespace-pre-wrap text-[10px] text-yellow-800 bg-white/60 rounded p-2">
                  {ref.reflectionText}
                </pre>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
