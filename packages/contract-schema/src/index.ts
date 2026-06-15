import { z } from "zod";

// ---------------------------------------------------------------------------
// 对应 docs/architecture/agent-protocol.md §2.1 Clarifier 节点产出的 Contract
// frontmatter:featureId / status / project / createdAt / domain / matrixCellId
// 章节(markdown):problemDefinition / stateMachine / businessRules /
//   acceptanceCriteria / apiContract / domainModel
// ---------------------------------------------------------------------------

export const ContractStatus = z.enum([
  "draft",
  "approved",
  "done",
  "blocked",
  "abandoned",
]);
export type ContractStatus = z.infer<typeof ContractStatus>;

export const BusinessRuleSchema = z.object({
  id: z.string().regex(/^BR-\d{3}$/, "businessRule.id 必须形如 BR-001"),
  text: z.string().min(1),
});
export type BusinessRule = z.infer<typeof BusinessRuleSchema>;

export const AcceptanceCriterionSchema = z.object({
  id: z.string().regex(/^AC-\d{3}$/, "acceptanceCriteria.id 必须形如 AC-001"),
  text: z.string().min(1),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const ApiContractEntrySchema = z.object({
  method: z.string().min(1),
  request: z.string().min(1),
  response: z.string().min(1),
});
export type ApiContractEntry = z.infer<typeof ApiContractEntrySchema>;

export const ContractSchema = z.object({
  // frontmatter
  featureId: z.string().min(1),
  status: ContractStatus,
  project: z.string().min(1),
  createdAt: z.string().min(1),
  domain: z.string().min(1),
  matrixCellId: z.string().min(1),
  // markdown 章节
  problemDefinition: z.string().min(1),
  stateMachine: z.string().min(1),
  businessRules: z.array(BusinessRuleSchema).min(1),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(3),
  apiContract: z.array(ApiContractEntrySchema).min(1),
  domainModel: z.string().min(1),
});
export type Contract = z.infer<typeof ContractSchema>;

// ---------------------------------------------------------------------------
// parseContract — 把 markdown 字符串解析成 Contract 候选对象,再经 zod 校验。
//   入参:含 yaml frontmatter (---) + 二级章节 (## ...) 的 markdown
//   返回:{ ok: true, data } 或 { ok: false, errors: string[] }
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; data: Contract }
  | { ok: false; errors: string[] };

const REQUIRED_HEADINGS = [
  "Problem Definition",
  "State Machine",
  "Business Rules",
  "Acceptance Criteria",
  "API Contract",
  "Domain Model",
] as const;

interface RawFrontmatter {
  featureId?: string;
  status?: string;
  project?: string;
  createdAt?: string;
  domain?: string;
  matrixCellId?: string;
  [k: string]: unknown;
}

function splitFrontmatter(md: string): { fm: string | null; body: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { fm: null, body: md };
  return { fm: m[1] ?? "", body: m[2] ?? "" };
}

function parseFrontmatter(fm: string): RawFrontmatter {
  // 极简 yaml 解析:仅支持 `key: value` 平铺,够 frontmatter 用
  const out: RawFrontmatter = {};
  for (const raw of fm.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
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

function extractIdList(
  block: string,
  prefix: "BR" | "AC",
): { id: string; text: string }[] {
  const items: { id: string; text: string }[] = [];
  // 接受 `- BR-001: 描述` 与 `- BR-001 描述` 两种格式 — 冒号(ASCII 或全角)可选,
  // ID 与描述之间至少 1 个分隔符(冒号 / 空白)。
  const re = new RegExp(
    `^[\\-\\*]\\s*(${prefix}-\\d{3})[\\s::]+(.+)$`,
  );
  for (const raw of block.split(/\r?\n/)) {
    const m = raw.trim().match(re);
    if (m && m[1] !== undefined && m[2] !== undefined) {
      items.push({ id: m[1], text: m[2].trim() });
    }
  }
  return items;
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
    if (cells[0] === "Method" || /^[-:\s]+$/.test(cells[0] ?? "")) continue;
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

export function parseContract(md: string): ParseResult {
  const { fm, body } = splitFrontmatter(md);
  if (fm === null) {
    return { ok: false, errors: ["缺少 yaml frontmatter (--- ... ---)"] };
  }
  const frontmatter = parseFrontmatter(fm);
  const sections = splitSections(body);

  const missing = REQUIRED_HEADINGS.filter((h) => !sections.has(h));
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [`缺少必需章节:${missing.join(", ")}`],
    };
  }

  const candidate: Record<string, unknown> = {
    featureId: frontmatter.featureId,
    status: frontmatter.status,
    project: frontmatter.project,
    createdAt: frontmatter.createdAt,
    domain: frontmatter.domain,
    matrixCellId: frontmatter.matrixCellId,
    problemDefinition: sections.get("Problem Definition") ?? "",
    stateMachine: sections.get("State Machine") ?? "",
    businessRules: extractIdList(sections.get("Business Rules") ?? "", "BR"),
    acceptanceCriteria: extractIdList(
      sections.get("Acceptance Criteria") ?? "",
      "AC",
    ),
    apiContract: parseApiTable(sections.get("API Contract") ?? ""),
    domainModel: sections.get("Domain Model") ?? "",
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
  acId: z.string().regex(/^AC-\d{3}$/, "acId 必须形如 AC-001"),
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
  acId: z.string().regex(/^AC-\d{3}$/, "acId 必须形如 AC-001"),
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
