// EPOCH CANONICAL GEOGRAPHY — the structural half (the executable half is test/dc_epoch_geography_pg).
//
// The rule is one path: Epoch evidence -> derived location evidence (Step 3D) -> canonical
// identity (Step 3A) -> canonical geography (Step 3B) -> the ONE Map 1 reader. What a PostGIS
// suite cannot see is a SECOND path appearing beside it, or a fixture's facts becoming production
// logic. Those are pinned here, on comment-stripped text, so prose describing a rule can never
// satisfy it.
// Run: node test/dc-epoch-geography-structure.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

const PROD_SQL = ['docs/dc-step3d-derived-location.sql', 'docs/dc-step3a-canonical-identity.sql',
  'docs/dc-step3b-canonical-geography.sql', 'docs/map1-dc-publication.sql',
  'docs/dc-geocode-observations-queue.sql', 'docs/dc-geocode-observations-load.sql'];
const SQL = Object.fromEntries(PROD_SQL.map((f) => [f, stripSql(read(f))]));
const D3 = SQL['docs/dc-step3d-derived-location.sql'];
const A3 = SQL['docs/dc-step3a-canonical-identity.sql'];
const MAP = SQL['docs/map1-dc-publication.sql'];
const LOAD = SQL['docs/dc-geocode-observations-load.sql'];
const WRITER = stripJs(read('scripts/dc-geocode-observations.ts'));
ok(Object.values(SQL).every((s) => s.length > 200) && WRITER.length > 500,
  '0: every production file under test is located and non-empty (positive control)');

// ── M13: fixture facts are never production decision logic ─────────────────────────────────
const FIXTURE_NAMES = /ellendale|coreweave|applied digital|polaris|colossus|minihard|whitehaven|council bluffs|hyperion|58436|38109|51503/i;
const hits = [...PROD_SQL.filter((f) => FIXTURE_NAMES.test(SQL[f])),
  ...(FIXTURE_NAMES.test(WRITER) ? ['scripts/dc-geocode-observations.ts'] : [])];
ok(hits.length === 0, 'M13: no facility, operator, town or ZIP from the fixtures appears in production code', hits.join(','));
ok(FIXTURE_NAMES.test(read('test/dc_epoch_geography_pg/suite.sql')),
  'M13 control: the same pattern DOES match the suite that uses those names (the scan is live)');

// ── M9: no Epoch-specific reader, anywhere a resident or a page could reach ─────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (['node_modules', '.git', 'test', 'docs', 'fixtures', 'dist'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(html|js|mjs|ts|sql|json)$/.test(e.name)) out.push(p);
  }
  return out;
}
const surface = [...walk('lib'), ...walk('partials'), ...walk('supabase'), ...readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && statSync(join(ROOT, f)).isFile())];
ok(surface.length > 50, `M9 control: the resident surface is scanned (${surface.length} files)`);
const epochReaders = surface.filter((f) => /epoch_for_zip|epoch_ai/i.test(read(f)));
ok(epochReaders.length === 0, 'M9: no resident-facing file reads an Epoch-specific object or names the Epoch source', epochReaders.join(','));
ok(!/epoch_for_zip/i.test(Object.values(SQL).join('\n')), 'M9b: no epoch_for_zip is defined in the DDL of record');
ok(!/epoch/i.test(MAP), 'M9c: the ONE Map 1 reader names no source -- Epoch publishes through the canonical plane or not at all');
ok((MAP.match(/create or replace function public\./g) || []).length === 1, 'M9d: the Map 1 reader is still ONE function');

// ── the source rule lives in ONE place, keyed like dc_classify_observation ─────────────────
const input = (D3.match(/create or replace function public\.dc_geocode_input[\s\S]*?\$fn\$;/) || [''])[0];
ok(/if p_source_key = 'epoch_ai' and p_distribution_key = 'data_centers' then/.test(input)
   && /'NO_GEOCODE_RULE'/.test(input), 'S1: the address rule is keyed on source+distribution; every other source is NO_GEOCODE_RULE');
// The only other source-keyed decision is the classifier (Step 2B), keyed the same way.
const classify = (A3.match(/create or replace function public\.dc_classify_observation[\s\S]*?\$fn\$;/) || [''])[0];
const rest = Object.values(SQL).join('\n').replace(input, '').replace(classify, '');
ok(classify.length > 200 && /'epoch_ai'/.test(classify) && !/'epoch_ai'/.test(rest),
  'S1b: production SQL names epoch_ai only in the two source-keyed rules (classifier, address rule)');

// ── the verdict: output quality, fail closed ────────────────────────────────────────────────
const verdict = (D3.match(/create or replace function public\.dc_derived_point_verdict[\s\S]*?\$fn\$;/) || [''])[0];
ok(/elsif p_match_type in \('zip_centroid', 'county_centroid'\) then\s*return query select 'REJECTED_AREA_CENTROID'/.test(verdict),
  'S2: an area centroid is REJECTED, never a site');
ok(/not in \('rooftop', 'parcel_centroid', 'range_interpolated'\) then\s*return query select 'REJECTED_UNKNOWN_MATCH_TYPE'/.test(verdict),
  'S2b: only rooftop / parcel / range-interpolated can be accepted; anything else is REJECTED');
ok(/p_provider_candidates is distinct from 1/.test(verdict) && /q_no <> m_no/.test(verdict),
  'S2c: exactly one provider candidate, and the house number must agree');
ok((verdict.match(/'ACCEPTED'/g) || []).length === 1 && /'ACCEPTED'::text, 2000::double precision/.test(verdict),
  'S2d: ONE accepting branch, carrying the calibrated 2,000 m uncertainty');

// ── derived evidence is its own table, append-only, never copied into source evidence ───────
ok(/create table if not exists public\.dc_address_geocode/.test(D3) && /dc_address_geocode is append-only/.test(D3),
  'S3: derived evidence is a separate, append-only table');
ok(!/source_native_lat|source_native_lon|dc_source_observation/.test(LOAD)
   && (LOAD.match(/\binsert into\b/gi) || []).length === 1 && /insert into public\.dc_address_geocode/.test(LOAD)
   && !/\bupdate\b|\bdelete\b/i.test(LOAD),
  'S3b [M5]: the load writes ONLY dc_address_geocode, inserts only, and never touches publisher evidence');
ok(/in \(select geocoder_query from public\.dc_geocode_queue\)/.test(LOAD) && /= public\.dc_geocode_ladder_version\(\)/.test(LOAD)
   && /on conflict \(geocoder_query, ladder_version\) do nothing/.test(LOAD),
  'S3c: only queued queries at the current ladder version load, and nothing is overwritten');

// ── the writer is the production ladder and nothing else ────────────────────────────────────
ok(/from "\.\.\/supabase\/functions\/get-address-report\/canonical-addr\.ts"/.test(WRITER)
   && /productionLadder,/.test(WRITER) && /resolveGeocode,/.test(WRITER) && /supabaseStore,/.test(WRITER),
  'S4: the writer imports canonicalAddr / productionLadder / resolveGeocode / supabaseStore -- the report engine\'s own');
ok(!/geocoding\.geo\.census\.gov|fetch\(\s*["'`]http/i.test(WRITER) && !/dc_[a-z_]+/.test(WRITER),
  'S4b: the writer calls no geocoder of its own and names no data-centre object (the queue and load are SQL)');

// ── identity: a person is the only cross-source merge ───────────────────────────────────────
const resolver = (A3.match(/create or replace function public\.dc_resolve_canonical[\s\S]*?\$fn\$;/) || [''])[0];
const edge = (resolver.match(/create temporary table _res_edge[\s\S]*?;/) || [''])[0];
ok(/from public\.dc_identity_review r\s*where r\.revoked_at is null and r\.verdict = 'CONFIRMED_MATCH';/.test(edge)
   && !/dc_identity_candidate|dc_identity_decision/.test(edge),
  'S5 [M6 M7]: the only merge edges are active human CONFIRMED_MATCH reviews -- no rule, name, distance or candidate');
const adjud = (A3.match(/create or replace function public\.dc_adjudicate_pair[\s\S]*?\$fn\$;/) || [''])[0];
// A literal CONFIRMED_MATCH exists only in A1 (same source, same publisher record id), BEFORE the
// first cross-source branch; cross-source it can only come from a person's review (rv.verdict).
const crossAt = adjud.indexOf('if a.source_key <> b.source_key then');
ok(/'DERIVED_POINT_NEAR_OTHER_SOURCE_DC'\s*then 'CROSS_SOURCE_DERIVED_POINT_NEARBY'/.test(adjud)
   && crossAt > 0 && !/'CONFIRMED_MATCH'/.test(adjud.slice(crossAt)) && /select rv\.verdict::text/.test(adjud.slice(crossAt)),
  'S5b: the adjudicator never emits CONFIRMED_MATCH from a rule; a nearby derived point is at most POSSIBLE_MATCH');
ok(/rationale\s+text not null/.test(A3) && /char_length\(btrim\(rationale\)\) >= 20|length\(btrim\(rationale\)\) >= 20/.test(A3),
  'S5c: a review must carry a written rationale');

// ── the production apply is GENERATED from the files above, never retyped (claims rule 7) ─────
const gen = spawnSync('python3', [join(ROOT, 'test/dc_epoch_geography_pg/build_apply.py'), '--check'], { encoding: 'utf8' });
ok(gen.status === 0, 'S6: docs/dc-epoch-geography-apply.sql is byte-identical to what the generator emits from the DDL of record', (gen.stdout + gen.stderr).trim());
const APPLY = read('docs/dc-epoch-geography-apply.sql');
ok(APPLY.indexOf('DRIFT: live definition') > 0 && APPLY.indexOf('DRIFT: live definition') < APPLY.indexOf('create or replace function public.dc_geocode_ladder_version')
   && !/create or replace view public\.dc_current_observation/.test(APPLY),
  'S6b: the apply opens with the drift guard and never re-creates dc_current_observation');

console.log(`\n${bad ? bad + ' FAILED' : 'ALL CHECKS PASSED'} (${n} checks)`);
process.exit(bad ? 1 : 0);
