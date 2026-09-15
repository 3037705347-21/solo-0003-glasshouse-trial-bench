import { useMemo, useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { TextAreaField } from "../../components/fields";
import { StatusBadge } from "../../components/StatusBadge";
import type { ObservationPass } from "../../domain/types";
import {
  applyReinterpretation,
  planReinterpretation,
} from "../../domain/observation";
import {
  currentRuleSetForTrial,
  ruleSetLabel,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface ReinterpretDialogProps {
  pass: ObservationPass;
  onCancel: () => void;
  onSaved: (created: number, superseded: number) => void;
}

export function ReinterpretDialog({
  pass,
  onCancel,
  onSaved,
}: ReinterpretDialogProps) {
  const { state, dispatch } = useWorkspace();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();

  const targetRuleSet = currentRuleSetForTrial(state, pass.trialId);
  const plan = useMemo(() => {
    const result = planReinterpretation(state, pass.id, targetRuleSet);
    return result.ok ? result.value : undefined;
  }, [state, pass.id, targetRuleSet]);

  const unchanged =
    plan && plan.created.length === 0 && plan.superseded.length === 0;

  const handleConfirm = () => {
    if (!plan) {
      return;
    }
    const result = applyReinterpretation(plan, note);
    if (!result.ok) {
      setError(result.errors[0]?.message);
      return;
    }
    dispatch({
      type: "observation/reinterpreted",
      updatedFlags: result.value.updatedFlags,
      createdFlags: result.value.createdFlags,
      record: result.value.record,
    });
    onSaved(result.value.createdFlags.length, result.value.updatedFlags.length);
  };

  return (
    <Dialog open title="按当前规则重新解释" onClose={onCancel} wide>
      <div className="reinterpret-dialog" data-testid="reinterpret-dialog">
        <p className="reinterpret-intro">
          观测 {pass.observedOn}（{pass.observer}）最初按
          {ruleSetLabel(state, pass.ruleSetId)}判定； 当前生效的是
          {ruleSetLabel(state, targetRuleSet.id)}。
          重新解释不会改写历史标记，只会取代或新增结论。
        </p>
        {plan ? (
          <div className="reinterpret-preview">
            <div className="reinterpret-stat" data-testid="reinterpret-created">
              <strong>{plan.created.length}</strong>
              <span>新增标记</span>
            </div>
            <div className="reinterpret-stat" data-testid="reinterpret-superseded">
              <strong>{plan.superseded.length}</strong>
              <span>被取代</span>
            </div>
            <div className="reinterpret-stat" data-testid="reinterpret-carried">
              <strong>{plan.carried.length}</strong>
              <span>保留原结论</span>
            </div>
          </div>
        ) : null}
        {plan && !unchanged ? (
          <ul className="reinterpret-diff">
            {plan.created.map((flag) => (
              <li key={`created-${flag.code}-${flag.accessionId}`}>
                <StatusBadge tone="critical">新增</StatusBadge>
                <span>{flag.message}</span>
              </li>
            ))}
            {plan.superseded.map((flag) => (
              <li key={`superseded-${flag.id}`}>
                <StatusBadge tone="neutral">取代</StatusBadge>
                <span>
                  {flag.code}：{flag.message}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {unchanged ? (
          <p className="muted-copy" data-testid="reinterpret-unchanged">
            按当前规则重新判定的结论与现有标记一致，无需变更。
          </p>
        ) : (
          <TextAreaField
            label="重新解释说明"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            error={error}
            hint="说明会写入审计记录和被取代标记的历史。"
            data-testid="reinterpret-note"
          />
        )}
        <div className="editor-actions">
          <Button tone="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!plan || unchanged}
            data-testid="confirm-reinterpret"
          >
            <GitBranch size={15} />
            确认重新解释
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
