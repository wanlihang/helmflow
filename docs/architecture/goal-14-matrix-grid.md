# Goal 14 — Feature Matrix 重构:多场景网格(精简版)

> 直接复制下面代码块到 Claude Code。

```
/goal 在 G13 基础上重构 Feature Matrix 为多场景网格。每个 feature 从单一 status 改为 scenarios 数组,每场景有 name/status/note。首页从卡片网格改为域内表格(行=功能,列=场景)。前置:G13 已 commit。

【范围】
1. 升级 data/feature-matrix.yaml schemaVersion=2:
   feature 去掉 status 字段,改为 scenarios:[{name,status,note}]
   场景 status 枚举:已支持|需改造|待实现|废弃
   重写全部 feature 为单场景:"正式签约"
   deliver(9feature):创建交付需求/识别客户类型/判定签约模式/创建关联交付需求(废弃)/前进/回退/删除/详情查询/列表查询
   mapping(7):保存映射(需改造)/提交审批(已支持)/审批通过(需改造)/审批拒绝(已支持)/构建产品树(待实现)/产品树查询(待实现)/触发自研签约(已支持)
   pricing(13):预校验(需改造)/查得标(已支持)/价格受理(待实现)/套餐新建(需改造)/套餐复用(需改造)/单产品计费(需改造)/多价格选一(待实现)/套餐成员签约(待实现)/提交审批(需改造)/审批结果(需改造)/价格生效(需改造)/计费查询(待实现)/价格管理查询(待实现)
   signing(3):触发签约(需改造)/签约操作(需改造)/签约回调(需改造)
   ops(2):SOP基座(废弃)/审计日志(已支持)

2. 改 lib/matrix.ts:Feature 去 status 加 scenarios:Scenario[],Scenario={name,status,note}
   ScenarioStatus="已支持"|"需改造"|"待实现"|"废弃"。loadMatrix 读 v2 yaml,兼容 v1(无 scenarios 时包装为单场景)。

3. storage:features 表加 scenariosJson:text 列+DDL。repo 加 updateFeatureScenarios。
   sync-matrix.ts 额外写 scenariosJson。

4. 新 components/feature-matrix-table.tsx:HTML table 渲染,行=功能,列=场景。
   场景 Badge 色:已支持=绿,需改造=黄,待实现=灰,废弃=红。
   扩 badge.tsx 加 scenario 变体。行可点跳详情页。

5. 改 page.tsx:DomainSection/FeatureCard → FeatureMatrixTable。统计改按场景统计4色图例。删 domain-section.tsx+feature-card.tsx。

6. 改详情页:加"场景状态"section(每场景一行name+badge+note),保留 agent status。

【约束】v1兼容/场景status与agent status独立/不改agent route/只加列不删列/表可水平滚动/严格TS

【通过信号】
1.pnpm -r typecheck 0 error
2.首页5域各为表格(非卡片)
3.表头含"正式签约"列
4."识别客户类型"正式签约列=绿"已支持";"创建关联交付需求"=红"废弃"
5.点行跳详情页→显示场景列表
6.yaml含schemaVersion:2+34个feature各含scenarios
7.sqlite3 features表有scenarios_json列
8.存在性:feature-matrix-table.tsx/badge.tsx含scenario

完成后输出"Goal 14 验收清单"。
```
