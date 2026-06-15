# Goal 13 — 格子全生命周期管理(DB 为源 + UI CRUD)

> 前置:G12 已 commit。本 Goal 让 DB 成为矩阵唯一真实源,UI 可增删改功能/场景。

---

## 复制粘贴到 Claude Code

```
/goal 完成 HelmFlow Goal 13:格子全生命周期管理。
当前 feature matrix 完全由 YAML 定义,用户无法在 UI 增删功能/场景或编辑元数据。
本 Goal 让 DB 成为唯一真实源,YAML 仅作首次 seed。

【范围】

1. Schema 扩展:packages/storage/src/schema.ts 的 features 表新增:
   handler,actions,context,priority,legacyFlowCode,legacyActivities
   (全部 text DEFAULT '')。feature_scenarios 加 archived integer DEFAULT 0。
   同步修改 db.ts 的 DDL。

2. Repo 新增 6 函数(packages/storage/src/repo.ts):
   - createFeatureManual(db,{id,projectId,domain,name,handler,...})
   - updateFeatureMeta(db,featureId,{name?,handler?,...})
   - archiveFeature(db,featureId) — status='archived'+场景全标废弃
   - createScenarioManual(db,{featureId,scenarioName,scenarioStatus})
   - deleteScenario(db,cellId) — DELETE 行,不删关联 contract/run
   - listActiveFeatures(db,projectId) — WHERE status!='archived'
   全部在 index.ts 导出。

3. Sync 改造(sync-matrix.ts):upsertFeature 时写入新列,不覆盖非空值。

4. Matrix 加载改造(matrix.ts):loadMatrix()从 DB 的 features+
   feature_scenarios 构建结构,YAML 仅通过 syncMatrixToDb seed。
   getAllScenarioNames()也改为从 DB 读。

5. API Routes(4 个新文件):
   a. app/api/features/route.ts — POST 创建功能(含默认场景)
   b. app/api/features/[id]/route.ts — GET 详情 / PATCH 编辑 / DELETE 归档
   c. app/api/features/[id]/scenarios/route.ts — POST 添加场景
   d. app/api/features/[id]/scenarios/[name]/route.ts — DELETE 删除场景

6. 前端组件(3 个新文件):
   a. components/add-feature-dialog.tsx — 域+ID+名称+handler+actions+priority
   b. components/edit-feature-dialog.tsx — 预填元数据,PATCH 更新
   c. components/add-scenario-dialog.tsx — 场景名+初始状态

7. 页面集成:
   - features/[id]/page.tsx:标题旁加「编辑」「归档」按钮;场景表加
     「添加场景」;每行加「删除」
   - page.tsx(首页):每个域标题旁加「+添加功能」按钮

【约束】
- 禁装新 npm 包,复用已有 shadcn 组件
- API 路由 export const runtime = "nodejs"
- pnpm typecheck 零 error
- 归档/删除须 window.confirm 确认
- 功能 ID 创建后不可改(跟 cellId 耦合)
- 删场景只删 feature_scenarios 行,contracts/runs 保留

【通过信号】
1. pnpm typecheck 零 error
2. 首页「添加功能」→ 填表 → 提交 → 矩阵出现新行 → 刷新仍在
3. 功能详情「编辑」→ 改 handler → 刷新保持
4. 功能详情「添加场景」→ 场景列表多一行 → 首页多一列
5. 场景「删除」→ 确认 → 行消失
6. 功能「归档」→ 首页不再显示
7. 重启 dev server → 手动添加的数据完整
8. sqlite3 data/helmflow.db "SELECT handler FROM features WHERE id='D-01'"
   返回非空(YAML 已 seed 进新列)

完成后输出"Goal 13 验收清单"逐条勾选。
```
