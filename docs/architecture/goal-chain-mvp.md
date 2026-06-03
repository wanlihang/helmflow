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
- [7. Goal 3 — 真实 Anthropic Clarifier 接通(可选)](#7-goal-3--真实-anthropic-clarifier-接通可选)
- [8. 跑 goal 的注意事项](#8-跑-goal-的注意事项)
- [9. 失败回退总策略](#9-失败回退总策略)
- [10. token / 时间预算](#10-token--时间预算)

---

## 1. MVP 范围与不做的事

### MVP 必须有(本文档 3 条 /goal 覆盖)

- ✅ 浏览器打开 `http://localhost:3000` 看到 mycmdeliverhub 的全景矩阵
- ✅ 5 域 × 40 功能点的卡片网格,每个卡片有状态色徽标
- ✅ 点击卡片进入 feature 详情页(契约元数据、AC、legacy/target 映射)
- ✅ "启动需求"按钮 + 对话框输入需求
- ✅ 模拟的 Clarifier 输出(Goal 2 是 mock,Goal 3 接真 Anthropic API)
- ✅ 内置 mycmdeliverhub 的 5 域 40 功能点完整矩阵数据(`feature-matrix.yaml`)

### MVP 不做(留给后续 Phase)

- ❌ 5 节点全套 agent(Coder/TestGen/QA/Committer 不实现)
- ❌ Docker sandbox / git worktree
- ❌ 跨节点 fix-task 循环
- ❌ ArchUnit / BootContextSmokeTest 集成
- ❌ 多项目接入(目前只支持 mycmdeliverhub 一份内置数据)
- ❌ 持久化数据库(MVP 内存或文件即可,SQLite/Drizzle 留给 Phase 1)
- ❌ 认证 / 多用户 / 权限
- ❌ 部署 Docker Compose

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
```

如果没装 pnpm:`npm install -g pnpm` —— 这个由你手动跑,不要让 /goal 内自己装。

### Anthropic API Key(只 Goal 3 需要)

```bash
# 在 apps/portal/.env.local 写入(Goal 3 之前):
ANTHROPIC_API_KEY=sk-ant-...
```

`.env.local` 已被 `.gitignore` 屏蔽,不会入仓。

### 打开 Claude Code

在 helmcode 仓库根目录打开 Claude Code。每条 /goal 都在这个 session 里跑。

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

## 7. Goal 3 — 真实 Anthropic Clarifier 接通(可选)

> 前置:Goal 2 已 commit + `apps/portal/.env.local` 有 `ANTHROPIC_API_KEY`。

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

## 8. 跑 goal 的注意事项

### 8.1 一条 /goal 跑一段(不要串)

每条 /goal 跑完后:
1. **手动浏览器验证**(每条都有验证步骤,不能省)
2. **review 改了什么文件**:`git diff --stat`
3. **commit**:`git add apps/portal && git commit -m "feat(portal): goal-N done"`
4. 然后才跑下一条

不要把 Goal 1+2+3 拼成一条 /goal —— 失败传染会浪费大量 token。

### 8.2 Haiku 评估器误判时怎么办

Haiku 文本匹配可能误判通过(比如它看到 "BUILD SUCCESS" 但实际页面渲染是错的)。每条 goal 跑完后**必须人工浏览器验证**,这是兜底。

### 8.3 上下文压力

Goal 1 完成后,会话上下文会比较满。**Goal 2 之前可以新开一个 Claude Code session**,在新 session 里直接跑 Goal 2 的 prompt(prompt 里"前置"那行明示了 Goal 1 已 commit,新 session 也能正确接续)。

### 8.4 中间产物 commit

每条 goal 跑通后立即 commit。如果 Goal 2 失败,可以 git revert 回 Goal 1 状态重试,而不是污染 Goal 1 的代码。

---

## 9. 失败回退总策略

```
goal 跑了 8 次连续 block(安全阀触发)
  ↓
看会话最后 3 个 turn 的错误信号是什么
  ↓
分类:
  ┌─ 编译/类型错误 → 用具体错误信息开新 session,精确指导修复
  ├─ 包未装 / 版本冲突 → 手动 pnpm install 修
  ├─ 浏览器渲染错(白屏)→ 看浏览器 console + Next dev server 日志
  ├─ Anthropic API 错(Goal 3)→ 检查 .env.local + 重启 dev server
  └─ AI 钻牛角尖反复改同一文件 → 手动改一次让它跳出循环

不可恢复时:
  git stash → 重置到上一条 goal commit → 重新跑当前 goal
```

---

## 10. token / 时间预算

| Goal | 预估 token(输入+输出) | 预估时长 | 预估文件数 |
|------|---------------------|---------|----------|
| **Goal 1** | 60-120 万 | 30-60 分钟 | 11 个新增 |
| **Goal 2** | 40-80 万 | 20-40 分钟 | ~7 个新增/改 |
| **Goal 3** | 30-60 万 | 15-30 分钟 | ~4 个新增/改 |
| **总计** | 130-260 万 | 1.5-2 小时 | ~23 个 |

按 Opus 4.7 当前价格(input $15/MTok,output $75/MTok),3 条 goal 总成本约 $30-80。如果 Goal 1 用 Sonnet 4.6 跑(代码量大、复杂度低),可降到 $15-40。

---

## 11. 跑完 3 条 goal 之后

完整 MVP 跑通后,你会看到一个**可浏览器打开、可点击钻取、可启动需求并看真实 AI 流式输出契约**的中台原型。

下一步参考方案文档:
- `docs/architecture/full-loop-platform.md` Phase 1 — 加 Coder/TestGen/QA/Committer 4 个真实 agent + 跨节点 fix-task 循环
- Phase 2 — Docker sandbox + git worktree
- Phase 3 — 多项目接入(node-express adapter)
- Phase 4 — Portal 完整 UI(timeline / reflection viewer / PR 集成)

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
