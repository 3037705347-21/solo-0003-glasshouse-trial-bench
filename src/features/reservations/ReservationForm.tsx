import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/fields";
import { LIGHT_PROFILES } from "../../domain/rules";
import type { FieldError } from "../../domain/result";
import type { PreferredLight } from "../../domain/types";
import { createId } from "../../domain/id";
import { createReservation } from "../../domain/reservation";
import { useWorkspace } from "../../state/store";

interface ReservationFormProps {
  trialId: string;
  onSaved: (outcome: {
    duplicate: boolean;
    verdict: string;
    code: string;
  }) => void;
  onCancel: () => void;
}

export function ReservationForm({
  trialId,
  onSaved,
  onCancel,
}: ReservationFormProps) {
  const { state, dispatch } = useWorkspace();
  const [requestKey] = useState(() => createId("req"));
  const [draft, setDraft] = useState({
    trialId,
    sectorFilter: "",
    lightFilter: "" as "" | PreferredLight,
    benchId: "",
    startDate:
      state.trials.find((trial) => trial.id === trialId)?.startDate ?? "",
    endDate:
      state.trials.find((trial) => trial.id === trialId)?.endDate ?? "",
    slots: 1,
    note: "",
  });
  const [errors, setErrors] = useState<FieldError[]>([]);

  const errorFor = (field: string): string | undefined =>
    errors.find((error) => error.field === field)?.message;

  const sectors = useMemo(
    () =>
      Array.from(new Set(state.benches.map((bench) => bench.sector))).sort(),
    [state.benches],
  );

  const candidateBenches = state.benches.filter(
    (bench) =>
      (!draft.sectorFilter || bench.sector === draft.sectorFilter) &&
      (!draft.lightFilter || bench.lightProfile === draft.lightFilter),
  );

  const selectedBench = state.benches.find(
    (bench) => bench.id === draft.benchId,
  );

  const update = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      // 过滤条件变化后，若已选台架不再匹配则清空。
      if (key === "sectorFilter" || key === "lightFilter") {
        const stillMatches = state.benches.find(
          (bench) =>
            bench.id === next.benchId &&
            (!next.sectorFilter || bench.sector === next.sectorFilter) &&
            (!next.lightFilter || bench.lightProfile === next.lightFilter),
        );
        if (!stillMatches) {
          next.benchId = "";
        }
      }
      return next;
    });
  };

  const handleSubmit = () => {
    const result = createReservation(
      {
        trialId: draft.trialId,
        benchId: draft.benchId,
        startDate: draft.startDate,
        endDate: draft.endDate,
        slots: draft.slots,
        note: draft.note,
        requestKey,
      },
      state,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (!result.value.duplicate) {
      dispatch({
        type: "reservation/created",
        reservation: result.value.reservation,
      });
    }
    onSaved({
      duplicate: result.value.duplicate,
      verdict: result.value.evaluation.verdict,
      code: result.value.reservation.code,
    });
  };

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="reservation-form"
    >
      <div className="form-grid">
        <SelectField
          label="试验"
          value={draft.trialId}
          onChange={(event) => update("trialId", event.target.value)}
          error={errorFor("trialId")}
          data-testid="reservation-trial-select"
        >
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}（{trial.startDate} ~ {trial.endDate}）
            </option>
          ))}
        </SelectField>
        <TextField label="请求标识" value={requestKey} readOnly hint="同一请求重复提交不会多占容量" />
        <SelectField
          label="区域筛选"
          value={draft.sectorFilter}
          onChange={(event) => update("sectorFilter", event.target.value)}
        >
          <option value="">全部区域</option>
          {sectors.map((sector) => (
            <option value={sector} key={sector}>
              {sector}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="光照筛选"
          value={draft.lightFilter}
          onChange={(event) =>
            update("lightFilter", event.target.value as "" | PreferredLight)
          }
        >
          <option value="">全部光照</option>
          {LIGHT_PROFILES.map((profile) => (
            <option value={profile} key={profile}>
              {profile === "full-sun"
                ? "全日照"
                : profile === "partial-shade"
                  ? "半阴"
                  : "遮阴"}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="台架（含维护状态）"
          value={draft.benchId}
          onChange={(event) => update("benchId", event.target.value)}
          error={errorFor("benchId")}
          data-testid="reservation-bench-select"
        >
          <option value="">请选择台架</option>
          {candidateBenches.map((bench) => (
            <option value={bench.id} key={bench.id}>
              {bench.code} · {bench.sector} · 容量 {bench.capacity}
              {bench.status === "blocked"
                ? " · 停用维护中"
                : bench.status === "quarantine"
                  ? " · 隔离中"
                  : ""}
            </option>
          ))}
        </SelectField>
        <TextField
          label="预留槽位数"
          type="number"
          min={1}
          value={draft.slots}
          onChange={(event) => update("slots", Number(event.target.value))}
          error={errorFor("slots")}
          data-testid="reservation-slots-input"
        />
        <TextField
          label="开始日期"
          type="date"
          value={draft.startDate}
          onChange={(event) => update("startDate", event.target.value)}
          error={errorFor("startDate")}
          data-testid="reservation-start-input"
        />
        <TextField
          label="结束日期"
          type="date"
          value={draft.endDate}
          onChange={(event) => update("endDate", event.target.value)}
          error={errorFor("endDate")}
          data-testid="reservation-end-input"
        />
        <TextAreaField
          label="预留说明"
          value={draft.note}
          onChange={(event) => update("note", event.target.value)}
          className="field-span-2"
          rows={3}
          hint="可记录跨期安排、竞争试验或维修依赖"
        />
      </div>
      {selectedBench ? (
        <p className="muted-copy">
          登记时台架状态：{selectedBench.code} 位于 {selectedBench.sector}，
          光照为
          {selectedBench.lightProfile === "full-sun"
            ? "全日照"
            : selectedBench.lightProfile === "partial-shade"
              ? "半阴"
              : "遮阴"}
          ，当前{selectedBench.status === "blocked"
            ? "停用维护中"
            : selectedBench.status === "quarantine"
              ? "隔离中"
              : "可运行"}；后续台架变更会让该预留重新判定。
        </p>
      ) : null}
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="save-reservation-button">
          登记预留
        </Button>
      </div>
    </form>
  );
}
