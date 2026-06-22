import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { getDb } from "@/lib/db";
import {
  createSseHeartbeat,
  isString,
  resolveSandboxPath,
  sseEncode,
  sseResponse,
} from "@/lib/server-utils";
import { parseContract } from "@helmflow/contract-schema";
import {
  createRun,
  createRunEvent,
  ensureVirtualCell,
  getCellRow,
  getLatestContract,
  listRunEvents,
  listRunsByKind,
  updateRun,
} from "@helmflow/storage";
import { NextResponse } from "next/server";
import { parse as parseYaml } from "yaml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  cellId?: unknown;
}

interface AcTestResult {
  acId: string;
  status: "pass" | "fail" | "no-test";
  testClass?: string;
}

interface MappingEntry {
  acId: string;
  tests: Array<{ file: string; method: string }>;
}

function loadLatestMapping(cellId: string): MappingEntry[] {
  const dir = join(process.cwd(), "data", "test-ac-mappings", cellId);
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
    if (files.length === 0) return [];
    const sorted = files
      .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const latest = sorted[0];
    if (!latest) return [];
    const raw = readFileSync(join(dir, latest.name), "utf-8");
    const parsed = parseYaml(raw) as { mappings?: MappingEntry[] };
    return parsed.mappings ?? [];
  } catch {
    return [];
  }
}

const execFileAsync = promisify(execFile);

function runMvnTest(sandboxPath: string): Promise<{ success: boolean; output: string }> {
  return execFileAsync("mvn", ["-q", "test"], {
    cwd: sandboxPath,
    encoding: "utf-8",
    timeout: 120_000,
  })
    .then((result) => ({ success: true, output: result.stdout }))
    .catch((err) => {
      const output =
        err instanceof Error && "stdout" in err ? String((err as { stdout: unknown }).stdout) : "";
      return { success: false, output };
    });
}

function parseSurefireResults(sandboxPath: string): Map<string, boolean> {
  const results = new Map<string, boolean>();
  const surefireDir = join(sandboxPath, "target", "surefire-reports");
  if (!existsSync(surefireDir)) return results;

  try {
    const files = readdirSync(surefireDir).filter((f) => f.endsWith(".txt"));
    for (const f of files) {
      const content = readFileSync(join(surefireDir, f), "utf-8");
      const className = f.replace(".txt", "");
      const hasFailure = content.includes("FAILURE") || content.includes("ERROR");
      results.set(className, !hasFailure);
    }
  } catch {
    // ignore
  }
  return results;
}

// ---------------------------------------------------------------------------
// GET /api/verify-cell — 恢复最近一次验证状态
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const cellId = url.searchParams.get("cellId");
  if (!cellId) {
    return NextResponse.json({ error: "cellId is required" }, { status: 400 });
  }

  const db = getDb();
  const runs = listRunsByKind(db, "verify", 20);

  let matchedRun: (typeof runs)[number] | undefined;
  let matchedEvents: Awaited<ReturnType<typeof listRunEvents>> = [];

  for (const r of runs) {
    const events = listRunEvents(db, r.id);
    const startEvent = events.find((ev) => {
      try {
        const p = JSON.parse(ev.payload);
        return p.type === "verify-start" && p.cellId === cellId;
      } catch {
        return false;
      }
    });
    if (startEvent) {
      matchedRun = r;
      matchedEvents = events;
      break;
    }
  }

  if (!matchedRun) {
    return NextResponse.json({ run: null, events: [], result: null });
  }

  // 从 events 中逆序提取 verify-done 的 result
  let result: Record<string, unknown> | null = null;
  for (const ev of [...matchedEvents].reverse()) {
    try {
      const p = JSON.parse(ev.payload);
      if (p.type === "verify-done") {
        result = p as Record<string, unknown>;
        break;
      }
    } catch {
      /* skip */
    }
  }

  return NextResponse.json({
    run: {
      id: matchedRun.id,
      state: matchedRun.state,
      startedAt: matchedRun.startedAt,
    },
    events: matchedEvents.map((e) => ({
      id: e.id,
      type: e.eventType,
      payload: JSON.parse(e.payload),
      createdAt: e.createdAt,
    })),
    result,
  });
}

// ---------------------------------------------------------------------------
// POST /api/verify-cell — 执行验证
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isString(body.cellId) || body.cellId.length === 0) {
    return NextResponse.json({ error: "cellId is required" }, { status: 400 });
  }

  const db = getDb();
  const cellRow = getCellRow(db, body.cellId);
  if (!cellRow) {
    return NextResponse.json({ error: `Cell not found: ${body.cellId}` }, { status: 404 });
  }

  const contractRow = getLatestContract(db, body.cellId);
  const sandboxPath = await resolveSandboxPath();

  if (!existsSync(sandboxPath)) {
    return NextResponse.json(
      { error: `project sandbox not found: ${sandboxPath}` },
      { status: 500 },
    );
  }

  // 创建 run 记录
  const virtualCellId = ensureVirtualCell(db);
  const run = createRun(db, virtualCellId, "verify");

  const encoder = new TextEncoder();
  const cellId = body.cellId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const { start: startHb, stop: stopHb } = createSseHeartbeat(encoder, controller);
      startHb();
      try {
        const sse = (payload: unknown) => {
          controller.enqueue(sseEncode(encoder, payload));
          try {
            createRunEvent(db, run.id, (payload as { type: string }).type, payload);
          } catch {
            // DB 写入失败不应阻塞流
          }
        };

        sse({ type: "verify-start", cellId });

        try {
          let acIds: string[] = [];
          if (contractRow) {
            try {
              const md = readFileSync(join(process.cwd(), contractRow.markdownPath), "utf-8");
              const parsed = parseContract(md);
              if (parsed.ok) {
                acIds = parsed.data.acceptanceCriteria.map((a) => a.id);
              }
            } catch {
              // no contract markdown
            }
          }

          sse({ type: "progress", message: `找到 ${acIds.length} 条 AC,开始跑测试...` });

          const mappings = loadLatestMapping(cellId);

          sse({ type: "progress", message: "运行 mvn test..." });
          const testResult = await runMvnTest(sandboxPath);
          sse({
            type: "progress",
            message: testResult.success ? "mvn test 通过" : "mvn test 有失败",
          });

          const surefireResults = parseSurefireResults(sandboxPath);

          const acResults: AcTestResult[] = acIds.map((acId) => {
            const mapping = mappings.find((m) => m.acId === acId);
            if (!mapping || mapping.tests.length === 0) {
              return { acId, status: "no-test" as const };
            }
            const allPass = mapping.tests.every((t) => {
              const className = t.file.split("/").pop()?.replace(".java", "") ?? "";
              return surefireResults.get(className) !== false;
            });
            return {
              acId,
              status: allPass ? ("pass" as const) : ("fail" as const),
              testClass: mapping.tests[0]?.file,
            };
          });

          const pass = acResults.every((r) => r.status === "pass");

          sse({
            type: "verify-done",
            pass,
            acResults,
            totalAcs: acIds.length,
            mvnSuccess: testResult.success,
          });

          updateRun(db, run.id, "done");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sse({ type: "error", message });
          try {
            updateRun(db, run.id, "failed");
          } catch {
            /* ignore */
          }
        }
      } finally {
        stopHb();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // heartbeat timer cleaned up by stopHb or GC
    },
  });

  return sseResponse(stream);
}
