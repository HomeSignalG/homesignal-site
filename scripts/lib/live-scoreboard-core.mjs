// live-scoreboard-core.mjs — the pure, testable half of the Live scoreboard.
//
// METRIC, from the workbook Instructions row 272, verbatim:
//   "States where 90%+ of ZIPs have at least one development source with COMPLETE type_map AND
//    status_to_bucket. EPA-FRS is tracked but does NOT count toward Live."
//
// Row 264: type_map assigns the pin ICON, status_to_bucket assigns the pin COLOR. An entry
// missing either renders pins that are wrong rather than absent, which is why BOTH are required
// and why "has a source" is not the same question as "is Live".
//
// THREE states per entry, never two. The two-state reading (complete / needs completing) is what
// made blank workbook research rows look like ranked work:
//   WIRED_COMPLETE   — counts toward Live
//   WIRED_INCOMPLETE — ranked as additive registry work (the Arlington / UDOT case)
//   NOT_WIRED        — ranked SEPARATELY as discovery/wire work
//
// Emit the two lists separately. A NOT_WIRED row must never be able to appear in the ranked
// registry-work list, because "Needs Connector" is a new connector family (a founder gate) and
// not a quick win.

export const LIVE_THRESHOLD = 0.9;

/** EPA-FRS is the national facilities floor. Tracked, but never evidence of Live. */
export const FLOOR_SOURCE_IDS = new Set(['epa-frs', 'EPA-FRS', 'epa_frs']);
export const isFloorSource = (id) => FLOOR_SOURCE_IDS.has(String(id || '').trim());

const nonEmptyMap = (m) => !!m && typeof m === 'object' && !Array.isArray(m) &&
  Object.values(m).some((v) => Array.isArray(v) ? v.length > 0 : v != null && v !== '');

/**
 * Vocabulary completeness for a WIRED registry entry.
 * `status_const` satisfies the colour requirement by design: the bucket is assigned in code
 * because the publisher has no status column (the Detroit precedent). That is COMPLETE, not
 * missing — treating it as missing would rank correctly-wired issuance ledgers as broken.
 */
export function entryCompleteness(entry) {
  const missing = [];
  const hasStatus = nonEmptyMap(entry?.status_to_bucket) || !!entry?.status_const;
  const hasType = nonEmptyMap(entry?.type_map) || !!entry?.use_type_const;
  if (!hasStatus) missing.push('status_to_bucket');   // pin COLOR
  if (!hasType) missing.push('type_map');             // pin ICON
  return { complete: missing.length === 0, missing };
}

/** Normalise a coverage array into {state, county|null} pairs. A statewide entry has no county. */
export function coveragePairs(entry) {
  return (entry?.coverage || [])
    .filter((c) => c && c.state)
    .map((c) => ({ state: String(c.state).trim(), county: c.county ? String(c.county).trim() : null }));
}

export function coversZip(entry, zip) {
  return coveragePairs(entry).some((c) =>
    c.state === zip.state && (c.county === null || c.county === zip.county));
}

/**
 * Per-state Live status.
 * zips: [{zip, state, county}] — the state's modelled ZIP PAGES, which is the denominator row
 * 272 specifies. Not cached rows, not records: pages.
 */
export function scoreStates(entries, zips) {
  const wired = entries.filter((e) => !isFloorSource(e.registry_id));
  const complete = wired.filter((e) => entryCompleteness(e).complete);
  const byState = new Map();

  for (const z of zips) {
    const s = byState.get(z.state) || { state: z.state, zip_pages: 0, covered_complete: 0, covered_any: 0 };
    s.zip_pages++;
    if (complete.some((e) => coversZip(e, z))) s.covered_complete++;
    if (wired.some((e) => coversZip(e, z))) s.covered_any++;
    byState.set(z.state, s);
  }

  return [...byState.values()].map((s) => {
    const pct = s.zip_pages ? s.covered_complete / s.zip_pages : 0;
    return {
      ...s,
      pct_complete: pct,
      // The gap that INCOMPLETE vocabularies alone account for — i.e. how many pages a pure
      // additive registry fix would convert, with no discovery at all.
      convertible_by_completion: s.covered_any - s.covered_complete,
      live: pct >= LIVE_THRESHOLD,
    };
  }).sort((a, b) => b.pct_complete - a.pct_complete || b.zip_pages - a.zip_pages);
}

/** LIST 1 — ranked additive registry work. WIRED_INCOMPLETE only. Never contains NOT_WIRED. */
export function rankRegistryWork(entries, zips) {
  const out = [];
  for (const e of entries) {
    if (isFloorSource(e.registry_id)) continue;
    const { complete, missing } = entryCompleteness(e);
    if (complete) continue;
    const pages = zips.filter((z) => coversZip(e, z)).length;
    out.push({
      state: 'WIRED_INCOMPLETE',
      registry_id: e.registry_id,
      platform: e.platform || null,
      missing,
      zip_pages_affected: pages,
      coverage: coveragePairs(e),
    });
  }
  return out.sort((a, b) => b.zip_pages_affected - a.zip_pages_affected);
}

/**
 * LIST 2 — ranked discovery/wire work. NOT_WIRED research rows, kept strictly separate.
 *
 * `blockers` is the whole point of this list existing. A research row can be live, first-party
 * and still unwireable, and ranking it by page count alone reproduces the exact mistake this
 * scoreboard was rebuilt to prevent. Measured cases, all 2026-07-30:
 *   NJ DCA (2,755,796 rows, 200 OK) — no ZIP, no lat/lng, no address ⇒ cannot be scoped at all
 *   DE FirstMap (79,000 rows, point geometry) — newest P_YEAR 2024, nothing in 2025/26 ⇒ stale
 *   WI DSPS — research status "Needs Connector" ⇒ new connector family, a founder gate
 */
export function rankDiscoveryWork(researchRows, zips, wiredIds = new Set()) {
  return researchRows
    .filter((r) => !wiredIds.has(r.registry_id))
    .map((r) => {
      const pages = zips.filter((z) => coversZip(r, z)).length;
      const blockers = [];
      if (r.research_status && /needs connector/i.test(r.research_status)) blockers.push('NEW_CONNECTOR_FAMILY (founder gate)');
      if (r.has_geography === false) blockers.push('NO_GEOGRAPHY (no ZIP, point or address)');
      if (r.stale_since) blockers.push(`STALE (newest ${r.stale_since})`);
      if (r.reserved) blockers.push(`RESERVED (${r.reserved})`);
      return {
        state: 'NOT_WIRED',
        registry_id: r.registry_id,
        platform: r.platform || null,
        research_status: r.research_status || null,
        zip_pages_potential: pages,
        blockers,
        ready: blockers.length === 0,
        coverage: coveragePairs(r),
      };
    })
    // Ready work first; blocked rows still listed, but never above something actionable.
    .sort((a, b) => (b.ready - a.ready) || (b.zip_pages_potential - a.zip_pages_potential));
}
