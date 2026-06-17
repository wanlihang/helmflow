/**
 * 项目结构分析器 — prompt 构建 + 结果解析
 *
 * 两阶段 Agent 流程：
 * Phase 1 (runNode):  扫描 src/main/java，收集 Handler/Action 清单及分支条件
 * Phase 2 (runClassify): 基于清单推断域 / 功能点 / 场景
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface ScannedHandler {
  className: string;
  qualifiedName: string;
  packageName: string;
  methods: string[];
  businessDimensions: string[]; // 仅业务级分支维度（如 contractType: FORMAL | TEST）
  calledActions: string[];
  linesOfCode: number;
  hasRealLogic: boolean; // false = 骨架 / TODO
}

export interface ScannedClass {
  className: string;
  qualifiedName: string;
  type: "handler" | "action" | "domain-service" | "model" | "repository" | "other";
  methods: number;
  todos: number;
  lines: number;
  skeleton: boolean;
}

export interface InferredScenario {
  name: string;
  status: string;
  confidence: "high" | "low";
  branchHint?: string; // 推断依据
}

export interface InferredFeature {
  id: string;
  name: string;
  domain: string;
  domainName: string;
  handler: string;
  actions: string[];
  context: string;
  priority: string;
  scenarios: InferredScenario[];
}

export interface StructureAnalysisResult {
  domains: Array<{
    id: string;
    name: string;
    features: InferredFeature[];
  }>;
  scanSummary: {
    totalHandlers: number;
    totalActions: number;
    totalDomains: number;
    scanDurationMs: number;
    classifyDurationMs: number;
  };
}

// ---------------------------------------------------------------------------
// Phase 1 Prompt: 扫描代码库
// ---------------------------------------------------------------------------

export function buildScanPrompt(): string {
  return `## 任务

扫描项目中的所有 Java 源文件，生成两份结构化清单。

### 扫描策略
- **单模块项目**：直接扫描 src/main/java
- **多模块项目**：扫描所有子模块下的 src/main/java（如 app/*/src/main/java, */src/main/java 等）
- 先用 Glob 查找所有 .java 文件：**/*.java 或 **/src/main/java/**/*.java
- 不要遗漏任何子目录中的 Java 文件

### 清单 1: 类清单 (Inventory)

对每个 Java 类记录：
- className: 简单类名
- qualifiedName: 完整包名.类名
- type: 按 DDD 分层判断类型
  - 文件路径含 handler → "handler"
  - 文件路径含 action → "action"
  - 文件路径含 domain/service → "domain-service"
  - 文件路径含 model/entity/vo/dto → "model"
  - 文件路径含 repository/dao/mapper → "repository"
  - 其他 → "other"
- methods: 公共方法数量
- todos: TODO/FIXME 注释数量
- lines: 有效代码行数（去掉空行和注释）
- skeleton: 是否骨架代码（方法体只有 return null/0/""/throw UnsupportedOperationException/空块/仅调 super）

### 清单 2: Handler 分析

对每个 Handler 类（文件路径含 handler）：
- className: 类名
- qualifiedName: 完整包名
- packageName: 包名（取 handler 之前的路径段作为域标识，如 com.example.deliver.handler → "deliver"）
- methods: 所有 public 方法名列表
- businessDimensions: **仅采集业务级分支维度**
  ⚠️ 这是最关键的字段，请务必严格区分"业务维度"和"实现分支"：

  **属于业务维度 → 应采集**：
  - 决定走哪条业务流程的枚举：如 contractType(FORMAL/TEST)、signingMode(ONLINE/OFFLINE)、orderSource(MANUAL/IMPORT)
  - 决定功能是否有本质不同的业务条件：如 是否组合签约、是否单品定价
  - 通俗讲：如果改了这个值，Handler 会走**完全不同的业务流程**，则属于业务维度

  **不属于业务维度 → 不要采集**：
  - 状态流转：审批通过/驳回/撤消、节点通过/驳回 —— 这些是同一流程内的状态变化，不是独立场景
  - 校验结果：校验通过/失败、逆向检查通过/失败 —— 这是流程中的条件判断，不是独立场景
  - 异常处理：try/catch、业务异常/系统异常 —— 所有场景都有异常处理，不是独立场景
  - 回调类型：协议状态回调/签约回调/价格回调 —— 回调是触发方式，不是场景维度
  - 数据校验：记录号为空跳过、状态码为空 —— 这是防御性编码，不是场景
  - 执行结果：正常/异常、解析为通过/驳回 —— 这是执行结果，不是场景

  采集格式：列出变量名和所有业务枚举值，如：
  - "contractType: FORMAL | TEST"
  - "signingMode: COMBO | SINGLE"
  - 无业务维度时输出空数组 []
- calledActions: 该 Handler 调用的 Action 类名列表
- linesOfCode: 有效代码行数
- hasRealLogic: 是否有真正的业务逻辑（非骨架）

### 判断骨架代码的规则
方法体仅有以下内容视为骨架：
- return null; return 0; return ""; return false;
- throw new UnsupportedOperationException
- 空方法体
- 仅调用 super.xxx()

## 输出格式

用 XML 标签分别包裹两份 JSON 数组：

\`\`\`
<INVENTORY>
[
  {"className":"SaveDeliverRecordHandler","qualifiedName":"com.example.deliver.handler.SaveDeliverRecordHandler","type":"handler","methods":5,"todos":0,"lines":120,"skeleton":false},
  ...（所有类）
]
</INVENTORY>

<HANDLER_ANALYSIS>
[
  {"className":"SaveDeliverRecordHandler","qualifiedName":"com.example.deliver.handler.SaveDeliverRecordHandler","packageName":"com.example.deliver","methods":["handle","validate","save"],"businessDimensions":["contractType: FORMAL | TEST"],"calledActions":["SaveDeliverRecordAction"],"linesOfCode":120,"hasRealLogic":true},
  ...（所有 Handler）
]
</HANDLER_ANALYSIS>
\`\`\`

只输出 JSON（带标签），不要其他内容。务必扫描所有子目录，不要遗漏。`;
}

// ---------------------------------------------------------------------------
// Phase 2 Prompt: 推断域 / 功能点 / 场景
// ---------------------------------------------------------------------------

export function buildInferPrompt(
  inventory: ScannedClass[],
  handlers: ScannedHandler[],
): string {
  const inventoryJson = JSON.stringify(inventory, null, 2);
  const handlersJson = JSON.stringify(handlers, null, 2);

  return `## 任务

基于代码扫描结果，推断项目的域(Domain)划分、功能点(Feature)和**业务场景**(Scenario)。

⚠️ 场景(Scenario)的定义是核心难点，请务必仔细阅读下方规则。

## 输入数据

### 类清单
\`\`\`json
${inventoryJson}
\`\`\`

### Handler 分析
\`\`\`json
${handlersJson}
\`\`\`

## 推断规则

### 1. 域(Domain)推断
- 以 Handler 的 packageName 中 handler 之前的路径段作为域 ID
- 例: com.example.deliver.handler → domain.id="deliver", domain.name="交付管理"
- 如果有中文注释或类名暗示的领域，使用更友好的中文名称
- 对于没有 handler 的域（如基础设施），归入 "shared" 域

### 2. 功能点(Feature)推断
- 每个 Handler 类 → 一个功能点
- feature.id: 按 "D-01", "D-02"... 顺序编号（D=域首字母大写）
  - 如果有多个域，用不同前缀：deliver → D-01, mapping → M-01, pricing → P-01
- feature.name: 从 Handler 类名推断中文名称
  - SaveDeliverRecordHandler → "保存交付记录"
  - CreateOrderHandler → "创建订单"
  - 去掉 Handler 后缀，将驼峰转为中文功能描述
- feature.handler: Handler 类名
- feature.actions: 该 Handler 调用的 Action 类名列表
- feature.context: 域 ID
- feature.priority: 默认 "P1"

### 3. 场景(Scenario)推断 — ⚠️ 核心规则，请严格遵守

**场景 = 业务维度**，即决定该功能走哪条**根本不同的业务流程**的分支条件。
场景 ≠ 实现细节、状态流转、校验结果、异常分支。

#### 什么是场景（✅ 应创建）

场景代表**同一功能在不同业务条件下的流程差异**。典型模式：

1. **签约类型**：正式签约
2. **业务模式**：组合签约 / 单品签约 / 历史组合复用
3. **业务来源**：手动创建 / 批量导入 / API 触发
4. **签约渠道**：线上签约 / 线下签约

判断标准：**如果切换这个条件，Handler 会走完全不同的 Action 组合或业务流**，则属于业务场景。

#### 什么不是场景（❌ 禁止创建）

以下代码模式**绝对不能**作为独立场景，它们是同一业务流程内的实现分支：

- ❌ **审批/审核结果**：审批通过、审批驳回、审批撤消 → 这是同一个场景内的状态流转，不是不同的业务场景
- ❌ **校验结果**：校验通过、校验失败、逆向校验通过、逆向校验失败 → 这是流程中的条件判断
- ❌ **异常路径**：正常执行、异常处理、业务异常重抛、系统异常重抛 → 所有场景都有异常处理
- ❌ **节点状态**：节点通过、节点驳回、节点撤消 → 这是流程节点的状态变化
- ❌ **回调类型**：协议状态回调、签约操作回调、价格方案回调 → 回调是触发机制，不是业务维度
- ❌ **解析结果**：解析为通过、解析为驳回、解析为撤消 → 这是回调处理的结果
- ❌ **数据校验**：状态码为空、记录号为空-跳过 → 防御性编程
- ❌ **推进方式**：审批通过-推进并构建签约树 → 这是审批通过后的后续动作，不是独立场景
- ❌ **退回/删除细分**：逆向校验通过-退回、逆向校验通过-删除 → 退回和删除本身就是独立功能点，不是同一功能点的场景

#### 场景推断策略

**策略 A — 有 businessDimensions 时的精确推断（置信度 high）**:
- 直接从 Handler 的 businessDimensions 提取业务维度
- 例: businessDimensions=["contractType: FORMAL"] → 场景: "正式签约"
- 例: businessDimensions=["signingMode: COMBO | SINGLE"] → 场景: "组合签约" / "单品签约"
- 例: businessDimensions=["source: MANUAL | IMPORT"] → 场景: "手动创建" / "批量导入"

**策略 B — 无 businessDimensions 但类名暗示业务维度（置信度 medium）**:
- Handler 名含 Submit/Approve → 可能只是"提交"动作，默认场景即可
- Handler 名含 Query/List → 查询类功能，默认场景即可
- Handler 名含 Check/Validate → 校验类功能，默认场景即可

**策略 C — 无法推断时（置信度 low，默认降级）**:
- 使用单一默认场景: [{"name":"默认场景","status":"待实现","confidence":"low"}]

#### ⚠️ 硬性约束

1. **每个功能点的场景数 ≤ 3**（极少数情况可到 5，但必须每个都是真正的业务维度）
2. **绝对禁止**把以下内容作为场景：审批结果、校验结果、异常路径、回调类型、状态流转、数据校验
3. **场景名应是业务术语**（如"正式签约"），而非技术术语（如"构建签约树"）
4. 如果一个 Handler 只做一件事（如查询、校验），只给"默认场景"

### 4. 场景状态
- 所有场景默认 status: "待实现"
- 如果 Handler 的 hasRealLogic=true 且无 TODO → 置信度 high，但仍标记为"待实现"（后续由 analyze-status 判断真实状态）

## 输出格式

输出 JSON 数组，用 \`<STRUCTURE_RESULT>\` 和 \`</STRUCTURE_RESULT>\` 标签包裹：

\`\`\`
<STRUCTURE_RESULT>
{
  "domains": [
    {
      "id": "deliver",
      "name": "交付管理",
      "features": [
        {
          "id": "D-01",
          "name": "保存交付记录",
          "domain": "deliver",
          "domainName": "交付管理",
          "handler": "SaveDeliverRecordHandler",
          "actions": ["SaveDeliverRecordAction"],
          "context": "deliver",
          "priority": "P1",
          "scenarios": [
            {"name": "正式签约", "status": "待实现", "confidence": "high", "branchHint": "contractType: FORMAL"}
          ]
        },
        {
          "id": "D-02",
          "name": "查询交付记录",
          "domain": "deliver",
          "domainName": "交付管理",
          "handler": "QueryDeliverRecordHandler",
          "actions": ["QueryAction"],
          "context": "deliver",
          "priority": "P1",
          "scenarios": [
            {"name": "默认场景", "status": "待实现", "confidence": "low", "branchHint": ""}
          ]
        }
      ]
    }
  ]
}
</STRUCTURE_RESULT>
\`\`\`

只输出 JSON（带标签），不要其他内容。每个 Handler 必须对应一个功能点。场景数量严格 ≤ 3。`;
}

// ---------------------------------------------------------------------------
// 输出解析
// ---------------------------------------------------------------------------

export function parseInventoryOutput(text: string): ScannedClass[] {
  const match = text.match(/<INVENTORY>([\s\S]*?)<\/INVENTORY>/);
  if (!match?.[1]) return [];
  try {
    let raw = match[1].trim();
    const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fence?.[1]) raw = fence[1].trim();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is ScannedClass =>
        typeof item === "object" && item !== null && "className" in item,
    );
  } catch {
    return [];
  }
}

export function parseHandlerOutput(text: string): ScannedHandler[] {
  const match = text.match(/<HANDLER_ANALYSIS>([\s\S]*?)<\/HANDLER_ANALYSIS>/);
  if (!match?.[1]) return [];
  try {
    let raw = match[1].trim();
    const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fence?.[1]) raw = fence[1].trim();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && "className" in item,
    ).map((item) => ({
      className: String(item.className ?? ""),
      qualifiedName: String(item.qualifiedName ?? ""),
      packageName: String(item.packageName ?? ""),
      methods: Array.isArray(item.methods) ? item.methods as string[] : [],
      // 兼容旧字段 branchConditions 和新字段 businessDimensions
      businessDimensions: Array.isArray(item.businessDimensions)
        ? item.businessDimensions as string[]
        : Array.isArray(item.branchConditions)
          ? item.branchConditions as string[]
          : [],
      calledActions: Array.isArray(item.calledActions) ? item.calledActions as string[] : [],
      linesOfCode: typeof item.linesOfCode === "number" ? item.linesOfCode : 0,
      hasRealLogic: typeof item.hasRealLogic === "boolean" ? item.hasRealLogic : true,
    }));
  } catch {
    return [];
  }
}

export function parseStructureResult(
  text: string,
): StructureAnalysisResult | null {
  const match = text.match(/<STRUCTURE_RESULT>([\s\S]*?)<\/STRUCTURE_RESULT>/);
  if (!match?.[1]) return null;
  try {
    let raw = match[1].trim();
    const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fence?.[1]) raw = fence[1].trim();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.domains)) return null;
    return parsed as StructureAnalysisResult;
  } catch {
    return null;
  }
}
