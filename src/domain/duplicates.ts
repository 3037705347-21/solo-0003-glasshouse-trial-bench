import type {
  Accession,
  DuplicateCandidatePair,
  DuplicateSignal,
  PreferredLight,
  WorkspaceState,
} from "./types";
import { isAccessionMerged } from "./accession";

/**
 * 重复治理：只给出“判断依据”，不替人做决定。
 *
 * 每条候选对都附带匹配信号（matching=true）与区分信号
 * （strong distinction）。评分只是排序辅助：
 * 同一物理批次可能用了不同编号（弱信号），看起来相似的批次
 * 也可能因为光照或繁殖日期不同而必须分开保留。
 */

export const LIKELY_SCORE_THRESHOLD = 6;

const LIGHT_ORDER: Record<PreferredLight, number> = {
  "full-sun": 0,
  "partial-shade": 1,
  shade: 2,
};

const LIGHT_LABEL: Record<PreferredLight, string> = {
  "full-sun": "全日照",
  "partial-shade": "半阴",
  shade: "遮阴",
};

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** 经典 Levenshtein，用于容忍 "Micro Tom"/"MicroTom" 这类录入差异。 */
export function levenshtein(left: string, right: string): number {
  const a = normalizeToken(left);
  const b = normalizeToken(right);
  const grid = Array.from({ length: a.length + 1 }, (_, row) =>
    Array.from({ length: b.length + 1 }, (_, column) =>
      row === 0 ? column : column === 0 ? row : 0,
    ),
  );
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      grid[row][column] = Math.min(
        grid[row - 1][column] + 1,
        grid[row][column - 1] + 1,
        grid[row - 1][column - 1] + cost,
      );
    }
  }
  return grid[a.length][b.length];
}

function nameSimilarity(left: string, right: string): number {
  const a = normalizeToken(left);
  const b = normalizeToken(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  const distance = levenshtein(a, b);
  return Math.max(0, 1 - distance / Math.max(a.length, b.length));
}

function daysBetween(left: string, right: string): number | undefined {
  const a = new Date(`${left}T00:00:00`);
  const b = new Date(`${right}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
    return undefined;
  }
  return Math.abs(a.getTime() - b.getTime()) / 86400000;
}

function labelOverlap(left: Accession, right: Accession): number {
  const leftLabels = new Set(left.labels);
  const rightLabels = new Set(right.labels);
  const overlap = [...leftLabels].filter((label) => rightLabels.has(label));
  const unionSize = new Set([...leftLabels, ...rightLabels]).size;
  return unionSize === 0 ? 0 : overlap.length / unionSize;
}

export function pairKey(leftId: string, rightId: string): string {
  return [leftId, rightId].sort().join("::");
}

/**
 * 评估两个批次的相似依据。匹配信号累加分数，区分信号单独列出；
 * 强区分（光照互斥或繁殖日期相差超过两周）会把“疑似”降为“可能”。
 */
export function evaluateDuplicatePair(
  left: Accession,
  right: Accession,
): Omit<DuplicateCandidatePair, "key" | "leftId" | "rightId"> {
  const signals: DuplicateSignal[] = [];
  const strongDistinctions: DuplicateSignal[] = [];
  let score = 0;

  if (left.accessionNo === right.accessionNo) {
    signals.push({
      code: "SAME_ACCESSION_NO",
      label: "材料编号相同",
      detail: `两者都登记为 ${left.accessionNo}`,
      weight: 5,
      matching: true,
    });
    score += 5;
  }

  const nameScore = nameSimilarity(left.cultivar, right.cultivar);
  if (nameScore === 1) {
    signals.push({
      code: "SAME_CULTIVAR",
      label: "品种名完全一致",
      detail: `品种均为 ${left.cultivar}`,
      weight: 3,
      matching: true,
    });
    score += 3;
  } else if (nameScore >= 0.8) {
    signals.push({
      code: "CULTIVAR_NEAR_MATCH",
      label: "品种名高度近似",
      detail: `“${left.cultivar}”与“${right.cultivar}”可能只是录入差异`,
      weight: 2,
      matching: true,
    });
    score += 2;
  }

  if (normalizeToken(left.source) === normalizeToken(right.source) && left.source) {
    signals.push({
      code: "SAME_SOURCE",
      label: "来源相同",
      detail: `来源均为 ${left.source}`,
      weight: 2,
      matching: true,
    });
    score += 2;
  }

  if (left.preferredLight === right.preferredLight) {
    signals.push({
      code: "SAME_LIGHT",
      label: "适宜光照相同",
      detail: `均为${LIGHT_LABEL[left.preferredLight]}`,
      weight: 1,
      matching: true,
    });
    score += 1;
  } else {
    const gap = Math.abs(
      LIGHT_ORDER[left.preferredLight] - LIGHT_ORDER[right.preferredLight],
    );
    if (gap >= 2) {
      strongDistinctions.push({
        code: "LIGHT_INCOMPATIBLE",
        label: "光照需求互斥",
        detail: `${LIGHT_LABEL[left.preferredLight]} 与 ${LIGHT_LABEL[right.preferredLight]} 不能同批培养`,
        weight: 0,
        matching: false,
      });
    }
  }

  const dateGap = daysBetween(left.propagatedOn, right.propagatedOn);
  if (dateGap === 0) {
    signals.push({
      code: "SAME_PROPAGATION_DATE",
      label: "繁殖日期相同",
      detail: left.propagatedOn,
      weight: 2,
      matching: true,
    });
    score += 2;
  } else if (dateGap !== undefined && dateGap <= 3) {
    signals.push({
      code: "PROPAGATION_NEAR",
      label: "繁殖日期接近",
      detail: `${left.propagatedOn} 与 ${right.propagatedOn} 相差 ${dateGap} 天`,
      weight: 1,
      matching: true,
    });
    score += 1;
  } else if (dateGap !== undefined && dateGap > 14) {
    strongDistinctions.push({
      code: "PROPAGATION_FAR_APART",
      label: "繁殖日期相差过大",
      detail: `${left.propagatedOn} 与 ${right.propagatedOn} 相差 ${dateGap} 天，通常属于不同批次`,
      weight: 0,
      matching: false,
    });
  }

  if (left.trayCells === right.trayCells) {
    signals.push({
      code: "SAME_TRAY",
      label: "穴盘规格相同",
      detail: `${left.trayCells} 孔`,
      weight: 1,
      matching: true,
    });
    score += 1;
  }

  const labelScore = labelOverlap(left, right);
  if (labelScore >= 0.5) {
    signals.push({
      code: "LABEL_OVERLAP",
      label: "标签重叠",
      detail: `共同标签：${[...new Set(left.labels.filter((label) => right.labels.includes(label)))].join("、") || "—"}`,
      weight: 1,
      matching: true,
    });
    score += 1;
  }

  const verdict =
    score >= LIKELY_SCORE_THRESHOLD && strongDistinctions.length === 0
      ? "likely"
      : "possible";

  return { score, verdict, signals, strongDistinctions };
}

/** 生成同试验内所有候选对，已合并墓碑和已人工排除的对不再出现。 */
export function detectDuplicateCandidates(
  state: WorkspaceState,
  options: { includeDismissed?: boolean } = {},
): DuplicateCandidatePair[] {
  const dismissedPairKeys = new Set(
    state.duplicateReviews
      .filter(
        (review) =>
          options.includeDismissed ? false : review.decision === "dismissed",
      )
      .map((review) => review.pairKey),
  );
  const pairs: DuplicateCandidatePair[] = [];
  state.trials.forEach((trial) => {
    const members = state.accessions.filter(
      (accession) =>
        accession.trialId === trial.id && !isAccessionMerged(accession),
    );
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const left = members[i];
        const right = members[j];
        const key = pairKey(left.id, right.id);
        if (dismissedPairKeys.has(key)) {
          continue;
        }
        const evaluation = evaluateDuplicatePair(left, right);
        if (evaluation.signals.length === 0) {
          continue;
        }
        pairs.push({
          key,
          leftId: left.id,
          rightId: right.id,
          ...evaluation,
        });
      }
    }
  });
  return pairs.sort((a, b) => {
    if (a.verdict !== b.verdict) {
      return a.verdict === "likely" ? -1 : 1;
    }
    return b.score - a.score;
  });
}

/** 表单录入时的软提示：编号本身仍按硬错误处理。 */
export function findSoftDuplicates(
  state: WorkspaceState,
  draft: {
    trialId: string;
    accessionNo: string;
    cultivar: string;
    source: string;
    propagatedOn: string;
    preferredLight: PreferredLight;
  },
  currentId?: string,
): DuplicateCandidatePair[] {
  return state.accessions
    .filter(
      (accession) =>
        accession.id !== currentId &&
        accession.trialId === draft.trialId &&
        !isAccessionMerged(accession),
    )
    .map((accession) => {
      const probe: Accession = {
        ...accession,
        accessionNo: draft.accessionNo.trim(),
        cultivar: draft.cultivar,
        source: draft.source,
        propagatedOn: draft.propagatedOn,
        preferredLight: draft.preferredLight,
      };
      return {
        key: pairKey("probe", accession.id),
        leftId: "probe",
        rightId: accession.id,
        ...evaluateDuplicatePair(probe, accession),
      };
    })
    .filter((pair) => pair.score >= 3)
    .sort((a, b) => b.score - a.score);
}
