# Monorepo 仓库结构 — Full-Loop Platform

> 基于 pnpm workspace + Turbo 2,packages 拆分严格遵循"单一职责 + 可独立测试"原则。

---

## 1. 顶层布局

```
helmcode/                                    # 现有 HelmCode 仓库
├── packages/                                # 共享 lib(纯 TS,无运行时)
│   ├── agent-core/                          # Agent 编排核心(Worker + Critic 模式)
│   ├── contract-schema/                     # 行为契约 / fix-task / reflection-log Zod schema
│   ├── matrix-schema/                       # feature-matrix.yaml + helmcode.yaml schema
│   ├── adapter-core/                        # 项目适配器抽象 + 内置 java-ddd / node 适配器
│   ├── sandbox/                             # Docker + git worktree 执行沙箱
│   ├── storage/                             # Drizzle schema + repository pattern
│   └── shared/                              # 工具函数 / 错误类型 / 日志
│
├── apps/                                    # 可运行应用
│   ├── portal/                              # Next.js 15 web UI(全景 + 单 feature 钻取)
│   ├── orchestrator/                        # 后端编排服务(Next API routes 或独立 Hono)
│   └── cli/                                 # helmcode CLI(沿用现有 bin/helmcode.mjs 升级)
│
├── infra/                                   # 部署配置
│   ├── docker/                              # Dockerfile + docker-compose.yml
│   ├── sandbox-images/                      # 预热的 sandbox 镜像 Dockerfile
│   │   ├── java-ddd-sofa-21/
│   │   └── node-express-20/
│   └── migrations/                          # Drizzle migration 输出
│
├── core/                                    # 现有 HelmCode skills(保留,作为 agent-core 的 prompt 来源)
│   ├── clarify/
│   ├── implement/
│   ├── verify/
│   └── ...
│
├── standards/                               # 现有标准(保留)
│   └── java-ddd/
│
├── docs/
│   └── architecture/                        # 本目录:方案文档
│       ├── README.md                        # 索引
│       ├── full-loop-platform.md            # 总体架构
│       ├── tech-stack-rationale.md          # 技术栈决策(本文档同级)
│       ├── repo-structure.md                # 本文件
│       └── agent-protocol.md                # 节点协议
│
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── tsconfig.base.json                       # 共享 TS 配置
├── biome.json                               # Biome 配置
└── README.md / README.zh-CN.md              # 现有
```

---

## 2. 各 package 职责

### 2.1 `packages/agent-core` — 节点编排核心

**职责**:封装 5 个 Agent 节点的 Worker + Critic 执行模型;不关心存储、沙箱、UI。

```
packages/agent-core/
├── src/
│   ├── nodes/
│   │   ├── clarifier.ts              # 节点 1:需求 → 行为契约
│   │   ├── coder.ts                  # 节点 2:契约 → 代码
│   │   ├── test-gen.ts               # 节点 3:代码 → 测试
│   │   ├── qa-tester.ts              # 节点 4:跑测试 + 找 gap
│   │   └── committer.ts              # 节点 5:格式化 + commit + PR
│   ├── critics/
│   │   ├── base.ts                   # ArchCondition-like 接口
│   │   ├── contract-critic.ts        # 校验契约 AC 可程序验证
│   │   ├── code-critic.ts            # 调 sandbox 跑 mvn compile + ArchUnit
│   │   ├── test-critic.ts            # 校验 AC ↔ test 映射
│   │   └── qa-critic.ts              # 校验测试报告与 AC 完整性
│   ├── runtime/
│   │   ├── worker-loop.ts            # Worker 自循环(Self-Refine)
│   │   ├── critic-runner.ts          # Critic 独立调用(无 Worker 上下文污染)
│   │   ├── reflection.ts             # 跨节点 reflection 累积
│   │   └── escalation.ts             # 失败后回退/上人工策略
│   ├── prompts/
│   │   ├── clarifier.system.md       # 从 core/clarify/SKILL.md 抽取
│   │   ├── coder.system.md
│   │   └── ...
│   └── index.ts                      # public API
├── tests/
└── package.json
```

**对外 API**:
```typescript
import { runNode, type NodeName, type NodeInput, type NodeOutput } from '@helmcode/agent-core';

const result: NodeOutput = await runNode('coder', {
  contract: ContractFile,
  reflection: ReflectionLog,
  fixTask?: FixTask,
  sandbox: SandboxHandle,
});
```

**依赖**:`@anthropic-ai/sdk`、`packages/contract-schema`、`packages/sandbox`(注入,不直接依赖)。

---

### 2.2 `packages/contract-schema` — 类型化协议

**职责**:用 Zod 定义所有跨节点协议的 schema,运行时校验 + 编译时类型推导一体化。

```
packages/contract-schema/
├── src/
│   ├── contract.ts                   # 行为契约 frontmatter + 章节 schema
│   ├── fix-task.ts                   # QA → Coder 的 gap 反馈
│   ├── reflection.ts                 # 跨节点共享的反思日志
│   ├── judgment-log.ts               # ⚠️ 决策项
│   ├── matrix.ts                     # feature-matrix.yaml schema
│   ├── manifest.ts                   # helmcode.yaml schema(项目接入)
│   ├── orchestration.ts              # .claude/orchestration/{F-ID}.yaml schema
│   └── index.ts
├── tests/
└── package.json
```

**示例**:
```typescript
import { z } from 'zod';

export const FixTaskSchema = z.object({
  schemaVersion: z.literal(1),
  featureId: z.string().regex(/^F-\d{3}-/),
  issuedBy: z.enum(['qa-tester', 'human']),
  failedAcId: z.string(),
  expectedBehavior: z.string(),
  actualBehavior: z.string(),
  evidence: z.array(z.object({
    type: z.enum(['test-output', 'log-line', 'stack-trace']),
    location: z.string(),
    snippet: z.string(),
  })),
  hint: z.string().optional(),
});

export type FixTask = z.infer<typeof FixTaskSchema>;
```

---

### 2.3 `packages/matrix-schema` — 全景元数据

**职责**:定义 `feature-matrix.yaml`(业务场景×功能点)和 `helmcode.yaml`(项目接入声明)。

```
packages/matrix-schema/
├── src/
│   ├── feature-matrix.ts             # 业务全景 yaml schema
│   ├── helmcode-manifest.ts          # 项目接入声明 schema
│   ├── status-derivation.ts          # 从 contracts/orchestration 推导每格状态
│   └── index.ts
├── tests/
└── package.json
```

**为什么独立 package**:这是中台的元数据规范,独立 package 让其他工具(matrix UI / cli / 第三方插件)都能引用,避免耦合。

---

### 2.4 `packages/adapter-core` — 项目适配器

**职责**:把每种项目类型(java-ddd / node-express / python-fastapi)的差异封装在 adapter 后,中台对上提供统一 API。

```
packages/adapter-core/
├── src/
│   ├── core/
│   │   ├── adapter.interface.ts      # ProjectAdapter 接口
│   │   └── registry.ts               # 适配器注册中心
│   ├── adapters/
│   │   ├── java-ddd/
│   │   │   ├── index.ts
│   │   │   ├── build.ts              # mvn 命令封装
│   │   │   ├── test.ts               # surefire 双 execution 调用
│   │   │   ├── lint.ts
│   │   │   ├── arch-rules.ts         # ArchitectureRulesTest 解析
│   │   │   └── smoke.ts              # BootContextSmokeTest 解析
│   │   ├── node-express/             # V1 加
│   │   └── python-fastapi/           # V2 加
│   └── index.ts
├── tests/
└── package.json
```

**接口示例**:
```typescript
export interface ProjectAdapter {
  type: 'java-ddd' | 'node-express' | 'python-fastapi';
  detect(projectDir: string): Promise<boolean>;
  build(ctx: BuildContext): Promise<BuildResult>;
  testStrict(ctx: TestContext): Promise<TestResult>;     // ArchUnit + Smoke
  testFull(ctx: TestContext): Promise<TestResult>;       // 含 ACTS / 集成
  lint(ctx: LintContext): Promise<LintResult>;
  format(ctx: FormatContext): Promise<void>;
  parseTestReport(reportPath: string): Promise<TestReport>;
  derivePackageMapping(contract: Contract): Promise<PackageMapping>;
}
```

---

### 2.5 `packages/sandbox` — 沙箱执行

**职责**:屏蔽 Docker / git worktree / 本地直跑的差异,提供统一 sandbox 句柄。

```
packages/sandbox/
├── src/
│   ├── core/
│   │   ├── sandbox.interface.ts      # Sandbox 抽象
│   │   └── factory.ts                # 按 helmcode.yaml 选实现
│   ├── docker/
│   │   ├── docker-sandbox.ts         # dockerode 实现
│   │   ├── image-warmup.ts           # 预热常用镜像
│   │   └── volume-cache.ts           # .m2/node_modules 共享 cache
│   ├── worktree/
│   │   ├── worktree-manager.ts       # git worktree 创建/销毁
│   │   └── isolation.ts
│   └── index.ts
├── tests/
└── package.json
```

**对外接口**:
```typescript
const sandbox = await createSandbox({
  type: 'docker',
  image: 'helmcode/java-ddd-sofa-21:latest',
  worktree: { repo: '/path/to/mycmdeliverhub', branch: 'feature/F-005' },
  caches: ['.m2', '.gradle'],
});

const result = await sandbox.exec('mvn -pl app/test test -DexcludedGroups=lenient');
console.log(result.stdout, result.stderr, result.exitCode);

await sandbox.destroy();    // 清理容器 + worktree
```

---

### 2.6 `packages/storage` — 数据访问层

**职责**:Drizzle schema 定义 + repository pattern 封装,业务层只接触 repository。

```
packages/storage/
├── src/
│   ├── schema/
│   │   ├── projects.ts               # 接入的项目
│   │   ├── features.ts               # 业务场景×功能点
│   │   ├── contracts.ts              # 行为契约
│   │   ├── orchestration-runs.ts     # 每次 /dev-flow 跑的实例
│   │   ├── node-attempts.ts          # 每个节点的每次尝试
│   │   ├── reflections.ts            # 反思日志
│   │   └── index.ts
│   ├── repositories/
│   │   ├── project-repo.ts
│   │   ├── feature-repo.ts
│   │   ├── orchestration-repo.ts
│   │   └── ...
│   ├── client/
│   │   ├── sqlite.ts                 # better-sqlite3 client
│   │   └── postgres.ts               # node-postgres client
│   └── index.ts
├── drizzle/                          # migration 输出(generated)
├── tests/
└── package.json
```

**双写**:repository 写数据库时同步写 `.claude/orchestration/{F-ID}.yaml`(用 yaml lib),保持 git 可见。

---

### 2.7 `packages/shared` — 工具/类型

```
packages/shared/
├── src/
│   ├── errors/                       # 统一错误类型(类比 java 的 ErrorCodeEnum)
│   ├── logger/                       # pino + 结构化日志
│   ├── types/                        # 全局类型
│   ├── utils/
│   └── index.ts
└── package.json
```

---

## 3. 各 app 职责

### 3.1 `apps/portal` — Next.js Web UI

```
apps/portal/
├── app/                              # Next 15 App Router
│   ├── layout.tsx
│   ├── page.tsx                      # 全景矩阵(默认页)
│   ├── projects/
│   │   ├── page.tsx                  # 项目列表
│   │   └── [projectId]/
│   │       ├── matrix/page.tsx       # 单项目业务全景
│   │       └── features/[fId]/
│   │           ├── page.tsx          # 单 feature 详情
│   │           ├── contract/page.tsx # 契约审查
│   │           └── runs/[runId]/page.tsx  # 历史 run 回放
│   └── api/
│       ├── orchestration/[runId]/stream/route.ts   # SSE
│       ├── features/[fId]/start/route.ts
│       └── ...
├── components/
│   ├── matrix-view.tsx
│   ├── feature-card.tsx
│   ├── run-timeline.tsx
│   └── ui/                           # shadcn 复制过来的组件
├── lib/
│   └── api-client.ts
├── tailwind.config.ts
└── package.json
```

### 3.2 `apps/orchestrator` — 后端服务

**两种实现路径**:
- **路径 A(推荐 MVP)**:与 `apps/portal` 同进程,Next.js Route Handlers 直接 import `agent-core`。零额外部署。
- **路径 B(V1 拆分)**:独立 Hono / Fastify 进程,通过 HTTP/SSE 与 portal 通信,水平扩展。

MVP 走路径 A;当 agent 长任务影响 portal 响应时再拆。

### 3.3 `apps/cli` — 升级版 CLI

```
apps/cli/
├── src/
│   ├── commands/
│   │   ├── install.ts                # 现有 helmcode install
│   │   ├── status.ts
│   │   ├── update.ts
│   │   ├── version.ts
│   │   ├── matrix/
│   │   │   ├── status.ts             # 全景状态推导
│   │   │   ├── work.ts               # helmcode matrix work F-005
│   │   │   └── render.ts
│   │   └── orchestrate.ts            # 启动 orchestrator
│   ├── index.ts
│   └── ...
├── bin/
│   └── helmcode.mjs                  # 替代现有 bin/helmcode.mjs
└── package.json
```

---

## 4. 依赖关系图

```
                       ┌──────────────┐
                       │  contract-   │
                       │  schema      │ (零依赖,纯 schema)
                       └──────┬───────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
       ┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼──────┐
       │  matrix-   │  │  agent-    │  │  storage    │
       │  schema    │  │  core      │  │             │
       └──────┬─────┘  └──────┬─────┘  └──────┬──────┘
              │               │               │
              │      ┌────────┼───────┐       │
              │      │        │       │       │
              │      │  ┌─────▼─────┐ │       │
              │      │  │ adapter-  │ │       │
              │      │  │ core      │ │       │
              │      │  └─────┬─────┘ │       │
              │      │        │       │       │
              │      │  ┌─────▼─────┐ │       │
              │      │  │ sandbox   │ │       │
              │      │  └───────────┘ │       │
              │      │                │       │
              └──────┴────────────────┴───────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
       ┌──────▼─────┐  ┌──────▼──────┐  ┌─────▼──────┐
       │  apps/     │  │  apps/      │  │  apps/     │
       │  portal    │  │  orches-    │  │  cli       │
       │            │  │  trator     │  │            │
       └────────────┘  └─────────────┘  └────────────┘
```

**核心原则**:
- `packages/*` 之间**单向依赖**(无环),自下而上:contract-schema → others
- `apps/*` 可依赖任意 packages,但**不能互相依赖**
- `agent-core` 通过依赖注入接受 sandbox 实例,**不直接 import sandbox**(便于测试 mock)

---

## 5. 包名命名

所有内部 package 用 `@helmcode/` scope:
- `@helmcode/agent-core`
- `@helmcode/contract-schema`
- `@helmcode/matrix-schema`
- `@helmcode/adapter-core`
- `@helmcode/sandbox`
- `@helmcode/storage`
- `@helmcode/shared`

外部发布只发 `helmcode`(整体 CLI)和 `@helmcode/sdk`(给第三方插件用,V2)。

---

## 6. 配置文件最小集

### 6.1 `pnpm-workspace.yaml`
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

### 6.2 `turbo.json`(关键 task)
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "dev": { "cache": false, "persistent": true },
    "test": { "dependsOn": ["build"] },
    "lint": {},
    "typecheck": {}
  }
}
```

### 6.3 `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

每个 package 的 `tsconfig.json` 继承 + 加 `compilerOptions.outDir`、`include`、`references`。

### 6.4 `biome.json`
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "rules": { "recommended": true } },
  "organizeImports": { "enabled": true }
}
```

---

## 7. 与现有 HelmCode 仓库的关系

**不重起仓库**,在现有 HelmCode 仓库内分层叠加:

| 现有目录 | 处理 |
|---------|------|
| `bin/helmcode.mjs` | 改为薄壳,delegate 到 `apps/cli` |
| `install.mjs` / `install.sh` | 保留(现有用户),内部逐步迁移到 `apps/cli` |
| `loader/`、`commands/`、`scripts/` | 保留,内部依赖关系不变 |
| `core/{clarify,implement,verify,...}/` | **保留 prompt 内容**,被 `packages/agent-core/prompts/` 引用 |
| `standards/java-ddd/` | 保留,被 `packages/adapter-core/adapters/java-ddd/` 引用 |

**渐进式迁移**:packages/apps 先与现有 install.mjs/sh 共存;Phase 4 完成后再考虑废弃旧入口。

---

## 8. 仓库初始化命令清单(Phase 0 末尾)

```bash
# 在 HelmCode 仓库根目录
pnpm init -y                                  # 升级 root package.json
echo 'packages:\n  - "packages/*"\n  - "apps/*"' > pnpm-workspace.yaml
pnpm add -D -w turbo typescript @biomejs/biome vitest
pnpm dlx create-next-app@latest apps/portal --typescript --tailwind --app

# 各 package 初始化
for pkg in agent-core contract-schema matrix-schema adapter-core sandbox storage shared; do
  mkdir -p packages/$pkg/src
  cd packages/$pkg && pnpm init -y && cd ../..
done
```

(以上命令仅作示意,实际由 Phase 1 实施时按 task 拆分执行,且每条 `pnpm install` 都需经过用户确认 — 与 HelmCode 反模式 #11 思想一致,不静默引依赖。)

---

## 9. 与 ".claude/" 的双向同步

```
[运行时]
SQLite/Postgres orchestration_runs 表
       ↕ 双写
.claude/orchestration/{F-ID}.yaml      ← git tracked

[启动时]
.claude/orchestration/*.yaml → 加载到 DB(冷启动 hydrate)
.claude/contracts/*.md       → 解析后存入 contracts 表
.claude/matrix/feature-matrix.yaml → 加载到 features 表
```

**git 是最终事实源**,DB 是查询缓存。开发者随时 `git diff` 看到 orchestration 状态变化,review 时也能审 yaml diff,这是中台的"可解释性"保证。
