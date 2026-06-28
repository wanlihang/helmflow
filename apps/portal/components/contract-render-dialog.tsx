"use client";

import { PlantUmlDiagram } from "@/components/plantuml-diagram";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { type ReactNode, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface ContractRenderDialogProps {
  rawMarkdown: string;
  /** features 详情页:作为 trigger 显示的按钮(不传则用默认「查看完整契约」按钮) */
  trigger?: ReactNode;
  /** 受控模式(同步页等外部触发打开):传 open + onOpenChange,此时不渲染 trigger */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// 剥离开头 yaml frontmatter(---\n...\n---\n),否则会被 react-markdown 当成 hr/表格
function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart();
}

const mdComponents: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-bold tracking-tight">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="mb-2 mt-5 border-b border-border pb-1 text-base font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-3 text-sm font-semibold text-muted-foreground">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-2 text-xs leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 text-xs leading-relaxed">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed">{children}</ol>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-amber-300 pl-3 text-xs text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  pre: ({ children }) => (
    <pre className="my-2 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed">
      {children}
    </pre>
  ),
  // react-markdown v10 的 code 组件无 inline prop:按 className 是否含 language- 或 children 是否含换行判断 block
  code({ children, className }) {
    const text = String(children ?? "");
    const match = /language-(\w+)/.exec(className ?? "");
    if (match?.[1] === "plantuml") {
      return <PlantUmlDiagram source={text} />;
    }
    const isBlock = className?.includes("language-") || text.includes("\n");
    if (!isBlock) {
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
          {children}
        </code>
      );
    }
    return <code className={cn("font-mono text-[11px]", className)}>{children}</code>;
  },
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border bg-muted/50">{children}</thead>,
  th: ({ children }) => <th className="px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-2 py-1 align-top">{children}</td>,
};

export function ContractRenderDialog({
  rawMarkdown,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: ContractRenderDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [view, setView] = useState<"render" | "source">("render");
  const isControlled = controlledOpen !== undefined;
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const content = useMemo(() => stripFrontmatter(rawMarkdown), [rawMarkdown]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <button
              type="button"
              className="inline-flex items-center rounded-md border border-border bg-transparent px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              查看完整契约
            </button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>行为契约</DialogTitle>
            <div className="flex items-center rounded-md border border-border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setView("render")}
                className={cn(
                  "rounded px-2.5 py-1 transition-colors",
                  view === "render" ? "bg-muted font-semibold" : "text-muted-foreground",
                )}
              >
                渲染
              </button>
              <button
                type="button"
                onClick={() => setView("source")}
                className={cn(
                  "rounded px-2.5 py-1 transition-colors",
                  view === "source" ? "bg-muted font-semibold" : "text-muted-foreground",
                )}
              >
                源码
              </button>
            </div>
          </div>
        </DialogHeader>
        {view === "render" ? (
          <div className="text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className="overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
            {content}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
}
