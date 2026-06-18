# HelmFlow 控制平面定位对齐 — 架构评估

> 触发:用户提出"开发状态导入"需求(在目标项目用 HelmCode 直开已产出契约,HelmFlow 要能扫描识别并同步状态)。深挖后发现这不是孤立功能,而是暴露出当前实现偏离了原始架构设计。
>
> **结论:确认 HelmFlow 定位为控制平面(control plane),目标项目为数据/执行平面。** 本文档是回归该定位的改造总纲。

---

## 1. 两个平台的关系(心智模型)

| | HelmCode | HelmFlow |
|---|---|---|
| 定位 | **执行/标准层** — skill + standards 安装器,跑在目标项目里 | **控制/治理层** — 中台,管状态、管对话、管编排 |
| 产物归属 | 产出在目标项目 `.claude/` | **不存产物本体**,只读 + 推导/同步状态 |
| 触发面 | 开发者在项目里直接 `/goal`、clarify | Portal 全景视图 + 编排执行 |
| 单位 | 单 feature 闭环 | 多 feature × 多项目全景 + 5 节点流水线 |

**核心原则:契约、矩阵、代码、判断日志都是目标项目的产物。HelmFlow 是控制平面 —— 读产物、收敛状态、渲染全景、编排执行,不充当产物仓库。**

产品的真正价值不在"再实现一遍契约生成",而在:
1. 业务全景可视化(场景 × 功能点矩阵)
2. 状态收敛(分散在多项目的开发进度 → 统一看板)
3. 可编排(HelmCode 单 feature 能力 → 多 agent 流水线)
4. 多项目治理(标准版本、接入)

---

## 2. 当前实现 vs 原始设计的偏移(核心矛盾)

原始设计见 `full-loop-platform.md` §3.2/§6/§7。当前代码(goal-chain 渐进堆叠)存在系统性偏移:

| 维度 | 原设计 | 当前实现 | 后果 |
|---|---|---|---|
| **契约存哪** | 目标项目 `.claude/contracts/F005-...md` | HelmFlow 自己 `apps/portal/data/contracts/` | 两条开发路径产物分叉,永远对不上 |
| **矩阵存哪** | 目标项目 `.claude/matrix/feature-matrix.yaml` | HelmFlow 自己 `data/feature-matrix.yaml` | 项目与它的"功能地图"分离 |
| **Feature ID** | **双 ID**:`features.id=F005`(HelmCode)+ `matrixCellId=D-05`(业务) | 只有 cellId(D-01__正式签约),无 F005 层 | Feature ID 映射本无难题,原设计早已用双 ID 解决 |
| **status** | **派生**,由 status-derivation 实时从 contracts+runs 推导(§7:"status 字段不存在") | 直接存在 `feature_scenarios.scenarioStatus` | 必然 drift — 产物变了状态不跟,即"导入"需求之根 |
| **契约格式** | 复用 HelmCode clarify 的 9 章节 | 自创简化 6 章节 ContractSchema | 标准 drift(`helmcode-management-goals.md` 要根治的同一类病) |
| **Clarifier** | 用 HelmCode clarify skill 产出 | 借 skill 的壳,却用简化 schema 校验、写自己仓库 | 半吊子,格式对不齐 |

**偏移成因**:Goal 1-3 为在 portal 快速看到东西,把契约/矩阵就近放 portal 的 `data/`。Goal 13/15 补了多项目 manifest + worktree,但产物存储位置没回归原设计。

---

## 3. "开发状态导入"的真正形态

若产物锚定目标项目(原设计),则不存在"HelmFlow 侧导入" vs "HelmFlow 自己产出"两条路 —— 它们是同一条路:无论谁产出契约(HelmCode 直开 / HelmFlow 编排 Clarifier),契约都落目标项目 `.claude/contracts/`,HelmFlow 统一 **扫描 → 识别 → 同步状态**。

所以需求本质 = **一个从目标项目产物单向收敛状态的状态同步引擎**,对两条开发路径透明。

---

## 4. 控制平面三原则(改造依据)

1. **产物锚定目标项目**:契约写 `.claude/contracts/`、矩阵读 `.claude/matrix/`。HelmFlow 的 `data/contracts/` 降级为只读缓存或废弃。
2. **状态由产物同步**:保留 `scenarioStatus` 存储(派生每次算太贵),但加"从产物回写"的同步通道:`扫描契约 status(done) → 更新 scenarioStatus(已支持)`。
3. **双 ID 打通**:features 加 HelmCode 风格 featureId(F005),保留 matrixCellId(D-05)作业务标识,二者靠契约字段或 registry 映射。

---

## 5. 改造路线(按优先级)

### P0 — 回归控制平面(地基)
- [ ] 契约/矩阵产物锚定目标项目;`data/contracts/` 降级/废弃
- [ ] 状态同步通道:扫描产物 → 回写 scenarioStatus
- [ ] features 引入双 ID(featureId + matrixCellId)

### P1 — 状态同步引擎(本次需求核心)
- [ ] 扫描器:读目标项目 `.claude/contracts/` + `registry.md`
- [ ] 契约 schema 向 HelmCode 9 章节对齐,废弃简化版
- [ ] 匹配 + 状态映射:契约 → cell(best-effort,匹配不上跳过);`contract.status → scenarioStatus`
- [ ] Portal 入口:手动"同步状态" + 可选定时轮询

### P2 — 产出侧对齐(编排路径走统一通道)
- [ ] Clarifier 产出改写目标项目 `.claude/contracts/`、用 HelmCode 格式
- [ ] 完成后编排路径与直开路径完全等价,状态引擎一份代码服务两边

---

## 6. 待拍板细节(进 plan 前需定)

| # | 决策 | 倾向 |
|---|------|------|
| 1 | Feature ID 映射:契约里显式标 matrixCellId / 维护映射表 / 名称模糊匹配 | 契约 frontmatter 显式标 `helmflowCellId`(HelmCode skill 配合),降级用 registry |
| 2 | 状态映射规则:done→已支持、approved→已支持、draft→待实现、goal-running→需改造、blocked→需改造 | 如左 |
| 3 | 改造节奏:P0→P1→P2 全做 vs 先 P1 扫描同步(P0/P2 缓做) | 先 P0 地基 + P1 引擎,P2 随后 |

---

## 7. 规范化开发管理定位(数据模型基准)

> HelmFlow 是**规范化管理开发的中台**,不是"旧→新重构工具"。早期 `full-loop-platform.md` 的 mycmdeliverhub 重构语境留下了 `legacy`(旧实现)/`target`(目标实现)二元残留,与本定位冲突,已清除。

### 7.1 功能点模型(去重构二元)

一个功能点 = **实现定位 + 契约 + 开发状态 + 标准**,无"旧实现/新实现"对立:

- **实现定位(`implementation`)**:`handler`/`actions`/`context` — 功能点预期落在哪些代码符号上。用途:analyze 扫码定位 + 契约引用锚点。**中性"代码入口",非"重构目标"。**
- 已删除:`legacy.flowCode`/`legacy.activities`(旧重构语境产物)。DB 列 `legacy_flow_code`/`legacy_activities` 保留仅为历史可追溯,标 `@deprecated`,代码不再读写。
- `feature-matrix.yaml` schemaVersion 3:`target:` → `implementation:`,`legacy:` 块移除。

### 7.2 ScenarioStatus 语义重定义(字符串不变)

枚举 token(`已支持`/`需改造`/`待实现`/`废弃`)**不变**(133 处引用 + DB + contract-sync status_map + LLM 输出依赖,改字符串高风险零收益),仅重定义叙事为「开发治理状态」:

| 枚举(不变) | 语义 |
|---|---|
| 已支持 | 已实现并经治理确认,维护态 |
| 需改造 | 已实现但不符规范/契约,进治理队列 |
| 待实现 | 尚未落地,进开发队列 |
| 废弃 | 下线,不纳入治理 |

`guard.OPERABLE_STATUSES`/`apply.DOWNGRADE_TARGETS` 的 `Set("需改造","待实现")` 语义天然兼容(待治理/待开发,可启动 agent)。

### 7.3 agent 叙事(去"重构进度")

Clarifier/analyze 的 prompt 措辞从"旧实现/渐进式改造/重构进度"→"开发治理状态/按 HelmCode 规范对齐/实现状态"。agent 流水线是**辅助按规范实现**的手段,不是"重构旧代码"。

> 注:`full-loop-platform.md`/`README.md` 的"重构"字样为 mycmdeliverhub 历史背景叙述,本节为现行定位基准。
