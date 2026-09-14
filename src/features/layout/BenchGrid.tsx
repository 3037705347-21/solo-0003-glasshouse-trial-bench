import { useMemo } from "react";
import { Grid3X3 } from "lucide-react";
import type { Accession, Bench } from "../../domain/types";
import { BenchCard } from "./BenchCard";
import { sortBenchesByCode } from "./benchOccupancy";

interface BenchGridProps {
  benches: Bench[];
  accessions: Accession[];
  selectedAccession?: Accession;
  onAssign: (accessionId: string, benchId: string) => void;
  onRelease: (accessionId: string, benchId: string) => void;
}

export function BenchGrid({
  benches,
  accessions,
  selectedAccession,
  onAssign,
  onRelease,
}: BenchGridProps) {
  const sortedBenches = useMemo(() => sortBenchesByCode(benches), [benches]);

  return (
    <section className="bench-grid" aria-label="台架网格">
      <div className="bench-grid-heading">
        <Grid3X3 size={18} aria-hidden="true" />
        <h2>台架</h2>
        <span>共 {benches.length} 个</span>
      </div>
      <div className="bench-grid-list">
        {sortedBenches.map((bench) => (
          <BenchCard
            key={bench.id}
            bench={bench}
            accessions={accessions}
            selectedAccession={selectedAccession}
            onAssign={onAssign}
            onRelease={onRelease}
          />
        ))}
      </div>
    </section>
  );
}
