<p align="center">
  <strong>helmflow</strong>
</p>

<p align="center">
  Full-Loop AI Coding Platform — 多 agent 自循环开发中台<br>
  <code>clarify → coder → testgen → qa → committer</code>(每节点 Worker + Critic 自循环)
</p>

<p align="center">
  <a href="https://github.com/wanlihang/helmcode">⚓ HelmCode</a>(轻量标准库)
  ·
  <a href="https://github.com/wanlihang/helmflow">🚢 helmflow</a>(本仓库,中台)
</p>

---

## Why helmflow

[HelmCode](https://github.com/wanlihang/helmcode) 把 AI coding 的"单 feature 闭环"做到了产品级:行为契约 + Judgment Log + `/goal` 自主循环 + Tests N≥1 反假阳性 + ArchUnit/BootContextSmokeTest 装配验证。

**helmflow 是 HelmCode 的下一阶段** — 把闭环从"单 feature"放大到"全流程多 agent IDP":

- **业务场景 × 功能点全景视图**(Backstage 风格,Next.js 渲染)
- **5 节点 agent 流水线**:Clarifier / Coder / TestGen / QA / Committer
- **每节点 Worker + Critic 自循环**(Reflexion 模式)
- **跨节点 fix-task 反馈**(Saga 回退,QA 失败自动回退 Coder)
- **多项目接入**(`helmcode.yaml` manifest)
- **Docker sandbox + git worktree 隔离执行**

完整设计:[`docs/architecture/`](./docs/architecture/README.md)

## 当前状态:Goal 1 ✅

```
浏览器 http://localhost:3000
  └─ 5 域 40 功能点全景矩阵(基于 mycmdeliverhub 重构方案附录 C)
  └─ 7 状态色徽标(not-started / clarifying / pending-goal / implementing / done / blocked / abandoned)
  └─ 点击 feature 卡片跳详情(Goal 2 实现)
```

## 快速启动

```bash
cd apps/portal
pnpm install
pnpm dev
```

打开 <http://localhost:3000>。

## 路线图

| Phase | 状态 | 内容 |
|-------|------|------|
| Goal 1 | ✅ | 矩阵静态渲染 |
| Goal 2 | ⏳ | feature 详情页 + 启动需求 mock 对话框 |
| Goal 3 | ⏳ | 真实 Anthropic Clarifier SSE |
| Phase 1 | ⏳ | Agent Core MVP(5 节点 worker+critic) |
| Phase 2 | ⏳ | Orchestrator + 跨节点 fix-task 循环 |
| Phase 3 | ⏳ | Docker sandbox + 多项目接入 |
| Phase 4 | ⏳ | Portal 完整 UI(timeline / reflection viewer / PR 集成) |
| Phase 5 | ⏳ | 学习与生产化 |

详见 [`docs/architecture/full-loop-platform.md`](./docs/architecture/full-loop-platform.md) §8 实施路线图。

## 仓库布局

```
helmflow/
├── apps/portal/              # Next.js 15 web UI(本期 MVP)
├── docs/architecture/        # 设计文档(5 份)
├── standards/java-ddd/       # 编码标准(从 helmcode 复制,V1 拆 npm 包共享)
├── references/               # 项目参考(error-codes / package-structure / 等)
└── (future)
    ├── packages/             # @helmflow/agent-core / sandbox / adapter-core / ...
    └── infra/                # Docker Compose + sandbox-images
```

## 与 HelmCode 的关系

- **HelmCode**:轻量"标准 + 模板 + skill 安装器",通过 `helmcode install` 装到任何项目;持续维护标准与最佳实践
- **helmflow**:中台 web 应用,接入符合 `helmcode.yaml` manifest 的多项目;依赖 HelmCode 的标准(V1 通过 `@helmcode/standards-*` npm 包共享)

两个仓库职责分离,各自独立发版。

## License

MIT
