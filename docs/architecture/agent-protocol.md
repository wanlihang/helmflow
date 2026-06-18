# Agent 节点协议规范 — Full-Loop Platform

> 5 节点(Clarifier / Coder / TestGen / QA / Committer)的输入、输出、证据、自循环、跨节点回退协议。
> 所有跨节点传递的对象都用 Zod 定义 schema,运行时校验,**不允许自然语言传话**。

---

## 1. 协议设计原则

1. **结构化优于自然语言** — 节点之间用 yaml/json 传递,不用自由文本
2. **每个节点必须产出"机器可校验的证据"** — 没有证据 = 没完成
3. **Worker 与 Critic 物理分离** — 不同 LLM 调用、不同 system prompt,避免自评作弊
4. **失败必有 reflection** — 跨节点回退时,前一节点的失败原因结构化保留
5. **状态全持久化** — 任何 turn 都可中断/恢复,不依赖会话内存

---

## 2. 5 节点完整规约

### 2.1 节点 1:Clarifier(需求澄清)

| 项 | 内容 |
|---|------|
| **输入** | `userRequest: string` + `projectManifest: HelmcodeManifest` + `existingContracts: Contract[]` |
| **Worker 任务** | 加载 standards / 既有契约样本 → 与用户问澄清问题 → 产出 contract draft |
| **Worker 输出** | `Contract`(yaml frontmatter + markdown 章节,符合 `contract-schema`) |
| **Critic 任务** | 校验 contract 完整性 + AC 可程序验证性 |
| **Critic 通过条件** | AC 数量 ≥ 3、每条 AC 含可验证关键词("调用 X 后状态为 Y" / "返回 Z") + 状态机 PlantUML 解析通过 |
| **证据** | `clarifier-evidence.yaml` 记录:contract path / AC 计数 / state machine valid / draft hash |
| **人介入点** | ★ Worker+Critic 通过后,**契约必须人审** → 改 status 为 approved |
| **自循环上限** | Worker-Critic 内循环最多 5 轮,达上限 → escalate to human |

#### Contract Schema(关键字段)

```yaml
schemaVersion: 1
featureId: F005-forward-deliver-record
status: draft | approved | goal-running | done | blocked | abandoned
project: mycmdeliverhub
createdAt: 2026-06-03T10:30:00Z
domain: deliver               # 关联 feature-matrix 的域
matrixCellId: D-05            # 关联 feature-matrix 的格子
---
## Problem Definition
...
## State Machine
...
## Business Rules
- BR-001: ...
## Acceptance Criteria
- AC-001: 调用 forward 后,deliverRecord.status 从 PD_CONFIG 转为 PRICE_CONFIG
- AC-002: ...
## API Contract
...
```

#### Clarifier Critic 检查项(可执行)

```typescript
const checks = [
  () => contract.acceptanceCriteria.length >= 3,
  () => contract.acceptanceCriteria.every(ac => /(=>|状态|应为|应当|after|when)/i.test(ac)),
  () => parsePlantUML(contract.stateMachine).success,
  () => contract.businessRules.every(br => /^BR-\d{3}/.test(br.id)),
  () => contract.apiContract.methods.length >= 1,
];
```

---

### 2.2 节点 2:Coder(代码生成)

| 项 | 内容 |
|---|------|
| **输入** | `Contract`(approved) + `Reflection?`(若是回退) + `FixTask?`(若是 QA 反馈) + `SandboxHandle` |
| **Worker 任务** | 加载 patterns + adapter standards → 在 sandbox 内逐个 domain 生成代码 + 同步生成 stub Impl |
| **Worker 输出** | git diff(提交到 worktree branch) + judgment-log.md(⚠️ 决策项)|
| **Critic 任务** | 跑 `adapter.testStrict()`(java-ddd → ArchUnit + BootContextSmokeTest;node → ESLint + 类型检查) |
| **Critic 通过条件** | strict 测试全过、tsc/javac 0 错、判断日志结构化(每个 ⚠️ 项都有"当前选择"和"备选方案") |
| **证据** | `coder-evidence.yaml`:diff hash、changed files 列表、ArchUnit 报告 path、smoke test 报告 path |
| **失败处理** | Critic 失败原因结构化进 reflection-log,Worker 下一轮看到反馈再修;5 轮不过 → escalate |
| **自循环上限** | 5 轮 |

#### Coder 输入示例(回退时带 fixTask)

```yaml
contract:
  $ref: .claude/contracts/F005-forward-deliver-record.md
  status: approved
fixTask:
  schemaVersion: 1
  featureId: F005-forward-deliver-record
  issuedBy: qa-tester
  failedAcId: AC-003
  expectedBehavior: |
    forward 时应同步多维表 + 推流程节点,但当前实现只更新了状态
  actualBehavior: |
    SaveDeliverRecordHandler.doHandle 仅 run(saveAction),未 run(syncAction)/run(pushAction)
  evidence:
    - type: test-output
      location: target/surefire-reports/F005ForwardActsTest.txt
      snippet: |
        AssertionFailedError: expected sync_table populated, was empty
  hint: |
    参考 D-01 的 SaveDeliverRecordHandler 已编排的 syncAction / pushAction 顺序
```

---

### 2.3 节点 3:TestGen(测试生成)

| 项 | 内容 |
|---|------|
| **输入** | `Contract` + `CoderOutput`(diff + new classes 列表)|
| **Worker 任务** | 对每个新增 Facade 方法/Domain Service/Handler/Strategy 生成测试 |
| **Worker 输出** | 测试 diff(ACTS yaml + JUnit + Mockito 单测) + `test-ac-mapping.yaml`(测试与 AC 显式映射) |
| **Critic 任务** | 校验:每个 AC 至少对应 1 个 test、test 命名符合规范、ACTS 7 段齐全 |
| **Critic 通过条件** | mapping 完整 + test 命名规则通过 + `mvn -pl app/test compile` 通过 |
| **证据** | `testgen-evidence.yaml`:test files 列表、AC 覆盖度 100%、命名校验报告 |
| **自循环上限** | 5 轮 |

#### `test-ac-mapping.yaml` Schema

```yaml
schemaVersion: 1
featureId: F005-forward-deliver-record
mappings:
  - acId: AC-001
    tests:
      - file: ForwardActsTest.java
        method: testForward_Success
        type: acts-yaml
        casePath: src/test/java/.../forward/case01_success/caseObjs.yaml
  - acId: AC-002
    tests:
      - file: ForwardActsTest.java
        method: testForward_StatusNotMatch
        type: acts-yaml
  - acId: AC-003
    tests:
      - file: SaveDeliverRecordHandlerTest.java
        method: testDoHandle_TriggersSync
        type: junit-mockito
```

**关键设计**:此 mapping 文件让 QA 节点能精准定位"AC 失败时是哪些 test 出问题",反向推 Coder 改哪。

---

### 2.4 节点 4:QA Tester(测试运行 + Gap 检测)

| 项 | 内容 |
|---|------|
| **输入** | Coder + TestGen 完成的 worktree + `test-ac-mapping.yaml` |
| **Worker 任务** | 调 `adapter.testFull()`(strict + lenient 都跑) → 解析报告 → 找出失败的 AC |
| **Worker 输出** | `qa-report.yaml`(每个 AC 的 pass/fail + 详细原因)|
| **Critic 任务** | 校验"测试存在性 + 全过":Tests run ≥ N(N = mapping 中应有的测试数)、Failures = 0 |
| **Critic 通过条件** | 所有 AC 标 pass、testFull 0 失败、覆盖率 ≥ 阈值(项目 manifest 配) |
| **证据** | `qa-evidence.yaml`:report path、AC pass 计数、覆盖率 |
| **失败处理** | **生成 fix-task.yaml,通过 Orchestrator 回退到 Coder**(可能也回退到 TestGen 如发现是测试本身错) |
| **自循环上限** | Critic 内不循环(只判定);跨节点 Coder ↔ QA 循环最多 8 轮 |

#### `qa-report.yaml` Schema

```yaml
schemaVersion: 1
featureId: F005-forward-deliver-record
runAt: 2026-06-03T11:45:00Z
strict:
  archRules: { passed: 8, failed: 0 }
  smokeTest: { passed: 1, failed: 0 }
lenient:
  totalRun: 12
  passed: 11
  failed: 1
acResults:
  - acId: AC-001
    status: pass
    tests: [testForward_Success]
  - acId: AC-002
    status: pass
  - acId: AC-003
    status: fail
    tests: [testDoHandle_TriggersSync]
    failureReason: |
      AssertionFailedError: expected sync table populated, was empty
    suggestedFix: |
      检查 SaveDeliverRecordHandler.doHandle 是否调用 run(syncAction, ctx)
gapsDetected: 1
escalateAction: route-to-coder    # route-to-coder | route-to-testgen | escalate-human
```

#### Gap → fix-task 路由策略

```typescript
function routeFailedAc(ac: AcResult): EscalateAction {
  // 失败原因含"NPE / NoSuchBeanDefinition / 编译错误" → 代码侧 → Coder
  if (/NullPointerException|NoSuchBeanDefinitionException/.test(ac.failureReason)) {
    return 'route-to-coder';
  }
  // 失败原因含"AssertionError 但断言写错"(测试模式问题) → 测试侧 → TestGen
  if (/^test data malformed|yaml schema invalid/.test(ac.failureReason)) {
    return 'route-to-testgen';
  }
  // 默认走 Coder
  return 'route-to-coder';
}
```

---

### 2.5 节点 5:Committer(格式化 + 提交 + PR)

| 项 | 内容 |
|---|------|
| **输入** | QA pass 后的 worktree + judgment-log + qa-report |
| **Worker 任务** | `adapter.format()` → 生成 commit message(参考 conventional commits + judgment-log 摘要) → `git commit` → push feature 分支 → 创 PR |
| **Worker 输出** | PR URL、commit SHA |
| **Critic 任务** | 校验:commit message 符合规范、PR description 含 contract+judgment-log+qa-report 链接 |
| **Critic 通过条件** | git push 成功、PR 创建成功、PR description 完整 |
| **证据** | `committer-evidence.yaml`:commit SHA、PR URL、CI 触发记录 |
| **人介入点** | ★ PR 创建后,**人审 ⚠️ 决策 + diff** → 通过 → 合并 main |
| **自循环上限** | 3 轮(format 失败大概率是 lint 配置问题,不需要多轮) |

#### Commit Message 模板

```
{type}({scope}): {short-description}

{detailed-description from contract Problem Definition}

实现内容:
- {AC-001 摘要}
- {AC-002 摘要}
- ...

判断:
- [JD-001] {made decision}
- [JD-004] ⚠️ {needs confirmation - 见 judgment-log}

测试覆盖:
- {AC-001} → {test method}
- ...

Refs: {feature-id} / {matrix-cell-id}
Contract: .claude/contracts/{F-ID}.md
Judgment-Log: .claude/judgment-logs/{F-ID}.md
QA-Report: .claude/orchestration/{F-ID}/runs/{run-id}/qa-report.yaml
```

---

## 3. Reflection Log(跨节点反思累积)

### 3.1 设计目的

每次节点失败时,Worker 自然语言写一段 "我犯了什么错、为什么犯、下次怎么避免" → 落地到 reflection-log → **下一节点(或同节点下一轮)** 在 system prompt 加载时把它喂回去。

参考 Reflexion 论文 (NeurIPS 2023):**verbal reflection 是 SOTA 自循环修复的关键**。

### 3.2 Schema

```yaml
schemaVersion: 1
featureId: F005-forward-deliver-record
reflections:
  - id: REF-001
    occurredAt: 2026-06-03T10:35:00Z
    nodeName: coder
    iteration: 2
    failure:
      criticName: arch-rules
      summary: ArchUnit 报错:Acceptor 落在 application/acceptor/(顶层)
      evidence: ArchitectureRulesTest#acceptor_must_be_in_context_subpackage
    reflection: |
      我把 ProdMappingAcceptor 放在了 application/acceptor/ 顶层,违反 §A0-1 包内聚原则。
      正确的做法是放在 application/mapping/acceptor/ProdMappingAcceptor.java。
      下次新建 Acceptor 时,先确认 contract 的 domain 字段,放进 application/<domain>/acceptor/。
    actionTaken:
      - moved: src/main/java/.../application/acceptor/ProdMappingAcceptor.java
        to: src/main/java/.../application/mapping/acceptor/ProdMappingAcceptor.java
  - id: REF-002
    occurredAt: 2026-06-03T11:50:00Z
    nodeName: coder       # 注意:这是被 QA 触发的 Coder 第二次执行
    iteration: 1
    triggeredBy:
      type: fix-task
      issuedBy: qa-tester
      acId: AC-003
    reflection: |
      QA 报 AC-003 失败:forward 时未同步多维表。
      原因是我在 SaveDeliverRecordHandler 中省略了 run(syncAction, ctx),
      只 run 了 saveAction。这是阅读 contract 时漏读了 BR-002 中的"同步"要求。
      下次 doHandle 编排前,应把 contract.businessRules 全部翻译到 action 调用列表,逐条对照。
```

### 3.3 应用方式

下一节点的 system prompt 末尾自动 append:

```
## Past Reflections (must avoid repeating these mistakes)

[REF-001] 2026-06-03 10:35 | coder failed arch-rules
"我把 ProdMappingAcceptor 放在了 application/acceptor/ 顶层..."

[REF-002] 2026-06-03 11:50 | coder triggered by qa-tester for AC-003
"QA 报 AC-003 失败:forward 时未同步多维表..."

Apply these lessons to your work. Do not repeat the same mistakes.
```

---

## 4. Orchestration State Machine

### 4.1 总状态机

```
                                            ┌──────────────┐
                                            │  abandoned   │
                                            └──────────────┘
                                                  ▲
                                                  │ user
        clarifier            human      goal      │              user
draft ──────────► clarified ──review──► approved ──run──► goal-running ──pass──► done
   ▲                  │                              │              │
   │                  │ critic-fail (escalate)       │              │ block (8x)
   │                  ▼                              │              ▼
   │              blocked-clarify                    │          blocked-goal
   │                                                 │              │
   └─────────────────────────────────────────────────┴──────────────┘
                                       reset / retry (human)
```

### 4.2 单 run 内子状态机(`goal-running` 内部)

```
   coder.start ──► coder.success ──► testgen.start ──► testgen.success ──► qa.start
       │                                                                      │
       │ critic-fail                                                          │
       ▼                                                                      │
   coder.refine                                                               │
       │                                                                      │
       │ refine-exhausted                                                     │
       ▼                                                                      │
   blocked-coder                                                              │
                                                                              │
                        ◄─────────── route-to-coder ◄───────── qa.fail ◄─────┘
                                                                  │
                                                                  │ all-pass
                                                                  ▼
                                                              committer.start
                                                                  │
                                                                  ▼
                                                              committer.success
                                                                  │
                                                                  ▼
                                                                  done
```

### 4.3 持久化文件(每个 run 一份)

```
.claude/orchestration/F005-forward-deliver-record/
├── run-001-2026-06-03.yaml          # 主 state 文件
├── reflections.yaml                  # 跨 run 累积(同 feature 下)
└── runs/
    ├── 2026-06-03T10-30-00/
    │   ├── clarifier/
    │   │   ├── attempt-1.yaml        # Worker output
    │   │   └── critic-1.yaml         # Critic verdict
    │   ├── coder/
    │   │   ├── attempt-1.yaml
    │   │   ├── critic-1.yaml
    │   │   ├── attempt-2.yaml        # 失败后第二次
    │   │   └── critic-2.yaml
    │   ├── testgen/
    │   ├── qa/
    │   │   ├── attempt-1.yaml
    │   │   ├── critic-1.yaml
    │   │   └── fix-task-1.yaml       # 触发回到 coder
    │   ├── coder/                    # 第二次 coder(被 fix-task 触发)
    │   │   ├── attempt-1.yaml
    │   │   └── critic-1.yaml
    │   ├── qa/                       # 第二次 qa
    │   ├── committer/
    │   └── final-state.yaml
    └── 2026-06-03T14-00-00/          # 同 feature 第二次跑(若 abandoned 后重启)
```

**为什么每次尝试一个文件**:便于 git diff 审、便于 portal UI timeline 渲染、便于 reflection 抽取。

---

## 5. Critic 独立性的具体保障

### 5.1 物理隔离

```typescript
// ❌ 错误:Critic 共享 Worker 的 message history,会有偏差
async function runWithSharedSession() {
  const session = anthropic.beta.messages;
  const workerOutput = await session.create({ system: workerPrompt, messages: [...] });
  const criticVerdict = await session.create({           // 同 session,会偏向 Worker
    system: criticPrompt,
    messages: [...workerOutput.messages]
  });
}

// ✅ 正确:Critic 独立 LLM 调用,只看 Worker 最终产出,不看其推理过程
async function runWithIsolatedCritic(workerOutput: NodeOutput) {
  const criticVerdict = await anthropic.messages.create({
    model: criticModel,
    system: criticSystemPrompt,
    messages: [
      { role: 'user', content: `Review the following artifact:\n${workerOutput.artifact}\n\nReturn JSON {pass: bool, issues: [...]}` }
    ]
  });
  return parseVerdict(criticVerdict);
}
```

### 5.2 不同 model 选择(可选,降本+独立性)

| Node | Worker 推荐模型 | Critic 推荐模型 |
|------|--------------|--------------|
| Clarifier | claude-opus-4-7 | claude-sonnet-4-6 |
| Coder | claude-opus-4-7 | claude-haiku-4-5(只看代码静态指标) |
| TestGen | claude-sonnet-4-6 | claude-haiku-4-5 |
| QA | claude-sonnet-4-6 | (无 Worker,直接判定) |
| Committer | claude-haiku-4-5 | claude-haiku-4-5 |

**总成本估算**:一个标准 feature 完整跑通约 80-150 万 tokens(包含 Worker + Critic + 跨节点 reflection),按当前价格 ~$2-5。

---

## 6. Escalation 策略

### 6.1 触发条件矩阵

| 节点 | 自循环上限 | 触发后动作 |
|------|---------|---------|
| Clarifier | Worker-Critic 5 轮 | escalate human(契约本身需澄清) |
| Coder | Worker-Critic 5 轮 / 同一 fix-task 3 轮 | 回退 Clarifier(契约可能不准确)或 escalate human |
| TestGen | 5 轮 | escalate Coder(代码可能本身有问题) |
| QA | Coder ↔ QA 8 轮 | escalate human |
| Committer | 3 轮 | escalate human(配置/权限问题) |

### 6.2 Escalation 时给人的报告

```yaml
escalation:
  reason: coder-refine-exhausted
  feature: F005
  iterations: 5
  lastFailure:
    critic: arch-rules
    issue: AcceptorMustBeInContextSubpackage 反复违反
  reflectionsCount: 5
  hint: |
    Coder 5 次尝试后仍把 Acceptor 放错位置。可能原因:
    1. Contract 的 domain 字段填错或缺失
    2. Patterns 文档对该项目类型不适用
    3. 项目结构与 helmcode.yaml 声明不一致
  suggestedHumanAction:
    - 检查 contract.domain 是否正确
    - 跑 `helmcode matrix validate` 看 manifest 是否匹配现状
    - 直接定位 application/acceptor 顶层并修
```

---

## 7. 与 HelmCode 现状的映射

| 协议组件 | HelmCode 现状 | 升级路径 |
|---------|--------------|---------|
| Contract Schema | `core/clarify/references/contract-template.md` | 抽取为 Zod schema(`packages/contract-schema`) |
| Worker prompt | `core/clarify/SKILL.md` 等 | 抽取到 `packages/agent-core/prompts/*.system.md` |
| Critic | Haiku 评估器(/goal 用) + ArchitectureRulesTest + BootContextSmokeTest | 形式化为 `packages/agent-core/critics/*.ts` |
| Reflection | memory/feedback_*.md | 升级为运行时 reflection-log,结构化 schema |
| Fix-task | (无,/goal 内修没暴露此协议) | 新增 |
| Orchestration state | `.claude/contracts/registry.md`(线性) | 升级为 `.claude/orchestration/{F-ID}/run-*.yaml` |
| Judgment Log | `.claude/judgment-logs/{F-ID}.md` | 保留,纳入 committer 节点的 PR description |

---

## 8. 协议版本管理

所有 schema 都有 `schemaVersion: 1` 字段。**升级原则**:
- 字段新增 → minor(向后兼容)
- 字段删除/语义变更 → major(`schemaVersion: 2`)+ 同时维护 v1 解析器一段时间
- 协议变更必须更新本文档 + 相应 Zod schema + 所有 mock 测试数据

---

## 9. 关键设计决策摘要

| # | 决策 | 选择 | 理由 |
|---|-----|-----|-----|
| 1 | 节点数量 | 5(Clarifier/Coder/TestGen/QA/Committer) | 与 SDLC 经典阶段对齐;不细分至 7-8 节点(过度治理) |
| 2 | Worker-Critic 模式 | 每节点都有,Critic 独立 LLM 调用 | Reflexion / AutoGen 经验,防自评作弊 |
| 3 | 节点间通讯协议 | 结构化 yaml + Zod 校验 | 拒绝自然语言传话,防信号衰减 |
| 4 | Reflection 形式 | 自然语言 + 结构化触发条件 | Reflexion paper 验证 |
| 5 | 失败回退 | Saga-style,先回 Coder,不通过再回 Clarifier | 局部修复优先,全局重做最后 |
| 6 | 持久化 | 每次 attempt 单独 yaml,git tracked | 可 review,可 timeline 重放 |
| 7 | 人介入点 | 严格 2 个(契约审 + PR 审) | "全自动"是话术,核心决策必须人 |
| 8 | 自循环上限 | 节点内 5 轮 / 跨节点 8 轮 | 经验值,防死循环烧 token |
