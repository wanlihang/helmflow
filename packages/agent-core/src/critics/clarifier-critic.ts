import type { Contract } from "@helmflow/contract-schema";
import type { CriticResult, Issue } from "./types";

// docs/architecture/agent-protocol.md §2.1 Clarifier Critic 检查项的 deterministic 版本。
// 完全不调 LLM,5 条规则全部用代码兜底,稳定可复现 → 适合做"必跑"门控,
// 后续若要加 LLM Critic 作为补强,作为另一个 critic 并存即可。

const AC_KEYWORD_RE = /(返回|status 转为|抛出|断言|持久化|不变|产生事件|应当)/;
const PLANTUML_BLOCK_RE = /@startuml[\s\S]+@enduml/;
const STATE_START_RE = /\[\*\]\s*-->/; // [*] --> X
const STATE_END_RE = /-->\s*\[\*\]/; // X --> [*]
const BR_ID_RE = /^BR-\d{3}$/;

export function runClarifierCritic(contract: Contract): CriticResult {
  const issues: Issue[] = [];

  // a) AC 至少 3 条
  if (contract.acceptanceCriteria.length < 3) {
    issues.push({
      check: "ac-count",
      detail: `Acceptance Criteria 至少需 3 条,当前 ${contract.acceptanceCriteria.length} 条。请补足。`,
    });
  }

  // b) 每条 AC 含可程序验证关键词
  const badAcs = contract.acceptanceCriteria.filter(
    (ac) => !AC_KEYWORD_RE.test(ac.text),
  );
  if (badAcs.length > 0) {
    issues.push({
      check: "ac-keyword",
      detail:
        `下列 Acceptance Criteria 缺少可程序验证关键词(返回 / status 转为 / 抛出 / 断言 / 持久化 / 不变 / 产生事件 / 应当): ` +
        badAcs.map((ac) => ac.id).join(", "),
    });
  }

  // c) State Machine 必须含完整 @startuml ... @enduml 块 + [*] 起点 + [*] 终点
  const sm = contract.stateMachine;
  if (!PLANTUML_BLOCK_RE.test(sm)) {
    issues.push({
      check: "state-machine-plantuml",
      detail: "State Machine 必须使用 PlantUML 代码块,且包含 @startuml ... @enduml。",
    });
  } else {
    if (!STATE_START_RE.test(sm)) {
      issues.push({
        check: "state-machine-start",
        detail: "State Machine 缺少起点迁移 `[*] --> XXX`,请补一条进入状态。",
      });
    }
    if (!STATE_END_RE.test(sm)) {
      issues.push({
        check: "state-machine-end",
        detail: "State Machine 缺少终态迁移 `XXX --> [*]`,请补一条退出状态。",
      });
    }
  }

  // d) BR 编号合法
  const badBrs = contract.businessRules.filter((br) => !BR_ID_RE.test(br.id));
  if (badBrs.length > 0) {
    issues.push({
      check: "br-id-format",
      detail:
        `Business Rules 编号必须形如 BR-001 / BR-002,当前不合规: ` +
        badBrs.map((br) => br.id).join(", "),
    });
  }

  // e) API Contract 至少 1 行有效 method
  if (
    contract.apiContract.length < 1 ||
    contract.apiContract.some((row) => row.method.trim() === "")
  ) {
    issues.push({
      check: "api-contract-method",
      detail: "API Contract 至少需要 1 行,且每行 Method 列不能为空。",
    });
  }

  // 注:AC-测试映射校验(HelmCode clarify approved 守卫)暂未启用为 hard rule —
  // 当前解析未区分 AC 的验证方式(测试/脚本/命令),精确校验做不了,且过严会卡住 Clarifier
  // 产出。待 Clarifier 稳定产出 9 章节后,作为补强 critic 启用。contract.acTestMapping 已解析可用。

  return { pass: issues.length === 0, issues };
}
