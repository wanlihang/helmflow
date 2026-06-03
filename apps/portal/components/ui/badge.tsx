import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "outline";
type StatusVariant =
  | "not-started"
  | "clarifying"
  | "pending-goal"
  | "implementing"
  | "done"
  | "blocked"
  | "abandoned";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  status?: StatusVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  outline: "border border-border bg-transparent text-foreground",
};

const statusClasses: Record<StatusVariant, string> = {
  "not-started": "bg-status-notStarted text-foreground",
  clarifying: "bg-status-clarifying text-white",
  "pending-goal": "bg-status-pendingGoal text-white",
  implementing: "bg-status-implementing text-white",
  done: "bg-status-done text-white",
  blocked: "bg-status-blocked text-white",
  abandoned: "bg-status-abandoned text-white",
};

const statusLabel: Record<StatusVariant, string> = {
  "not-started": "未启动",
  clarifying: "澄清中",
  "pending-goal": "待 goal",
  implementing: "实施中",
  done: "已完成",
  blocked: "受阻",
  abandoned: "已放弃",
};

export function Badge({ variant = "default", status, className, children, ...props }: BadgeProps) {
  const colorClass = status ? statusClasses[status] : variantClasses[variant];
  const content = status && children == null ? statusLabel[status] : children;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        colorClass,
        className,
      )}
      {...props}
    >
      {content}
    </span>
  );
}

export { statusLabel };
