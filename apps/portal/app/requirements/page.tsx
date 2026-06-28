// /requirements — 需求驱动通路入口:列出当前项目的需求 + 新建需求。

import { NewRequirementDialog } from "@/components/new-requirement-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentProjectId, getProjectList } from "@/lib/project";
import { getDb } from "@/lib/db";
import { listRequirementsByProject } from "@helmflow/storage";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  clarifying: "澄清中",
  "contract-draft": "契约草稿",
  approved: "已审批",
  running: "实现中",
  done: "已完成",
  blocked: "已阻塞",
  abandoned: "已废弃",
};

export default async function RequirementsPage() {
  const projects = getProjectList();
  const currentProjectId = await getCurrentProjectId();
  const db = getDb();
  const requirements = listRequirementsByProject(db, currentProjectId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">需求</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            像用 Claude Code 一样:开一个需求 → 对话澄清 → 生成契约 → 自主实现。不依赖功能矩阵。
          </p>
        </div>
        <NewRequirementDialog projectId={currentProjectId} />
      </div>

      {requirements.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            还没有需求。点「新建需求」开始一段对话式澄清。
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {requirements.map((r) => (
            <Link key={r.id} href={`/requirements/${r.id}`}>
              <Card className="transition-colors hover:border-foreground/30">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="truncate text-base">{r.title}</CardTitle>
                    <Badge variant="outline">{STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{r.id}</div>
                  {r.description ? (
                    <div className="line-clamp-2 text-xs text-muted-foreground">{r.description}</div>
                  ) : null}
                  <div className="text-[10px] text-muted-foreground/70">
                    更新于 {new Date(r.updatedAt).toLocaleString("zh-CN")}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-xs text-muted-foreground">提示:尚未注册任何项目,请先在矩阵页注册。</div>
      ) : null}
    </div>
  );
}
