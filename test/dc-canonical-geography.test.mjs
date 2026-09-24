// STEP 3B: canonical geography is decided by column-level rules over CURRENT evidence, never by
// a place, project or source name, and never assigns a ZIP.
//
// Measured on production 2026-09-22 when this was applied: 2,174 entities -> 2,034 RESOLVED,
// 131 GEOGRAPHY_UNRESOLVED (87 Epoch records with no coordinates + 44 rounded), 9 NOT_A_SITE;
// a second apply wrote 0 rows. Stratos (41.5, -113.5, publisher "exact") is unresolved by the
// rounded-coordinates rule like every other one-decimal point, not by name.
// rule_version 2 (2026-09-24): identity-pending refusal + publisher-stated area points withheld;
// the executable proof is test/dc_geography_pg (PostGIS, corpus of 1,183 real sentences).
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
// The resolver's coordinate claims come from ONE evidence view (2026-09-24); the pins that read how
// evidence is gathered read that view, and the resolver must read it and nothing else for points.
const evStart = code.indexOf('create or replace view public.dc_entity_geography_evidence');
const ev = evStart > -1 ? code.slice(evStart, code.indexOf(';', evStart) + 1) : '';
ok(ev.length > 1000 && /from public\.dc_entity_geography_evidence;/.test(fn)
   && !/from public\.dc_source_observation o\s/.test(fn.slice(0, fn.indexOf('_geo_derived'))),
  '0c: the resolver reads its points from the one evidence view (positive control that the view is located)');

// 1. Evidence is the CURRENT run, through the canonical links -- never raw rows by source.
ok(/join public\.dc_current_observation c/.test(ev) && /from public\.dc_entity_observation eo/.test(ev),
  '1: points come from current observations linked to canonical entities');

// 2. The rules, each as code.
ok(/entity_grain = 'AGGREGATE_MULTI_SITE' then 'NOT_A_SITE'/.test(fn), '2a: publisher multi-site -> NOT_A_SITE');
ok(/b\.oid is null or b\.disagree or b\.decimals <= 1 then 'GEOGRAPHY_UNRESOLVED'/.test(fn),
  '2b: no coordinates, disagreeing sources, or <= 1 decimal place -> GEOGRAPHY_UNRESOLVED');
ok(/least\(scale\(o\.source_native_lat::text::numeric\),\s*scale\(o\.source_native_lon::text::numeric\)\)/.test(ev),
  '2c: decimals are the LESSER of the two axes (one rounded axis is enough to fail)');
// 2d (rule_version 4, CANONICAL GEOGRAPHY AUTHORITY; replaces "any two sources > 1 km apart disagree",
// which held a derived geocode to the peer tolerance and ignored its calibrated error): the ONE
// contradiction definition, used by the resolver and by nothing else.
const cfStart = code.indexOf('create or replace function public.dc_site_claims_conflict(');
const cf = cfStart > -1 ? code.slice(cfStart, code.indexOf('$$;', cfStart)) : '';
ok(cf.length > 200
   && /p_class_a in \('PUBLISHER_SITE', 'DERIVED_ADDRESS'\)\s+and p_class_b in \('PUBLISHER_SITE', 'DERIVED_ADDRESS'\)/.test(cf)
   && /> case when p_uncertainty_a is null and p_uncertainty_b is null then 1000\s+else coalesce\(p_uncertainty_a, 0\) \+ coalesce\(p_uncertainty_b, 0\) end/.test(cf)
   && (code.match(/create or replace function public\.dc_site_claims_conflict\(/g) || []).length === 1
   && /public\.dc_site_claims_conflict\([^)]*\)\) disagree,/.test(fn) && !/ST_DistanceSphere/.test(fn),
  '2d: two site claims contradict only beyond their combined quantified error (1 km peer tolerance when neither has one); one definition, and the resolver measures no distance of its own');
ok(/\(b\.decimals <= 1 or b\.basis = 'NON_SITE_AREA'\)\s+and b\.prec = 'exact'\s+then 'PUBLISHER_CLAIMS_EXACT'/.test(fn),
  '2e: a rounded point, or a stated area point, labelled "exact" is flagged, not trusted');
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

// 7. rule_version 2 (2026-09-24): identity first, and a stated area point is not a site.
const guardAt = fn.indexOf('if v_pending > 0 then'), ptsAt = fn.indexOf('create temporary table _geo_pts');
ok(guardAt > -1 && ptsAt > guardAt && /REFUSED_IDENTITY_PENDING/.test(fn),
  '7a: unlinked current evidence refuses the run BEFORE any geography is computed');
ok(/when b\.basis = 'NON_SITE_AREA' then 'GEOGRAPHY_UNRESOLVED'/.test(fn)
   && /when b\.basis = 'NON_SITE_AREA' then 'PUBLISHER_AREA_POINT'/.test(fn),
  '7b: a publisher-stated area point is GEOGRAPHY_UNRESOLVED / PUBLISHER_AREA_POINT');
ok(/cross join lateral public\.dc_location_basis\(o\.source_key, o\.distribution_key,\s*o\.raw_payload\)/.test(ev)
   && !/notes/i.test(ev) && !/notes/i.test(fn),
  '7c: the resolver reads the canonical location-basis RESULT, never the publisher text itself');
ok(/when b\.basis = 'NON_SITE_ROAD' then 'PUBLISHER_ROAD_REFERENCE'/.test(fn)
   && !/'NON_SITE_ROAD' then 'GEOGRAPHY_UNRESOLVED'/.test(fn),
  '7d: a road reference is flagged, never demoted');
ok(/v_rule_version constant integer := 4;/.test(fn), '7e: rule_version is 4 (canonical geography authority, 2026-09-24)');
// 8. rule_version 3: a DERIVED address point is second-class evidence, and never a guess.
ok(/join public\.dc_observation_derived_point dp[\s\S]*?where dp\.verdict = 'ACCEPTED';/.test(ev)
   && (ev.match(/dc_observation_derived_point/g) || []).length === 1
   && (fn.match(/dc_observation_derived_point/g) || []).length === 1,
  '8a: only an ACCEPTED derived point enters geography (the verdict is decided once, in Step 3D)');
const pick = fn.slice(fn.indexOf('create temporary table _geo_pick'), fn.indexOf('create temporary table _geo_out'));
ok(/order by canonical_entity_id,\s*\(evidence_class in \('PUBLISHER_NON_SITE', 'PUBLISHER_UNUSABLE'\)\),\s*\(evidence_class = 'DERIVED_ADDRESS'\),\s*\(prec = 'exact'\) desc nulls last,/.test(pick)
   && !/source_key|uncertainty/.test(pick),
  '8b: the EVIDENCE CLASS decides authority -- publisher site, then derived, then non-site/unusable; the precision label only breaks ties inside a class; no source name, no uncertainty number');
ok(/when b\.basis = 'DERIVED_ADDRESS' and b\.identity_open then 'GEOGRAPHY_UNRESOLVED'/.test(fn)
   && /when b\.basis = 'DERIVED_ADDRESS' and b\.identity_open then 'IDENTITY_UNRESOLVED'/.test(fn)
   && /from public\.dc_entity_identity_open o;/.test(fn) && !/review/i.test(fn),
  '8c: an open cross-source identity question (Step 3A\'s ONE automatic definition) holds a derived point; nothing waits for review');
ok(/when b\.basis = 'DERIVED_ADDRESS' and b\.unstable then 'UNSTABLE_RECORD_IDENTITY'/.test(fn),
  '8f: a derived point never places a record whose identity does not persist across runs');
ok((ev.match(/'DERIVED_ADDRESS'::text/g) || []).length === 2 && /dp\.positional_uncertainty_m,/.test(ev)
   && /'PUBLISHER_NON_SITE'/.test(ev) && /'PUBLISHER_UNUSABLE'/.test(ev) && !/source_key\s*=/.test(ev),
  '8d: a derived point takes part in SOURCES_DISAGREE with its OWN calibrated error; non-site and unusable points are not site claims; the class is read from the evidence, never the source');
// G14 / G15: no facility special case and no source-name authority anywhere on the authority path
// (the evidence view, the contradiction function, the resolver). dc_location_basis dispatches its
// PARSER by source key -- that reads a publisher's own sentence, it does not rank sources.
const authority = ev + cf + fn;
const special = (t) => /lancaster|greenfield|coreweave|17601|17602|\b-?\d{1,3}\.\d{3,}\b/i.test(t);
const byName = (t) => /source_key\s*(=|<>|in)\s*\(?'|'compute_atlas'|'epoch_ai'/.test(t);
ok(!special(authority) && special(authority + " or (b.lat = 40.0379 and b.lng = -76.3055)")
   && special(authority.replace('then 1000', "then 1000 + (case when p_lat_a between 40.037 and 40.049 then 5000 else 0 end)")),
  'G14: no facility, place or coordinate literal on the authority path (an injected Lancaster exception is caught)');
ok(!byName(authority) && byName(authority.replace("(evidence_class = 'DERIVED_ADDRESS'),", "(source_key = 'compute_atlas') desc, (evidence_class = 'DERIVED_ADDRESS'),"))
   && byName(authority + " and a.source_key <> 'epoch_ai'"),
  'G15: no source name decides authority (an injected source-name ranking is caught)');
ok(!/source_native_lat\s*=|update public\.dc_source_observation/.test(fn),
  '8e: geography never writes a coordinate into publisher evidence');
const lb = code.slice(code.indexOf('create or replace function public.dc_location_basis('));
ok(/if p_source_key = 'compute_atlas' then/.test(lb) && /'NO_LOCATION_BASIS_RULE'/.test(lb),
  '7f: the text rule is keyed on its source; every other source is UNSTATED');

ok(!/source_key\s*=\s*'/.test(fn), '6c: no source-specific branch');

console.log(bad ? `\n${bad} FAILED (${n} checks)` : `\nALL CHECKS PASSED (${n} checks)`);
if (bad) process.exit(1);
