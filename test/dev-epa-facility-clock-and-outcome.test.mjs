// FACILITY CLOCK + DURABLE PER-ZIP EPA OUTCOME.
//
// WHY. The 2026-09-27 EPA FRS audit measured two defects that keep genuine zeros from
// landing, and that hide every "not instrumented" count:
//   1. STALE-FACILITY CLEARING. `dev_epa_write_refused` judged freshness by the CORE
//      clock (`d.refreshed_at`). Development refreshes on a ~53 h sweep, so a genuine
//      EPA zero could never replace an old nonzero count. Live truth table: healthy
//      EPA + zero + cached 12 + core 1 h → refused; 6.9 d → refused; 7.1 d → accepted.
//      `facilities_refreshed_at` was never an input. 1,004 ZIPs had a fresh core, a
//      facility layer older than 7 days and a nonzero count.
//   2. NO DURABLE OUTCOME. `epa.ok`, `radius_used`, `raw_rows`, `kept` lived only in
//      `net._http_response`, which emptied (1,590 → 0) inside a minute.
//
// SQL of record: docs/dev-epa-facility-clock-and-outcome.sql, spliced from
// docs/dev-refresh-collect-once-per-response.sql. CI has no database, so this file
// pins the parked SQL and re-implements the refusal as a model. Every semantic case
// is paired with a structural assertion.
//
// Run: node test/dev-epa-facility-clock-and-outcome.test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawNew = readFileSync(join(root, 'docs/dev-epa-facility-clock-and-outcome.sql'), 'utf8');
const rawPrev = readFileSync(join(root, 'docs/dev-refresh-collect-once-per-response.sql'), 'utf8');
const indexTs = readFileSync(join(root, 'supabase/functions/get-address-report/index.ts'), 'utf8');

const failures = [];
const ok = (name, cond, detail) => {
  if (cond) console.log(`PASS — ${name}`);
  else {
    console.log(`FAIL — ${name}${detail ? `\n     ${detail}` : ''}`);
    failures.push(name);
  }
};

const executable = (sql) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const norm = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const count = (h, n) => h.split(n).length - 1;

function collectBody(sql) {
  const i = sql.indexOf('create or replace function public.dev_refresh_collect()');
  if (i === -1) return '';
  const seg = sql.slice(i);
  const a = seg.indexOf('$function$');
  const b = seg.indexOf('$function$', a + 10);
  return a === -1 || b === -1 ? '' : seg.slice(a + 10, b);
}

const sqlNew = executable(rawNew);
const newBody = collectBody(rawNew);
const prevBody = collectBody(rawPrev);
const N = norm(newBody);
const P = norm(prevBody);

// ───────────────────────── the model ─────────────────────────
// Mirrors public.dev_epa_write_refused() AFTER the clock move. Fail-closed: a null
// epa_ok, an absent `epa` key and a null counts object all resolve toward preserving
// what is already stored. The 4th input is the FACILITY clock, not the core clock.
function epaWriteRefused({ epaOk, payload, cached, facilityFreshDays }) {
  const reportEpaOk = payload.epa && payload.epa.ok !== undefined ? !!payload.epa.ok : false;
  const untrusted = !((epaOk === true) && reportEpaOk);
  const facilityFresh = facilityFreshDays < 7;
  return (untrusted || facilityFresh)
      && (payload.counts.facilities ?? 0) === 0
      && (cached.counts.facilities ?? 0) > 0;
}

function sitesIsArray(payload) {
  return Object.prototype.hasOwnProperty.call(payload, 'sites') && Array.isArray(payload.sites);
}

// Compose the durable outcome the way public.dev_epa_outcome_record() does.
function outcomeRecord(epa, responseId, writeRefused) {
  return { ...(epa && typeof epa === 'object' ? epa : {}), collected_at: 'NOW', response_id: responseId, write_refused: writeRefused };
}

function applyEpaPlane({ epaOk, payload, cached, facilityFreshDays, responseId, coreSites, withheld }) {
  const refused = epaWriteRefused({ epaOk, payload, cached, facilityFreshDays });
  const facSites = refused
    ? cached.sites.filter((s) => s && typeof s === 'object' && 'registry_id' in s)
    : payload.sites.filter((s) => s && typeof s === 'object' && 'registry_id' in s);
  const reportEpaOk = payload.epa && payload.epa.ok !== undefined ? !!payload.epa.ok : false;
  return {
    withheld,
    sites: [...coreSites, ...facSites],
    counts: {
      ...(withheld ? cached.counts : payload.counts),
      facilities: refused ? (cached.counts.facilities ?? 0) : payload.counts.facilities,
    },
    refreshed_at: withheld ? cached.refreshed_at ?? 'T0' : 'NOW',
    facilities_refreshed_at: refused ? cached.facilities_refreshed_at : 'NOW',
    facilities_unavailable:
      refused ? true
      : (payload.counts.facilities ?? 0) > 0 ? false
      : !((epaOk === true) && reportEpaOk) ? true
      : false,
    epa_last_outcome: outcomeRecord(payload.epa, responseId, refused),
  };
}

function applyWrite({
  epaOk, payload, cached, coreFreshDays, facilityFreshDays,
  coreBlocked = false, explained = false, responseId = 1,
}) {
  if (!sitesIsArray(payload)) {
    const staleNonzero = (cached.counts.facilities ?? 0) > 0 && facilityFreshDays >= 7;
    return {
      withheld: true,
      epa_last_outcome: outcomeRecord(payload.epa, responseId, epaWriteRefused({
        epaOk, payload, cached, facilityFreshDays,
      })),
      facilities_unavailable: staleNonzero ? true : cached.facilities_unavailable,
      counts: cached.counts,
      facilities_refreshed_at: cached.facilities_refreshed_at,
    };
  }

  const coreWithheld = coreBlocked || (
    coreFreshDays < 7
    && (payload.counts.development ?? 0) === 0
    && (cached.counts.development ?? 0) > 0
    && !explained
  );
  const coreSites = (coreWithheld ? cached.sites : payload.sites)
    .filter((s) => !(s && typeof s === 'object' && 'registry_id' in s));
  return applyEpaPlane({
    epaOk, payload, cached, facilityFreshDays, responseId, coreSites, withheld: coreWithheld,
  });
}

const proj = (id) => ({ label: `permit ${id}`, relevance: 'development', scope: 'point' });
const fac = (rid) => ({ label: `plant ${rid}`, registry_id: String(rid), scope: 'point', src: `EPA FRS · registry ${rid}` });
const cachedRow = {
  sites: [proj(1), proj(2), fac(900), fac(901), fac(902)],
  counts: { development: 2, facilities: 3 },
  facilities_refreshed_at: 'T0',
};

console.log('\n== 1. the clock that "fresh" consults is the FACILITY clock ==');
{
  // THE DEFECT, reproduced: core 1 h old, facility 8 days old, healthy genuine zero.
  // Before this change the guard saw the core clock and REFUSED. After, it accepts.
  const out = applyWrite({
    epaOk: true,
    payload: {
      sites: [proj(1)],
      counts: { development: 1, facilities: 0 },
      epa: { ok: true, radius_used: 3, raw_rows: 0, pre_cap: 0, kept: 0 },
    },
    cached: cachedRow,
    coreFreshDays: 1 / 24,
    facilityFreshDays: 8,
  });
  ok('C1. healthy zero + stale facility + fresh core → the zero IS stored',
     !out.withheld && out.counts.facilities === 0);
  ok('C1. …and the overlay clock advances', out.facilities_refreshed_at === 'NOW');
  ok('C1. …and the count is not flagged unavailable (a real zero is not an outage)',
     out.facilities_unavailable === false);
  ok('C1. …and the outcome is stored with write_refused=false',
     out.epa_last_outcome.write_refused === false && out.epa_last_outcome.ok === true);
}

{
  // Facility layer still inside the 7-day window: refuse, even if core is 30 days old.
  const out = applyWrite({
    epaOk: true,
    payload: { sites: [proj(1)], counts: { development: 1, facilities: 0 }, epa: { ok: true } },
    cached: cachedRow,
    coreFreshDays: 30,
    facilityFreshDays: 1,
  });
  ok('C2. healthy zero + fresh facility + stale core → facility write REFUSED',
     !out.withheld && out.counts.facilities === 3);
  ok('C2. …core may still advance', out.refreshed_at === 'NOW' && out.counts.development === 1);
  ok('C2. …overlay clock holds', out.facilities_refreshed_at === 'T0');
  ok('C2. …flag stays TRUE (never "confirmed" over a stale count)',
     out.facilities_unavailable === true);
  ok('C2. …outcome records write_refused=true', out.epa_last_outcome.write_refused === true);
}

{
  // The live truth-table edges, now against the facility clock.
  const at = (facilityDays) => epaWriteRefused({
    epaOk: true,
    payload: { counts: { facilities: 0 }, epa: { ok: true } },
    cached: { counts: { facilities: 12 } },
    facilityFreshDays: facilityDays,
  });
  ok('C3. facility 1 h old → refused (the live 1 h case, judged by the right clock)', at(1 / 24) === true);
  ok('C3. facility 6.9 d → refused', at(6.9) === true);
  ok('C3. facility 7.1 d → accepted (a genuine zero can now clear)', at(7.1) === false);
}

{
  // Untrusted EPA still refuses regardless of either clock.
  const out = applyWrite({
    epaOk: true,
    payload: { sites: [proj(1)], counts: { development: 1, facilities: 0 }, epa: { ok: false } },
    cached: cachedRow,
    coreFreshDays: 30,
    facilityFreshDays: 30,
  });
  ok('C4. this report\'s own epa.ok=false preserves stored facilities even when both clocks are stale',
     out.counts.facilities === 3 && out.facilities_unavailable === true);
}

{
  const out = applyWrite({
    epaOk: true,
    payload: {
      sites: [proj(1), fac(900), fac(901)],
      counts: { development: 1, facilities: 2 },
      epa: { ok: true, radius_used: 3, raw_rows: 5, pre_cap: 2, kept: 2 },
    },
    cached: cachedRow,
    coreFreshDays: 1,
    facilityFreshDays: 1,
  });
  ok('C5. a real nonzero count writes on a fresh facility layer',
     out.counts.facilities === 2 && out.facilities_unavailable === false);
  ok('C5. …and the stored outcome carries pre_cap', out.epa_last_outcome.pre_cap === 2);
}

console.log('\n== 2. the outcome is stored on EVERY evaluated response ==');
{
  const withheld = applyWrite({
    epaOk: true,
    payload: { sites: [fac(900)], counts: { development: 0, facilities: 1 }, epa: { ok: true, raw_rows: 4, pre_cap: 1, kept: 1 } },
    cached: cachedRow,
    coreFreshDays: 1,
    facilityFreshDays: 1,
  });
  ok('C6. CORE GUARD 2 withhold still records the EPA outcome',
     withheld.withheld === true
     && withheld.epa_last_outcome.raw_rows === 4
     && withheld.epa_last_outcome.response_id === 1);
}

{
  const withheld = applyWrite({
    epaOk: false,
    payload: { counts: { development: 1, facilities: 0 }, epa: { ok: false, reason: 'transient' } },
    cached: cachedRow,
    coreFreshDays: 30,
    facilityFreshDays: 30,
  });
  ok('C7. a malformed (no sites array) row still records the EPA outcome',
     withheld.withheld === true && withheld.epa_last_outcome.reason === 'transient');
}

{
  // Missing `epa` key is untrusted. The 2026-09-27 audit named this as LATENT case G
  // (coalesce to true). Fail-closed: a genuine zero must carry epa.ok=true.
  const refused = epaWriteRefused({
    epaOk: true,
    payload: { counts: { facilities: 0 } },
    cached: { counts: { facilities: 12 } },
    facilityFreshDays: 30,
  });
  ok('C8. missing epa key is untrusted → write REFUSED (fail-closed, was latent ok:true)',
     refused === true);

  const unknownZero = applyWrite({
    epaOk: true,
    payload: { sites: [proj(1)], counts: { development: 1, facilities: 0 } },
    cached: { sites: [proj(1)], counts: { development: 1, facilities: 0 }, facilities_refreshed_at: 'T0' },
    coreFreshDays: 30,
    facilityFreshDays: 30,
  });
  ok('C8b. missing epa key + incoming 0 + cached 0 → flagged unavailable (not a fact)',
     unknownZero.facilities_unavailable === true);
}

console.log('\n== 2b. reverse coupling: core withhold does not freeze EPA ==');
{
  // The 74-ZIP shape: core refused (fresh core + unexplained development collapse),
  // EPA healthy with a real count. Before, the whole row was frozen.
  const out = applyWrite({
    epaOk: true,
    payload: {
      sites: [fac(900)],
      counts: { development: 0, facilities: 1 },
      epa: { ok: true, radius_used: 3, raw_rows: 4, pre_cap: 1, kept: 1 },
    },
    cached: cachedRow,
    coreFreshDays: 1,
    facilityFreshDays: 20,
  });
  ok('R1. CORE GUARD 2 withhold still records the EPA outcome',
     out.withheld === true && out.epa_last_outcome.raw_rows === 4);
  ok('R1. …but a trusted EPA count still writes',
     out.counts.facilities === 1 && out.facilities_refreshed_at === 'NOW');
  ok('R1. …core count and core clock stay put',
     out.counts.development === 2 && out.refreshed_at === 'T0');
  ok('R1. …the count is not flagged unavailable (it just wrote)',
     out.facilities_unavailable === false);
}

{
  const out = applyWrite({
    epaOk: true,
    payload: { counts: { development: 0, facilities: 0 }, epa: { ok: false, reason: 'transient' } },
    cached: cachedRow,
    coreFreshDays: 1,
    facilityFreshDays: 20,
  });
  ok('R2. shape-withheld + stale nonzero facility layer → flagged unavailable',
     out.withheld === true && out.facilities_unavailable === true && out.counts.facilities === 3);
}

{
  const out = applyWrite({
    epaOk: true,
    payload: {
      sites: [proj(1), fac(900)],
      counts: { development: 0, facilities: 1 },
      epa: { ok: true },
    },
    cached: cachedRow,
    coreFreshDays: 1,
    facilityFreshDays: 20,
    coreBlocked: true,
  });
  ok('R3. CORE GUARD 1 withhold still lets a trusted EPA write land',
     out.withheld === true && out.counts.facilities === 1 && out.counts.development === 2);
}

console.log('\n== 3. engine emits pre_cap BEFORE the 40-cap ==');
{
  ok('E1. pre_cap is taken from kept.length before the slice',
     /const preCap = kept\.length;/.test(indexTs)
     && /kept\.slice\(0,\s*MAX_FACILITIES\)/.test(indexTs)
     && indexTs.indexOf('const preCap = kept.length;') < indexTs.indexOf('kept.slice(0, MAX_FACILITIES)'));
  ok('E2. the success epa object carries pre_cap: preCap',
     /pre_cap:\s*preCap/.test(indexTs));
  ok('E3. facilitiesUnavailable carries pre_cap: 0 (a miss is not a cap-hit of zero)',
     /pre_cap:\s*0,\s*kept:\s*0/.test(indexTs));
  ok('E4. MAX_FACILITIES is still 40', /const MAX_FACILITIES = 40;/.test(indexTs));
}

console.log('\n== 4. structural pins on the SQL of record ==');
{
  ok('both collector bodies were found', N.length > 1000 && P.length > 1000);
  ok('column + helper + write-refused + collector ship in ONE transaction',
     /^begin;/m.test(sqlNew) && /^commit;/m.test(sqlNew)
     && sqlNew.indexOf('add column if not exists epa_last_outcome jsonb')
        < sqlNew.indexOf('create or replace function public.dev_epa_outcome_record')
     && sqlNew.indexOf('create or replace function public.dev_epa_write_refused')
        < sqlNew.indexOf('create or replace function public.dev_refresh_collect()'));
  ok('no backfill of epa_last_outcome (NULL = not yet recorded is the safe state)',
     !/update\s+public\.development_reports\s+set\s+epa_last_outcome/i.test(
       sqlNew.replace(newBody, '')));
  ok('the write-refused 4th parameter is named for the facility clock',
     /_cached_facilities_refreshed_at/.test(sqlNew)
     && !/_cached_refreshed_at/.test(sqlNew));
  ok('missing epa.ok fail-closes to false in the write-guard and the unavailable flag',
     count(sqlNew, "coalesce((_j->'epa'->>'ok')::boolean, false)") === 1
     && count(N, norm("coalesce((j->'epa'->>'ok')::boolean, false)")) === 1
     && !/coalesce\(\(_j->'epa'->>'ok'\)::boolean,\s*true\)/.test(sqlNew)
     && !/coalesce\(\(j->'epa'->>'ok'\)::boolean,\s*true\)/.test(N));
  ok('the collector never passes d.refreshed_at to the write-guard',
     !/dev_epa_write_refused\(\s*epa_ok,\s*j,\s*d\.counts,\s*d\.refreshed_at\)/.test(N));
  ok('every write-guard call in step (d) takes d.facilities_refreshed_at',
     count(N, norm('public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)')) === 5);
  ok('CORE GUARD 2 still reads the CORE clock (the planes stay independent)',
     /d\.refreshed_at >= now\(\) - interval '7 days'/.test(N)
     && /counts->>'development'/.test(N));
  ok('core refreshed_at is still unconditional', /refreshed_at\s+= now\(\),/.test(newBody));
  ok('both (d) and (e) go through the ONE outcome helper',
     count(N, 'dev_epa_outcome_record') === 2);
  ok('five consumers still read the single id set (a, b, c, d, e)',
     count(N, 'r.id = any(_ids)') === 5);
  ok('SCOPE: the fire side, tick, cadence and materializer are not redefined',
     !/create or replace function public\.(dev_refresh_fire_batch|dev_refresh_tick|dev_refresh_log_fire_failures|app_refresh_zip|app_refresh_sweep)/i.test(sqlNew)
     && !/cron\.(schedule|alter_job|unschedule)/.test(sqlNew));
  ok('SCOPE: no completion-marker / coverage-state / sitemap change rode along',
     !/data_quality|indexable|app_coverage_states|facilities_only|sitemap|robots/i.test(sqlNew));
}

console.log('\n== 5. §1 PARITY: new body minus the named additions == superseded collector ==');
{
  const CLOCK_OLD = norm('public.dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)');
  const CLOCK_NEW = norm('public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)');
  const D_OUTCOME = norm(`epa_last_outcome = public.dev_epa_outcome_record(
                         j->'epa', resp.rid,
                         public.dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)),`);
  const E_NEW = norm(`update public.development_reports d
     set last_collected_response_id = r.id,
         epa_last_outcome = public.dev_epa_outcome_record(
                              r.content::jsonb->'epa', r.id,
                              public.dev_epa_write_refused(
                                epa_ok, r.content::jsonb, d.counts, d.facilities_refreshed_at)),
         sites = case
                   when jsonb_typeof(r.content::jsonb->'sites') = 'array'
                    and not public.dev_epa_write_refused(
                              epa_ok, r.content::jsonb, d.counts, d.facilities_refreshed_at)
                   then coalesce((select jsonb_agg(x order by o)
                                    from jsonb_array_elements(d.sites) with ordinality t(x, o)
                                   where not (x ? 'registry_id')), '[]'::jsonb)
                        || coalesce((select jsonb_agg(x order by o)
                                    from jsonb_array_elements(r.content::jsonb->'sites') with ordinality t(x, o)
                                   where x ? 'registry_id'), '[]'::jsonb)
                   else d.sites
                 end,
         counts = case
                   when jsonb_typeof(r.content::jsonb->'sites') = 'array'
                    and not public.dev_epa_write_refused(
                              epa_ok, r.content::jsonb, d.counts, d.facilities_refreshed_at)
                   then coalesce(d.counts, '{}'::jsonb) || jsonb_build_object(
                          'facilities', coalesce((r.content::jsonb->'counts'->>'facilities')::int, 0))
                   else d.counts
                 end,
         facilities_refreshed_at = case
                   when jsonb_typeof(r.content::jsonb->'sites') = 'array'
                    and not public.dev_epa_write_refused(
                              epa_ok, r.content::jsonb, d.counts, d.facilities_refreshed_at)
                   then now()
                   else d.facilities_refreshed_at
                 end,
         facilities_unavailable = case
                   when jsonb_typeof(r.content::jsonb->'sites') is distinct from 'array' then
                     case when coalesce((d.counts->>'facilities')::int, 0) > 0
                           and (d.facilities_refreshed_at is null
                                or d.facilities_refreshed_at < now() - interval '7 days')
                          then true
                          else d.facilities_unavailable
                     end
                   when public.dev_epa_write_refused(
                          epa_ok, r.content::jsonb, d.counts, d.facilities_refreshed_at) then true
                   when coalesce((r.content::jsonb->'counts'->>'facilities')::int, 0) > 0 then false
                   when not (epa_ok and coalesce((r.content::jsonb->'epa'->>'ok')::boolean, false)) then true
                   else false
                 end
    from net._http_response r`);
  const E_OLD = norm(`update public.development_reports d
     set last_collected_response_id = r.id
    from net._http_response r`);
  const COALESCE_NEW = norm("coalesce((j->'epa'->>'ok')::boolean, false)");
  const COALESCE_OLD = norm("coalesce((j->'epa'->>'ok')::boolean, true)");

  ok('the facility-clock argument appears exactly 5 times in the j-shaped calls (4 write sites + 1 outcome)',
     count(N, CLOCK_NEW) === 5);
  ok('the (d) outcome assignment appears exactly once', count(N, D_OUTCOME) === 1);
  ok('the (e) outcome assignment appears exactly once', count(N, E_NEW) === 1);
  ok('the fail-closed epa.ok default appears exactly once in the collector body',
     count(N, COALESCE_NEW) === 1);

  let stripped = N;
  stripped = stripped.split(D_OUTCOME).join(' ');
  stripped = stripped.split(E_NEW).join(E_OLD);
  stripped = stripped.split(CLOCK_NEW).join(CLOCK_OLD);
  stripped = stripped.split(COALESCE_NEW).join(COALESCE_OLD);
  stripped = stripped.replace(/\s+/g, ' ').trim();
  ok('§1 PARITY: new collector minus clock-move, outcome storage, and fail-closed epa.ok == once-per-response body',
     stripped === P,
     stripped === P ? '' : `len ${stripped.length} vs ${P.length}`);
}

console.log(`\n${failures.length ? `FAILED: ${failures.length}` : 'ALL PASS'} — facility clock + durable EPA outcome`);
if (failures.length) process.exit(1);
