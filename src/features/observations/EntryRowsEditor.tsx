import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { SelectField, TextField } from "../../components/fields";
import type { FieldError } from "../../domain/result";
import type { Accession, ObservationEntry } from "../../domain/types";

interface EntryRowsEditorProps {
  entries: ObservationEntry[];
  accessions: Accession[];
  errors: FieldError[];
  onChange: (entries: ObservationEntry[]) => void;
}

export function emptyObservationEntry(accessionId = ""): ObservationEntry {
  return {
    accessionId,
    heightMm: 80,
    leafCount: 8,
    ecMs: 1.8,
    notes: "",
  };
}

export function EntryRowsEditor({
  entries,
  accessions,
  errors,
  onChange,
}: EntryRowsEditorProps) {
  const errorFor = (field: string): string | undefined => {
    return errors.find((error) => error.field === field)?.message;
  };

  const updateEntry = (
    index: number,
    key: keyof ObservationEntry,
    value: string | number,
  ) => {
    onChange(
      entries.map((entry, entryIndex) =>
        entryIndex === index
          ? { ...entry, [key]: key === "accessionId" || key === "notes" ? value : Number(value) }
          : entry,
      ),
    );
  };

  const addEntry = () => {
    onChange([...entries, emptyObservationEntry(accessions[0]?.id ?? "")]);
  };

  const removeEntry = (index: number) => {
    onChange(entries.filter((_, entryIndex) => entryIndex !== index));
  };

  return (
    <div className="entry-editor">
      <div className="entry-editor-heading">
        <h3>测量记录</h3>
        <Button tone="secondary" size="sm" onClick={addEntry} type="button">
          <Plus size={15} />
          添加行
        </Button>
      </div>
      {entries.map((entry, index) => (
        <div className="entry-row" key={`${index}-${entry.accessionId}`}>
          <SelectField
            label="材料"
            value={entry.accessionId}
            onChange={(event) =>
              updateEntry(index, "accessionId", event.target.value)
            }
            error={errorFor(`entries.${index}.accessionId`)}
          >
            <option value="">请选择材料</option>
            {accessions.map((accession) => (
              <option value={accession.id} key={accession.id}>
                {accession.accessionNo} - {accession.cultivar}
              </option>
            ))}
          </SelectField>
          <TextField
            label="株高（毫米）"
            type="number"
            value={entry.heightMm}
            onChange={(event) =>
              updateEntry(index, "heightMm", event.target.value)
            }
            error={errorFor(`entries.${index}.heightMm`)}
          />
          <TextField
            label="叶片数"
            type="number"
            value={entry.leafCount}
            onChange={(event) =>
              updateEntry(index, "leafCount", event.target.value)
            }
            error={errorFor(`entries.${index}.leafCount`)}
          />
          <TextField
            label="电导率 mS/cm"
            type="number"
            step="0.1"
            value={entry.ecMs}
            onChange={(event) =>
              updateEntry(index, "ecMs", event.target.value)
            }
            error={errorFor(`entries.${index}.ecMs`)}
          />
          <TextField
            label="备注"
            value={entry.notes}
            onChange={(event) =>
              updateEntry(index, "notes", event.target.value)
            }
          />
          <Button
            tone="ghost"
            size="sm"
            className="icon-button entry-remove"
            onClick={() => removeEntry(index)}
            disabled={entries.length === 1}
            aria-label={`移除第 ${index + 1} 行`}
            type="button"
          >
            <Trash2 size={16} />
          </Button>
        </div>
      ))}
      {errorFor("entries") ? (
        <p className="form-level-error">{errorFor("entries")}</p>
      ) : null}
    </div>
  );
}
