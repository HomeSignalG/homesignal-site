// yields_to — same-report cross-entry overlap resolution (founder-approved 2026-08-18).
//
// WHY THIS EXISTS. Some publishers expose the SAME project in two sibling layers under one
// job identifier — ARDOT's Job Status service carries a job's point site in layer 2 AND its
// corridor segment in layer 3 (60 of 2,243 jobs at wire time). Exact-identity dedup
// (dedupeExactPermits) can NEVER collapse those rows: its key includes lat|lng and
// source_registry_id, which differ by construction across two entries. Without this hook a
// dual-representation job renders as two pins.
//
// THE CONTRACT, precisely:
//   • A registry entry may declare `yields_to: "<registry_id>"`. Its records then drop ONLY
//     when the yielded-to entry emitted a record with the SAME case_number in the SAME report
//     assembly. The match key is case_number (ARDOT: Job_No), string-compared after trim.
//   • SAME-REPORT ONLY — the yield set is built from the rows passed to this one assembly,
//     never from cache, a stored list, or a prior refresh. No id list exists anywhere
//     (the Nebraska rule): the resolution recomputes from live data on every refresh and
//     self-corrects as the publisher moves jobs between layers.
//   • FAILURE PROPERTY (load-bearing, test-pinned): if the yielded-to entry's fetch failed
//     or returned nothing this cycle, there are NO yielded-to records in the assembly, the
//     yield set for that target is empty, and every yielding record SURVIVES. A Lines outage
//     therefore degrades to dual-source absence — residents temporarily lose the Lines
//     records that failed to fetch — and never to silent point-job loss on top of it.
//   • A record with no case_number never yields (nothing to match on — absence stays honest).
//   • Entries without `yields_to` are untouched; with zero declarations the hook is a
//     structural no-op (returns the input array unchanged).
//
// Runs BEFORE dedupeExactPermits in index.ts — order matters only for clarity (the two
// filters commute), but yielding first keeps the dedup pass over the final population.

export interface YieldsRegistryShape {
  [platform: string]: unknown;
}

/** registry_id -> yields_to registry_id, scanned across every platform list. */
export function buildYieldsMap(registry: YieldsRegistryShape): Map<string, string> {
  const out = new Map<string, string>();
  for (const v of Object.values(registry)) {
    if (!Array.isArray(v)) continue;
    for (const e of v) {
      const entry = e as { registry_id?: string; yields_to?: string };
      if (entry && typeof entry.registry_id === "string" && typeof entry.yields_to === "string" && entry.yields_to) {
        out.set(entry.registry_id, entry.yields_to);
      }
    }
  }
  return out;
}

/** Drop each yielding record whose case_number the yielded-to entry also emitted THIS report. */
export function applyYields(
  rows: Record<string, unknown>[],
  yields: Map<string, string>,
): Record<string, unknown>[] {
  if (yields.size === 0) return rows;
  // case_numbers emitted per target entry, from THIS assembly's rows only.
  const emitted = new Map<string, Set<string>>();
  for (const target of yields.values()) if (!emitted.has(target)) emitted.set(target, new Set());
  for (const s of rows) {
    const src = typeof s.source_registry_id === "string" ? s.source_registry_id : null;
    if (!src || !emitted.has(src)) continue;
    const cn = s.case_number == null ? "" : String(s.case_number).trim();
    if (cn) emitted.get(src)!.add(cn);
  }
  return rows.filter((s) => {
    const src = typeof s.source_registry_id === "string" ? s.source_registry_id : null;
    const target = src ? yields.get(src) : undefined;
    if (!target) return true;                                  // entry does not yield — untouched
    const cn = s.case_number == null ? "" : String(s.case_number).trim();
    if (!cn) return true;                                      // no key to match on — survives
    const set = emitted.get(target);
    return !(set && set.has(cn));                              // empty/absent target set ⇒ survives
  });
}
