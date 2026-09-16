import { useMemo, useState } from "react";
import { Grid3X3 } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import { assignAccession, releaseAccession } from "../../domain/bench";
import {
  accessionById,
  accessionRemaining,
  accessionsForTrial,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { AssignmentPanel } from "./AssignmentPanel";
import { BenchCard } from "./BenchCard";

export function LayoutPage() {
  const { state, dispatch } = useWorkspace();
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [selectedAccessionId, setSelectedAccessionId] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState(1);
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

  const handleAssign = (accessionId: string, benchId: string) => {
    const accession = accessionById(state, accessionId);
    const bench = state.benches.find((item) => item.id === benchId);
    if (!accession || !bench) {
      return;
    }
    // 计划流程的余量核对：只阻止超量计划，不自动耗用、不改写任何状态。
    if (!Number.isInteger(plannedQuantity) || plannedQuantity < 1) {
      pushToast({
        tone: "error",
        title: "计划数量无效",
        message: "请填写不小于 1 的整数计划使用数量。",
      });
      return;
    }
    const remaining = accessionRemaining(state, accession);
    if (plannedQuantity > remaining) {
      pushToast({
        tone: "error",
        title: "计划数量超过余量",
        message: `${accession.accessionNo} 当前余量 ${remaining}，计划使用 ${plannedQuantity}，请先调减计划或补充库存。`,
      });
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
        message: `${accession.cultivar} 已分配到 ${bench.code}（计划用量 ${plannedQuantity}，余量 ${remaining} 未被扣减）`,
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
          plannedQuantity={plannedQuantity}
          onSelectAccession={(accessionId) => {
            setSelectedAccessionId(accessionId);
            setPlannedQuantity(1);
          }}
          onPlannedQuantityChange={setPlannedQuantity}
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
                state={state}
                selectedAccession={selectedAccession}
                selectedBlockedByStock={
                  Boolean(selectedAccession) &&
                  plannedQuantity >
                    accessionRemaining(state, selectedAccession!)
                }
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
