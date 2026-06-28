import { ProjectSwitcher } from "@/components/project-switcher";
import { RunningBadge } from "@/components/running-badge";
import { ToastProvider } from "@/components/ui/toast";
import { getCurrentProjectId, getProjectList } from "@/lib/project";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "HelmFlow Portal",
  description: "Full-Loop AI Coding Platform",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const projects = getProjectList();
  const currentProjectId = await getCurrentProjectId();

  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ToastProvider>
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold tracking-tight">HelmFlow Portal</span>
              <span className="text-sm text-muted-foreground">|</span>
              <ProjectSwitcher projects={projects} currentProjectId={currentProjectId} />
            </div>
            <nav className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/50">工作台</span>
              <Link className="hover:text-foreground" href="/">
                矩阵
              </Link>
              <Link className="hover:text-foreground" href="/requirements">
                需求
              </Link>
              <RunningBadge />
              <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground/50">工具</span>
              <Link className="hover:text-foreground" href="/terminal">
                Claude 终端
              </Link>
              <Link className="hover:text-foreground" href="/runs">
                运行中心
              </Link>
              <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground/50">同步</span>
              <Link className="hover:text-foreground" href="/contract-sync">
                契约同步
              </Link>
              <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground/50">设置</span>
              <Link className="hover:text-foreground" href="/llm">
                模型配置
              </Link>
              <Link className="hover:text-foreground" href="/helmcode">
                标准版本
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
