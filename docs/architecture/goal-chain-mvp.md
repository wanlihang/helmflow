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
- [10. Goal 6 — sample-java 引入 + adapter-core + Coder Worker](#10-goal-6--sample-java-引入--adapter-core--coder-worker)
- [11. Goal 7 — TestGen + Compile Critic](#11-goal-7--testgen--compile-critic)
- [12. Goal 8 — QA Worker + Committer Worker](#12-goal-8--qa-worker--committer-worker)
- [13. Goal 9 — Orchestrator + 跨节点循环 + Reflection Log](#13-goal-9--orchestrator--跨节点循环--reflection-log)
- [14. 跑 goal 的注意事项](#14-跑-goal-的注意事项)
- [15. 失败回退总策略](#15-失败回退总策略)
- [16. token / 时间预算](#16-token--时间预算)
- [17. 跑完 9 条 goal 之后](#17-跑完-9-条-goal-之后)
- [附:每条 goal 文件清单速查](#附每条-goal-文件清单速查)

---

## 1. MVP 范围与不做的事

> **MVP 全景**:G1-G3 是 Portal MVP(看得见 + 能澄清需求);G4-G9 是 Full-Loop MVP
> (5 节点 agent loop 跑通,sample-java 项目自动生成 + 测试 + 提交)。
> G3 之后开始进入 agent loop。

### Portal MVP 必须有(G1-G3 已覆盖)

- ✅ 浏览器打开 `http://localhost:3000` 看到 mycmdeliverhub 的全景矩阵
- ✅ 5 域 × 40 功能点的卡片网格,每个卡片有状态色徽标
- ✅ 点击卡片进入 feature 详情页(契约元数据、AC、legacy/target 映射)
- ✅ "启动需求"按钮 + 对话框输入需求
- ✅ 模拟的 Clarifier 输出(Goal 2 是 mock,Goal 3 接真 Anthropic API)
- ✅ 内置 mycmdeliverhub 的 5 域 40 功能点完整矩阵数据(`feature-matrix.yaml`)

### Full-Loop MVP 增量(G4-G9)

- ✅ monorepo 重构(pnpm workspace + `packages/*`)
- ✅ Drizzle SQLite 持久化 + feature/contract/run 状态流转
- ✅ Clarifier Critic(可执行 check + 契约草稿/审批)
- ✅ `apps/sandbox-java` 极简 SOFABoot 目标项目
- ✅ Coder / TestGen / QA / Committer 4 节点真实接通
- ✅ Orchestrator 串联 + 跨节点 fix-task 循环 + Reflection log

### 不做(留给 Phase 2+,见 `full-loop-platform.md`)

- ❌ Docker sandbox(G6-G8 直接用本地 mvn + 主 working tree,不上 git worktree)
- ❌ 完整 fix-task yaml schema(简化为文本拼接喂下游 worker)
- ❌ PR 自动创建(G8 Committer 只本地 commit,不 push)
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

## 10. Goal 6 — sample-java 引入 + adapter-core + Coder Worker

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

## 11. Goal 7 — TestGen + Compile Critic

> 前置:Goal 6 已 commit。Coder 能生 Handler 代码。

### 11.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 Goal 6 基础上完成 Full-Loop Platform MVP 第 7 步:TestGen Worker 为每个 AC
生成 JUnit + Mockito 测试 + 写 test-ac-mapping.yaml;加 Compile Critic,Coder 和 TestGen
完成后调 adapter.build/test-compile,失败带错误反馈给上游 Worker 重跑 ≤2 轮。
前置:Goal 6 已 commit,sandbox-java 能 mvn compile。

【范围】
1. 扩 packages/agent-core/:
   - src/testgen/testgen-prompt.ts:buildTestGenSystemPrompt() 读
     standards/java-ddd/patterns/test.md + standards/java-ddd/test-standards.md
   - src/testgen/testgen-worker.ts:runTestGenWorker({contract, coderFiles, adapter,
     anthropicClient}) → stream Anthropic,要求输出严格 yaml frontmatter(列每个 test
     文件 path + 对应 AC id) + 一组 ```java 代码块 + 末尾一个 ```yaml 块
     test-ac-mapping.yaml 内容(对应 agent-protocol.md §2.3 schema)。
     解析后写文件到 sandbox-java/src/test/java/... + 写 mapping 到
     apps/portal/data/runs/<runId>/test-ac-mapping.yaml
2. 新建 packages/agent-core/src/critics/compile-critic.ts:
   - runCompileCritic({adapter, scope: 'main'|'test'}) → 调
     scope='main' → adapter.build({skipTests:true})
     scope='test' → adapter.build() + extra mvn test-compile(子进程)
     - 解析 mvn 输出,捕获 "[ERROR]" 行,返回 {pass, errors: string[]}
3. 改 apps/portal/app/api/coder/run/route.ts:Worker stream 完后调
   runCompileCritic(scope='main');pass → 不变;fail → 把 errors 拼成 reflection 文本,
   重新 invoke Coder Worker 一次(prompt 末尾加 reflection),≤2 轮;仍 fail →
   updateAttempt(failed) + features.status='blocked' + SSE 发 critic-fail 事件
4. 新 apps/portal/app/api/testgen/run/route.ts:POST {runId} →
   查 run.kind='coder' status='done',创建新 run kind='testgen' + attempt,
   读取 Coder 的输出文件列表(从 storage outputPath 拿)→ 调 testgen worker →
   完成后 runCompileCritic(scope='test')同样 2 轮循环;成功后 updateAttempt + run done +
   保持 features.status='implementing'(QA 才能改 done)
5. 详情页:Coder 完成后(从 storage 查最新 coder run)显示「运行 TestGen」按钮,
   点击打开 Dialog 流式输出,完成后展示 test-ac-mapping.yaml 渲染(简化:JsonBlock)

【约束】
- TestGen 输出文件只能落 sandbox-java/src/test/java/... 下
- mvn test-compile 调用 5 分钟超时
- 不引入 ArchUnit / smoke test(只 javac 编译通过)
- compile critic 只做 String.match 提取错误,不调 LLM
- Coder/TestGen 重跑次数硬上限 2 轮(包含初始 共 2 次)

【通过信号】
1. pnpm -r typecheck 0 error
2. 全链路一条 feature:G3 启动 → G5 审批 → G6 Coder 通过 → POST /api/testgen/run 完成
3. 完成后 cd apps/sandbox-java && mvn -q test-compile 退出码 0
4. apps/portal/data/runs/<testgenRunId>/test-ac-mapping.yaml 存在 + 包含至少 1 个 acId 映射
5. 故意把 Coder system prompt 临时改坏(改 coder-prompt.ts 加一行"必须省略所有 import")
   → 跑一次 → critic 应抓 → SSE 含 critic-fail 事件;改回 prompt 再跑应成功
6. 文件存在性:packages/agent-core/src/testgen/testgen-worker.ts /
   packages/agent-core/src/critics/compile-critic.ts /
   apps/portal/app/api/testgen/run/route.ts

完成后输出"Goal 7 验收清单"。
```

### 11.2 Goal 7 通过信号(Haiku 评估器看的字符串)

```
✅ pnpm -r typecheck: 0 error
✅ mvn -q test-compile 在 sandbox-java 内退出码 0
✅ ls data/runs/<runId>/test-ac-mapping.yaml 存在
✅ POST /api/testgen/run 完成 SSE 含 {"type":"done"}
✅ 故意调坏 prompt 跑 → SSE 含 {"type":"critic-fail"
```

### 11.3 Goal 7 跑完后人工验证

```
1. 一个 feature 走完 Clarifier+approve+Coder
2. 详情页出现「运行 TestGen」按钮 → 点击 → Dialog 流式输出
3. 完成后 ls sandbox-java/src/test/java/... → 出现新 Test 文件
4. cat data/runs/<runId>/test-ac-mapping.yaml → 看到 mappings 数组,每个 AC 有对应测试
5. cd sandbox-java && mvn test-compile → BUILD SUCCESS
6. 临时调坏 coder-prompt.ts(加一行错误指令)→ 重跑 Coder → Dialog 显示
   "Critic 校验失败" + errors 列表;改回后再跑成功
```

### 11.4 Goal 7 失败回退

| 现象 | 原因 | 处理 |
|------|------|------|
| TestGen 写的测试 import 不存在 | LLM 编了不存在的类 | system prompt 显式列出 sample-java 已有的所有 class FQN |
| mvn test-compile 找不到 surefire | scope 写错 | 用 mvn test-compile 而不是 mvn surefire:* |
| ac-mapping yaml 解析失败 | LLM 输出 yaml 缩进错 | 用 try/catch + 解析失败时把原文写文件,fail critic 让 worker 重生 |
| critic-loop 无限重试 | for 循环边界写错 | 用 `for (let i=0; i<2; i++)` 严格固定 2 次 |
| sandbox-java 项目状态变脏 | Coder/TestGen 失败留下半成品 | 每次新 run 开始前 git checkout sandbox-java/src/ 重置(可选) |

---

## 12. Goal 8 — QA Worker + Committer Worker

> 前置:Goal 7 已 commit。sandbox-java 能 mvn test-compile。

### 12.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 Goal 7 基础上完成 Full-Loop Platform MVP 第 8 步:QA Worker 跑 mvn test 解析
surefire 报告产 qa-report.yaml + Committer Worker 把 sandbox-java 改动 git format/add/
commit(不 push),feature.status 全链路从 implementing 走到 done 或 blocked。
前置:Goal 7 已 commit,sandbox-java 至少 mvn test-compile 过。

【范围】
1. 扩 packages/agent-core/:
   - src/qa/qa-worker.ts:runQaWorker({runId, adapter, acMappingPath}) →
     · adapter.testFull() 跑 mvn test
     · 解析所有 target/surefire-reports/*.txt:正则提取
       "Tests run: N, Failures: F, Errors: E, Skipped: S" 总览
       + 每个 testcase 的 fail/error 详细 stack trace
     · 读 ac-mapping.yaml,把 fail 的 test method 映射回 AC id
     · 输出 qa-report.yaml(对应 agent-protocol.md §2.4 schema):每个 acId 的 pass/fail
       + failureReason + suggestedFix(简单:用 fail 的第一行作为 hint)
     · 路由判断:全 pass → escalateAction='none';任意 fail → escalateAction='route-to-coder'
       (V1 简化不路由 testgen)
     · 写文件 data/runs/<runId>/qa-report.yaml,返回 { allPass: bool, report }
     · 纯解析无 LLM 调用
   - src/committer/committer-worker.ts:runCommitterWorker({adapter, runId, contract}) →
     · adapter.format()(失败降级跳过)
     · 在 sandbox-java 内 child_process exec git add src/ + git commit -m <message>
       (-m 用 commit message 模板:type=feat scope=<contract.domain> subject=<contract.featureId>
       body 含 contract 的 Problem Definition 头部 + AC 列表 + Refs 行 + Contract path)
     · 不 push,返回 { commitSha, message }
     · 纯执行无 LLM 调用
2. 新 apps/portal/app/api/qa/run/route.ts:POST {runId} →
   查 testgen run.kind='testgen' status='done',创建 run kind='qa' + attempt,
   调 runQaWorker → 写报告 → 完成时 updateAttempt(passed) +
   pass:upsertFeature(status='implementing' 仍保持);
   fail:upsertFeature(status='blocked') + run.state='done' but allPass=false
   返回 {ok, allPass, reportPath}
3. 新 apps/portal/app/api/committer/run/route.ts:POST {runId} →
   查 qa run status='done' 且 allPass=true,否则 400
   读 contract 信息 → 调 runCommitterWorker → 完成时 upsertFeature(status='done') +
   updateAttempt(passed) + run.state='done',返回 {ok, commitSha}
4. 详情页:
   - TestGen 完成后显示「运行 QA」按钮
   - QA run 完成后展示 qa-report.yaml(JsonBlock)+ 每个 AC pass/fail 列表(绿/红圆点)
   - QA allPass 且 status='implementing' 时显示「提交 Committer」按钮
   - Committer 完成显示 commit SHA + message 预览(<pre>)
5. 在 apps/sandbox-java 初始化时(README 里写明)用户手动 cd apps/sandbox-java && git init &&
   git add . && git commit -m "initial sample" 一次,后续 Committer 增量 commit

【约束】
- QA worker 纯解析,无 LLM 调用
- Committer worker 纯执行,无 LLM 调用
- Committer 只 git add src/ + commit,不 push 不开 PR
- mvn test 调用 10 分钟超时(test 可能比 compile 久)
- 失败的 AC 不自动重跑 Coder(那是 G9 Orchestrator 的事),G8 只做单步推进

【通过信号】
1. pnpm -r typecheck 0 error
2. 全链路一个 feature 走完 5 节点:Clarifier→approve→Coder→TestGen→QA→Committer
3. POST /api/qa/run 完成,data/runs/<runId>/qa-report.yaml 存在 + allPass=true
4. POST /api/committer/run 返回 {ok:true, commitSha:'xxxxxxx'}
5. cd apps/sandbox-java && git log --oneline → 看到新 commit,message 含 feature id + AC
6. features.status='done'
7. 故意改 sample-java 让某 test fail → QA report allPass=false,Committer 拒绝跑 400,
   features.status='blocked'
8. 文件存在性:packages/agent-core/src/qa/qa-worker.ts / committer/committer-worker.ts /
   apps/portal/app/api/qa/run/route.ts / committer/run/route.ts

完成后输出"Goal 8 验收清单"。
```

### 12.2 Goal 8 通过信号(Haiku 评估器看的字符串)

```
✅ pnpm -r typecheck: 0 error
✅ POST /api/qa/run 完成,qa-report.yaml allPass=true
✅ POST /api/committer/run 返回 {"ok":true,"commitSha":"...
✅ cd sandbox-java && git log --oneline ≥ 2 行(initial + Committer)
✅ features.status = "done"
```

### 12.3 Goal 8 跑完后人工验证

```
1. 一条新 feature 走完 G3→G5→G6→G7
2. 详情页「运行 QA」→ 点击 → 几十秒后 QA 报告展示,每个 AC 绿圆点
3. 「提交 Committer」按钮亮起 → 点击 → 完成后展示 commit SHA + message
4. cd apps/sandbox-java && git log --oneline → 看到 feat(domain): F-XX ...
5. 首页 feature badge → done(绿)
6. 故意把 src/main/java 某个 Handler 改坏 → 详情页跑 QA → allPass=false → badge=blocked
```

### 12.4 Goal 8 失败回退

| 现象 | 原因 | 处理 |
|------|------|------|
| mvn test 找不到测试 | surefire-reports 目录不存在 | 先确认 G7 生成的 test 文件 package 名正确 |
| surefire 报告解析错误 | regex 没匹配 xml/txt 格式 | 切到 target/surefire-reports/*.txt 而非 *.xml(更稳) |
| Committer git add 失败 | sandbox-java 没 git init | README 已写手动 init 一次;route handler 检测到无 .git 时返回 400 + 提示 |
| commit message 含特殊字符 | featureId/contract 含引号 | 用 child_process 的 args 数组形式,不要拼字符串 |
| feature.status 不变 | upsertFeature 在 worker 失败前调用 | 在 try/catch finally 后再 upsertFeature(对应 status) |

---

## 13. Goal 9 — Orchestrator + 跨节点循环 + Reflection Log

> 前置:Goal 8 已 commit。5 节点都能单步跑通。

### 13.1 复制粘贴到 Claude Code 的完整文本

```
/goal 在 Goal 8 基础上完成 Full-Loop MVP 第 9 步:Orchestrator 状态机串联 5 节点,任意
节点失败按 routeFailedAc 反馈给上游 Worker 重跑(QA fail→Coder/TestGen),跨节点循环上限
8 轮;新 reflections 表跨 attempt 累积反思,下次 Worker prompt 末尾自动注入;详情页
「启动全流程」按钮代替分步,SSE timeline 展示 5 节点进度。前置:Goal 8 已 commit,5
节点独立可跑。

【范围】
1. 新 packages/orchestrator/(@helmflow/orchestrator):
   · src/state-machine.ts:导出 NODE_ORDER=['coder','testgen','qa','committer'] +
     nextNode(current,lastResult)→ 下一节点 / 'done' / 'blocked'
   · src/run-orchestrator.ts:runOrchestrator({contractId,anthropicClient,
     sampleJavaPath,emit:(event)=>void})→ 创建 superRun(kind='full-loop')+ 串行跑
     coder→testgen→qa→committer。任意 worker fail:从 storage 拉历史 reflections,
     issues 拼 reflectionText,createReflection({featureId,nodeName,reflectionText}),
     重 invoke 同 node Worker(iteration++)。QA allPass=false:解析第一条
     failureReason,routeFailedAc 路由(简化:NPE/编译错→coder,其他→coder),创建
     对应 node 新 attempt 带 fixTaskText 跳回继续。跨节点循环硬上限 8 轮,超出 →
     updateRun(blocked)+emit('run.error')。
2. 扩 packages/storage:新表 reflections(id PK 'REF-<rand>',featureId FK,attemptId FK,
   nodeName,criticName nullable,failureSummary,reflectionText,createdAt)+
   createReflection / listReflectionsForFeature(featureId,limit=5)。
3. 扩 packages/agent-core/:
   · src/utils/reflection.ts:buildReflectionAppendix(reflections)→
     "## 历史反思\n - REF-001 (coder iter 2): ...\n"
   · 改 coder/testgen worker:接受可选 reflectionAppendix,system prompt 末尾追加
4. 新 app/api/runs/[runId]/stream/route.ts:GET→SSE,代理 orchestrator emit 事件
   (node.started/node.token/node.passed/node.failed/fix-task.issued/reflection.added/
   run.completed),对应 full-loop-platform.md §4.2 OrchestrationEvent。
5. 新 app/api/orchestrator/start/route.ts:POST {contractId}→ 查 status='approved',
   spawn 一个 in-process worker 异步跑 runOrchestrator,立即返回 {runId};SSE 通过
   /api/runs/<runId>/stream 拿。
6. 详情页改:contract.status='approved' 显「启动全流程」按钮(代替 G6/G7/G8 分步,
   旧按钮折叠为「手动模式」)。点击 → 跳到 /runs/<runId>。
7. 新 app/runs/[runId]/page.tsx:timeline(5 节点 + iteration 计数 + status icon +
   token 累计),订阅 SSE stream 实时更新。

【约束】
- 跨节点循环硬上限 8 轮,超出 escalate(features.status='blocked')
- 不实现 escalate-to-human UI(留 V1)
- fix-task 简化为字符串 reflectionText,不写完整 yaml schema
- reflection 每 feature 限载入最近 5 条(防 prompt 爆)
- Orchestrator 在 Next.js process 内跑(async generator),不开独立 worker thread

【通过信号】
1. pnpm -r typecheck 0 error
2. 简单 feature(如 D-02 无 legacy)启动全流程,30 分钟内无干预 status='done'
   sandbox-java 有 commit
3. 故意 prompt 让 Coder 第一轮漏 sync action(如"实现交付保存,但忽略推流程节点"):
   - QA 抓 fail
   - reflections 表 +1 行 nodeName='coder'
   - Coder iteration=2
   - 第二轮通过 → status='done'
4. 详情页 /runs/<runId>:5 节点 timeline + 各节点 iteration + 总 token
5. 存在性:packages/orchestrator/src/run-orchestrator.ts /
   packages/storage 新加 reflections schema / apps/portal/app/runs/[runId]/page.tsx /
   apps/portal/app/api/orchestrator/start/route.ts

完成后输出"Goal 9 验收清单"并打印"Full-Loop MVP 完结"。
```

### 13.2 Goal 9 通过信号(Haiku 评估器看的字符串)

```
✅ pnpm -r typecheck: 0 error
✅ POST /api/orchestrator/start 返回 {"runId":"run-...
✅ SSE /api/runs/<runId>/stream 收到 ≥ 5 个 node.started 事件
✅ 最终事件含 {"type":"run.completed","state":"done"
✅ sqlite3 reflections 表 count ≥ 1(故障重试 case)
✅ Full-Loop MVP 完结
```

### 13.3 Goal 9 跑完后人工验证

```
1. 浏览器 D-02(或任意已审批 feature)→ 「启动全流程」→ 跳到 /runs/<runId>
2. timeline 展示 5 节点 pipeline + iteration 数字 + token 总计
3. 实时看每节点状态 icon 变化(灰→蓝→绿/红)
4. 全过程无干预,~10-20 分钟后 status='done',sandbox-java git log 多一个 commit
5. 故意造重试 case → 看到 coder iteration=2 + reflection.added 事件
6. blocked case:8 轮后看到 run.error,详情页显示 reflection 历史
```

### 13.4 Goal 9 失败回退

| 现象 | 原因 | 处理 |
|------|------|------|
| Orchestrator 在 dev 模式断 | Next dev hot reload 杀进程 | 用 ` --turbo=false` 或把 Orchestrator 跑在独立 child process |
| SSE 多客户端互相干扰 | EventEmitter 共享 | 每个 runId 独立 emitter,store 用 Map<runId, EventEmitter> |
| reflection 累积爆 prompt | limit 没生效 | listReflectionsForFeature(featureId, 5) 严格限制 |
| 死循环不退出 | 8 轮上限判断错 | for 循环 + break 而非 while + 计数器 |
| timeline UI 不实时 | EventSource 没正确连接 | 用 React useEffect + new EventSource(url),onmessage 累积事件 |

---

## 14. 跑 goal 的注意事项

### 14.1 一条 /goal 跑一段(不要串)

每条 /goal 跑完后:
1. **手动浏览器验证**(每条都有验证步骤,不能省)
2. **review 改了什么文件**:`git diff --stat`
3. **commit**:`git add . && git commit -m "feat: goal-N done"`(G4+ 改动跨 apps/portal/packages/apps/sandbox-java)
4. 然后才跑下一条

不要把多条 Goal 拼成一条 /goal —— 失败传染会浪费大量 token。

### 14.2 Haiku 评估器误判时怎么办

Haiku 文本匹配可能误判通过(比如它看到 "BUILD SUCCESS" 但实际页面渲染是错的)。每条 goal 跑完后**必须人工浏览器验证**,这是兜底。

### 14.3 上下文压力

Goal 1 完成后,会话上下文会比较满。**Goal 2 之前可以新开一个 Claude Code session**,在新 session 里直接跑 Goal 2 的 prompt(prompt 里"前置"那行明示了 Goal N-1 已 commit,新 session 也能正确接续)。G4+ 上下文压力更大(涉及 monorepo + Java),强烈建议**每条 goal 都新开 session**。

### 14.4 中间产物 commit

每条 goal 跑通后立即 commit。如果 Goal N 失败,可以 git revert 回 Goal N-1 状态重试,而不是污染前一条的代码。

### 14.5 sandbox-java 的 git 独立(G6+)

`apps/sandbox-java/` 在 G6 独立 `git init`,它的 commit 不入 helmflow 主仓(主仓只跟踪源文件,不跟踪 .git)。Committer 节点(G8)在 sandbox-java 内 commit,helmflow 主仓里不会看到这些 commit,需要 `cd apps/sandbox-java && git log` 查看。

---

## 15. 失败回退总策略

```
goal 跑了 8 次连续 block(安全阀触发)
  ↓
看会话最后 3 个 turn 的错误信号是什么
  ↓
分类:
  ┌─ 编译/类型错误 → 用具体错误信息开新 session,精确指导修复
  ├─ 包未装 / 版本冲突 → 手动 pnpm install 修
  ├─ 浏览器渲染错(白屏)→ 看浏览器 console + Next dev server 日志
  ├─ Anthropic API 错(G3+)→ 检查 .env.local + 重启 dev server
  ├─ mvn 错(G6+)→ 手动 cd sandbox-java && mvn -X 看堆栈
  ├─ DB 损坏(G4+)→ rm apps/portal/data/helmflow.db,重启自动重建 migrations
  ├─ Orchestrator 死循环(G9)→ 降循环上限到 3,定位卡哪个 node
  └─ AI 钻牛角尖反复改同一文件 → 手动改一次让它跳出循环

不可恢复时:
  git stash → 重置到上一条 goal commit → 重新跑当前 goal
```

---

## 16. token / 时间预算

| Goal | 预估 token(输入+输出) | 预估时长 | 预估文件数 |
|------|---------------------|---------|----------|
| **Goal 1** | 60-120 万 | 30-60 分钟 | 11 个新增 |
| **Goal 2** | 40-80 万 | 20-40 分钟 | ~7 个新增/改 |
| **Goal 3** | 30-60 万 | 15-30 分钟 | ~4 个新增/改 |
| **Goal 4** | 80-150 万 | 40-80 分钟 | ~12 个新增/改(monorepo 大幅重构) |
| **Goal 5** | 50-100 万 | 25-50 分钟 | ~6 个新增/改 |
| **Goal 6** | 80-180 万 | 40-90 分钟 | ~10 个新增/改(sample-java + adapter + Coder) |
| **Goal 7** | 60-120 万 | 30-60 分钟 | ~6 个新增/改 |
| **Goal 8** | 60-120 万 | 30-60 分钟 | ~6 个新增/改 |
| **Goal 9** | 100-200 万 | 50-120 分钟 | ~8 个新增/改(Orchestrator + UI timeline) |
| **总计 G1-G9** | 560-1130 万 | 5-10 小时 | ~70 个 |

按 Opus 4.7 当前价格(input $15/MTok,output $75/MTok),9 条 goal 总成本约 **$130-340**。
G6-G9 还会消耗真实 LLM token 跑 Coder/TestGen(每个 feature ~$1-5),验证阶段约 $10-20。
关键代码量大、复杂度低的 Goal(G1/G4/G6 静态部分)可考虑用 Sonnet 4.6 跑,总成本可降到 **$70-180**。

---

## 17. 跑完 9 条 goal 之后

跑完 G1-G9,你会看到一个 **5 节点 agent loop 自动跑通的中台原型**:
- 在 Portal 上录入需求
- Clarifier(LLM)+ Critic(deterministic)产契约草稿
- 人审契约 → 一键启动全流程
- Coder/TestGen 自动生 Java + 单测,QA 自动跑 mvn test,Committer 自动 git commit
- 全程 SSE timeline 可观测,失败有 reflection 累积,跨节点循环自动修复

`docs/architecture/full-loop-platform.md` 还有 Phase 2+ 路线图(尚未拆成 /goal):

- **Phase 2** — Docker sandbox(替代主 working tree)+ git worktree 隔离
- **Phase 3** — 多项目接入(adapter-node-express 第二种 adapter,验证抽象)
- **Phase 4** — Portal 完整 UI(timeline 详细视图 / reflection viewer / PR 集成 / commit diff 浏览)
- **Phase 5** — 学习与生产化(跨项目 skill library / Postgres / 钉钉飞书 webhook / e2b 远程 sandbox)

每个 Phase 跑完后回到本文档,把对应的 G10+/G11+/... 加进 goal-chain。本文档刻意只覆盖 Full-Loop MVP(G1-G9),避免一次设计太多 goal。

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

### Goal 7 产出
```
packages/agent-core/src/testgen/testgen-prompt.ts
packages/agent-core/src/testgen/testgen-worker.ts
packages/agent-core/src/critics/compile-critic.ts
apps/portal/app/api/coder/run/route.ts       (修改,接入 compile critic + reflection 重试)
apps/portal/app/api/testgen/run/route.ts
apps/portal/components/run-testgen-button.tsx
apps/portal/app/features/[id]/page.tsx       (修改,加 TestGen 按钮 + ac-mapping 显示)
```

### Goal 8 产出
```
packages/agent-core/src/qa/qa-worker.ts
packages/agent-core/src/committer/committer-worker.ts
apps/portal/app/api/qa/run/route.ts
apps/portal/app/api/committer/run/route.ts
apps/portal/components/run-qa-button.tsx
apps/portal/components/run-committer-button.tsx
apps/portal/app/features/[id]/page.tsx       (修改,加 QA report + Committer 区)
```

### Goal 9 产出
```
packages/orchestrator/package.json
packages/orchestrator/src/state-machine.ts
packages/orchestrator/src/run-orchestrator.ts
packages/storage/src/schema.ts               (修改,加 reflections 表)
packages/storage/migrations/0002_reflections.sql
packages/agent-core/src/utils/reflection.ts
packages/agent-core/src/coder/coder-worker.ts        (修改,支持 reflectionAppendix)
packages/agent-core/src/testgen/testgen-worker.ts    (修改,同上)
apps/portal/app/api/orchestrator/start/route.ts
apps/portal/app/api/runs/[runId]/stream/route.ts
apps/portal/app/runs/[runId]/page.tsx
apps/portal/app/features/[id]/page.tsx       (修改,加「启动全流程」按钮)
```
