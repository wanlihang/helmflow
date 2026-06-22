import type { CommitRow, ContractRow, RunRow } from "@helmflow/storage";

interface TimelineEntry {
  type: "run" | "contract" | "commit";
  time: string;
  title: string;
  detail: string;
  status: "success" | "failed" | "running" | "neutral";
}

interface CellTimelineProps {
  runs: RunRow[];
  contracts: ContractRow[];
  commits: CommitRow[];
}

function buildEntries(props: CellTimelineProps): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const r of props.runs) {
    entries.push({
      type: "run",
      time: r.startedAt,
      title: `${r.kind} run`,
      detail: r.id,
      status:
        r.state === "done" || r.state === "applied"
          ? "success"
          : r.state === "failed"
            ? "failed"
            : "running",
    });
  }

  for (const c of props.contracts) {
    entries.push({
      type: "contract",
      time: c.createdAt,
      title: `契约 ${c.status}`,
      detail: c.id,
      status: c.status === "approved" ? "success" : c.status === "blocked" ? "failed" : "neutral",
    });
  }

  for (const cm of props.commits) {
    entries.push({
      type: "commit",
      time: cm.createdAt,
      title: `Commit ${cm.gitSha}`,
      detail: cm.message.split("\n")[0] ?? "",
      status: "success",
    });
  }

  return entries.sort((a, b) => (b.time > a.time ? 1 : -1));
}

const statusDotClass: Record<string, string> = {
  success: "bg-green-500",
  failed: "bg-red-500",
  running: "bg-blue-500 animate-pulse",
  neutral: "bg-gray-400",
};

export function CellTimeline({ runs, contracts, commits }: CellTimelineProps) {
  const entries = buildEntries({ runs, contracts, commits });

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        暂无历史记录
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {entries.map((entry, i) => (
        <div key={`${entry.type}-${entry.detail}-${i}`} className="flex gap-3 pb-3">
          <div className="flex flex-col items-center">
            <span
              className={`mt-1 inline-block h-2.5 w-2.5 rounded-full shrink-0 ${statusDotClass[entry.status]}`}
            />
            {i < entries.length - 1 && <span className="w-px flex-1 bg-border" />}
          </div>
          <div className="flex-1 pb-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold">{entry.title}</span>
              <span className="text-[10px] text-muted-foreground">{entry.time}</span>
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">{entry.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
