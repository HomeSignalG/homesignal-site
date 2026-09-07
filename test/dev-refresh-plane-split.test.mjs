// PHASE 1B — the CORE project plane and the REGULATORY (EPA/FRS) plane must write
// independently. Offline: CI has no database, so this pins the SQL OF RECORD
// (docs/epa-decouple-phase1b-split-write.sql, docs/epa-decouple-phase1a-core-cron-switch.sql)
// with structural checks, and re-implements the write's decision semantics as a model that
// is exercised over the five cases the founder specified.
//
// WHY THIS FILE EXISTS. Before the split, ONE `update development_reports` wrote `sites`,
// `counts` and `refreshed_at` together while the EPA guard sat in its WHERE clause — so
// refusing the regulatory half refused the core half. Measured live 2026-09-07 during a real
// FRS outage: 51 ZIP refreshes refused in one hour, 46 holding project data, 6,532 core
// project records discarded. 90.9% of cached reports were structurally exposed.
//
// ⚠️ THE MODEL IS NOT THE PRODUCT. A truth table can only prove the RULE is right; it cannot
// prove the shipped SQL implements it. That is why every semantic case below is paired with a
// structural assertion that the SQL of record still has the shape the model assumes — the same
// two-halves approach as test/dev-refresh-per-report-epa-guard.test.mjs.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlB = readFileSync(join(root, 'docs/epa-decouple-phase1b-split-write.sql'), 'utf8');
const sqlA = readFileSync(join(root, 'docs/epa-decouple-phase1a-core-cron-switch.sql'), 'utf8');

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

// Mirrors the composed write. Returns the row as it would be stored, or null if the CORE
// write was refused (in which case the whole row is left alone, as before).
function applyWrite({ epaOk, payload, cached, cachedFreshDays, coreBlocked = false, explained = false }) {
  // CORE GUARD 1 — per-source fetch failure where that source already contributes.
  if (coreBlocked) return null;
  // CORE GUARD 2 — unexplained development reduction while fresh.
  if (cachedFreshDays < 7
      && (payload.counts.development ?? 0) === 0
      && (cached.counts.development ?? 0) > 0
      && !explained) return null;

  const refused = epaWriteRefused({ epaOk, payload, cached, cachedFreshDays });
  const coreSites = payload.sites.filter((s) => !('registry_id' in s));
  const facSites = refused
    ? cached.sites.filter((s) => 'registry_id' in s)
    : payload.sites.filter((s) => 'registry_id' in s);

  const reportEpaOk = payload.epa && payload.epa.ok !== undefined ? !!payload.epa.ok : true;
  return {
    sites: [...coreSites, ...facSites],
    counts: {
      ...payload.counts,
      facilities: refused ? (cached.counts.facilities ?? 0) : payload.counts.facilities,
    },
    refreshed_at: 'NOW',
    facilities_refreshed_at: refused ? cached.facilities_refreshed_at : 'NOW',
    facilities_unavailable:
      (payload.counts.facilities ?? 0) > 0 ? false
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
// The 2026-08-13 density-dependence finding: global healthy + THIS ZIP failed.
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
// It fired on (fresh AND newFac=0 AND newDev=0 AND (cachedFac+cachedDev)>0 AND unexplained).
{
  // limb 1: cachedDev > 0 → CORE GUARD 2 refuses.
  ok('case 7 limb 1: cached development > 0 → core guard refuses',
     applyWrite({ epaOk: true, payload: { sites: [], counts: { development: 0, facilities: 0 }, epa: { ok: true } },
                  cached: cachedRow, cachedFreshDays: 1 }) === null);
  // limb 2: cachedDev = 0, cachedFac > 0 → core write is a no-op, facilities preserved.
  const facOnlyCached = { sites: [fac(900)], counts: { development: 0, facilities: 1 }, facilities_refreshed_at: 'T0' };
  const out = applyWrite({ epaOk: true, payload: { sites: [], counts: { development: 0, facilities: 0 }, epa: { ok: true } },
                           cached: facOnlyCached, cachedFreshDays: 1 });
  ok('case 7 limb 2: facilities-only cached row keeps its facilities', out !== null && out.counts.facilities === 1);
  ok('case 7 limb 2: …and loses no project data (there was none to lose)', out.sites.filter((s) => !('registry_id' in s)).length === 0);
}

// ───────────────────── structural pins on the SQL of record ─────────────────────
// The model above is only meaningful if the shipped SQL still has this shape.
//
// ⚠️ WHAT THESE READ, STATED PLAINLY. Part 1 of the Phase 1B doc (the column + the
// dev_epa_write_refused definition) is EXECUTABLE SQL. Step (d) is parked as a COMMENTED
// reproduction of the applied body, because it was applied as an anchored splice of the
// live pg_get_functiondef output rather than as a standalone CREATE. So the step-(d) pins
// below assert the shape of the RECORD, not of the live function — CI has no database.
// The record's fidelity to the live body was established at apply time by the migration's
// own post-checks (prefix re-asserted byte-for-byte, split predicate present, no facilities
// predicate left in the core WHERE) and by the md5 stated in the doc. If you change the
// live function, update the doc in the same commit or these pins go quietly stale.

// The EPA refusal must have exactly ONE definition.
ok('SQL: dev_epa_write_refused is defined once',
   (sqlB.match(/create or replace function public\.dev_epa_write_refused/g) || []).length === 1);

// The CORE guards must not mention facilities. This is the whole fix: if a facilities
// predicate reappears in the WHERE clause, EPA can gate the core write again.
{
  const where = sqlB.slice(sqlB.indexOf('--   where d.zip = (j->>\'zip\')'));
  const coreGuardRegion = where.slice(0, where.indexOf('-- Live body after apply'));
  ok('SQL: no facilities predicate gates the core write',
     !/facilities/.test(coreGuardRegion));
  ok('SQL: CORE GUARD 1 (fetch failure) is present', /CORE GUARD 1/.test(sqlB));
  ok('SQL: CORE GUARD 2 (development reduction) is present', /CORE GUARD 2/.test(sqlB));
}

// refreshed_at must be unconditional — that is what stops an EPA outage aging a ZIP.
ok('SQL: core refreshed_at is unconditional (no case/when around it)',
   /refreshed_at\s+= now\(\),/.test(sqlB));
// …while the overlay clock must be conditional on the refusal.
ok('SQL: the overlay clock is gated by the refusal predicate',
   /facilities_refreshed_at = case\s*\n\s*--?\s*when public\.dev_epa_write_refused|facilities_refreshed_at = case[\s\S]{0,120}dev_epa_write_refused/.test(sqlB));

// The plane discriminator, and that it is used in both directions.
ok('SQL: the discriminator is the registry_id key',
   /where not \(x \? 'registry_id'\)/.test(sqlB) && /where x \? 'registry_id'/.test(sqlB));
// Order must be explicit, not incidental.
ok('SQL: site order is explicit (with ordinality + order by)',
   /with ordinality t\(x, o\)/.test(sqlB) && /jsonb_agg\(x order by o\)/.test(sqlB));

// The honest-unknown rule must survive untouched.
ok('SQL: facilities_unavailable still flags an untrusted EPA read',
   /facilities_unavailable = case[\s\S]{0,300}then true/.test(sqlB));

// Phase 1A — the recovery path must not be able to touch the core cron.
ok('SQL 1A: no epa_* function may mutate a cron job (invariant present)',
   /alter_job\|cron\\\.schedule\|cron\\\.unschedule/.test(sqlA));
{
  // The two rewritten bodies must not CALL alter_job. Strip comment lines first, so the
  // documentation of what was removed does not read as the thing itself.
  const executable = sqlA.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  ok('SQL 1A: proof_check/step2 contain no executable alter_job call',
     !/perform\s+cron\.alter_job/.test(executable));
  ok('SQL 1A: the core job name appears in no executable statement',
     !/dev-reports-rolling-refresh/.test(executable));
}
// The EPA-only gate that SHOULD exist must still be there.
ok('SQL 1A: step2 still refuses to fire the proof while EPA is failing',
   /refusing to start step 2/.test(sqlA));
ok('SQL 1A: a failed proof still records its verdict',
   /'proof_checked'/.test(sqlA));

// Phase 2 must not have leaked in. Read EXECUTABLE statements only — the doc's
// "OUT OF SCOPE, DELIBERATELY" section names these very identifiers, and a check that
// cannot tell a statement from a note about a statement is a spelling rule, not a gate.
// (This is the same distinction the Phase 1A checks draw, and the first run of this file
// failed here for exactly that reason.)
{
  const executableB = sqlB.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  ok('SCOPE: no completion-marker / coverage-state change rode along',
     !/data_quality|indexable|app_coverage_states|facilities_only/.test(executableB));
  ok('SCOPE: no sitemap / robots / eligibility change rode along',
     !/sitemap|robots|noindex/i.test(executableB));
}

console.log(`\n${failures.length ? `FAILED: ${failures.length}` : 'ALL PASS'} — dev-refresh plane split`);
if (failures.length) process.exit(1);
