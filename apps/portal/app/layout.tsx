import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "HelmCode Portal | mycmdeliverhub",
  description: "Full-Loop AI Coding Platform — 业务场景 × 功能点全景",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <div className="flex items-baseline gap-3">
              <span className="text-lg font-bold tracking-tight">HelmCode Portal</span>
              <span className="text-sm text-muted-foreground">|</span>
              <span className="font-mono text-sm text-muted-foreground">mycmdeliverhub</span>
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
