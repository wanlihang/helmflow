"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type ReactNode, useCallback, useState } from "react";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** destructive 用红色按钮(删除/归档等不可逆操作) */
  variant?: "default" | "destructive";
  loading?: boolean;
}

/** 受控确认弹窗(适合自己管 open state 的场景) */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  variant = "default",
  loading = false,
  onConfirm,
}: ConfirmOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" type="button" disabled={loading}>
              {cancelText}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant={variant === "destructive" ? "destructive" : "default"}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? "处理中..." : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmState {
  open: boolean;
  opts: ConfirmOptions | null;
  resolve?: (ok: boolean) => void;
}

/**
 * 命令式确认(替代 window.confirm)。返回 [confirm, element]。
 * 用法:
 *   const [confirm, confirmEl] = useConfirm();
 *   const ok = await confirm({ title:"删除?", variant:"destructive" });
 *   if (ok) doDelete();
 *   return <>{confirmEl}...</>  // 必须渲染 confirmEl
 */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<ConfirmState>({ open: false, opts: null });

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ open: true, opts, resolve });
      }),
    [],
  );

  const handle = useCallback((ok: boolean) => {
    setState((prev) => {
      prev.resolve?.(ok);
      return { open: false, opts: null };
    });
  }, []);

  const element = state.opts ? (
    <ConfirmDialog
      open={state.open}
      onOpenChange={(o) => {
        if (!o) handle(false);
      }}
      title={state.opts.title}
      description={state.opts.description}
      confirmText={state.opts.confirmText}
      cancelText={state.opts.cancelText}
      variant={state.opts.variant}
      loading={state.opts.loading}
      onConfirm={() => handle(true)}
    />
  ) : null;

  return [confirm, element];
}
