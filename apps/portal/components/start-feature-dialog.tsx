"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { Feature } from "@/lib/matrix";

interface StartFeatureDialogProps {
  feature: Feature;
}

function buildMockMarkdown(feature: Feature, userRequest: string): string {
  const trimmed = userRequest.trim() || "(用户未填写需求,使用默认占位)";
  return `# F-${feature.id}: ${feature.name}

## Problem Definition
(基于用户输入"${trimmed}"的占位符问题定义。真实 Clarifier 在 Goal 3 接通。)

## State Machine
INIT → IN_PROGRESS → DONE

## Business Rules
- BR-001: 校验前置状态符合
- BR-002: 操作幂等

## Acceptance Criteria
- AC-001: 调用 createX 后 status 转为 IN_PROGRESS
- AC-002: 重复调用不产生副作用

## API Contract
| Method | Request | Response |
| ------ | ------- | -------- |
| startX | StartXCommand | Result<Long> |
`;
}

type SseEvent =
  | { type: "token"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

function parseSseLine(line: string): SseEvent | null {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6).trim();
  if (payload.length === 0) return null;
  try {
    return JSON.parse(payload) as SseEvent;
  } catch {
    return null;
  }
}

export function StartFeatureDialog({ feature }: StartFeatureDialogProps) {
  const [open, setOpen] = useState(false);
  const [userRequest, setUserRequest] = useState("");
  const [clarifying, setClarifying] = useState(false);
  const [clarifierOutput, setClarifierOutput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clearTimer = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const abortStream = () => {
    if (abortRef.current !== null) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTimer();
      abortStream();
    };
  }, []);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      clearTimer();
      abortStream();
      setUserRequest("");
      setClarifying(false);
      setClarifierOutput("");
      setErrorMessage(null);
    }
  };

  const runMock = () => {
    clearTimer();
    abortStream();
    const text = buildMockMarkdown(feature, userRequest);
    setErrorMessage(null);
    setClarifying(true);
    setClarifierOutput("");
    let index = 0;
    intervalRef.current = setInterval(() => {
      index += 1;
      if (index >= text.length) {
        setClarifierOutput(text);
        clearTimer();
        setClarifying(false);
        return;
      }
      setClarifierOutput(text.slice(0, index));
    }, 100);
  };

  const runReal = async () => {
    clearTimer();
    abortStream();
    setErrorMessage(null);
    setClarifying(true);
    setClarifierOutput("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId: feature.id, userRequest }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const json = (await res.json()) as { error?: string };
          if (json.error) detail = `${detail} — ${json.error}`;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }
      if (!res.body) {
        throw new Error("响应体为空,无法读取 SSE 流");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let aggregated = "";
      let finished = false;

      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nlIdx = buffer.indexOf("\n");
        while (nlIdx >= 0) {
          const line = buffer.slice(0, nlIdx).replace(/\r$/, "");
          buffer = buffer.slice(nlIdx + 1);
          nlIdx = buffer.indexOf("\n");

          const ev = parseSseLine(line);
          if (!ev) continue;

          if (ev.type === "token") {
            aggregated += ev.text;
            setClarifierOutput(aggregated);
          } else if (ev.type === "done") {
            finished = true;
            break;
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // user closed dialog; swallow
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage(message);
      }
    } finally {
      abortRef.current = null;
      setClarifying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="lg">启动需求</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="font-mono">{feature.id}</span> · {feature.name}
          </DialogTitle>
          <DialogDescription>
            描述需求,然后运行 Clarifier 生成 Problem / State Machine / Business Rules /
            Acceptance Criteria / API Contract / Domain Model。
            真实模式调 Anthropic Claude,Mock 模式用于离线演示。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="userRequest">
            你的需求描述
          </label>
          <Textarea
            id="userRequest"
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            disabled={clarifying}
            placeholder={`例如:为 ${feature.name} 增加 XX 行为,需考虑 YY 边界条件...`}
            rows={4}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={runReal} disabled={clarifying} variant="default">
              {clarifying ? "Clarifier 运行中..." : "运行 Clarifier(真实)"}
            </Button>
            <Button onClick={runMock} disabled={clarifying} variant="outline">
              运行 Clarifier(Mock)
            </Button>
          </div>

          {errorMessage && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <div className="font-semibold">Clarifier 调用失败</div>
              <div className="mt-1 font-mono break-words">{errorMessage}</div>
            </div>
          )}

          {clarifierOutput && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">
                Clarifier 输出 {clarifying ? "(streaming...)" : "(完成)"}
              </div>
              <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-xs leading-relaxed max-h-96 overflow-auto">
                {clarifierOutput}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={clarifying}>
              关闭
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
