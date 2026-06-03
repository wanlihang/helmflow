# Architecture Docs — Full-Loop AI Coding Platform

> HelmCode 的下一阶段:从"单 feature 闭环"升级为"全流程多 agent 自循环 IDP"。
> 本目录是该升级的完整方案基线,代码动手前请先读完。

---

## 文档地图

| 文档 | 内容 | 适合谁先读 |
|------|------|----------|
| [full-loop-platform.md](./full-loop-platform.md) | **总体方案** — 设计目标 / 5 层架构 / 数据模型 / API / 路线图 / 风险 / 决策点 | 所有人 |
| [tech-stack-rationale.md](./tech-stack-rationale.md) | **技术栈决策** — 每项技术对比候选 + 选择理由 + 拒绝理由 + AI coding 友好度评分 | 工程师 |
| [repo-structure.md](./repo-structure.md) | **monorepo 布局** — pnpm workspace 拆 packages/apps,职责与依赖关系 | 工程师 / 架构师 |
| [agent-protocol.md](./agent-protocol.md) | **Agent 节点协议** — 5 节点输入/输出/证据/Worker-Critic/跨节点回退 schema | Agent 开发者 |

---

## 核心决策一句话总结

| 维度 | 选择 |
|------|------|
| 后端语言 | TypeScript (Node.js 20 LTS) |
| 前端 | Next.js 15 App Router + React 19 + Tailwind 4 + shadcn/ui |
| 数据库 | SQLite (MVP) → PostgreSQL (生产),Drizzle ORM |
| Agent 框架 | `@anthropic-ai/sdk` + 自有 thin wrapper(anti-framework) |
| 通信 | Server-Sent Events (SSE) + Vercel AI SDK |
| Sandbox | Docker (dockerode) + git worktree |
| Monorepo | pnpm 9 + Turbo 2 |
| 测试/Lint | Vitest + Playwright + Biome |
| 部署 | Docker Compose 自托管 |

---

## 设计 5 层架构一图概览

```
┌──────────────────────────────────────────────────────────┐
│ L4 Portal       Next.js 全景矩阵 + 单 feature 钻取        │
├──────────────────────────────────────────────────────────┤
│ L3 Orchestrator DAG 状态机 + Saga 回退 + SSE              │
├──────────────────────────────────────────────────────────┤
│ L2 Agent Core   5 节点 × Worker+Critic + Reflection      │
├──────────────────────────────────────────────────────────┤
│ L1 Adapter      java-ddd / node-express / ... 项目适配器  │
├──────────────────────────────────────────────────────────┤
│ L0 Sandbox      Docker + git worktree 隔离执行           │
└──────────────────────────────────────────────────────────┘
```

---

## 5 节点闭环一图概览

```
[人] 输入需求
   ↓
Clarifier (W+C) → ★人审契约★ → Coder (W+C) → TestGen (W+C) → QA (W+C)
                                      ▲                          │
                                      │ fix-task.yaml(回退)        │ all pass
                                      └──────────────────────────┘
                                                                   ↓
                                                              Committer (W+C)
                                                                   ↓
                                                              ★人审 PR★
                                                                   ↓
                                                                  done
```

- **Worker (W)**:产出代码/契约/测试
- **Critic (C)**:独立 LLM 调用,基于"机器可校验信号"判定
- **节点内自循环**:5 轮上限
- **跨节点回退**:Coder ↔ QA 8 轮上限
- **人介入**:严格 2 点(契约审 / PR 审)

---

## 实施路线

| Phase | 周期 | 关键产出 |
|-------|------|---------|
| **0 协议层** | 1-2 周 | 4 文档(本目录)+ feature-matrix.yaml + helmcode.yaml |
| **1 Agent Core** | 3 周 | packages/* + apps/cli MVP,终端跑通 5 节点闭环 |
| **2 跨节点循环** | 4 周 | Orchestrator + fix-task + Reflection 完整工作 |
| **3 Sandbox+多项目** | 4 周 | Docker sandbox + 第二个项目类型(node-express) |
| **4 Portal** | 4 周 | Next.js 全景 UI + 启动需求 + 审契约/PR 流程 |
| **5 学习+生产化** | 4 周(可选) | Postgres / e2b / 钉钉飞书 webhook / Backstage 集成 |

---

## 与 HelmCode 的关系

**独立仓库**(本仓库 `helmflow`):HelmFlow 不与 HelmCode 同仓共建。理由:
- HelmCode = 轻量"标准+模板+skill 安装器"(< 5MB,CLI 为主)
- HelmFlow = 中台 web + agent + sandbox(几百 MB 依赖,生产服务为主)
- 目标用户/技术栈/发版节奏均不同(同 vite/vitest、nest/nest-devtools 业界惯例)

**复用 HelmCode 资产**:
- MVP 阶段 `standards/` `references/` 直接复制(冗余但简单)
- V1 抽 npm 包 `@helmcode/standards-java-ddd`,两边 import 同一份
- HelmCode `core/{clarify,implement,verify,...}` skill 的 prompt 抽到本仓 `packages/agent-core/prompts/`

HelmCode 继续按"轻量库"维护;HelmFlow 在上层叠加平台能力,各自独立发版。

---

## 待用户拍板的决策点(摘自 full-loop-platform.md §10)

| # | 决策 | 推荐 |
|---|------|------|
| Q1 | 产品边界 | 内部工具(先验证) |
| Q2 | Critic 独立性 | 关键节点(QA)独立 |
| Q3 | Sandbox | MVP Docker / V2 加 e2b |
| Q4 | Test-First / Code-First | 混合 |
| Q5 | 多项目接入约束度 | 强约束(Convention over Configuration) |
| Q6 | UI 复杂度 | MVP 自研 / V2 评估 Backstage |
| Q7 | MVP 范围 | 单项目(mycmdeliverhub) |
| Q8 | 人介入策略 | MVP 严格 2 点 / V2 弱 feature auto-approve |
| Q9 | 模型组合 | Worker Opus + Critic Haiku |
| Q10 | 命名空间 | **独立 `helmflow` 仓库**(已定,2026-06-03 拍板) |

---

## 反馈渠道

方案有任何不准确 / 设计漏洞 / 你想调整的方向,直接在仓库 issue 提,或通过 PR 改文档。
**协议层(本目录 4 文档)是后续所有代码的依据,审完再写代码。**
