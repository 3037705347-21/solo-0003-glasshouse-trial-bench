import { PageHeader } from "../../components/PageHeader";
import { ToastRegion, useToastQueue } from "../../components/Toast";
import { useWorkspace } from "../../state/store";
import { AssignmentPanel } from "./AssignmentPanel";
import { BenchGrid } from "./BenchGrid";
import { useBenchActions } from "./useBenchActions";
import { useLayoutSelection } from "./useLayoutSelection";

export function LayoutPage() {
  const { state, dispatch } = useWorkspace();
  const selection = useLayoutSelection(state);
  const { messages, pushToast, dismissToast } = useToastQueue();
  const { assign, release } = useBenchActions(state, dispatch, pushToast);

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
          value={selection.trialId}
          onChange={(event) => selection.selectTrial(event.target.value)}
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
          accessions={selection.accessions}
          selectedAccession={selection.selectedAccession}
          selectedAccessionId={selection.selectedAccessionId}
          onSelectAccession={selection.selectAccession}
        />
        <BenchGrid
          benches={state.benches}
          accessions={selection.accessions}
          selectedAccession={selection.selectedAccession}
          onAssign={assign}
          onRelease={release}
        />
      </div>
      <ToastRegion messages={messages} onDismiss={dismissToast} />
    </div>
  );
}
