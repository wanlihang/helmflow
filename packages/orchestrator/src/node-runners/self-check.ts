// 完成后的「对抗式自检」轮:主任务成功后,resume 续接同一 session(保留实现上下文),
// 让 agent 切换到严格验收者角色,对照契约 BR/AC 逐条找遗漏。
//
// 依据:Self-Refine(Madaan 2023)——第 1 轮反馈-修订收益最大,2-4 轮递减,>5 平台;
// 反馈质量 > 轮次。Reflexion/对抗式验证——同一模型 review 自己有 sycophancy(谄媚)偏差,
// 故用"对抗式 framing"(目标是挑毛病而非确认完成)来缓解。
// 默认 1 轮(性价比最高),env HELMFLOW_SELF_CHECK_ROUNDS 可配,封顶 3(再多=烧配额+撞529,收益不抵)。

import type { Contract } from "@helmflow/contract-schema";
import { runNode, type NodeRunEvent } from "@helmflow/agent-runner";

const MAX_ROUNDS = 3;
// 自检轮也不限制 turn:agent 跑到自然完成(找到遗漏→补→编译;或确认无遗漏→停)。
const MAX_TURNS = Number.MAX_SAFE_INTEGER;

/** 读取自检轮数:默认 1,封顶 MAX_ROUNDS,0=关闭。 */
export function getSelfCheckRounds(): number {
  const raw = process.env.HELMFLOW_SELF_CHECK_ROUNDS;
  if (raw === undefined) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.min(Math.trunc(n), MAX_ROUNDS);
}

function listIds(contract: Contract): { acIds: string; brIds: string } {
  return {
    acIds: contract.acceptanceCriteria.map((a) => a.id).join(", ") || "(无)",
    brIds: contract.businessRules.map((b) => b.id).join(", ") || "(无)",
  };
}

/** code 自检 prompt:对照 BR/AC 找「逻辑实现」遗漏。 */
export function buildCodeCheckPrompt(contract: Contract): string {
  const { acIds, brIds } = listIds(contract);
  return `## 对抗式自检:对照契约找遗漏

你现在切换到【严格验收者】角色,目标是**对抗式地挑出问题**,而非确认完成。警惕"都做好了"的谄媚倾向 —— 你的任务是尽力找出没做完的地方。

逐条对照行为契约的 Business Rules(BR)和 Acceptance Criteria(AC):
- BR: ${brIds}
- AC: ${acIds}

步骤:
1. 用 Read/Grep/Glob 在代码里找到每条 BR/AC 的**实现证据**(类/方法/字段/测试)
2. 逐条判定并简述依据:✅已实现 / ⚠️部分实现(说明缺什么) / ❌遗漏
3. **仅**对 ⚠️/❌ 的项做最小补全,保持项目现有风格;**禁止重构/优化已实现代码**(防回归)
4. 补完后跑 \`mvn compile\` + 相关测试确认通过
5. 若逐条核查后全部 ✅,明确说"无遗漏"并停止 —— 不要为找问题而找问题、不要做额外功能`;
}

/** test 自检 prompt:对照 AC 找「测试覆盖」遗漏。 */
export function buildTestCheckPrompt(contract: Contract): string {
  const { acIds } = listIds(contract);
  return `## 对抗式自检:对照 AC 找测试覆盖遗漏

切换到【严格 QA】角色,对抗式检查测试覆盖,目标是挑出没测到的地方。

逐条对照每条 AC(${acIds}):
1. 用 Grep/Read 找到验证该 AC 的测试方法/断言
2. 判定:✅有测试覆盖 / ⚠️覆盖不全(说明缺哪个场景) / ❌无测试
3. **仅**对 ⚠️/❌ 补最小测试(参考现有测试的 import 与风格),**禁止改已通过的测试或业务代码**
4. 补完跑 \`mvn test\` 确认全绿
5. 全部 ✅ 则说"测试无遗漏"并停止`;
}

export interface SelfCheckArgs {
  sandboxPath: string;
  systemPrompt: string;
  /** 主实现 session 的 id;为空则无法 resume,跳过自检 */
  primarySessionId?: string;
  rounds: number;
  prompt: string;
  onEvent?: (event: NodeRunEvent) => void;
}

export interface SelfCheckResult {
  sessionId?: string;
  success: boolean;
  turns: number;
  durationMs: number;
  costUsd?: number;
}

/**
 * 跑 N 轮对抗式自检(每轮 resume 续接上一轮的 session)。
 * 自检失败(infra/超时)**不影响主结果** —— 主实现已成功,自检只是额外补全。
 * 返回累计 turns/duration/cost + 最终 sessionId(供后续链路续接)。
 */
export async function runSelfCheck(args: SelfCheckArgs): Promise<SelfCheckResult> {
  if (args.rounds <= 0 || !args.primarySessionId) {
    return { sessionId: args.primarySessionId, success: true, turns: 0, durationMs: 0 };
  }
  let sessionId: string | undefined = args.primarySessionId;
  let success = true;
  let turns = 0;
  let costUsd: number | undefined;
  const start = Date.now();

  for (let i = 0; i < args.rounds; i++) {
    const r = await runNode({
      cwd: args.sandboxPath,
      systemPrompt: args.systemPrompt,
      resumeSessionId: sessionId,
      userPrompt: args.prompt,
      allowedTools: ["Read", "Grep", "Glob", "Bash", "Edit", "Write"],
      maxTurns: MAX_TURNS,
      maxTurnsPerSession: MAX_TURNS,
      // 自检轮事件打 phase="self-check" 标记,前端据此区分主实现/自检(视觉分组/标签)。
      onEvent: args.onEvent
        ? (ev) => args.onEvent?.({ ...ev, phase: "self-check" })
        : undefined,
    });
    sessionId = r.sessionId ?? sessionId;
    success = r.success;
    turns += r.turns;
    if (r.costUsd !== undefined) costUsd = (costUsd ?? 0) + r.costUsd;
    // 自检成功自然 stop 或失败都停;多轮的边际收益递减,由 rounds 控制
    if (!r.success) break;
  }

  return { sessionId, success, turns, durationMs: Date.now() - start, costUsd };
}
