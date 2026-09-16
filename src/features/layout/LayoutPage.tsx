import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Grid3X3, TriangleAlert } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import { assignAccession, releaseAccession } from "../../domain/bench";
import { isBlockingBenchInspection } from "../../domain/benchInspection";
import {
  accessionById,
  accessionsForTrial,
  benchesWithOpenInspections,
  openInspectionMap,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { AssignmentPanel } from "./AssignmentPanel";
import { BenchCard } from "./BenchCard";

export function LayoutPage() {
  const { state, dispatch } = useWorkspace();
  const navigate = useNavigate();
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [selectedAccessionId, setSelectedAccessionId] = useState("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const accessions = accessionsForTrial(state, trialId);
  const selectedAccession = accessionById(state, selectedAccessionId);

  const sortedBenches = useMemo(
    () =>
      [...state.benches].sort((left, right) =>
        left.code.localeCompare(right.code),
      ),
    [state.benches],
  );

  const inspectionMap = useMemo(
    () => openInspectionMap(state),
    [state],
  );
  const attentionBenches = useMemo(
    () => benchesWithOpenInspections(state),
    [state],
  );

  const handleAssign = (accessionId: string, benchId: string) => {
    const accession = accessionById(state, accessionId);
    const bench = state.benches.find((item) => item.id === benchId);
    if (!accession || !bench) {
      return;
    }
    const result = assignAccession(
      accession,
      bench,
      state.benchInspections ?? [],
    );
    if (!result.ok) {
      pushToast({
        tone: "error",
        title: "分配被拒绝",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({ type: "bench/assigned", bench: result.value });
    pushToast({
      tone: "success",
        title: "台架分配成功",
        message: `${accession.cultivar} 已分配到 ${bench.code}`,
    });
  };

  const handleRelease = (accessionId: string, benchId: string) => {
    const bench = state.benches.find((item) => item.id === benchId);
    if (!bench) {
      return;
    }
    const result = releaseAccession(accessionId, bench);
    if (!result.ok) {
      pushToast({
        tone: "error",
        title: "移出失败",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({ type: "bench/released", bench: result.value });
    pushToast({
      tone: "success",
        title: "材料已移出",
        message: "该台架空位已恢复可用。",
    });
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="台架规划"
        title="台架布局"
        description="根据光照、容量、隔离和未解除巡检异常等约束，将材料分配到可用台架。"
      />
      <section className="control-strip">
        <select
          className="compact-select"
          value={trialId}
          onChange={(event) => {
            setTrialId(event.target.value);
            setSelectedAccessionId("");
          }}
          aria-label="选择试验"
          data-testid="layout-trial-select"
        >
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </select>
      </section>
      {attentionBenches.length > 0 ? (
        <section
          className="layout-inspection-banner"
          data-testid="layout-inspection-banner"
        >
          <div className="inspection-alert-heading">
            <TriangleAlert size={17} aria-hidden="true" />
            <strong>
              {attentionBenches.length} 个台架有未解除的巡检异常
            </strong>
            <span>
              影响使用的台架已暂停新材料分配；已有在架材料不会被自动移出
            </span>
          </div>
          <div className="inspection-alert-benches">
            {attentionBenches.map(({ bench, inspections, blocking }) => (
              <button
                type="button"
                key={bench.id}
                className={`inspection-alert-chip inspection-alert-chip-${
                  blocking ? "blocking" : "caution"
                }`}
                onClick={() =>
                  navigate(`/benches/${bench.id}/inspections`)
                }
                data-testid={`layout-inspection-chip-${bench.id}`}
              >
                <strong>{bench.code}</strong>
                <StatusBadge tone={blocking ? "critical" : "warning"}>
                  {`${blocking ? "影响使用" : "需留意"} · ${inspections.length}`}
                </StatusBadge>
                <span className="inspection-chip-summary">
                  {inspections
                    .filter(isBlockingBenchInspection)
                    .length > 0
                    ? "未解除前不能分配"
                    : "可分配但请查看提示"}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <div className="layout-workspace">
        <AssignmentPanel
          state={state}
          trialId={trialId}
          selectedAccessionId={selectedAccessionId}
          onSelectAccession={setSelectedAccessionId}
        />
        <section className="bench-grid" aria-label="台架网格">
          <div className="bench-grid-heading">
            <Grid3X3 size={18} aria-hidden="true" />
            <h2>台架</h2>
            <span>共 {state.benches.length} 个</span>
          </div>
          <div className="bench-grid-list">
            {sortedBenches.map((bench) => (
              <BenchCard
                key={bench.id}
                bench={bench}
                accessions={accessions}
                selectedAccession={selectedAccession}
                openInspections={inspectionMap.get(bench.id) ?? []}
                onAssign={handleAssign}
                onRelease={handleRelease}
              />
            ))}
          </div>
        </section>
      </div>
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
