import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "@/lib/db";
import { getPendingMerge, getRunById } from "@helmflow/storage";
import { NextResponse } from "next/server";
import { parse as parseYaml } from "yaml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ runId: string }>;
}

/** 在 sandbox 仓库里跑一次 git,返回 stdout(失败返回空串)。 */
function git(sandboxPath: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: sandboxPath, encoding: "utf-8" });
  } catch {
    return "";
  }
}

/** 读取该 workUnit 最新一份 QA 判定产物(test 节点写)。key=cellId 或 req-<requirementId>。 */
function loadLatestQaReport(key: string): Record<string, unknown> | null {
  try {
    const dir = join(process.cwd(), "data", "qa-reports", key);
    const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
    if (files.length === 0) return null;
    const latest = files
      .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    if (!latest) return null;
    return parseYaml(readFileSync(join(dir, latest.name), "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// GET /api/runs/[runId]/pending-merge — 待确认合并的 worktree 信息 + 相对目标分支的 diff。
//   供 run 详情页审阅:无 pending 行 → {pending:false}。
export async function GET(_req: Request, ctx: RouteParams): Promise<Response> {
  const { runId } = await ctx.params;
  const db = getDb();
  const run = getRunById(db, runId);
  if (!run) {
    return NextResponse.json({ error: `Run not found: ${runId}` }, { status: 404 });
  }
  const pm = getPendingMerge(db, runId);
  if (!pm) {
    return NextResponse.json({ pending: false });
  }

  // diff 目标分支...worktree 分支(三点点:目标以来该分支的全部改动)
  const range = `${pm.targetBranch}...${pm.branchName}`;
  const stat = git(pm.sandboxPath, ["diff", "--stat", range]);
  const names = git(pm.sandboxPath, ["diff", "--name-status", range]);
  const behind = git(pm.sandboxPath, [
    "rev-list",
    "--count",
    `${pm.branchName}..${pm.targetBranch}`,
  ]).trim();

  const qaReport = loadLatestQaReport(pm.requirementId ? `req-${pm.requirementId}` : pm.cellId);

  return NextResponse.json({
    pending: true,
    runState: run.state,
    worktreePath: pm.worktreePath,
    branchName: pm.branchName,
    targetBranch: pm.targetBranch,
    mode: pm.mode,
    qaReport,
    diffStat: stat.trim(),
    files: names
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, ...pathParts] = line.split("\t");
        return { status, path: pathParts.join("\t") };
      }),
    targetAheadBy: behind ? Number.parseInt(behind, 10) || 0 : 0,
  });
}
