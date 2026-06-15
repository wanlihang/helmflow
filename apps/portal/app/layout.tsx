import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ProjectSwitcher } from "@/components/project-switcher";
import { getCurrentProjectId, getProjectList } from "@/lib/project";
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
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold tracking-tight">HelmFlow Portal</span>
              <span className="text-sm text-muted-foreground">|</span>
              <ProjectSwitcher
                projects={projects}
                currentProjectId={currentProjectId}
              />
            </div>
            <nav className="text-sm text-muted-foreground">
              <a className="hover:text-foreground" href="/">
                全景
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
