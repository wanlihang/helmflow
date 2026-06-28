"use client";

import { ConversationView } from "@/components/conversation-view";
import { StartFullLoopButton } from "@/components/start-full-loop-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface RequirementSummary {
  id: string;
  title: string;
  description: string;
  status: string;
  agentStatus: string;
  projectId: string;
  sessionId: string | null;
  clarifyRunId: string | null;
}

interface ContractSummary {
  id: string;
  status: string;
  markdown: string | null;
}

interface Props {
  requirement: RequirementSummary;
  latestContract: ContractSummary | null;
}

const STATUS_LABEL: Record<string, string> = {
  clarifying: "澄清中",
  "contract-draft": "契约草稿",
  approved: "已审批",
  running: "实现中",
  done: "已完成",
  blocked: "已阻塞",
  abandoned: "已废弃",
};

export function RequirementConversationClient({ requirement, latestContract }: Props) {
  const router = useRouter();
  const [clarifyRunId, setClarifyRunId] = useState<string | null>(requirement.clarifyRunId);
  const [contract, setContract] = useState<ContractSummary | null>(latestContract);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeRunId, setFinalizeRunId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const conversationStarted = !!requirement.sessionId || !!clarifyRunId;

  // 发送一条对话消息
  const sendMessage = useCallback(async () => {
    const msg = message.trim();
    if (!msg || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/requirements/${requirement.id}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.runId) setClarifyRunId(data.runId);
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [message, sending, requirement.id]);

  // 生成契约
  const finalizeContract = useCallback(async () => {
    if (finalizing) return;
    setFinalizing(true);
    setError(null);
    try {
      const res = await fetch(`/api/requirements/${requirement.id}/finalize-contract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.runId) setFinalizeRunId(data.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFinalizing(false);
    }
  }, [finalizing, requirement.id]);

  // finalize 期间轮询需求详情,契约 draft 出现即刷新
  useEffect(() => {
    if (!finalizing) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/requirements/${requirement.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const c = data.latestContract;
        if (c && c.status === "draft" && c.id !== contract?.id) {
          setFinalizing(false);
          router.refresh();
        }
      } catch {
        /* ignore poll errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [finalizing, requirement.id, contract?.id, router]);

  // 审批契约
  const approveContract = useCallback(async () => {
    if (!contract || approving) return;
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  }, [contract, approving, router]);

  const isApproved = contract?.status === "approved" || requirement.status === "approved";

  return (
    <div className="space-y-5">
      {/* 标题 + 状态 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{requirement.title}</h1>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">{requirement.id}</div>
          {requirement.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{requirement.description}</p>
          ) : null}
        </div>
        <Badge variant="outline">{STATUS_LABEL[requirement.status] ?? requirement.status}</Badge>
      </div>

      {/* 对话区 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">需求澄清对话</h2>
          <Button
            size="sm"
            variant="secondary"
            onClick={finalizeContract}
            disabled={!conversationStarted || finalizing || isApproved}
            title={!conversationStarted ? "先发一条消息开始对话" : ""}
          >
            {finalizing ? "生成中..." : "生成契约"}
          </Button>
        </div>
        {clarifyRunId ? (
          <ConversationView runId={clarifyRunId} />
        ) : (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            还没有对话。在下面输入需求,像用 Claude Code 一样开始澄清。
          </div>
        )}

        {/* 消息输入 */}
        <div className="flex gap-2">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="描述需求、回答 Claude 的提问…(⌘/Ctrl+Enter 发送)"
            rows={2}
            disabled={sending || isApproved}
          />
          <Button onClick={sendMessage} disabled={sending || !message.trim() || isApproved}>
            {sending ? "发送中" : "发送"}
          </Button>
        </div>
      </div>

      {/* 生成契约进度(独立 run) */}
      {finalizing && finalizeRunId ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">生成契约中…</h2>
          <ConversationView runId={finalizeRunId} />
        </div>
      ) : null}

      {/* 契约预览 / 审批 / 启动执行 */}
      {contract ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              行为契约 <Badge variant="outline">{contract.status}</Badge>
            </h2>
            <div className="flex gap-2">
              {contract.status === "draft" ? (
                <Button size="sm" onClick={approveContract} disabled={approving}>
                  {approving ? "审批中" : "审批契约"}
                </Button>
              ) : null}
              {isApproved ? <StartFullLoopButton contractId={contract.id} startNode="code" /> : null}
            </div>
          </div>
          {contract.markdown ? (
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-zinc-950 p-4 font-mono text-xs text-zinc-200">
              {contract.markdown}
            </pre>
          ) : (
            <div className="rounded-md border border-border p-4 text-xs text-muted-foreground">
              契约文件不可读(path: {contract.id})
            </div>
          )}
        </div>
      ) : null}

      {error ? <div className="text-xs text-red-600">{error}</div> : null}
    </div>
  );
}
