// RECURRING INGEST: the ONE canonical resolver must be safe to run after EVERY acquisition.
//
// Measured 2026-09-22: dc_current_observation is the latest complete run per source, so every
// scheduled Atlas/Epoch run brings the same publisher records under NEW observation ids. The
// resolver decided "is this group already an entity?" from the observations in the set alone,
// so a scheduled apply would have minted 2,087 duplicate Atlas entities per run, and an apply
// with p_include_history left 4,174 historical Atlas observations linked to nothing.
//
// This pins the DDL of record (docs/dc-step3a-canonical-identity.sql), which the isolation
// gate already requires to be the one definition of dc_resolve_canonical.
// Run: node test/dc-resolver-recurring.test.mjs
import { readFileSync } from 'node:fs';

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m); } };

const DDL = readFileSync(new URL('../docs/dc-step3a-canonical-identity.sql', import.meta.url), 'utf8');
// Comments are stripped so a pin can never be satisfied by prose describing the rule.
const code = DDL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const start = code.indexOf('create or replace function public.dc_resolve_canonical(');
const end = code.indexOf('$fn$;', start);
const fn = start > -1 && end > start ? code.slice(start, end) : '';
ok(fn.length > 2000 && /return query/.test(fn), '0: the resolver body is located (positive control)');
ok((code.match(/create or replace function public\.dc_resolve_canonical\(/g) || []).length === 1,
  '0b: exactly ONE definition of dc_resolve_canonical in the DDL of record');

const apply = fn.slice(fn.indexOf('if p_apply then'), fn.indexOf('return query'));
ok(apply.length > 500, '0c: the apply block is located');

// 1. The existing entity for a group is found across ALL linked observations, not the set.
ok(/create temporary table _res_existing[\s\S]*?from public\.dc_entity_observation eo[\s\S]*?join public\.dc_source_observation o/.test(apply),
  '1: existing entities are looked up across every linked observation (all runs)');
ok(/o\.source_key \|\| '\|' \|\| o\.distribution_key \|\| '\|' \|\| o\.publisher_record_id/.test(apply),
  '1b: the lookup keys on the SAME A1 tuple as entity formation — no second identity rule');

// 2. Minting only for groups that are not already an entity.
ok(/create temporary table _res_new[\s\S]*?where not exists \(select 1 from _res_existing x where x\.group_key = e\.group_key\)/.test(apply),
  '2: a group that is already an entity is never minted again');
ok(!/join _res_entity re on re\.oid = eo\.home_signal_observation_id/.test(apply),
  '2b: the run-local "linked in this set" test that caused per-run duplicates is gone');

// 3. Every observation in the set is linked — to its existing entity or its new one.
const link = apply.slice(apply.indexOf('insert into public.dc_entity_observation'));
ok(/coalesce\(x\.canonical_entity_id, n\.canonical_entity_id\)/.test(link),
  '3: each observation links to the existing entity, else the newly minted one');
ok(/from _res_entity re/.test(link.slice(0, 900)) && !/from _res_new n\s+join _res_entity/.test(link.slice(0, 900)),
  '3b: linking iterates ALL observations in the set, not only new groups');

// 4. A forked identity is refused loudly, not papered over.
ok(/n_entities > 1[\s\S]*?raise exception/.test(apply),
  '4: an A1 group already split across two entities raises instead of linking');

// 5. Existing entities are refreshed from their own links by the minting rule.
ok(/update public\.dc_canonical_entity e[\s\S]*?observation_count = s\.n_obs[\s\S]*?source_count\s+= s\.n_src/.test(apply),
  '5: an entity that gains evidence has its counts recomputed from its links');
ok(/bool_or\(eo\.observation_classification = 'CONFIRMED_DC'\)/.test(apply),
  '5b: classification is recomputed with the same most-confirmed rule used at minting');

// 6. The run reports what it did, so a scheduled run is auditable.
for (const m of ['ENTITIES_MINTED', 'GROUPS_ALREADY_ENTITIES', 'OBSERVATIONS_NEWLY_LINKED']) {
  ok(fn.includes(`'${m}'`), `6: the resolver reports ${m}`);
}

// 7. Report-only mode must not reference apply-only temp tables (it would fail to plan).
const report = fn.slice(fn.indexOf('return query'));
ok(!/_res_existing|_res_new/.test(report), '7: report-only metrics never read apply-only tables');

// 8. No Stratos / Utah / ZIP special case anywhere in the resolver.
ok(!/stratos|box elder|utah|84336|84307|lucin/i.test(fn), '8: no project- or place-specific logic');

// 9. AUTOMATIC: the resolver runs on a DB-side schedule, current-run scope, idempotently.
// A GitHub-hosted trigger would stop with Actions capacity; pg_cron does not.
const sched = code.match(/cron\.schedule\('dc-resolve-canonical',\s*'([^']+)',\s*'([^']+)'\)/);
ok(!!sched, '9: the DDL of record schedules dc-resolve-canonical in pg_cron');
ok(!!sched && /^\S+ \* \* \* \*$/.test(sched[1]), '9b: at least hourly (every hour), so a new run is resolved within the hour');
ok(!!sched && /dc_resolve_canonical\(true, false\)/.test(sched[2]),
  '9c: the scheduled call APPLIES over the CURRENT run only (history backfill is one-time)');
ok(/cron\.unschedule\(jobid\) from cron\.job where jobname = 'dc-resolve-canonical'/.test(code),
  '9d: re-applying the DDL replaces the job instead of stacking a duplicate');
ok((code.match(/cron\.schedule\('dc-resolve-canonical'/g) || []).length === 1, '9e: exactly one schedule');

console.log(bad ? `\n${bad} FAILED (${n} checks)` : `\nALL CHECKS PASSED (${n} checks)`);
if (bad) process.exit(1);
