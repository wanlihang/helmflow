import { z } from "zod";

// ---------------------------------------------------------------------------
// Contract — HelmCode 中文 9 章节格式(控制平面回归第二刀对齐 helmcode clarify skill)
// 业务元从引用块提取:`> - Feature ID:` / `> - 涉及领域:` / `> - 状态:` / `> - matrixCellId:`(HelmFlow 专属)
// 章节:问题定义/状态机/业务规则/API契约/领域模型(+ 可选 Schema变更/兼容性约束/AC-测试映射)
// parseContract 支持中英文双语 headings(兼容历史英文产出)。
// ---------------------------------------------------------------------------

export const ContractStatus = z.enum([
  "draft",
  "approved",
  "goal-running",
  "done",
  "blocked",
  "abandoned",
]);
export type ContractStatus = z.infer<typeof ContractStatus>;

export const BusinessRuleSchema = z.object({
  id: z.string().regex(/^BR-[A-Z0-9-]+$/, "businessRule.id 必须形如 BR-001 或 BR-PS-001(含域前缀)"),
  text: z.string().min(1),
});
export type BusinessRule = z.infer<typeof BusinessRuleSchema>;

export const AcceptanceCriterionSchema = z.object({
  id: z.string().regex(/^AC-\d{1,3}$/, "acceptanceCriteria.id 必须形如 AC-001(1-3 位数字)"),
  text: z.string().min(1),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const ApiContractEntrySchema = z.object({
  method: z.string().min(1),
  request: z.string().min(1),
  response: z.string().min(1),
});
export type ApiContractEntry = z.infer<typeof ApiContractEntrySchema>;

// AC-测试映射表一行:AC | 测试类 | 测试方法 | 断言类型
export const AcTestMappingRowSchema = z.object({
  acId: z.string().regex(/^AC-\d{1,3}$/),
  testClass: z.string().min(1),
  testMethod: z.string().min(1),
});
export type AcTestMappingRow = z.infer<typeof AcTestMappingRowSchema>;

// ---------------------------------------------------------------------------
// ContractSchema — HelmCode 中文 9 章节格式(控制平面回归第二刀对齐)
// 业务元从引用块 `> - Feature ID:` / `> - 涉及领域:` / `> - 状态:` / `> - matrixCellId:` 提取
// (与 HelmCode core/clarify/references/contract-template.md 一致;matrixCellId 为 HelmFlow 专属)
// ---------------------------------------------------------------------------
export const ContractSchema = z.object({
  // 引用块业务元
  featureId: z.string().min(1),
  status: ContractStatus,
  domain: z.string().min(1),
  matrixCellId: z.string().optional().default(""),
  priority: z.string().optional().default(""),
  // markdown 章节(中文 9 章节)
  problemDefinition: z.string().min(1),
  stateMachine: z.string(),
  businessRules: z.array(BusinessRuleSchema).min(1),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(3),
  apiContract: z.array(ApiContractEntrySchema),
  domainModel: z.string(),
  schemaChanges: z.string().optional().default(""),
  compatibilityConstraints: z.string().optional().default(""),
  acTestMapping: z.array(AcTestMappingRowSchema).optional().default([]),
});
export type Contract = z.infer<typeof ContractSchema>;

// ---------------------------------------------------------------------------
// parseContract — 把 HelmCode 中文格式 markdown 解析成 Contract 候选,再经 zod 校验。
//   业务元来自引用块(> - key: value);章节按 `## 标题` 切分(语言无关)。
//   返回:{ ok: true, data } 或 { ok: false, errors: string[] }
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; data: Contract }
  | { ok: false; errors: string[] };

// 必需章节(规范名)+ 别名。支持中文(HelmCode 标准)与英文(历史产出)双向兼容,
// 避免 LLM 产出语言漂移导致 parseContract 失败 → critic 跑不到 → 契约 blocked。
const HEADING_ALIASES: Record<string, string[]> = {
  "问题定义": ["问题定义", "Problem Definition"],
  "状态机": ["状态机", "State Machine"],
  "业务规则": ["业务规则", "Business Rules"],
  "API契约": ["API契约", "API 契约", "API Contract"],
  "领域模型": ["领域模型", "Domain Model"],
};
const OPTIONAL_HEADINGS: Record<string, string[]> = {
  "Schema变更": ["Schema变更", "Schema 变更", "Schema Changes"],
  "兼容性约束": ["兼容性约束", "Compatibility Constraints"],
  "AC-测试映射": ["AC-测试映射", "AC-测试映射表", "AC-Test Mapping"],
};

function getSection(sections: Map<string, string>, aliases: string[]): string {
  for (const a of aliases) {
    const v = sections.get(a);
    if (v !== undefined) return v;
  }
  return "";
}

// 从 markdown 引用块提取 `> - key: value`。宽松匹配(中英文 key、全角/半角冒号)。
function extractQuoteField(md: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^>\\s*-?\\s*${escaped}\\s*[:：]\\s*(.+?)\\s*$`, "im");
  const m = md.match(re);
  return m && m[1] ? m[1].trim() : null;
}

function splitSections(body: string): Map<string, string> {
  const lines = body.split(/\r?\n/);
  const sections = new Map<string, string>();
  let cur: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur !== null) sections.set(cur, buf.join("\n").trim());
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m && m[1] !== undefined) {
      flush();
      cur = m[1].trim();
    } else if (cur !== null) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * 提取 BR/AC 列表。兼容:
 *   - `- BR-001: 描述`(破折号列表)
 *   - `* AC-001: …`(星号列表)
 *   - `1. AC-001 …`(有序列表 —— 模型常用,锚点放宽到此)
 *   - `- **BR-PS-001**: 描述`(HelmCode 域前缀 + 粗体,先去 ** 再匹配)
 *   - `- [ ] AC-001: 描述 — 验证方式: 测试 — 优先级: P0`(checkbox 格式,
 *     截断到首个 ` — ` 或 ` -- ` 分隔符前作为 text,避免验证方式/优先级污染)
 */
function extractIdList(
  block: string,
  prefix: "BR" | "AC",
): { id: string; text: string }[] {
  const items: { id: string; text: string }[] = [];
  // id 后的分隔符可选(空格/冒号/竖线/括号/顿号),兼容模型各种漂移:
  //   `AC-1: 描述` / `AC-1 | 内容` / `AC-1(优先级…):内容` / `AC-1 内容`
  const re = new RegExp(
    `^(?:[\\-\\*]|\\d+\\.)\\s*(?:\\[[ xX]\\]\\s*)?(${prefix}-[A-Z0-9-]+)[\\s::：|（）()、,]*(.+)$`,
  );
  for (const raw of block.split(/\r?\n/)) {
    // 去粗体标记(**BR-xxx** → BR-xxx),兼容 HelmCode 粗体产出
    const line = raw.trim().replace(/\*\*/g, "");
    const m = line.match(re);
    if (m && m[1] !== undefined && m[2] !== undefined) {
      // 截断 AC 的 ` — 验证方式: ... — 优先级: ...` 尾部
      const text = m[2].split(/\s+[—–-]+\s/)[0]!.trim();
      items.push({ id: m[1], text });
    }
  }
  return items;
}

/**
 * 解析验收条件表格(`| AC-1 | P0 | 测试 | 描述 |`)。
 * 模型(glm-5.2 等)常把 AC 输出成表格而非 HelmCode 标准列表,这里作兜底:
 * 首列匹配 AC-\d{1,3},末列作为 text(内容列)。
 */
function parseAcTable(block: string): { id: string; text: string }[] {
  const rows: { id: string; text: string }[] = [];
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const first = (cells[0] ?? "").replace(/\*\*/g, "");
    const m = first.match(/^(AC-\d{1,3})$/);
    if (!m) continue; // 跳过表头/分隔行
    const text = (cells[cells.length - 1] ?? "").replace(/\*\*/g, "").trim();
    rows.push({ id: m[1]!, text });
  }
  return rows;
}

/**
 * 提取验收条件。两种来源,按可信度选取:
 *   1. 表格优先 —— 模型常把 AC 写成 `| AC-N | … | 内容 |` 表格,明确无歧义。
 *   2. 无表格时回退 HelmCode 标准列表式(`- [ ] AC-001: 描述`),并过滤"AC-测试映射"项
 *      (形如 `- AC-1 → Test#method`),否则会误抓映射列表、text 变成测试方法名。
 */
function extractAcList(block: string): { id: string; text: string }[] {
  const table = parseAcTable(block);
  if (table.length > 0) return table;
  return extractIdList(block, "AC").filter(
    (it) => !/→|^\s*`?[A-Z][\w]*#/.test(it.text),
  );
}

function parseApiTable(block: string): ApiContractEntry[] {
  const rows: ApiContractEntry[] = [];
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    if (cells[0] === "Method" || cells[0] === "方法" || /^[-:\s]+$/.test(cells[0] ?? "")) continue;
    const [method, request, response] = cells;
    if (
      method !== undefined &&
      request !== undefined &&
      response !== undefined &&
      method.length > 0 &&
      request.length > 0 &&
      response.length > 0
    ) {
      rows.push({ method, request, response });
    }
  }
  return rows;
}

/**
 * 从 ```java 代码块抽 Facade 方法签名(模型常把 Java/SOFABoot API 写成代码块,
 * 比 markdown 表格更忠实)。匹配 `[修饰符] Result<Resp> name(params)` 或 `Resp name(params)`。
 * 仅在 parseApiTable(表格)无结果时作为兜底调用(见 parseApiContract)。
 */
function parseApiFromCodeBlocks(block: string): ApiContractEntry[] {
  const rows: ApiContractEntry[] = [];
  const codeBlocks = block.match(/```[a-z]*\n([\s\S]*?)```/gi) ?? [];
  const code = codeBlocks
    .map((c) => c.replace(/```[a-z]*\n?/i, "").replace(/```\s*$/, ""))
    .join("\n");
  // 归一化:把多行签名压成单行
  const flat = code.replace(/\n\s*/g, " ");
  const re =
    /(?:Result<([A-Za-z_][\w]*)>|([A-Za-z_][\w]*))\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/g;
  const EXCLUDE = new Set(["if", "for", "while", "switch", "return", "new", "catch", "throws"]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    const response = (m[1] ?? m[2] ?? "").trim();
    const method = (m[3] ?? "").trim();
    const params = m[4] ?? "";
    if (!method || EXCLUDE.has(method)) continue;
    // 首个参数类型作为 request(去 @注解 与参数名)
    const firstParam =
      params
        .split(",")
        .map((s) => s.trim())
        .find((p) => p.length > 0) ?? "";
    const reqType = firstParam
      .replace(/^@\w+\s+/, "")
      .replace(/\s+[A-Za-z_]\w*$/, "")
      .trim();
    rows.push({ method, request: reqType || "-", response: response || "-" });
  }
  return rows;
}

/**
 * 解析 API 契约:HelmCode 标准 markdown 表格优先;表格无结果时回退 java 代码块方法签名。
 */
function parseApiContract(block: string): ApiContractEntry[] {
  const tableRows = parseApiTable(block);
  if (tableRows.length > 0) return tableRows;
  return parseApiFromCodeBlocks(block);
}

/** 解析 AC-测试映射表(`| AC | 测试类 | 测试方法/case | 断言类型 |`) */
function parseAcTestMappingTable(block: string): AcTestMappingRow[] {
  const rows: AcTestMappingRow[] = [];
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const first = cells[0] ?? "";
    if (!/^AC-\d{1,3}$/.test(first)) continue; // 跳过表头/分隔行
    rows.push({
      acId: first,
      testClass: cells[1] ?? "",
      testMethod: cells[2] ?? "",
    });
  }
  return rows;
}

export function parseContract(md: string): ParseResult {
  const sections = splitSections(md);

  // 必需章节检测(中英文别名任一命中即可)
  const missing = Object.entries(HEADING_ALIASES)
    .filter(([, aliases]) => !aliases.some((a) => sections.has(a)))
    .map(([canonical]) => canonical);
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [`缺少必需章节:${missing.join(", ")}`],
    };
  }

  // 业务元从引用块提取(featureId 兜底从 `# Feature:` 标题)
  let featureId =
    extractQuoteField(md, "Feature ID") ??
    extractQuoteField(md, "Feature Id") ??
    "";
  if (!featureId) {
    const titleM = md.match(/^#\s+Feature:\s*(\S+)\s*$/m);
    featureId = titleM && titleM[1] ? titleM[1] : "";
  }
  const status = extractQuoteField(md, "状态") ?? extractQuoteField(md, "Status");
  const domain =
    extractQuoteField(md, "涉及领域") ?? extractQuoteField(md, "领域") ?? "";
  const matrixCellId = extractQuoteField(md, "matrixCellId") ?? "";
  const priority = extractQuoteField(md, "优先级") ?? "";

  const candidate: Record<string, unknown> = {
    featureId,
    status,
    domain,
    matrixCellId,
    priority,
    problemDefinition: getSection(sections, HEADING_ALIASES["问题定义"]!),
    stateMachine: getSection(sections, HEADING_ALIASES["状态机"]!),
    businessRules: extractIdList(getSection(sections, HEADING_ALIASES["业务规则"]!), "BR"),
    acceptanceCriteria: extractAcList(getSection(sections, ["验收条件", "Acceptance Criteria"])),
    apiContract: parseApiContract(getSection(sections, HEADING_ALIASES["API契约"]!)),
    domainModel: getSection(sections, HEADING_ALIASES["领域模型"]!),
    schemaChanges: getSection(sections, OPTIONAL_HEADINGS["Schema变更"]!),
    compatibilityConstraints: getSection(sections, OPTIONAL_HEADINGS["兼容性约束"]!),
    acTestMapping: parseAcTestMappingTable(getSection(sections, OPTIONAL_HEADINGS["AC-测试映射"]!)),
  };

  const result = ContractSchema.safeParse(candidate);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map(
      (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
    ),
  };
}

// ---------------------------------------------------------------------------
// TestGen 节点产出:每条 AC ↔ 1+ 个 JUnit 测试方法的映射文件。
// 写到 apps/portal/data/test-ac-mappings/<featureId>/<runId>.yaml。
// 字段命名跟 docs/architecture/agent-protocol.md §2.3 对齐。
// ---------------------------------------------------------------------------
export const TestAcMappingTestSchema = z.object({
  file: z
    .string()
    .min(1)
    .refine(
      (s) => s.startsWith("src/test/java/"),
      "test file path 必须以 src/test/java/ 开头",
    ),
  method: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "method 必须是合法 Java 标识符"),
  type: z
    .enum(["handler", "action", "context", "shared", "repository", "other"])
    .optional(),
});

export const TestAcMappingEntrySchema = z.object({
  acId: z.string().regex(/^AC-\d{1,3}$/, "acId 必须形如 AC-001(1-3 位数字)"),
  tests: z.array(TestAcMappingTestSchema).min(1, "每条 AC 至少 1 个测试映射"),
});

export const TestAcMappingSchema = z.object({
  schemaVersion: z.literal(1),
  featureId: z.string().min(1),
  mappings: z.array(TestAcMappingEntrySchema).min(1),
});

export type TestAcMappingTest = z.infer<typeof TestAcMappingTestSchema>;
export type TestAcMappingEntry = z.infer<typeof TestAcMappingEntrySchema>;
export type TestAcMapping = z.infer<typeof TestAcMappingSchema>;

export type TestAcMappingParseResult =
  | { ok: true; data: TestAcMapping }
  | { ok: false; errors: string[] };

// 用 yaml 包解析 mapping 文本。yaml 解析失败也算 ParseFail。
// 这里不引入 yaml 运行时依赖,改成接受调用方传入 plain object(由 yaml.parse 给出),
// 再走 zod 校验。这样 contract-schema 包不被 yaml 拖累。
export function parseTestAcMapping(raw: unknown): TestAcMappingParseResult {
  const result = TestAcMappingSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    errors: result.error.issues.map(
      (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
    ),
  };
}

// ---------------------------------------------------------------------------
// QA 节点产出:每条 AC 的 pass/fail + 失败细节 + 上层路由建议。
// docs/architecture/agent-protocol.md §2.4 是 ground truth。
// ---------------------------------------------------------------------------
export const QaAcStatusSchema = z.enum(["pass", "fail"]);
export type QaAcStatus = z.infer<typeof QaAcStatusSchema>;

export const QaEscalateActionSchema = z.enum([
  "route-to-coder",
  "route-to-testgen",
  "escalate-human",
]);
export type QaEscalateAction = z.infer<typeof QaEscalateActionSchema>;

export const QaAcResultSchema = z.object({
  acId: z.string().regex(/^AC-\d{1,3}$/, "acId 必须形如 AC-001(1-3 位数字)"),
  status: QaAcStatusSchema,
  tests: z.array(z.string()).optional().default([]),
  failureReason: z.string().optional(),
  suggestedFix: z.string().optional(),
});

export const QaStrictSchema = z
  .object({
    archRules: z
      .object({
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .optional(),
    smokeTest: z
      .object({
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .partial()
  .optional()
  .default({});

export const QaLenientSchema = z.object({
  totalRun: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const QaReportSchema = z.object({
  schemaVersion: z.literal(1),
  featureId: z.string().min(1),
  runAt: z.string().min(1),
  strict: QaStrictSchema,
  lenient: QaLenientSchema,
  acResults: z.array(QaAcResultSchema).min(1),
  gapsDetected: z.number().int().nonnegative(),
  escalateAction: QaEscalateActionSchema,
});

export type QaAcResult = z.infer<typeof QaAcResultSchema>;
export type QaReport = z.infer<typeof QaReportSchema>;

export type QaReportParseResult =
  | { ok: true; data: QaReport }
  | { ok: false; errors: string[] };

export function parseQaReport(raw: unknown): QaReportParseResult {
  const result = QaReportSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    errors: result.error.issues.map(
      (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
    ),
  };
}
