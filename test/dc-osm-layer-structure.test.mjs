// THE OPENSTREETMAP LAYER'S ADDRESS CHECK — the structural half (the executable half is test/dc_osm_layer_pg).
//
// OpenStreetMap is a SEPARATE layer (founder, 2026-09-26): each OSM pin is checked against its own
// stated address with the SHARED extraction/policy, the SHARED geocoder and cache, the SHARED verdict
// and the SHARED conflict rule — and is never merged into the canonical tables, never moved, and not
// read by the Map 1 reader until an automated-gated change. What a PostGIS suite cannot see is a
// SECOND path appearing beside that one: an OSM-specific threshold, an OSM row fed to the canonical
// resolvers, a write to national_dc_records, the Map 1 reader quietly reading the check. Those are
// pinned here, on comment-stripped text, each with a positive control so a silent scan cannot pass.
// Run: node test/dc-osm-layer-structure.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const D3 = stripSql(read('docs/dc-step3d-derived-location.sql'));
const A3 = stripSql(read('docs/dc-step3a-canonical-identity.sql'));
const B3 = stripSql(read('docs/dc-step3b-canonical-geography.sql'));
const MAP = stripSql(read('docs/map1-dc-publication.sql'));
const LOAD = stripSql(read('docs/dc-geocode-observations-load.sql'));
const QUEUE = stripSql(read('docs/dc-geocode-observations-queue.sql'));
const fn = (name, src, end = '\\$fn\\$;') => (src.match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?' + end)) || [''])[0];
const view = (name, src) => (src.match(new RegExp('create or replace view public\\.' + name + '\\b[\\s\\S]*?;')) || [''])[0];
ok([D3, A3, B3, MAP, LOAD, QUEUE].every((s) => s.length > 200), '0: every production file under test is located and non-empty (positive control)');

const extract = fn('dc_publisher_stated_address', D3);
const acq = view('dc_osm_derived_point', D3);
const chk = view('dc_osm_address_check', B3);
const queue = view('dc_geocode_queue', D3);
const admit = fn('dc_derived_address_admitted', D3, '\\$\\$;');
ok(extract.length > 400 && acq.length > 400 && chk.length > 400 && queue.length > 100 && admit.length > 100,
  '1: the extraction, both OSM views, the queue and the admission switch are each located (positive control)');

// ── ONE extraction branch; the record's OWN tags; nothing guessed ────────────────────────────
ok(/if p_source_key = 'openstreetmap' and p_distribution_key = 'telecom_data_center' then/.test(extract)
   && /p_payload->>'addr:housenumber'/.test(extract) && /p_payload->>'addr:street'/.test(extract)
   && /p_payload->>'addr:country'/.test(extract) && /'NOT_US'/.test(extract),
  'E1: OSM addresses are EXTRACTED from the record\'s own addr:* tags, in the extraction function; a non-US record says so');
const osmLits = (s) => (s.match(/'openstreetmap'/g) || []).length;
ok(osmLits(D3.replace(extract, '').replace(acq, '')) === 0 && osmLits(extract) >= 1 && osmLits(acq) >= 1
   && osmLits(B3) === 0 && osmLits(A3) === 0 && osmLits(MAP) === 0,
  'E2: \'openstreetmap\' is named ONLY in the extraction and the acquisition view: no OSM policy, verdict, threshold or reader rule anywhere');

// ── shared machinery only ────────────────────────────────────────────────────────────────────
ok(/public\.dc_geocode_input\('openstreetmap', 'telecom_data_center', r\.raw_tags\)/.test(acq)
   && /public\.dc_address_geocode d/.test(acq) && /public\.dc_geocode_ladder_version\(\)/.test(acq)
   && /public\.dc_derived_point_verdict\(/.test(acq)
   && /public\.dc_derived_address_admitted\('openstreetmap', 'telecom_data_center'\)/.test(acq),
  'S1: the acquisition view reads the SHARED input, the ONE geocode cache at the current ladder, the SHARED verdict and the ONE gate');
ok(!/ST_Distance|ST_DWithin|\b\d{3,}\b/.test(acq),
  'S2: the acquisition view carries no distance math and no numeric threshold of its own');
ok(/public\.dc_site_claims_conflict\(o\.osm_claim_class, null, o\.osm_lat, o\.osm_lng,\s*'DERIVED_ADDRESS', o\.positional_uncertainty_m, o\.lat, o\.lng\)/.test(chk)
   && (chk.match(/ST_DistanceSphere/g) || []).length === 1 && /\) end as distance_m,/.test(chk)
   && !/\b\d{3,}\b/.test(chk),
  'S3: the check judges with the SHARED conflict rule; its one distance is the REPORTED distance_m; no threshold of its own');
ok(/from public\.dc_osm_derived_point o/.test(chk) && !/national_dc_records/.test(chk),
  'S4: the check reads only the acquisition view (one OSM input path)');

// ── separate layer: never merged, never written, not read by Map 1 ───────────────────────────
const readers = {
  map1_dc_zip_members: fn('map1_dc_zip_members', MAP, 'revoke all on function public\\.map1_dc_zip_members'),
  dc_resolve_canonical: fn('dc_resolve_canonical', A3, '\\$fn\\$;'),
  dc_resolve_geography: fn('dc_resolve_geography', B3, '\\$fn\\$;'),
  dc_identity_candidate: view('dc_identity_candidate', A3),
  dc_entity_geography_evidence: view('dc_entity_geography_evidence', B3),
  dc_observation_derived_point: view('dc_observation_derived_point', D3),
};
const located = Object.entries(readers).filter(([, s]) => s.length > 200).map(([k]) => k);
const leak = Object.entries(readers).filter(([, s]) => /dc_osm_(derived_point|address_check)/.test(s)).map(([k]) => k);
ok(located.length === Object.keys(readers).length && leak.length === 0 && /national_dc_records/.test(readers.map1_dc_zip_members),
  'L1: no canonical resolver, candidate/evidence view, derived-point view or the Map 1 reader reads either OSM view (control: Map 1 still reads national_dc_records)',
  'located ' + located.join(',') + ' leak ' + leak.join(','));
const writes = [D3, A3, B3, MAP, LOAD].some((s) => /(insert\s+into|update|delete\s+from|truncate)\s+(public\.)?national_dc_records\b/i.test(s));
ok(!writes, 'L2: nothing in the chain writes national_dc_records: an OSM pin is never moved or merged');
ok(/revoke all on public\.dc_osm_derived_point from anon, authenticated;/.test(D3)
   && /revoke all on public\.dc_osm_address_check from anon, authenticated;/.test(B3)
   && !/grant[^;]*dc_osm_/i.test(D3 + B3),
  'L3: both OSM views are service-role only');
ok(!/'openstreetmap'/.test(admit) && /'compute_atlas', 'facilities'/.test(admit),
  'L4: the admission switch does NOT admit OpenStreetMap (control: it names the admitted Atlas extraction)');

// ── ONE queue, ONE writer ────────────────────────────────────────────────────────────────────
ok(/from public\.dc_observation_derived_point p/.test(queue) && /from public\.dc_osm_derived_point o\s+where o\.map_eligible/.test(queue)
   && /group by q\.geocoder_query/.test(queue),
  'Q1: the ONE queue unions canonical and map-eligible OSM addresses, one row per address');
ok(/from public\.dc_geocode_queue/.test(QUEUE) && !/dc_osm_/.test(QUEUE) && /from public\.dc_geocode_queue/.test(LOAD) && !/dc_osm_/.test(LOAD),
  'Q2: the writer\'s queue and load SQL read only dc_geocode_queue: no second writer path for OSM');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
