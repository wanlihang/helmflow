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

export function StartFeatureDialog({ feature }: StartFeatureDialogProps) {
  const [open, setOpen] = useState(false);
  const [userRequest, setUserRequest] = useState("");
  const [clarifying, setClarifying] = useState(false);
  const [clarifierOutput, setClarifierOutput] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      clearTimer();
      setUserRequest("");
      setClarifying(false);
      setClarifierOutput("");
    }
  };

  const runMock = () => {
    clearTimer();
    const text = buildMockMarkdown(feature, userRequest);
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
            Acceptance Criteria / API Contract。当前为 Mock 流式输出,真实 LLM 在 Goal 3 接通。
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
          <div>
            <Button onClick={runMock} disabled={clarifying} variant="default">
              {clarifying ? "Clarifier 运行中..." : "运行 Clarifier(Mock)"}
            </Button>
          </div>

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
