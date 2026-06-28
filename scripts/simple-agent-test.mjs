// 极简 agent 验证:直接用 claude-agent-sdk(agent-runner)跑一个"加 hello 测试"的小任务,
// 绕过 helmflow orchestrator,纯粹验证 glm-5.2[1M] 能否驱动 agent 完成简单编码 + mvn test。
// key 只从 DB 读到 process.env,不打印不外发。
import { runNode } from "/Users/wanlihang/IdeaProjects/helmflow/packages/agent-runner/src/index.ts";
import { createDb, getActiveLLMProvider } from "/Users/wanlihang/IdeaProjects/helmflow/packages/storage/src/index.ts";

const db = createDb("/Users/wanlihang/IdeaProjects/helmflow/apps/portal/data/helmflow.db");
const p = getActiveLLMProvider(db);
process.env.HELMFLOW_ANTHROPIC_BASE_URL = p.baseUrl;
process.env.HELMFLOW_ANTHROPIC_MODEL = p.model;
process.env.HELMFLOW_ANTHROPIC_AUTH_TOKEN = p.apiKey; // 第三方端点用 Bearer
process.env.HELMFLOW_TURNS_PER_SESSION = "30";
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
console.log(`[简单需求测试] provider=${p.name} model=${p.model} (key 不打印)`);

const r = await runNode({
  cwd: "/Users/wanlihang/IdeaProjects/mycmdeliverhub",
  systemPrompt: "你是编码助手。按项目现有风格写代码,自驱编译+测试通过,保持极简。",
  userPrompt: `## 极简任务

在 app/test/src/test/java/com/mycm/deliverhub/servicetest/ 下新建 SimpleHelloTest.java:
- 在测试类内定义一个返回 "hello" 的静态方法,并测试它断言等于 "hello"
- 参考 app/test 里现有测试(如 DingTalkNotifyCalculatorTest)的 import 与风格
- 写完跑 mvn test 限定到该测试类(用 -Dtest=SimpleHelloTest),确认通过

目标:用最少的步骤跑通一个绿测试。`,
  allowedTools: ["Read", "Write", "Edit", "Bash"],
  maxTurns: 30,
  onEvent: (e) => {
    const s = e.text || e.name || "";
    if (s) console.log(`  [${e.type}] ${s.slice(0, 110).replace(/\n/g, " ")}`);
  },
});

console.log("\n=== 结果 ===");
console.log(`success=${r.success} turns=${r.turns} duration=${r.durationMs}ms`);
if (r.error) console.log("error:", String(r.error).slice(0, 250));
