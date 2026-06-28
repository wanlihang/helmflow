// self-check 全链路 spike:验证主实现事件 phase=undefined、自检轮事件 phase="self-check"、resume 续接。
// 复用 cmux shell env(ANTHROPIC_AUTH_TOKEN/BASE_URL),走不 529 路径。花少量配额。
import { runNode } from "/Users/wanlihang/IdeaProjects/helmflow/packages/agent-runner/src/index.ts";
import { runSelfCheck } from "/Users/wanlihang/IdeaProjects/helmflow/packages/orchestrator/src/node-runners/self-check.ts";

const cwd = "/Users/wanlihang/IdeaProjects/mycmdeliverhub";
console.log(`[spike] BASE_URL=${process.env.ANTHROPIC_BASE_URL ?? "(unset)"} MODEL=${process.env.ANTHROPIC_MODEL ?? "(unset)"}`);

console.log("\n=== ① 主实现 runNode ===");
const primary = await runNode({
  cwd,
  systemPrompt: "你是编码助手,按指令做最小动作后停止。",
  userPrompt: "用 Bash 跑 `echo hello-selfcheck-spike`,确认输出后停止。不要做别的。",
  allowedTools: ["Bash"],
  maxTurns: 6,
  onEvent: (e) => {
    if (e.type === "tool_use" || e.type === "assistant.text") {
      console.log(`  [phase=${e.phase ?? "primary(主)"}] ${e.type}: ${JSON.stringify((e.text ?? e.name ?? "").toString().slice(0, 70))}`);
    }
  },
});
console.log(`primary: success=${primary.success} session=${primary.sessionId?.slice(0, 8)} turns=${primary.turns}`);

if (primary.success && primary.sessionId) {
  console.log("\n=== ② runSelfCheck(resume 续接同一 session) ===");
  const chk = await runSelfCheck({
    sandboxPath: cwd,
    systemPrompt: "你是编码助手。",
    primarySessionId: primary.sessionId,
    rounds: 1,
    prompt: "对抗式自检:核查你刚才是否真的执行了 echo 并看到输出。逐条核查,无遗漏则说'无遗漏'并停止。",
    onEvent: (e) => {
      if (e.type === "tool_use" || e.type === "assistant.text") {
        console.log(`  [phase=${e.phase ?? "?"}] ${e.type}: ${JSON.stringify((e.text ?? e.name ?? "").toString().slice(0, 70))}`);
      }
    },
  });
  console.log(`self-check: success=${chk.success} turns=${chk.turns} duration=${chk.durationMs}ms`);
} else {
  console.log("\n(primary 未成功/无 session,跳过 self-check)");
}

console.log("\n=== 验证要点 ===");
console.log("✓ 主实现事件 phase 应为 undefined(标 'primary(主)')");
console.log("✓ self-check 事件 phase 应为 'self-check'");
console.log("✓ self-check 应 resume 续接(记得主实现做过的事)");
