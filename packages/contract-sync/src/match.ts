/**
 * 契约 → matrix cell 的三态启发式匹配。
 *
 * 匹配到 feature 粒度(首版),scenario 取该 feature 下非废弃首个 scenario;
 * 人工映射可精确指定 feature + scenario。
 *
 * 打分信号:
 *   - 人工映射      → conf 1.0,直接 matched
 *   - 正文 cell 引用 → +0.7(强;契约自声明「覆盖 D-01」,多引用并列则落 pending)
 *   - 领域一致      → +0.3
 *   - handler 命中  → +0.4
 *   - action 命中   → +0.2
 *   - 短名子串      → +0.15(弱)
 *
 * 判定:
 *   - ≥0.7 且领先次名≥0.2 → matched(自动同步)
 *   - 0.4–0.7 或多候选接近 → pending(待人工确认)
 *   - <0.4 或无候选       → unmatched(跳过)
 */

import type {
  CellCandidate,
  HelmcodeContractMeta,
  ManualMapping,
  MatchInputs,
  MatchResult,
  MatrixFeature,
} from "./types";

const MATCHED_THRESHOLD = 0.7;
const PENDING_THRESHOLD = 0.4;
const LEAD_GAP = 0.2;

function norm(s: string): string {
  return s.toLowerCase().replace(/[-_]/g, "");
}

/** 取 feature 下第一个非废弃 scenario;无则取第一个(兜底) */
function pickScenario(feature: MatrixFeature): { name: string } | null {
  const nonAbandoned = feature.scenarios.find((s) => s.status !== "废弃");
  if (nonAbandoned) return { name: nonAbandoned.name };
  return feature.scenarios[0] ? { name: feature.scenarios[0].name } : null;
}

function scoreOne(meta: HelmcodeContractMeta, feature: MatrixFeature): CellCandidate {
  let score = 0;
  const reasons: string[] = [];

  // 正文 cell 引用(强信号):契约正文「覆盖 D-01 创建」这类自声明。老契约元信息无 matrixCellId
  // 时的关键依据。rawCellRefs 含 AC-00/DR-XX 等噪声,但 includes(feature.id) 只匹配真实 matrix feature。
  if (meta.rawCellRefs.includes(feature.id)) {
    score += 0.7;
    reasons.push(`正文引用:${feature.id}`);
  }

  // 领域一致
  if (meta.domain && feature.domain && norm(meta.domain) === norm(feature.domain)) {
    score += 0.3;
    reasons.push(`领域一致:${meta.domain}`);
  }

  // handler 命中(最强信号)
  if (feature.handler && meta.featureShortName) {
    const handlerBase = norm(feature.handler.replace(/Handler$/, ""));
    const shortNorm = norm(meta.featureShortName);
    if (handlerBase && (handlerBase.includes(shortNorm) || shortNorm.includes(handlerBase))) {
      score += 0.4;
      reasons.push(`handler 命中:${feature.handler}`);
    }
  }

  // action 命中
  if (feature.actions.length > 0 && meta.featureShortName) {
    const shortNorm = norm(meta.featureShortName);
    const hitAction = feature.actions.find((a) => {
      const aNorm = norm(a.replace(/Action$/, ""));
      return aNorm && (aNorm.includes(shortNorm) || shortNorm.includes(aNorm));
    });
    if (hitAction) {
      score += 0.2;
      reasons.push(`action 命中:${hitAction}`);
    }
  }

  // 短名子串(弱信号)
  if (meta.featureShortName && feature.name) {
    const shortNorm = norm(meta.featureShortName);
    const nameNorm = norm(feature.name);
    if (shortNorm && nameNorm && (nameNorm.includes(shortNorm) || shortNorm.length >= 2 && feature.name.includes(meta.featureShortName))) {
      score += 0.15;
      reasons.push(`名称关联:${feature.name}`);
    }
  }

  const scenario = pickScenario(feature);
  return {
    featureId: feature.id,
    scenarioName: scenario?.name ?? "",
    cellId: scenario ? `${feature.id}__${scenario.name}` : "",
    score,
    reasons,
  };
}

function classify(
  contractFeatureId: string,
  meta: HelmcodeContractMeta,
  candidates: CellCandidate[],
  confidence: number,
): MatchResult {
  const sorted = candidates.filter((c) => c.cellId !== "").sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const second = sorted[1];

  if (!best || confidence < PENDING_THRESHOLD) {
    return {
      contractFeatureId,
      meta,
      state: "unmatched",
      chosen: null,
      candidates: sorted.slice(0, 5),
      confidence,
    };
  }

  const leadOk = !second || best.score - second.score >= LEAD_GAP;

  if (confidence >= MATCHED_THRESHOLD && leadOk) {
    return {
      contractFeatureId,
      meta,
      state: "matched",
      chosen: best,
      candidates: sorted.slice(0, 5),
      confidence,
    };
  }

  // pending: 有候选但置信度不足或多候选接近
  return {
    contractFeatureId,
    meta,
    state: "pending",
    chosen: best,
    candidates: sorted.slice(0, 5),
    confidence,
  };
}

/** 按 matrixCellId("D-01__正式签约")精确查找 feature+scenario */
function findCellByMatrixCellId(
  features: MatrixFeature[],
  matrixCellId: string,
): { featureId: string; scenarioName: string } | null {
  for (const f of features) {
    for (const s of f.scenarios) {
      if (`${f.id}__${s.name}` === matrixCellId) {
        return { featureId: f.id, scenarioName: s.name };
      }
    }
  }
  return null;
}

export function matchContractsToMatrix(inputs: MatchInputs): MatchResult[] {
  const { metas, features, manualMap } = inputs;
  const results: MatchResult[] = [];

  for (const meta of metas) {
    // 人工映射优先 — 确定解
    const manual = manualMap[meta.featureId];
    if (manual) {
      const feature = features.find((f) => f.id === manual.featureId);
      const scenarioName = manual.scenarioName;
      results.push({
        contractFeatureId: meta.featureId,
        meta,
        state: "matched",
        chosen: {
          featureId: manual.featureId,
          scenarioName,
          cellId: `${manual.featureId}__${scenarioName}`,
          score: 1.0,
          reasons: ["manual"],
        },
        candidates: [],
        confidence: 1.0,
      });
      continue;
    }

    // matrixCellId 精确命中 — HelmFlow 自产契约自带坐标,直接定位 cell(置信度 1.0)
    if (meta.matrixCellId) {
      const hit = findCellByMatrixCellId(features, meta.matrixCellId);
      if (hit) {
        results.push({
          contractFeatureId: meta.featureId,
          meta,
          state: "matched",
          chosen: {
            featureId: hit.featureId,
            scenarioName: hit.scenarioName,
            cellId: meta.matrixCellId,
            score: 1.0,
            reasons: ["matrixCellId"],
          },
          candidates: [],
          confidence: 1.0,
        });
        continue;
      }
    }

    const candidates = features.map((f) => scoreOne(meta, f));
    const confidence = candidates.reduce((max, c) => Math.max(max, c.score), 0);
    results.push(classify(meta.featureId, meta, candidates, confidence));
  }

  return results;
}

// 注:匹配结果是否自动采纳的判定(state==="matched" && chosen)直接内联在 sync.ts 的 planSync,
// 无需独立导出 isAutoMatch 辅助函数。

