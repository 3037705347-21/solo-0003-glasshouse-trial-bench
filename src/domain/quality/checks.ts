import { isBenchCompatible, parseDateOnly } from "../rules";
import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  Flag,
  ObservationPass,
  Trial,
  WorkspaceState,
} from "../types";
import { buildFix, buildFinding, evidence, MANUAL_ROUTES, objectRef } from "./catalog";
import { parseCollections } from "./structure";
import type { QualityFinding, QualityReport } from "./types";

interface WorkspaceIndex {
  trialIds: Set<string>;
  accessionIds: Set<string>;
  benchIds: Set<string>;
  passIds: Set<string>;
  flagIds: Set<string>;
  snapshotIds: Set<string>;
  accessionById: Map<string, Accession>;
  trialById: Map<string, Trial>;
  benchById: Map<string, Bench>;
  valid: {
    trials: Trial[];
    accessions: Accession[];
    benches: Bench[];
    passes: ObservationPass[];
    flags: Flag[];
    snapshots: ClearanceSnapshot[];
  };
}

function buildIndex(state: WorkspaceState | Partial<WorkspaceState> | null | undefined): {
  index: WorkspaceIndex;
  structuralFindings: QualityFinding[];
} {
  const parsed = parseCollections(state);
  const index: WorkspaceIndex = {
    trialIds: new Set(parsed.trials.map((item) => item.id)),
    accessionIds: new Set(parsed.accessions.map((item) => item.id)),
    benchIds: new Set(parsed.benches.map((item) => item.id)),
    passIds: new Set(parsed.passes.map((item) => item.id)),
    flagIds: new Set(parsed.flags.map((item) => item.id)),
    snapshotIds: new Set(parsed.snapshots.map((item) => item.id)),
    accessionById: new Map(parsed.accessions.map((item) => [item.id, item])),
    trialById: new Map(parsed.trials.map((item) => [item.id, item])),
    benchById: new Map(parsed.benches.map((item) => [item.id, item])),
    valid: {
      trials: parsed.trials,
      accessions: parsed.accessions,
      benches: parsed.benches,
      passes: parsed.passes,
      flags: parsed.flags,
      snapshots: parsed.snapshots,
    },
  };
  return { index, structuralFindings: parsed.findings };
}

/* ------------------------------------------------------------------ */
/* 试验领域                                                             */
/* ------------------------------------------------------------------ */

function checkTrials(index: WorkspaceIndex): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const seenIds = new Set<string>();
  index.valid.trials.forEach((trial) => {
    if (seenIds.has(trial.id)) {
      findings.push(
        buildFinding({
          ruleCode: "T-DUP-ID-01",
          domain: "trials",
          severity: "blocking",
          title: "试验 id 重复",
          detail: `两条试验记录共用 id ${trial.id}，跨对象引用无法区分目标。`,
          objectRefs: [objectRef("trial", trial.id, trial.code)],
          evidence: [evidence("试验编号", trial.code)],
          manual: MANUAL_ROUTES.trials,
        }),
      );
    }
    seenIds.add(trial.id);

    if (trial.state === "cleared") {
      const trialFlags = index.valid.flags.filter(
        (flag) => flag.trialId === trial.id,
      );
      if (trialFlags.some((flag) => flag.state === "open")) {
        findings.push(
          buildFinding({
            ruleCode: "T-CLEARED-FLAGS-01",
            domain: "trials",
            severity: "warning",
            title: "已放行试验仍有未处理标记",
            detail: `${trial.code} 已处于已放行状态，但仍存在未处理的生长标记，放行结论与当前状态矛盾。`,
            objectRefs: [
              objectRef("trial", trial.id, trial.code),
              ...trialFlags
                .filter((flag) => flag.state === "open")
                .map((flag) => objectRef("flag", flag.id, flag.code)),
            ],
            evidence: [
              evidence("未处理标记数", trialFlags.filter((flag) => flag.state === "open").length),
            ],
            manual: MANUAL_ROUTES.trials,
          }),
        );
      }
    }

    if (parseDateOnly(trial.startDate) && parseDateOnly(trial.endDate)) {
      const start = new Date(`${trial.startDate}T00:00:00`).getTime();
      const end = new Date(`${trial.endDate}T00:00:00`).getTime();
      if (start > end) {
        findings.push(
          buildFinding({
            ruleCode: "T-DATE-ORDER-01",
            domain: "trials",
            severity: "warning",
            title: "试验日期顺序颠倒",
            detail: `${trial.code} 的开始日期晚于结束日期。`,
            objectRefs: [objectRef("trial", trial.id, trial.code)],
            evidence: [evidence("开始日期", trial.startDate), evidence("结束日期", trial.endDate)],
            manual: MANUAL_ROUTES.trials,
          }),
        );
      }
    }
  });

  const codeCounts = new Map<string, Trial[]>();
  index.valid.trials.forEach((trial) => {
    const list = codeCounts.get(trial.code) ?? [];
    list.push(trial);
    codeCounts.set(trial.code, list);
  });
  codeCounts.forEach((list, code) => {
    if (list.length > 1) {
      findings.push(
        buildFinding({
          ruleCode: "T-DUP-CODE-01",
          domain: "trials",
          severity: "warning",
          title: "试验编号重复",
          detail: `试验编号 ${code} 出现 ${list.length} 次。`,
          objectRefs: list.map((trial) => objectRef("trial", trial.id, trial.code)),
          evidence: [evidence("出现次数", list.length)],
          manual: MANUAL_ROUTES.trials,
        }),
      );
    }
  });
  return findings;
}

/* ------------------------------------------------------------------ */
/* 材料领域                                                             */
/* ------------------------------------------------------------------ */

function checkAccessions(index: WorkspaceIndex): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const seenIds = new Set<string>();
  const accessionNoOwners = new Map<string, Accession[]>();

  index.valid.accessions.forEach((accession) => {
    if (seenIds.has(accession.id)) {
      findings.push(
        buildFinding({
          ruleCode: "A-DUP-ID-01",
          domain: "accessions",
          severity: "blocking",
          title: "材料 id 重复",
          detail: `材料 id ${accession.id} 出现多次，台架与观测引用会指向错误对象。`,
          objectRefs: [objectRef("accession", accession.id, accession.accessionNo)],
          evidence: [evidence("材料编号", accession.accessionNo)],
          manual: MANUAL_ROUTES.accessions,
        }),
      );
    }
    seenIds.add(accession.id);

    const owners = accessionNoOwners.get(accession.accessionNo) ?? [];
    owners.push(accession);
    accessionNoOwners.set(accession.accessionNo, owners);

    if (!index.trialIds.has(accession.trialId)) {
      findings.push(
        buildFinding({
          ruleCode: "A-TRIAL-MISSING-01",
          domain: "accessions",
          severity: "blocking",
          title: "材料引用了已消失的试验",
          detail: `${accession.accessionNo} 归属的试验 ${accession.trialId} 不存在，恢复试验或重新指派归属都需要人工判断。`,
          objectRefs: [objectRef("accession", accession.id, accession.accessionNo)],
          evidence: [
            evidence("材料编号", accession.accessionNo),
            evidence("缺失的试验 id", accession.trialId),
          ],
          manual: MANUAL_ROUTES.accessions,
        }),
      );
    }
  });

  accessionNoOwners.forEach((owners, accessionNo) => {
    if (owners.length > 1) {
      findings.push(
        buildFinding({
          ruleCode: "A-DUP-NO-01",
          domain: "accessions",
          severity: "blocking",
          title: "材料编号重复",
          detail: `材料编号 ${accessionNo} 被 ${owners.length} 条记录使用，无法判断哪一条是真实批次。`,
          objectRefs: owners.map((item) => objectRef("accession", item.id, accessionNo)),
          evidence: [evidence("出现次数", owners.length)],
          manual: MANUAL_ROUTES.accessions,
        }),
      );
    }
  });
  return findings;
}

/* ------------------------------------------------------------------ */
/* 台架领域                                                             */
/* ------------------------------------------------------------------ */

function canonicalBench(benches: Bench[], accession: Accession): Bench {
  return [...benches]
    .filter(
      (bench) =>
        bench.assignedIds.includes(accession.id) &&
        bench.status !== "blocked" &&
        bench.status !== "quarantine",
    )
    .sort((left, right) => {
      const leftOk = isBenchCompatible(accession, left) ? 0 : 1;
      const rightOk = isBenchCompatible(accession, right) ? 0 : 1;
      if (leftOk !== rightOk) {
        return leftOk - rightOk;
      }
      return left.code.localeCompare(right.code);
    })[0];
}

function checkBenches(index: WorkspaceIndex): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const seenIds = new Set<string>();

  // accessionId -> 持有它的台架列表（同一台架内重复出现先折叠统计）。
  const benchOwners = new Map<string, Bench[]>();

  index.valid.benches.forEach((bench) => {
    if (seenIds.has(bench.id)) {
      findings.push(
        buildFinding({
          ruleCode: "B-DUP-ID-01",
          domain: "benches",
          severity: "blocking",
          title: "台架 id 重复",
          detail: `台架 id ${bench.id} 出现多次，分配写入会互相覆盖。`,
          objectRefs: [objectRef("bench", bench.id, bench.code)],
          evidence: [evidence("台架编号", bench.code)],
          manual: MANUAL_ROUTES.benches,
        }),
      );
    }
    seenIds.add(bench.id);

    // 台架内重复 id
    const duplicateIds = bench.assignedIds.filter(
      (id, position) => bench.assignedIds.indexOf(id) !== position,
    );
    const uniqueDuplicates = Array.from(new Set(duplicateIds));
    uniqueDuplicates.forEach((accessionId) => {
      const accession = index.accessionById.get(accessionId);
      findings.push(
        buildFinding({
          ruleCode: "B-ASSIGN-DUP-01",
          domain: "benches",
          severity: "warning",
          title: "台架内重复登记同一材料",
          detail: `台架 ${bench.code} 的分配列表重复包含 ${
            accession ? accession.accessionNo : accessionId
          }，利用率被重复计数。`,
          objectRefs: [
            objectRef("bench", bench.id, bench.code),
            objectRef("accession", accessionId, accession?.accessionNo ?? accessionId),
          ],
          evidence: [
            evidence("出现次数", bench.assignedIds.filter((id) => id === accessionId).length),
          ],
          fix: buildFix(
            "bench.dedupe",
            `在台架 ${bench.code} 的分配列表中去重`,
            "只折叠同一台架分配列表中的重复 id，不移动任何材料，不删除任何记录。",
            { benchId: bench.id, accessionId },
          ),
          manual: MANUAL_ROUTES.benches,
        }),
      );
    });

    const uniqueAssigned = Array.from(new Set(bench.assignedIds));
    uniqueAssigned.forEach((accessionId) => {
      const owners = benchOwners.get(accessionId) ?? [];
      owners.push(bench);
      benchOwners.set(accessionId, owners);
    });

    // 悬空引用
    uniqueAssigned.forEach((accessionId) => {
      if (!index.accessionIds.has(accessionId)) {
        findings.push(
          buildFinding({
            ruleCode: "B-ASSIGN-MISSING-01",
            domain: "benches",
            severity: "blocking",
            title: "台架引用了已消失的材料",
            detail: `台架 ${bench.code} 的分配列表包含不存在的材料 ${accessionId}，容量与利用率统计失真。`,
            objectRefs: [
              objectRef("bench", bench.id, bench.code),
              objectRef("accession", accessionId, accessionId),
            ],
            evidence: [
              evidence("台架", bench.code),
              evidence("缺失的材料 id", accessionId),
            ],
            idKey: accessionId,
            fix: buildFix(
              "bench.unassign",
              `从台架 ${bench.code} 移除悬空材料引用 ${accessionId}`,
              "只移除指向已消失材料的引用 id，不删除台架或任何现存记录；被移除的 id 会保留在修复审计中。",
              { benchId: bench.id, accessionId, reason: "missing-accession" },
            ),
            manual: MANUAL_ROUTES.benches,
          }),
        );
      }
    });

    // 容量矛盾
    if (uniqueAssigned.length > bench.capacity) {
      findings.push(
        buildFinding({
          ruleCode: "B-CAPACITY-01",
          domain: "benches",
          severity: "blocking",
          title: "台架占用超过容量",
          detail: `台架 ${bench.code} 占用 ${uniqueAssigned.length} 个材料，但容量只有 ${bench.capacity}。该移出哪些材料无法自动判断。`,
          objectRefs: [objectRef("bench", bench.id, bench.code)],
          evidence: [
            evidence("占用（去重后）", uniqueAssigned.length),
            evidence("容量", bench.capacity),
          ],
          manual: MANUAL_ROUTES.benches,
        }),
      );
    }

    const restricted = bench.status === "blocked" || bench.status === "quarantine";
    if (restricted && uniqueAssigned.length > 0) {
      findings.push(
        buildFinding({
          ruleCode: "B-RESTRICTED-OCCUPIED-01",
          domain: "benches",
          severity: "blocking",
          title: bench.status === "blocked" ? "停用台架仍占用材料" : "隔离台架仍占用材料",
          detail: `台架 ${bench.code} 当前为${bench.status === "blocked" ? "停用" : "隔离"}状态，却仍有 ${uniqueAssigned.length} 个材料占用。`,
          objectRefs: [
            objectRef("bench", bench.id, bench.code),
            ...uniqueAssigned.map((id) =>
              objectRef("accession", id, index.accessionById.get(id)?.accessionNo ?? id),
            ),
          ],
          evidence: [
            evidence("台架状态", bench.status),
            evidence("占用材料数", uniqueAssigned.length),
            ...(bench.blockedReason
              ? [evidence("停用原因", bench.blockedReason)]
              : []),
          ],
          fix: buildFix(
            "bench.release-all",
            `移出台架 ${bench.code} 上的全部 ${uniqueAssigned.length} 个材料`,
            "受限台架不应承载材料；只解除台架与材料之间的分配链接，材料、观测与历史记录全部保留，之后可在台架布局页重新安置。",
            { benchId: bench.id, accessionIds: uniqueAssigned },
          ),
          manual: MANUAL_ROUTES.benches,
        }),
      );
    }

    // 光照不匹配
    if (!restricted) {
      uniqueAssigned.forEach((accessionId) => {
        const accession = index.accessionById.get(accessionId);
        if (accession && !isBenchCompatible(accession, bench)) {
          findings.push(
            buildFinding({
              ruleCode: "B-LIGHT-MISMATCH-01",
              domain: "benches",
              severity: "warning",
              title: "台架光照与材料需求不匹配",
              detail: `台架 ${bench.code} 的光照 ${bench.lightProfile} 不满足 ${accession.accessionNo} 的需求 ${accession.preferredLight}。`,
              objectRefs: [
                objectRef("bench", bench.id, bench.code),
                objectRef("accession", accession.id, accession.accessionNo),
              ],
              evidence: [
                evidence("台架光照", bench.lightProfile),
                evidence("材料需求", accession.preferredLight),
              ],
              fix: buildFix(
                "bench.unassign",
                `把 ${accession.accessionNo} 从台架 ${bench.code} 移出`,
                "解除不兼容的分配链接，材料记录完整保留，可随后分配到兼容台架。",
                { benchId: bench.id, accessionId, reason: "light-mismatch" },
              ),
              manual: MANUAL_ROUTES.benches,
            }),
          );
        }
      });
    }

    // 状态派生矛盾
    const expectedStatus: Bench["status"] =
      bench.status === "blocked" || bench.status === "quarantine"
        ? bench.status
        : uniqueAssigned.length === 0
          ? "available"
          : "assigned";
    if (expectedStatus !== bench.status) {
      findings.push(
        buildFinding({
          ruleCode: "B-STATUS-DERIVED-01",
          domain: "benches",
          severity: "info",
          title: "台架状态与占用不一致",
          detail: `台架 ${bench.code} 状态为 ${bench.status}，但占用列表${uniqueAssigned.length === 0 ? "为空" : "不为空"}。`,
          objectRefs: [objectRef("bench", bench.id, bench.code)],
          evidence: [
            evidence("记录的状态", bench.status),
            evidence("按占用派生的状态", expectedStatus),
            evidence("占用数", uniqueAssigned.length),
          ],
          fix: buildFix(
            "bench.reconcile-status",
            `把台架 ${bench.code} 状态校正为 ${expectedStatus}`,
            "只校正派生状态字段，不改变任何分配关系；停用/隔离状态保持原样。",
            { benchId: bench.id, targetStatus: expectedStatus },
          ),
          manual: MANUAL_ROUTES.benches,
        }),
      );
    }
  });

  // 同一材料跨多个台架
  benchOwners.forEach((owners, accessionId) => {
    const accession = index.accessionById.get(accessionId);
    if (!accession || owners.length < 2) {
      return;
    }
    const keep = canonicalBench(owners, accession);
    const removeFrom = owners.filter((bench) => bench.id !== keep.id);
    findings.push(
      buildFinding({
        ruleCode: "A-BENCH-MULTI-01",
        domain: "benches",
        severity: "blocking",
        title: "同一材料被分配到多个台架",
        detail: `${accession.accessionNo} 同时出现在 ${owners
          .map((bench) => bench.code)
          .join("、")}，物理上不可能同时占用多个位置。`,
        objectRefs: [
          objectRef("accession", accession.id, accession.accessionNo),
          ...owners.map((bench) => objectRef("bench", bench.id, bench.code)),
        ],
        evidence: [
          ...owners.map((bench) =>
            evidence(
              `台架 ${bench.code}`,
              `${bench.status} / ${bench.lightProfile}${
                isBenchCompatible(accession, bench) &&
                bench.status !== "blocked" &&
                bench.status !== "quarantine"
                  ? "（兼容）"
                  : "（不兼容或受限）"
              }`,
            ),
          ),
          evidence("建议保留", keep.code),
        ],
        fix: buildFix(
          "accession.detangle-benches",
          `保留 ${keep.code}，从 ${removeFrom.map((bench) => bench.code).join("、")} 移出 ${accession.accessionNo}`,
          "按确定性规则保留一个可用且光照兼容的台架（兼容且可用优先，其次按台架编号排序），只解除其余分配链接，材料与历史记录全部保留。保留规则可在预览中核对，如不认同请改走人工处理。",
          {
            accessionId,
            keepBenchId: keep.id,
            removeBenchIds: removeFrom.map((bench) => bench.id),
          },
        ),
        manual: MANUAL_ROUTES.benches,
      }),
    );
  });

  return findings;
}

/* ------------------------------------------------------------------ */
/* 观测领域                                                             */
/* ------------------------------------------------------------------ */

function checkObservations(index: WorkspaceIndex): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const seenIds = new Set<string>();

  index.valid.passes.forEach((pass) => {
    if (seenIds.has(pass.id)) {
      findings.push(
        buildFinding({
          ruleCode: "O-DUP-ID-01",
          domain: "observations",
          severity: "blocking",
          title: "观测记录 id 重复",
          detail: `观测记录 id ${pass.id} 出现多次。`,
          objectRefs: [objectRef("pass", pass.id, pass.observedOn)],
          manual: MANUAL_ROUTES.observations,
        }),
      );
    }
    seenIds.add(pass.id);

    if (!index.trialIds.has(pass.trialId)) {
      findings.push(
        buildFinding({
          ruleCode: "O-TRIAL-MISSING-01",
          domain: "observations",
          severity: "blocking",
          title: "观测记录引用了已消失的试验",
          detail: `${pass.observedOn} 的观测（${pass.observer}）属于不存在的试验 ${pass.trialId}。观测是历史记录，不应被静默丢弃，需要人工恢复或重新指派。`,
          objectRefs: [objectRef("pass", pass.id, pass.observedOn)],
          evidence: [
            evidence("观测日期", pass.observedOn),
            evidence("观测人", pass.observer),
            evidence("缺失的试验 id", pass.trialId),
          ],
          manual: MANUAL_ROUTES.observations,
        }),
      );
    }

    if (!Array.isArray(pass.entries) || pass.entries.length === 0) {
      findings.push(
        buildFinding({
          ruleCode: "O-EMPTY-01",
          domain: "observations",
          severity: "warning",
          title: "观测记录没有测量条目",
          detail: `${pass.observedOn} 的观测不包含任何测量记录。`,
          objectRefs: [objectRef("pass", pass.id, pass.observedOn)],
          evidence: [evidence("观测人", pass.observer)],
          manual: MANUAL_ROUTES.observations,
        }),
      );
      return;
    }

    const entrySeen = new Set<string>();
    // 条目结构与取值已在 parseCollections 中深层校验，这里只做跨对象检查。
    pass.entries.forEach((validEntry) => {

      if (!index.accessionIds.has(validEntry.accessionId)) {
        findings.push(
          buildFinding({
            ruleCode: "O-ENTRY-ACC-MISSING-01",
            domain: "observations",
            severity: "blocking",
            title: "观测引用了已消失的材料",
            detail: `${pass.observedOn} 的观测包含材料 ${validEntry.accessionId} 的测量，但该材料已不存在。测量是历史证据，不能静默丢弃，需要人工恢复材料或重新指派。`,
            objectRefs: [
              objectRef("pass", pass.id, pass.observedOn),
              objectRef("accession", validEntry.accessionId, validEntry.accessionId),
            ],
            evidence: [
              evidence("观测日期", pass.observedOn),
              evidence("缺失的材料 id", validEntry.accessionId),
              evidence("株高 mm", validEntry.heightMm),
            ],
            manual: MANUAL_ROUTES.observations,
          }),
        );
      } else {
        const accession = index.accessionById.get(validEntry.accessionId);
        if (accession && accession.trialId !== pass.trialId) {
          findings.push(
            buildFinding({
              ruleCode: "O-ENTRY-TRIAL-01",
              domain: "observations",
              severity: "warning",
              title: "观测条目跨试验引用材料",
              detail: `${pass.observedOn} 的观测属于试验 ${pass.trialId}，但条目材料 ${accession.accessionNo} 属于试验 ${accession.trialId}。`,
              objectRefs: [
                objectRef("pass", pass.id, pass.observedOn),
                objectRef("accession", accession.id, accession.accessionNo),
              ],
              evidence: [
                evidence("观测的试验 id", pass.trialId),
                evidence("材料的试验 id", accession.trialId),
              ],
              manual: MANUAL_ROUTES.observations,
            }),
          );
        }
      }

      if (entrySeen.has(validEntry.accessionId)) {
        findings.push(
          buildFinding({
            ruleCode: "O-ENTRY-DUP-01",
            domain: "observations",
            severity: "warning",
            title: "同一观测中材料重复测量",
            detail: `${pass.observedOn} 的观测中，材料 ${
              index.accessionById.get(validEntry.accessionId)?.accessionNo ?? validEntry.accessionId
            } 出现了多条记录，保留哪一条需要人工判断。`,
            objectRefs: [
              objectRef("pass", pass.id, pass.observedOn),
              objectRef(
                "accession",
                validEntry.accessionId,
                index.accessionById.get(validEntry.accessionId)?.accessionNo ?? validEntry.accessionId,
              ),
            ],
            manual: MANUAL_ROUTES.observations,
          }),
        );
      }
      entrySeen.add(validEntry.accessionId);
    });
  });
  return findings;
}

/* ------------------------------------------------------------------ */
/* 标记领域                                                             */
/* ------------------------------------------------------------------ */

function checkFlags(index: WorkspaceIndex): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const seenIds = new Set<string>();

  index.valid.flags.forEach((flag) => {
    if (seenIds.has(flag.id)) {
      findings.push(
        buildFinding({
          ruleCode: "F-DUP-ID-01",
          domain: "flags",
          severity: "blocking",
          title: "标记 id 重复",
          detail: `标记 id ${flag.id} 出现多次。`,
          objectRefs: [objectRef("flag", flag.id, flag.code)],
          manual: MANUAL_ROUTES.quality,
        }),
      );
    }
    seenIds.add(flag.id);

    if (!index.trialIds.has(flag.trialId)) {
      findings.push(
        buildFinding({
          ruleCode: "F-TRIAL-MISSING-01",
          domain: "flags",
          severity: "blocking",
          title: "标记指向已消失的试验",
          detail: `标记 ${flag.code} 引用的试验 ${flag.trialId} 不存在。`,
          objectRefs: [objectRef("flag", flag.id, flag.code)],
          evidence: [evidence("缺失的试验 id", flag.trialId)],
          manual: MANUAL_ROUTES.quality,
        }),
      );
    }
    if (!index.accessionIds.has(flag.accessionId)) {
      findings.push(
        buildFinding({
          ruleCode: "F-ACC-MISSING-01",
          domain: "flags",
          severity: "blocking",
          title: "标记指向已消失的材料",
          detail: `标记 ${flag.code} 引用的材料 ${flag.accessionId} 不存在。`,
          objectRefs: [objectRef("flag", flag.id, flag.code)],
          evidence: [evidence("缺失的材料 id", flag.accessionId)],
          manual: MANUAL_ROUTES.quality,
        }),
      );
    }
    if (!index.passIds.has(flag.observationPassId)) {
      findings.push(
        buildFinding({
          ruleCode: "F-PASS-MISSING-01",
          domain: "flags",
          severity: "blocking",
          title: "标记指向已消失的观测",
          detail: `标记 ${flag.code} 引用的观测记录 ${flag.observationPassId} 不存在，派生证据链断裂。`,
          objectRefs: [objectRef("flag", flag.id, flag.code)],
          evidence: [evidence("缺失的观测 id", flag.observationPassId)],
          manual: MANUAL_ROUTES.quality,
        }),
      );
    }

    const accession = index.accessionById.get(flag.accessionId);
    const pass = index.valid.passes.find((item) => item.id === flag.observationPassId);
    if (accession && accession.trialId !== flag.trialId) {
      const canCorrect = pass && pass.trialId === accession.trialId;
      findings.push(
        buildFinding({
          ruleCode: "F-TRIAL-MISMATCH-01",
          domain: "flags",
          severity: "warning",
          title: "标记的试验与材料不一致",
          detail: `标记 ${flag.code} 挂在试验 ${flag.trialId} 下，但其材料 ${accession.accessionNo} 属于试验 ${accession.trialId}。`,
          objectRefs: [
            objectRef("flag", flag.id, flag.code),
            objectRef("accession", accession.id, accession.accessionNo),
          ],
          evidence: [
            evidence("标记记录的试验 id", flag.trialId),
            evidence("材料所属试验 id", accession.trialId),
            ...(pass ? [evidence("观测记录的试验 id", pass.trialId)] : []),
          ],
          fix: canCorrect
            ? buildFix(
                "flag.correct-trial",
                `把标记 ${flag.code} 的试验改为 ${accession.trialId}`,
                "材料与观测记录一致地指向同一个试验，只有标记上的试验 id 是异常值；校正引用不会删除任何历史。",
                { flagId: flag.id, targetTrialId: accession.trialId },
              )
            : undefined,
          manual: MANUAL_ROUTES.quality,
        }),
      );
    }

    if (pass && accession) {
      const inPass = Array.isArray(pass.entries) &&
        pass.entries.some((entry) => entry.accessionId === accession.id);
      if (!inPass) {
        findings.push(
          buildFinding({
            ruleCode: "F-NOT-IN-PASS-01",
            domain: "flags",
            severity: "info",
            title: "标记引用的观测不包含该材料",
            detail: `标记 ${flag.code} 声称派生自观测 ${pass.observedOn}，但该观测没有 ${accession.accessionNo} 的测量条目。`,
            objectRefs: [
              objectRef("flag", flag.id, flag.code),
              objectRef("pass", pass.id, pass.observedOn),
              objectRef("accession", accession.id, accession.accessionNo),
            ],
            evidence: [evidence("观测日期", pass.observedOn)],
            manual: MANUAL_ROUTES.quality,
          }),
        );
      }
    }
  });
  return findings;
}

/* ------------------------------------------------------------------ */
/* 放行快照领域（不可变历史：只报告，不提供任何破坏性修复）                */
/* ------------------------------------------------------------------ */

function checkClearance(index: WorkspaceIndex): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const seenIds = new Set<string>();

  index.valid.snapshots.forEach((snapshot) => {
    if (seenIds.has(snapshot.id)) {
      findings.push(
        buildFinding({
          ruleCode: "C-DUP-ID-01",
          domain: "clearance",
          severity: "blocking",
          title: "放行快照 id 重复",
          detail: `快照 id ${snapshot.id} 出现多次。`,
          objectRefs: [objectRef("snapshot", snapshot.id, snapshot.generatedOn)],
          manual: MANUAL_ROUTES.clearance,
        }),
      );
    }
    seenIds.add(snapshot.id);

    if (!index.trialIds.has(snapshot.trialId)) {
      findings.push(
        buildFinding({
          ruleCode: "C-TRIAL-MISSING-01",
          domain: "clearance",
          severity: "warning",
          title: "快照引用了已消失的试验",
          detail: `${snapshot.generatedOn} 生成的快照属于不存在的试验 ${snapshot.trialId}。快照是不可变历史记录，系统不会自动删除；可在放行页核对后人工保留或处理。`,
          objectRefs: [objectRef("snapshot", snapshot.id, snapshot.generatedOn)],
          evidence: [
            evidence("生成时间", snapshot.generatedOn),
            evidence("快照状态", snapshot.status),
            evidence("缺失的试验 id", snapshot.trialId),
          ],
          manual: MANUAL_ROUTES.clearance,
        }),
      );
    }

    snapshot.blockers.forEach((blocker) => {
      if (blocker.accessionId && !index.accessionIds.has(blocker.accessionId)) {
        findings.push(
          buildFinding({
            ruleCode: "C-BLOCKER-ACC-01",
            domain: "clearance",
            severity: "info",
            title: "快照阻止项引用了已消失的材料",
            detail: `快照 ${snapshot.generatedOn} 的阻止项 ${blocker.code} 引用的材料 ${blocker.accessionId} 已不存在。快照保留生成时的证据原貌，不做改写。`,
            objectRefs: [objectRef("snapshot", snapshot.id, snapshot.generatedOn)],
            evidence: [
              evidence("阻止项代码", blocker.code),
              evidence("缺失的材料 id", blocker.accessionId),
            ],
            manual: MANUAL_ROUTES.clearance,
          }),
        );
      }
      if (blocker.benchId && !index.benchIds.has(blocker.benchId)) {
        findings.push(
          buildFinding({
            ruleCode: "C-BLOCKER-BENCH-01",
            domain: "clearance",
            severity: "info",
            title: "快照阻止项引用了已消失的台架",
            detail: `快照 ${snapshot.generatedOn} 的阻止项 ${blocker.code} 引用的台架 ${blocker.benchId} 已不存在。快照保留生成时的证据原貌，不做改写。`,
            objectRefs: [objectRef("snapshot", snapshot.id, snapshot.generatedOn)],
            evidence: [
              evidence("阻止项代码", blocker.code),
              evidence("缺失的台架 id", blocker.benchId),
            ],
            manual: MANUAL_ROUTES.clearance,
          }),
        );
      }
    });
  });
  return findings;
}

/* ------------------------------------------------------------------ */
/* 扫描入口                                                             */
/* ------------------------------------------------------------------ */

export interface ScanOptions {
  persistenceFindings?: QualityFinding[];
  scannedAt?: string;
}

export function scanWorkspace(
  state: WorkspaceState | null | undefined,
  options: ScanOptions = {},
): QualityReport {
  const { index, structuralFindings } = buildIndex(
    (state ?? {}) as WorkspaceState,
  );
  const findings = [
    ...(options.persistenceFindings ?? []),
    ...structuralFindings,
    ...checkTrials(index),
    ...checkAccessions(index),
    ...checkBenches(index),
    ...checkObservations(index),
    ...checkFlags(index),
    ...checkClearance(index),
  ];

  const deduped = Array.from(new Map(findings.map((item) => [item.id, item])).values());
  const blocking = deduped.filter((item) => item.severity === "blocking");
  const warning = deduped.filter((item) => item.severity === "warning");
  const info = deduped.filter((item) => item.severity === "info");

  const byDomain = {
    persistence: deduped.filter((item) => item.domain === "persistence"),
    trials: deduped.filter((item) => item.domain === "trials"),
    accessions: deduped.filter((item) => item.domain === "accessions"),
    benches: deduped.filter((item) => item.domain === "benches"),
    observations: deduped.filter((item) => item.domain === "observations"),
    flags: deduped.filter((item) => item.domain === "flags"),
    clearance: deduped.filter((item) => item.domain === "clearance"),
  };

  return {
    scannedAt: options.scannedAt ?? new Date().toISOString(),
    findings: deduped,
    blocking,
    warning,
    info,
    counts: {
      blocking: blocking.length,
      warning: warning.length,
      info: info.length,
    },
    byDomain,
    healthy: deduped.length === 0,
  };
}
