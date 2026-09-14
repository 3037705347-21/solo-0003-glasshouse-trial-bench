import type { Accession, Bench } from "../../domain/types";
import { canAssignAccession } from "../../domain/bench";

export function isBenchAssignable(
  bench: Bench,
  accession: Accession | undefined,
): boolean {
  return Boolean(accession && canAssignAccession(accession, bench));
}

export function compatibleBenchesFor(
  benches: Bench[],
  accession: Accession | undefined,
): Bench[] {
  if (!accession) {
    return [];
  }
  return benches.filter((bench) => canAssignAccession(accession, bench));
}
