import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Grid3X3, Trash2 } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "../../components/Button";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import { assignAccession, releaseAccession } from "../../domain/bench";
import type { Bench } from "../../domain/types";
import { accessionById, accessionsForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { AssignmentPanel } from "./AssignmentPanel";
import { BenchCard } from "./BenchCard";

export function LayoutPage() {
  const { state, dispatch } = useWorkspace();
  const [searchParams] = useSearchParams();
  const trialParam = searchParams.get("trial") ?? "";
  const focusBenchId = searchParams.get("bench") ?? "";
  const [trialId, setTrialId] = useState(() =>
    state.trials.some((trial) => trial.id === trialParam)
      ? trialParam
      : (state.trials[0]?.id ?? ""),
  );
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
  const trialAccessionIds = useMemo(
    () => new Set(accessions.map((accession) => accession.id)),
    [accessions],
  );
  const selectedAccession = accessionById(state, selectedAccessionId);

  const sortedBenches = useMemo(
    () =>
      [...state.benches].sort((left, right) =>
        left.code.localeCompare(right.code),
      ),
    [state.benches],
  );

  const occupiedBenches = useMemo(
    () =>
      state.benches.filter((bench) =>
        bench.assignedIds.some((id) => trialAccessionIds.has(id)),
      ),
    [state.benches, trialAccessionIds],
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

  /**
   * 批量移出当前试验在各台架上的全部材料。
   * 每个台架独立重放 releaseAccession；只有至少一个台架变化时才 dispatch，
   * 审计层记录为一条包含多个台架对象的整体操作。
   */
  const handleReleaseTrial = () => {
    if (occupiedBenches.length === 0) {
      pushToast({
        tone: "info",
        title: "无需移出",
        message: "当前试验没有材料分配在台架上。",
      });
      return;
    }
    const updatedBenches: Bench[] = [];
    const releasedIds: string[] = [];
    for (const bench of occupiedBenches) {
      const idsOnBench = bench.assignedIds.filter((id) =>
        trialAccessionIds.has(id),
      );
      let current = bench;
      for (const id of idsOnBench) {
        const result = releaseAccession(id, current);
        if (result.ok) {
          current = result.value;
          releasedIds.push(id);
        }
      }
      if (current !== bench) {
        updatedBenches.push(current);
      }
    }
    if (updatedBenches.length === 0) {
      return;
    }
    dispatch({
      type: "bench/batch-released",
      benches: updatedBenches,
      accessionIds: releasedIds,
      trialId,
    });
    pushToast({
      tone: "success",
      title: "批量移出完成",
      message: `${releasedIds.length} 个材料已从 ${updatedBenches.length} 个台架移出。`,
    });
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="台架规划"
        title="台架布局"
        description="根据光照、容量和隔离约束，将材料分配到可用台架。"
        actions={
          <Button
            tone="secondary"
            onClick={handleReleaseTrial}
            disabled={occupiedBenches.length === 0}
            data-testid="batch-release-trial"
          >
            <Trash2 size={16} />
            批量移出当前试验（{occupiedBenches.length} 个台架）
          </Button>
        }
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
              <div
                key={bench.id}
                className={
                  focusBenchId === bench.id ? "bench-focus-wrap" : undefined
                }
                data-testid={
                  focusBenchId === bench.id
                    ? `audit-focus-bench-${bench.id}`
                    : undefined
                }
              >
                <BenchCard
                  bench={bench}
                  accessions={accessions}
                  selectedAccession={selectedAccession}
                  onAssign={handleAssign}
                  onRelease={handleRelease}
                />
              </div>
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
