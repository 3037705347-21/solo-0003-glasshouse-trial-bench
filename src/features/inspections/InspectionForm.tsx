import { useState } from "react";
import { Button } from "../../components/Button";
import { SelectField, TextAreaField, TextField } from "../../components/fields";
import type {
  Bench,
  BenchInspectionCategory,
  BenchInspectionImpact,
  BenchMaintenanceAction,
} from "../../domain/types";
import {
  BENCH_IMPACT_LABELS,
  BENCH_INSPECTION_CATEGORIES,
  BENCH_MAINTENANCE_ACTIONS,
  BENCH_STATUS_LABELS,
  createBenchInspection,
} from "../../domain/benchInspection";
import type { FieldError } from "../../domain/result";
import { todayDateOnly } from "../../domain/rules";
import { useWorkspace } from "../../state/store";

interface InspectionFormProps {
  bench: Bench;
  onCancel: () => void;
  onSaved: () => void;
}

export function InspectionForm({
  bench,
  onCancel,
  onSaved,
}: InspectionFormProps) {
  const { state, dispatch } = useWorkspace();
  const [inspectedOn, setInspectedOn] = useState(todayDateOnly());
  const [inspector, setInspector] = useState("");
  const [category, setCategory] =
    useState<BenchInspectionCategory>("cleanliness");
  const [result, setResult] = useState<"normal" | "issue">("issue");
  const [anomalyDescription, setAnomalyDescription] = useState("");
  const [impact, setImpact] = useState<BenchInspectionImpact>("caution");
  const [handlingSuggestion, setHandlingSuggestion] = useState("");
  const [maintenanceAction, setMaintenanceAction] =
    useState<BenchMaintenanceAction>("cleaning");
  const [errors, setErrors] = useState<FieldError[]>([]);

  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  const handleSubmit = () => {
    const created = createBenchInspection(
      {
        benchId: bench.id,
        inspectedOn,
        inspector,
        category,
        result,
        anomalyDescription,
        impact,
        handlingSuggestion,
        maintenanceAction,
      },
      bench,
    );
    if (!created.ok) {
      setErrors(created.errors);
      return;
    }
    dispatch({ type: "benchInspection/recorded", inspection: created.value });
    onSaved();
  };

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="inspection-form"
    >
      <div className="lifecycle-callout">
        <strong>
          {bench.code} · {bench.sector}
        </strong>
        <span>
          当前台架状态为
          {BENCH_STATUS_LABELS[bench.status]}
          ，占用 {bench.assignedIds.length}/{bench.capacity}。巡检记录会保留该状态快照，且不会改动台架状态或已有分配。
        </span>
      </div>
      <div className="form-grid">
        <TextField
          label="巡检日期"
          type="date"
          value={inspectedOn}
          onChange={(event) => setInspectedOn(event.target.value)}
          error={errorFor("inspectedOn")}
          data-testid="inspection-date"
        />
        <TextField
          label="巡检人"
          value={inspector}
          onChange={(event) => setInspector(event.target.value)}
          error={errorFor("inspector")}
          placeholder="至少 2 个字符"
          data-testid="inspection-inspector"
        />
        <SelectField
          label="巡检项目"
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as BenchInspectionCategory)
          }
          error={errorFor("category")}
          data-testid="inspection-category"
        >
          {BENCH_INSPECTION_CATEGORIES.map((item) => (
            <option value={item.value} key={item.value}>
              {item.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="巡检结果"
          value={result}
          onChange={(event) =>
            setResult(event.target.value as "normal" | "issue")
          }
          error={errorFor("result")}
          data-testid="inspection-result"
        >
          <option value="issue">发现异常</option>
          <option value="normal">一切正常</option>
        </SelectField>
        {result === "issue" ? (
          <>
            <SelectField
              label="是否影响使用"
              value={impact}
              onChange={(event) =>
                setImpact(event.target.value as BenchInspectionImpact)
              }
              error={errorFor("impact")}
              hint="影响使用会阻止新材料分配并进入放行阻止项；需留意仅提示不阻止"
              data-testid="inspection-impact"
            >
              <option value="caution">{BENCH_IMPACT_LABELS.caution}</option>
              <option value="blocking">{BENCH_IMPACT_LABELS.blocking}</option>
              <option value="none">{BENCH_IMPACT_LABELS.none}</option>
            </SelectField>
            <SelectField
              label="后续维护动作"
              value={maintenanceAction}
              onChange={(event) =>
                setMaintenanceAction(event.target.value as BenchMaintenanceAction)
              }
              error={errorFor("maintenanceAction")}
              data-testid="inspection-maintenance"
            >
              {BENCH_MAINTENANCE_ACTIONS.map((item) => (
                <option value={item.value} key={item.value}>
                  {item.label}
                </option>
              ))}
            </SelectField>
            <TextAreaField
              label="异常描述"
              value={anomalyDescription}
              onChange={(event) => setAnomalyDescription(event.target.value)}
              error={errorFor("anomalyDescription")}
              className="field-span-2"
              rows={3}
              placeholder="描述看到的清洁、设备、光照或环境问题"
              data-testid="inspection-anomaly"
            />
            <TextAreaField
              label="处置建议"
              value={handlingSuggestion}
              onChange={(event) =>
                setHandlingSuggestion(event.target.value)
              }
              error={errorFor("handlingSuggestion")}
              className="field-span-2"
              rows={3}
              placeholder="建议的处置方式、责任人和复检要求"
              data-testid="inspection-suggestion"
            />
          </>
        ) : (
          <SelectField
            label="后续维护动作"
            value={maintenanceAction}
            onChange={(event) =>
              setMaintenanceAction(event.target.value as BenchMaintenanceAction)
            }
            error={errorFor("maintenanceAction")}
            className="field-span-2"
            data-testid="inspection-maintenance"
          >
            {BENCH_MAINTENANCE_ACTIONS.map((item) => (
              <option value={item.value} key={item.value}>
                {item.label}
              </option>
            ))}
          </SelectField>
        )}
      </div>
      <div className="editor-actions">
        <Button tone="secondary" type="button" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="save-inspection-button">
          保存巡检记录
        </Button>
      </div>
    </form>
  );
}
