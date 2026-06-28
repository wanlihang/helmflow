import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** 加载旋转图标(替代 animate-pulse 文字光标) */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
}
