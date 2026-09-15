import { Dialog } from "../../components/Dialog";
import type { Accession } from "../../domain/types";
import type { ReadinessVerdict } from "../../domain/readiness";
import { ReadinessVerdictList } from "./ReadinessVerdictList";

interface ReadinessDialogProps {
  accession: Accession;
  verdicts: ReadinessVerdict[];
  onClose: () => void;
}

/** 单个材料的完整准备度判定弹窗：每个动作的结论与依据。 */
export function ReadinessDialog({
  accession,
  verdicts,
  onClose,
}: ReadinessDialogProps) {
  return (
    <Dialog
      open
      title={`准备度 · ${accession.accessionNo} ${accession.cultivar}`}
      onClose={onClose}
      wide
    >
      <div data-testid="readiness-dialog">
        <p className="readiness-dialog-intro">
          同一材料在不同动作下的结论可能不同，以下按当前数据实时推导。
        </p>
        <ReadinessVerdictList verdicts={verdicts} />
      </div>
    </Dialog>
  );
}
