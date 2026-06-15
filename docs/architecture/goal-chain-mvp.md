# Goal Chain MVP — Claude Code `/goal` 输入指南

> 用 `/goal` 命令驱动 Claude Code 自主跑通 Full-Loop Platform 中台 MVP。
> 本文档每条 `/goal` 的 prompt 都是**精确文本,可直接复制粘贴**到 Claude Code。
> 不需要再做任何修改。

---

## 目录

- [1. MVP 范围与不做的事](#1-mvp-范围与不做的事)
- [2. 为什么不能用一条 /goal](#2-为什么不能用一条-goal)
- [3. 前置准备](#3-前置准备)
- [4. 关于已就位的 8 个配置文件](#4-关于已就位的-8-个配置文件)
- [5. Goal 1 — 矩阵静态渲染(浏览器看到 5 域 40 功能点)](#5-goal-1--矩阵静态渲染浏览器看到-5-域-40-功能点)
- [6. Goal 2 — 详情页 + 启动需求 Mock 对话框](#6-goal-2--详情页--启动需求-mock-对话框)
- [7. Goal 3 — 真实 Anthropic Clarifier 接通](#7-goal-3--真实-anthropic-clarifier-接通)
- [8. Goal 4 — monorepo 转换 + 持久化层 + Clarifier 真状态流转](#8-goal-4--monorepo-转换--持久化层--clarifier-真状态流转)
- [9. Goal 5 — Clarifier Critic + 契约审批流](#9-goal-5--clarifier-critic--契约审批流)
- [10. Goal 6 — sample-java 引入 + adapter-core + Coder Worker(MVP 直连)](#10-goal-6--sample-java-引入--adapter-core--coder-worker-mvp-直连)
- [11. ⚠️ G7 重设计公告:从「直连大模型」转向「Claude Code Agent SDK」](#11-️-g7-重设计公告从直连大模型转向claude-code-agent-sdk)
- [12. Goal 7(新) — 依赖倒置:HelmFlow ⊥ Claude Agent SDK + Clarifier 顺手回炉](#12-goal-7新--依赖倒置helmflow--claude-agent-sdk--clarifier-顺手回炉)
- [13. Goal 8 — TestGen 节点(SKILL 形态)](#13-goal-8--testgen-节点skill-形态)
- [14. Goal 9 — QA + Committer(合并节点)](#14-goal-9--qa--committer合并节点)
- [15. Goal 10 — Orchestrator + 跨节点 fix-task 自循环(Full-Loop MVP 完成线)](#15-goal-10--orchestrator--跨节点-fix-task-自循环full-loop-mvp-完成线)
- [16. Goal 11 — git worktree 隔离 + 多 feature 并发(产品化)](#16-goal-11--git-worktree-隔离--多-feature-并发产品化)
- [17. Goal 12 — 多项目接入(helmcode.yaml manifest)](#17-goal-12--多项目接入helmcodeyaml-manifest)
- [18. 跑 goal 的注意事项](#18-跑-goal-的注意事项)
- [19. 失败回退总策略](#19-失败回退总策略)
- [20. token / 时间预算](#20-token--时间预算)
- [21. 跑完 12 条 goal 之后](#21-跑完-12-条-goal-之后)
- [附:每条 goal 文件清单速查](#附每条-goal-文件清单速查)

---

## 1. MVP 范围与不做的事

> **MVP 全景(修订版,选项 B)**:G1-G3 是 Portal MVP(看得见 + 能澄清需求);G4-G6 引入
> 持久化 + Clarifier 闭环 + Coder MVP(直连大模型);**G7 是架构跃迁** — Portal 不再
> 直连 Anthropic SDK,改为通过 `@anthropic-ai/claude-agent-sdk` 调用 Claude Code 作
> 执行底座,**同时把 Clarifier 一并迁过来**;G8-G10 在新底座上补 TestGen / QA+Committer /
> Orchestrator,形成 Full-Loop MVP 完成线;G11-G12 是产品化(worktree 隔离 / 多项目)。
> 全 chain 12 条 goal(原 9 条 + 不可避免的 1 个架构跃迁 + 2 个产品化)。

### Portal MVP 必须有(G1-G3 已覆盖)

- ✅ 浏览器打开 `http://localhost:3000` 看到 mycmdeliverhub 的全景矩阵
- ✅ 5 域 × 40 功能点的卡片网格,每个卡片有状态色徽标
- ✅ 点击卡片进入 feature 详情页(契约元数据、AC、legacy/target 映射)
- ✅ "启动需求"按钮 + 对话框输入需求
- ✅ 模拟的 Clarifier 输出(Goal 2 是 mock,Goal 3 接真 Anthropic API)
- ✅ 内置 mycmdeliverhub 的 5 域 40 功能点完整矩阵数据(`feature-matrix.yaml`)

### Full-Loop MVP 增量(G4-G10)

- ✅ monorepo 重构(pnpm workspace + `packages/*`)— G4
- ✅ Drizzle SQLite 持久化 + feature/contract/run 状态流转 — G4
- ✅ Clarifier Critic(可执行 check + 契约草稿/审批)— G5
- ✅ `apps/sandbox-java` 极简 SOFABoot 目标项目 — G6
- ✅ Coder Worker MVP(直连大模型版,G6 完成验证 5 节点中第一节可行)
- ⏳ **依赖倒置:Portal ⊥ Claude Code Agent SDK + Clarifier 顺手回炉(G7)**
- ⏳ TestGen 节点(G8)
- ⏳ QA + Committer 节点(合并,G9)
- ⏳ Orchestrator + 跨节点 fix-task 自循环 + Reflection log(G10)

### 产品化(G11-G12,Full-Loop MVP 之后)

- ⏳ git worktree 隔离 + 多 feature 并发(G11)
- ⏳ 多项目接入(`helmcode.yaml` manifest,G12)

### 不做(留给 Phase 2+,见 `full-loop-platform.md`)

- ❌ Docker sandbox(G6-G10 直接用本地 mvn + 主 working tree,worktree 在 G11)
- ❌ 完整 fix-task yaml schema(简化为字符串 reflection 喂下游 worker)
- ❌ PR 自动创建(G9 Committer 只本地 commit,不 push)
- ❌ ArchUnit / BootContextSmokeTest 集成(只 compile + 普通 JUnit)
- ❌ 多项目接入(目前 helmcode.yaml 概念入文档不入代码)
- ❌ 认证 / 多用户 / 权限 / Postgres / Docker Compose 部署

> 划清边界是为了让每条 /goal 都能在单 turn 内写完 + 有明确通过信号。
> 写完 MVP 看到效果再决定要不要做后续 Phase。

---

## 2. 为什么不能用一条 /goal

`/goal` 由 Haiku 评估器只看**会话内容文本匹配**判定是否达成。一条 /goal 涵盖整个 MVP 会有 4 个致命问题:

1. **代码量 ~1500-2000 行,单 turn 写不完** — Worker 写一半就断,Haiku 看不到完整通过信号 → 卡 8 连续 block
2. **多个独立通过信号无法统一文本匹配** — Haiku 看到 "BUILD SUCCESS" 不代表浏览器能打开
3. **依赖链有顺序** — 矩阵 yaml 必须先于页面渲染,否则浏览器报错
4. **失败传染** — Goal 2 的 mock 对话框失败会拖累 Goal 1 已跑通的部分

**拆 3 条 /goal**,每条单 turn 内可闭环 + 通过信号清晰唯一。

---

## 3. 前置准备

### 系统环境

```bash
node --version          # >= 20.0.0
pnpm --version          # >= 9.0.0  (没装就 npm i -g pnpm)

# G6 之后还需要(Coder 写 Java + mvn 编译/测试):
java -version           # >= 21
mvn --version           # >= 3.9
```

如果没装 pnpm:`npm install -g pnpm` —— 这个由你手动跑,不要让 /goal 内自己装。
Java 21 + Maven 也是同理,系统级安装由你手动完成。

### Anthropic API Key(G3 起每个 Goal 都需要)

```bash
# 在 apps/portal/.env.local 写入:
HELMFLOW_ANTHROPIC_API_KEY=sk-ant-...
# 可选:指向兼容代理(如智谱 bigmodel)
HELMFLOW_ANTHROPIC_BASE_URL=https://api.anthropic.com
# 可选:覆盖默认模型(默认 claude-opus-4-7)
CLARIFIER_MODEL=claude-opus-4-7
```

`.env.local` 已被 `.gitignore` 屏蔽,不会入仓。
**注意**:必须用 `HELMFLOW_` 前缀,因为 Next.js `.env.local` 不覆盖 shell 继承的 env;
如果你 shell 里有 Claude Code 注入的 `ANTHROPIC_BASE_URL`(指向本地代理),
不加前缀会让 SDK 打错路径。详见 `apps/portal/README.md`。

### 打开 Claude Code

在 helmflow 仓库根目录打开 Claude Code。每条 /goal 都在这个 session 里跑。

---

## 4. 关于已就位的 8 个配置文件

`apps/portal/` 下已有 8 个配置文件(我之前误动手时建的,但内容正确,直接复用):

```
apps/portal/
├── package.json          # Next 15.1.6 / React 19 / Tailwind 3.4 / Anthropic SDK 等版本锁定
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts    # 含 status 色域(notStarted / clarifying / done 等)
├── postcss.config.mjs
├── biome.json
├── .gitignore
└── app/globals.css       # @tailwind base/components/utilities
```

**Goal 1 之前你的选择**:

- **(A) 保留**(推荐):Goal 1 直接基于这 8 个文件继续写内容,跑得更快
- **(B) 清空**:`rm -rf apps/portal && git add -A && git commit -m "chore: clean before goal-1"`,然后让 /goal 从零搭建

如果选 A,Goal 1 的 prompt 已写明"已存在的配置文件不要动";如果选 B,把 Goal 1 prompt 第一条调整为"先初始化 8 个配置文件"。

---

## 5. Goal 1 — 矩阵静态渲染(浏览器看到 5 域 40 功能点)

### 5.1 复制粘贴到 Claude Code 的完整文本

> **本 prompt 实测 ~3500 字符,远低于 /goal 4000 上限。** 直接复制下面代码块完整内容粘贴到 Claude Code 即可。

```
/goal apps/portal/ 下完成 MVP 第 1 步:全景矩阵静态渲染。前置:apps/portal/ 下已有 8 个配置(package.json/tsconfig/next.config.mjs/tailwind.config.ts/postcss.config.mjs/biome.json/.gitignore/app/globals.css,已 commit,不要动)。

【生成 11 个文件】
1. data/feature-matrix.yaml — mycmdeliverhub 5 域 40 功能点完整 yaml。Schema:
   project: mycmdeliverhub
   domains: [{id, name, features: [{id, name, legacy: {flowCode, activities: []}, target: {handler, actions: [], context}, priority, status}]}]
   5 域 ID 与数量:deliver(D-01~D-10,10) / mapping(P-01~P-07,7) / pricing(PR-01~PR-18,18) / signing(S-01~S-03,3) / ops(O-01~O-02,2)。priority 取 P0/P1/P2,status 全部 "not-started"。无 legacy/target 信息的写空数组/空字符串。
   首条完整示例:
     - id: D-01
       name: 创建交付需求
       legacy:
         flowCode: PIPELINE_SAVE_DELIVER_RECORD
         activities: [SaveDeliverRecordActivity, CreateSopFlowInstanceActivity, CreateDeliverTaskActivity, SyncDeliverRecordToMultiTableActivity, PushFlowNodeInstanceActivity]
       target:
         handler: SaveDeliverRecordHandler
         actions: [SaveDeliverRecordAction, CreateFlowInstanceAction, CreateDeliverTaskAction, SyncMultiTableAction, PushFlowNodeAction]
         context: deliver
       priority: P0
       status: not-started
2. lib/matrix.ts — fs.readFileSync + yaml.parse 同步加载;export interface FeatureMatrix/Domain/Feature + 函数 loadMatrix()/getFeature(id: string)。
3. lib/utils.ts — cn(...inputs) 用 clsx + tailwind-merge。
4. components/ui/badge.tsx — shadcn 风格,variant: default/secondary/outline + 7 status 变体(用 tailwind.config 已定义 status.{notStarted,clarifying,pendingGoal,implementing,done,blocked,abandoned} 着色)。
5. components/ui/card.tsx — Card/CardHeader/CardTitle/CardDescription/CardContent/CardFooter,纯 div + Tailwind。
6. components/feature-card.tsx — props: feature。渲染 id + name + status badge + priority badge,整张包 <Link href={`/features/${feature.id}`}>。
7. components/domain-section.tsx — props: domain。渲染 domain.name 大标题 + grid (grid-cols-1 md:grid-cols-2 lg:grid-cols-3) 装该域所有 feature-card。
8. app/layout.tsx — root layout,引入 globals.css,html lang="zh-CN",顶部导航栏文字 "HelmCode Portal | mycmdeliverhub"。
9. app/page.tsx — server component 调 loadMatrix(),展示项目名 + "5 域 40 功能点"统计 + 7 status 颜色图例,然后逐个渲染 domain-section。
10. next-env.d.ts — 固定 Next.js 3 行 reference。
11. README.md — "cd apps/portal && pnpm install && pnpm dev"。

【约束】
- 严格 TypeScript strict,禁 any
- 颜色统一用 tailwind.config.ts 的 status.* token,禁自创色值
- 禁装额外 npm 包(已有的足够)
- 禁 API route/Anthropic/DB/dialog(Goal 2/3 的事)

【通过信号】
1. cd apps/portal && pnpm install 输出含 "Done in" 或 "added"
2. cd apps/portal && pnpm typecheck 0 error
3. cd apps/portal && node -e "const fs=require('fs');const m=require('yaml');const d=m.parse(fs.readFileSync('data/feature-matrix.yaml','utf-8'));console.log('DC='+d.domains.length+';FC='+d.domains.reduce((s,x)=>s+x.features.length,0))" 输出含 DC=5 和 FC=40
4. cd apps/portal && timeout 25 pnpm dev 输出含 "Ready in" 或 "compiled successfully"
5. 起 dev 后 curl -s http://localhost:3000 输出含 mycmdeliverhub,且 grep -c 'D-01\|PR-01\|S-01' 输出 ≥ 3
6. 11 个文件全部存在

完成后输出"Goal 1 验收清单"逐条勾选。
```

### 5.2 Goal 1 通过信号(Haiku 评估器看的字符串)

让 Haiku 在会话中能看到的明确文本:

```
✅ pnpm install: "Done in Xs" 或 "added N packages"
✅ pnpm typecheck: "Found 0 errors" 或无 error 输出
✅ node yaml validation: "DOMAIN_COUNT=5" 和 "FEATURE_COUNT=40"
✅ pnpm dev: "Ready in" 或 "compiled successfully"
✅ curl localhost:3000: 包含 mycmdeliverhub + feature 卡片 ≥ 40
```

### 5.3 Goal 1 跑完后人工验证(浏览器)

```bash
cd apps/portal
pnpm dev
# 浏览器打开 http://localhost:3000
# 应看到:
#   - 顶部导航 "HelmCode Portal | mycmdeliverhub"
#   - 项目信息卡片 "5 域 40 功能点"
#   - 7 个状态色图例
#   - 5 个 domain section,每个 section 内 feature 卡片 grid
#   - 每个 feature 卡片显示 ID + 名称 + 灰色 not-started badge
```

如果浏览器看到的与上述不符,**Goal 1 没真通过**(尽管 Haiku 可能误判),手动 escalate。

### 5.4 Goal 1 失败回退

| 现象 | 原因 | 处理 |
|------|------|------|
| pnpm install 卡住 | 网络问题或 npm registry 故障 | 切 npmmirror:`pnpm config set registry https://registry.npmmirror.com` 后重跑 |
| Tailwind 样式不生效 | postcss.config.mjs 写错 | 删 `apps/portal/.next/`,重启 dev server |
| yaml 解析报错 | yaml 缩进/中文字符问题 | 检查 yaml 是否含 tab(必须空格)、特殊字符是否引号包裹 |
| typecheck 报错 path alias | tsconfig.json 的 `@/*` paths 没生效 | 看是不是有相对 import 越界 |
| 页面 500 错误 | Server Component 用了客户端 API | 给文件顶加 `'use client'` 或改回 fs 同步读 |

---

## 6. Goal 2 — 详情页 + 启动需求 Mock 对话框

> 前置:Goal 1 已 commit。

### 6.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 Goal 1 基础上完成 Full-Loop Platform MVP 第 2 步:feature 详情页 +
启动需求 mock 对话框。前置:apps/portal/data/feature-matrix.yaml 与 lib/matrix.ts
已就位(Goal 1 commit)。

【范围】
1. 创建 apps/portal/components/ui/button.tsx:shadcn 风格 Button,支持
   variant: default / secondary / outline / ghost / destructive,size: default / sm / lg。
2. 创建 apps/portal/components/ui/dialog.tsx:基于 @radix-ui/react-dialog 封装
   shadcn 风格 Dialog,导出 Dialog / DialogTrigger / DialogContent / DialogHeader /
   DialogTitle / DialogDescription / DialogFooter / DialogClose。
3. 创建 apps/portal/components/ui/textarea.tsx:简单 textarea 组件,Tailwind 样式。
4. 创建 apps/portal/components/start-feature-dialog.tsx:'use client' 客户端组件,
   接收 feature prop,内部 useState 管理:
   - open / setOpen
   - userRequest(textarea 输入)
   - clarifying(boolean)
   - clarifierOutput(string,逐字累加)
   按钮文字"启动需求",点开 Dialog,Dialog 内有 textarea + "运行 Clarifier(Mock)" 按钮。
   点 Mock 按钮:setClarifying(true),启动一个 100ms 间隔逐字累加的定时器,
   把以下 mock markdown 文本逐字 append 到 clarifierOutput:

   # F-{featureId}: {featureName}

   ## Problem Definition
   (基于用户输入"{userRequest}"的占位符问题定义。真实 Clarifier 在 Goal 3 接通。)

   ## State Machine
   INIT → IN_PROGRESS → DONE

   ## Business Rules
   - BR-001: 校验前置状态符合
   - BR-002: 操作幂等

   ## Acceptance Criteria
   - AC-001: 调用 createX 后 status 转为 IN_PROGRESS
   - AC-002: 重复调用不产生副作用

   ## API Contract
   | Method | Request | Response |
   | ------ | ------- | -------- |
   | startX | StartXCommand | Result<Long> |

   累加完毕后 setClarifying(false)。Dialog 中实时展示 clarifierOutput
   (用 <pre className="whitespace-pre-wrap"> 渲染)。
   关闭 Dialog 时清空 state。
5. 创建 apps/portal/components/json-block.tsx:简单组件,接收 data 参数,
   <pre className="text-xs bg-muted p-3 rounded-md overflow-auto"> 包 JSON.stringify(data, null, 2)。
6. 创建 apps/portal/app/features/[id]/page.tsx:server component,
   通过 params.id 调 lib/matrix.ts 的 getFeature(id),如果没找到返回 notFound()。
   页面布局:
   - 顶部面包屑:Home / {domainName} / {feature.id}
   - 主标题:{feature.id} {feature.name}
   - status badge + priority badge
   - 两栏(grid-cols-1 lg:grid-cols-2):
     - 左栏:Legacy 信息(flowCode + activities 列表),用 json-block
     - 右栏:Target 信息(handler + actions + context),用 json-block
   - 底部 <StartFeatureDialog feature={feature} />
7. 创建 apps/portal/app/features/[id]/not-found.tsx:简单 404 页面,
   说明 "Feature not found" + 返回首页链接。

【约束】
- 不要接 Anthropic 真 API(那是 Goal 3)
- 不要做持久化(每次刷新页面 dialog state 重置即可)
- 不要修改 Goal 1 已有的 feature-card / domain-section / page.tsx
- mock 输出必须用 setInterval 逐字累加,模拟 streaming 效果(让用户看到打字动画)
- Dialog 必须用 @radix-ui/react-dialog(已在 package.json),不要自己撸
- 严格 TypeScript,不允许 any

【通过信号】
1. pnpm typecheck 0 error
2. pnpm dev 起来后,curl http://localhost:3000/features/D-01 返回 200 + html
   含 "D-01" 和 "SaveDeliverRecordHandler"
3. curl http://localhost:3000/features/PR-09 返回 200 + html 含 "PR-09" 和
   "PriceApplyAction"(从 yaml 数据)
4. curl http://localhost:3000/features/INVALID-XXX 返回 404
5. 文件存在性:components/ui/button.tsx / dialog.tsx / textarea.tsx /
   start-feature-dialog.tsx / json-block.tsx /
   app/features/[id]/page.tsx / app/features/[id]/not-found.tsx 全部存在

完成后输出"Goal 2 验收清单"。
```

### 6.2 Goal 2 跑完后人工验证

```
浏览器:
  http://localhost:3000/features/D-01
    → 看到 D-01 详情 + Legacy/Target JSON 块 + "启动需求"按钮
  点"启动需求" → Dialog 弹出
    → 输入"测试需求"
    → 点 "运行 Clarifier(Mock)" 按钮
    → 看到契约 markdown 逐字打字动画展示
  http://localhost:3000/features/INVALID
    → 显示 404 页面
```

### 6.3 Goal 2 失败回退

| 现象 | 原因 | 处理 |
|------|------|------|
| Dialog 不显示 | radix-ui 没装好 | 重跑 pnpm install,确认 @radix-ui/react-dialog 在 node_modules |
| 'use client' 报错 | server/client component 混用 | 检查每个客户端组件第一行是否 'use client' |
| 逐字动画卡顿 | setInterval 没清理 | useEffect cleanup 函数里 clearInterval |
| 404 页面不出现 | notFound() 用错 | 在 page.tsx 顶部 import notFound from 'next/navigation' |

---

## 7. Goal 3 — 真实 Anthropic Clarifier 接通

> 前置:Goal 2 已 commit + `apps/portal/.env.local` 有 `HELMFLOW_ANTHROPIC_API_KEY`。

### 7.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 Goal 2 基础上完成 Full-Loop Platform MVP 第 3 步:把 mock Clarifier
替换为真实 Anthropic SDK + SSE streaming。前置:apps/portal/.env.local 已配
ANTHROPIC_API_KEY,Goal 2 已 commit。

【范围】
1. 修改 apps/portal/package.json,在 dependencies 加 "@anthropic-ai/sdk": "0.39.0"
   (使用这个固定版本,不要改),然后在 apps/portal/ 下跑 pnpm install。
2. 创建 apps/portal/lib/clarifier-prompt.ts:导出 buildClarifierSystemPrompt() 函数,
   返回字符串。内容包含:
   - 角色:你是 HelmCode 的 Clarifier 节点,负责把模糊需求转成精确行为契约
   - 输入:userRequest + feature 元数据(id/name/legacy/target)
   - 输出格式:严格 markdown,含 6 个章节
     ## Problem Definition / ## State Machine (PlantUML) /
     ## Business Rules (BR-xxx 列表) / ## Acceptance Criteria (AC-xxx 列表,可程序验证) /
     ## API Contract (markdown 表) / ## Domain Model
   - 风格约束:中文表述、状态机用 PlantUML、AC 必须有可程序验证关键词
3. 创建 apps/portal/app/api/clarify/route.ts:Next.js Route Handler,
   - 方法 POST,接收 body { featureId: string, userRequest: string }
   - 用 lib/matrix.ts 查找 feature,找不到返回 404
   - 用 @anthropic-ai/sdk 调 client.messages.stream(),model 用
     "claude-opus-4-7"(从 process.env.CLARIFIER_MODEL 读,默认这个值),
     max_tokens: 4096
   - system: buildClarifierSystemPrompt() 返回值
   - messages: [{ role: 'user', content: 想要的 user prompt(把 feature 元数据 +
     userRequest 拼起来)}]
   - 返回 SSE 响应(Content-Type: text/event-stream),逐 chunk yield 出去:
     for await (const event of stream) {
       if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
         controller.enqueue(`data: ${JSON.stringify({type:'token',text:event.delta.text})}\n\n`)
       }
     }
     最后发一个 data: {"type":"done"} 事件
4. 修改 apps/portal/components/start-feature-dialog.tsx:
   - 增加一个新按钮"运行 Clarifier(真实)" 紧挨着 mock 按钮
   - 真实按钮的 onClick 改为:
     fetch('/api/clarify', { method: 'POST', body: JSON.stringify({featureId, userRequest}) })
       .then(res => res.body.getReader())
       .then async loop reader 读 SSE,parse 出 token 事件,append 到 clarifierOutput
     处理 done 事件停止 loop
   - 保留 mock 按钮(便于离线演示)
5. 在 apps/portal/README.md 加一段"Goal 3 配置 ANTHROPIC_API_KEY"说明。

【约束】
- 不要改 lib/matrix.ts / app/page.tsx / Goal 1 的组件
- 不要做错误重试 / token 计数 / 缓存(Phase 1 再加)
- 不要写 Mock fallback 逻辑(直接 Anthropic API,失败就显示错误信息)
- API key 只能从 process.env 读,不允许写死
- SSE 实现用 ReadableStream + TextEncoder,Next 15 App Router 标准模式

【通过信号】
1. pnpm typecheck 0 error
2. apps/portal/.env.local 存在(用 ls 确认,不读取内容)
3. 终端跑 `cd apps/portal && pnpm dev` 起来后,
   curl -X POST http://localhost:3000/api/clarify \
     -H "Content-Type: application/json" \
     -d '{"featureId":"D-01","userRequest":"测试"}' \
     --max-time 30 -N
   输出包含至少 5 行 "data: {" 开头的 SSE 事件,且含 "Problem Definition"
4. curl -X POST http://localhost:3000/api/clarify \
     -d '{"featureId":"INVALID","userRequest":"x"}' 返回 404
5. 文件存在性:lib/clarifier-prompt.ts / app/api/clarify/route.ts 存在;
   start-feature-dialog.tsx 含字符串 "/api/clarify"
6. package.json 含 "@anthropic-ai/sdk": "0.39.0"

完成后输出"Goal 3 验收清单"。如果 ANTHROPIC_API_KEY 不可用导致测试失败,
不要试图绕过(不能加 mock fallback),escalate 给人。
```

### 7.2 Goal 3 跑完后人工验证

```
浏览器 http://localhost:3000/features/D-01
  → 启动需求 → Dialog
  → 输入"创建交付需求时校验幂等键"
  → 点 "运行 Clarifier(真实)"
  → 看到 Anthropic 真实 streaming 输出契约 markdown
  → 包含 Problem Definition / State Machine / BR / AC 等真实生成内容
```

### 7.3 Goal 3 失败回退

| 现象 | 原因 | 处理 |
|------|------|------|
| 401 Unauthorized | API key 无效 | 检查 .env.local + 重启 dev server |
| 404 model not found | 模型 ID 错 | CLARIFIER_MODEL 环境变量改成 claude-sonnet-4-6 |
| SSE 卡住不输出 | Edge runtime 与 streaming 冲突 | 在 route.ts 顶部加 `export const runtime = 'nodejs';` |
| CORS 报错 | Next.js 自身不会有,除非改了 Origin | 检查 fetch 是否用了相对路径 `/api/clarify` |

---

## 8. Goal 4 — monorepo 转换 + 持久化层 + Clarifier 真状态流转

> 前置:Goal 3 已 commit。这是进入 Full-Loop MVP 的分水岭 —— G4 之后所有新代码住在 `packages/*`。

### 8.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 Goal 3 基础上完成 Full-Loop MVP 第 4 步:helmflow 仓转 pnpm workspace,引入
packages/contract-schema + packages/storage,Clarifier 完成时写库 + 改 feature.status。
前置:Goal 3 已 commit,apps/portal/.env.local 含 HELMFLOW_ANTHROPIC_API_KEY。

【范围】
1. 根新建 pnpm-workspace.yaml(packages: ["apps/*","packages/*"])+ 私有 package.json
   (scripts: typecheck="pnpm -r typecheck" / build="pnpm -r build" /
   dev="pnpm --filter @helmflow/portal dev") + tsconfig.base.json(strict+ES2022+
   moduleResolution bundler),apps/portal 与新 package 的 tsconfig extend 它。
2. 新建 packages/contract-schema/(@helmflow/contract-schema):装 zod;
   src/index.ts 导出 ContractSchema(Zod,对应 agent-protocol.md §2.1 frontmatter+章节;
   字段:featureId/status(draft|approved|done|blocked|abandoned)/project/createdAt/domain/
   matrixCellId/problemDefinition/stateMachine/businessRules:[{id,text}]/
   acceptanceCriteria:[{id,text}]/apiContract:[{method,request,response}]/domainModel)+
   parseContract(md)→{ok,data|errors}。
3. 新建 packages/storage/(@helmflow/storage):装 drizzle-orm+better-sqlite3;
   src/schema.ts 3 表:features(id PK,projectId,domain,name,status,updatedAt)/
   runs(id PK 'run-<ts>-<rand>',featureId FK,kind='clarifier',state running|done|failed,
   startedAt,finishedAt)/nodeAttempts(id PK,runId FK,nodeName,iteration,status,
   outputPath,startedAt,finishedAt);src/db.ts 导出 createDb(path)+ 启动自动 migrate;
   src/repo.ts 导出 upsertFeature/createRun/updateRun/createAttempt/updateAttempt;
   migrations/ 用 drizzle-kit 生成。
4. apps/portal 接入:tsconfig references 指 contract-schema+storage;package.json deps
   加 @helmflow/contract-schema + @helmflow/storage 都 workspace:*;新增
   lib/db.ts(lazy createDb('data/helmflow.db'))+ lib/sync-matrix.ts(启动时
   upsertFeature 同步 yaml→DB,status 仅首次写)。
5. 改 app/api/clarify/route.ts:
   · 入口 createRun(featureId,'clarifier')+createAttempt(runId,'clarifier',1,'running')
   · stream done:updateAttempt(passed,outputPath='data/runs/<runId>/clarifier-output.md')
     +updateRun(done)+upsertFeature(status='clarifying'),并把整段 markdown 写到该文件
   · 异常:updateAttempt(failed)+updateRun(failed)
6. 改 lib/matrix.ts 的 getFeature:先读 DB status,DB 无回退 yaml。首页/详情页自然读到。
7. 根 .gitignore 加 apps/portal/data/helmflow.db + apps/portal/data/runs/

【约束】
- 不引入 Drizzle Studio / Postgres / Docker
- yaml 仍是 features 元数据 ground truth,DB 只缓存 status + 关联 runs
- 不改 G1-G3 UI 组件 props,只改 getFeature 数据出口
- 只在 packages/storage 内读写 .db
- features.status 用 lib/matrix.ts 的 FeatureStatus 联合类型字符串

【通过信号】
1. 根 pnpm install 成功(链 workspace)
2. pnpm -r typecheck 全 workspace 0 error
3. 起 dev,POST /api/clarify {featureId:"D-01",userRequest:"测试"} 完成后:
   - apps/portal/data/helmflow.db 存在
   - sqlite3 查 node_attempts 至少 1 行 status='passed' nodeName='clarifier'
   - apps/portal/data/runs/<runId>/clarifier-output.md 非空
4. 刷新 /features/D-01,badge 从 not-started 变 clarifying
5. POST INVALID featureId 不写 DB(先 getFeature 校验)
6. 存在性:pnpm-workspace.yaml / packages/contract-schema/src/index.ts /
   packages/storage/src/schema.ts / apps/portal/lib/db.ts / apps/portal/lib/sync-matrix.ts

完成后输出"Goal 4 验收清单"。
```

### 8.2 Goal 4 通过信号(Haiku 评估器看的字符串)

```
✅ pnpm install: "Done in" 或 "+ N packages"
✅ pnpm -r typecheck: 0 error
✅ sqlite3 .db "SELECT count(*) FROM node_attempts WHERE status='passed'" ≥ 1
✅ ls data/runs/<runId>/clarifier-output.md 存在
✅ curl localhost:3000/features/D-01 含 "clarifying"(status badge 文本)
```

### 8.3 Goal 4 跑完后人工验证

```
1. ls 仓库根:有 pnpm-workspace.yaml + package.json + tsconfig.base.json + packages/
2. cd apps/portal && pnpm dev,浏览器 http://localhost:3000:
     - D-01 卡片初始 "not-started"(灰)
     - 点入 → 启动需求 → 运行 Clarifier(真实) → 完成
     - 返回首页刷新 → D-01 badge 变 "clarifying"(黄)
3. cat apps/portal/data/runs/<runId>/clarifier-output.md → 看到完整 6 章节 markdown
4. sqlite3 apps/portal/data/helmflow.db ".tables" → features/runs/node_attempts 3 表
```

### 8.4 Goal 4 失败回退

| 现象 | 原因 | 处理 |
|------|------|------|
| pnpm install 报 workspace not found | pnpm-workspace.yaml 写错 | yaml 必须用 `packages:\n  - 'apps/*'\n  - 'packages/*'` 缩进 |
| typecheck 找不到 @helmflow/* | tsconfig references 没配 | 各 package 加 `composite: true` + 顶层 `references` 数组 |
| better-sqlite3 装失败 | 缺 node-gyp | `pnpm rebuild better-sqlite3` 或 `npm i -g node-gyp` |
| migrations 没自动跑 | drizzle 没 migrate 在启动 | lib/db.ts 首次连接时 `migrate(db, { migrationsFolder })` |
| DB 锁(SQLITE_BUSY) | dev server 多进程 | 删 .db 重新生成,或加 better-sqlite3 的 WAL 模式 |

---

## 9. Goal 5 — Clarifier Critic + 契约审批流

> 前置:Goal 4 已 commit。packages/contract-schema + storage 可用。

### 9.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 Goal 4 基础上完成 Full-Loop Platform MVP 第 5 步:Clarifier 输出后跑
deterministic Critic 校验(6 章节齐全 + AC 可程序验证 + PlantUML 语法 + BR 编号
+ API method 非空),通过则落 contract 草稿,失败带 reflection 重跑 ≤2 轮。
新增审批契约路由让用户把 draft 改 approved,feature.status 跟着 clarifying→pending-goal。
前置:Goal 4 已 commit,packages/contract-schema 与 storage 可用。

【范围】
1. 新建 packages/agent-core/(@helmflow/agent-core):
   - src/critics/clarifier-critic.ts:导出 runClarifierCritic(contract:Contract)→
     {pass:boolean, issues:Array<{check:string,detail:string}>}。5 个 deterministic check:
       a) acceptanceCriteria.length >= 3
       b) 每条 AC.text 含至少一个关键词:返回|status 转为|抛出|断言|持久化|不变|产生事件|应当
       c) stateMachine 含 /@startuml[\s\S]+@enduml/ 且含 [*]→ 起点 与 →[*] 终点
       d) businessRules 全部 id 满足 /^BR-\d{3}$/
       e) apiContract.length >= 1
   - src/critics/types.ts:导出 Issue + CriticResult type
2. 扩 packages/storage:新表 contracts(id PK 'C-<featureId>-<ts>',featureId FK,
   status draft|approved|done|blocked|abandoned,markdownPath,contentHash,createdAt,
   approvedAt nullable)+ repo:createContract/updateContractStatus/getLatestContract。
3. 改 app/api/clarify/route.ts:
   · stream 同时收集完整 markdown 文本
   · 流完 parseContract;失败也走 critic-fail
   · 跑 runClarifierCritic;pass:写 data/contracts/<featureId>/<contractId>.md +
     createContract(draft)+ updateAttempt(passed)+ upsertFeature(clarifying)
   · fail:issues join 成中文 reflection,SSE 发 {type:'critic-fail',issues:[...]} +
     重 invoke Worker 一次(prompt 末尾加 reflection),最多 2 轮(初始+1);仍 fail →
     updateAttempt(failed)+ updateRun(failed)+ upsertFeature(blocked)+ SSE done
4. 新 app/api/contracts/[id]/approve/route.ts:POST 空 body;查 contract 存在且
   status='draft' 否则 400;updateContractStatus('approved',approvedAt=now)+
   upsertFeature(pending-goal);返回 200 {contract,feature}。
5. 详情页 app/features/[id]/page.tsx 加"最新契约"section(server fetch getLatestContract):
   · 无 → 不展示
   · draft → markdown(<pre>)+ 徽章 + 「审批契约」按钮(客户端组件
     components/approve-contract-button.tsx,点击 fetch POST 成功后 router.refresh)
   · approved → markdown + "已审批"
   · blocked → 显示"契约审查未通过,请重试"(简化版,不读 SSE 历史)
6. start-feature-dialog 微调:Clarifier done 时前端 router.refresh() 让 draft 出现。

【约束】
- Critic 全 deterministic,不调 LLM
- Worker-Critic 内循环硬上限 2 轮
- 不引入 markdown 渲染库,用 <pre className="whitespace-pre-wrap text-xs">
- 不动 storage 已有 3 表(只加 contracts)
- 严格 TS,Issue 类型不允许 any

【通过信号】
1. pnpm -r typecheck 0 error
2. UI:正常输入 prompt → 详情页出现 draft 契约 + 「审批契约」按钮
3. POST /api/contracts/<id>/approve 返回 200,刷新 badge 变 pending-goal
4. 故意输入"x"垃圾 prompt → 2 轮后 features.status='blocked',SSE 含 critic-fail+issues
5. 存在性:packages/agent-core/src/critics/clarifier-critic.ts /
   apps/portal/app/api/contracts/[id]/approve/route.ts /
   apps/portal/components/approve-contract-button.tsx

完成后输出"Goal 5 验收清单"。
```

### 9.2 Goal 5 通过信号(Haiku 评估器看的字符串)

```
✅ pnpm -r typecheck: 0 error
✅ POST /api/clarify 成功 case:SSE 末尾含 {"type":"done"} 且 DB contracts 表有 draft 记录
✅ POST /api/clarify 失败 case:SSE 含 {"type":"critic-fail" + status='blocked'
✅ POST /api/contracts/<id>/approve: HTTP 200
✅ 审批后 features.status='pending-goal'(sqlite3 查)
```

### 9.3 Goal 5 跑完后人工验证

```
1. 浏览器 → D-01 → 启动需求 → 输入合理 prompt(含 BR/AC 暗示)→ 运行 → 完成
2. 详情页底部出现"最新契约"区,展示 markdown + 「审批契约」按钮(蓝)
3. 点 「审批契约」→ 按钮变 "已审批",badge 从 clarifying → pending-goal
4. 重启 dev server → 刷新 → 状态仍然 pending-goal(DB 持久化)
5. 退回 D-02 → 启动需求 → 输入只有"测试"两字 → 运行 → 完成后 badge='blocked',
   详情页"最新契约"区显示 "契约审查未通过" + issues
```

### 9.4 Goal 5 失败回退

| 现象 | 原因 | 处理 |
|------|------|------|
| critic 永远 fail | parseContract 把整段 markdown 当 problem definition 没拆出 AC | 检查 markdown 章节分隔正则,确保 ## 二级标题切分 |
| reflection 重跑导致死循环 | 计数没生效 | 在 route handler 用 for 循环固定 2 次,而不是递归 |
| approve 后页面 status 不变 | server cache 没刷新 | router.refresh() 必须在 client 调,且 page.tsx 不能用 force-cache |
| 文件路径乱码 | featureId 含特殊字符 | 用 encodeURIComponent 或限制 featureId 字符集 |
| Issue 列表前端找不到 | SSE critic-fail 没持久化 | 简化:在 contracts 表加 latestIssues:json 字段,server 读 |

---

## 10. Goal 6 — sample-java 引入 + adapter-core + Coder Worker(MVP 直连)

> 前置:Goal 5 已 commit。java 21 + mvn 已装。

### 10.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 Goal 5 基础上完成 Full-Loop MVP 第 6 步:引入极简 sample SOFABoot Java 项目
作 Coder 目标 + 抽 adapter-core 接口 + Coder Worker 能基于 approved contract 生成
Handler.java 文件落到 sample。前置:Goal 5 已 commit,装了 java 21 + mvn 3.9。

【范围】
1. 新 apps/sandbox-java/ 极简 SOFABoot 单 module:
   - pom.xml:parent sofaboot-enterprise-parent 5.x(拉不到则换 spring-boot-starter-parent
     3.x),java 21,只引 spring-boot-starter + spring-boot-starter-test
   - src/main/java/com/helmflow/sample/Application.java(@SpringBootApplication)
   - src/main/java/com/helmflow/sample/deliver/{handler,action}/.gitkeep
   - src/test/java/com/helmflow/sample/deliver/.gitkeep
   - README.md(说明 + mvn 命令)+ .gitignore(target/)
   - 独立 git init,与主仓 commit 解耦(README 提醒)
2. 新 packages/adapter-core/(@helmflow/adapter-core):src/types.ts 导出 ProjectAdapter:
   · projectPath:string
   · build(opts?:{skipTests?:boolean}):Promise<{ok,stdout,stderr}>
   · testStrict():Promise<{ok,reportPath}>
   · testFull():Promise<{ok,reportPath,surefireReports:string[]}>
   · format():Promise<{ok}>
3. 新 packages/adapter-java-ddd/:src/index.ts 导出 createJavaDddAdapter(path):
   ProjectAdapter,child_process.spawn 调本地 mvn:
   · build({skipTests}) → mvn -q compile [-DskipTests](默认 skipTests=true)
   · testStrict → mvn -q test -Dtest='*ArchTest'(空跑允许)
   · testFull → mvn -q test 后枚举 target/surefire-reports/*.txt
   · format → mvn -q spotless:apply(plugin 缺失降级 mvn -q compile)
   所有子进程 5 分钟超时。
4. 扩 packages/agent-core/:
   · src/coder/coder-prompt.ts:buildCoderSystemPrompt() 读
     standards/java-ddd/patterns/{handler,aggregate,entity,test,stub-and-bean-naming}.md
     fs.readFileSync 拼入 system prompt
   · src/coder/coder-worker.ts:runCoderWorker({contract,adapter,anthropicClient})→
     stream Anthropic,要求输出 yaml frontmatter(列每个文件 path+className)+ 一组
     ```java 代码块;解析后 fs.writeFileSync 到 adapter.projectPath 对应目录;
     返回 {files:string[],reflection?:string}
5. 新 app/api/coder/run/route.ts:POST {contractId} → 查 contract.status='approved' →
   createRun('coder')+attempt(1)→ adapter path 从 env HELMFLOW_SAMPLE_JAVA_PATH 读,
   默认相对 ../../sandbox-java → createJavaDddAdapter → 跑 coder worker → SSE 流前端,
   完成 updateAttempt(passed,outputPath=files.join)+upsertFeature(implementing);
   失败 upsertFeature(blocked)。
6. 详情页 contract.status='approved' 时显「运行 Coder」按钮(客户端组件
   components/run-coder-button.tsx),点击开 Dialog 流式输出 + 完成后文件列表。

【约束】
- Coder 写文件只允许落在 sandbox-java/src/main/java/.../{handler,action}/ 下,
  不许写 pom.xml 或测试目录
- 不引入 git worktree,直接写主 working tree
- mvn 调用 5 分钟超时,超时 updateAttempt(failed)
- 不接 mycmdeliverhub
- sample-java 整目录入主仓,只 sandbox-java/target/ gitignore

【通过信号】
1. cd apps/sandbox-java && mvn -q compile 退出码 0(冷启动首次可能 5 分钟超时)
2. pnpm -r typecheck 0 error
3. 一个已审批 contract 的 feature 点「运行 Coder」→ 30-90s 后:
   - sandbox-java/src/main/java/com/helmflow/sample/deliver/handler/ 下 ≥1 .java
   - mvn compile 仍通过
   - features.status='implementing'
4. 存在性:apps/sandbox-java/pom.xml / Application.java /
   packages/adapter-core/src/types.ts / packages/adapter-java-ddd/src/index.ts /
   packages/agent-core/src/coder/coder-worker.ts /
   apps/portal/app/api/coder/run/route.ts

完成后输出"Goal 6 验收清单"。
```

### 10.2 Goal 6 通过信号(Haiku 评估器看的字符串)

```
✅ mvn -q compile 在 sandbox-java 内退出码 0
✅ pnpm -r typecheck: 0 error
✅ POST /api/coder/run 完成后 ls sandbox-java/.../handler/*.java ≥ 1
✅ mvn -q compile 二次仍 exitCode 0(coder 写的代码能编译)
✅ features.status = "implementing"(sqlite 查)
```

### 10.3 Goal 6 跑完后人工验证

```
1. cd apps/sandbox-java && mvn -q -DskipTests compile → BUILD SUCCESS
2. 浏览器找一个已审批契约的 feature(如 D-01 G5 验证过的)→ 详情页底部见「运行 Coder」按钮
3. 点击 → Dialog 弹出 → 看到 streaming java 代码 token + 几十秒后完成
4. ls apps/sandbox-java/src/main/java/com/helmflow/sample/deliver/handler/
   → 出现 SaveDeliverRecordHandler.java(或对应名)
5. cd apps/sandbox-java && mvn -q -DskipTests compile → 仍 BUILD SUCCESS
6. 首页 D-01 badge 变 implementing(蓝)
```

### 10.4 Goal 6 失败回退

| 现象 | 原因 | 处理 |
|------|------|------|
| mvn 拉不到 sofaboot parent | 网络/私服访问不了 | 切阿里云 mirror,或改 pom 用 spring-boot-starter-parent 3.x |
| Coder 写出来的代码不能编译 | prompt 没告诉 package 路径 | 在 system prompt 显式给出 base package com.helmflow.sample |
| LLM 输出非 yaml+java 混杂 | prompt 太松 | 加 few-shot 示例(一个最简 Handler 的完整 yaml+java)固化格式 |
| 文件写到 packages 外 | path 拼接没 sanitize | 在 worker 输出后用 path.resolve + startsWith(projectPath) 校验 |
| mvn 超时 | 首次下载依赖慢 | 手动跑一次 mvn dependency:go-offline 预热 |

---

## 11. ⚠️ G7 重设计公告:从「直连大模型」转向「Claude Code Agent SDK」

> **本节是给读者的元数据**,不是一条 /goal。说明 G7 起的架构方向变化、
> 已废弃的旧 G7-G9 spec、以及新 G7-G12 的来由。

### 11.1 为什么 G7 要重设计

Goal 6 把 Coder 跑通后,发现一个核心问题:**Portal 在用一次性 Anthropic API 调用
重新发明 Claude Code 已经解决过的轮子**。具体踩坑:

- 模型看不见 sandbox 实际状态(不知道 lombok 没装、不知道前几次生成的 Action.java
  长啥样),只能凭 system prompt 里嵌入的 standards 模板"盲写"
- 自己写的 markdown 解析器、文件路径白名单、Critic-by-compiler 全是 Claude Code 已经
  实现得很成熟的能力的拙劣复刻
- Goal 6 调试 Coder 花了 5 轮才稳定 — 4/5 的失败原因(lombok / spring-tx / 引用未生成的基类)
  都是因为模型缺少"读 sandbox 当前状态"和"自己跑 mvn 看错误"的能力

**根本判断**:**HelmFlow 应该把 Claude Code 当作执行底座,自己只做编排、状态、UI**。
每个"节点"(Clarifier / Coder / TestGen / QA / Committer)= 一个有 stop 条件的
`/goal`-style Claude Code session,而不是一次性 API 调用 + 自己撸 retry 循环。

### 11.2 已 spike 验证的事实

`@anthropic-ai/claude-agent-sdk` v0.3.x 在 `open.bigmodel.cn/api/anthropic` +
`claude-opus-4-7` + `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` 下,tool_use 协议
完整可用(Read / Bash 工具 3-turn 闭环验证通过)。**不需要本地装 claude CLI**,SDK
自带 bundled CLI。详见架构变更记录(spike 报告)。

注意陷阱:
- 模型名必须用 `claude-opus-4-7`,**不能用 `glm-4.6`**(后者智谱代理走"直通"模式,
  不接受 Anthropic tool_use schema → `400 模型提供方错误`)
- 必须设 `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`,否则智谱拒绝部分 beta header

### 11.3 老 G7-G9 spec 的命运

| 老 Goal | 旧设计(直连大模型) | 新映射 |
|---|---|---|
| 老 G7 | TestGen + Compile Critic(自己解析 mvn 错误回灌 prompt) | 内容并入新 G8,但形态改为 SKILL.md + 模型自己跑 mvn |
| 老 G8 | QA Worker(自己解析 surefire)+ Committer Worker(自己 spawn git) | 新 G9 合并到一个 goal(沿用老 chain 打包风格),模型自己 Bash |
| 老 G9 | Orchestrator + Reflection Log(自己管 8 轮跨节点循环) | 内容沿用,对应新 G10,但每个节点跑的是 Claude Code session |

**未删除**:本文档保留对老 G7-G9 的链接(本节及附录),作为"被废弃的方案档案"。
真正要复制粘贴跑的是后面的新 G7-G12。

### 11.4 修订后的 Goal Chain 总览(选项 B,12 goal)

| # | 名称 | 状态 | 体量 |
|---|---|---|---|
| G1-G6 | 同前 | ✅ done | — |
| **G7** | 依赖倒置 + Clarifier 顺手回炉(架构跃迁同时把 Clarifier 也迁) | ⏳ next | 大 |
| G8 | TestGen 节点(SKILL 形态) | 待 | 中 |
| G9 | QA + Committer(合并节点,跟老 G8 一样打包) | 待 | 中 |
| G10 | Orchestrator + 跨节点 fix-task 自循环 | 待 | 大 |
| — | **▔▔▔ Full-Loop MVP 完成线 ▔▔▔** | — | — |
| G11 | git worktree 隔离 + 多 feature 并发 | 待 | 大 |
| G12 | 多项目接入(`helmcode.yaml` manifest) | 待 | 中 |

> 比原 9-goal chain 多 1 个,差异**仅来自不可避免的架构跃迁**;Clarifier 顺手在 G7 一起做,
> QA+Committer 合并在 G9 跟老 chain 风格保持一致。

---

## 12. Goal 7(新) — 依赖倒置:HelmFlow ⊥ Claude Agent SDK + Clarifier 顺手回炉

> 前置:Goal 6 已 commit。Spike 已验证 SDK 在智谱 baseURL 下 tool_use 可用。
> 把 Coder 重写 + Clarifier 迁移**打包做掉**,Portal 一次彻底摘除 `@anthropic-ai/sdk`。

### 12.1 复制粘贴到 Claude Code 的完整文本

> 说明:`/goal` 体内容字符上限 4000,以下版本 ~3150 字,已留 ~850 余量。
> 粘贴时连同首行 `/goal ` 一起选择。

```
/goal 在 G6 基础上完成架构跃迁:Portal 删 @anthropic-ai/sdk,改用 @anthropic-ai/claude-agent-sdk 调 Claude Code 作执行底座;引入统一 node-runner;Coder + Clarifier 两节点全迁。前置:G6 已 commit;spike 已验证 SDK 在 HELMFLOW_ANTHROPIC_BASE_URL(智谱)下 tool_use 可用(模型固定 claude-opus-4-7,必带 CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1)。

【范围】
1. 新 packages/agent-runner/:
   · env.ts:HELMFLOW_ANTHROPIC_* → ANTHROPIC_* env map,强注 ANTHROPIC_MODEL=claude-opus-4-7 + CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
   · types.ts:NodeRunOptions/NodeRunEvent/NodeRunResult(event:'system.init'|'assistant.text'|'tool_use'|'tool_result'|'result')
   · runner.ts 导出 runNode({cwd,systemPrompt,userPrompt,allowedTools,maxTurns,additionalDirectories?,onEvent?}):用 SDK query() 起 session;规格化事件喂 onEvent;返 {success,turns,durationMs,costUsd,sessionId,error?}

2. 新 2 SKILL:
   · .claude/skills/helmflow-coder/SKILL.md:角色 + 强自包含规则 + 6 vanilla-Java 示例(迁自 coder-prompt.ts);模型用 Read 自查 standards/java-ddd/patterns/,system 不硬塞 1500 行
   · .claude/skills/helmflow-clarifier/SKILL.md:角色 = Clarifier 节点;system 迁自 clarifier-prompt.ts;输出 6 段二级章节 md,不要求 yaml fm(Portal 服务端补,沿 G5);allowedTools:Read

3. 重写 apps/portal/app/api/coder/run/route.ts:
   · 删 Anthropic + client.messages.stream
   · 调 runNode({cwd:sandboxJavaPath,systemPromptFromSkill:'helmflow-coder',userPrompt:contractMarkdown,allowedTools:['Read','Write','Edit','Bash'],maxTurns:15})
   · onEvent 转 SSE:assistant.text → 现 token 事件;新增 tool_use/tool_result/result.cost
   · 完成用 `git status --porcelain` 抓 sandbox-java/ 改动清单(替旧 parser files[])
   · mvn -q compile 由模型自驱跑通,Portal 不再后置 build

4. 重写 apps/portal/app/api/clarify/route.ts:
   · 删 Anthropic + stream
   · 调 runNode({cwd:portalCwd,systemPromptFromSkill:'helmflow-clarifier',userPrompt:`featureId=${id}\nuserRequest=${text}`,allowedTools:['Read'],maxTurns:5})
   · onEvent 转 assistant.text 给前端(SSE 兼容)
   · 模型出 6 段 md 后 Portal 补 yaml fm → parseContract → runClarifierCritic 沿 G5 逻辑
   · G5 2 轮 reflection 保留:Critic fail → issues 拼 reflection text 再调一次 runNode(maxTurns:5),共 2 轮上限不变

5. 删:
   · coder-worker.ts 的 parser+writeFileSync+路径白名单(SDK additionalDirectories 接管)
   · apps/portal/lib/clarifier-prompt.ts(迁 SKILL)
   · apps/portal/package.json 的 @anthropic-ai/sdk dep

6. UI:RunCoderButton + StartFeatureDialog 的 SSE 处理新增 tool_use/tool_result 块渲染(可见「Read X / Bash Y」)

【约束】
- 工具白名单 = Read/Write/Edit/Bash(Clarifier 只 Read),禁 WebSearch/WebFetch/Task
- Bash cwd 锁 sandbox-java/(SDK additionalDirectories)
- Coder maxTurns:15;Clarifier maxTurns:5(reflection 循环外层管 2 轮)
- 模型固定 claude-opus-4-7(spike 证 glm-4.6 不可用)
- 不引入 worktree(G11)

【通过信号】
1. pnpm -r typecheck 0 error
2. grep -r '@anthropic-ai/sdk' apps/portal/ 0 命中
3. D-XX 合理 prompt → Clarifier 走 runNode → 6 段合规契约 → Critic 通过 → draft 入库(G5 行为不变)
4. D-05 approved contract → 「运行 Coder」端到端通过,模型自驱 mvn 通过
5. UI 看到 tool_use(Read)/tool_use(Bash)/tool_use(Write) 流(非纯 token)
6. Coder run 的 result.total_cost_usd 暴露到 SSE,UI 可见
7. 存在性:packages/agent-runner/src/runner.ts、.claude/skills/helmflow-coder/SKILL.md、.claude/skills/helmflow-clarifier/SKILL.md;apps/portal/lib/clarifier-prompt.ts 已删

完成后输出"Goal 7 验收清单",附 1 次 Coder + 1 次 Clarifier run 的 cost/turns/duration 对照。
```

### 12.2 Goal 7 通过信号(Haiku 评估器看的字符串)

```
✅ pnpm -r typecheck: 0 error
✅ POST /api/coder/run SSE 含 {"type":"tool_use","name":"Bash"
✅ POST /api/clarify SSE 含 {"type":"tool_use","name":"Read"
✅ grep -r '@anthropic-ai/sdk' apps/portal/ 0 命中
✅ cd apps/sandbox-java && mvn -q compile 退出码 0
✅ apps/portal/data/helmflow.db 新增 runs kind='coder' 和 'clarifier' 各 1 行 state='done'
```

### 12.3 Goal 7 跑完后人工验证

```
1. 浏览器开任意 not-started feature → 「启动需求」 → Clarifier 走 SSE,看到
   模型 Read data/feature-matrix.yaml + Read standards/(可选)→ 输出 6 段
2. Critic 通过 → draft 出现 → 审批 → status=pending-goal
3. 「运行 Coder」 → Dialog 展示 turn-by-turn 工具调用
4. 模型 Read contract markdown、Read standards/、Write 若干 .java
5. 模型自己跑 mvn -q compile,有错继续 Edit 修复,直到通过
6. 最终 SSE 含 result 事件:cost_usd / turns / session_id
7. cd apps/sandbox-java && mvn -q compile → BUILD SUCCESS
8. apps/portal/package.json 没有 "@anthropic-ai/sdk"
```

### 12.4 Goal 7 失败回退

| 现象 | 原因 | 处理 |
|------|------|------|
| SDK 401 unauthorized | 智谱 key 没透传 | runNode 内 env 透传 ANTHROPIC_AUTH_TOKEN + ANTHROPIC_API_KEY 双保险 |
| 400 模型提供方错误 | 模型名设错(glm-4.6 / claude-3.5) | 强制 ANTHROPIC_MODEL=claude-opus-4-7,不允许覆盖 |
| 模型乱写 sandbox-java 外的文件 | additionalDirectories 没锁 | cwd 设 sandbox-java,additionalDirectories 不传 |
| 模型跑 mvn -X 输出爆 SSE | SDK 转发的 tool_result 太大 | SSE 转发层截断 tool_result.content 到 2000 字符,完整存 outputPath |
| 单 turn 卡 > 5 分钟 | 智谱 5xx | SDK 自带重试;反复失败标记 attempt failed |
| Clarifier 迁移漏掉 Critic 2 轮 reflection | G5 逻辑没接进新 route | 在 runNode 外层包 for(let i=0;i<2;i++),与 G5 行为对齐 |

---

## 13. Goal 8 — TestGen 节点(SKILL 形态)

> 前置:G7 已 commit。Coder/Clarifier 都跑在 node-runner 上。

### 13.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 G7 基础上新增 TestGen 节点:基于已 implementing 的 feature(Coder 已生 Handler)
为每条 AC 生成 JUnit Jupiter 测试,模型自驱 mvn test 直到全绿,落
test-ac-mapping.yaml 标注测试与 AC 的映射。前置:G7 已 commit;某 D-XX feature
已经 implementing 状态(Coder 跑过)。

【范围】
1. 新 .claude/skills/helmflow-testgen/SKILL.md:
   · 角色 = TestGen Worker;输出 JUnit Jupiter 测试(vanilla,无 lombok / 无 Mockito
     重磅依赖,纯 JUnit 5 + 简单 stub)
   · 强自包含规则(同 Coder):只 import JDK + JUnit 5 + sandbox 内已生成的类
   · 让模型 Read 当前 sandbox-java/src/main/java/.../<context>/ 看 Handler/Action 的实际签名
   · 让模型 Read approved contract markdown 看 AC 列表
   · 输出 test-ac-mapping.yaml 到 sandbox 外(data/test-ac-mappings/<featureId>/<runId>.yaml),
     schema:{ schemaVersion:1, featureId, mappings:[{acId, tests:[{file, method, type}]}] }
   · 写完 test 文件后模型自己跑 `mvn -q test` 直到全绿;失败就修测试
2. 新 packages/agent-core/src/critics/testgen-critic.ts:
   · runTestGenCritic(args:{mappingPath, contract}) → 校验
     - mapping 文件存在且 zod 校验通过
     - contract.acceptanceCriteria 每条都有 ≥ 1 个 test 映射
     - 每个 test 文件 path 以 src/test/java/ 开头
     - 返回 {pass, issues}
3. 新 apps/portal/app/api/testgen/run/route.ts:POST {featureId} →
   · 查 feature.status='implementing' 否则 400
   · 查最新 approved contract,读 markdown
   · createRun(featureId, 'testgen') + attempt
   · runNode({cwd:sandboxJavaPath, skill:'helmflow-testgen',
     userPrompt:`featureId=${id}\n\n## Contract\n${contractMd}`,
     allowedTools:['Read','Write','Edit','Bash'], maxTurns:20})
   · 完成后跑 runTestGenCritic;pass → upsertFeature(status='tests-pending') +
     updateAttempt(passed, outputPath=mappingPath);fail → blocked
4. 详情页:feature.status='implementing' 时显示「运行 TestGen」按钮
   (RunTestGenButton 客户端组件,复用 RunCoderButton 的 SSE 模式)
5. 引入新 FeatureStatus 枚举值:'tests-pending'(写 lib/matrix.ts)+ Badge 渲染色
6. 复制 G5/G7 的 SSE 事件转发模式,UI 看到 turn-by-turn 的 Read/Write/Bash

【约束】
- 测试文件只允许 src/test/java/com/helmflow/sample/<context>/{handler,action,...}/*Test.java
- 不允许引入 Mockito / AssertJ / Lombok 等额外依赖(保持 G6 pom 不变)
- mvn 单次调用 5 分钟超时(由 SDK 的 maxTurns 间接控制总时长)
- mapping yaml 的 schema 用 zod 在 packages/contract-schema/ 加 TestAcMappingSchema

【通过信号】
1. pnpm -r typecheck 0 error
2. 一个 implementing feature → 「运行 TestGen」→ 端到端通过 →
   - sandbox-java/src/test/java/.../*Test.java 至少 1 个
   - cd sandbox-java && mvn -q test BUILD SUCCESS
   - data/test-ac-mappings/<featureId>/<runId>.yaml 存在且覆盖所有 AC
3. feature.status: implementing → tests-pending
4. 故意把某 Action 内部逻辑改坏 → 模型在 TestGen 跑 mvn test 看到 fail →
   改测试以匹配(不修 Action) → 模型在 reflection 里说明
   (此时 critic 仍 pass 因为 mapping 覆盖了 AC;真正修 bug 是 G9 QA 的事)
5. 存在性:.claude/skills/helmflow-testgen/SKILL.md /
   apps/portal/app/api/testgen/run/route.ts /
   packages/agent-core/src/critics/testgen-critic.ts /
   apps/portal/components/run-testgen-button.tsx

完成后输出"Goal 8 验收清单"。
```

---

## 14. Goal 9 — QA + Committer(合并节点)

> 前置:G8 已 commit。某 feature 已 tests-pending(TestGen 跑过)。
> 沿用老 chain 的打包风格(老 G8 = QA + Committer 同 goal),先 QA 通过再 Committer。

### 14.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 G8 基础上一次性接入 QA 与 Committer 两个节点(沿用老 chain 打包风格):
QA 跑全量 mvn test 解析报告生成 qa-report.yaml;allPass=true 后 Committer 把
sandbox-java 改动 Conventional Commits 风格 commit(不 push)+ commits 表追溯链。
前置:G8 已 commit;某 D-XX 已 tests-pending(TestGen 跑过)。

【范围】
1. 新 2 个 SKILL:
   · .claude/skills/helmflow-qa/SKILL.md
     - 角色 = QA Worker;模型职责
       * 跑 `mvn -q test`,失败先看 stderr 区分测试问题 vs 代码问题
       * 解析 target/surefire-reports/*.txt(自己用 Read + Bash grep)
       * 读 data/test-ac-mappings/<featureId>/<runId>.yaml,把 fail 的 test method
         映射回 AC id
       * 输出 qa-report.yaml 到 data/qa-reports/<featureId>/<runId>.yaml,
         schema 见 docs/architecture/agent-protocol.md §2.4
   · .claude/skills/helmflow-committer/SKILL.md
     - 角色 = Committer Worker;模型职责
       * cd 到 sandbox-java(已是 cwd),Bash `git status` + `git diff` 看改动
       * 起 Conventional Commits 风格 commit message:
         `feat(<domain>): <featureId> <feature.name>`
         body 含 contract path / contractId / runId / 涉及的 AC 列表 / qa-report 路径
         footer:`Refs: contract=<id> qa-run=<id>`
       * Bash `git add src/` + `git commit -m '<message>'`
       * 用固定格式 `<COMMIT_SHA>abcdef0</COMMIT_SHA>` 在最后一行输出 SHA 便于抽取

2. 新 critic + storage:
   · packages/agent-core/src/critics/qa-report-critic.ts:
     runQaReportCritic({reportPath, contract}) → 校验 report zod 通过 +
     每条 contract.acceptanceCriteria 都在 acResults 中出现 + escalateAction 合法
   · packages/storage 新表 commits(id PK 'COM-<rand>', featureId FK, contractId FK,
     coderRunId, testgenRunId, qaRunId, committerRunId, gitSha TEXT, message TEXT,
     createdAt TEXT)+ repo:createCommit / getLatestCommit(featureId)

3. 新 2 个 route:
   · apps/portal/app/api/qa/run/route.ts:POST {featureId} →
     - 查 feature.status='tests-pending' 否则 400
     - createRun + attempt('qa');runNode + qa skill,allowedTools=['Read','Bash','Write']
     - 完成跑 qa-report-critic;allPass → upsertFeature('qa-passed' 新枚举);
       任意 fail → upsertFeature('blocked'),记 qa-report 路径
   · apps/portal/app/api/committer/run/route.ts:POST {featureId} →
     - 查 feature.status='qa-passed' 否则 400
     - 拉本 feature 完整 run 链(coder/testgen/qa)
     - createRun + attempt('committer');runNode + committer skill,Bash 白名单
       (允许 git 子命令,不允许 Write/Edit 避免绕过 QA)
     - 解析 SDK 最后一轮的 <COMMIT_SHA>...</COMMIT_SHA> 抽 SHA
     - createCommit 入库 → upsertFeature('done') + updateAttempt(passed)

4. lib/matrix.ts 加 'qa-passed' FeatureStatus 枚举值 + Badge 色
5. 详情页:
   · feature.status='tests-pending' → 显示「运行 QA」按钮
   · QA 完成后展示 qa-report 概览(AC 列表 + 每条 pass/fail 圆点 + 失败原因)
   · feature.status='qa-passed' → 显示「提交 Committer」按钮
   · done 时展示 commit SHA + message 预览
6. sandbox-java 初次需 git init(README 已有提示;route handler 检测无 .git 时
   返回 400 引导)

【约束】
- QA Worker 允许 Bash + Read + Write(但 Write 只能写 data/qa-reports/);
  Committer Worker 只允许 Bash 子集(git status / diff / add src / commit),
  不允许 Write/Edit(避免模型自己改代码绕过 QA)
- 模型不许用 QA 阶段去改 Handler 代码(那是 G10 跨节点 fix-task 的事)
- mvn test 超时 10 分钟(允许长测试)
- Committer 不 push;不开 PR
- commit message 必须含 featureId 与 contractId(SKILL 里强约束)

【通过信号】
1. pnpm -r typecheck 0 error
2. tests-pending feature → 「运行 QA」 → 全 AC pass →
   data/qa-reports/<featureId>/<runId>.yaml 存在,所有 acResults.status='pass' →
   feature.status: tests-pending → qa-passed
3. qa-passed feature → 「提交 Committer」→ 完成 →
   - cd sandbox-java && git log -1 → 看到 feat(...) commit,SHA 7 位匹配 UI
   - commit message body 含 contractId 字符串
   - feature.status: qa-passed → done
   - apps/portal/data/helmflow.db commits 表新增 1 行,gitSha 与 git log 一致
4. 故意把某 Action 改坏 → QA 跑 → 失败 AC 准确点名 → escalateAction='route-to-coder' →
   feature.status='blocked'(Committer 按钮不亮起,400 拒绝)
5. 存在性:
   · .claude/skills/helmflow-qa/SKILL.md
   · .claude/skills/helmflow-committer/SKILL.md
   · apps/portal/app/api/qa/run/route.ts
   · apps/portal/app/api/committer/run/route.ts
   · packages/storage commits 表 + repo 方法

完成后输出"Goal 9 验收清单"。
```

---

## 15. Goal 10 — Orchestrator + 跨节点 fix-task 自循环(Full-Loop MVP 完成线)

> 前置:G9 已 commit。5 节点都能单步走通。

### 15.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 G9 基础上完成 Full-Loop MVP 最后一块:Orchestrator 串联 5 节点,QA 失败时
自动生成 fix-task → 回退到 Coder(或 TestGen)+ reflection 喂回 prompt → 重跑 → 重 QA。
跨节点循环硬上限 3 轮,超出 → escalate(features.status='blocked')。详情页一键
「启动全流程」代替分步,/runs/<runId> 实时 timeline。前置:G9 已 commit。

【范围】
1. 新 packages/orchestrator/(@helmflow/orchestrator):
   · src/state-machine.ts:NODE_ORDER = ['coder','testgen','qa','committer'] +
     nextNode(current, lastOutcome) → 下一节点 / 'done' / 'blocked'
   · src/run-orchestrator.ts:
     runOrchestrator({contractId, emit}) 用 in-process async generator
     - 起一个 superRun(kind='full-loop')
     - 按 NODE_ORDER 串行调对应 route(内部直接调 runNode + 各自 critic)
     - 节点失败 / QA allPass=false → 解析 issues → createFixTask + createReflection →
       路由策略 routeFailedAc(issues) → 跳回上游节点重跑(iteration++)
     - 跨节点循环上限 3 轮(每个 feature)
2. 扩 packages/storage:
   · 新表 fix_tasks(id PK 'FT-<rand>', featureId, sourceRunId, failedAcId,
     expectedBehavior, actualBehavior, evidence TEXT, createdAt)
   · 新表 reflections(id PK 'REF-<rand>', featureId, attemptId, nodeName,
     criticName nullable, failureSummary, reflectionText, createdAt)
   · repo:createFixTask / listFixTasks / createReflection /
     listReflectionsForFeature(id, limit=5)
3. 扩 各 SKILL.md:user prompt builder 接受可选 reflectionAppendix,
   末尾追加 "## 历史反思(本 feature 最近 N 条)\n - ..."
4. 新 apps/portal/app/api/orchestrator/start/route.ts:POST {contractId} →
   查 contract.status='approved',spawn in-process orchestrator,立即返回 {superRunId};
   SSE 通过 /api/runs/<runId>/stream 拿全程事件
5. 新 apps/portal/app/api/runs/[runId]/stream/route.ts:GET → SSE,
   订阅 in-process 全局 EventEmitter(以 superRunId 为 key)
6. 新 apps/portal/app/runs/[runId]/page.tsx:5 节点 timeline + iteration 计数 +
   token 累计 + 每节点的子事件可展开
7. 详情页:contract.status='approved' 显示「启动全流程」(代替 G7-G9 分步按钮,
   分步按钮折叠到「手动模式」)。点击跳 /runs/<superRunId>

【约束】
- 跨节点循环硬上限 3 轮(比老 G9 的 8 轮更紧,因为每轮跑完整 Claude Code session
  代价更高,3 轮预算约 $5-10)
- reflection 每 feature 限载入最近 5 条(防 prompt 爆)
- Orchestrator 在 Next.js process 内跑(async generator + global Map<runId, Emitter>)
- 不实现 escalate-to-human UI(留 V2)

【通过信号】
1. pnpm -r typecheck 0 error
2. 简单 feature(如 D-02)启动全流程 → 30 分钟内无干预 status='done',sandbox-java
   有 commit
3. 故意 prompt 让 Coder 第一轮漏 sync action(如"实现交付保存,但忽略推流程节点"):
   - QA 抓 fail
   - reflections 表 +1 行 nodeName='coder'
   - Coder iteration=2
   - 第二轮通过 → status='done'
4. 详情页 /runs/<superRunId>:5 节点 timeline + 各节点 iteration + 总 token + 总耗时
5. 故意造 3 轮都修不好的场景 → status='blocked',timeline 显示 escalate 标记
6. 存在性:packages/orchestrator/src/run-orchestrator.ts /
   packages/storage 新加 fix_tasks + reflections /
   apps/portal/app/runs/[runId]/page.tsx /
   apps/portal/app/api/orchestrator/start/route.ts

完成后输出"Goal 10 验收清单",并打印"Full-Loop MVP 完结 🎉"。
```

### 15.2 G10 完成 = Full-Loop MVP 完成线

> 至此 5 节点 + Worker/Critic 内循环 + 跨节点 fix-task 全部跑通。
> 演示路径:浏览器开 D-XX → 一键启动 → 看 5 节点 timeline → 自动 commit。
> 一般 feature(2-3 AC)约 10-20 分钟、$3-8 token 成本。

---

## 16. Goal 11 — git worktree 隔离 + 多 feature 并发(产品化)

> 前置:G10 已 commit。Full-Loop MVP 已完成。

### 16.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 G10 基础上引入 git worktree 隔离:每个 feature 启动全流程时,在
sandbox-java/ 旁建一个 worktree(per featureId per superRunId),所有节点都在 worktree
内跑,完成后 Committer 节点把 worktree 合并回主 working tree。前置:G10 已 commit。

【范围】
1. 新 packages/sandbox-worktree/(@helmflow/sandbox-worktree):
   · createWorktree({sandboxPath, branchName}) → 在 sandbox-java/../worktrees/<name>
     用 git worktree add 建分支
   · removeWorktree(path) → git worktree remove + 删分支
   · mergeWorktreeIntoMain(workteePath, sandboxPath, commitMsg)
2. node-runner 支持 cwdMode: 'main' | 'worktree';orchestrator 在启动 superRun 时
   默认建一个 worktree,所有节点用 worktree 路径作 cwd
3. Committer 节点完成后,把 worktree merge 回 sandbox-java/ 主分支(fast-forward 或
   simple merge),失败时保留 worktree 给人审
4. 详情页:并发 superRun 时,首页矩阵每个 in-progress feature 显示「runtime
   indicator」(灰圈表示 idle、转圈表示在某节点)
5. 系统级 SSE:新增 /api/system/active-runs,列出当前所有 in-progress superRun
6. CLAUDE.md / README 写明 worktrees/ 不入主仓(.gitignore 加 apps/sandbox-java/../worktrees/)

【约束】
- 并发上限:全局 N=3(超过 N 排队),用 in-memory 信号量
- worktree 数最多 10 个;>10 时清理最旧已完成的
- Committer 失败的 worktree 保留 24h 后清理

【通过信号】
1. 同时启动 2 个不同 feature 的全流程 → 两个 worktree 同时存在 → 各自独立 mvn 不互踩
2. 两条 superRun 都 done → sandbox-java/ git log 看到 2 个新 commit
3. 第 4 个并发 superRun 进入排队状态,UI 可见 "queued"
4. 故意让某 Committer 失败 → worktree 保留 → 详情页提示「保留待人工排查」
5. 存在性:packages/sandbox-worktree/src/index.ts /
   apps/portal/app/api/system/active-runs/route.ts

完成后输出"Goal 11 验收清单"。
```

---

## 17. Goal 12 — 多项目接入(`helmcode.yaml` manifest)

> 前置:G11 已 commit。不只 mycmdeliverhub。

### 17.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 G11 基础上引入多项目接入:每个项目一份 helmcode.yaml manifest 声明
{name, sandboxPath, adapterType, standardsRoot, featureMatrixPath};Portal 顶部加项目
切换器;DB 按 projectId 分表前缀(或单库带 projectId 列)。前置:G11 已 commit。

【范围】
1. 新 packages/manifest-loader/(@helmflow/manifest-loader):
   · 解析 helmcode.yaml(zod 校验)
   · 列出可用项目(扫描 ./projects/*/helmcode.yaml 或 env HELMFLOW_PROJECTS_ROOT)
2. 扩 packages/storage:所有表加 project_id 列;repo 方法统一接 projectId 参数
3. 第二个 sample 项目:apps/sandbox-node/(express + jest,验证 adapter 抽象),
   manifest 用 adapterType: 'node-express'
4. 新 packages/adapter-node-express/:实现 ProjectAdapter(npm run test / build / etc.)
5. Portal:
   · 顶部加项目下拉(从 manifest-loader 拿)
   · cookie 持久化当前 projectId
   · 首页 / 详情页 / API 路由全部按 projectId 过滤
6. README 写明如何接入新项目(写 helmcode.yaml + 选 adapter)

【约束】
- 第一个项目固定 mycmdeliverhub(向后兼容,无 manifest 时回落)
- 跨项目数据隔离硬约束(SQL where 必带 project_id)
- adapter 工厂模式:adapter-core/registry 按 adapterType 选实现

【通过信号】
1. 新建 projects/sandbox-node/helmcode.yaml,Portal 顶部能看到 2 个项目
2. 切到 sandbox-node 项目 → 首页矩阵换成 sandbox-node 的 feature
3. 在 sandbox-node 项目跑全流程 → 用 adapter-node-express 调 npm test 通过 → done
4. 切回 mycmdeliverhub → 数据完全隔离,不串
5. 存在性:packages/manifest-loader/src/index.ts /
   packages/adapter-node-express/src/index.ts /
   apps/sandbox-node/

完成后输出"Goal 12 验收清单",并打印"HelmFlow MVP + 产品化全部完成 🚢"。
```

---

## 18. 跑 goal 的注意事项

### 18.1 一条 /goal 跑一段(不要串)

每条 /goal 跑完后:
1. **手动浏览器验证**(每条都有验证步骤,不能省)
2. **review 改了什么文件**:`git diff --stat`
3. **commit**:`git add . && git commit -m "feat: goal-N done"`(G4+ 改动跨 apps/portal/packages/apps/sandbox-java)
4. 然后才跑下一条

不要把多条 Goal 拼成一条 /goal —— 失败传染会浪费大量 token。

### 18.2 Haiku 评估器误判时怎么办

Haiku 文本匹配可能误判通过(比如它看到 "BUILD SUCCESS" 但实际页面渲染是错的)。每条 goal 跑完后**必须人工浏览器验证**,这是兜底。

### 18.3 上下文压力

Goal 1 完成后,会话上下文会比较满。**Goal 2 之前可以新开一个 Claude Code session**,在新 session 里直接跑 Goal 2 的 prompt(prompt 里"前置"那行明示了 Goal N-1 已 commit,新 session 也能正确接续)。G4+ 上下文压力更大(涉及 monorepo + Java),强烈建议**每条 goal 都新开 session**。

### 18.4 中间产物 commit

每条 goal 跑通后立即 commit。如果 Goal N 失败,可以 git revert 回 Goal N-1 状态重试,而不是污染前一条的代码。

### 18.5 sandbox-java 的 git 独立(G6+)

`apps/sandbox-java/` 在 G6 独立 `git init`,它的 commit 不入 helmflow 主仓(主仓只跟踪源文件,不跟踪 .git)。Committer 节点(G9)在 sandbox-java 内 commit,helmflow 主仓里不会看到这些 commit,需要 `cd apps/sandbox-java && git log` 查看。

---

## 19. 失败回退总策略

```
goal 跑了 8 次连续 block(安全阀触发)
  ↓
看会话最后 3 个 turn 的错误信号是什么
  ↓
分类:
  ┌─ 编译/类型错误 → 用具体错误信息开新 session,精确指导修复
  ├─ 包未装 / 版本冲突 → 手动 pnpm install 修
  ├─ 浏览器渲染错(白屏)→ 看浏览器 console + Next dev server 日志
  ├─ Anthropic SDK 错(G3-G6)/ Agent SDK 错(G7+)→ 检查 .env.local + 重启 dev
  ├─ mvn 错(G6+)→ 手动 cd sandbox-java && mvn -X 看堆栈
  ├─ DB 损坏(G4+)→ rm apps/portal/data/helmflow.db,重启自动重建 migrations
  ├─ Orchestrator 死循环(G10)→ 降循环上限到 2,定位卡哪个 node
  ├─ Agent SDK tool_use 报 400(G7+)→ 模型名必须 claude-opus-4-7,带
  │                                  CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
  └─ AI 钻牛角尖反复改同一文件 → 手动改一次让它跳出循环

不可恢复时:
  git stash → 重置到上一条 goal commit → 重新跑当前 goal
```

---

## 20. token / 时间预算

| Goal | 预估 token(meta 编排) | 预估时长 | 预估文件数 | 备注 |
|------|---------------------|---------|----------|------|
| **Goal 1** | 60-120 万 | 30-60 分钟 | 11 个新增 | 实测约 80 万 |
| **Goal 2** | 40-80 万 | 20-40 分钟 | ~7 个新增/改 | — |
| **Goal 3** | 30-60 万 | 15-30 分钟 | ~4 个新增/改 | — |
| **Goal 4** | 80-150 万 | 40-80 分钟 | ~12 个新增/改 | monorepo 重构 |
| **Goal 5** | 50-100 万 | 25-50 分钟 | ~6 个新增/改 | — |
| **Goal 6** | 80-180 万 | 40-90 分钟 | ~10 个新增/改 | sample-java + adapter + Coder MVP 直连 |
| **Goal 7** | 100-180 万 | 50-100 分钟 | ~10 个新增/改 | 架构跃迁 + Clarifier 顺手回炉(合并) |
| **Goal 8** | 60-120 万 | 30-60 分钟 | ~5 个新增/改 | TestGen SKILL + route + critic |
| **Goal 9** | 80-150 万 | 40-80 分钟 | ~7 个新增/改 | QA + Committer 合并(沿用老 chain 风格) |
| **Goal 10** | 100-200 万 | 50-120 分钟 | ~8 个新增/改 | Orchestrator + UI timeline |
| **总计 G1-G10** | 680-1340 万 | 6-11 小时 | ~80 个 | **Full-Loop MVP 完成** |
| Goal 11 | 80-150 万 | 40-80 分钟 | ~6 个 | worktree 隔离(产品化) |
| Goal 12 | 100-180 万 | 50-100 分钟 | ~10 个 | 多项目 + adapter-node(产品化) |
| **总计 G1-G12** | 860-1670 万 | 8-14 小时 | ~96 个 | 完整产品化 |

按 Opus 4.7 当前价格(input $15/MTok,output $75/MTok),G1-G10 编排成本约 **$160-400**;G1-G12 约 **$200-500**。

**额外 LLM 运行成本**(模型自己跑 5 节点产代码,与编排成本独立):
- G6 直连版每个 feature 约 $1-5(spike 实测 D-05 一次 ~$0.6)
- G7+ 走 Agent SDK 每个 feature 约 $5-15(spike 简单测 3-turn 已 $1.24,5 节点完整跑会更高)
- 验证阶段(整 chain 跑 5-10 个 feature)约 $50-150

关键代码量大、复杂度低的 Goal(G1/G4 静态部分)可考虑用 Sonnet 4.6 跑,**编排成本可降到 $100-280**。运行成本不受影响(由智谱代理 + claude-opus-4-7 模型决定)。

---

## 21. 跑完 12 条 goal 之后

跑完 G1-G10,你会看到一个 **5 节点 agent loop 自动跑通的中台原型**,且**底座是 Claude Code**而非自撸:
- 在 Portal 上录入需求
- Clarifier(Claude Code session + 内置 deterministic Critic)产契约草稿
- 人审契约 → 一键启动全流程
- Coder/TestGen/QA/Committer 每个节点 = 一个有 stop 条件的 Claude Code session
- 全程 SSE timeline 可观测,失败有 reflection 累积,跨节点循环自动修复
- HelmFlow 自身只管编排、状态、UI;LLM 调用全部走 Claude Agent SDK

跑完 G11 / G12 后,产品形态:
- 多 feature 并发不互踩(每个 feature 在独立 git worktree 跑)
- 多项目接入(`helmcode.yaml` manifest + adapter 工厂)
- 第二个 sample 项目(`apps/sandbox-node` + adapter-node-express)验证 adapter 抽象不漏

`docs/architecture/full-loop-platform.md` 还有更后期路线(尚未拆 /goal):

- **Phase 3** — Docker / e2b 远程 sandbox(替代本地 mvn)+ Kubernetes 部署
- **Phase 4** — Portal 完整 UI(timeline 详细视图 / reflection viewer / PR 集成 / commit diff 浏览)
- **Phase 5** — 跨项目 skill library / Postgres / 钉钉飞书 webhook / 多租户

每个 Phase 跑完后回到本文档,把对应的 G13+/... 加进 goal-chain。本文档刻意只覆盖到「Full-Loop MVP + 单机产品化」(G1-G12),避免一次设计太多 goal。

---

## 附:每条 goal 文件清单速查

### Goal 1 产出
```
apps/portal/data/feature-matrix.yaml         (5 域 40 功能点完整数据)
apps/portal/lib/matrix.ts                    (yaml 加载 + 类型)
apps/portal/lib/utils.ts                     (cn helper)
apps/portal/components/ui/badge.tsx
apps/portal/components/ui/card.tsx
apps/portal/components/feature-card.tsx
apps/portal/components/domain-section.tsx
apps/portal/app/layout.tsx
apps/portal/app/page.tsx
apps/portal/next-env.d.ts
apps/portal/README.md
```

### Goal 2 产出
```
apps/portal/components/ui/button.tsx
apps/portal/components/ui/dialog.tsx
apps/portal/components/ui/textarea.tsx
apps/portal/components/start-feature-dialog.tsx
apps/portal/components/json-block.tsx
apps/portal/app/features/[id]/page.tsx
apps/portal/app/features/[id]/not-found.tsx
```

### Goal 3 产出
```
apps/portal/lib/clarifier-prompt.ts
apps/portal/app/api/clarify/route.ts
apps/portal/components/start-feature-dialog.tsx (修改,加真实按钮)
apps/portal/package.json (修改,加 @anthropic-ai/sdk)
apps/portal/README.md (修改,加 API key 说明)
apps/portal/.env.local (你手动建,不入仓)
```

### Goal 4 产出
```
pnpm-workspace.yaml                          (仓库根,新增)
package.json                                 (仓库根,新增,workspace 容器)
tsconfig.base.json                           (仓库根,新增)
packages/contract-schema/package.json
packages/contract-schema/src/index.ts        (Zod ContractSchema + parseContract)
packages/storage/package.json
packages/storage/src/schema.ts               (features/runs/node_attempts 表)
packages/storage/src/db.ts                   (createDb + 自动 migrate)
packages/storage/src/repo.ts                 (upsertFeature/createRun/...)
packages/storage/drizzle.config.ts
packages/storage/migrations/0000_init.sql
apps/portal/lib/db.ts                        (lazy createDb)
apps/portal/lib/sync-matrix.ts               (启动时同步 yaml → DB)
apps/portal/app/api/clarify/route.ts         (修改,接入 storage)
apps/portal/lib/matrix.ts                    (修改,getFeature 读 DB)
apps/portal/package.json                     (修改,加 workspace deps)
.gitignore                                   (修改,加 .db / data/runs/)
```

### Goal 5 产出
```
packages/agent-core/package.json
packages/agent-core/src/critics/clarifier-critic.ts
packages/agent-core/src/critics/types.ts
packages/storage/src/schema.ts               (修改,加 contracts 表)
packages/storage/migrations/0001_contracts.sql
apps/portal/app/api/clarify/route.ts         (修改,接入 critic + draft 持久化)
apps/portal/app/api/contracts/[id]/approve/route.ts
apps/portal/components/approve-contract-button.tsx
apps/portal/app/features/[id]/page.tsx       (修改,展示 draft 区)
```

### Goal 6 产出
```
apps/sandbox-java/pom.xml
apps/sandbox-java/src/main/java/com/helmflow/sample/Application.java
apps/sandbox-java/src/main/java/com/helmflow/sample/deliver/handler/.gitkeep
apps/sandbox-java/src/main/java/com/helmflow/sample/deliver/action/.gitkeep
apps/sandbox-java/src/test/java/com/helmflow/sample/deliver/.gitkeep
apps/sandbox-java/.gitignore
apps/sandbox-java/README.md
packages/adapter-core/package.json
packages/adapter-core/src/types.ts           (ProjectAdapter interface)
packages/adapter-java-ddd/package.json
packages/adapter-java-ddd/src/index.ts       (createJavaDddAdapter)
packages/agent-core/src/coder/coder-prompt.ts
packages/agent-core/src/coder/coder-worker.ts
apps/portal/app/api/coder/run/route.ts
apps/portal/components/run-coder-button.tsx
apps/portal/app/features/[id]/page.tsx       (修改,加 Coder 按钮)
```

### Goal 7 产出 — 依赖倒置 + Clarifier 顺手回炉
```
packages/agent-runner/package.json
packages/agent-runner/tsconfig.json
packages/agent-runner/src/env.ts                       (HELMFLOW_* → ANTHROPIC_* 映射)
packages/agent-runner/src/types.ts                     (NodeRunOptions / Event / Result)
packages/agent-runner/src/runner.ts                    (runNode 主入口,内部用 @anthropic-ai/claude-agent-sdk)
.claude/skills/helmflow-coder/SKILL.md                 (角色 + 强自包含规则 + vanilla-Java 6 范例)
.claude/skills/helmflow-clarifier/SKILL.md             (内容迁自 apps/portal/lib/clarifier-prompt.ts)
apps/portal/app/api/coder/run/route.ts                 (重写:调 runNode 而非直连 Anthropic)
apps/portal/app/api/clarify/route.ts                   (重写:调 runNode,保留 G5 critic + 2 轮 reflection)
apps/portal/components/run-coder-button.tsx            (修改:UI 渲染 tool_use / tool_result 事件)
apps/portal/components/start-feature-dialog.tsx        (修改:新增 tool_use 事件展示)
apps/portal/package.json                               (修改:去 @anthropic-ai/sdk + 加 @anthropic-ai/claude-agent-sdk)
apps/portal/next.config.mjs                            (修改:transpilePackages 加 agent-runner)
apps/portal/lib/clarifier-prompt.ts                    (删除:内容迁入 SKILL.md)
packages/agent-core/src/coder/coder-worker.ts          (删除:parser + writeFileSync + 路径白名单)
packages/agent-core/src/coder/coder-prompt.ts          (删除或留 stub:内容迁入 SKILL.md)
```

### Goal 8 产出 — TestGen 节点(SKILL 形态)
```
.claude/skills/helmflow-testgen/SKILL.md
packages/agent-core/src/critics/testgen-critic.ts
packages/contract-schema/src/test-ac-mapping.ts        (zod TestAcMappingSchema)
apps/portal/app/api/testgen/run/route.ts
apps/portal/components/run-testgen-button.tsx
apps/portal/app/features/[id]/page.tsx                 (修改:加 TestGen 入口 + mapping 展示)
apps/portal/lib/matrix.ts                              (修改:加 'tests-pending' FeatureStatus 枚举)
```

### Goal 9 产出 — QA + Committer(合并节点)
```
.claude/skills/helmflow-qa/SKILL.md
.claude/skills/helmflow-committer/SKILL.md
packages/agent-core/src/critics/qa-report-critic.ts
packages/contract-schema/src/qa-report.ts              (zod QaReportSchema)
packages/storage/src/schema.ts                         (修改:加 commits 表)
packages/storage/src/repo.ts                           (修改:加 createCommit / getLatestCommit)
packages/storage/src/db.ts                             (修改:DDL 加 commits 表)
apps/portal/app/api/qa/run/route.ts
apps/portal/app/api/committer/run/route.ts
apps/portal/components/run-qa-button.tsx
apps/portal/components/run-committer-button.tsx
apps/portal/app/features/[id]/page.tsx                 (修改:加 QA 入口 + report 渲染 + Committer 入口 + commit SHA 展示)
apps/portal/lib/matrix.ts                              (修改:加 'qa-passed' FeatureStatus 枚举)
```

### Goal 10 产出 — Orchestrator + 跨节点 fix-task(Full-Loop MVP 完成线)
```
packages/orchestrator/package.json
packages/orchestrator/src/state-machine.ts             (NODE_ORDER + nextNode)
packages/orchestrator/src/run-orchestrator.ts          (async generator 编排 5 节点)
packages/storage/src/schema.ts                         (修改:加 fix_tasks + reflections 表)
packages/storage/src/repo.ts                           (修改:createFixTask / createReflection / list*)
packages/agent-core/src/utils/reflection.ts            (buildReflectionAppendix)
.claude/skills/helmflow-coder/SKILL.md                 (修改:接受 reflectionAppendix)
.claude/skills/helmflow-testgen/SKILL.md               (同上)
apps/portal/app/api/orchestrator/start/route.ts
apps/portal/app/api/runs/[runId]/stream/route.ts       (SSE 订阅 orchestrator emitter)
apps/portal/app/runs/[runId]/page.tsx                  (5 节点 timeline UI)
apps/portal/app/features/[id]/page.tsx                 (修改:加「启动全流程」按钮)
```

### Goal 11 产出 — git worktree 隔离 + 多 feature 并发(产品化)
```
packages/sandbox-worktree/package.json
packages/sandbox-worktree/src/index.ts                 (createWorktree / removeWorktree / mergeBack)
packages/agent-runner/src/runner.ts                    (修改:支持 cwdMode='worktree')
packages/orchestrator/src/run-orchestrator.ts          (修改:启动时建 worktree)
apps/portal/app/api/system/active-runs/route.ts
apps/portal/components/active-runs-indicator.tsx       (首页矩阵卡片上的运行中圆圈)
apps/portal/app/page.tsx                               (修改:接入 active-runs)
.gitignore                                             (修改:加 apps/sandbox-java/../worktrees/)
README.md                                              (修改:并发限制说明)
```

### Goal 12 产出 — 多项目接入(`helmcode.yaml` manifest,产品化)
```
packages/manifest-loader/package.json
packages/manifest-loader/src/index.ts                  (zod 校验 + 列项目)
packages/storage/src/schema.ts                         (修改:所有表加 project_id 列 + 索引)
packages/storage/src/repo.ts                           (修改:所有 repo 方法接 projectId)
packages/adapter-node-express/package.json
packages/adapter-node-express/src/index.ts             (ProjectAdapter 实现 npm/jest)
apps/sandbox-node/package.json
apps/sandbox-node/helmcode.yaml                        (示例 manifest)
apps/sandbox-node/src/...                              (极简 express 项目骨架)
projects/mycmdeliverhub/helmcode.yaml                  (老项目补 manifest 文件)
apps/portal/components/project-switcher.tsx
apps/portal/app/layout.tsx                             (修改:顶部加项目下拉)
apps/portal/lib/current-project.ts                    (cookie 持久化 projectId)
apps/portal/app/page.tsx                               (修改:按 projectId 过滤矩阵)
README.md                                              (修改:接入新项目说明)
```
