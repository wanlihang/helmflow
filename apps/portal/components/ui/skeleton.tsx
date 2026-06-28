import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

/** 骨架屏占位,用于加载态(替代 animate-pulse 文字光标) */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
