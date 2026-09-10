// PCM-3 — the national ZCTA load and the WGS84 boundary reader
// Run: node test/zcta-boundary-reader.test.mjs
//
// Two things are pinned here, and they fail in opposite directions.
//
// THE LOADER used to be a Box Elder pilot wearing a national name: a county extent chose
// which polygons were parsed AND an ST_Intersects against the same envelope filtered the
// INSERT, which is why production holds 56 rows. Those pins are rewritten, not bypassed —
// so §1 asserts the pilot's selection device is GONE while its canonical-18 subset is still
// REQUIRED PRESENT. A national load that quietly dropped Box Elder would be worse than no
// load at all.
//
// THE READER is a delivery surface for a schema the browser cannot reach, so §3 pins the
// two ways it could lie: shipping stored 4269 as if it were WGS84 (it "looks like" lon/lat
// and would render without complaint), and substituting a circle, envelope or centroid for
// a ZIP nobody has measured. `not_measured` is not `[]` — lib/zip-authoritative.js rule 1,
// from the other side.
let fails = 0;
const ok = (c, name, ev) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (c || ev === undefined ? '' : '\n        ' + ev));
  if (!c) fails++;
};

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const loader = read('scripts/phase2_b1_zcta.py');
const ddlRaw = read('docs/app-zcta-boundary.sql');
// The DDL's comments NAME the things it forbids, so a pin that swept them would fire on the
// file's own explanation of why they are absent. Strip SQL comments before matching.
const ddl = ddlRaw.replace(/^\s*--.*$/gm, '');
// Same for the loader's `#` comments. Docstrings are left in place and the pins below are
// written so a sentence ABOUT a statement cannot be mistaken for the statement.
const py = loader.replace(/^\s*#.*$/gm, '');
const stmtStarts = (src, s) => src.split('\n').some((l) => l.trim().toLowerCase().startsWith(s));

// ── §1 the pilot's selection device is gone ─────────────────────────────────────────────
ok(!/EXPECTED_INSCOPE\s*=\s*56\b/.test(py),
  '1a EXPECTED_INSCOPE is no longer the 56-feature Box Elder count');
ok(/EXPECTED_INSCOPE\s*=\s*EXPECTED_NATIONAL_FEATURES/.test(py),
  '1b ...it is the national count, and the two names are pinned to one number');
ok(/EXPECTED_NATIONAL_FEATURES\s*=\s*33791/.test(py), '1c the archive count is still 33,791');
ok(!/ST_MakeEnvelope/.test(py),
  '1d the INSERT is no longer filtered by the Box Elder envelope — that clause is why '
  + 'production has 56 rows', (loader.match(/.{0,60}ST_MakeEnvelope.{0,60}/) || [])[0]);
ok(!/EXT_XMIN|EXT_YMAX/.test(py), '1e the county extent constants are gone entirely');
ok(!/def exact_hits|def bbox_hits/.test(py), '1f ...and so are the predicates that applied them');
ok(/national feature count \{n_dbf\} != /.test(py) && /do not adopt it silently/.test(loader),
  '1g a count mismatch still STOPS — the shapefile stays authoritative over TIGERweb');

// ── §2 the load shape: batch + swap, never one inline INSERT, never create schema ───────
ok(!stmtStarts(py, 'create schema geo'),
  '2a `create schema geo` is not a statement in the load path — geo is live and holds N5');
ok(!stmtStarts(py, 'create table geo.zcta_boundary ('),
  '2b ...and the live table is not recreated');
ok(!/truncate geo\.zcta_boundary\b(?!_load)/.test(py),
  '2c ...and never truncated-then-refilled: a failed batch would leave a partial nation '
  + 'where Box Elder used to be');
ok(/LOAD_TABLE\s*=\s*"geo\.zcta_boundary_load"/.test(py), '2d the load lands in a separate table');
ok(/insert_batched\(/.test(py),
  '2e ...inserted through the EXISTING adaptive batcher (n5_shard), not a second one');
ok(/import n5_shard as S/.test(py) && /SQLPayloadTooLarge/.test(py),
  '2f ...which is what splits on the server\'s own 413 rather than a guessed byte budget');
ok(/alter table geo\.zcta_boundary rename to/.test(py)
   && /alter table \{LOAD_TABLE\} rename to zcta_boundary/.test(py),
  '2g the swap is a rename inside one transaction, so no reader sees 56 old rows plus a '
  + 'partial nation');
ok(/enable row level security/.test(py) && !/force row level security/i.test(py),
  '2h RLS is enabled on the live table and NOT forced — the definer function has to read it');
ok(!/insert into geo\.zcta_boundary \(/.test(py),
  '2i nothing inserts directly into the live table');

// ── §2b the canonical subset is still required, and it is a SUBSET now ─────────────────
const canon = (loader.match(/CANONICAL_18 = \(\s*"([^"]+)"\s*\n?\s*"([^"]*)"\s*\)/) || []);
const canonList = (loader.match(/CANONICAL_18 = \(([\s\S]*?)\)\.split/) || [, ''])[1];
const zips = (canonList.match(/\d{5}/g) || []);
ok(zips.length === 18, '2j CANONICAL_18 still lists exactly 18 ZIPs', String(zips.length));
ok(zips.includes('84302'), '2k ...including 84302, the ZIP the reader is proven against live');
ok(/canonical Box Elder ZIPs missing from load/.test(py),
  '2l ...and the load still STOPS if any of them is absent — a required subset, not the set');

// ── §3 the reader: explicit transform, and never a substituted shape ───────────────────
ok(/create or replace function public\.app_zcta_boundary\(p_zip text\)/.test(ddl),
  '3a the reader exists at the contracted name');
ok(/security definer/.test(ddl) && /set search_path to 'public', 'geo', 'pg_temp'/.test(ddl),
  '3b SECURITY DEFINER with a fixed search_path');
ok(!/execute format|EXECUTE '/.test(ddl), '3c no dynamic SQL');
ok(/ST_AsGeoJSON\(ST_Transform\(v_geom, 4326\)\)::jsonb/.test(ddl),
  '3d the transform to 4326 is EXPLICIT and wraps the geometry before ST_AsGeoJSON — '
  + 'stored 4269 looks like lon/lat and would render without complaint');
ok(/'srid', 4326/.test(ddl), '3e ...and the payload says which CRS it is');
ok(!/ST_Buffer|ST_MakeEnvelope|radiusMi|ST_Centroid|ST_PointOnSurface/.test(ddl),
  '3f no circle, envelope or centroid is ever returned as a stand-in for a boundary',
  (ddlRaw.match(/.{0,50}(ST_Buffer|ST_MakeEnvelope|ST_Centroid).{0,50}/) || [])[0]);
ok(/'status', 'not_measured'/.test(ddl) && /'geometry', null/.test(ddl),
  '3g a ZIP with no polygon returns not_measured + null geometry');
ok(/'status', 'boundary_complete'/.test(ddl), '3h ...and a stored one returns boundary_complete');
ok(/ST_GeometryType\(v_geom\) not in \('ST_Polygon', 'ST_MultiPolygon'\)/.test(ddl),
  '3i a stored non-areal geometry is treated as no usable polygon, never coerced');
ok(/p_zip !~ '\^\[0-9\]\{5\}\$'/.test(ddl) && /errcode = '22023'/.test(ddl),
  '3j an invalid ZIP raises 22023, the same refusal shape as app_zip_projects_markers');

// ── §4 privileges: the function is the surface, the schema is not ──────────────────────
ok(!/grant\s+usage\s+on\s+schema\s+geo/i.test(ddl),
  '4a the DDL never grants USAGE on schema geo — that would expose every geo table via PostgREST',
  (ddlRaw.match(/.{0,60}usage on schema geo.{0,60}/i) || [])[0]);
ok(/revoke all on function public\.app_zcta_boundary\(text\) from public;/.test(ddl),
  '4b EXECUTE is revoked from PUBLIC first');
ok(/grant execute on function public\.app_zcta_boundary\(text\) to authenticated, service_role;/.test(ddl),
  '4c ...then granted to authenticated and service_role');
ok(!/grant[\s\S]{0,80}to\s+anon\b/.test(ddl) && !/to anon, authenticated/.test(ddl),
  '4d ...and NEVER GRANTED to anon: ZIP context visualization is the authenticated A-022 '
  + 'posture, and the public ZIP document is the protected acquisition surface');
// 4e EXISTS BECAUSE 4d WAS TRUE AND NOT ENOUGH. This project's default privileges grant
// `anon` EXECUTE on new functions in schema public, so after the first deploy — which
// revoked PUBLIC and granted only authenticated/service_role — the live
// has_function_privilege('anon', …) was STILL TRUE. `PUBLIC` is the pseudo-role every role
// inherits; `anon` is a NAMED role holding its own grant, and revoking one does not touch
// the other. A file that never grants anon is not a file that leaves anon without the
// grant, and only the database can tell you which you have.
ok(/revoke all on function public\.app_zcta_boundary\(text\) from anon;/.test(ddl),
  '4e ...and anon is revoked EXPLICITLY, not merely left ungranted — default privileges '
  + 'hand it EXECUTE otherwise');

// ── §5 PCM-4 is still not started ──────────────────────────────────────────────────────
// §8 of test/place-context-map.test.mjs owns this too; these are the two that would move
// first if this unit drifted into building the ZIP map.
ok(!/lib\/map\.js/.test(read('scripts/gen_zip_pages.py')),
  '5a the generator still loads no map code');
ok(!/HS\.buildLive/.test(read('lib/community-page.js')),
  '5b the shared ZIP runtime still draws no map');
ok(!/app_zcta_boundary/.test(read('lib/community-page.js')),
  '5c ...and does not call the new reader — PCM-4 is a separate unit');
ok(!/server\.arcgisonline\.com/.test(read('community.html')),
  '5d community.html CSP is still unwidened');

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
