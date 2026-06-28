import { loadMatrix } from "@/lib/matrix";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 返回 DB 现有结构(精简),供审阅弹窗与新分析结果做差异对比。
// 用 loadMatrix(与矩阵页一致的过滤:status!=="archived"、scenario !archived),
// 形状对齐 lib/structure-diff.ts 的 ExistingStructure。
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: projectId } = await params;
  const matrix = loadMatrix(projectId);

  const features: Record<
    string,
    {
      id: string;
      domain: string;
      name: string;
      handler: string;
      scenarios: Record<
        string,
        { name: string; status: string; agentStatus: string; note: string; archived: boolean }
      >;
    }
  > = {};

  for (const d of matrix.domains) {
    for (const f of d.features) {
      const scenarios: Record<
        string,
        { name: string; status: string; agentStatus: string; note: string; archived: boolean }
      > = {};
      for (const s of f.scenarios) {
        scenarios[s.name] = {
          name: s.name,
          status: s.status,
          agentStatus: s.agentStatus,
          note: s.note,
          archived: false,
        };
      }
      features[f.id] = {
        id: f.id,
        domain: d.id,
        name: f.name,
        handler: f.implementation.handler,
        scenarios,
      };
    }
  }

  return NextResponse.json({ features });
}
