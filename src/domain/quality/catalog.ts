import type {
  FixKind,
  FixSpec,
  ManualRoute,
  ObjectKind,
  QualityDomain,
  QualityEvidence,
  QualityFinding,
  QualityObjectRef,
  QualitySeverity,
} from "./types";

export const DOMAIN_LABELS: Record<QualityDomain, string> = {
  trials: "试验生命周期",
  accessions: "材料登记",
  benches: "台架布局",
  observations: "生长观测",
  flags: "生长标记",
  clearance: "放行快照",
  persistence: "持久化与版本",
};

export const DOMAIN_ORDER: QualityDomain[] = [
  "persistence",
  "trials",
  "accessions",
  "benches",
  "observations",
  "flags",
  "clearance",
];

export const SEVERITY_LABELS: Record<QualitySeverity, string> = {
  blocking: "阻断",
  warning: "警告",
  info: "提示",
};

export const OBJECT_KIND_LABELS: Record<ObjectKind, string> = {
  trial: "试验",
  accession: "材料",
  bench: "台架",
  pass: "观测记录",
  flag: "标记",
  snapshot: "放行快照",
  storage: "浏览器存储",
};

export const MANUAL_ROUTES: Record<
  "trials" | "accessions" | "benches" | "observations" | "clearance" | "quality",
  ManualRoute
> = {
  trials: {
    path: "/clearance",
    actionLabel: "前往试验放行",
    instruction: "在放行页检查该试验的生命周期状态与阻止项。",
  },
  accessions: {
    path: "/roster",
    actionLabel: "前往材料登记",
    instruction: "在材料登记页核对材料字段与归属试验。",
  },
  benches: {
    path: "/layout",
    actionLabel: "前往台架布局",
    instruction: "在台架布局页检查材料分配、容量与台架状态。",
  },
  observations: {
    path: "/observations",
    actionLabel: "前往生长观测",
    instruction: "在观测页核对该观测记录与测量条目。",
  },
  clearance: {
    path: "/clearance",
    actionLabel: "前往试验放行",
    instruction: "在放行页重新生成快照或核对快照证据。",
  },
  quality: {
    path: "/quality",
    actionLabel: "在数据质量中心处理",
    instruction: "该问题无法安全自动修复，需要人工判断后处理。",
  },
};

export interface BuildFindingInput {
  ruleCode: string;
  domain: QualityDomain;
  severity: QualitySeverity;
  title: string;
  detail: string;
  objectRefs?: QualityObjectRef[];
  evidence?: QualityEvidence[];
  fix?: FixSpec;
  manual?: ManualRoute;
}

export function buildFinding(input: BuildFindingInput): QualityFinding {
  const refsKey = (input.objectRefs ?? [])
    .map((ref) => `${ref.kind}:${ref.id}`)
    .join("|");
  const stablePart = [input.ruleCode, refsKey].filter(Boolean).join("@");
  return {
    id: `q-${stablePart}`.replace(/[^a-zA-Z0-9@:_-]/g, "_"),
    ruleCode: input.ruleCode,
    domain: input.domain,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    objectRefs: input.objectRefs ?? [],
    evidence: input.evidence ?? [],
    fix: input.fix,
    manual: input.manual,
  };
}

export function objectRef(
  kind: ObjectKind,
  id: string,
  label: string,
): QualityObjectRef {
  return { kind, id, label };
}

export function evidence(label: string, value: string | number): QualityEvidence {
  return { label, value: String(value) };
}

export function buildFix(
  kind: FixKind,
  action: string,
  rationale: string,
  context: Record<string, string | string[]>,
): FixSpec {
  return { kind, action, rationale, context };
}
