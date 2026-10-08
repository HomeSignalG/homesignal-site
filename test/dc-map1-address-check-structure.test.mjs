// STEP 11 (C5) — EVERY MAP 1 DATA-CENTRE MARKER CARRIES ONE ADDRESS-CHECK STATE AND ONE DERIVED REASON.
// The structural half; the executable half is test/dc_map1_address_check_pg/run.sh (the view on a stand-in).
//
// Why structural pins: the view must LABEL, never DECIDE. Every value comes from a shared decision already in
// production (the Map 1 reader, dc_entity_geography, dc_observation_derived_point, dc_osm_address_check).
// A second classifier here — a source name, a distance, a geocode read — would be a parallel truth path.
// Run: node test/dc-map1-address-check-structure.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const RAW = read('docs/dc-map1-address-check.sql');
const SQL = stripSql(RAW);
const view = (SQL.match(/create or replace view public\.dc_map1_address_check[\s\S]*?\n  from lbl;/) || [''])[0];
ok(view.length > 1500 && /map1_dc_zip_members/.test(view), '0: the view body is located (positive control)');
ok(/with \(security_invoker = true\)/.test(view), 'V1: security_invoker, so it never reads past the caller\'s own grants');

// ── labels only: every source is a shared decision ─────────────────────────────────────────────────
const tables = [...new Set((view.match(/public\.[a-z0-9_]+/g) || []))].sort();
const allowed = ['public.canonical_zip_registry', 'public.dc_current_observation', 'public.dc_entity_geography',
  'public.dc_entity_observation', 'public.dc_map1_address_check', 'public.dc_observation_derived_point',
  'public.dc_osm_address_check', 'public.map1_dc_zip_members', 'public.national_dc_records'];
ok(tables.every((t) => allowed.includes(t)) && tables.includes('public.dc_osm_address_check')
   && tables.includes('public.dc_observation_derived_point') && tables.includes('public.dc_entity_geography'),
  'L1: reads only the Map 1 reader and the shared placement / verdict / OSM-check decisions', tables.join(','));
ok(!/dc_address_geocode|dc_geocode_input|dc_derived_point_verdict|dc_geocodable_site_address/.test(view),
  'L2: never re-derives a verdict or an input quality (no geocode table, no policy or verdict function)');
ok(!/'(epoch_ai|compute_atlas|openstreetmap_raw|osm)'/.test(view) && !/source_key\s+like/i.test(view),
  'L3: names no source and pattern-matches no key: one rule for every publisher');
const code = view.replace(/'(?:[^']|'')*'/g, "''");
ok(/distance/.test(view) && !/\bST_|\bkm\b|distance|<->/i.test(code), 'L4: does no distance math — "within the calibrated distance" is read from the shared flag');
ok(/'CORROBORATED_BY_DERIVED_ADDRESS' = any \(g\.quality_flags\)/.test(view) && /g\.rule_key like 'DERIVED%'/.test(view)
   && /k\.check_outcome = 'CORROBORATED'/.test(view),
  'L5: CHECKED is exactly the shared placement flag / derived rule (canonical) and the shared CORROBORATED outcome (OSM)');

// ── one state, one reason, per marker ─────────────────────────────────────────────────────────────
const states = [...new Set((view.match(/array\['([A-Z_]+)'/g) || []).map((s) => s.slice(7, -1)))].sort();
ok(JSON.stringify(states) === JSON.stringify(['CHECKABLE_NO_CLEAN_MATCH', 'CHECKED', 'NOT_CHECKABLE', 'PENDING']),
  'S1: exactly the four states, nothing else', states.join(','));
ok((view.match(/\belse array\[/g) || []).length === 2,
  'S2: both layers end in an explicit else, so no marker falls through to a NULL state');
ok(/case when publication_basis = 'canonical' then 'canonical' else 'openstreetmap' end as layer/.test(view),
  'S3: the layer is read from the Map 1 reader\'s own publication_basis — OSM stays a separate layer');

// ── access and wiring ─────────────────────────────────────────────────────────────────────────────
ok(/^revoke all on public\.dc_map1_address_check from anon, authenticated;$/m.test(SQL),
  'A1: service-role only — anon and authenticated are revoked');
ok(!/\b(insert|update|delete|truncate|drop|alter)\b/i.test(SQL.replace(/create or replace view[\s\S]*?from lbl;/, '')),
  'A2: the file is additive — it defines one view and writes nothing');
const RUN = read('test/dc_map1_address_check_pg/run.sh');
ok(existsSync(join(ROOT, 'test/dc_map1_address_check_pg/run.sh')) && /A1_ONE_ROW_PER_MARKER/.test(RUN)
   && /docs\/dc-map1-address-check\.sql/.test(RUN),
  'W1: the executable proof exists and loads the committed view file');
const WF = read('.github/workflows/zip-membership-suite.yml');
ok(/bash test\/dc_map1_address_check_pg\/run\.sh/.test(WF) && (WF.match(/'docs\/dc-map1-address-check\.sql'/g) || []).length === 2,
  'W2: CI runs the executable proof on pull requests and pushes touching the view');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
