// /terminal 页面:cd 到当前项目 sandbox 直接驱动 claude(双轨轨道B)。
// server component 读 cookie 拿 projectId,传给 client 组件。

import { ClaudeTerminal } from "@/components/claude-terminal";
import { getCurrentProjectId } from "@/lib/project";

export default async function TerminalPage() {
  const projectId = await getCurrentProjectId();

  return (
    <div className="flex flex-col gap-3">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Claude 终端</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          在当前项目{" "}
          <code className="rounded bg-muted px-1 py-0.5">{projectId}</code>{" "}
          的 sandbox 里直接驱动 claude(透传本机 shell 配置,复用交互式不 529 路径)。先启动
          terminal-server:
          <code className="ml-1 rounded bg-muted px-1 py-0.5">pnpm terminal:dev</code>
        </p>
      </header>
      <div className="overflow-hidden rounded-lg border border-border">
        <ClaudeTerminal projectId={projectId} />
      </div>
    </div>
  );
}
