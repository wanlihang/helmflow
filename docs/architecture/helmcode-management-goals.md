# HelmCode 管理能力 — 交互/使用场景分析 + 单条 Goal

> 目的:在 HelmFlow 内建立对 HelmCode 的**一等管理能力**,根治标准 drift。
> 本文 = 场景分析(为什么这么设计)+ 一条可复制 `/goal`(怎么落地)。
> 前置:G12(多项目 manifest)+ G15(4 节点 pipeline 消费 HelmCode skill)已 commit。

---

## 0. 背景一句话

分仓后,HelmFlow 通过 `helmcode.path` 指向 HelmCode 仓库**手动复制/引用**标准,
3 个消费点各写各的路径解析,无版本意识、无一致性保证 → 标准 drift 已发生
(分仓后 HelmCode 改了 2 次标准,HelmFlow 感知不到)。需要在 HelmFlow 内建一个
`@helmflow/helmcode-manager` 中间层,把 HelmCode 当**被管理对象**而非散落文件。

---

## 1. 角色与资源模型

### 1.1 Actor(谁在用)

| Actor | 关注点 | 动作 |
|-------|--------|------|
| **Standards Author**(上游,helmcode 仓库) | 标准本身演进 | 改标准、发版、写 changelog |
| **Platform Operator**(中台运维) | 全局一致性、升级安全 | 配 HelmCode 源、看版本、发起升级/回滚 |
| **Project Owner**(业务方) | 标准对自己的适用性 | 看自己项目绑了哪版、升级影响哪些 feature |
| **Orchestrator / Agent**(自动消费者) | 拿到正确的标准文件 | code 节点加载 patterns、记录用了哪版 |

### 1.2 被管理的资源(管什么)

HelmCode 提供给 HelmFlow 的不只是 `standards/`,是 **4 类资源**:

| 资源 | helmcode 源位置 | 当前 HelmFlow 消费者 | 状态 |
|------|----------------|---------------------|------|
| **Skills** | `core/{skill}/SKILL.md` | agent-runner `resolveSkillPath()` | ✅ 已通过 helmcodeRoot 引用 |
| **Standards** | `standards/{preset}/*.md` | agent-runner `resolveSkillAdditionalDirs()` | ⚠️ 本地副本 + helmcodeRoot 双源 |
| **Patterns** | `standards/{preset}/patterns/*.md` | code node `resolveStandardsRoot()` | ⚠️ 硬编码 `../../standards/java-ddd/patterns` |
| **Scanners** | install.mjs 的 6 个 scan 函数 | Portal `analyze-structure` | ❌ 未对接,手动复制 |

### 1.3 当前 3 个消费点的真实代码(问题根源)

```
agent-runner/src/skill.ts
  resolveSkillAdditionalDirs(skill, helmcodeRoot)
    → helmcodeRoot/standards/                  # 相对 helmcodeRoot

orchestrator/src/node-runners/code.ts
  resolveStandardsRoot()
    → ../../standards/java-ddd/patterns        # 相对 cwd,硬编码
    → 或 HELMFLOW_JAVA_DDD_STANDARDS env 覆盖

adapter-java-ddd
    → 不消费 standards                          # 缺失,只管 build/test
```

**核心问题**:同一份标准,3 种解析路径、2 个来源(本地副本 / helmcodeRoot),无版本戳。
升级时不知道改了什么、影响谁、出问题怎么回滚。

---

## 2. 交互场景(人 ↔ Portal)

> 这 5 个场景决定了管理面板需要哪些能力。每个场景标注【需要的能力】。

### S1. 首次配置 — 接入项目时自动绑定标准

**触发**:Operator 用 G13 的注册表单接入新 Java 项目。
**现状**:表单有 `standardsRoot` 文本框,手填,极易填错或漏填;填错 → agent 读不到标准 → 生成的代码不规范,且无报错。
**目标**:
- 选了 `adapterType: java-ddd` → 系统自动绑定该 adapter 对应的标准包;
- 表单旁实时提示「将绑定 java-ddd 标准(当前 v2.1.0,15 个 patterns)」;
- `standardsRoot` 字段从「手填」降级为「高级选项/覆盖」,默认空(走 manager 统一解析)。

【需要】Resolver(adapterType→preset 映射)+ Version Tracker(显示版本)。

### S2. 升级感知 — HelmCode 发了新版

**触发**:Standards Author 在 helmcode 发了 v2.2.0(新增 `patterns/middleware.md`,修订 `decider.md`)。
**目标**:
- Operator 打开 Portal → 顶部 banner「⚡ 标准有更新:v2.1.0 → v2.2.0」;
- 点开看 **changelog**:新增 1 个 pattern、修订 1 个 pattern(从 git log / diff 提取);
- 不点不升,不打扰已有 run。

【需要】checkUpdate(current vs latest)+ Changelog 提取。

### S3. 升级决策 — 影响范围可见

**触发**:Operator 考虑要不要把 mycmdeliverhub 升到 v2.2.0。
**目标**:
- Portal 显示 **impact 分析**:哪些项目、哪些 feature 的契约/代码引用了被改的 pattern;
- 例:mycmdeliverhub 的 3 个 feature 用了 `decider.md` → 标记「受影响」;
- Operator 决定先在 demo-project 试点 → 一键升级试点 → 跑一轮 pipeline 验证 → 再推广。

【需要】Diff(v1,v2)+ Impact(改了哪些文件 → 反查哪些 cell 引用)+ per-project 版本。

### S4. 回滚 — 升级出问题

**触发**:升级后发现新 `decider.md` 描述有歧义,生成的代码反而变差。
**目标**:
- Settings 页点「回滚到 v2.1.0」→ 预览将恢复的文件 → 确认;
- 系统从 migration 记录里恢复上一版快照;
- 回滚后该项目的 run 标注「ran on v2.1.0 (rolled back)」。

【需要】Apply Engine(upgrade 留快照)+ Rollback + migration 审计表。

### S5. 一致性审计 — 排查「代码为什么不符合规范」

**触发**:Review 发现某次 code 节点生成的代码不符合最新规范。
**目标**:
- Operator 查该 cell 的 node_attempts → 看到 `standardsVersion: v2.1.0`;
- 对照当前最新 v2.2.0 → 发现是跑在旧版上;
- 决定升级 + 重跑该 cell。

【需要】每次 run 落库 standards_version(可追溯)。

---

## 3. 使用场景(机 ↔ manager)

> 这 4 个场景决定 manager 的 API 形状。

### U1. Agent 加载标准(code 节点)

```ts
const manager = new HelmcodeManager({ helmcodeRoot, preset: 'java-ddd' })
const patternsDir = manager.resolvePatterns()   // 唯一入口,不再 ../../硬编码
additionalDirectories.push(patternsDir)
await recordAttempt({ ..., standardsVersion: manager.getVersion().checksum })
```

### U2. 首次安装(项目 .claude 缺失)

```ts
if (!manager.isInstalled(project)) {
  await manager.install({ preset: 'java-ddd', target: project.claudeDir })
}
```
orchestrator 启动前自检,缺则装(从 npm 包或 local path 消费,不再依赖手动复制)。

### U3. CI 一致性检查(防 drift 兜底)

```yaml
- run: pnpm helmcode:check   # 对比 git 里 standards checksum 与 helmcode 包 checksum
                              # 不一致 → fail:"标准已 drift,跑 pnpm helmcode:sync"
```
即使消费链被绕过(有人手动改了 standards/),CI 也能发现。

### U4. Orchestrator 版本感知

```ts
const v = manager.getVersion()
emit('system.init', { standardsVersion: v })
if (v.hasUpdate) run_events 标注 "ran on v2.1.0, latest v2.2.0"
```

---

## 4. 关键设计张力(3 个拍板决策)

### T1. 本地副本:删还是留?

- 删(纯 .gitignore 生成):根治 drift,但 PR review 看不到标准内容、离线无网装不出。
- 留(git-tracked):可 review,但必然 drift。
- **决策**:`.gitignore` 生成产物 + 留 `.helmcode-standards.sha` stamp 文件(可 review、可校验)。源是 npm 包/local path,副本是生成物,stamp 是凭证。

### T2. 多项目不同版本?

不同项目可能 pin 不同版(mycmdeliverhub 稳定 v2.1.0,demo-project 试 v2.2.0)。
**决策**:版本 **per-project**。`projects` 表加 `helmcode_version`;全局只管「源」,不强制全项目同版。

### T3. 离线/无 npm?

沙箱编译环境可能没外网。
**决策**:**双源**——`npm`(生产,可 pin 版本)+ `local`(开发,指向 helmcode path)。manifest 的 `helmcode: { source, path?, version? }`。

---

## 5. 目标架构

```
helmcode (npm pkg, source of truth)
  standards/java-ddd/ + core/{skill}/ + scanners
            │  (npm dep  or  local path)
            ▼
┌──────────────────────────────────────┐
│   packages/helmcode-manager           │   ← 本 goal 新建
│  ┌─────────┐┌─────────┐┌─────────┐    │
│  │Resolver ││Version  ││Apply    │    │
│  │         ││Tracker  ││Engine   │    │
│  └────┬────┘└────┬────┘└────┬────┘    │
│  resolveStandards() getVersion()      │
│  resolvePatterns()  checkUpdate()     │
│  resolveSkill()     diff() impact()   │
│  isInstalled()      install/upgrade/  │
│                     rollback()        │
└───┬────────────┬──────────────┬───────┘
    ▼            ▼              ▼
 agent-runner  orchestrator   Portal
 (U1 消费)    (U2/U4 感知)   (S1-S5 面板)
```

manager 是纯 Node 库(无 Next.js 依赖),portal / orchestrator / agent-runner 都可引用。

---

## 6. Goal — HelmCode 管理能力落地

> 直接复制下面代码块到 Claude Code。
>
> ⚠️ 本 prompt 较长(约 5500 字符,**超出 /goal 单 turn 4000 字符常规上限**)。
> 跑法二选一:① 关掉 Haiku 评估器手动跑;② 或拆成两个会话顺序跑(先地基后面板)。
> 场景分析(§1-§5)是设计依据,不在 prompt 内。

```
/goal 在 HelmFlow 内新建 packages/helmcode-manager 包,把 HelmCode 升级为被管理对象:统一 3 个散落的标准解析为 1 个 Resolver,加版本戳(Version Tracker)+ 升级/回滚生命周期(Apply Engine)+ 版本 diff 与影响分析(Diff/Impact),Portal 提供管理面板(状态/升级/回滚/changelog),CI 兜底防 drift;HelmCode 侧补 programmatic API。前置:G12(manifest)+G15(skill 加载)已 commit;helmcode 仓库本地可访问。

【范围】
1. HelmCode 侧(../helmcode 仓库):package.json 加 "exports":{".":"./api.mjs","./install":"./install.mjs"};新建 api.mjs 导出 query({helmcodeHome})→{presets:[{name,files,checksum}],checksum(dir)}、6 个 scanner 函数(scanDOAnnotations/scanExceptionPattern/scanFacadePattern/scanMapStruct/scanPersistence/scanIntegrationPattern);install() 返回值改结构化 {installed,skipped,errors,version}(保留 console 输出兼容 CLI);HELMODE_HOME 从 __dirname 改可注入参数(默认 __dirname)。不破坏 bin/helmcode.mjs CLI。

2. packages/helmcode-manager(src/{index,resolver,version,apply,diff,types}.ts + package.json,deps:helmcode):
   a. resolver.ts: HelmcodeManager({source:'local'|'npm',path?,version?,preset}); resolveStandards()/resolvePatterns()/resolveSkill(name)/isInstalled(dir)。source=local resolve(path);source=npm resolve(require.resolve('helmcode/package.json')的'..')
   b. version.ts: getVersion()→{helmcode:'x.y.z',preset,checksum}; checksum=对 standards/{preset} 全文件内容 sha256 排序聚合(不含 mtime);checkUpdate()→{current,latest,hasUpdate}(npm 源查 registry,local 源 git rev-parse HEAD)
   c. apply.ts: install({preset,target})首次生成 .claude/standards+写.helmcode-standards.sha; upgrade({projectId,toVersion?,dryRun}) dryRun 只返{willChange,willAdd,willRemove}不落库不覆盖,非 dryRun 先快照到.helmcode-snapshots/<旧checksum>/ 再覆盖+写 migration+更新 projects.helmcode_version; rollback({projectId,toChecksum?})缺省回滚上一版; prune 保留最近3
   d. diff.ts: diff(fromChecksum,toChecksum)→{changed,added,removed,summary}比对快照目录vs源目录; impact(projectId,diffResult)扫描该 project 的 contracts/+judgment-logs grep 引用被改 pattern 名的 cell→{affectedCells:[{cellId,reason}]}

3. 改 3 消费点走 manager 删硬编码:orchestrator/src/node-runners/code.ts 删 resolveStandardsRoot() 的../../硬编码改 const mgr=new HelmcodeManager(ctx);patterns=mgr.resolvePatterns(); agent-runner/src/skill.ts resolveSkillAdditionalDirs 内 standards 路径走 mgr.resolveStandards(); adapter-java-ddd 可选注入 standardsRoot(mgr.resolveStandards())。

4. DB(schema.ts+repo.ts+db.ts,幂等):projects 加 helmcode_version(text)+standards_checksum(text);node_attempts 加 standards_version(text)+standards_checksum(text);新表 standards_migrations{id:pk,projectId:notNull,fromChecksum,toChecksum,action:enum(install/upgrade/rollback),dryRun:bool,changedFilesJson,operator,createdAt:timestamp};repo 加 updateProjectStandards(id,{version,checksum})/createMigration/listMigrations(projectId);runNode 每次 attempt 写入 mgr.getVersion() 的 version+checksum。

5. manifest-loader:ManifestSchema.helmcode 改{source:z.enum(['local','npm']).default('local'),path?:string,version?:string};resolveHelmcodeRoot 兼容(source=local 用 path,npm 忽略 path)。

6. Portal 面板(S1-S5):
   a. app/(dashboard)/settings/helmcode/page.tsx 三区块:①全局源(source/version/latest/checkUpdate 钮)②项目矩阵(每项目当前版/是否落后/升级钮)③changelog(最近 N 条 migration+当前可用 diff)
   b. api routes:helmcode/status(GET 返回{source,version,latest,hasUpdate,checksum,projects:[{id,version,checksum,diff}]}); /upgrade(POST{projectId,toVersion?,dryRun?}); /rollback(POST{projectId,toChecksum?}); /diff(GET{projectId,toVersion}→diff+affectedCells)
   c. helmcode-banner.tsx:hasUpdate 时顶部 banner,点跳 settings/helmcode;升级前弹预览(受影响 cell 数)确认才执行;默认项目 mycmdeliverhub 升级必须先 dryRun 预览才能执行

7. 副本治理+CI:helmflow/standards/java-ddd/ 加入 .gitignore;新增 scripts/sync-standards.mjs(pnpm helmcode:sync 从 mgr 源重新生成+更新.helmcode-standards.sha)+ helmcode:check(对比 git 中 standards checksum 与 helmcode 包,不一致非0退出);.github/workflows/standards-sync.yml on pull_request 跑 helmcode:check;README 标注"标准为生成产物,改请改 helmcode 源"。

【约束】禁装新 npm 包(helmcode 已可用);严格 TS 禁 any;manager 纯 Node 库不依赖 next;升级/回滚必须有 dryRun 预览不可直接覆盖;回滚只新增 rollback 记录不删旧 migration;默认项目 mycmdeliverhub 升级须先 dryRun;API route runtime=nodejs;impact 扫描只读不写代码;CI check 只校验不改动文件;ALTER TABLE/CREATE TABLE 幂等(PRAGMA table_info 先查);npm 源不可达时降级 local 不崩;checksum 只算文件内容不含 mtime;不破坏现有 helmcode CLI。

【通过信号】
1.pnpm -r typecheck 0 error
2.helmcode package.json 含 exports 字段;api.mjs 导出 query/checksum/6 scanner
3.HelmcodeManager({source:'local',path:'../helmcode'}).resolvePatterns() 返回 standards/java-ddd/patterns 绝对路径
4.getVersion().checksum 是稳定 64 位 hex(同版本多次调用一致)
5.code.ts 不再出现 '../../standards'(grep 为空)
6.projects+node_attempts 含 helmcode_version/standards_checksum 列;standards_migrations 表存在(sqlite3 .schema 确认)
7.跑一次 code 节点→node_attempts 该行 standards_version 非空
8.dryRun upgrade 返回 willChange 不落库不覆盖文件;真实 upgrade 后 standards_migrations 新增 action=upgrade + .helmcode-snapshots/<旧checksum>/ 存在 + projects.helmcode_version 更新
9.rollback 后 standards 恢复 + standards_migrations 新增 action=rollback(不删旧 upgrade 记录)
10.diff 返回 changed 非空;impact 返回 affectedCells 引用被改 pattern 名
11.GET /api/helmcode/status 与 /diff 返回 200;POST /upgrade dryRun=true 不改 projects 表
12.helmflow/standards/java-ddd 在 .gitignore 内;pnpm helmcode:check 一致时退出码 0,人为改坏后非0
13.pnpm helmcode:sync 重新生成 standards 并更新 .helmcode-standards.sha
14..github/workflows/standards-sync.yml 存在含 helmcode:check 步骤
15.浏览器 settings/helmcode 三区块 + 升级预览弹窗可见
16.存在性:packages/helmcode-manager/src/{resolver,version,apply,diff,index}.ts + helmcode/api.mjs + api/helmcode/{status,upgrade,rollback,diff}/route.ts + settings/helmcode/page.tsx

完成后输出"HelmCode 管理能力 验收清单"。
```

**通过信号(Haiku 评估器看的字符串)**
- ✅ pnpm -r typecheck: 0 error
- ✅ HelmcodeManager resolvePatterns 返回绝对路径
- ✅ getVersion checksum 稳定 64 位 hex
- ✅ code.ts 不再出现 ../../standards
- ✅ projects + node_attempts 含版本列;standards_migrations 表存在
- ✅ dryRun upgrade 不落库不覆盖
- ✅ upgrade 后 migration 新增 action=upgrade
- ✅ rollback 新增 action=rollback 不删旧记录
- ✅ pnpm helmcode:check 一致退出 0
- ✅ helmflow/standards/java-ddd 在 .gitignore
- ✅ settings/helmcode 三区块可见

**跑完后人工验证(浏览器/手动)**
1. `curl localhost:3000/api/helmcode/status` → JSON 含 version/checksum/hasUpdate
2. 触发一次 code 节点 run → sqlite3 查 node_attempts 该行 standards_version 非空
3. 开 settings/helmcode → 全局/项目/changelog 三区块都在
4. 选 demo-project → 点升级 → 预览看到受影响 cell 数 → 确认 → 版本号变;再点回滚 → 恢复 + changelog 多一条 rollback
5. 故意改 helmflow/standards 一个文件 → `pnpm helmcode:check` 非零退出
6. mycmdeliverhub 升级:无 dryRun 预览直接执行则算失败

**失败回退**

| 现象 | 原因 | 处理 |
|------|------|------|
| helmcode exports 不生效 | npm 用旧缓存 | 删 node_modules 重装或 pnpm rebuild |
| manager resolve 抛错 | local 源 path 错或无 standards/{preset} | 检查 manifest helmcode.path;确认 helmcode 仓库有 standards/java-ddd |
| checksum 每次不同 | 把 mtime 算进去了 | checksum 只算文件内容 sha256,排序聚合 |
| upgrade 后 agent 读不到标准 | 拷贝目标与 resolveStandards 读出不一致 | 核对 install/upgrade 写入 .claude/standards 与 resolve 路径一致 |
| rollback 恢复不全 | 快照漏文件 | 快照用 cpSync recursive 整个 standards/{preset} |
| impact 扫描超时 | 全量 grep contracts 太大 | 限制只扫该 project 的 contracts,命中 pattern 文件名才深入 |
| ALTER TABLE 报 duplicate column | DDL 非幂等 | PRAGMA table_info 先查列存在再 ALTER |
| CI check 误报 | npm 源与 local 不同步 | check 默认比对 local 源,npm 仅作 latest 提示不强校验 |
| .gitignore 后 PR 看不到标准 | 预期行为 | review 看 .helmcode-standards.sha + changelog |

---

## 7. 跑完之后的状态

- HelmCode 在 HelmFlow 内是**被管理对象**:有版本、有 changelog、有升级/回滚、有审计。
- 3 个消费点统一走 `HelmcodeManager`,无硬编码路径。
- 每次代码生成的 run 都带 `standards_version`,可追溯「这代码是按哪版标准生成的」。
- CI 兜底:标准 drift 在 PR 阶段被拦下。
- `helmflow/standards/` 从「手动副本」变成「生成产物 + sha 凭证」,根治 drift。

## 8. 不做(留给后续)

- ❌ HelmCode 侧 npm 自动发版流水线
- ❌ 跨项目批量升级编排(逐项目手动触发即可)
- ❌ 标准「热更新」影响正在跑的 run(当前 run 用启动时版本,不中途换)
- ❌ Webhook 通知上游 helmcode 发版(手动 checkUpdate 即可)
