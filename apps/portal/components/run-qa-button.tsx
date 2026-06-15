"use client";

import { RunAgentButton, type SseRunResult } from "@/components/run-agent-button";

interface RunQaButtonProps {
  cellId: string;
}

interface QaReport {
  schemaVersion: number;
  cellId: string;
  runAt: string;
  lenient: { totalRun: number; passed: number; failed: number };
  acResults: Array<{
    acId: string;
    status: "pass" | "fail";
    tests?: string[];
    failureReason?: string;
    suggestedFix?: string;
  }>;
  gapsDetected: number;
  escalateAction: string;
}

export function RunQaButton({ cellId }: RunQaButtonProps) {
  return (
    <RunAgentButton
      label="运行 Test"
      title="Test Worker (HelmCode verify)"
      description={
        <>
          加载 HelmCode{" "}
          <code className="font-mono">core/verify</code> skill,独立回归验证。
        </>
      }
      endpoint="/api/test/run"
      body={{ cellId }}
      restoreEndpoint={`/api/test/run?cellId=${encodeURIComponent(cellId)}`}
      idLabel={cellId}
      passedText="✅ Test 通过 · feature → qa-passed"
      blockedText="❌ Test 失败 · feature → blocked"
      renderResult={(result: SseRunResult) => {
        const report = result.report as QaReport | undefined;
        const issues = result.issues as
          | Array<{ check: string; detail: string }>
          | undefined;
        const reportPath = result.reportPath as string | undefined;
        return (
          <>
            {report && (
              <div className="space-y-2 mt-1">
                <div className="text-xs font-semibold text-muted-foreground">
                  QA Report · AC 覆盖
                </div>
                <div className="rounded-md border border-border bg-muted p-3 text-xs space-y-1">
                  <div className="font-mono text-muted-foreground">
                    total={report.lenient.totalRun} passed=
                    {report.lenient.passed} failed={report.lenient.failed} gaps=
                    {report.gapsDetected} escalate={report.escalateAction}
                  </div>
                  <ul className="space-y-1 mt-2">
                    {report.acResults.map((ac) => (
                      <li key={ac.acId} className="flex items-start gap-2">
                        <span
                          className={`mt-0.5 inline-block h-2.5 w-2.5 rounded-full shrink-0 ${
                            ac.status === "pass" ? "bg-green-500" : "bg-red-500"
                          }`}
                        />
                        <div>
                          <span className="font-mono font-semibold">
                            {ac.acId}
                          </span>
                          <span className="ml-1 text-muted-foreground">
                            {ac.status}
                          </span>
                          {ac.failureReason && (
                            <div className="text-red-600 text-[10px] mt-0.5 whitespace-pre-wrap">
                              {ac.failureReason}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {result.status === "blocked" && issues && (
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                {issues.map((i, idx) => (
                  <li key={`${i.check}-${idx}`}>
                    <code className="font-mono">{i.check}</code> — {i.detail}
                  </li>
                ))}
              </ul>
            )}
            {reportPath && (
              <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                report={reportPath}
              </div>
            )}
          </>
        );
      }}
    />
  );
}