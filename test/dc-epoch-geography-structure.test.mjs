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
// 2026-09-24: the address rule is TWO functions -- per-source SCHEMA extraction, then ONE generic
// geocodability policy -- composed by dc_geocode_input, which names no source.
const input = (D3.match(/create or replace function public\.dc_geocode_input[\s\S]*?\$fn\$;/) || [''])[0];
const extract = (D3.match(/create or replace function public\.dc_publisher_stated_address[\s\S]*?\$fn\$;/) || [''])[0];
const policy = (D3.match(/create or replace function public\.dc_geocodable_site_address[\s\S]*?\$fn\$;/) || [''])[0];
const admit = (D3.match(/create or replace function public\.dc_derived_address_admitted[\s\S]*?\$\$;/) || [''])[0];
ok(/if p_source_key = 'epoch_ai' and p_distribution_key = 'data_centers' then/.test(extract)
   && /'NO_RULE'/.test(extract) && /'NO_GEOCODE_RULE'/.test(input) && /dc_geocodable_site_address/.test(input)
   && !/p_source_key\s*=|'epoch_ai'|'compute_atlas'/.test(input) && !/source|'epoch_ai'|'compute_atlas'/i.test(policy.replace(/-- .*$/gm, ''))
   && policy.length > 400,
  'S1: extraction is keyed on source+distribution (every other source NO_GEOCODE_RULE); the geocodability policy and the composition name no source');
// Every source-keyed rule is a function keyed like dc_classify_observation; production SQL names
// epoch_ai nowhere else -- in particular not in the resolver, the adjudicator, geography or the reader.
const fnOf = (name, src) => (src.match(new RegExp('create or replace function public\\.' + name + '[\\s\\S]*?\\$fn\\$;')) || [''])[0];
const classify = fnOf('dc_classify_observation', A3);
const siteAddr = fnOf('dc_site_address', A3);
const citation = fnOf('dc_record_citation', A3);
const rest = Object.values(SQL).join('\n').replace(extract, '').replace(classify, '').replace(siteAddr, '').replace(citation, '').replace(admit, '');
ok([classify, extract, siteAddr, citation].every((f) => f.length > 200 && /'epoch_ai'/.test(f)) && /'epoch_ai'/.test(admit) && !/'epoch_ai'/.test(rest),
  'S1b: production SQL names epoch_ai only in the source-keyed rules (classifier, address extraction, site address, citation) and the admission gate');
ok(/'NO_SITE_ADDRESS_RULE'/.test(siteAddr), 'S1c: a source with no site-address rule gets no automatic cross-source identity');

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

// ── identity: AUTOMATIC, and no person anywhere in the loop ────────────────────────────────
const resolver = (A3.match(/create or replace function public\.dc_resolve_canonical[\s\S]*?\$fn\$;/) || [''])[0];
const edge = (resolver.match(/create temporary table _res_edge[\s\S]*?;/) || [''])[0];
ok(/from _res_decision d\s*where d\.decision_state = 'CONFIRMED_MATCH'/.test(edge)
   && /d\.rank_a < 2 and d\.rank_b < 2/.test(edge) && !/review|union/i.test(edge),
  'S5 [M1-M7]: merge edges are THIS run\'s automatic CONFIRMED_MATCH decisions between stable records -- nothing else, no person');
const adjud = (A3.match(/create or replace function public\.dc_adjudicate_pair[\s\S]*?\$fn\$;/) || [''])[0];
// Cross-source, a literal CONFIRMED_MATCH comes from exactly ONE branch: the exact site address,
// after every guard. A nearby derived point, a name, an operator are never more than POSSIBLE.
const crossAt = adjud.indexOf('if a.source_key <> b.source_key');
const crossPart = adjud.slice(crossAt);
ok(crossAt > 0 && (crossPart.match(/'CONFIRMED_MATCH'/g) || []).length === 1
   && /'CONFIRMED_MATCH'::text, 'AUTO_EXACT_SITE_ADDRESS'::text/.test(crossPart)
   && /p_candidate_rule_key = 'EXACT_SITE_ADDRESS'/.test(crossPart)
   && /'DERIVED_POINT_NEAR_OTHER_SOURCE_DC'\s*then 'CROSS_SOURCE_DERIVED_POINT_NEARBY'/.test(adjud),
  'S5b: cross-source CONFIRMED_MATCH has ONE branch -- the guarded exact site address; proximity is at most POSSIBLE_MATCH');
const guards = ['EXACT_ADDRESS_SHARED_WITHIN_SOURCE', 'EXACT_ADDRESS_NOT_BOTH_DATA_CENTRES', 'EXACT_ADDRESS_AGGREGATE_RECORD',
  'EXACT_ADDRESS_POSTAL_CONFLICT', 'EXACT_ADDRESS_SIBLING_DESIGNATION_CONFLICT'];
const matchAt = crossPart.indexOf("'CONFIRMED_MATCH'::text, 'AUTO_EXACT_SITE_ADDRESS'");
ok(guards.every((g) => crossPart.indexOf("'" + g + "'") > 0 && crossPart.indexOf("'" + g + "'") < matchAt),
  'S5c: every measured guard is checked BEFORE the automatic match can be returned', guards.join(','));
const allProd = Object.values(SQL).join('\n') + WRITER;
ok(!/dc_identity_review|reviewer|REVIEWED_|WAITING_FOR|NEEDS_(HUMAN_)?REVIEW|MANUAL_REVIEW/i.test(allProd),
  'Z: no human-review table, reviewer field, reviewed state or review queue exists anywhere on the production path');

// ── the production apply is GENERATED from the files above, never retyped (claims rule 7) ─────
const gen = spawnSync('python3', [join(ROOT, 'test/dc_epoch_geography_pg/build_apply.py'), '--check'], { encoding: 'utf8' });
ok(gen.status === 0, 'S6: docs/dc-epoch-geography-apply.sql is the FROZEN artifact #1324 applied (generated from the DDL of record at the time; never regenerated since)', (gen.stdout + gen.stderr).trim());
const APPLY = read('docs/dc-epoch-geography-apply.sql');
ok(APPLY.indexOf('DRIFT: live definition') > 0 && APPLY.indexOf('DRIFT: live definition') < APPLY.indexOf('create or replace function public.dc_geocode_ladder_version')
   && !/create or replace view public\.dc_current_observation/.test(APPLY),
  'S6b: the apply opens with the drift guard and never re-creates dc_current_observation');

// ── the production dry run locks nothing live (2026-09-24: a first version held ACCESS EXCLUSIVE on
//    public.dc_entity_geography for ~7 minutes and one resident map1 call returned 500) ────────────
const selfTest = spawnSync('python3', [join(ROOT, 'test/dc_epoch_geography_pg/build_apply.py'), '--self-test'], { encoding: 'utf8' });
ok(selfTest.status === 0, 'S7: the dry run\'s live-target refusal refuses every live-object statement class', (selfTest.stdout + selfTest.stderr).trim());
const dry = spawnSync('python3', [join(ROOT, 'test/dc_epoch_geography_pg/build_apply.py'), '--dryrun-body', 'dcdry'], { encoding: 'utf8' });
ok(dry.status === 0 && /^create schema dcdry;/.test(dry.stdout) && /create or replace function dcdry\.map1_dc_zip_members\(/.test(dry.stdout)
   && !/create or replace (function|view) public\.|alter table public\./.test(dry.stdout),
  'S7b: the dry run builds the whole changed chain in its scratch schema and changes no live object', dry.stderr.trim());
const wf = read('.github/workflows/dc-epoch-dryrun.yml');
const rep = read('scripts/dc-epoch-replica-dryrun.sh');
const prodUses = rep.split('\n').filter((l) => /\$PROD_DB_URL|\$\{PROD_DB_URL/.test(l) && !/^\s*#/.test(l) && !/:\s*"\$\{PROD_DB_URL:\?\}"/.test(l));
ok(/bash scripts\/dc-epoch-replica-dryrun\.sh/.test(wf) && /bash test\/dc_epoch_geography_pg\/replica_offline\.sh/.test(wf)
   && !/--dryrun-body|\bbegin;|\brollback;|\bcommit;|\\i /.test(wf) && /services:\s*\n(\s*#.*\n)*\s*postgis:/.test(wf),
  'S7c: the dry-run workflow runs no SQL of its own against production: every change is in a disposable PostGIS service');
ok(prodUses.length === 1 && /psql "\$PROD_DB_URL"/.test(prodUses[0])
   && /default_transaction_read_only=on/.test(rep) && /lock_timeout=2s/.test(rep)
   && /\\\\copy \(\$q\) to/.test(rep),
  'S7d: production is reached from exactly ONE line -- prod_select -- as a READ ONLY, short-lock-timeout COPY of a SELECT',
  prodUses.join(' / '));


// The replica runs PRODUCTION'S geometry engine, and says so or refuses (2026-09-24: a PostGIS 3.5
// replica was used to predict a 3.3.7 production).
ok(/image: supabase\/postgres:17\.6\.1\.127/.test(wf)
   && /cmp -s "\$w\/prod_engine\.csv" "\$w\/rep_engine\.csv"/.test(rep) && /REFUSED: the replica's geometry engine is not production's/.test(rep)
   && /postgis_full_version\(\)/.test(rep),
  'S7e: the replica is production\'s own database image, and the run refuses unless postgis_full_version() matches production byte for byte');
// The negative-control seam reaches ONLY the local replica, and nothing in CI sets it.
const seam = rep.split('\n').filter((l) => /DRYRUN_TEST_TAMPER_REPLICA_SQL/.test(l) && !/^\s*#/.test(l));
ok(seam.length === 2 && seam.every((l) => !/PROD_DB_URL|prod_select/.test(l)) && seam.some((l) => /L -d "\$REP"/.test(l))
   && !/DRYRUN_TEST_TAMPER_REPLICA_SQL/.test(wf) && /REPLICA_PARITY_NEGATIVE_CONTROL PASS/.test(read('test/dc_epoch_geography_pg/replica_offline.sh')),
  'S7f: the parity negative control tampers with the REPLICA only, is exercised offline, and is never set by the workflow', seam.join(' / '));

console.log(`\n${bad ? bad + ' FAILED' : 'ALL CHECKS PASSED'} (${n} checks)`);
process.exit(bad ? 1 : 0);
