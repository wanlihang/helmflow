"use client";

import { RunAgentButton, type SseRunResult } from "@/components/run-agent-button";

interface RunCoderButtonProps {
  contractId: string;
}

export function RunCoderButton({ contractId }: RunCoderButtonProps) {
  return (
    <RunAgentButton
      label="运行 Code"
      title="Code Worker (HelmCode implement)"
      description={
        <>
          加载 HelmCode{" "}
          <code className="font-mono">core/implement</code> skill,在 sandbox 内自驱
          Read / Write / Bash 实现代码。
        </>
      }
      endpoint="/api/code/run"
      body={{ contractId }}
      restoreEndpoint={`/api/code/run?contractId=${encodeURIComponent(contractId)}`}
      idLabel={contractId}
      passedText="✅ Code 通过 · feature → implementing"
      blockedText="❌ Code 失败 · feature → blocked"
      renderResult={(result: SseRunResult) => {
        const files = result.files as string[] | undefined;
        const reason = result.reason as string | undefined;
        return (
          <>
            {result.status === "blocked" && reason && (
              <div className="mt-1">原因: {reason}</div>
            )}
            {files && files.length > 0 && (
              <div className="mt-2">
                <div className="font-semibold">沙盒改动 ({files.length})</div>
                <ul className="list-disc pl-5 mt-1 font-mono">
                  {files.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        );
      }}
    />
  );
}