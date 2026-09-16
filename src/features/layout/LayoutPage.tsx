import { useEffect, useMemo, useState } from "react";
import { Grid3X3 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import { assignAccession, releaseAccession } from "../../domain/bench";
import { accessionById, accessionsForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { AssignmentPanel } from "./AssignmentPanel";
import { BenchCard } from "./BenchCard";

export function LayoutPage() {
  const { state, dispatch } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const trialFromUrl = searchParams.get("trial");
  const accessionFromUrl = searchParams.get("accession");
  const benchFromUrl = searchParams.get("bench");
  const [trialId, setTrialId] = useState(() =>
    trialFromUrl && state.trials.some((trial) => trial.id === trialFromUrl)
      ? trialFromUrl
      : (state.trials[0]?.id ?? ""),
  );
  const [selectedAccessionId, setSelectedAccessionId] = useState(
    () => accessionFromUrl ?? "",
  );
  const [highlightBenchId, setHighlightBenchId] = useState(
    () => benchFromUrl ?? "",
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // 今日工作台跳回时预选试验/材料并高亮对应台架，处理完成后即可就地分配或移出。
  useEffect(() => {
    const nextTrial = searchParams.get("trial");
    if (nextTrial && state.trials.some((trial) => trial.id === nextTrial)) {
      setTrialId(nextTrial);
    }
    setSelectedAccessionId(searchParams.get("accession") ?? "");
    setHighlightBenchId(searchParams.get("bench") ?? "");
  }, [searchParams, state.trials]);

  useEffect(() => {
    if (!highlightBenchId) {
      return;
    }
    const element = document.querySelector(
      `[data-testid="bench-card-${highlightBenchId}"]`,
    );
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightBenchId]);

  const updateTrial = (next: string) => {
    setTrialId(next);
    setSelectedAccessionId("");
    const nextParams = new URLSearchParams();
    nextParams.set("trial", next);
    const bench = searchParams.get("bench");
    if (bench) {
      nextParams.set("bench", bench);
    }
    setSearchParams(nextParams, { replace: true });
  };

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
          onChange={(event) => updateTrial(event.target.value)}
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
                highlighted={highlightBenchId === bench.id}
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
