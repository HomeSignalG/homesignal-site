// Candidate pick for the Census oneline geocoder. Same rule as
// get-address-report/geocode-cache.ts — kept in this folder so geocode-address
// never imports the cache module (n5 zero-write gate).
// Prefer the candidate whose matched ZIP equals the trailing ZIP on the input.
// Fall back to Census's first match when the input has no ZIP or no candidate agrees.

export function trailingZip5(s: string): string | null {
  return (s || "").match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;
}

export function censusMatchZip(m: { matchedAddress?: string; addressComponents?: { zip?: string } }): string | null {
  const fromComp = String(m.addressComponents?.zip ?? "").match(/^(\d{5})/)?.[1];
  return fromComp || trailingZip5(String(m.matchedAddress ?? ""));
}

export function pickCensusMatch<T extends { matchedAddress?: string; addressComponents?: { zip?: string } }>(
  matches: T[],
  input: string,
): T | undefined {
  if (!matches.length) return undefined;
  const filed = trailingZip5(input);
  if (filed && matches.length > 1) {
    const preferred = matches.find((m) => censusMatchZip(m) === filed);
    if (preferred) return preferred;
  }
  return matches[0];
}
