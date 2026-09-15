import { createId } from "./id";
import type {
  DedupAudit,
  DuplicateReview,
  ObservationEntry,
  ObservationPass,
  ReviewEntryDifference,
  ReviewSuggestion,
  WorkspaceState,
} from "./types";
import type { ObservationDraft } from "./observation";
import { ok, type Result } from "./result";

/**
 * 测量"同一次真实观测"允许的重测容差。
 * 数值落在容差内视为同一物理观测的两次读数，进入人工裁决（建议收敛）；
 * 超出容差说明植物状态发生真实变化，是合理重测，建议两条都保留。
 */
export const RETAKE_TOLERANCE = {
  heightMm: 5,
  leafCount: 1,
  ecMs: 0.3,
};

/** 不同录入窗口（毫秒）。超过该间隔即使内容相同也不自动收敛，必须人工确认。 */
export const AUTO_CONVERGE_WINDOW_MS = 60 * 1000;

const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz";

function randomToken(length: number): string {
  return Array.from({ length }, () =>
    TOKEN_ALPHABET.charAt(Math.floor(Math.random() * TOKEN_ALPHABET.length)),
  ).join("");
}

/**
 * 幂等令牌：表单（一次录入意图）打开时生成一次，提交失败重试时复用。
 * 同令牌的第二次送达永远是无副作用 no-op，从源头收敛"重复提交/网络重试"。
 */
export function mintIdempotencyToken(): string {
  return `idem_${Date.now().toString(36)}_${randomToken(14)}`;
}

/** FNV-1a 32 位哈希；离线环境足够稳定，且不依赖 crypto 子协议。 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 内容指纹：规范化后对"试验 + 业务日期 + 观测人 + 每条测量值"哈希。
 * 刻意不包含 recordedAt（录入时刻）与 notes（自由文本）：
 * 前者必然随重试变化，后者的措辞差异不应影响"同一份测量"的判定。
 */
export function fingerprintObservationDraft(draft: ObservationDraft): string {
  const lines = [
    `trial:${draft.trialId}`,
    `on:${draft.observedOn}`,
    `by:${draft.observer.trim()}`,
    ...[...draft.entries]
      .sort((left, right) => left.accessionId.localeCompare(right.accessionId))
      .map(
        (entry) =>
          `${entry.accessionId}=${entry.heightMm}/${entry.leafCount}/${entry.ecMs}`,
      ),
  ];
  return `fp_${fnv1a(lines.join("\n"))}`;
}

function passFingerprintInput(pass: ObservationPass): string {
  return [
    `trial:${pass.trialId}`,
    `on:${pass.observedOn}`,
    `by:${pass.observer}`,
    ...[...pass.entries]
      .sort((left, right) => left.accessionId.localeCompare(right.accessionId))
      .map(
        (entry) =>
          `${entry.accessionId}=${entry.heightMm}/${entry.leafCount}/${entry.ecMs}`,
      ),
  ].join("\n");
}

/** 供持久化归一化使用：为升级前的历史观测补算指纹（其录入时刻未知，用观测日期近似）。 */
export function fingerprintObservationPass(pass: ObservationPass): string {
  return `fp_${fnv1a(passFingerprintInput(pass))}`;
}

function entryMap(pass: ObservationPass): Map<string, ObservationEntry> {
  return new Map(pass.entries.map((entry) => [entry.accessionId, entry]));
}

export function liveEntriesOf(pass: ObservationPass): ObservationEntry[] {
  return pass.entries.filter(
    (entry) => !pass.convergedAccessionIds.includes(entry.accessionId),
  );
}

/** 条目仍有效的观测（canonical 或仅部分收敛）。 */
export function isPassLive(pass: ObservationPass): boolean {
  return pass.dedupStatus !== "converged";
}

function entryDifference(
  candidate: ObservationEntry,
  existing: ObservationEntry,
): ReviewEntryDifference {
  const heightDeltaMm = Math.abs(candidate.heightMm - existing.heightMm);
  const leafDelta = Math.abs(candidate.leafCount - existing.leafCount);
  const ecDelta = Math.abs(candidate.ecMs - existing.ecMs);
  const withinTolerance =
    heightDeltaMm <= RETAKE_TOLERANCE.heightMm &&
    leafDelta <= RETAKE_TOLERANCE.leafCount &&
    ecDelta <= RETAKE_TOLERANCE.ecMs;
  return {
    accessionId: candidate.accessionId,
    heightDeltaMm,
    leafDelta,
    ecDelta: Math.round(ecDelta * 100) / 100,
    withinTolerance,
  };
}

function suggestionFor(differences: ReviewEntryDifference[]): ReviewSuggestion {
  if (differences.length === 0) {
    return "review";
  }
  const within = differences.filter((item) => item.withinTolerance).length;
  if (within === differences.length) {
    return "converge"; // 全部共同材料都在重测容差内 → 建议视为重复
  }
  if (within === 0) {
    return "keep_both"; // 全部超出容差 → 建议两次真实观测都保留
  }
  return "review"; // 混合情况交人工
}

export interface RecordedObservation {
  outcome: "recorded" | "duplicate_retry" | "auto_converged" | "review_opened";
  pass: ObservationPass;
  review?: DuplicateReview;
  audit?: DedupAudit;
  /** duplicate_retry 时返回先前已保存的同一次提交。 */
  existingPass?: ObservationPass;
}

/**
 * 观测入库的去重决策（纯函数，不触碰状态）。
 *
 * 比较顺序即重试语义：
 * 1. 幂等令牌命中 → 同一次提交的重复送达，no-op 返回原记录，不产生标记/审计。
 * 2. 内容指纹相同且在自动收敛窗口内 → 字节级重复录入，收敛到先存记录并写审计。
 * 3. 同日同观测人、存在共同材料但数值不同 → 疑似重复，开人工裁决工单；
 *    新观测以 canonical 身份先入库（不阻断记录工作），裁决前两条都参与业务。
 * 4. 其余（不同观测人同日、或无材料重叠）→ 独立观测直接保留。
 */
export function decideObservationRecording(
  draft: ObservationDraft,
  state: WorkspaceState,
  now: () => string = () => new Date().toISOString(),
): Result<RecordedObservation> {
  const recordedAt = now();
  const idempotencyToken = draft.idempotencyToken;
  const contentFingerprint = fingerprintObservationDraft(draft);

  const pass: ObservationPass = {
    id: draft.passId ?? createId("obs"),
    trialId: draft.trialId,
    observedOn: draft.observedOn,
    observer: draft.observer,
    entries: draft.entries.map((entry) => ({ ...entry })),
    idempotencyToken,
    contentFingerprint,
    recordedAt,
    dedupStatus: "canonical",
    convergedAccessionIds: [],
  };

  // 1) 幂等重试：同一录入意图的第二次送达。
  const sameToken = state.observationPasses.find(
    (item) => item.idempotencyToken === idempotencyToken,
  );
  if (sameToken) {
    return ok({ outcome: "duplicate_retry", pass: sameToken, existingPass: sameToken });
  }

  // 2) 字节级内容重复（不同令牌意味着可能是重新打开表单后再次提交了相同数据）。
  const sameFingerprint = state.observationPasses.find(
    (item) =>
      item.contentFingerprint === contentFingerprint ||
      fingerprintObservationPass(item) === contentFingerprint,
  );
  if (
    sameFingerprint &&
    sameFingerprint.observedOn === draft.observedOn &&
    withinWindow(sameFingerprint.recordedAt, recordedAt, AUTO_CONVERGE_WINDOW_MS)
  ) {
    const convergedPass: ObservationPass = {
      ...pass,
      dedupStatus: "converged",
      canonicalPassId: sameFingerprint.id,
      convergedAccessionIds: pass.entries.map((entry) => entry.accessionId),
    };
    const audit: DedupAudit = {
      id: createId("aud"),
      trialId: draft.trialId,
      at: recordedAt,
      kind: "auto_converged",
      candidatePassId: convergedPass.id,
      canonicalPassId: sameFingerprint.id,
      convergedAccessionIds: convergedPass.convergedAccessionIds,
      reason: "内容指纹完全一致且在自动收敛窗口内，判定为重复录入",
      matchedBy: "fingerprint",
    };
    return ok({ outcome: "auto_converged", pass: convergedPass, audit });
  }

  // 3) 疑似重复：同一天、同一观测人、覆盖了相同材料，但读数不完全一致。
  const sameDayCandidates = state.observationPasses
    .filter(isPassLive)
    .filter(
      (item) =>
        item.trialId === draft.trialId &&
        item.observedOn === draft.observedOn &&
        item.observer.trim() === draft.observer.trim() &&
        item.id !== pass.id,
    );

  let review: DuplicateReview | undefined;
  for (const existing of sameDayCandidates) {
    const existingEntries = entryMap(existing);
    const shared = pass.entries.filter((entry) =>
      existingEntries.has(entry.accessionId),
    );
    if (shared.length === 0) {
      continue;
    }
    // 只比较双方都仍有效的条目（existing 可能已部分收敛）。
    const liveShared = shared.filter(
      (entry) => !existing.convergedAccessionIds.includes(entry.accessionId),
    );
    if (liveShared.length === 0) {
      continue;
    }
    const differences = liveShared.map((entry) =>
      // shared 非空保证 existingEntries.get 存在；liveShared 是其子集
      entryDifference(entry, existingEntries.get(entry.accessionId)!),
    );
    review = {
      id: createId("rev"),
      trialId: draft.trialId,
      status: "pending",
      candidatePassId: pass.id,
      existingPassId: existing.id,
      sharedAccessionIds: liveShared.map((entry) => entry.accessionId),
      differences,
      suggestion: suggestionFor(differences),
      createdAt: recordedAt,
    };
    break; // 一次新录入只与最近一个候选建立工单，避免工单爆炸
  }

  if (review) {
    return ok({ outcome: "review_opened", pass, review });
  }

  // 4) 独立观测（含不同观测人同日各自测量的合理场景）。
  return ok({ outcome: "recorded", pass });
}

function withinWindow(
  earlierIso: string,
  laterIso: string,
  windowMs: number,
): boolean {
  const earlier = Date.parse(earlierIso);
  const later = Date.parse(laterIso);
  if (Number.isNaN(earlier) || Number.isNaN(later)) {
    // 历史数据缺少可靠入库时刻时，保守地允许自动收敛（内容已字节级一致）。
    return true;
  }
  return later - earlier <= windowMs;
}

export interface AdjudicationInput {
  reviewId: string;
  verdict: "keep_both" | "converge";
  decidedBy: string;
  decisionNote: string;
  /** converge 时保留哪一次测量作为权威；缺省保留先前存在的一次。 */
  survivorPassId?: string;
}

export interface AdjudicationResult {
  review: DuplicateReview;
  audit: DedupAudit;
  /** 需要落库的观测更新（收敛状态与 canonical 指针）。 */
  updatedPasses: ObservationPass[];
  /** 因收敛而需要撤回的 open 标记（观测 + 材料粒度，支持部分收敛）。 */
  withdrawnFlagKeys: Array<{ passId: string; accessionId: string }>;
}

/** 应用人工裁决。任何决定都留痕：review 转 resolved，并写一条 manual 审计。 */
export function adjudicateDuplicateReview(
  input: AdjudicationInput,
  state: WorkspaceState,
  now: () => string = () => new Date().toISOString(),
): Result<AdjudicationResult> {
  const review = state.duplicateReviews.find((item) => item.id === input.reviewId);
  if (!review) {
    return {
      ok: false,
      errors: [{ field: "reviewId", code: "unknown", message: "裁决工单不存在" }],
    };
  }
  if (review.status !== "pending") {
    return {
      ok: false,
      errors: [
        {
          field: "status",
          code: "already_resolved",
          message: "该疑似重复已经裁决过",
        },
      ],
    };
  }
  const candidate = state.observationPasses.find(
    (item) => item.id === review.candidatePassId,
  );
  const existing = state.observationPasses.find(
    (item) => item.id === review.existingPassId,
  );
  if (!candidate || !existing) {
    return {
      ok: false,
      errors: [
        { field: "reviewId", code: "orphan", message: "工单关联的观测已不存在" },
      ],
    };
  }
  if (input.decidedBy.trim().length < 3) {
    return {
      ok: false,
      errors: [
        { field: "decidedBy", code: "required", message: "请填写裁决人" },
      ],
    };
  }
  if (input.decisionNote.trim().length < 8) {
    return {
      ok: false,
      errors: [
        {
          field: "decisionNote",
          code: "too_short",
          message: "请填写至少 8 个字符的裁决说明，解释收敛或保留的理由",
        },
      ],
    };
  }

  const decidedAt = now();
  const resolvedReview: DuplicateReview = {
    ...review,
    status: "resolved",
    decidedAt,
    decidedBy: input.decidedBy.trim(),
    verdict: input.verdict,
    survivorPassId:
      input.verdict === "converge"
        ? input.survivorPassId ?? existing.id
        : undefined,
    decisionNote: input.decisionNote.trim(),
  };

  const updatedPasses: ObservationPass[] = [];
  let withdrawnFlagKeys: Array<{ passId: string; accessionId: string }> = [];
  let audit: DedupAudit;

  if (input.verdict === "keep_both") {
    // 合理重测：双方都确认为权威记录，工单与审计解释"为什么不收敛"。
    updatedPasses.push(
      { ...candidate, dedupStatus: "canonical", canonicalPassId: undefined },
      { ...existing, dedupStatus: "canonical", canonicalPassId: undefined },
    );
    audit = {
      id: createId("aud"),
      trialId: review.trialId,
      at: decidedAt,
      kind: "manual",
      candidatePassId: candidate.id,
      canonicalPassId: existing.id,
      convergedAccessionIds: [],
      reason: "人工裁决保留两次观测（合理重测）",
      matchedBy: "manual_review",
      reviewId: review.id,
      decidedBy: input.decidedBy.trim(),
      decisionNote: input.decisionNote.trim(),
      verdict: "keep_both",
    };
  } else {
    const survivorId = input.survivorPassId ?? existing.id;
    if (survivorId !== existing.id && survivorId !== candidate.id) {
      return {
        ok: false,
        errors: [
          {
            field: "survivorPassId",
            code: "invalid",
            message: "权威观测必须是工单关联的两次观测之一",
          },
        ],
      };
    }
    const loser = survivorId === existing.id ? candidate : existing;
    const survivor = survivorId === existing.id ? existing : candidate;
    const convergedAccessionIds = review.sharedAccessionIds;
    const updatedLoser: ObservationPass = {
      ...loser,
      canonicalPassId: survivor.id,
      convergedAccessionIds: Array.from(
        new Set([...loser.convergedAccessionIds, ...convergedAccessionIds]),
      ),
      dedupStatus:
        loser.entries.every((entry) =>
          new Set([
            ...loser.convergedAccessionIds,
            ...convergedAccessionIds,
          ]).has(entry.accessionId),
        )
          ? "converged"
          : "partially_converged",
    };
    const updatedSurvivor: ObservationPass = {
      ...survivor,
      dedupStatus: "canonical",
    };
    updatedPasses.push(updatedLoser, updatedSurvivor);
    // 按 (观测, 材料) 粒度撤回：整次收敛时撤回全部，部分收敛时只撤回共同材料。
    withdrawnFlagKeys = convergedAccessionIds.map((accessionId) => ({
      passId: updatedLoser.id,
      accessionId,
    }));
    audit = {
      id: createId("aud"),
      trialId: review.trialId,
      at: decidedAt,
      kind: "manual",
      candidatePassId: loser.id,
      canonicalPassId: survivor.id,
      convergedAccessionIds,
      reason: `人工裁决收敛到${survivor.id === candidate.id ? "后一次" : "先一次"}观测`,
      matchedBy: "manual_review",
      reviewId: review.id,
      decidedBy: input.decidedBy.trim(),
      decisionNote: input.decisionNote.trim(),
      verdict: "converge",
    };
  }

  return ok({ review: resolvedReview, audit, updatedPasses, withdrawnFlagKeys });
}

/** 工单双方是否仍都存在且处于 pending（UI 用于隐藏失效工单）。 */
export function isReviewActionable(
  review: DuplicateReview,
  state: WorkspaceState,
): boolean {
  if (review.status !== "pending") {
    return false;
  }
  return ["candidate", "existing"].every((role) => {
    const id = role === "candidate" ? review.candidatePassId : review.existingPassId;
    const pass = state.observationPasses.find((item) => item.id === id);
    return Boolean(pass && isPassLive(pass));
  });
}
