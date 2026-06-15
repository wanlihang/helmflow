"use client";

import { RunAgentButton, type SseRunResult } from "@/components/run-agent-button";

interface RunCommitterButtonProps {
  cellId: string;
}

export function RunCommitterButton({ cellId }: RunCommitterButtonProps) {
  return (
    <RunAgentButton
      label="提交 Deploy"
      title="Deploy Worker (HelmCode deploy)"
      description="commit + push + 创建 PR,输出 PR_URL。"
      endpoint="/api/deploy/run"
      body={{ cellId }}
      restoreEndpoint={`/api/deploy/run?cellId=${encodeURIComponent(cellId)}`}
      idLabel={cellId}
      passedText="✅ Deploy 通过 · feature → done"
      blockedText="❌ Deploy 失败 · feature 保留 qa-passed"
      renderResult={(result: SseRunResult) => {
        const reason = result.reason as string | undefined;
        const commitSha = result.commitSha as string | undefined;
        const commitMessage = result.commitMessage as string | undefined;
        return (
          <>
            {result.status === "blocked" && reason && (
              <div className="mt-1">原因: {reason}</div>
            )}
            {commitSha && (
              <div className="mt-1 font-mono">
                SHA: <code className="font-bold">{commitSha}</code>
              </div>
            )}
            {commitMessage && (
              <pre className="mt-1 whitespace-pre-wrap text-[10px] text-muted-foreground bg-white/60 rounded p-2 border border-border">
                {commitMessage}
              </pre>
            )}
          </>
        );
      }}
    />
  );
}