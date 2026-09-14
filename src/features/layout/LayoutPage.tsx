import { useMemo, useState } from "react";
import { Grid3X3, TriangleAlert } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import { assignAccession, releaseAccession } from "../../domain/bench";
import { lightProfileLabel } from "../../domain/rules";
import {
  accessionById,
  accessionsForTrial,
  lightConflicts,
} from "../../state/selectors";
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
  const conflicts = lightConflicts(state);

  const sortedBenches = useMemo(
    () =>
      [...state.benches].sort((left, right) =>
        left.code.localeCompare(right.code),
      ),
    [state.benches],
  );

  const handleAssign = (accessionId: string, benchId: string) => {
    const accession = accessionById(state, accessionId);
    const bench = state.benches.find((item) => item.id === benchId);
    if (!accession || !bench) {
      return;
    }
    const result = assignAccession(accession, bench);
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
      {conflicts.length > 0 ? (
        <section
          className="conflict-banner"
          role="alert"
          data-testid="layout-conflict-banner"
        >
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>
              {conflicts.length} 个材料的光照条件与所在台架不一致
            </strong>
            <ul>
              {conflicts.map(({ accession, bench }) => (
                <li key={accession.id}>
                  {accession.accessionNo} {accession.cultivar} 需要
                  {lightProfileLabel(accession.preferredLight)}
                  ，但仍在 {bench.code}（
                  {lightProfileLabel(bench.lightProfile)}
                  ）上——请将其移出台架后重新分配。
                </li>
              ))}
            </ul>
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
                accessions={state.accessions}
                selectedAccession={selectedAccession}
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
