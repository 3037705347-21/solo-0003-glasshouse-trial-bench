import { useState } from "react";
import { Button } from "../../components/Button";
import {
  SelectField,
  TextField,
} from "../../components/fields";
import type { FieldError } from "../../domain/result";
import type { BenchStatus, PreferredLight } from "../../domain/types";
import {
  BENCH_STATUS_OPTIONS,
  editBench,
} from "../../domain/reservation";
import { useWorkspace } from "../../state/store";

interface BenchFormProps {
  benchId: string;
  onSaved: (changed: boolean) => void;
  onCancel: () => void;
}

const STATUS_LABELS: Record<BenchStatus, string> = {
  available: "可用",
  assigned: "已分配（有材料）",
  blocked: "停用维护",
  quarantine: "隔离",
};

export function BenchForm({ benchId, onSaved, onCancel }: BenchFormProps) {
  const { state, dispatch } = useWorkspace();
  const bench = state.benches.find((item) => item.id === benchId);
  const [draft, setDraft] = useState(() => ({
    sector: bench?.sector ?? "",
    capacity: bench?.capacity ?? 1,
    lightProfile: bench?.lightProfile ?? "full-sun",
    status: bench?.status ?? "available",
    blockedReason: bench?.blockedReason ?? "",
  }));
  const [errors, setErrors] = useState<FieldError[]>([]);

  if (!bench) {
    return <p className="muted-copy">台架不存在。</p>;
  }

  const errorFor = (field: string): string | undefined =>
    errors.find((error) => error.field === field)?.message;

  const update = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = () => {
    const result = editBench(bench, draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const changed =
      result.value.sector !== bench.sector ||
      result.value.capacity !== bench.capacity ||
      result.value.lightProfile !== bench.lightProfile ||
      result.value.status !== bench.status ||
      result.value.blockedReason !== bench.blockedReason;
    dispatch({ type: "bench/updated", bench: result.value });
    onSaved(changed);
  };

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="bench-form"
    >
      <div className="form-grid">
        <TextField
          label="区域"
          value={draft.sector}
          onChange={(event) => update("sector", event.target.value)}
          error={errorFor("sector")}
        />
        <TextField
          label="容量（槽位）"
          type="number"
          min={1}
          value={draft.capacity}
          onChange={(event) => update("capacity", Number(event.target.value))}
          error={errorFor("capacity")}
          hint={`当前已有 ${bench.assignedIds.length} 份实际材料，容量不能低于该数`}
        />
        <SelectField
          label="光照类型"
          value={draft.lightProfile}
          onChange={(event) =>
            update("lightProfile", event.target.value as PreferredLight)
          }
          error={errorFor("lightProfile")}
        >
          <option value="full-sun">全日照</option>
          <option value="partial-shade">半阴</option>
          <option value="shade">遮阴</option>
        </SelectField>
        <SelectField
          label="运行状态"
          value={draft.status}
          onChange={(event) => update("status", event.target.value as BenchStatus)}
          error={errorFor("status")}
          data-testid="bench-status-select"
        >
          {BENCH_STATUS_OPTIONS.map((status) => (
            <option value={status} key={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </SelectField>
        {draft.status === "blocked" ? (
          <TextField
            label="停用 / 维护原因"
            value={draft.blockedReason}
            onChange={(event) => update("blockedReason", event.target.value)}
            error={errorFor("blockedReason")}
            className="field-span-2"
          />
        ) : null}
      </div>
      <p className="muted-copy">
        保存后，该台架上的全部历史预留会立即重新判定为有效、冲突或失效；已经实际分配的材料不会被改动。
      </p>
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="save-bench-button">
          保存台架
        </Button>
      </div>
    </form>
  );
}
