import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "outline";
type StatusVariant =
  | "not-started"
  | "clarifying"
  | "pending-goal"
  | "implementing"
  | "tests-pending"
  | "qa-passed"
  | "done"
  | "blocked"
  | "abandoned";

type ScenarioVariant = "已支持" | "需改造" | "待实现" | "废弃";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  status?: StatusVariant;
  scenario?: ScenarioVariant;
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
  "tests-pending": "bg-status-testsPending text-white",
  "qa-passed": "bg-status-qaPassed text-white",
  done: "bg-status-done text-white",
  blocked: "bg-status-blocked text-white",
  abandoned: "bg-status-abandoned text-white",
};

const statusLabel: Record<StatusVariant, string> = {
  "not-started": "未启动",
  clarifying: "澄清中",
  "pending-goal": "待 goal",
  implementing: "实施中",
  "tests-pending": "测试待跑",
  "qa-passed": "QA 通过",
  done: "已完成",
  blocked: "受阻",
  abandoned: "已放弃",
};

const scenarioClasses: Record<ScenarioVariant, string> = {
  已支持: "bg-green-100 text-green-800 border border-green-200",
  需改造: "bg-yellow-100 text-yellow-800 border border-yellow-200",
  待实现: "bg-gray-100 text-gray-600 border border-gray-200",
  废弃: "bg-red-100 text-red-800 border border-red-200",
};

export function Badge({ variant = "default", status, scenario, className, children, ...props }: BadgeProps) {
  let colorClass: string;
  let content: React.ReactNode;

  if (scenario) {
    colorClass = scenarioClasses[scenario];
    content = children ?? scenario;
  } else if (status) {
    colorClass = statusClasses[status];
    content = children ?? statusLabel[status];
  } else {
    colorClass = variantClasses[variant];
    content = children;
  }

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

export { statusLabel, scenarioClasses };
