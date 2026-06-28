// 页面标题区公共组件:统一 h1 字号/字重 + 描述 + 右侧操作。
// 消除各页 text-3xl/2xl/lg + 有无 tracking-tight 的漂移,统一为 text-2xl font-bold tracking-tight。

import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** 右侧操作区(按钮、状态徽标等) */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={`mb-4 flex items-start justify-between gap-4 ${className ?? ""}`}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
