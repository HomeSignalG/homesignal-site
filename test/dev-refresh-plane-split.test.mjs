// PHASE 1B — the CORE project plane and the REGULATORY (EPA/FRS) plane must write
// independently. Offline: CI has no database, so this pins the SQL OF RECORD
// (docs/epa-decouple-phase1b-split-write.sql, docs/epa-decouple-phase1a-core-cron-switch.sql)
// and re-implements the write's decision semantics as a model exercised over every case
// the review required.
//
// WHY THIS FILE EXISTS. Before the split, ONE `update development_reports` wrote `sites`,
// `counts` and `refreshed_at` together while the EPA guard sat in its WHERE clause — so
// refusing the regulatory half refused the core half. Measured live 2026-09-07 during a real
// FRS outage: 51 ZIP refreshes refused in one hour, 46 holding project data, 6,532 core
// project records discarded. 90.9% of cached reports were structurally exposed.
//
// ⚠️ THE MODEL IS NOT THE PRODUCT. A truth table can only prove the RULE is right; it cannot
// prove the shipped SQL implements it. Every semantic case below is therefore paired with a
// structural assertion against the SQL of record.
//
// ⚖️ THE STRUCTURAL PINS READ EXECUTABLE STATEMENTS ONLY (review fix). The first version of
// this file regexed the whole parked document — and the parked document reproduced the
// function as a COMMENT, so the pins were asserting prose. `executable()` strips every
// comment line before any structural assertion runs, which is also why the scope checks can
// no longer be tripped by documentation that merely NAMES a Phase 2 identifier.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawB = readFileSync(join(root, 'docs/epa-decouple-phase1b-split-write.sql'), 'utf8');
const rawA = readFileSync(join(root, 'docs/epa-decouple-phase1a-core-cron-switch.sql'), 'utf8');

/** Executable SQL only: every whole-line comment removed. */
const executable = (sql) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const sqlB = executable(rawB);
const sqlA = executable(rawA);

/** The dev_refresh_collect body, as parked, comments stripped. */
function collectBody(sql) {
  const i = sql.indexOf('create or replace function public.dev_refresh_collect()');
  if (i === -1) return '';
  const seg = sql.slice(i);
  const a = seg.indexOf('$function$');
  const b = seg.indexOf('$function$', a + 10);
  return a === -1 || b === -1 ? '' : seg.slice(a + 10, b);
}
const collect = collectBody(sqlB);

const failures = [];
const ok = (name, cond) => { if (cond) console.log(`PASS — ${name}`); else { console.log(`FAIL — ${name}`); failures.push(name); } };

// ───────────────────────── the model ─────────────────────────
// Mirrors public.dev_epa_write_refused(). Fail-closed: a null epa_ok, an absent `epa` key
// and a null counts object all resolve toward preserving what is already stored.
function epaWriteRefused({ epaOk, payload, cached, cachedFreshDays }) {
  const reportEpaOk = payload.epa && payload.epa.ok !== undefined ? !!payload.epa.ok : true;
  const untrusted = !((epaOk === true) && reportEpaOk);
  const fresh = cachedFreshDays < 7;
  return (untrusted || fresh)
      && (payload.counts.facilities ?? 0) === 0
      && (cached.counts.facilities ?? 0) > 0;
}

/** jsonb_typeof(j->'sites') = 'array' — SQL NULL and JSON null both fail the test. */
function sitesIsArray(payload) {
  return Object.prototype.hasOwnProperty.call(payload, 'sites') && Array.isArray(payload.sites);
}

// Mirrors the composed write. Returns the row as it would be stored, or null when the row
// is WITHHELD (shape guard or a core guard) — in which case nothing at all is written.
function applyWrite({ epaOk, payload, cached, cachedFreshDays, coreBlocked = false, explained = false }) {
  // SHAPE GUARD — withhold a malformed payload rather than abort the batch.
  if (!sitesIsArray(payload)) return null;
  // CORE GUARD 1 — per-source fetch failure where that source already contributes.
  if (coreBlocked) return null;
  // CORE GUARD 2 — unexplained development reduction while fresh.
  if (cachedFreshDays < 7
      && (payload.counts.development ?? 0) === 0
      && (cached.counts.development ?? 0) > 0
      && !explained) return null;

  const refused = epaWriteRefused({ epaOk, payload, cached, cachedFreshDays });
  const coreSites = payload.sites.filter((s) => !(s && typeof s === 'object' && 'registry_id' in s));
  const facSites = refused
    ? cached.sites.filter((s) => s && typeof s === 'object' && 'registry_id' in s)
    : payload.sites.filter((s) => s && typeof s === 'object' && 'registry_id' in s);

  const reportEpaOk = payload.epa && payload.epa.ok !== undefined ? !!payload.epa.ok : true;
  return {
    sites: [...coreSites, ...facSites],
    counts: {
      ...payload.counts,
      facilities: refused ? (cached.counts.facilities ?? 0) : payload.counts.facilities,
    },
    refreshed_at: 'NOW',
    facilities_refreshed_at: refused ? cached.facilities_refreshed_at : 'NOW',
    // REVIEW FIX 2 — the refusal branch LEADS. If the facility plane took no trusted
    // write, the stored result is not current and must render as UNKNOWN, never as fact.
    facilities_unavailable:
      refused ? true
      : (payload.counts.facilities ?? 0) > 0 ? false
      : !((epaOk === true) && reportEpaOk) ? true
      : false,
  };
}

const proj = (id) => ({ label: `permit ${id}`, relevance: 'development', scope: 'point' });
const fac = (rid) => ({ label: `plant ${rid}`, registry_id: String(rid), scope: 'point', src: `EPA FRS · registry ${rid}` });

const cachedRow = {
  sites: [proj(1), proj(2), fac(900), fac(901), fac(902)],
  counts: { development: 2, facilities: 3 },
  facilities_refreshed_at: 'T0',
};

// ── CASE 1 — core succeeds, EPA fails: core persists ────────────────────────
{
  const out = applyWrite({
    epaOk: false,
    payload: { sites: [proj(1), proj(2), proj(3), proj(4)], counts: { development: 4, facilities: 0 }, epa: { ok: false } },
    cached: cachedRow, cachedFreshDays: 30,
  });
  ok('case 1: EPA down — the core write is NOT refused', out !== null);
  ok('case 1: core project records persist', out.sites.filter((s) => !('registry_id' in s)).length === 4);
  ok('case 1: counts.development persists', out.counts.development === 4);
  ok('case 1: core freshness advances (the ZIP does not go stale)', out.refreshed_at === 'NOW');
}

// ── CASE 2 — same case: trusted facility data preserved, never zeroed ───────
{
  const out = applyWrite({
    epaOk: false,
    payload: { sites: [proj(1), proj(2), proj(3), proj(4)], counts: { development: 4, facilities: 0 }, epa: { ok: false } },
    cached: cachedRow, cachedFreshDays: 30,
  });
  ok('case 2: stored facility SITES preserved verbatim',
     out.sites.filter((s) => 'registry_id' in s).map((s) => s.registry_id).join() === '900,901,902');
  ok('case 2: counts.facilities preserved, NOT written to zero', out.counts.facilities === 3);
  ok('case 2: the overlay clock does NOT advance', out.facilities_refreshed_at === 'T0');
  ok('case 2: EPA failure is reported as UNKNOWN, not as a confirmed zero',
     out.facilities_unavailable === true);
}

// ── CASE 3 — both planes healthy: combined behaviour unchanged ──────────────
{
  const payloadSites = [proj(1), proj(2), proj(3), fac(900), fac(901), fac(902), fac(903)];
  const out = applyWrite({
    epaOk: true,
    payload: { sites: payloadSites, counts: { development: 3, facilities: 4 }, epa: { ok: true } },
    cached: cachedRow, cachedFreshDays: 30,
  });
  ok('case 3: both planes write', out.counts.development === 3 && out.counts.facilities === 4);
  // The engine emits [...dev, ...permitSites, ...fac] — facilities last — so the composed
  // array must be IDENTICAL to the payload array, not merely equivalent.
  ok('case 3: composed sites are byte-identical to the payload array',
     JSON.stringify(out.sites) === JSON.stringify(payloadSites));
  ok('case 3: both clocks advance together', out.refreshed_at === 'NOW' && out.facilities_refreshed_at === 'NOW');
  ok('case 3: a real facility count clears the unavailable flag', out.facilities_unavailable === false);
}

// ── CASE 4 — core fails: the core guards STILL refuse ───────────────────────
{
  ok('case 4: a per-source fetch failure still refuses the whole write',
     applyWrite({ epaOk: true, payload: { sites: [], counts: { development: 0, facilities: 4 }, epa: { ok: true } },
                  cached: cachedRow, cachedFreshDays: 1, coreBlocked: true }) === null);
  ok('case 4: an unexplained development collapse still refuses the write',
     applyWrite({ epaOk: true, payload: { sites: [fac(900)], counts: { development: 0, facilities: 1 }, epa: { ok: true } },
                  cached: cachedRow, cachedFreshDays: 1 }) === null);
  ok('case 4: an EXPLAINED reduction (retired source) is still accepted',
     applyWrite({ epaOk: true, payload: { sites: [fac(900)], counts: { development: 0, facilities: 1 }, epa: { ok: true } },
                  cached: cachedRow, cachedFreshDays: 1, explained: true }) !== null);
}

// ── CASE 5 — a genuine EPA zero is still authoritative once the row is old ──
// The guard must not become a ratchet that freezes the facility layer forever.
{
  const out = applyWrite({
    epaOk: true,
    payload: { sites: [proj(1)], counts: { development: 1, facilities: 0 }, epa: { ok: true } },
    cached: cachedRow, cachedFreshDays: 30,
  });
  ok('case 5: EPA healthy + old row + real zero → the zero IS stored', out.counts.facilities === 0);
  ok('case 5: …and it is NOT flagged unavailable (a real zero is not an outage)',
     out.facilities_unavailable === false);
  ok('case 5: …and the overlay clock advances', out.facilities_refreshed_at === 'NOW');
}

// ── CASE 6 — the per-report EPA signal still overrides a healthy global probe ──
{
  const out = applyWrite({
    epaOk: true,
    payload: { sites: [proj(1)], counts: { development: 1, facilities: 0 }, epa: { ok: false } },
    cached: cachedRow, cachedFreshDays: 30,
  });
  ok('case 6: this report\'s own epa.ok=false preserves the stored facilities', out.counts.facilities === 3);
  ok('case 6: …and reports the count as unknown', out.facilities_unavailable === true);
}

// ── CASE 7 — the old combined-zero guard is SUBSUMED, not lost ──────────────
{
  ok('case 7 limb 1: cached development > 0 → core guard refuses',
     applyWrite({ epaOk: true, payload: { sites: [], counts: { development: 0, facilities: 0 }, epa: { ok: true } },
                  cached: cachedRow, cachedFreshDays: 1 }) === null);
  const facOnlyCached = { sites: [fac(900)], counts: { development: 0, facilities: 1 }, facilities_refreshed_at: 'T0' };
  const out = applyWrite({ epaOk: true, payload: { sites: [], counts: { development: 0, facilities: 0 }, epa: { ok: true } },
                           cached: facOnlyCached, cachedFreshDays: 1 });
  ok('case 7 limb 2: facilities-only cached row keeps its facilities', out !== null && out.counts.facilities === 1);
  ok('case 7 limb 2: …and loses no project data (there was none to lose)', out.sites.filter((s) => !('registry_id' in s)).length === 0);
}

// ── CASE 8 (REVIEW FIX 2) — the FRESHNESS limb must not clear the flag ──────
// EPA healthy · incoming facility result a legitimate ZERO · cached count positive ·
// row inside the freshness window ⇒ facility write refused, core may advance, facility
// sites/count and the overlay clock unchanged, and the flag STAYS TRUE.
//
// This is the case the first Phase 1B build got wrong: it kept the pre-split flag
// expression, which had only ever run on rows where both planes wrote, and so reported
// "confirmed" over a count EPA had just contradicted.
{
  const out = applyWrite({
    epaOk: true,                                     // EPA healthy…
    payload: { sites: [proj(1), proj(2)], counts: { development: 2, facilities: 0 }, epa: { ok: true } }, // …legitimate zero
    cached: cachedRow,                               // cached facilities = 3 (positive)
    cachedFreshDays: 1,                              // inside the 7-day freshness window
  });
  ok('case 8: the facility write is refused', out !== null && out.counts.facilities === 3);
  ok('case 8: the CORE plane may still advance', out.refreshed_at === 'NOW' && out.counts.development === 2);
  ok('case 8: facility SITES unchanged',
     out.sites.filter((s) => 'registry_id' in s).map((s) => s.registry_id).join() === '900,901,902');
  ok('case 8: facilities_refreshed_at unchanged', out.facilities_refreshed_at === 'T0');
  ok('case 8: facilities_unavailable REMAINS TRUE (never "confirmed" over a stale count)',
     out.facilities_unavailable === true);
}

// ── CASE 9 (REVIEW FIX 1) — malformed `sites` is WITHHELD, never fatal ──────
// jsonb_array_elements raises 22023 on a non-array, which aborts the entire statement —
// every ZIP in the 20-minute window, re-failing every 2 minutes until the bad response
// ages out. Withholding the row is the fail-closed answer.
{
  const base = { counts: { development: 2, facilities: 0 }, epa: { ok: false } };
  const malformed = [
    ['SQL NULL sites (key absent)', { ...base }],
    ['JSON null sites',            { ...base, sites: null }],
    ['scalar string sites',        { ...base, sites: 'not-an-array' }],
    ['numeric scalar sites',       { ...base, sites: 42 }],
    ['object sites',               { ...base, sites: { a: 1 } }],
  ];
  // A THROW here is the faithful model of the SQL failure: without the guard,
  // jsonb_array_elements raises 22023 and aborts the whole statement. So "withheld"
  // must mean `null`, and BOTH a wrong value and an exception are failures — caught
  // here so the mutation proof names the broken protection instead of crashing the run.
  const withheld = (payload) => {
    try {
      return applyWrite({ epaOk: false, payload, cached: cachedRow, cachedFreshDays: 30 }) === null;
    } catch (e) {
      console.log(`      (threw: ${e.message} — models the 22023 statement abort)`);
      return false;
    }
  };
  for (const [label, payload] of malformed) {
    ok(`case 9: ${label} → row WITHHELD (no write at all)`, withheld(payload));
  }
  // An EMPTY array is valid, not malformed: it is a real "nothing here" answer.
  const empty = applyWrite({
    epaOk: false, payload: { sites: [], counts: { development: 0, facilities: 0 }, epa: { ok: false } },
    cached: { sites: [fac(900)], counts: { development: 0, facilities: 1 }, facilities_refreshed_at: 'T0' },
    cachedFreshDays: 30,
  });
  ok('case 9: EMPTY array is valid and still processed', empty !== null);
  ok('case 9: …and the EPA refusal still preserves its facilities', empty.counts.facilities === 1);

  // A valid MIXED array processes normally — the guard must not withhold good rows.
  const mixed = applyWrite({
    epaOk: true,
    payload: { sites: [proj(1), fac(900), fac(901)], counts: { development: 1, facilities: 2 }, epa: { ok: true } },
    cached: cachedRow, cachedFreshDays: 30,
  });
  ok('case 9: valid MIXED core/facility array processes normally',
     mixed !== null && mixed.counts.development === 1 && mixed.counts.facilities === 2);
  ok('case 9: …splitting the mixed array to the right planes',
     mixed.sites.filter((s) => 'registry_id' in s).length === 2
     && mixed.sites.filter((s) => !('registry_id' in s)).length === 1);

  // BATCH ISOLATION: a malformed row must not stop a valid row from being written.
  const batch = [
    { label: 'malformed', payload: { ...base, sites: 'oops' } },
    { label: 'valid',     payload: { sites: [proj(9)], counts: { development: 1, facilities: 0 }, epa: { ok: false } } },
  ].map((r) => ({ label: r.label, out: applyWrite({ epaOk: false, payload: r.payload, cached: cachedRow, cachedFreshDays: 30 }) }));
  ok('case 9: BATCH ISOLATION — the malformed row is skipped',
     batch.find((r) => r.label === 'malformed').out === null);
  ok('case 9: BATCH ISOLATION — the valid row still writes',
     batch.find((r) => r.label === 'valid').out !== null);
}

// ───────────────────── structural pins on the SQL of record ─────────────────────
// All of these read EXECUTABLE statements — see `executable()` above.

// The parked migration must be REPLAYABLE: the column and the writer in ONE file, so no
// interval can exist where the column is present and the old all-or-nothing body still runs.
ok('SQL: the parked migration adds the overlay column',
   /alter table public\.development_reports\s+add column if not exists facilities_refreshed_at/.test(sqlB));
ok('SQL: …and backfills it',
   /update public\.development_reports\s+set facilities_refreshed_at = refreshed_at/.test(sqlB));
ok('SQL: …and defines the refusal predicate exactly once',
   (sqlB.match(/create or replace function public\.dev_epa_write_refused/g) || []).length === 1);
ok('SQL: …and carries a FULL EXECUTABLE dev_refresh_collect definition (not a comment)',
   (sqlB.match(/create or replace function public\.dev_refresh_collect\(\)/g) || []).length === 1);
ok('SQL: the parked function body is non-trivial (steps a-d present)',
   collect.length > 4000
   && /\(a\) per-source FETCH FAILURES|dev_failed_sources/.test(collect)
   && /dev_truncated_sources/.test(collect)
   && /dev_retired_sources/.test(collect)
   && /update public\.development_reports d set/.test(collect));
ok('SQL: the scoped clock repair is retained with its fail-loud guard',
   /refusing: expected 6 migration-window rows/.test(sqlB)
   && /COLLATERAL DAMAGE: genuine refusals moved/.test(sqlB));

// The CORE guards must not mention facilities — the whole point of the split.
{
  const where = collect.slice(collect.indexOf("where d.zip = (j->>'zip')"));
  ok('SQL: no facilities predicate gates the core write', !/facilities/.test(where));
  ok('SQL: the shape guard is at the write eligibility boundary',
     /and jsonb_typeof\(j->'sites'\) = 'array'/.test(where));
  ok('SQL: CORE GUARD 1 (fetch failure) is present',
     /not exists \(select 1 from blocked b where b\.zip = d\.zip\)/.test(where));
  ok('SQL: CORE GUARD 2 (development reduction) is present',
     /counts->>'development'/.test(where));
}

// refreshed_at must be unconditional — that is what stops an EPA outage aging a ZIP.
ok('SQL: core refreshed_at is unconditional', /refreshed_at\s+= now\(\),/.test(collect));
// …while the overlay clock is gated by the refusal.
ok('SQL: the overlay clock is gated by the refusal predicate',
   /facilities_refreshed_at = case\s*when public\.dev_epa_write_refused/.test(collect));
// REVIEW FIX 2: the refusal branch must LEAD the flag expression.
ok('SQL: facilities_unavailable is led by the refusal branch (refused ⇒ true)',
   /facilities_unavailable = case\s*when public\.dev_epa_write_refused\(epa_ok, j, d\.counts, d\.refreshed_at\) then true/.test(collect));
ok('SQL: …and an untrusted EPA read still flags unavailable',
   /when not \(epa_ok and coalesce\(\(j->'epa'->>'ok'\)::boolean, true\)\) then true/.test(collect));

// The plane discriminator, used in both directions, with explicit ordering.
ok('SQL: the discriminator is the registry_id key',
   /where not \(x \? 'registry_id'\)/.test(collect) && /where x \? 'registry_id'/.test(collect));
ok('SQL: site order is explicit (with ordinality + order by)',
   /with ordinality t\(x, o\)/.test(collect) && /jsonb_agg\(x order by o\)/.test(collect));

// Phase 1A — the recovery path must not be able to touch any cron job.
ok('SQL 1A: the no-cron-mutation invariant is present',
   /alter_job\|cron\\\.schedule\|cron\\\.unschedule/.test(sqlA));
ok('SQL 1A: proof_check/step2 contain no executable alter_job call',
   !/perform\s+cron\.alter_job/.test(sqlA));
ok('SQL 1A: the core job name appears in no executable statement',
   !/dev-reports-rolling-refresh/.test(sqlA));
ok('SQL 1A: step2 still refuses to fire the proof while EPA is failing',
   /refusing to start step 2/.test(sqlA));
ok('SQL 1A: a failed proof still records its verdict', /'proof_checked'/.test(sqlA));

// Phase 2 must not have leaked in (executable statements only).
ok('SCOPE: no completion-marker / coverage-state change rode along',
   !/data_quality|indexable|app_coverage_states|facilities_only/.test(sqlB));
ok('SCOPE: no sitemap / robots / eligibility change rode along',
   !/sitemap|robots|noindex/i.test(sqlB));

console.log(`\n${failures.length ? `FAILED: ${failures.length}` : 'ALL PASS'} — dev-refresh plane split`);
if (failures.length) process.exit(1);
