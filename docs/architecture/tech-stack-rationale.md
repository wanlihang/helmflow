# 技术栈决策矩阵 — Full-Loop Platform

> 核心评判维度:**AI coding 友好度**(LLM 训练数据规模、类型系统对错误的早期捕获能力、错误信息的可定位性、生态成熟度)。
> 性能、运维便利性是次要约束(中台不是计算密集型,瓶颈在 LLM 调用)。

---

## 0. AI coding 友好度评分维度

每项技术按以下 5 个维度打分(1–5,5 最好):

| 维度 | 含义 |
|------|------|
| **D1 训练语料** | LLM 训练时见过的代码量 — 直接决定首次产出准确率 |
| **D2 类型系统** | 错误能否在编译/IDE 阶段就抓到,减少 LLM 修复轮次 |
| **D3 错误可读性** | 报错信息是否人类/LLM 都能读懂、能立刻定位 |
| **D4 生态密度** | 主流任务有无现成 lib,避免 LLM "造轮子幻觉" |
| **D5 一致性** | 同一问题主流写法是否收敛(LLM 风格震荡小) |

---

## 1. 后端语言

| 候选 | D1 | D2 | D3 | D4 | D5 | 总分 | 备注 |
|------|----|----|----|----|----|----:|------|
| **TypeScript (Node.js)** | 5 | 5 | 4 | 5 | 4 | **23** | tsc 错误清晰、Anthropic SDK 官方支持、与 HelmCode 同语言 |
| Python | 5 | 3 | 4 | 5 | 3 | 20 | LangChain/LlamaIndex 最成熟;但 mypy 弱、风格震荡大 |
| Go | 3 | 4 | 5 | 3 | 5 | 20 | 性能好、报错清晰;但 LLM 库少、agent 编排不顺 |
| Rust | 3 | 5 | 4 | 2 | 5 | 19 | 类型最严但 LLM 经常卡 borrow checker;生态不适合 |
| Java | 4 | 5 | 3 | 4 | 4 | 20 | LLM 见多但启动迭代慢,不合 agent 实验性场景 |

### 选 TypeScript (Node.js) 的核心理由

1. **同质性**:HelmCode 当前是 Node.js (`install.mjs` / `bin/helmcode.mjs`),技术栈不分裂
2. **LLM tool calling 协议天然 JSON-friendly**,Node.js 处理 JSON 负担最小
3. **类型签名是 LLM 自我约束的最强工具**:tsc 报错时 LLM 能立刻定位+修复,比 Python 的运行时报错快得多
4. **Vercel AI SDK + Anthropic Node SDK 一线优先级支持**,新模型/新特性 first-day support
5. **异步 I/O 模型与 agent 编排天然契合**:大量 `await` 不会拖死线程池

### 拒绝 Python 的核心理由

虽然 LangChain/LlamaIndex 在 Python 更成熟,但:
- **类型系统弱**:LLM 写 Python 时常出现"参数类型错位"在运行时才暴露,自循环修复成本高
- **风格震荡大**:同一问题 LLM 可能给 5 种写法(decorator vs class vs function),review 难
- **跟 HelmCode 现有 Node.js 生态不统一**,引入跨语言治理成本

### 决策:**TypeScript (Node.js) 20.x LTS**

---

## 2. 前端框架

| 候选 | D1 | D2 | D3 | D4 | D5 | 总分 | 备注 |
|------|----|----|----|----|----|----:|------|
| **Next.js 15 (App Router) + React** | 5 | 5 | 4 | 5 | 4 | **23** | LLM 见过的 React/Next 代码量碾压同行 |
| Remix | 4 | 5 | 4 | 4 | 4 | 21 | 同生态但社区小一档 |
| SvelteKit | 3 | 4 | 4 | 3 | 3 | 17 | 简洁但 LLM 训练数据明显少 |
| Vue 3 + Nuxt | 4 | 4 | 4 | 4 | 3 | 19 | 中文生态强,但 composition API 风格未完全收敛 |
| 纯 HTML + htmx | 2 | 2 | 3 | 2 | 5 | 14 | 简单但表达力不够,矩阵 UI 写不出 |

### 选 Next.js 15 的核心理由

1. **LLM 训练语料密度第一**:任何"用 React 写一个 X" prompt 出错率最低
2. **App Router + React Server Components** 让"获取数据 + 渲染"一段 TS 完成,前后端边界清晰
3. **Vercel AI SDK 与 Next.js 无缝**:streaming UI / `useChat` hook / SSE 内置
4. **shadcn/ui** 把组件复制到代码(不是 npm 依赖),LLM 改起来零障碍
5. **部署灵活**:Vercel / 自托管 / Docker 都行,避免 lock-in

### 决策:**Next.js 15 (App Router) + React 19 + TypeScript**

---

## 3. UI 组件库 / 样式

| 候选 | D1 | D2 | D3 | D4 | D5 | 总分 | 备注 |
|------|----|----|----|----|----|----:|------|
| **Tailwind CSS + shadcn/ui** | 5 | 5 | 5 | 5 | 5 | **25** | LLM 友好度天花板 |
| MUI (Material UI) | 5 | 4 | 3 | 5 | 4 | 21 | 配置复杂,LLM 经常用错 prop |
| Ant Design | 5 | 4 | 3 | 5 | 3 | 20 | 中文生态强但定制麻烦 |
| Chakra UI | 4 | 4 | 4 | 4 | 4 | 20 | v3 切换大,LLM 容易混版本 |

### 选 Tailwind + shadcn/ui 的核心理由

1. **shadcn/ui 是"复制源码而非引入依赖"** —— 组件代码就在你仓库里,LLM 直接改组件无需对照外部 API 文档
2. **Tailwind 类名是 atomic 的**,LLM 读样式 = 读 className 字符串,不需要回溯 CSS 文件
3. **Tailwind 文档对 LLM 友好**:每个 utility 一对一映射 CSS 属性,无歧义
4. **shadcn/ui 已成事实标准**:Vercel/Linear/Resend 等产品都用,LLM 训练时学过

### 决策:**Tailwind CSS 4.x + shadcn/ui**

---

## 4. 数据库 + ORM

| 候选 | D1 | D2 | D3 | D4 | D5 | 总分 | 备注 |
|------|----|----|----|----|----|----:|------|
| **SQLite (better-sqlite3) + Drizzle** | 4 | 5 | 5 | 4 | 5 | **23** | 单文件、零运维、Drizzle TS-first |
| PostgreSQL + Drizzle | 4 | 5 | 5 | 5 | 5 | 24 | 生产级首选 |
| PostgreSQL + Prisma | 5 | 4 | 4 | 5 | 4 | 22 | 流行但 schema 编辑链路长 |
| 文件系统 + git | 3 | 2 | 4 | 2 | 4 | 15 | HelmCode 哲学但表达力受限 |

### 选 SQLite → Postgres 渐进的核心理由

1. **MVP 用 SQLite**:零运维、单 .db 文件、本地启动 1 秒,完美匹配"先验证再扩"
2. **Postgres 用同一 Drizzle schema**:迁移到生产时改连接串即可,代码零修改
3. **Drizzle 是 TS-first ORM**:schema 写在 TS 文件,migration 自动生成,LLM 改 schema 时 IDE 高亮即时反馈
4. **Drizzle 没有运行时代理**(对比 Prisma 有 generate 步骤):LLM 改完 schema 立刻能用,反馈环更快

### 双写策略

```
.claude/orchestration/{F-ID}.yaml   ← git 可见,人类可读,review 时看这里
            ↕ 同步
SQLite/Postgres orchestration 表    ← 程序读写,索引/查询
```

任何状态变更同时写入两端。git 是最终事实源(便于 audit / rollback),数据库是性能层。

### 决策:**SQLite (MVP) → Postgres (生产),Drizzle ORM**

---

## 5. Agent 框架

| 候选 | D1 | D2 | D3 | D4 | D5 | 总分 | 备注 |
|------|----|----|----|----|----|----:|------|
| **Anthropic SDK + 自有 thin wrapper** | 5 | 5 | 5 | 4 | 5 | **24** | 控制力满分,与 HelmCode 现有风格一致 |
| Vercel AI SDK | 5 | 5 | 4 | 5 | 4 | 23 | streaming UI 一流,但 agent 编排抽象偏薄 |
| LangChain.js | 4 | 3 | 3 | 5 | 2 | 17 | 抽象太重,bug 修复困难 |
| Mastra | 3 | 4 | 4 | 3 | 3 | 17 | 新兴,生态未稳 |
| AutoGen (TS port) | 3 | 4 | 3 | 3 | 3 | 16 | Python 主导,TS 实现弱 |

### 选 "Anthropic SDK + 自有 wrapper" 的核心理由

1. **HelmCode 当前 install.mjs 已是这种风格**:不依赖 LangChain 这种重抽象,prompt + tools + 结构化输出全自己掌控
2. **Anthropic SDK 跟随 Claude 模型 first-day** 更新,无中间层延迟
3. **自有 wrapper 体积小**(预计 <500 行 TS),LLM 改起来无心智负担
4. **streaming**:用 Vercel AI SDK 的 `streamText` 做前端展示层,后端 agent 调用直接 Anthropic SDK,各取所长

### 拒绝 LangChain.js 的核心理由

抽象层级太多(Chains / Runnables / Memory / Agents / Tools),LLM 很难记全各层 API,产出的代码经常误用导致难调试。社区里"LangChain 反思"文章已多。**HelmCode 走 anti-framework 路线已被验证。**

### 决策:**直接用 `@anthropic-ai/sdk`,自有 thin agent wrapper(`packages/agent-core/`)**

---

## 6. 实时通信(后端 → 前端 streaming)

| 候选 | D1 | D2 | D3 | D4 | D5 | 总分 | 备注 |
|------|----|----|----|----|----|----:|------|
| **Server-Sent Events (SSE)** | 5 | 5 | 5 | 5 | 5 | **25** | agent 单向流式输出最适合 |
| WebSocket | 5 | 4 | 4 | 5 | 4 | 22 | 双向但 Next.js App Router 不原生支持 |
| Long polling | 4 | 4 | 4 | 4 | 3 | 19 | 老派,体验差 |

### 选 SSE 的核心理由

1. **Agent 输出是单向流**(token 流 + 状态更新),SSE 完美匹配
2. **Vercel AI SDK 默认 SSE**,前端 `useChat` 直接消费
3. **HTTP/2 自动多路复用**,无需额外协议握手
4. **比 WebSocket 简单一个数量级**,LLM 写起来不易出 bug

### 决策:**SSE + Vercel AI SDK 前端集成**

---

## 7. 任务队列 / 调度

| 候选 | D1 | D2 | D3 | D4 | D5 | 总分 | 备注 |
|------|----|----|----|----|----|----:|------|
| **graphile-worker (Postgres-based)** | 3 | 5 | 5 | 4 | 5 | **22** | 零额外组件,跟 DB 共用 |
| BullMQ + Redis | 5 | 4 | 4 | 5 | 4 | 22 | 主流但要多一个 Redis |
| Inngest (SaaS / self-host) | 3 | 4 | 4 | 4 | 4 | 19 | 一切就绪但供应商锁定 |
| 朴素 setTimeout | 3 | 3 | 4 | 3 | 5 | 18 | MVP 够用 |

### 选 setTimeout (MVP) → graphile-worker (V1) 的核心理由

1. **MVP 阶段 agent 调用是逐个串行的**,setTimeout / Promise queue 完全够用,不引入额外组件
2. **V1 升级 graphile-worker**:用 Postgres 的 `LISTEN/NOTIFY` 跑队列,**零新组件**(不引入 Redis)
3. **HelmCode 用户多数本地起项目**,新增 Redis 依赖会劝退一半人

### 决策:**MVP setTimeout → V1 graphile-worker on Postgres**

---

## 8. Sandbox 执行环境

| 候选 | D1 | D2 | D3 | D4 | D5 | 总分 | 备注 |
|------|----|----|----|----|----|----:|------|
| **Docker (dockerode for Node) + git worktree** | 4 | 4 | 4 | 5 | 4 | **21** | 主流,本地可跑 |
| Devcontainer CLI | 3 | 4 | 4 | 4 | 4 | 19 | VS Code 标准但调用链长 |
| e2b.dev (云沙箱 SDK) | 3 | 4 | 4 | 4 | 4 | 19 | 生产级但 SaaS lock-in |
| Firecracker (microVM) | 2 | 3 | 3 | 2 | 3 | 13 | 太复杂,MVP 不考虑 |
| 本地直跑(无隔离) | 5 | 3 | 4 | 5 | 5 | 22 | 危险,生产不可用 |

### 选 Docker + git worktree 的核心理由

1. **dockerode** 是 Node 调 Docker 的事实标准
2. **git worktree** 让每个 feature 独立目录、不冲突,且 `git status`/`git log` 完整保留
3. **本地起 Docker daemon** 几乎所有开发者都有,生产环境换成 K8s pod 即可
4. **预热 sandbox + 缓存层(.m2 / node_modules)** 是关键工程细节,后续单独优化

### 决策:**MVP Docker + git worktree;V2 增加 e2b.dev 适配器**

---

## 9. Monorepo 工具

| 候选 | D1 | D2 | D3 | D4 | D5 | 总分 | 备注 |
|------|----|----|----|----|----|----:|------|
| **pnpm workspace + Turbo** | 5 | 5 | 5 | 5 | 5 | **25** | 主流 + 增量构建快 |
| Nx | 4 | 5 | 4 | 5 | 3 | 21 | 重,LLM 经常被生成器迷惑 |
| Bun workspace | 3 | 4 | 4 | 3 | 3 | 17 | 太新,生态未稳 |
| Lerna | 4 | 3 | 3 | 3 | 3 | 16 | 老派,不推荐 |

### 决策:**pnpm 9.x + Turbo 2.x**

---

## 10. 测试框架

| 候选 | D1 | D2 | D3 | D4 | D5 | 总分 | 备注 |
|------|----|----|----|----|----|----:|------|
| **Vitest** | 5 | 5 | 5 | 5 | 5 | **25** | TS-first,jest API 兼容 |
| Jest | 5 | 4 | 4 | 5 | 4 | 22 | 经典但 ESM 麻烦 |
| Playwright (E2E) | 5 | 5 | 5 | 5 | 5 | **25** | 浏览器 E2E 唯一选择 |

### 决策:**Vitest(单测/集成)+ Playwright(E2E)**

---

## 11. Linter / Formatter

| 候选 | D1 | D2 | D3 | D4 | D5 | 总分 | 备注 |
|------|----|----|----|----|----|----:|------|
| **Biome** | 4 | 5 | 5 | 4 | 5 | **23** | Rust 写的 lint+format,极快 |
| ESLint + Prettier | 5 | 4 | 4 | 5 | 3 | 21 | 主流但配置复杂 |

### 决策:**Biome**(eslint+prettier 一站搞定,快 10×,LLM 改起来无配置心智)

---

## 12. 部署形态

| 候选 | D1 | D2 | D3 | D4 | D5 | 总分 | 备注 |
|------|----|----|----|----|----|----:|------|
| **Self-host Docker Compose** | 4 | 4 | 5 | 4 | 5 | **22** | 团队内部部署,不依赖外部 SaaS |
| Vercel | 5 | 5 | 5 | 5 | 4 | 24 | 但 sandbox 跑不动(无 Docker-in-serverless) |
| Cloudflare Workers | 3 | 4 | 4 | 4 | 4 | 19 | 同上限制 |

### 决策:**MVP Docker Compose 单机自托管;sandbox 跑在同主机或独立 worker 节点**

后续可拆出 frontend 部署到 Vercel(纯静态 + RSC),sandbox/orchestrator 留在自托管。

---

## 13. 总览技术栈

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend (apps/portal)                                       │
│   Next.js 15 App Router + React 19 + TypeScript              │
│   Tailwind 4 + shadcn/ui                                     │
│   Vercel AI SDK (SSE + useChat)                              │
├──────────────────────────────────────────────────────────────┤
│ Backend API (apps/orchestrator)                              │
│   Next.js Route Handlers (复用同一 Next 进程)                 │
│   或独立 Hono server(packages/api),依需求                    │
├──────────────────────────────────────────────────────────────┤
│ Agent Core (packages/agent-core)                             │
│   @anthropic-ai/sdk + 自有 thin wrapper                      │
│   每节点 Worker + Critic 模式                                 │
├──────────────────────────────────────────────────────────────┤
│ Storage                                                       │
│   Drizzle ORM                                                │
│   SQLite (dev / MVP) → PostgreSQL (生产)                      │
│   双写 .claude/orchestration/{F-ID}.yaml                     │
├──────────────────────────────────────────────────────────────┤
│ Queue                                                         │
│   MVP: in-process Promise queue                              │
│   V1: graphile-worker on Postgres                            │
├──────────────────────────────────────────────────────────────┤
│ Sandbox                                                       │
│   dockerode + git worktree                                    │
│   预热镜像 + 共享 .m2/node_modules cache layer                │
├──────────────────────────────────────────────────────────────┤
│ Monorepo: pnpm 9 + Turbo 2                                   │
│ Test: Vitest + Playwright                                    │
│ Lint/Format: Biome                                           │
│ Deploy: Docker Compose (self-host)                           │
└──────────────────────────────────────────────────────────────┘
```

---

## 14. 拒绝清单(明确不用什么)

| 拒绝 | 原因 |
|------|------|
| LangChain.js | 抽象太重,LLM 改起来困难 |
| Prisma | generate 步骤打断反馈环 |
| ESLint + Prettier 双工具 | Biome 已合并,配置复杂度减半 |
| Redis(MVP) | 引入额外组件不值,Postgres 已够 |
| K8s(MVP) | 单机 Docker Compose 足够 |
| Webpack(自定义) | Next.js / Turbo 已封装,无需手配 |
| 任何 alpha/beta 框架 | LLM 训练数据少,产出错误率高 |
| GraphQL | REST + 类型化 client(如 tRPC)更适合 LLM 写 |

---

## 15. 关键决策回顾

| # | 决策 | 选择 | 主因 |
|---|------|------|------|
| 1 | 后端语言 | TypeScript | 与 HelmCode 同语言 + 类型系统 + LLM 训练数据 |
| 2 | 前端 | Next.js 15 + React 19 | LLM 训练语料密度第一 |
| 3 | UI | Tailwind + shadcn/ui | 组件源码在仓库内,LLM 直接改 |
| 4 | DB | SQLite → Postgres + Drizzle | 渐进 + TS-first ORM |
| 5 | Agent | Anthropic SDK + thin wrapper | anti-framework |
| 6 | 通信 | SSE | agent 单向流最优解 |
| 7 | 队列 | setTimeout → graphile-worker | 不引 Redis |
| 8 | Sandbox | Docker + git worktree | 主流 + 本地可跑 |
| 9 | Monorepo | pnpm + Turbo | 主流 + 快 |
| 10 | Test | Vitest + Playwright | TS-first + 主流 |
| 11 | Lint | Biome | 一站式,快 |
| 12 | Deploy | Docker Compose | 自托管 |

---

> 决策依据每 6 个月重审一次。新增/废弃组件需更新本文档。
