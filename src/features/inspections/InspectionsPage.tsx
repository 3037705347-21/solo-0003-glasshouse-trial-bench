import { useMemo, useState } from "react";
import { ClipboardPenLine, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  isBlockingBenchInspection,
  isOpenBenchInspection,
} from "../../domain/benchInspection";
import type { Bench, BenchInspection } from "../../domain/types";
import {
  allBenchInspections,
  benchById,
  benchesWithOpenInspections,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { InspectionForm } from "./InspectionForm";
import { InspectionList } from "./InspectionList";

type InspectionSegment = "open" | "blocking" | "all";

export function InspectionsPage() {
  const { state } = useWorkspace();
  const navigate = useNavigate();
  const [segment, setSegment] = useState<InspectionSegment>("open");
  const [benchFilter, setBenchFilter] = useState("");
  const [creatingBenchId, setCreatingBenchId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const benchesById = useMemo(
    () => new Map(state.benches.map((bench) => [bench.id, bench])),
    [state.benches],
  );
  const sortedBenches = useMemo(
    () => [...state.benches].sort((left, right) => left.code.localeCompare(right.code)),
    [state.benches],
  );

  const inspections = useMemo(() => {
    const all = allBenchInspections(state);
    return all.filter((inspection: BenchInspection) => {
      if (benchFilter && inspection.benchId !== benchFilter) {
        return false;
      }
      if (segment === "open") {
        return isOpenBenchInspection(inspection);
      }
      if (segment === "blocking") {
        return isBlockingBenchInspection(inspection);
      }
      return true;
    });
  }, [state, segment, benchFilter]);

  const attentionBenches = benchesWithOpenInspections(state);
  const openCount = attentionBenches.reduce(
    (total, item) => total + item.inspections.length,
    0,
  );
  const blockingCount = attentionBenches
    .flatMap((item) => item.inspections)
    .filter(isBlockingBenchInspection).length;
  const creatingBench = creatingBenchId
    ? benchById(state, creatingBenchId)
    : undefined;

  const segmentOptions: Array<{
    value: InspectionSegment;
    label: string;
  }> = [
    { value: "open", label: `未解除（${openCount}）` },
    { value: "blocking", label: `影响使用（${blockingCount}）` },
    { value: "all", label: `全部历史（${allBenchInspections(state).length}）` },
  ];

  return (
    <div className="page" data-testid="inspections-page">
      <PageHeader
        eyebrow="设施巡检"
        title="台架巡检"
        description="按台架记录清洁、设备、光照和环境检查结果；异常解除前台架布局和放行工作流会持续提示。"
        actions={
          <Button
            onClick={() =>
              setCreatingBenchId(sortedBenches[0]?.id ?? null)
            }
            disabled={sortedBenches.length === 0}
            data-testid="open-inspection-form"
          >
            <ClipboardPenLine size={16} />
            新增巡检
          </Button>
        }
      />
      {attentionBenches.length > 0 ? (
        <section className="inspection-alert-strip" data-testid="inspection-alert-strip">
          <div className="inspection-alert-heading">
            <TriangleAlert size={17} aria-hidden="true" />
            <strong>
              {attentionBenches.length} 个台架存在未解除巡检异常
            </strong>
            <span>
              其中 {blockingCount} 项影响使用，已暂停新材料分配并阻止放行
            </span>
          </div>
          <div className="inspection-alert-benches">
            {attentionBenches.map(({ bench, inspections: list, blocking }) => (
              <button
                type="button"
                key={bench.id}
                className={`inspection-alert-chip inspection-alert-chip-${
                  blocking ? "blocking" : "caution"
                }`}
                onClick={() =>
                  navigate(`/benches/${bench.id}/inspections`)
                }
                data-testid={`inspection-alert-${bench.id}`}
              >
                <strong>{bench.code}</strong>
                <StatusBadge tone={blocking ? "critical" : "warning"}>
                  {`${blocking ? "影响使用" : "需留意"} · ${list.length}`}
                </StatusBadge>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section className="control-strip">
        <select
          className="compact-select"
          value={benchFilter}
          onChange={(event) => setBenchFilter(event.target.value)}
          aria-label="按台架筛选"
          data-testid="inspection-bench-filter"
        >
          <option value="">全部台架</option>
          {sortedBenches.map((bench: Bench) => (
            <option value={bench.id} key={bench.id}>
              {bench.code} - {bench.sector}
            </option>
          ))}
        </select>
        <SegmentedTabs
          label="按巡检状态筛选"
          value={segment}
          options={segmentOptions}
          onChange={setSegment}
        />
      </section>
      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">巡检记录</span>
            <span className="panel-subtitle">
              记录只追加、不可改写；解除异常不会删除历史
            </span>
          </div>
          <ClipboardPenLine size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <InspectionList
          inspections={inspections}
          benchesById={benchesById}
          emptyMessage="当前筛选条件下没有巡检记录。"
        />
      </section>
      <Dialog
        open={creatingBench !== undefined}
        title="新增台架巡检"
        onClose={() => setCreatingBenchId(null)}
        wide
      >
        {creatingBench ? (
          <>
            <div className="inspection-bench-switch">
              <label>
                <span className="field-label">巡检台架</span>
                <select
                  className="field-input"
                  value={creatingBench.id}
                  onChange={(event) => setCreatingBenchId(event.target.value)}
                  data-testid="inspection-bench-select"
                >
                  {sortedBenches.map((bench) => (
                    <option value={bench.id} key={bench.id}>
                      {bench.code} - {bench.sector}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <InspectionForm
              bench={creatingBench}
              onCancel={() => setCreatingBenchId(null)}
              onSaved={() => {
                const bench = creatingBench;
                setCreatingBenchId(null);
                pushToast({
                  tone: "success",
                  title: "巡检已记录",
                  message: `${bench.code} 的巡检记录已保存。`,
                });
              }}
            />
          </>
        ) : (
          <p>暂无可巡检的台架。</p>
        )}
      </Dialog>
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
