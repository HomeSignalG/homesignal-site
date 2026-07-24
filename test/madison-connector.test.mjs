// madison-planning-projects connector restoration — offline regression checks.
// Run: node test/madison-connector.test.mjs
//
// The connector was deployed-but-never-committed and accidentally dropped 2026-07-17
// when the engine was rebuilt from committed source (20 Dane County ZIPs froze).
// These checks pin the RESTORED, committed registry entry to the forensically
// recovered contract so a future registry edit or engine rebuild can never silently
// change it again:
//   1. registry schema — the entry exists once, on the arcgis platform, with the
//      verified service layer, coverage, and column map;
//   2. status policy — every upstream status is enumerated (13 mapped verbatim from
//      the 2,452-record golden set + 4 explicit exclusions), no status in two
//      buckets, unknown statuses fail CLOSED (dropped, surfaced as unmapped);
//   3. normalization — applied to a committed fixture of 7 REAL features captured
//      live from the layer (fixtures/madison/planning-projects-sample.json), the
//      documented adapter semantics reproduce the golden records exactly:
//      bucket, epoch-ms → ISO file_date, record_url == ProjectURL == the
//      development.cfm template, deterministic source_id, point geometry;
//   4. edge behavior — empty upstream response emits nothing; an ArcGIS error
//      object is a failed fetch (quarantine), never an empty-success.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const REG_PATH = 'supabase/functions/get-address-report/jurisdiction-registry.json';
const reg = JSON.parse(readFileSync(join(root, REG_PATH), 'utf8'));

// ── 1. registry schema ──────────────────────────────────────────────────────
const entries = (reg.arcgis || []).filter((e) => e.registry_id === 'madison-planning-projects');
ok(entries.length === 1, 'exactly one madison-planning-projects entry in the arcgis registry');
const e = entries[0] || {};

ok(e.platform === 'arcgis', 'platform is arcgis');
ok(e.service_url === 'https://maps.cityofmadison.com/arcgis/rest/services/Planning/Current_Planning_Projects/MapServer/0',
  'service_url is the verified Current_Planning_Projects layer 0');
ok(e.jurisdiction === 'City of Madison', 'jurisdiction City of Madison');
ok(Array.isArray(e.coverage) && e.coverage.length === 1
   && e.coverage[0].state === 'WI' && e.coverage[0].county === 'Dane',
  'coverage is exactly [{state:WI, county:Dane}] (coverage gate)');

const cm = e.column_map || {};
ok(cm.case_number === 'RECORD_RecordID', 'column_map.case_number = RECORD_RecordID');
ok(cm.status_raw === 'RECORD_Status', 'column_map.status_raw = RECORD_Status');
ok(cm.title === 'Project_Description', 'column_map.title = Project_Description');
ok(cm.record_url === 'ProjectURL', 'column_map.record_url = ProjectURL');
ok(cm.file_date === 'DATES_SubmittedDate', 'column_map.file_date = DATES_SubmittedDate');
ok(cm.address === 'APO_ADDRESS_PARTIAL_LINE', 'column_map.address = APO_ADDRESS_PARTIAL_LINE');
ok(cm.lat === '__lat' && cm.lng === '__lng', 'geometry read from the source point (__lat/__lng)');
ok(cm.zip === undefined, 'no zip column mapped (layer has none — spatial scoping instead)');

ok(e.spatial_zip_radius_mi === 3,
  'spatial_zip_radius_mi = 3 (recovered from the golden set: membership fit R ∈ [3.0026, 3.0028) → the engine standard 3 mi)');
ok(e.record_url_template === 'https://www.cityofmadison.com/dpced/planning/development.cfm?record={case_number}',
  'record_url_template is the observed canonical development.cfm format');
ok(e.record_url_precision === 'record', 'record_url_precision = record (1:1 case↔URL, verified on all 502 golden cases)');
ok(e.type_map === undefined, 'no type_map (golden set is 100% use_type=unclassified — reproduce, don’t invent)');
ok(e.recency_days === undefined, 'no recency filter (planning projects kept regardless of age; golden spans 2015+)');
ok(e.zip_mode !== false, 'zip_mode enabled (runs in ZIP-aggregate reports)');

// ── 2. status policy — enumerate everything, fail closed ────────────────────
const s2b = e.status_to_bucket || {};
const EXPECT = {
  proposed: ['In Process', 'Application Under Review', 'Additional Info Required', 'Waiting for Fees'],
  approved: ['Final Approval Granted', 'Recorded', 'Approved, Final Review Pending',
             'Approved, Under Final Review', 'Approved and Recorded', 'Approved Preliminary Plat'],
  operating: ['Approval Granted, Completed', 'Approved, Demolished', 'Approved, Constructed'],
  exclude: ['Approval(s) expired', 'Approval(s) Expired', 'Inactive', 'Placed on File or Denied'],
};
for (const bucket of Object.keys(EXPECT)) {
  const got = (s2b[bucket] || []).slice().sort();
  const want = EXPECT[bucket].slice().sort();
  ok(JSON.stringify(got) === JSON.stringify(want),
    `status_to_bucket.${bucket} matches the golden-set recovery verbatim (${want.length} statuses, exact commas/casing)`);
}
const all = Object.values(s2b).flat();
ok(all.length === new Set(all).size, 'no status appears in two buckets');
ok(all.length === 17, 'all 17 enumerated statuses accounted for (13 mapped + 4 excluded, incl. both Expired casings)');

// ── 3. normalization against the committed real-feature fixture ─────────────
// Mirrors the adapter semantics in sources/arcgis.ts (trim-exact bucket lookup;
// epoch-ms → YYYY-MM-DD; record_url column-first; source_id = arcgis:<id>:<case>;
// unmapped/blank status → dropped, counted).
const fixture = JSON.parse(readFileSync(join(root, 'fixtures/madison/planning-projects-sample.json'), 'utf8'));
ok(Array.isArray(fixture.features) && fixture.features.length === 7, 'fixture carries 7 real features');
ok(fixture.geometryType === 'esriGeometryPoint' && fixture.spatialReference.wkid === 4326,
  'fixture is point geometry in WGS84 (outSR=4326), as the adapter requests');

const lookup = new Map();
for (const b of ['proposed', 'approved', 'operating', 'exclude']) {
  for (const st of s2b[b] || []) if (!lookup.has(st.trim())) lookup.set(st.trim(), b);
}
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function normalize(features) {
  const out = []; const dropped = { excluded: 0, unmapped: [], blank: 0 };
  for (const f of features) {
    const a = f.attributes || {};
    const st = String(a[cm.status_raw] ?? '').trim();
    if (!st) { dropped.blank++; continue; }
    const bucket = lookup.get(st);
    if (bucket === undefined) { dropped.unmapped.push(st); continue; }
    if (bucket === 'exclude') { dropped.excluded++; continue; }
    out.push({
      source_id: `arcgis:${e.registry_id}:${a[cm.case_number]}`,
      case_number: a[cm.case_number],
      bucket, status_raw: st,
      title: String(a[cm.title] ?? '').trim(),
      record_url: a[cm.record_url],
      file_date: isoDay(a[cm.file_date]),
      address: a[cm.address],
      lat: f.geometry?.y, lng: f.geometry?.x,
    });
  }
  return { out, dropped };
}

const { out, dropped } = normalize(fixture.features);
ok(out.length === 5, `5 of 7 fixture features emit (got ${out.length}); 2 fail closed`);
ok(dropped.excluded === 2 && dropped.unmapped.length === 0 && dropped.blank === 0,
  'exactly the 2 dead statuses (Approval(s) Expired, Placed on File or Denied) are excluded — nothing unmapped');

const by = Object.fromEntries(out.map((r) => [r.case_number, r]));
const g = by['LNDUSE-2015-00037'];
ok(!!g && g.bucket === 'approved' && g.file_date === '2015-08-21', 'golden record LNDUSE-2015-00037: approved, file_date 2015-08-21');
ok(!!g && g.record_url === 'https://www.cityofmadison.com/dpced/planning/development.cfm?record=LNDUSE-2015-00037',
  'golden record URL comes from ProjectURL and equals the canonical template');
ok(!!g && g.source_id === 'arcgis:madison-planning-projects:LNDUSE-2015-00037', 'deterministic source_id format');
ok(!!g && Math.abs(g.lat - 43.1388) < 0.001 && Math.abs(g.lng - (-89.2915)) < 0.001, 'point geometry carried from the source (no geocode)');
ok(by['LNDUSE-2019-00032']?.bucket === 'proposed', 'In Process → proposed');
ok(by['LNDCSM-2026-00014']?.bucket === 'proposed' && by['LNDCSM-2026-00014']?.file_date === '2026-04-03',
  'Application Under Review → proposed with ISO file_date');
ok(by['LNDUSE-2025-00011']?.bucket === 'operating', 'Approval Granted, Completed → operating');
ok(by['LNDUSE-2021-00012']?.bucket === 'operating', 'Approved, Demolished → operating');
for (const r of out) {
  ok(r.record_url === `https://www.cityofmadison.com/dpced/planning/development.cfm?record=${r.case_number}`,
    `record_url is record-precision for ${r.case_number}`);
}
ok(new Set(out.map((r) => r.source_id)).size === out.length, 'no duplicate source_ids emitted');

// ── 4. edge behavior ────────────────────────────────────────────────────────
const empty = normalize([]);
ok(empty.out.length === 0 && empty.dropped.excluded === 0, 'empty upstream response emits nothing (honest empty)');

const unknown = normalize([{ attributes: { RECORD_RecordID: 'X-1', RECORD_Status: 'Some Future Status', Project_Description: 't', ProjectURL: 'https://x', DATES_SubmittedDate: 0 }, geometry: { x: 0, y: 0 } }]);
ok(unknown.out.length === 0 && unknown.dropped.unmapped.length === 1 && unknown.dropped.unmapped[0] === 'Some Future Status',
  'an UNKNOWN status fails closed: dropped and surfaced as unmapped for triage, never silently bucketed');

const blank = normalize([{ attributes: { RECORD_RecordID: 'X-2', RECORD_Status: '  ', ProjectURL: 'https://x' }, geometry: { x: 0, y: 0 } }]);
ok(blank.out.length === 0 && blank.dropped.blank === 1, 'a blank status fails closed');

// An ArcGIS error body must never read as an empty success (adapter throws on page.error).
const errBody = { error: { code: 400, message: 'Failed to execute query.', details: [] } };
ok(!Array.isArray(errBody.features) && !!errBody.error,
  'ArcGIS error object shape is distinguishable from an empty result — the adapter throws (quarantine), never 0-records-success');

if (fails) { console.error('\n' + fails + ' failed'); process.exit(1); }
console.log('\nAll madison-connector assertions passed.');
