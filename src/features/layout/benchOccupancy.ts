import type { Accession, Bench } from "../../domain/types";

export interface BenchOccupancy {
  assigned: Accession[];
  freeSlots: number;
  tone: "positive" | "warning" | "critical";
}

export function benchOccupancy(
  bench: Bench,
  accessions: Accession[],
): BenchOccupancy {
  const assigned = accessions.filter((accession) =>
    bench.assignedIds.includes(accession.id),
  );
  const freeSlots = Math.max(0, bench.capacity - assigned.length);
  return {
    assigned,
    freeSlots,
    tone:
      freeSlots === 0 ? "critical" : freeSlots === 1 ? "warning" : "positive",
  };
}

export function sortBenchesByCode(benches: Bench[]): Bench[] {
  return [...benches].sort((left, right) => left.code.localeCompare(right.code));
}
