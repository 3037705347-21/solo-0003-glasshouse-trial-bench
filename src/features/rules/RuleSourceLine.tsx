import { AlertTriangle, ScrollText } from "lucide-react";
import {
  resolveRuleVersion,
  ruleVersionLabel,
} from "../../domain/ruleVersion";
import { useWorkspace } from "../../state/store";

interface RuleSourceLineProps {
  trialId: string;
}

export function RuleSourceLine({ trialId }: RuleSourceLineProps) {
  const { state } = useWorkspace();
  const resolution = resolveRuleVersion(state, trialId);

  if (resolution.kind === "none") {
    return (
      <p
        className="rule-source-line rule-source-none"
        data-testid="rule-source-line"
      >
        <AlertTriangle size={14} aria-hidden="true" />
        <span>
          规则来源：<strong>无匹配规则版本</strong>
          。新观测将被阻止，请先在规则版本页为该试验或其科属启用一个版本。
        </span>
      </p>
    );
  }

  return (
    <p className="rule-source-line" data-testid="rule-source-line">
      <ScrollText size={14} aria-hidden="true" />
      <span>
        规则来源：
        <strong>{ruleVersionLabel(resolution.version, state.trials)}</strong>
        <em className="rule-source-kind">
          {resolution.source === "trial" ? "试验级规则" : "科属规则"}
        </em>
      </span>
      {resolution.shadowed ? (
        <span className="rule-source-conflict">
          冲突：{ruleVersionLabel(resolution.shadowed, state.trials)}{" "}
          被试验级规则覆盖
        </span>
      ) : null}
    </p>
  );
}
