# HelmFlow Worker —— 7×24 自主开发使用指南

> 常驻 worker 进程,把"手动点一键跑"升级为"自己排队 7×24 跑"。worker 自动消费所有**已审批(approved)**契约,排队执行 `require→code→test→deploy` 全流程,崩溃自动恢复、超预算自动停。

## 架构(一句话)

```
approved 契约 → pipeline_queue 表 → worker 认领 → runOrchestrator(4 节点)→ done/blocked
                  ↑                                                    ↓
            enqueue 扫描(10s)                              事件全落 run_events(portal 可观测)
```

- **portal**:UI + 审批(只负责质量门)
- **worker**:常驻进程,负责排队 + 执行
- 两者**共享同一个 SQLite**(`apps/portal/data/helmflow.db`),通过 DB 解耦

## 完整交互使用流程(5 步)

### 1. 配置(首次)
- `apps/portal/.env.local`:`HELMFLOW_ANTHROPIC_API_KEY`、`HELMFLOW_ANTHROPIC_BASE_URL`(worker 启动时自动加载同一份)
- `projects/<id>/helmcode.yaml`:`sandboxPath`(目标项目路径)、`helmcode.path`(标准库路径)

### 2. 起 portal
```bash
pnpm dev          # http://localhost:3000 —— 看全景矩阵、审批契约、观察运行
```

### 3. 产出并审批一份契约
在 cell 详情页点"需求澄清"产出契约 → 点"审批"置 `approved`。
> 这是唯一的**人工质量门**。worker 只消费 approved 契约。

### 4. 起 worker(另开终端)
```bash
pnpm worker:start    # 常驻后台;开发期可用 pnpm worker:dev(热重载)
```
worker 自动循环:扫描 approved 契约 → 入队 → 认领 → 跑 4 节点 → 合并代码 + PR。

### 5. 观察
- portal `/runs` 页顶部 **「开发队列(Worker)」面板**:pending / running / blocked 计数 + 明细
- 点 run 进详情:4 节点实时事件流(事件落 `run_events`,**跨进程可见**——无论 portal 还是 worker 触发的 run 都能看)

## 配置项(环境变量,均可选)

| 变量 | 默认 | 说明 |
|------|------|------|
| `HELMFLOW_WORKER_CONCURRENCY` | 3 | 并发执行任务数 |
| `HELMFLOW_WORKER_POLL_MS` | 10000 | enqueue/dispatch 轮询间隔 |
| `HELMFLOW_DAILY_BUDGET_USD` | 不限 | 当日累计成本(USD)上限,超限暂停取新任务 |
| `HELMFLOW_MAX_REATTEMPTS` | 3 | 进程崩溃中断的重跑上限,达上限转 blocked |
| `HELMFLOW_DB_PATH` | `apps/portal/data/helmflow.db` | SQLite 路径(与 portal 共享) |
| `HELMFLOW_PROJECT_ID` | `mycmdeliverhub` | 目标项目(见 `projects/`) |
| `HELMFLOW_PORTAL_ROOT` | `<monorepo>/apps/portal` | portal 根(读相对路径契约用) |

## 崩溃恢复(自动)

worker 被 `kill` / 崩溃 / 机器重启后,**下次启动自动恢复**:
1. 中断的 `running` 队列项 → `attempt++` → 重新入队(`pending`);达 `maxAttempts` 转 `blocked`
2. 孤儿 `full-loop` run → 标 `failed`(数据卫生)
3. 残留 git worktree → `git worktree prune` 清理

> `attempt` 计的是**进程崩溃**导致的重跑,不是业务失败重试(业务重试在 orchestrator 内部 `MAX_GLOBAL_LOOPS=5`)。

## 当前限界

- **仅消费人工 approved 契约**(保留需求质量门;日后要完全无人,加 `AUTO_APPROVE` 开关即可)
- **deploy 节点依赖**目标项目 git remote + `gh` CLI;内网 GitLab 仓库需适配(否则 deploy 会 `blocked`,但 require/code/test 正常)
- **本机常驻**(未容器化;云端化是后续 Phase)

## 验证记录(2026-06-18 实测)

用 PR-03「价格受理」契约端到端实测:
- ✅ approved 契约自动入队 → 原子认领 → 创建 git worktree + full-loop run → `require` 节点真实调用 `glm-5.2`
- ✅ 全部事件落 `run_events`,portal 跨进程可观测
- ✅ `kill` worker 后重启:中断项 `attempt 0→1` 重新入队 + 孤儿 run 标 failed + 残留 worktree prune
- 🔧 验证中暴露并修复 2 个真实 bug:
  1. `runOrchestrator` 用 `path.join(portalCwd, absMarkdownPath)` —— node 会把绝对路径第二参当相对拼接 → 改为 `isAbsolute` 判断(与 portal cell page 对齐)
  2. `enqueueIfAbsent` 只挡 pending/running,失败 cell 被无限重新入队死循环 → 加挡 blocked/failed
