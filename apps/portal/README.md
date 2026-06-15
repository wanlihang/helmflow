# HelmCode Portal

Full-Loop AI Coding Platform — 业务场景 × 功能点全景视图(MVP Goal 1 → 3)。

## 快速启动

```bash
cd apps/portal
pnpm install
pnpm dev
```

打开 <http://localhost:3000> 看 5 域 40 功能点全景。

## 当前能力

- **Goal 1** 首页全景:5 域 × 40 功能点 grid + 7 状态图例
- **Goal 2** feature 详情页:`/features/[id]`,Legacy / Target 双栏 + 启动需求 Dialog
- **Goal 3** Clarifier 接通真实 Anthropic Claude:`POST /api/clarify` 走 SSE 流式输出

数据源:`data/feature-matrix.yaml`(mycmdeliverhub)。

## Goal 3 配置 ANTHROPIC_API_KEY

真实 Clarifier 通过 `app/api/clarify/route.ts` 调 Anthropic Messages API,
**仅在服务器端读取环境变量**,key 不会暴露到前端。

在 `apps/portal/.env.local`(`.gitignore` 已忽略)写:

```bash
# 必填(项目命名空间,避免与 Claude Code 等工具注入的 shell env 冲突)
HELMFLOW_ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx

# 可选;不填默认 https://api.anthropic.com,可指向兼容代理(智谱 / 自建网关 / ...)
HELMFLOW_ANTHROPIC_BASE_URL=https://api.anthropic.com

# 可选;不填默认 claude-opus-4-7
CLARIFIER_MODEL=claude-opus-4-7
```

### 为什么用 `HELMFLOW_` 前缀?

Next.js `.env.local` **不会覆盖** shell 继承的 env 变量。如果你的 shell 里有
`ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`(例如 Claude Code 注入的本地代理
`http://127.0.0.1:15721`),`.env.local` 里的同名变量会被忽略,SDK 会打到错
路径。用项目专属前缀彻底避免冲突。

route 仍兼容 `ANTHROPIC_*` 作为回退,但优先级低于 `HELMFLOW_*`。

重启 `pnpm dev` 让 Next.js 加载新 env。

### 验证

```bash
curl -X POST http://localhost:3000/api/clarify \
  -H "Content-Type: application/json" \
  -d '{"featureId":"D-01","userRequest":"测试"}' \
  --max-time 60 -N
```

应看到一连串 `data: {"type":"token","text":"..."}` SSE 事件,
最后以 `data: {"type":"done"}` 结束。

### 前端入口

在任意 feature 详情页点「启动需求」,Dialog 中有两个按钮:
- **运行 Clarifier(真实)**:走 `/api/clarify`,需要 `ANTHROPIC_API_KEY`
- **运行 Clarifier(Mock)**:本地 100ms/字打字机,不依赖任何外部服务,便于离线演示

## 技术栈

Next.js 15 (App Router) · React 19 · Tailwind 3.4 · TypeScript strict ·
`@anthropic-ai/claude-agent-sdk` 0.3.x(via `@helmflow/agent-runner`) · `@radix-ui/react-dialog`
