import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef } from "react";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn("h-4 w-4 rounded border-border accent-blue-600", className)}
      {...props}
    />
  );
});
