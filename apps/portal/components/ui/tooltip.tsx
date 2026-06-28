"use client";

import { cn } from "@/lib/utils";
import { type ReactNode, useState } from "react";

/**
 * 轻量 hover/focus 提示(纯 CSS,无 radix 依赖)。
 * 用于状态 Badge 等需要解释语义的场景。
 */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && content ? (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background shadow-md">
          {content}
        </span>
      ) : null}
    </span>
  );
}
