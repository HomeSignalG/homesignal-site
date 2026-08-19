// Pure helpers for the TYPE-domain drift check (scripts/source-monitor.mjs, Phase 3.6).
// Extracted for the same reason as status-drift.mjs: source-monitor.mjs runs its whole nightly
// pass (network included) at import time, so its internals cannot be unit-tested in place.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────
// The status check's own header called an unmapped status "the one soft-fail that DROPS a
// record". That was true when written and is FALSE now — and a stale comment asserting
// exclusivity is how this stayed invisible. `include_types` drops records too, and harder:
//
//   status_to_bucket miss → the connector FETCHES the row, then excludes it (visible in the
//                           run report as an unmapped status).
//   type_map miss        → the connector FETCHES the row and emits use_type 'unclassified'
//                           (visible on the page, and now NAMED by `type_raw`).
//   include_types miss   → the whitelist is pushed down INTO THE QUERY. The row is never
//                           fetched, never counted, never quarantined. The only symptom is a
//                           number that fails to grow.
//
// The case that proves it is not theoretical: Cleveland's `Install Permits` first appeared
// 2026-03-18 — AFTER the entry was wired — and was silently dropped for five months. Nothing
// reported it; it surfaced only because a human asked for a re-enumeration.
//
// ── WHY A BASELINE IS STRUCTURALLY REQUIRED (not a softening) ────────────────────────────
// Most whitelists deliberately exclude noise. Measured live 2026-08-19 in each connector's own
// scope: San Diego keeps 10 of 151 type|status combos, SLO 49 of 83 live values, Aurora 50 of
// 60, Columbus 5 of 7. A literal "any unlisted value gates" fires on 80 values on night one —
// almost all of them deliberate (Roofing, MEP, Plumbing, Electrical, Sign, Zoning Clearance,
// Research, Code Enforcement). That is the over-flagging the founder's own requirement forbids,
// and a false alarm every night is how a real one gets ignored later.
//
// So the gate fires on a value in NEITHER `include_types` NOR `observed_types_unreviewed`.
//
// ⚠️ `observed_types_unreviewed` MEANS "OBSERVED AT BASELINE AND NOT FETCHED". It does NOT mean
// reviewed, and it does NOT mean approved. It is a snapshot of what the publisher was already
// emitting when the gate was armed, recorded so the gate can fire on what appears LATER. The
// name carries "unreviewed" precisely so a future session reading it cold cannot mistake it for
// a blessing. Nothing in this file, and nothing in the report, asserts those values are correct
// to exclude — that review is a separate human pass.

/** The ONE type_source column, or null when type_source is absent or a multi-column array.
 *
 *  RESTATED from sources/arcgis.ts::soleTypeCol (also socrata.ts) rather than imported: the
 *  nightly workflow pins Node 20, which has no TypeScript type stripping, so the monitor
 *  cannot import a .ts connector at all. test/type-domain-drift.test.mjs asserts this
 *  restatement against the SHIPPED connector's exported version on a runtime that can — the
 *  same restate-and-prove pattern gate2's lifecycle buckets use. Borrowing the implementation
 *  would make the check tautological; borrowing nothing would let it drift. */
export function soleTypeCol(entry) {
  const ts = entry?.column_map?.type_source;
  if (!ts) return null;
  if (Array.isArray(ts)) return ts.length === 1 ? String(ts[0]) : null;
  return String(ts);
}

/** Does this entry participate in the type-domain check at all? */
export function typeDriftApplies(entry) {
  return !!(entry && Array.isArray(entry.include_types) && entry.include_types.length
            && soleTypeCol(entry));
}

/** BASELINE NOT ESTABLISHED is a THIRD state, distinct from "clean" and from "drifting".
 *  An ABSENT `observed_types_unreviewed` means nobody has ever enumerated this entry's live
 *  vocabulary, so its silence attests to nothing. An EMPTY ARRAY is the opposite: a positive
 *  statement that the entry WAS enumerated and emits nothing outside its whitelist. The
 *  distinction is load-bearing and must never be collapsed to a falsy check. */
export function hasBaseline(entry) {
  return Array.isArray(entry?.observed_types_unreviewed);
}

/** Everything this entry is known to emit: what it fetches, plus what it was already emitting
 *  and not fetching when the gate was armed.
 *
 *  ⚠️ ASYMMETRIC ON PURPOSE, because the connector is. `includeTypesClause` builds
 *  `col IN ('a','b')` from `String(v).trim()` — so the CONFIG side is trimmed — while the live
 *  side is the raw column, compared by the database with NO trim and NO case folding. A padded
 *  publisher value therefore genuinely does not match a clean whitelist entry, and trimming it
 *  here would hide a real drop. Measured: SLO emits `Renewable Energy ` (trailing space, 3,386
 *  rows in window) while the entry declares `Renewable Energy` — those rows are not fetched. */
export function knownTypeSet(entry) {
  const s = new Set();
  for (const t of (entry?.include_types || [])) s.add(String(t).trim());
  for (const t of (entry?.observed_types_unreviewed || [])) s.add(String(t));
  return s;
}

/**
 * Classify one entry's LIVE type vocabulary against its config.
 *
 * @param live  [{value, n}] read in the entry's OWN scope (same extra_where, same recency
 *              window, include_types deliberately NOT applied — Rule 13).
 * @param inWindow  false for the out-of-window half, which is reported but never gated: the
 *              connector cannot fetch those rows today, so failing on them would red the run
 *              nightly for history. Mirrors the status check's tiering exactly.
 * @returns {{gating, latent, listedNotLive, baselineHits}}
 *   gating        — in NEITHER list, in-window. THE GATE. These rows are being dropped now.
 *   latent        — same, but out-of-window. Non-failing.
 *   listedNotLive — declared in include_types but matching ZERO live rows. Non-failing, and its
 *                   own tier: Cleveland's `Building` sat in include_types AND type_map matching
 *                   0 rows all-time, which is exactly why a stale four-value enumeration read as
 *                   confirmed. Measured across the fleet the same day: 13 more such values.
 *   baselineHits  — matched the unreviewed baseline. Reported once so the list is reviewable,
 *                   never gated.
 */
export function classifyTypeValues(entry, live, inWindow = true) {
  // Config side trimmed, live side VERBATIM — see knownTypeSet. Getting this wrong in the
  // lenient direction is not a harmless nicety: it silently forgives exactly the padded values
  // the database is refusing to match.
  const included = new Set((entry?.include_types || []).map((t) => String(t).trim()));
  const baseline = new Set((entry?.observed_types_unreviewed || []).map((t) => String(t)));
  const gating = [], latent = [], baselineHits = [];
  const seen = new Set();
  for (const row of (live || [])) {
    if (row?.value == null || String(row.value).trim() === '') continue;  // blank ⇒ not a type
    const val = String(row.value);
    seen.add(val);
    if (included.has(val)) continue;
    if (baseline.has(val)) { baselineHits.push({ value: val, n: row.n }); continue; }
    (inWindow ? gating : latent).push({ value: val, n: row.n });
  }
  gating.sort((a, b) => (b.n || 0) - (a.n || 0));
  latent.sort((a, b) => (b.n || 0) - (a.n || 0));
  const listedNotLive = inWindow
    ? [...included].filter((t) => !seen.has(t)).sort()
    : [];
  return { gating, latent, listedNotLive, baselineHits };
}

/** Every whitelisted value must carry a type_map line (or a use_type_const). A value that is
 *  FETCHED and then has no mapping emits use_type 'unclassified' — config that looks complete
 *  and quietly produces unclassified pins. This is the OPPOSITE failure to the one above and
 *  the reason it is checked here rather than left to a manual sweep: it held across all 10
 *  entries on 2026-08-19 (0 gaps), and an invariant only stays true if something asserts it. */
export function whitelistMappingGaps(entries) {
  const out = [];
  for (const e of (entries || [])) {
    if (!Array.isArray(e?.include_types) || e.use_type_const) continue;
    const tm = e.type_map || {};
    const missing = e.include_types.map((t) => String(t).trim()).filter((t) => !tm[t]);
    if (missing.length) out.push({ registry_id: e.registry_id, missing });
  }
  return out;
}
