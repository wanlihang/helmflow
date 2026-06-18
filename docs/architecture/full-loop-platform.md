# Full-Loop AI Coding Platform — 完整方案

> 把 HelmCode 从"单 feature 闭环"升级为"全流程多 agent 自循环 IDP",支持多项目接入、业务场景×功能点全景视图、跨节点 gap 反馈与自我修复。

---

## 0. 文档导航

本方案拆为 4 份子文档(本文为总览):

- 📐 [tech-stack-rationale.md](./tech-stack-rationale.md) — 技术栈每项的对比与选择理由
- 📦 [repo-structure.md](./repo-structure.md) — pnpm monorepo 布局与模块依赖
- 🤖 [agent-protocol.md](./agent-protocol.md) — 5 节点输入/输出/证据/自循环协议
- 📋 (本文)full-loop-platform.md — 总体架构 + 数据模型 + API + 路线图 + 风险

---

## 1. 设计目标

### 1.1 用户故事

```
[作为产品经理]
  我在 Portal 上看 mycmdeliverhub 的业务全景矩阵(40 个功能点)
  → 找到"D-05 推进交付需求到下一阶段"格子
  → 点"启动需求"输入一句话
  → 走开喝咖啡

[1.5 小时后]
  收到通知:契约草案已生成,请审
  → 5 分钟审契约,改 status 为 approved
  → 走开喝咖啡

[再 1 小时后]
  收到通知:goal achieved,PR 已创建
  → 5 分钟审 ⚠️ 决策 + diff
  → 合并 PR

[完成]
  Portal 上 D-05 自动变 ✅,矩阵更新
  本次踩到的新坑(若有)进 reflections.yaml,下次不再犯
```

### 1.2 系统目标

| # | 目标 | 验收方式 |
|---|------|---------|
| G1 | **多项目接入**:任何符合 helmcode.yaml schema 的项目可注册 | 接入第 2 个项目类型(node-express)无需改 agent-core |
| G2 | **全流程闭环**:需求 → 契约 → 代码 → 测试 → QA → PR | 完整跑通一个 mycmdeliverhub 真实 feature,人介入仅 2 次 |
| G3 | **节点内自修复**:Worker 失败,Critic 反馈,自动迭代收敛 | Coder 在 ArchUnit 失败时自动调整包路径并通过 |
| G4 | **跨节点 gap 反馈**:QA 发现代码-AC gap,自动触发 Coder 重新修复 | 在故意制造 AC 失败的 feature 上,跨节点循环 ≥ 3 次后通过 |
| G5 | **业务全景可视化**:Portal 实时反映每个功能点状态 | 任何 contract 状态变更,Portal 5 秒内刷新 |
| G6 | **可解释性**:每次 AI 决策有迹可查,可 git diff 审 | 任意 feature 的 timeline 可在 portal 上回放 |
| G7 | **AI 友好性兜底**:沿用 HelmCode P0+P1 加固的所有约束 | ArchitectureRulesTest + BootContextSmokeTest + Tests N≥1 全保留 |

### 1.3 非目标

- **不是 AGI**:不追求"输入一句话生成完整大型应用",只追求"在已知架构上把单 feature 自动化"
- **不替代人**:契约审 + PR 审两个人介入点是设计选择,不是缺陷
- **不一次性支持所有语言**:MVP 仅 java-ddd,V1 加 node,V2 才考虑 python/go
- **不是 IDE**:不做编辑器,只在 Portal 上展示进度;实际 coding 在 sandbox 内由 agent 完成

---

## 2. 核心架构(5 层)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ L4 Portal Layer                                                         │
│   Next.js 15 App Router + React 19 + Tailwind + shadcn/ui              │
│   - 全景矩阵(多项目 / 单项目 × 业务场景×功能点)                       │
│   - 单 feature 钻取(契约 / 阶段进度 / 反思日志 / commit 历史)          │
│   - 启动需求 / 审契约 / 审 ⚠️ 入口                                     │
├─────────────────────────────────────────────────────────────────────────┤
│ L3 Orchestrator Layer                                                   │
│   Next.js Route Handlers(MVP)/ Hono(V1 拆分)                         │
│   - DAG 状态机(Clarifier→Coder→TestGen→QA→Committer)                  │
│   - 跨节点回退协议(Saga-style)                                        │
│   - SSE streaming 输出到 Portal                                         │
│   - 任务调度(MVP setTimeout / V1 graphile-worker)                     │
├─────────────────────────────────────────────────────────────────────────┤
│ L2 Agent Core Layer                                                     │
│   @anthropic-ai/sdk + 自有 thin wrapper                                 │
│   - 5 个节点(Clarifier / Coder / TestGen / QA / Committer)             │
│   - 每节点 Worker + Critic 模式(Reflexion 风格)                        │
│   - Reflection log 跨节点累积                                           │
├─────────────────────────────────────────────────────────────────────────┤
│ L1 Adapter Layer                                                        │
│   - ProjectAdapter 接口 + 内置 java-ddd / node-express 适配器           │
│   - 统一 build / test-strict / test-full / lint / format / smoke API   │
│   - 解析 ArchUnit / surefire / vitest 等不同测试报告格式                 │
├─────────────────────────────────────────────────────────────────────────┤
│ L0 Sandbox Layer                                                        │
│   - dockerode + git worktree                                             │
│   - 预热镜像(java-ddd-sofa-21 / node-20)+ .m2/node_modules cache      │
│   - 隔离的容器环境,每个 feature 独立 worktree,执行后清理               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 数据模型

### 3.1 核心实体关系

```
projects (1) ─── (N) features (业务全景一格)
                        │
                        │ (1)
                        ▼
                   contracts (N)  ← 一个 feature 可多次启动(abandoned 后重启)
                        │
                        │ (1)
                        ▼
              orchestration_runs (N)  ← 一次 /dev-flow 执行
                        │
                        │ (1)
                        ▼
              node_attempts (N)  ← 单节点一次 Worker+Critic 循环
                        │
                        │ (1)
                        ▼
                  reflections (N)
```

### 3.2 Drizzle Schema(核心表)

```typescript
// packages/storage/src/schema/projects.ts
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),                  // mycmdeliverhub
  name: text('name').notNull(),
  type: text('type').notNull(),                 // java-ddd | node-express | ...
  manifestPath: text('manifest_path').notNull(),// helmcode.yaml 路径
  repoUrl: text('repo_url'),
  registeredAt: integer('registered_at', { mode: 'timestamp' }).notNull(),
});

// packages/storage/src/schema/features.ts
export const features = sqliteTable('features', {
  id: text('id').primaryKey(),                  // F005-forward-deliver-record
  projectId: text('project_id').references(() => projects.id),
  matrixCellId: text('matrix_cell_id'),         // D-05
  domain: text('domain').notNull(),             // deliver | mapping | pricing | ...
  name: text('name').notNull(),
  legacyMetadata: text('legacy_metadata', { mode: 'json' }),  // flowCode / activities
  targetMetadata: text('target_metadata', { mode: 'json' }),  // handler / actions
  status: text('status').notNull(),             // not-started | clarifying | pending-goal | ...
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// packages/storage/src/schema/contracts.ts
export const contracts = sqliteTable('contracts', {
  id: text('id').primaryKey(),
  featureId: text('feature_id').references(() => features.id),
  status: text('status').notNull(),             // draft | approved | goal-running | done | blocked | abandoned
  filePath: text('file_path').notNull(),        // .claude/contracts/F005-...md
  contentHash: text('content_hash').notNull(),
  approvedBy: text('approved_by'),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// packages/storage/src/schema/orchestration-runs.ts
export const orchestrationRuns = sqliteTable('orchestration_runs', {
  id: text('id').primaryKey(),                  // run-2026-06-03T10-30-00
  contractId: text('contract_id').references(() => contracts.id),
  state: text('state').notNull(),               // running | done | blocked | abandoned
  currentNode: text('current_node'),            // clarifier | coder | testgen | qa | committer
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  prUrl: text('pr_url'),                        // committer 完成后填
  totalTokens: integer('total_tokens'),
  totalCostUsd: real('total_cost_usd'),
});

// packages/storage/src/schema/node-attempts.ts
export const nodeAttempts = sqliteTable('node_attempts', {
  id: text('id').primaryKey(),
  runId: text('run_id').references(() => orchestrationRuns.id),
  nodeName: text('node_name').notNull(),        // clarifier | coder | ...
  iteration: integer('iteration').notNull(),    // 1, 2, 3...
  workerOutputPath: text('worker_output_path'), // .claude/orchestration/F005/runs/.../coder/attempt-1.yaml
  criticVerdictPath: text('critic_verdict_path'),
  status: text('status').notNull(),             // running | passed | failed | escalated
  triggeredBy: text('triggered_by', { mode: 'json' }),  // null | { type: 'fix-task', acId, ... }
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  tokensUsed: integer('tokens_used'),
});

// packages/storage/src/schema/reflections.ts
export const reflections = sqliteTable('reflections', {
  id: text('id').primaryKey(),
  featureId: text('feature_id').references(() => features.id),
  attemptId: text('attempt_id').references(() => nodeAttempts.id),
  nodeName: text('node_name').notNull(),
  failureCriticName: text('failure_critic_name'),
  failureSummary: text('failure_summary'),
  reflectionText: text('reflection_text').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
});
```

### 3.3 状态字段详解

```
features.status
  - not-started         🟦 未启动(无 contract)
  - clarifying          🟡 contract draft 中(Clarifier worker-critic 循环)
  - pending-goal        🟢 contract approved,等启动 /goal
  - implementing        🔵 orchestration_runs 有进行中的 run
  - done                ✅ 最近 run 状态 = done
  - blocked             🔴 最近 run 状态 = blocked
  - abandoned           ⚫ 最近 contract status = abandoned
```

---

## 4. API 设计

### 4.1 REST 端点(Next.js Route Handlers)

```
GET    /api/projects                         项目列表
POST   /api/projects                         注册项目(上传 helmcode.yaml)
GET    /api/projects/:projectId              项目详情
GET    /api/projects/:projectId/matrix       业务全景矩阵

GET    /api/features?projectId=&status=      feature 查询
GET    /api/features/:featureId              feature 详情(含最新 contract / 最新 run)
POST   /api/features/:featureId/start        启动 /dev-flow,body: { userRequest, mode: 'auto'|'step' }

GET    /api/contracts/:contractId            契约详情
PATCH  /api/contracts/:contractId            修改契约状态(draft → approved)

GET    /api/orchestration/:runId             单 run 状态
GET    /api/orchestration/:runId/stream      SSE 流(实时 token + 状态更新)
POST   /api/orchestration/:runId/cancel      手动终止
POST   /api/orchestration/:runId/escalate    触发回退

GET    /api/orchestration/:runId/attempts    所有 node attempts
GET    /api/orchestration/:runId/timeline    时间线(用于 UI 渲染)
```

### 4.2 SSE 事件 schema

```typescript
type OrchestrationEvent =
  | { type: 'node.started'; nodeName: NodeName; iteration: number; ts: number }
  | { type: 'node.token'; nodeName: NodeName; chunk: string }
  | { type: 'node.critic-started'; nodeName: NodeName; iteration: number }
  | { type: 'node.critic-verdict'; nodeName: NodeName; pass: boolean; issues: Issue[] }
  | { type: 'node.passed'; nodeName: NodeName; evidencePath: string }
  | { type: 'node.failed'; nodeName: NodeName; reason: string }
  | { type: 'fix-task.issued'; from: NodeName; to: NodeName; failedAcId: string }
  | { type: 'reflection.added'; reflectionId: string; text: string }
  | { type: 'run.completed'; state: 'done' | 'blocked'; prUrl?: string }
  | { type: 'run.error'; error: string };
```

### 4.3 CLI 入口(对应 web API)

```bash
helmcode start <feature-id> [--auto] [--mode=step]
helmcode status <feature-id>
helmcode timeline <run-id>
helmcode escalate <run-id>
helmcode matrix [--project=mycmdeliverhub]
helmcode matrix work <cell-id>          # 选定矩阵格子启动 feature
```

---

## 5. 自循环修复机制(整合到全图)

```
                        ┌─────────────────────────────────────┐
                        │  Reflection Log(全 feature 累积)    │
                        │   inject to next system prompt      │
                        └─────────────────┬───────────────────┘
                                          │
                                          │ feeds
        ┌──────────────────────┬──────────┴──────────┬───────────────────┐
        ▼                      ▼                     ▼                   ▼
   ┌─────────┐            ┌─────────┐           ┌─────────┐         ┌─────────┐
   │Clarifier│ ───pass──► │ Coder   │ ──pass──► │ TestGen │ ──pass► │   QA    │
   │ W + C   │            │ W + C   │           │ W + C   │         │ W + C   │
   └─────────┘            └────▲────┘           └─────────┘         └────┬────┘
       │                        │ fix-task.yaml(回退,带 reflection)        │
       │                        └──────────────────────────────────────────┘
       │ critic fail                                                       │ all pass
       ▼                                                                   ▼
   refine(同 W + C)                                                  ┌─────────┐
       │                                                              │Committer│
       │ exhausted(5x)                                               │ W + C   │
       ▼                                                              └────┬────┘
   escalate human                                                          │
                                                                           ▼
                                                                    git push + PR
                                                                           │
                                                                           ▼
                                                                  ★ 人审 ⚠️ + 合并
```

**两层循环**:
- **小循环**(节点内 Worker ↔ Critic):每节点 5 轮上限,Reflexion 风格
- **大循环**(跨节点 QA → Coder):8 轮上限,Saga-style 回退

---

## 6. 多项目接入协议(`helmcode.yaml`)

完整 schema 见 [tech-stack-rationale.md](./tech-stack-rationale.md) 与 [agent-protocol.md](./agent-protocol.md);此处给最小可用样例:

```yaml
# 项目根目录:helmcode.yaml
schemaVersion: 1
project:
  name: mycmdeliverhub
  type: java-ddd
  description: 交付中枢平台

runtime:
  java: "21"
  maven: "3.9.x"

commands:
  build: mvn -pl app/bootstrap -am compile -DskipTests -q
  test-strict: mvn -pl app/test test -DexcludedGroups=lenient
  test-full: mvn -pl app/test test -DisSkipIntegrationTest=false
  smoke: mvn -pl app/test test -Dtest=BootContextSmokeTest
  lint: mvn checkstyle:check
  format: mvn spotless:apply

standards:
  preset: java-ddd
  conventions: .claude/standards/project-conventions.md

orchestration:
  agents:
    coder: { model: claude-opus-4-7, maxIterations: 5 }
    qa: { model: claude-sonnet-4-6, maxCrossNodeLoops: 8 }
  humanCheckpoints: [after-clarifier, after-qa-pass]

sandbox:
  type: docker
  image: helmcode/java-ddd-sofa-21:latest
  caches: [".m2", ".gradle"]
  worktreeIsolation: true

featureMatrix: .claude/matrix/feature-matrix.yaml
```

注册方式:`helmcode register <repo-path>` → 解析 yaml → 写入 projects 表。

---

## 7. 全景矩阵(`feature-matrix.yaml`)

参考方案文档"重构方案附录 C"的结构,机器化为:

```yaml
schemaVersion: 1
project: mycmdeliverhub
domains:
  - id: deliver
    name: 交付管理
    features:
      - id: D-01
        name: 创建交付需求
        legacy:
          flowCode: PIPELINE_SAVE_DELIVER_RECORD
          activities:
            - SaveDeliverRecordActivity
            - CreateSopFlowInstanceActivity
            - CreateDeliverTaskActivity
            - SyncDeliverRecordToMultiTableActivity
            - PushFlowNodeInstanceActivity
        target:
          handler: SaveDeliverRecordHandler
          actions:
            - SaveDeliverRecordAction
            - CreateFlowInstanceAction
            - CreateDeliverTaskAction
            - SyncMultiTableAction
            - PushFlowNodeAction
          context: deliver
        priority: P0
      - id: D-05
        name: 推进交付需求到下一阶段
        legacy:
          flowCode: PIPELINE_FORWARD_DELIVER_RECORD
          activities: [ForwardDeliverRecordActivity, SyncDeliverRecordToMultiTableActivity, PushFlowNodeInstanceActivity]
        target:
          handler: ForwardDeliverRecordHandler
          actions: [ForwardDeliverRecordAction, SyncMultiTableAction, PushFlowNodeAction]
          context: deliver
        priority: P1
      # ... D-02 到 D-10
  - id: mapping
    name: 产品映射
    features:
      # ... P-01 到 P-07
  - id: pricing
    name: 价格配置
    features:
      # ... PR-01 到 PR-18
  - id: signing
    name: 签约
    features:
      # ... S-01 到 S-03
  - id: ops
    name: 运维
    features:
      # ... O-01, O-02
```

**status 字段不存在**:由 status-derivation.ts 在每次 portal 加载时实时推导(从 contracts + orchestration_runs)。

---

## 8. 实施路线图

### Phase 0:协议层 + 矩阵抽取(1-2 周)

**目标**:打地基,让后续工作有 ground truth。

- [x] tech-stack-rationale.md(本目录)
- [x] repo-structure.md
- [x] agent-protocol.md
- [ ] 把交付中枢"重构方案附录 C"的 5 域 40 功能点抽成 `feature-matrix.yaml`,提交到 mycmdeliverhub 仓库 `.claude/matrix/feature-matrix.yaml`
- [ ] 写第一份 `helmcode.yaml`(以 mycmdeliverhub 为参考)
- [ ] 把 `core/clarify/SKILL.md` 的核心 prompt 抽出,作为后续 Clarifier Worker prompt 的来源

**验收**:用 yaml 描述清楚一个 feature 完整生命周期需要的所有元数据。

### Phase 1:Monorepo 骨架 + agent-core MVP(3 周)

- pnpm workspace + Turbo 初始化
- packages/contract-schema(Zod 全套 schema)
- packages/agent-core 拆 5 角色,每个 Worker + Critic
- packages/storage(Drizzle SQLite + repository pattern)
- packages/sandbox MVP(支持 git worktree,Docker 后续)
- packages/adapter-core + java-ddd adapter
- apps/cli 升级版,加 `helmcode start <feature-id>`

**验收**:在终端跑 `helmcode start D-05`,完成完整 5 节点闭环(无 web UI),人介入 2 次。

### Phase 2:Orchestrator + 跨节点循环(4 周)

- Orchestrator 状态机(在 agent-core 之上)
- fix-task.yaml + Saga 回退
- Reflection log 跨节点共享
- 在故意造的 buggy contract 上验证:Coder ↔ QA 自循环 ≥ 3 次后通过

**验收**:无人介入完成跨节点 gap 修复 ≥ 3 个真实 case。

### Phase 3:Sandbox + 多项目(4 周)

- packages/sandbox 完整 dockerode 实现
- 预热镜像 + cache layer 优化
- 适配第二个项目类型(node-express),验证 Adapter 抽象
- Sandbox 性能基准:cold start < 30s,warm start < 5s

**验收**:同时跑 mycmdeliverhub + 一个 node 项目,共享 Orchestrator,不冲突。

### Phase 4:Portal MVP(4 周)

- apps/portal Next.js 初始化(shadcn/ui + Tailwind 4)
- 全景矩阵页面(从 feature-matrix.yaml 渲染,实时状态从 orchestrator API)
- 单 feature 钻取:契约审 / 进度 timeline / SSE token 流
- "启动需求"表单 + 审契约 / 审 ⚠️ 流程
- 部署 Docker Compose 单机自托管

**验收**:产品经理不开 IDE / 不写 prompt,在 Portal 上完成需求录入到合 PR 的全流程。

### Phase 5:学习与生产化(4 周,可选)

- 跨项目 skill library(memory/feedback 升级,跨 project 共享反思)
- A/B agent prompt 优化
- Postgres 生产环境
- e2b.dev 远程 sandbox 适配
- 钉钉/飞书 webhook(每日进展推送)

---

## 9. 风险与应对

### R1:Critic 通过条件设计错误,误判 goal achieved

**症状**:Critic 写得太宽松,Worker 跑通 critic 但代码实际有 bug。

**应对**:
- Critic 的所有判定都基于"机器可校验信号"(test 通过、ArchUnit 通过、覆盖率达标),拒绝"我觉得 OK"这种主观判断
- HelmCode 已加固的 `Tests run ≥ 1` 是同类思想的雏形,系统化扩展
- 关键节点(QA)用独立 LLM 调用,杜绝 Worker 自评

### R2:Sandbox 启动慢拖死循环

**症状**:每次 Worker iteration 都重启容器,1 个 feature 跑 2 小时。

**应对**:
- 同一 run 内复用 sandbox 句柄,只在 final destroy 时清理
- 预热镜像 + cache volume,目标 warm start < 5s
- mvn 用 `-q -B` 减日志、用 `-am` 增量编译

### R3:Token 成本失控

**症状**:一个 feature 跑掉 $20+,无法商用。

**应对**:
- 节点级别成本上限(per-feature budget),超额自动 escalate
- 区分 Worker / Critic 模型(Critic 用 Haiku 4.5)
- prompt caching(Anthropic SDK 已支持,长 system prompt 缓存)
- 反思日志压缩(只保留最近 5 条,旧的归档)

### R4:Reflection log 增长失控,context 污染

**症状**:50 个 reflection 喂 Coder,prompt 超 200KB,LLM 抓不住重点。

**应对**:
- Reflection 按 feature 隔离,默认只注入当前 feature 的反思
- 跨 feature 反思(全局教训)经人工筛选后写入 memory/feedback,固定数量
- 反思去重(同样错误第 2 次出现 → 升级警告级别,不重复存)

### R5:多项目接入时 Adapter 抽象漏洞

**症状**:第 2 个项目接入时发现 Adapter 接口描述能力不够,需要回头改 java-ddd adapter。

**应对**:
- Phase 3 一开始就做 node-express adapter,**两个并跑** 来反推接口完备性
- Adapter 接口设计前先列 10 个"adapter 该干什么"的具体 case,case-driven design

### R6:并发跑多个 feature 时资源竞争

**症状**:同一项目两个 feature 同时跑,git worktree 冲突 / .m2 写竞争。

**应对**:
- 同项目 feature 串行(MVP),不同项目 feature 并行
- worktree branch 命名带 feature-id 前缀,确保唯一
- .m2 用只读 mount + 容器内独立 .m2-local 写入

### R7:人介入点变成瓶颈

**症状**:产品经理 / reviewer 不在,feature 卡几天。

**应对**:
- 通知系统:契约/PR 待审超 N 小时 → 钉钉@提醒
- 弱 feature(matrix 标 P2/P3)可配置 auto-approve(经过 Critic 确认 + judgment-log 无 ⚠️ 项时)

### R8:契约 AC 写得不可程序验证

**症状**:Clarifier Critic 通过(AC 含"应该 / 应当"等关键词),但实际 TestGen 写不出对应测试。

**应对**:
- TestGen 节点反向触发 Clarifier:发现 AC 无法转为测试时,生成 fix-task 回到 Clarifier(不是回到 Coder)
- 此为 Saga 跨节点回退的更复杂分支,V1 加

---

## 10. 关键决策点 — 等用户拍板

| # | 决策 | 选项 | 我的推荐 |
|---|------|------|----------|
| Q1 | 产品边界 | 内部工具 / 通用 IDP / 商业产品 | **内部工具**,先验证 |
| Q2 | Critic 独立性 | 全独立 / 关键节点独立 / 共享 | **关键节点(QA)独立** |
| Q3 | Sandbox 形态 | 本地 Docker / 远程 K8s / Devcontainer | **MVP 本地 Docker,V2 加 e2b** |
| Q4 | Test-First or Code-First | TF / CF / 混合 | **混合**:AC → ACTS yaml 骨架,Coder 让骨架通过 |
| Q5 | 多项目接入强制度 | 强约束 / 软适配 / BYO | **强约束**(Convention over Configuration) |
| Q6 | UI 复杂度 | 静态 + CLI / Backstage / 自研 | **MVP 自研,V2 评估 Backstage 集成** |
| Q7 | MVP 范围 | 单项目 / 多项目 | **单项目(mycmdeliverhub)验证** |
| Q8 | 人介入策略 | 严格 2 点 / 可配置 / 全自动 | **MVP 严格 2 点,V2 P3 feature 可 auto-approve** |
| Q9 | 模型组合 | 全 Opus / Mixed / 全 Haiku | **Mixed**:Worker Opus,Critic Haiku |
| Q10 | 命名空间 | 在 HelmCode 仓库内 / 拆新仓库 | **独立 `helmflow` 仓库**(2026-06-03 已拍板,见 §11) |

---

## 11. 仓库与下一步

### 仓库决策(已落地)

| 决策 | 状态 |
|---|---|
| **HelmFlow 独立仓库**(本仓库,`helmflow`) | ✅ 已建:https://github.com/wanlihang/helmflow |
| HelmCode 保留为轻量库,继续维护 standards / skills / CLI | ✅ https://github.com/wanlihang/helmcode |
| 复用方式:MVP 阶段直接复制 standards/references;V1 抽 `@helmcode/standards-*` npm 包 | MVP 已完成 |

### MVP 路径(已开跑)

- **Goal 1**: ✅ `apps/portal/` 矩阵静态渲染(已 commit + push,可 `cd apps/portal && pnpm install && pnpm dev` 在浏览器看)
- **Goal 2**: ⏳ feature 详情页 + 启动需求 mock 对话框
- **Goal 3**: ⏳ 真实 Anthropic Clarifier SSE streaming

详见 [`goal-chain-mvp.md`](./goal-chain-mvp.md)。

### Phase 1 启动(Goal 3 后)

1. `helmflow` 仓库根目录 `pnpm init` + `pnpm-workspace.yaml`(monorepo 化)
2. 创建 `packages/contract-schema`(Zod 全套)
3. `packages/agent-core` 拆 5 角色基础架构(Worker + Critic 独立调用)
4. `apps/cli` 加 `helmflow start <feature-id>` 命令(终端跑通无 web)

> 注意:HelmFlow CLI 命令是 `helmflow xxx`(本仓库),HelmCode CLI 仍是 `helmcode xxx`(标准安装器)。两者职责清晰分离。

**我推荐 A**:协议错了后面全要重写,先把协议跑通在 mycmdeliverhub 上验证,再投入 monorepo 骨架。

---

## 12. 业界参考

学术 & 开源参考:
- **Reflexion** (Shinn et al., NeurIPS 2023) — verbal reflection 自循环
- **Self-Refine** (Madaan et al., 2023) — 同 LLM 自我批评
- **AutoGen** (Microsoft) — Multi-agent conversation,Critic-Worker 模式
- **MetaGPT** — 模拟软件公司 5 角色协作
- **Reflexion + Voyager** 思想合并 — 持续 skill library 累积
- **SWE-Bench / SWE-Bench Verified** — 评测基准
- **OpenDevin / SWE-Agent** — 开源 SWE agent

产品参考:
- **GitHub Copilot Workspace** — 任务级 AI 协作(最接近本方案)
- **Cognition Devin** — 长周期独立 agent
- **Cursor / Windsurf / Cline** — IDE 内 agent 集成
- **Spotify Backstage** — IDP 全景视图范式
- **Vercel AI SDK** — streaming UI / agent API 标准

工程模式参考:
- **Saga / Orchestrator pattern** — 分布式事务回退
- **Critic-Worker / Verifier-driven generation** — 数学证明域成熟模式
- **DAG 工作流引擎**(Argo / Airflow / Dagster) — 阶段编排
- **Convention over Configuration**(Rails / SpringBoot) — 多项目接入哲学
