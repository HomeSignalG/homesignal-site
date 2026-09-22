// STEP 3B: canonical geography is decided by column-level rules over CURRENT evidence, never by
// a place, project or source name, and never assigns a ZIP.
//
// Measured on production 2026-09-22 when this was applied: 2,174 entities -> 2,034 RESOLVED,
// 131 GEOGRAPHY_UNRESOLVED (87 Epoch records with no coordinates + 44 rounded), 9 NOT_A_SITE;
// a second apply wrote 0 rows. Stratos (41.5, -113.5, publisher "exact") is unresolved by the
// rounded-coordinates rule like every other one-decimal point, not by name.
// Run: node test/dc-canonical-geography.test.mjs
import { readFileSync } from 'node:fs';

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m); } };

const DDL = readFileSync(new URL('../docs/dc-step3b-canonical-geography.sql', import.meta.url), 'utf8');
// Comments stripped, so prose describing a rule can never satisfy the pin for it.
const code = DDL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const fnStart = code.indexOf('create or replace function public.dc_resolve_geography(');
const fn = fnStart > -1 ? code.slice(fnStart, code.indexOf('$fn$;', fnStart)) : '';
ok(fn.length > 2000 && /return query/.test(fn), '0: the resolver body is located (positive control)');
ok((code.match(/create or replace function public\.dc_resolve_geography\(/g) || []).length === 1,
  '0b: exactly one definition');

// 1. Evidence is the CURRENT run, through the canonical links -- never raw rows by source.
ok(/join public\.dc_current_observation c/.test(fn) && /from public\.dc_entity_observation eo/.test(fn),
  '1: points come from current observations linked to canonical entities');

// 2. The rules, each as code.
ok(/entity_grain = 'AGGREGATE_MULTI_SITE' then 'NOT_A_SITE'/.test(fn), '2a: publisher multi-site -> NOT_A_SITE');
ok(/b\.oid is null or b\.disagree or b\.decimals <= 1 then 'GEOGRAPHY_UNRESOLVED'/.test(fn),
  '2b: no coordinates, disagreeing sources, or <= 1 decimal place -> GEOGRAPHY_UNRESOLVED');
ok(/least\(scale\(o\.source_native_lat::text::numeric\),\s*scale\(o\.source_native_lon::text::numeric\)\)/.test(fn),
  '2c: decimals are the LESSER of the two axes (one rounded axis is enough to fail)');
ok(/ST_DistanceSphere\([\s\S]*?\) > 1000\) disagree/.test(fn), '2d: sources > 1 km apart disagree');
ok(/b\.decimals <= 1 and b\.prec = 'exact'\s+then 'PUBLISHER_CLAIMS_EXACT'/.test(fn),
  '2e: a rounded point labelled "exact" is flagged, not trusted');
for (const f of ['COARSE_COORDINATES', 'PUBLISHER_APPROXIMATE', 'SHARED_COORDINATES']) {
  ok(fn.includes(`'${f}'`), `2f: resolved points carry the ${f} quality flag`);
}

// 3. Structural guarantees on the table.
ok(/geography_status = 'RESOLVED' and geom is not null[\s\S]*?geography_status <> 'RESOLVED' and geom is null/.test(code),
  '3a: a resolved row has a geometry and an unresolved row never carries one');
ok(/enable row level security/.test(code) && /revoke all on public\.dc_entity_geography from anon, authenticated/.test(code),
  '3b: no resident access (Step 3A posture)');

// 4. Idempotent apply.
ok(/on conflict \(canonical_entity_id\) do update[\s\S]*?is distinct from/.test(fn),
  '4: an unchanged entity is not rewritten');

// 5. Scheduled after identity resolution, DB-side.
const ident = readFileSync(new URL('../docs/dc-step3a-canonical-identity.sql', import.meta.url), 'utf8');
const identMin = +(ident.match(/cron\.schedule\('dc-resolve-canonical',\s*'(\d+) /) || [])[1];
const geoSched = code.match(/cron\.schedule\('dc-resolve-geography',\s*'(\d+) \* \* \* \*',\s*'([^']+)'\)/);
ok(!!geoSched && /dc_resolve_geography\(true\)/.test(geoSched[2]), '5a: geography applies hourly in pg_cron');
ok(!!geoSched && Number.isFinite(identMin) && +geoSched[1] > identMin,
  '5b: geography runs AFTER identity within the hour');

// 6. No ZIP, no radius, no place, no project -- membership is a separate stage.
ok(!/zcta|zip|radius|centroid|national_dc|distance_mi/i.test(fn), '6a: no ZIP / radius / legacy plane');
ok(!/stratos|box elder|utah|lucin|84336|84307|41\.5|-113\.5/i.test(code), '6b: no place- or project-specific logic');
ok(!/source_key\s*=\s*'/.test(fn), '6c: no source-specific branch');

console.log(bad ? `\n${bad} FAILED (${n} checks)` : `\nALL CHECKS PASSED (${n} checks)`);
if (bad) process.exit(1);
