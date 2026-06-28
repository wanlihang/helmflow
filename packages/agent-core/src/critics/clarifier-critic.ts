import type { Contract } from "@helmflow/contract-schema";
import type { CriticResult, Issue } from "./types";

// docs/architecture/agent-protocol.md §2.1 Clarifier Critic 检查项的 deterministic 版本。
// 完全不调 LLM,5 条规则全部用代码兜底,稳定可复现 → 适合做"必跑"门控,
// 后续若要加 LLM Critic 作为补强,作为另一个 critic 并存即可。

// AC 可验证关键词:宽口径,覆盖模型自然措辞("置…态"/"抛 X"/"编译通过"/"幂等"/"返回"/"拒绝"…)。
// AC 只要描述了可观察、可断言的行为即可,不强求字面"status 转为"。
const AC_KEYWORD_RE =
  /(返回|转为|转[入化]|置[^\n。]*态|抛出?|断言|持久化|不变|产生事件|应当|必须|校验|拒绝|幂等|编译|调用|计数|包含|等于|通过|失败|成功|生成|记录|更新|删除|插入)/;
const PLANTUML_BLOCK_RE = /@startuml[\s\S]+@enduml/;
// 状态迁移图标记:PlantUML 之外,也认 ASCII/Mermaid 箭头图(─►/→/►)。
const TRANSITION_RE = /(-+>|-->|→|─►|►|─[^\n]*►|──?>)/;
const STATE_START_RE = /\[\*\]\s*-->/; // [*] --> X
const STATE_END_RE = /-->\s*\[\*\]/; // X --> [*]
// BR 编号:接受 1-3 位(BR-1 / BR-01 / BR-001)及 HelmCode 域前缀(BR-PS-001)。
// 严格 3 位是任意约定,模型(glm-5.2 等)常自然产出 BR-1;schema 已用 BR-[A-Z0-9-]+ 兜底,这里对齐。
const BR_ID_RE = /^BR-(\d{1,3}|[A-Z]+-\d{1,3})$/;

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

  // c) State Machine 必须含状态迁移图。PlantUML(@startuml)为标准;也接受 ASCII/Mermaid 箭头图。
  //    起点/终点 [*] 校验仅在 PlantUML 时执行(ASCII 图无 [*] 语法)。
  const sm = contract.stateMachine;
  const hasPlantuml = PLANTUML_BLOCK_RE.test(sm);
  const hasTransition = TRANSITION_RE.test(sm);
  if (!hasPlantuml && !hasTransition) {
    issues.push({
      check: "state-machine-plantuml",
      detail:
        "State Machine 必须含状态迁移图(PlantUML `@startuml…@enduml`,或 ASCII/Mermaid 箭头图如 `A ──► B`)。",
    });
  } else if (hasPlantuml) {
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
        `Business Rules 编号必须形如 BR-001(1-3 位数字,或 BR-PS-001 域前缀),当前不合规: ` +
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
