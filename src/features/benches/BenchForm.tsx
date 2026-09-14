import { useState } from "react";
import type { Bench, BenchOperationalStatus, PreferredLight } from "../../domain/types";
import type { BenchDraft } from "../../domain/bench";
import {
  BENCH_CAPACITY_MAX,
  BENCH_CAPACITY_MIN,
  benchOccupancy,
  createBench,
  updateBench,
} from "../../domain/bench";
import { LIGHT_PROFILES } from "../../domain/rules";
import { Button } from "../../components/Button";
import { SelectField, TextField } from "../../components/fields";
import type { FieldError } from "../../domain/result";
import { useWorkspace } from "../../state/store";

interface BenchFormProps {
  bench?: Bench;
  defaultCode?: string;
  onSaved: () => void;
  onCancel: () => void;
}

export const LIGHT_LABEL: Record<PreferredLight, string> = {
  "full-sun": "全日照",
  "partial-shade": "半阴",
  shade: "遮阴",
};

export const OPERATIONAL_STATUS_LABEL: Record<BenchOperationalStatus, string> = {
  available: "可用",
  blocked: "受限",
  quarantine: "隔离",
};

function blankDraft(defaultCode: string): BenchDraft {
  return {
    code: defaultCode,
    sector: "",
    capacity: 4,
    lightProfile: "full-sun",
    irrigationLine: "",
    status: "available",
    statusNote: "",
  };
}

function draftFromBench(bench: Bench): BenchDraft {
  return {
    code: bench.code,
    sector: bench.sector,
    capacity: bench.capacity,
    lightProfile: bench.lightProfile,
    irrigationLine: bench.irrigationLine,
    status:
      bench.status === "blocked" || bench.status === "quarantine"
        ? bench.status
        : "available",
    statusNote: bench.statusNote ?? bench.blockedReason ?? "",
  };
}

export function BenchForm({ bench, defaultCode = "", onSaved, onCancel }: BenchFormProps) {
  const { state, dispatch } = useWorkspace();
  const [draft, setDraft] = useState<BenchDraft>(() =>
    bench ? draftFromBench(bench) : blankDraft(defaultCode),
  );
  const [errors, setErrors] = useState<FieldError[]>([]);

  const errorFor = (field: string): string | undefined =>
    errors.find((error) => error.field === field)?.message;

  const update = <K extends keyof BenchDraft>(key: K, value: BenchDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const occupancy = bench ? benchOccupancy(bench) : 0;

  const handleSubmit = () => {
    const result = bench
      ? updateBench(bench, draft, state)
      : createBench(draft, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({
      type: bench ? "bench/updated" : "bench/created",
      bench: result.value,
    });
    onSaved();
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
          label="台架编号"
          value={draft.code}
          onChange={(event) => update("code", event.target.value)}
          error={errorFor("code")}
          hint={bench ? undefined : "如 E-3、NORTH-12，字母与编号用连字符连接"}
          data-testid="bench-code-input"
        />
        <TextField
          label="区域"
          value={draft.sector}
          onChange={(event) => update("sector", event.target.value)}
          error={errorFor("sector")}
          data-testid="bench-sector-input"
        />
        <TextField
          label="容量（槽位）"
          type="number"
          min={BENCH_CAPACITY_MIN}
          max={BENCH_CAPACITY_MAX}
          value={draft.capacity}
          onChange={(event) => update("capacity", Number(event.target.value))}
          error={errorFor("capacity")}
          hint={bench ? `当前真实占用 ${occupancy} 个槽位，容量不得低于占用` : undefined}
          data-testid="bench-capacity-input"
        />
        <SelectField
          label="光照类型"
          value={draft.lightProfile}
          onChange={(event) =>
            update("lightProfile", event.target.value as PreferredLight)
          }
          error={errorFor("lightProfile")}
        >
          {LIGHT_PROFILES.map((profile) => (
            <option value={profile} key={profile}>
              {LIGHT_LABEL[profile]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="灌溉管路"
          value={draft.irrigationLine}
          onChange={(event) => update("irrigationLine", event.target.value)}
          error={errorFor("irrigationLine")}
          data-testid="bench-irrigation-input"
        />
        {bench ? (
          <TextField
            label="运行状态"
            value={OPERATIONAL_STATUS_LABEL[draft.status]}
            readOnly
            hint="如需在可用 / 受限 / 隔离之间切换，请使用台账中的“状态”按钮"
          />
        ) : (
          <SelectField
            label="运行状态"
            value={draft.status}
            onChange={(event) =>
              update("status", event.target.value as BenchOperationalStatus)
            }
            error={errorFor("status")}
            data-testid="bench-status-select"
          >
            <option value="available">可用</option>
            <option value="blocked">受限</option>
            <option value="quarantine">隔离</option>
          </SelectField>
        )}
        {draft.status !== "available" ? (
          <TextField
            label={draft.status === "quarantine" ? "隔离原因" : "受限原因"}
            value={draft.statusNote}
            onChange={(event) => update("statusNote", event.target.value)}
            error={errorFor("statusNote")}
            hint="原因会写入台架维护记录"
            className="field-span-2"
            data-testid="bench-status-note-input"
          />
        ) : null}
      </div>
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="save-bench-button">
          {bench ? "保存台架" : "创建台架"}
        </Button>
      </div>
    </form>
  );
}
