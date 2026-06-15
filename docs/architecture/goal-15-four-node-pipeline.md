# Goal 15 — 4 节点 Pipeline:消费 HelmCode Skills

> 直接复制下面代码块到 Claude Code。

```
/goal 在 G14 基础上实现 4 节点 Pipeline,需求/代码/测试三节点直接消费 HelmCode 仓库的 core/clarify、core/implement、core/verify skill,仅上线节点新写 helmflow-deploy skill。核心原则:HelmCode 出 skill+标准,HelmFlow 出编排+UI+状态。前置:G14 已 commit;agent-runner + sandbox-worktree + orchestrator 已就位。

【范围】
1. Skill 加载机制:扩展 packages/agent-runner/src/skill.ts,新增 resolveSkillPath(skillName,helmcodeRoot?),优先从 HelmCode 仓库 core/<skill>/SKILL.md 加载,fallback 到 .claude/skills/<skill>/SKILL.md。manifest-loader 扩展 schema 加 helmcode.path 字段。节点 runner 通过 manifest 获取 helmcodeRoot 并传入 additionalDirectories(含 core/<skill>/references + standards)。

2. 节点-Skill 映射(require=clarify/code=implement/test=verify/deploy=helmflow-deploy),4 节点状态机 NODES=["require","code","test","deploy"],FailReason="spec-rejected"|"build-failed"|"test-failed"|"git-error",nextNode(current,result,reason?)→Transition。失败回路:需求被拒→回退需求(max3),implement自愈失败→回退代码(max3),verify有失败→回退代码(max3),git失败→回退上线(max2),全局>5次→blocked保留worktree。

3. 上线节点 Skill:新建 .claude/skills/helmflow-deploy/SKILL.md。工作流:git status--porcelain→git diff→git checkout-b feat/<featureId>-<scenarioName>→git add src/→git commit→git push→创建 PR(gh CLI)→输出<PR_URL>。约束:不写/改代码,不reset/rebase/revert,commit body含contractId+AC列表,只add src/。

4. Orchestrator Node Runners 重写(packages/orchestrator/src/node-runners/):
   a. require.ts — 加载 HelmCode clarify skill,传入 feature 元数据,产出契约,人工审批 checkpoint
   b. code.ts — 加载 HelmCode implement skill,传入已审批契约+standards,产出代码+测试+judgment-log,implement 内含 verify 自愈
   c. test.ts — 加载 HelmCode verify skill,独立回归验证,全绿→继续/失败→回退代码节点
   d. deploy.ts — 加载 helmflow-deploy skill,commit+push+PR

5. Portal API Routes 渐进替换(旧 route 标 deprecated 不删):
   /api/require ← /api/clarify(改 skill 名为 clarify)
   /api/code/run ← /api/coder/run(改 skill 名为 implement)
   /api/test/run ← /api/testgen+/api/qa(合并,用 verify skill)
   /api/deploy/run ← /api/committer(新 skill)
   /api/orchestrator/start — 内部走 4 节点

6. Portal UI:Cell 详情页显示 4 个节点按钮(需求/代码/测试/上线)+一键全流程。上线完成显示 PR 链接。节点状态 badge 扩展为 require→code→test→deploy 四色。

7. helmcode.yaml 配置:加 helmcode.path 相对路径,Portal 启动时从 manifest 读取传给 agent-runner,不硬编码路径。

8. 废弃标记(不删,下个 release 清理):.claude/skills/helmflow-clarifier/、helmflow-coder/、helmflow-testgen/、helmflow-qa/、helmflow-committer/。对应旧 API route 保留。

【约束】
- 禁装新 npm 包,复用已有依赖
- 测试节点采用 B 方案:implement 自带 verify 自愈,测试节点只做最终确认
- 严格 TypeScript,禁 any
- API route export const runtime="nodejs"
- 旧 route 不删只标 deprecated
- HelmCode 路径通过配置读取,不硬编码
- Skill 加载须 fallback 到本地 .claude/skills/
- orchestrator 内部回路上限 5 次,防止无限循环
- 上线 skill 不写/不改代码

【通过信号】
1. pnpm -r typecheck 0 error
2. resolveSkillPath("clarify",helmcodeRoot)返回 HelmCode 仓库 core/clarify/SKILL.md 路径
3. resolveSkillPath("helmflow-deploy")返回本地 .claude/skills/helmflow-deploy/SKILL.md
4. orchestrator 调用 4 节点:require→code→test→deploy,只在契约审批时停一次
5. 需求节点加载 HelmCode clarify→产出契约含 domain model/schema changes
6. 代码节点加载 HelmCode implement→生成代码+测试+judgment-log,implement 内部自愈
7. 测试节点加载 HelmCode verify→独立回归→全绿通过
8. 上线节点:commit+push+创建 PR→返回 PR URL
9. 失败回路:verify 失败→回退代码节点(max3次);git失败→回退上线(max2次)
10. 旧 API route /api/clarify 仍可用(deprecated)
11. helmcode.yaml 含 helmcode.path 配置项
12. helmflow-deploy SKILL.md 存在于 .claude/skills/ 下
13. Cell 详情页可见 4 节点按钮+PR 链接

完成后输出"Goal 15 验收清单"。
```