"use client";

import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

type ToastVariant = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  title?: string;
  description?: ReactNode;
}

interface ToastApi {
  toast: (t: Omit<ToastItem, "id">) => void;
  success: (title: string, description?: ReactNode) => void;
  error: (title: string, description?: ReactNode) => void;
  warning: (title: string, description?: ReactNode) => void;
  info: (title: string, description?: ReactNode) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** 必须在 ToastProvider 内调用。无 provider 时降级为 noop(避免 throw 破坏渲染) */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    const noop = () => {};
    return { toast: noop, success: noop, error: noop, warning: noop, info: noop };
  }
  return ctx;
}

const variantCfg: Record<ToastVariant, { icon: ReactNode; cls: string }> = {
  success: { icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />, cls: "border-green-200" },
  error: { icon: <XCircle className="h-4 w-4 shrink-0 text-red-600" />, cls: "border-red-200" },
  warning: { icon: <AlertCircle className="h-4 w-4 shrink-0 text-yellow-600" />, cls: "border-yellow-200" },
  info: { icon: <Info className="h-4 w-4 shrink-0 text-blue-600" />, cls: "border-blue-200" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<ToastItem, "id">) => {
      seq.current += 1;
      const id = seq.current;
      setToasts((prev) => [...prev, { ...t, id }]);
      setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  const api: ToastApi = {
    toast: push,
    success: (title, description) => push({ variant: "success", title, description }),
    error: (title, description) => push({ variant: "error", title, description }),
    warning: (title, description) => push({ variant: "warning", title, description }),
    info: (title, description) => push({ variant: "info", title, description }),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => {
          const cfg = variantCfg[t.variant];
          return (
            <div
              key={t.id}
              className={cn(
                "pointer-events-auto flex w-80 items-start gap-2 rounded-md border bg-card p-3 shadow-lg",
                cfg.cls,
              )}
            >
              {cfg.icon}
              <div className="flex-1">
                {t.title ? <div className="text-sm font-semibold">{t.title}</div> : null}
                {t.description ? (
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="关闭"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
