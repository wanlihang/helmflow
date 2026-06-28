/**
 * 确定性状态分类器 — 「代码 × 契约」判定矩阵。
 *
 * 代码状态(无代码/骨架/完整) × 契约(有/无) = 6 组合:
 *   无代码           → 待实现 (C 无契约 / F 有契约,确定性)
 *   骨架(skeleton/TODO) → 需改造 (B / E,确定性)
 *   完整 + 无契约      → 已支持 (A,确定性,即"现在已有")
 *   完整 + 有契约      → LLM 验证 BR/AC (D)
 *   handler 未识别     → LLM (退化)
 *
 * 只有 D 和"未识别 handler"需 LLM,其余全确定性(秒级、稳、零成本)。
 * 纯函数,无外部依赖(Node 直跑可验证)。InventoryItem 结构兼容 @helmflow/adapter-java-ddd。
 */

export interface InventoryItem {
  className: string;
  qualifiedName: string;
  type: "decider" | "acceptor" | "handler" | "action" | "other";
  methods: number;
  todos: number;
  lines: number;
  skeleton: boolean;
}

export type CodeState = "none" | "skeleton" | "complete" | "unknown";
export type ScenarioStatus = "已支持" | "需改造" | "待实现" | "废弃";

export interface ImplementationMatch {
  decider?: string;
  acceptor?: string;
  handler?: string;
  actions: string[];
}

export interface ClassifyResult {
  codeState: CodeState;
  implementation: ImplementationMatch;
  /** 确定性最终状态(needsLLM=false 时直接采用;needsLLM=true 时为候选,LLM 可修正) */
  status: ScenarioStatus;
  /** true=需 LLM(完整+有契约 D,或 handler 未识别) */
  needsLLM: boolean;
  reason: string;
}

/** 从 qualifiedName 提域段:com.xxx.{domain}.handler.XxxHandler → domain */
function extractDomain(qualifiedName: string): string | null {
  const m = qualifiedName.match(/\.([a-z_]+)\.(?:handler|decider|acceptor|action)\./i);
  return m?.[1] ?? null;
}

/** 匹配分层:用 handlerHint 找 handler,同域推 decider/acceptor/actions */
export function matchImplementation(
  inventory: InventoryItem[],
  handlerHint: string,
): ImplementationMatch {
  const handler = inventory.find((i) => i.className === handlerHint && i.type === "handler");
  if (!handler) return { handler: handlerHint || undefined, actions: [] };
  const domain = extractDomain(handler.qualifiedName);
  const inDomain = (i: InventoryItem) => (domain ? i.qualifiedName.includes(`.${domain}.`) : false);
  const decider = inventory.find((i) => i.type === "decider" && inDomain(i))?.className;
  const acceptor = inventory.find((i) => i.type === "acceptor" && inDomain(i))?.className;
  const actions = inventory
    .filter((i) => i.type === "action" && inDomain(i))
    .map((i) => i.className);
  return { decider, acceptor, handler: handler.className, actions };
}

/**
 * 按「代码 × 契约」矩阵判定一个 cell。
 * @param inventory  scanJavaInventory 产出(全确定性)
 * @param handlerHint feature.implementation.handler(类名)
 * @param hasContract 该 cell 是否绑定了契约(getLatestContract 非空)
 */
export function classifyCell(
  inventory: InventoryItem[],
  handlerHint: string,
  hasContract: boolean,
): ClassifyResult {
  // handler 未识别 → 退化 LLM(无法确定性定位代码)
  if (!handlerHint) {
    return {
      codeState: "unknown",
      implementation: { actions: [] },
      status: "待实现",
      needsLLM: true,
      reason: "implementation.handler 未识别,需 LLM 判断",
    };
  }

  const implementation = matchImplementation(inventory, handlerHint);
  const handlerItem = inventory.find(
    (i) => i.className === handlerHint && i.type === "handler",
  );

  // codeState:基于 handler 是否存在 + skeleton/TODO
  let codeState: CodeState;
  if (!handlerItem) {
    codeState = "none";
  } else if (handlerItem.skeleton || handlerItem.todos > 0) {
    codeState = "skeleton";
  } else {
    codeState = "complete";
  }

  // 判定矩阵
  if (codeState === "none") {
    return {
      codeState,
      implementation,
      status: "待实现",
      needsLLM: false,
      reason: `Handler ${handlerHint} 不存在`,
    };
  }
  if (codeState === "skeleton") {
    const why = handlerItem?.skeleton ? "骨架代码" : `含 ${handlerItem?.todos ?? 0} 个 TODO`;
    return {
      codeState,
      implementation,
      status: "需改造",
      needsLLM: false,
      reason: `${handlerHint} ${why}`,
    };
  }
  // complete
  if (hasContract) {
    return {
      codeState,
      implementation,
      status: "已支持",
      needsLLM: true,
      reason: "代码完整 + 有契约,需 LLM 验证 BR/AC",
    };
  }
  return {
    codeState,
    implementation,
    status: "已支持",
    needsLLM: false,
    reason: "代码完整(无契约,按代码判定)",
  };
}
