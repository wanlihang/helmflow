import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveSandboxPath } from "@/lib/server-utils";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTRACTS_DIR = ".claude/contracts";
// HelmCode 契约 featureId 格式 F005-xxx;校验防路径穿越(拒绝 ../ 等)
const FEATURE_ID_RE = /^F\d{3}-[A-Za-z0-9_.-]+$/;

// GET /api/contract-sync/contract?featureId=F005-create-deliver-record
// 按需读取目标项目 .claude/contracts/ 下的契约 md 正文,供同步页「查看契约」弹窗渲染。
export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const featureId = searchParams.get("featureId") ?? "";
  if (!FEATURE_ID_RE.test(featureId)) {
    return NextResponse.json({ error: "invalid featureId" }, { status: 400 });
  }

  const sandboxPath = await resolveSandboxPath();
  const contractsDir = join(sandboxPath, CONTRACTS_DIR);
  if (!existsSync(contractsDir)) {
    return NextResponse.json({ error: "contracts dir not found" }, { status: 404 });
  }

  // 精确匹配 → 退化按 featureId 前缀模糊匹配(与 contract-sync scan 的 resolveContractFile 一致)
  const exact = join(contractsDir, `${featureId}.md`);
  let target: string | null = existsSync(exact) ? exact : null;
  if (!target) {
    try {
      const hits = readdirSync(contractsDir).filter(
        (f) => f.toUpperCase().startsWith(featureId.toUpperCase()) && f.endsWith(".md"),
      );
      if (hits.length > 0) target = join(contractsDir, hits[0]!);
    } catch {
      // ignore
    }
  }
  if (!target) {
    return NextResponse.json({ error: `contract not found: ${featureId}` }, { status: 404 });
  }

  try {
    const markdown = readFileSync(target, "utf-8");
    return NextResponse.json({ markdown });
  } catch {
    return NextResponse.json({ error: "read failed" }, { status: 500 });
  }
}
