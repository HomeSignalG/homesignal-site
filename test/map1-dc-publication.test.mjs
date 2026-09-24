// THE ONE MAP 1 DATA-CENTRE CONTRACT — offline structural gate.
//
// public.map1_dc_zip_members (docs/map1-dc-publication.sql) is the only data-centre read any
// resident surface may make. The behaviour (what publishes, membership, dedupe, idempotency,
// grants) is proven on a disposable PostGIS by test/map1_dc_publication_pg (10 mutations);
// this file pins the STRUCTURE that suite cannot see: which reads the resident code makes, that
// no second reader or source-specific reader exists anywhere in the repo, and that the SQL
// carries no place, project or source special case.
//
// Run: node test/map1-dc-publication.test.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d === undefined ? '' : '  ' + JSON.stringify(d))); } };
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const stripSql = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|[^:"'\\])\/\/.*$/, '$1')).join('\n');

// ── A. THE SQL OF RECORD ─────────────────────────────────────────────────────────────────
const SQL = stripSql(read('docs/map1-dc-publication.sql'));
const fnStart = SQL.indexOf('create or replace function public.map1_dc_zip_members(');
const FN = fnStart > -1 ? SQL.slice(fnStart, SQL.indexOf('$function$;', fnStart)) : '';
ok(FN.length > 1500 && /geo\.zip_point_membership_in/.test(FN), 'A0 the contract body is located (positive control)');
ok((SQL.match(/create or replace function public\./g) || []).length === 1, 'A1 the file defines exactly ONE public function');
ok(/security definer/.test(FN) && /set search_path to 'public', 'geo', 'pg_temp'/.test(FN),
  'A2 SECURITY DEFINER with a pinned search_path (reads the private planes, exposes only its columns)');
ok(/grant execute on function public\.map1_dc_zip_members\(text\) to anon, authenticated, service_role;/.test(SQL)
   && !/grant\s+select/i.test(SQL), 'A3 anon gets EXECUTE on the contract and SELECT on nothing');
ok(/verdict = 'member'/.test(FN) && (FN.match(/geo\.zip_point_membership_in\(/g) || []).length === 1,
  'A4 membership is decided ONCE, by the canonical point predicate');
// The ONE distance in the contract is the positional-uncertainty disk (2026-09-24). It can only
// REMOVE a point from membership (zcta_hits > 1 withholds it) -- it never admits one. So A5 holds
// for the contract with that single expression cut out, and the expression itself is pinned.
const DISK = (FN.match(/else\s*\(select count\(\*\) from geo\.zcta_boundary z[\s\S]*?\)\)\s*end as zcta_hits/) || [''])[0];
ok(DISK.length > 100 && (FN.match(/ST_DWithin/g) || []).length === 1 && /ST_DWithin/.test(DISK)
   && /p\.positional_uncertainty_m\)\)/.test(DISK) && /zcta_hits <= 1/.test(FN),
  'A5a the only distance is the uncertainty disk, counted into zcta_hits, which can only withhold');
ok(!/ST_DWithin|ST_Buffer|ST_Centroid|home_lat|home_lng|p_radius|radius|nearest/i.test(FN.replace(DISK, '')),
  'A5 no radius, buffer, centroid, home point or nearest-anything anywhere else in the contract');
ok(/null::numeric as distance_mi/.test(FN), 'A6 no distance is returned — ZIP mode has no home');
ok(/e\.classification = 'CONFIRMED_DC'/.test(FN) && !/'DC_CANDIDATE'|'NON_DC'/.test(FN),
  'A7 only CONFIRMED_DC publishes; no other classification is named as publishable');
ok(/ge\.geography_status = 'RESOLVED'/.test(FN) && /ge\.geometry_type = 'POINT'/.test(FN),
  'A8 only RESOLVED point geography publishes (never GEOGRAPHY_UNRESOLVED, never NOT_A_SITE)');
ok(!/publisher_precision\s*=\s*'exact'\s*(and|or|then\s+'RESOLVED')/.test(FN) && !/source_native_precision/.test(FN),
  'A9 publisher "exact" is never geographic authority — it only labels location_precision');
const life = (FN.match(/lifecycle\(v, map_status\) as \(values([\s\S]*?)\)\),/) || ['', ''])[1];
ok(/'operational',\s*'Operating'/.test(life) && /'proposed',\s*'Proposed'/.test(life) && !/cancel|shelved|blocked|unknown/.test(life),
  'A10 ONE lifecycle map: proposed is Proposed; cancelled/shelved/blocked/unknown never publish', life.trim());
ok(!/stratos|lucin|snowville|box elder|utah|84336|84313|84307|41\.5|-113\.5/i.test(SQL),
  'A11 no place-, project- or ZIP-specific logic');
const canon = (FN.match(/canon as \(([\s\S]*?)\n\s*osm as \(/) || ['', ''])[1];
ok(canon.length > 500 && !/source_key\s*=\s*'|source_key\s+in\s*\(/.test(canon),
  'A12 the canonical half never filters by source — a new source publishes with no change here');
ok(/'legacy_osm_compat'/.test(FN) && /RETIREMENT CONDITION/.test(read('docs/map1-dc-publication.sql')),
  'A13 the OSM compatibility population is labelled on every row and carries a written retirement condition');

// ── B. EVERY RESIDENT SURFACE READS THE ONE CONTRACT, AND ONLY IT ────────────────────────
const LIB = stripJs(read('lib/data.js'));
ok(/HS\.MAP1_DC_RPC = 'map1_dc_zip_members';/.test(LIB), 'B0 lib/data.js names the one contract');
ok(/sb\(\)\.rpc\(HS\.MAP1_DC_RPC, \{ p_zip: zip \}\)/.test(LIB), 'B1 lib/data.js::nationalDataCenters reads it, with no radius');
ok(/outcome\.records\.map\(HS\.map1DcSite\)/.test(LIB), 'B2 lib/data.js maps rows through the one mapper');
ok(/status: r\.map_status,/.test(LIB) && !/normalized_status === 'operational' \? 'Operating' : 'Approved'/.test(LIB),
  'B3 the pin status is the server map_status — the client lifecycle collapse is gone');
const PAGE = stripJs(read('homesignalmap.html'));
ok(/rest\/v1\/rpc\/" \+ HS\.MAP1_DC_RPC/.test(PAGE) && /natl\.records\.map\(HS\.map1DcSite\)/.test(PAGE),
  'B4 homesignalmap.html reads the one contract through the one mapper');
ok(!/normalized_status === "operational" \? "Operating" : "Approved"/.test(PAGE),
  'B5 the page carries no lifecycle mapping of its own');

// Every resident-facing file: root pages + lib + partials + shell. No second data-centre reader.
function walk(dir, out) {
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = join(dir, f);
    const st = statSync(join(ROOT, p));
    if (st.isDirectory()) { if (!/^(node_modules|\.git|test|docs|scripts|supabase|\.github)$/.test(f)) walk(p, out); }
    else if (/\.(html|js|mjs)$/.test(f)) out.push(p);
  }
  return out;
}
const RESIDENT = walk('.', []).filter((p) => !p.startsWith('seed/'));
ok(RESIDENT.length > 40, 'B6 the resident scan covers the site (positive control)', RESIDENT.length);
const FORBIDDEN = /\b(national_dc_for_zip|national_dc_zip_members|atlas_for_zip|epoch_for_zip|atlas_map1|epoch_map1|dc_canonical_entity|dc_entity_geography|national_dc_records)\b/;
const hits = RESIDENT.filter((p) => FORBIDDEN.test(stripJs(read(p))));
ok(hits.length === 0, 'B7 no resident file calls a radius reader, a source-specific reader or a private table', hits);
const callers = RESIDENT.filter((p) => /HS\.MAP1_DC_RPC/.test(stripJs(read(p))));
ok(callers.sort().join(',') === 'homesignalmap.html,lib/data.js',
  'B8 exactly the two known surfaces read the contract, both through HS.MAP1_DC_RPC', callers);

// ── C. NO SECOND PUBLICATION CONTRACT ANYWHERE IN THE REPO ───────────────────────────────
function walkAll(dir, out) {
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = join(dir, f);
    if (/^(node_modules|\.git)$/.test(f)) continue;
    const st = statSync(join(ROOT, p));
    if (st.isDirectory()) walkAll(p, out); else if (/\.(sql|js|mjs|html)$/.test(f)) out.push(p);
  }
  return out;
}
const ALL = walkAll('.', []);
const defs = ALL.filter((p) => /create\s+(or\s+replace\s+)?function\s+public\.(atlas|epoch)_\w*(for_zip|map1)\w*\s*\(/i.test(read(p)));
ok(defs.length === 0, 'C1 no source-specific ZIP reader is defined anywhere', defs);
const readers = ALL.filter((p) => /create\s+or\s+replace\s+function\s+public\.map1_dc_\w+\s*\(/i.test(read(p)))
  .filter((p) => !p.startsWith('test/'));
// The ONE exception is a GENERATED production apply, and only while it is byte-identical to what its
// generator emits from the file of record (test/dc-epoch-geography-structure.test.mjs S6 pins the
// same). A hand-edited copy fails the generator check and is counted as a second definition again.
const GENERATED_APPLY = 'docs/dc-epoch-geography-apply.sql';
const genOk = spawnSync('python3', ['test/dc_epoch_geography_pg/build_apply.py', '--check'], { encoding: 'utf8' }).status === 0;
const ofRecord = readers.filter((p) => !(p === GENERATED_APPLY && genOk));
ok(ofRecord.join(',') === 'docs/map1-dc-publication.sql', 'C2 exactly ONE file of record defines a map1_dc_* function (a generated apply counts unless it is byte-identical to its generator output)', readers);

console.log(bad ? `\n${bad} FAILED (${n} checks)` : `\nALL CHECKS PASSED (${n} checks)`);
if (bad) process.exit(1);
