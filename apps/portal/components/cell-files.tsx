import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

interface CellFilesProps {
  gitSha: string | null;
  sandboxPath?: string;
}

function resolveSandboxPath(explicit?: string): string | null {
  if (explicit) {
    return resolve(explicit);
  }
  const env = process.env.HELMFLOW_SAMPLE_JAVA_PATH;
  if (env && env.length > 0) return resolve(env);
  // 不再回退到内置 sandbox-java(已移除);由调用方传入 sandboxPath
  return null;
}

function getCommitFiles(sha: string, sandboxPath?: string): string[] {
  try {
    const absPath = resolveSandboxPath(sandboxPath);
    if (!absPath) return [];
    const out = execFileSync("git", ["show", "--stat", "--format=", sha], {
      cwd: absPath,
      encoding: "utf-8",
    });
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.includes("|"))
      .map((l) => l.split("|")[0]!.trim());
  } catch (err) {
    console.warn("[cell-files] git show failed for", sha, err);
    return [];
  }
}

export function CellFiles({ gitSha, sandboxPath }: CellFilesProps) {
  if (!gitSha) {
    return <div className="text-xs text-muted-foreground">无关联 commit</div>;
  }

  const files = getCommitFiles(gitSha, sandboxPath);

  if (files.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        commit <span className="font-mono">{gitSha}</span> 无法读取文件列表
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-muted-foreground">
        关联文件 ({files.length}) · <span className="font-mono">{gitSha}</span>
      </div>
      <ul className="space-y-0.5">
        {files.map((f) => (
          <li key={f} className="font-mono text-[11px] text-foreground">
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
