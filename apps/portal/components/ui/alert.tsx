import { cn } from "@/lib/utils";
import { type HTMLAttributes, type ReactNode } from "react";

type AlertVariant = "info" | "success" | "warning" | "error";

const variantClasses: Record<AlertVariant, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-800",
  success: "border-green-200 bg-green-50 text-green-800",
  warning: "border-yellow-200 bg-yellow-50 text-yellow-800",
  error: "border-red-200 bg-red-50 text-red-800",
};

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
}

export function Alert({ className, variant = "info", ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn("rounded-md border p-3 text-sm", variantClasses[variant], className)}
      {...props}
    />
  );
}

export function AlertTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-1 font-semibold", className)}>{children}</div>;
}

export function AlertDescription({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("text-sm opacity-90", className)}>{children}</div>;
}
