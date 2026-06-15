import { spawn } from "node:child_process";
import type {
  BuildOptions,
  CommandOutcome,
  FormatOutcome,
  ProjectAdapter,
  TestFullOutcome,
  TestStrictOutcome,
} from "@helmflow/adapter-core";

const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

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
    const child = spawn(cmd, args, { cwd: opts.cwd, env: process.env });
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

export function createNodeExpressAdapter(projectPath: string): ProjectAdapter {
  return {
    projectPath,

    async build(opts?: BuildOptions): Promise<CommandOutcome> {
      const r = await runCommand("npx", ["tsc", "--noEmit"], { cwd: projectPath });
      return toOutcome(r);
    },

    async testStrict(): Promise<TestStrictOutcome> {
      const r = await runCommand("npx", ["jest", "--passWithNoTests", "--ci"], {
        cwd: projectPath,
      });
      return { ...toOutcome(r), reportPath: null };
    },

    async testFull(): Promise<TestFullOutcome> {
      const r = await runCommand("npx", ["jest", "--ci", "--verbose"], {
        cwd: projectPath,
      });
      return { ...toOutcome(r), reportPath: null, surefireReports: [] };
    },

    async format(): Promise<FormatOutcome> {
      const r = await runCommand("npx", ["prettier", "--write", "src/"], {
        cwd: projectPath,
      });
      return { ...toOutcome(r), formatted: r.exitCode === 0 };
    },
  };
}
