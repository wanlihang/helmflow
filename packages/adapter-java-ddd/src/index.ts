import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
  BuildOptions,
  CommandOutcome,
  FormatOutcome,
  ProjectAdapter,
  TestFullOutcome,
  TestStrictOutcome,
} from "@helmflow/adapter-core";

// 任何 mvn 调用最长 5 分钟,超时强杀。冷启动首次下载依赖可能很久,
// 调用方需要预先 warm-up 一次再走自动循环。
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const SUREFIRE_DIR = "target/surefire-reports";

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs?: number },
): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<RunResult>((resolve) => {
    const startedAt = Date.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: process.env,
      // 不用 shell:避免参数注入风险,且 mvn 是直接可执行
    });
    const timer = setTimeout(() => {
      if (settled) return;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      settled = true;
      resolve({
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        durationMs: Date.now() - startedAt,
        timedOut: true,
      });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (err) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      resolve({
        exitCode: -1,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: `${err.message}\n${Buffer.concat(stderrChunks).toString("utf-8")}`,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        durationMs: Date.now() - startedAt,
        timedOut: false,
      });
    });
  });
}

function toOutcome(r: RunResult): CommandOutcome {
  return {
    ok: !r.timedOut && r.exitCode === 0,
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.exitCode,
    durationMs: r.durationMs,
    timedOut: r.timedOut,
  };
}

async function findSurefireReports(projectPath: string): Promise<string[]> {
  const dir = join(projectPath, SUREFIRE_DIR);
  try {
    const entries = await readdir(dir);
    return entries
      .filter((name) => name.endsWith(".txt") || name.endsWith(".xml"))
      .map((name) => relative(projectPath, join(dir, name)));
  } catch {
    return [];
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

export function createJavaDddAdapter(projectPath: string): ProjectAdapter {
  return {
    projectPath,

    async build(opts?: BuildOptions): Promise<CommandOutcome> {
      const skipTests = opts?.skipTests ?? true;
      const args = ["-q", "compile"];
      if (skipTests) args.push("-DskipTests");
      const r = await runCommand("mvn", args, { cwd: projectPath });
      return toOutcome(r);
    },

    async testStrict(): Promise<TestStrictOutcome> {
      // 只跑架构 / smoke 测试。-Dtest 不匹配任何用例时 mvn 默认会返回 1,
      // 走 -DfailIfNoTests=false 让"空跑"也算成功(架构测试未就位是正常状态)。
      const r = await runCommand(
        "mvn",
        ["-q", "test", "-Dtest=*ArchTest", "-DfailIfNoTests=false"],
        { cwd: projectPath },
      );
      const reports = await findSurefireReports(projectPath);
      return {
        ...toOutcome(r),
        reportPath:
          reports.find((p) => p.toLowerCase().includes("archtest")) ??
          reports[0] ??
          null,
      };
    },

    async testFull(): Promise<TestFullOutcome> {
      const r = await runCommand(
        "mvn",
        ["-q", "test", "-DfailIfNoTests=false"],
        { cwd: projectPath },
      );
      const reports = await findSurefireReports(projectPath);
      return {
        ...toOutcome(r),
        reportPath: reports[0] ?? null,
        surefireReports: reports,
      };
    },

    async format(): Promise<FormatOutcome> {
      // spotless 不一定配,失败就降级跑一次 compile,把 outcome 保留给上层日志
      const spotlessExists = await dirExists(
        join(projectPath, "target", "spotless-cache"),
      );
      const r = await runCommand("mvn", ["-q", "spotless:apply"], {
        cwd: projectPath,
      });
      if (r.exitCode === 0 && !r.timedOut) {
        return { ...toOutcome(r), formatted: true };
      }
      // plugin 缺失等情况:降级 compile,保证调用方拿到一致的 outcome 形状
      const fallback = await runCommand("mvn", ["-q", "compile"], {
        cwd: projectPath,
      });
      return {
        ...toOutcome(fallback),
        formatted: false,
        stderr: `[spotless fallback, spotlessCacheExists=${spotlessExists}]\n${r.stderr}\n---\n${fallback.stderr}`,
      };
    },
  };
}

// 确定性 Java inventory 扫描器(analyze 拆分用)
export { scanJavaInventory, type InventoryItem } from "./scanner";
