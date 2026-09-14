import { useMemo, useState } from "react";
import { Grid3X3 } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import { releaseAccession } from "../../domain/bench";
import {
  canAssignAccessionToBench,
  overallPlanningWindow,
  planBenchCapacity,
  planAssignment,
} from "../../domain/reservation";
import { accessionById, accessionsForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { AssignmentPanel } from "./AssignmentPanel";
import { BenchCard } from "./BenchCard";

export function LayoutPage() {
  const { state, dispatch } = useWorkspace();
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

  const planningWindow = useMemo(
    () => overallPlanningWindow(state),
    [state],
  );

  const capacityPlans = useMemo(() => {
    const map = new Map(
      sortedBenches.map((bench) => [
        bench.id,
        planBenchCapacity(state, planningWindow, bench),
      ]),
    );
    return map;
  }, [state, sortedBenches, planningWindow]);

  const assignableByBench = useMemo(() => {
    const map = new Map<string, boolean>();
    if (selectedAccessionId) {
      sortedBenches.forEach((bench) => {
        map.set(
          bench.id,
          canAssignAccessionToBench(state, selectedAccessionId, bench.id),
        );
      });
    }
    return map;
  }, [state, sortedBenches, selectedAccessionId]);

  const handleAssign = (accessionId: string, benchId: string) => {
    const accession = accessionById(state, accessionId);
    const bench = state.benches.find((item) => item.id === benchId);
    if (!accession || !bench) {
      return;
    }
    const result = planAssignment(state, accessionId, benchId);
    if (!result.ok) {
      pushToast({
        tone: "error",
        title: "分配被拒绝",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({
      type: "bench/assigned",
      bench: result.value.bench,
      reservation: result.value.consumedReservation ?? undefined,
    });
    pushToast({
      tone: "success",
      title: "台架分配成功",
      message: result.value.consumedReservation
        ? `${accession.cultivar} 已分配到 ${bench.code}，并消耗预留 ${result.value.consumedReservation.code}`
        : `${accession.cultivar} 已分配到 ${bench.code}（无预留可消耗）`,
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
        description="根据光照、容量和隔离约束，将材料分配到可用台架。"
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
                plan={capacityPlans.get(bench.id)}
                assignable={assignableByBench.get(bench.id) ?? false}
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
