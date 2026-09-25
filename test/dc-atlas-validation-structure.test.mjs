// ATLAS COORDINATE VALIDATION — the structural half (the executable half is test/dc_atlas_validation_pg).
//
// A publisher's own street address now checks that publisher's own point, through the SAME derived-
// address evidence, the SAME geography authority and the SAME Map 1 reader as every other source.
// What a PostGIS suite cannot see is a SECOND path appearing beside that one: a second geocoder, an
// Atlas-specific geography rule, a provider ZIP read by a decision, or the admission switch flipped
// without review. Those are pinned here, on comment-stripped text, each with a positive control so
// a silent scan cannot pass.
// Run: node test/dc-atlas-validation-structure.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

const D3 = stripSql(read('docs/dc-step3d-derived-location.sql'));
const A3 = stripSql(read('docs/dc-step3a-canonical-identity.sql'));
const B3 = stripSql(read('docs/dc-step3b-canonical-geography.sql'));
const MAP = stripSql(read('docs/map1-dc-publication.sql'));
const LOAD = stripSql(read('docs/dc-geocode-observations-load.sql'));
const QUEUE = read('docs/dc-geocode-observations-queue.sql');
const fn = (name, src, end = '\\$fn\\$;') => (src.match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?' + end)) || [''])[0];
ok([D3, A3, B3, MAP, LOAD].every((s) => s.length > 400), '0: every production file under test is located and non-empty (positive control)');

// ── ONE extraction per source schema; ONE policy for every source ────────────────────────────
const extract = fn('dc_publisher_stated_address', D3);
const policy = fn('dc_geocodable_site_address', D3);
const input = fn('dc_geocode_input', D3);
ok(/if p_source_key = 'compute_atlas' and p_distribution_key = 'facilities' then/.test(extract)
   && /loc->>'street'/.test(extract) && /loc->>'postalCode'/.test(extract),
  'A1: Atlas addresses are EXTRACTED from the publisher\'s own location fields, in the extraction function');
const atlasOutsideExtraction = (D3.replace(extract, '')).match(/'compute_atlas'/g) || [];
ok(atlasOutsideExtraction.length === 0,
  'A2: Step 3D names compute_atlas ONLY in the extraction: no Atlas geocodability rule, no Atlas verdict, no Atlas admission yet',
  atlasOutsideExtraction.length);
ok(policy.length > 400 && !/source|atlas|epoch/i.test(policy) && !/p_source_key\s*(=|<>|in)|'compute_atlas'|'epoch_ai'/.test(input),
  'A3: the geocodability policy and its composition know no source (one rule for every publisher)');
ok(/dc_publisher_stated_address\(/.test(input) && /dc_geocodable_site_address\(/.test(input),
  'A3b: dc_geocode_input is exactly extraction -> policy');

// ── THE ADMISSION GATE: acquired != admitted. Admitting Atlas is a reviewed, deliberate edit ─────
const admit = fn('dc_derived_address_admitted', D3, '\\$\\$;');
ok(/in \(\('epoch_ai', 'data_centers'\)\)/.test(admit) && !/compute_atlas/.test(admit),
  'A4: Atlas derivations are ACQUIRED but NOT ADMITTED: its admission waits for the national dry run to be reviewed '
  + '(admitting it is a deliberate edit of this function AND of this pin -- never a side effect)');
const ev = (B3.match(/create or replace view public\.dc_entity_geography_evidence[\s\S]*?;/) || [''])[0];
const res = fn('dc_resolve_geography', B3);
const cand = (A3.match(/create or replace view public\.dc_identity_candidate[\s\S]*?;\n/) || [''])[0];
ok(/dp\.verdict = 'ACCEPTED'\s+and dp\.admitted/.test(ev) && /where dp\.admitted/.test(res) && /and d\.admitted/.test(cand),
  'A5: every consumer of derived evidence reads only ADMITTED derivations: the geography evidence, the geography provenance, and identity candidate K3');
ok(!/admitted/.test(stripSql(QUEUE).replace(/order by \(not q\.admitted\)/, '')) && /order by \(not q\.admitted\), q\.geocoder_query collate "C"/.test(QUEUE)
   && /limit :dcg_batch/.test(QUEUE),
  'A6: the queue acquires regardless of admission, admitted work first, in a deterministic resumable batch');

// ── ONE geocoder ─────────────────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(ts|mjs|js|sql|sh|py|yml)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...walk('scripts'), ...walk('docs'), ...walk('supabase'), ...walk('.github')];
ok(files.length > 100, `G0: the repo is scanned (${files.length} files; positive control)`);
const code = files.filter((f) => /\.(ts|mjs|js)$/.test(f));
const ladderUsers = code.filter((f) => /productionLadder|resolveGeocode/.test(stripJs(read(f))) && !/supabase\/functions\/get-address-report\//.test(f));
ok(ladderUsers.sort().join(',') === 'scripts/dc-geocode-observations.ts,scripts/dc-geocode-probe.ts',
  'X17a: outside the report engine that owns it, the ONE production ladder is driven only by the DC writer and its read-only probe', ladderUsers.join(','));
const writers = files.filter((f) => /insert\s+into\s+public\.dc_address_geocode/i.test(stripSql(read(f))));
ok(writers.join(',') === 'docs/dc-geocode-observations-load.sql',
  'X17b: derived location evidence has exactly ONE write path, the load SQL', writers.join(','));
// every data-centre file: the dc-* scripts, workflows and DDL, the Map 1 reader and the zip authority
const dcFiles = files.filter((f) => /(^|\/)(dc[-_]|map1[-_]|zip-membership)/.test(f));
const PROVIDER = /geocoding\.geo\.census\.gov|nominatim|googleapis\.com\/maps\/api\/geocode|api\.mapbox\.com\/geocoding/i;
const providerCalls = dcFiles.filter((f) => PROVIDER.test(read(f)));
ok(dcFiles.length > 20 && providerCalls.length === 0 && PROVIDER.test(read('supabase/functions/get-address-report/geocode-cache.ts')),
  `X17c: no data-centre file (${dcFiles.length}) calls a geocoding provider directly; only the ladder's own module does (control)`, providerCalls.join(','));
ok(!/net\.http_|http_get|http_post/i.test(D3 + A3 + B3 + MAP), 'X17d: no SQL on the chain calls out over HTTP');
const WRITER = stripJs(read('scripts/dc-geocode-observations.ts'));
ok(!/atlas|compute_atlas|epoch/i.test(WRITER), 'X17e: the writer is source-blind: it derives what the queue holds, nothing source-specific');

// ── PROVIDER ZIP IS DIAGNOSTIC ONLY; MEMBERSHIP IS THE POLYGON ───────────────────────────────
const zipRead = /right\([^)]*matched_address[^)]*,\s*5\)|split_part\([^)]*matched_address[^)]*,\s*4\)|matched_address[^,\n]*~\s*'\\d\{5\}/;
ok(!zipRead.test(B3 + MAP + A3) && zipRead.test("right(dp.matched_address, 5)"),
  'X04s: no decision reads the provider\'s postal ZIP out of matched_address (the pattern is live: it matches an injected read)');
ok((MAP.match(/geo\.zip_point_membership_in\(/g) || []).length === 1 && !/ST_Centroid|nearest|<->/i.test(MAP),
  'X13s-X15s: Map 1 membership is the ONE polygon authority -- no centroid, no nearest-ZIP, no KNN');

// ── NO ATLAS-SPECIFIC GEOGRAPHY, NO SOURCE PAIRING ───────────────────────────────────────────
const authority = ev + fn('dc_site_claims_conflict', B3, '\\$\\$;') + res;
ok(authority.length > 3000 && !/'compute_atlas'|'epoch_ai'|source_key\s*(=|<>|<|>)\s*'/.test(authority),
  'X07s: no source literal on the authority path (evidence classes, conflict, resolver)');
ok(!/[ab]\.source_key\s*<\s*[ab]\.source_key/.test(res) && (res.match(/\(a\.source_key, a\.evidence_class, a\.oid\) < \(b\.source_key, b\.evidence_class, b\.oid\)/g) || []).length === 2,
  'X06s: claims are paired by claim, not by source (a publisher\'s point meets the geocode of its own address)');

// ── ZERO HUMAN ───────────────────────────────────────────────────────────────────────────────
const all = [D3, A3, B3, MAP, LOAD].join('\n');
ok(!/create table[^;]*(review|override|manual|queue)/i.test(all),
  'Z: no review / override / manual table exists on the production path (the queue is a derived VIEW of work, not a human queue)');

// ── the apply for this change is GENERATED, never retyped ────────────────────────────────────
const gen = spawnSync('python3', [join(ROOT, 'test/dc_atlas_validation_pg/build_apply.py'), '--check'], { encoding: 'utf8' });
ok(gen.status === 0, 'P1: docs/dc-atlas-validation-apply.sql is byte-identical to what its generator emits from the DDL of record', (gen.stdout + gen.stderr).trim());
const APPLY = read('docs/dc-atlas-validation-apply.sql');
ok(APPLY.indexOf('DRIFT:') > 0 && APPLY.indexOf('DRIFT:') < APPLY.indexOf('create or replace function public.dc_publisher_stated_address')
   && !/create or replace function public\.map1_dc_zip_members/.test(APPLY) && !/create table|alter table/i.test(stripSql(APPLY)),
  'P2: the apply opens with its drift guard, adds no table, alters no table, and does not touch the Map 1 reader');

console.log(`\n${bad ? bad + ' FAILED' : 'ALL CHECKS PASSED'} (${n} checks)`);
process.exit(bad ? 1 : 0);
