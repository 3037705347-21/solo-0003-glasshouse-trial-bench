import type {
  Accession,
  Attachment,
  Bench,
  ClearanceSnapshot,
  Flag,
  ObservationPass,
  Trial,
  TrialState,
  WorkspaceState,
} from "../domain/types";

export type WorkspaceAction =
  | { type: "hydrate"; state: WorkspaceState }
  | { type: "reset"; state: WorkspaceState }
  | { type: "trial/created"; trial: Trial }
  | { type: "trial/transitioned"; trialId: string; state: TrialState }
  | { type: "accession/created"; accession: Accession }
  | { type: "accession/updated"; accession: Accession }
  | {
      type: "accession/duplicated";
      accession: Accession;
      attachments: Attachment[];
    }
  | {
      type: "accession/merged";
      accession: Accession;
      attachments: Attachment[];
    }
  | { type: "bench/assigned"; bench: Bench }
  | { type: "bench/released"; bench: Bench }
  | { type: "observation/recorded"; pass: ObservationPass; flags: Flag[] }
  | { type: "flag/transitioned"; flag: Flag }
  | { type: "attachment/added"; attachment: Attachment }
  | { type: "attachment/removed"; attachmentId: string }
  | {
      type: "clearance/generated";
      snapshot: ClearanceSnapshot;
      trials: Trial[];
    };

export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<WorkspaceState>;
  return (
    Array.isArray(candidate.trials) &&
    Array.isArray(candidate.accessions) &&
    Array.isArray(candidate.benches) &&
    Array.isArray(candidate.observationPasses) &&
    Array.isArray(candidate.flags) &&
    Array.isArray(candidate.clearanceSnapshots)
  );
}
