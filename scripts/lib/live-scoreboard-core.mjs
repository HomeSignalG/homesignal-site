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

/**
 * An entry can be INCOMPLETE and yet impossible to complete. Rule 5 (free-text type field),
 * Rule 6 (null-dominant column) and opaque codes with no citable meaning are all terminal: the
 * vocabulary does not exist to be mapped. Such an entry is marked `vocab_terminal: "<reason>"`
 * on the registry row and then EXCLUDED from the ranked work list — it stays INCOMPLETE for Live
 * purposes, because its pins really are unclassified, but it must never sit at the top of the
 * queue absorbing attention that cannot resolve it.
 */
export const terminalReason = (e) => e?.vocab_terminal || null;

/** LIST 1 — ranked additive registry work. WIRED_INCOMPLETE only. Never contains NOT_WIRED. */
export function rankRegistryWork(entries, zips) {
  const out = [];
  for (const e of entries) {
    if (isFloorSource(e.registry_id)) continue;
    const { complete, missing } = entryCompleteness(e);
    if (complete) continue;
    if (terminalReason(e)) continue;                 // cannot be completed — never rank it
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
 *   Douglas CO (684 rows, 200 OK) — quarterly AGGREGATE table, periods not permits
 *
 * Three sources, three DIFFERENT disqualifiers, none visible from "a first-party source exists".
 * That is why this list carries blockers rather than ranking on page count.
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
      // Aggregate-by-design: a real, live, first-party "permits" dataset that publishes PERIODS
      // rather than permits. Douglas County CO's Building_Permits FeatureServer is 684 rows of
      // Geography x Year x Quarter with unit counts and dollar values -- no permit number, no
      // address, no status, no geometry. Nothing to pin, classify or link.
      if (r.aggregate_only) blockers.push('AGGREGATE_NOT_PER_RECORD (periods, not permits)');
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

/**
 * LIST 2 (generated half) — uncovered COUNTIES ranked by ZIP pages, per state.
 *
 * This is the real shape of the goal. The statewide path is exhausted: every statewide non-EPA
 * source for a non-Live state is unusable (NJ no geography, DE stale to 2024, WI needs a
 * connector, NH/VA/NC are environmental permits). TX/UT/NV each reached Live via a statewide
 * source and there are no more.
 *
 * Per-county is cheap because pages are modelled top-10-counties-per-state, so coverage
 * concentrates: 46 of 47 non-Live states need TEN OR FEWER counties. Ranking largest-first per
 * state turns "make a state Live" into a short, ordered list of metro counties — the ones most
 * likely to publish Socrata/ArcGIS open data.
 *
 * `to_reach_90` is the honest target: how many MORE pages that state needs, not how many are
 * missing in total. Stop adding counties once it crosses the threshold.
 */
export function rankUncoveredCounties(entries, zips, { threshold = LIVE_THRESHOLD } = {}) {
  const wired = entries.filter((e) => !isFloorSource(e.registry_id));
  const complete = wired.filter((e) => entryCompleteness(e).complete);
  const covered = (z) => complete.some((e) => coversZip(e, z));

  const perState = new Map();
  for (const z of zips) {
    const s = perState.get(z.state) || { total: 0, done: 0, counties: new Map() };
    s.total++;
    if (covered(z)) s.done++;
    else {
      const key = z.county || '(unknown county)';
      s.counties.set(key, (s.counties.get(key) || 0) + 1);
    }
    perState.set(z.state, s);
  }

  const out = [];
  for (const [state, s] of perState) {
    if (s.total && s.done / s.total >= threshold) continue;          // already Live
    const need = Math.max(0, Math.ceil(s.total * threshold) - s.done);
    const ranked = [...s.counties.entries()]
      .map(([county, zip_pages]) => ({ county, zip_pages }))
      .sort((a, b) => b.zip_pages - a.zip_pages || a.county.localeCompare(b.county));

    // How many counties, largest-first, actually clear the bar.
    let acc = 0, counties_needed = 0;
    for (const c of ranked) { if (acc >= need) break; acc += c.zip_pages; counties_needed++; }

    out.push({
      state,
      zip_pages: s.total,
      covered_complete: s.done,
      pct_complete: s.total ? s.done / s.total : 0,
      to_reach_90: need,
      counties_needed,
      counties: ranked,
    });
  }
  // Cheapest conversions first — fewest counties, then fewest pages needed.
  return out.sort((a, b) => a.counties_needed - b.counties_needed || a.to_reach_90 - b.to_reach_90);
}

/** Terminal entries, reported separately so "not in the work list" never reads as "done". */
export function listTerminal(entries) {
  return entries
    .filter((e) => !isFloorSource(e.registry_id) && terminalReason(e) && !entryCompleteness(e).complete)
    .map((e) => ({ registry_id: e.registry_id, platform: e.platform || null, reason: terminalReason(e) }));
}
