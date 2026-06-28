import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLANTUML_JAR = process.env.PLANTUML_JAR ?? join(process.cwd(), ".cache", "plantuml.jar");
const KROKI_ENDPOINT = process.env.KROKI_ENDPOINT ?? "";

interface DiagramBody {
  source?: unknown;
  // 前端 plantuml-diagram.tsx 会传 type/format;后端目前固定 plantuml+svg(忽略这两个),
  // 此处声明仅为类型对齐,避免契约漂移。未来支持 png 时可读 format 切 -tpng。
  type?: string;
  format?: string;
}

// 本地 java + plantuml.jar 渲染(契约源码不出本机)。-pipe:stdin 吃 puml,stdout 出 svg。
function renderWithJar(source: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("java", ["-jar", PLANTUML_JAR, "-tsvg", "-pipe", "-charset", "UTF-8"]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && stdout.includes("<svg")) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `plantuml exit code ${code}`));
      }
    });
    child.stdin.end(source);
  });
}

// Kroki 后备(配了 KROKI_ENDPOINT 且本地无 jar 时使用)。服务端代理,契约源码走 portal→内网 Kroki。
async function renderWithKroki(source: string): Promise<string> {
  const res = await fetch(`${KROKI_ENDPOINT}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      diagram_source: source,
      diagram_type: "plantuml",
      output_format: "svg",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`kroki ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.text();
}

// 渲染契约里的 PlantUML 为 SVG。优先本地 jar;无 jar 且配了 Kroki 则走 Kroki;都没有则 503。
export async function POST(req: Request): Promise<Response> {
  let body: DiagramBody;
  try {
    body = (await req.json()) as DiagramBody;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const source = typeof body.source === "string" ? body.source : "";
  if (source.length === 0) {
    return NextResponse.json({ error: "source is required" }, { status: 400 });
  }
  if (source.length > 64 * 1024) {
    return NextResponse.json({ error: "source too large" }, { status: 413 });
  }

  const useJar = existsSync(PLANTUML_JAR);
  if (!useJar && !KROKI_ENDPOINT) {
    return NextResponse.json(
      { error: "no renderer", hint: "未找到 plantuml.jar,且未配置 KROKI_ENDPOINT" },
      { status: 503 },
    );
  }

  try {
    const svg = useJar ? await renderWithJar(source) : await renderWithKroki(source);
    return new Response(svg, {
      status: 200,
      headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "render failed", detail: message.slice(0, 1000) },
      { status: 422 },
    );
  }
}
