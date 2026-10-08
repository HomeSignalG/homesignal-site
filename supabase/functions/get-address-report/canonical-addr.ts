// canonical-addr.ts — THE ONE canonical-address normalizer, extracted verbatim from index.ts
// (2026-09-24) so a second consumer (the data-centre derived-location batch,
// scripts/dc-geocode-observations.ts) can key public.geocodes exactly as the report engine
// does. Moving it created no second normalizer: index.ts imports this function, and
// test/canonical-addr-single-source.test.mjs fails if another definition appears.

// ── v17: the ONE canonical-address normalizer (case-study §4.3) ────────────────────────
// Deterministic string normalization of a FILED street address, so records filed with
// suffix/spelling variants ("2200 Caldwell Lane" vs "2200 Caldwell Ln") and the Census
// matchedAddress form ("…, TX, 78617") all collapse to one property_reports key. The page
// never normalizes — it links with the engine-stamped canonical_addr.
export function canonicalAddr(a: string): string {
  return String(a).toUpperCase().replace(/\./g, "")
    .replace(/\bLANE\b/g, "LN").replace(/\bSTREET\b/g, "ST").replace(/\bDRIVE\b/g, "DR")
    .replace(/\bROAD\b/g, "RD").replace(/\bAVENUE\b/g, "AVE").replace(/\bBOULEVARD\b/g, "BLVD")
    .replace(/\bPARKWAY\b/g, "PKWY").replace(/\bHIGHWAY\b/g, "HWY").replace(/\bCOURT\b/g, "CT")
    .replace(/\bCIRCLE\b/g, "CIR").replace(/\bPLACE\b/g, "PL").replace(/\bSUITE\b/g, "STE")
    .replace(/\bTEXAS\b/g, "TX").replace(/\bUTAH\b/g, "UT")
    .replace(/\s*,\s*/g, ", ").replace(/,\s*(\d{5}(-\d{4})?)\s*$/, " $1").replace(/\s+/g, " ").trim();
}
