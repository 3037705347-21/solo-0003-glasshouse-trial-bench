import { Dialog } from "../../components/Dialog";
import type { AttachmentSubjectKind } from "../../domain/types";
import { AttachmentPanel } from "./AttachmentPanel";

interface AttachmentDialogProps {
  subjectKind: AttachmentSubjectKind;
  subjectId: string;
  subjectLabel: string;
  onClose: () => void;
}

export function AttachmentDialog({
  subjectKind,
  subjectId,
  subjectLabel,
  onClose,
}: AttachmentDialogProps) {
  return (
    <Dialog open title={`附件 · ${subjectLabel}`} onClose={onClose} wide>
      <div data-testid="attachment-dialog">
        <AttachmentPanel
          subjectKind={subjectKind}
          subjectId={subjectId}
          subjectLabel={subjectLabel}
        />
      </div>
    </Dialog>
  );
}
