interface CellLifecycleBarProps {
  scenarioStatus: string;
  agentStatus: string;
  contractStatus?: string | null;
  hasContract: boolean;
}

// 4 节点 Pipeline: require → code → test → deploy
type Stage = "require" | "approve" | "code" | "test" | "deploy";

const STAGES: { id: Stage; label: string; color: string }[] = [
  { id: "require", label: "需求", color: "blue" },
  { id: "approve", label: "审批", color: "indigo" },
  { id: "code", label: "代码", color: "purple" },
  { id: "test", label: "测试", color: "amber" },
  { id: "deploy", label: "上线", color: "green" },
];

const STAGE_ORDER: Stage[] = ["require", "approve", "code", "test", "deploy"];

/**
 * 推断当前所在阶段。
 * 返回 null 表示"不需要走 agent pipeline"（已支持/废弃）。
 */
function inferCurrentStage(
  scenarioStatus: string,
  agentStatus: string,
  contractStatus?: string | null,
  hasContract: boolean = false,
): Stage | null {
  // 已支持 / 废弃 → 不走 agent pipeline
  if (scenarioStatus === "已支持" || scenarioStatus === "废弃") {
    return null;
  }

  // agent 已完成全流程
  if (agentStatus === "done") return "deploy";

  // 按 agentStatus 倒推
  switch (agentStatus) {
    case "blocked":
      if (contractStatus === "approved") return "code";
      if (hasContract) return "require";
      return "require";
    case "clarifying":
    case "pending-goal":
      return "approve";
    case "implementing":
      if (contractStatus === "approved") return "code";
      return "approve";
    case "tests-pending":
      return "test";
    case "qa-passed":
      return "deploy";
  }

  // not-started: 看有没有契约
  if (hasContract) {
    if (contractStatus === "approved") return "approve";
    if (contractStatus === "draft") return "require";
    return "require";
  }

  return "require";
}

function getStageState(
  stage: Stage,
  current: Stage | null,
  agentStatus: string,
): "done" | "current" | "pending" | "legacy" {
  // current === null 表示不走 pipeline（已支持/废弃）
  if (current === null) {
    return agentStatus === "done" ? "done" : "legacy";
  }

  const stageIdx = STAGE_ORDER.indexOf(stage);
  const currentIdx = STAGE_ORDER.indexOf(current);

  if (stageIdx < currentIdx) return "done";
  if (stageIdx === currentIdx) {
    if (agentStatus === "done" && stage === "deploy") return "done";
    return "current";
  }
  return "pending";
}

const stateStyles: Record<string, string> = {
  done: "bg-green-500 text-white",
  current: "bg-blue-500 text-white animate-pulse",
  pending: "bg-gray-200 text-gray-500",
  legacy: "bg-green-100 text-green-700 border border-green-200",
};

const stateIcons: Record<string, string> = {
  done: "✓",
  current: "●",
  pending: "○",
  legacy: "✓",
};

export function CellLifecycleBar({
  scenarioStatus,
  agentStatus,
  contractStatus,
  hasContract,
}: CellLifecycleBarProps) {
  const current = inferCurrentStage(scenarioStatus, agentStatus, contractStatus, hasContract);

  // 废弃格子不显示进度条
  if (scenarioStatus === "废弃") return null;

  const label = current === null
    ? (agentStatus === "done" ? "4 节点 Pipeline 已完成" : "已有实现（未经过 Agent 流程）")
    : undefined;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 overflow-x-auto py-1">
        {STAGES.map((stage, idx) => {
          const state = getStageState(stage.id, current, agentStatus);
          return (
            <div key={stage.id} className="flex items-center gap-1">
              <div className="flex flex-col items-center">
                <div
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${stateStyles[state]}`}
                  title={
                    state === "done"
                      ? "已完成"
                      : state === "current"
                        ? "当前阶段"
                        : state === "legacy"
                          ? "已有旧实现"
                          : "待执行"
                  }
                >
                  <span className="mr-1">{stateIcons[state]}</span>
                  {stage.label}
                </div>
              </div>
              {idx < STAGES.length - 1 && (
                <div className="w-4 h-px bg-border shrink-0" />
              )}
            </div>
          );
        })}
      </div>
      {label && (
        <p className="text-[10px] text-muted-foreground">{label}</p>
      )}
    </div>
  );
}