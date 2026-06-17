"use client";

import { useState } from "react";
import type { Contract } from "@helmflow/contract-schema";
import type { HelmcodeContractMeta } from "@helmflow/contract-sync";

interface ContractViewProps {
  contract: Contract;
  rawMarkdown: string;
}

function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen((p) => !p)}
      >
        <span>{title}</span>
        <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function ContractView({ contract, rawMarkdown }: ContractViewProps) {
  return (
    <div className="space-y-3">
      {/* Acceptance Criteria — 核心：怎么判断需求完成 */}
      {contract.acceptanceCriteria.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold text-muted-foreground">
            验收标准 ({contract.acceptanceCriteria.length})
          </h3>
          <ul className="space-y-1">
            {contract.acceptanceCriteria.map((ac) => (
              <li key={ac.id} className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed">
                <span className="inline-block rounded bg-blue-100 text-blue-700 px-1.5 py-0.5 font-mono font-semibold mr-2">
                  {ac.id}
                </span>
                {ac.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Business Rules */}
      {contract.businessRules.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold text-muted-foreground">
            业务规则 ({contract.businessRules.length})
          </h3>
          <ul className="space-y-1">
            {contract.businessRules.map((br) => (
              <li key={br.id} className="text-xs leading-relaxed pl-2 border-l-2 border-amber-300">
                <span className="font-mono font-semibold text-amber-700 mr-1">{br.id}:</span>
                {br.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* API Contract */}
      {contract.apiContract.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold text-muted-foreground">
            API 接口 ({contract.apiContract.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-2 py-1 text-left font-semibold">Method</th>
                  <th className="px-2 py-1 text-left font-semibold">Request</th>
                  <th className="px-2 py-1 text-left font-semibold">Response</th>
                </tr>
              </thead>
              <tbody>
                {contract.apiContract.map((api, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="px-2 py-1 font-mono">{api.method}</td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{api.request}</td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{api.response}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Collapsible sections */}
      <div className="space-y-2">
        <Collapsible title="Problem Definition" defaultOpen={false}>
          <p className="text-xs leading-relaxed whitespace-pre-wrap">
            {contract.problemDefinition}
          </p>
        </Collapsible>

        <Collapsible title="State Machine" defaultOpen={false}>
          <pre className="text-[10px] leading-relaxed whitespace-pre-wrap bg-muted rounded p-2 overflow-auto max-h-64">
            {contract.stateMachine}
          </pre>
        </Collapsible>

        <Collapsible title="Domain Model" defaultOpen={false}>
          <pre className="text-[10px] leading-relaxed whitespace-pre-wrap bg-muted rounded p-2 overflow-auto max-h-64">
            {contract.domainModel}
          </pre>
        </Collapsible>

        <Collapsible title="原始 Markdown" defaultOpen={false}>
          <pre className="text-[10px] leading-relaxed whitespace-pre-wrap bg-muted rounded p-2 overflow-auto max-h-96">
            {rawMarkdown}
          </pre>
        </Collapsible>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 兜底视图:结构化解析失败时,展示元信息卡片 + 原始 markdown。
// 服务于 HelmCode 导入契约(无英文章节)和老英文契约。
// ---------------------------------------------------------------------------

const HC_STATUS_BADGE: Record<string, string> = {
  done: "bg-green-100 text-green-700",
  approved: "bg-green-100 text-green-700",
  "goal-running": "bg-blue-100 text-blue-700",
  draft: "bg-gray-100 text-gray-600",
};

export function ContractFallbackView({ meta, rawMarkdown }: { meta: HelmcodeContractMeta; rawMarkdown: string }) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold">{meta.featureId}</span>
          <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-semibold ${HC_STATUS_BADGE[meta.status] ?? "bg-gray-100 text-gray-600"}`}>
            {meta.status}
          </span>
          {meta.domain && (
            <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-blue-700">
              领域: {meta.domain}
            </span>
          )}
        </div>
        <div className="text-muted-foreground">
          AC {meta.acCount} 条 · BR {meta.brCount} 条{meta.hasDomainModel ? " · 含领域模型" : ""}
        </div>
      </div>
      <ContractRawView rawMarkdown={rawMarkdown} />
    </div>
  );
}

export function ContractRawView({ rawMarkdown }: { rawMarkdown: string }) {
  return (
    <Collapsible title="原始 Markdown" defaultOpen={false}>
      <pre className="text-[10px] leading-relaxed whitespace-pre-wrap bg-muted rounded p-2 overflow-auto max-h-96">
        {rawMarkdown}
      </pre>
    </Collapsible>
  );
}
