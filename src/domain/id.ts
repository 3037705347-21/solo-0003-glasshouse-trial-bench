const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createId(prefix: string): string {
  const random = Array.from({ length: 10 }, () =>
    alphabet.charAt(Math.floor(Math.random() * alphabet.length)),
  ).join("");
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function createAccessionNumber(sequence: number): string {
  return `ACC-${String(sequence).padStart(4, "0")}`;
}
