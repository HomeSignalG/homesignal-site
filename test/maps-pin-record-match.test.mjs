// MAP 1 STEP (a), FIRST PART — THE PICTURE TOOL REFUSES A PIN THAT SHOWS ANOTHER RECORD.
//
// Founder-approved 2026-10-01: "tell the picture tool which record a pin is, so it can refuse
// a mismatch." Map 1 draws one pin per source_key and fills its popup from one row of that
// key (public.app_zip_projects_markers). Where several records share a key, the popup can
// show a different record from the one a MAPS post is about. Measured 2026-10-02 over the 28
// MAPS posts tied to a project: 3 drafts did (10475, 78703, 33004); 0 approved or published.
//
// The records below are copied from production on 2026-10-02 (public permit records; no
// person, no approval field). `record` is the post's own app_projects row; `pin` is the row
// Map 1's reader fills the pin from, in the reader's projection.
//
// Three halves, each EXECUTED rather than grepped:
//   §1 the rule (HS.mapsPinRecordMismatch) on the real shapes, both directions;
//   §2 the binding: a project picture needs `record_match`, a ZIP picture does not;
//   §3 the capture job's --stamp-record-match pass, run against a stubbed database: it stamps
//      a matching approved post with evidence alone, refuses a wrong-record draft, writes
//      nothing for a stale picture or a wrong-record APPROVED post (and fails the run), and
//      refuses to report success if an approved payload moved.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS — ' + m); }
                       else { fail++; console.log('FAIL — ' + m); } };

globalThis.window = globalThis.window || globalThis;
for (const f of ['../lib/project-type.js', '../lib/map.js', '../lib/maps-social-theme.js',
                 '../lib/maps-capture-policy.js', '../lib/maps-capture-binding.js',
                 '../lib/residential-qualify.js', '../lib/n5-radius.js', '../lib/zip-authoritative.js']) {
  (0, eval)(fs.readFileSync(new URL(f, import.meta.url), 'utf8'));
}
const HS = globalThis.window.HS;

// ── the production shapes ────────────────────────────────────────────────────────────
const REAL = {
  '10475': {
    record: { name: 'NB WRIGHT AVENUE', type: 'Development', status: 'Approved', type_raw: 'NB',
      date_kind: 'issued', source_ref: 'https://data.cityofnewyork.us/d/ipu4-2q9a', submitted_at: '2026-09-25' },
    pin: { project_ref: 'socrata:data.cityofnewyork.us:ipu4-2q9a:220015819', name: 'FO WRIGHT AVENUE',
      type: 'Development', status: 'Approved', type_raw: 'FO', date_kind: 'issued',
      source_ref: 'https://data.cityofnewyork.us/d/ipu4-2q9a', submitted_at: '2026-07-09' },
  },
  '78703': {
    record: { name: 'West 6th Street Public Storage PUD Amendment', type: 'Development', status: 'Proposed',
      type_raw: 'Planned Unit Development (PUD)', date_kind: 'filed',
      source_ref: 'https://abc.austintexas.gov/web/permit/public-search-other?t_detail=1&t_selected_folderrsn=13778856',
      submitted_at: '2026-09-25' },
    pin: { project_ref: 'socrata:data.austintexas.gov:edir-dcnf:C814-96-0001', name: 'PUBLIC STORAGE RETAIL CENTER',
      type: 'Development', status: 'Operating', type_raw: 'Planned Unit Development (PUD)', date_kind: 'filed',
      source_ref: 'https://abc.austintexas.gov/web/permit/public-search-other?t_detail=1&t_selected_folderrsn=150239',
      submitted_at: '1996-08-23' },
  },
  '33004': {
    record: { name: 'COUNTYWIDE SONOVOID SLAB BRIDGE REHABILITATION - BRIDGE-REPA IR/REHABILITATION 86010000',
      type: 'Utility', status: 'Approved', type_raw: null, date_kind: 'decided',
      source_ref: 'https://gis.fdot.gov/arcgis/rest/services/Active_Construction_Projects/FeatureServer/1',
      submitted_at: '2026-09-25' },
    pin: { project_ref: 'arcgis:fdot-active-construction-projects:E4X91',
      name: 'COUNTYWIDE SONOVOID SLAB BRIDGE REHABILITATION - BRIDGE-REPA IR/REHABILITATION 86016000',
      type: 'Utility', status: 'Approved', type_raw: null, date_kind: 'decided',
      source_ref: 'https://gis.fdot.gov/arcgis/rest/services/Active_Construction_Projects/FeatureServer/1',
      submitted_at: '2026-09-25' },
  },
  // CONTROL: an approved post whose pin is filled from ANOTHER row with identical content.
  // An id comparison would refuse it; the content comparison must not.
  '85008': {
    record: { name: 'INSTALL 2-120 GAL VERT PROPANE TANKS', type: 'Industrial', status: 'Proposed',
      type_raw: 'LIQ PROPANE GAS SYS ABOVE GROUND INSTALL', date_kind: 'filed',
      source_ref: 'https://apps-secure.phoenix.gov/pdd/search/permits', submitted_at: '2026-08-27' },
    pin: { project_ref: 'arcgis:phoenix-building-permits:2603494', name: 'INSTALL 2-120 GAL VERT PROPANE TANKS',
      type: 'Industrial', status: 'Proposed', type_raw: 'LIQ PROPANE GAS SYS ABOVE GROUND INSTALL',
      date_kind: 'filed', source_ref: 'https://apps-secure.phoenix.gov/pdd/search/permits', submitted_at: '2026-08-27' },
  },
};

// ── §1 THE RULE ──────────────────────────────────────────────────────────────────────
ok(typeof HS.mapsPinRecordMismatch === 'function'
   && JSON.stringify(HS.MAPS_PIN_RECORD_FIELDS)
      === JSON.stringify(['name', 'status', 'submitted_at', 'type', 'type_raw', 'source_ref', 'date_kind']),
  '1a: the rule is shipped and compares name, status, date, type, source type, record link, date meaning');
ok(HS.mapsPinRecordMismatch(REAL['85008'].pin, REAL['85008'].record) === '',
  '1b: control — a pin filled from another row with identical content shows THIS record');
{
  const m = HS.mapsPinRecordMismatch(REAL['10475'].pin, REAL['10475'].record);
  ok(/shows a different record/.test(m) && /name "NB WRIGHT AVENUE" on the post, "FO WRIGHT AVENUE" on the pin/.test(m)
     && /date "2026-09-25" on the post, "2026-07-09" on the pin/.test(m) && /source type "NB" on the post, "FO" on the pin/.test(m),
    '1c: 10475 — the NB permit pictured as the FO permit is refused, naming each field that differs');
  ok(!/status/.test(m) && !/record link/.test(m), '1c₁: …and names only the fields that differ');
}
{
  const m = HS.mapsPinRecordMismatch(REAL['78703'].pin, REAL['78703'].record);
  ok(/name "West 6th Street Public Storage PUD Amendment" on the post, "PUBLIC STORAGE RETAIL CENTER" on the pin/.test(m)
     && /status "Proposed" on the post, "Operating" on the pin/.test(m) && /1996-08-23/.test(m) && /record link/.test(m),
    '1d: 78703 — the 2026 amendment pictured as the 1996 retail center is refused');
}
{
  const m = HS.mapsPinRecordMismatch(REAL['33004'].pin, REAL['33004'].record);
  ok(m.indexOf('name "' + REAL['33004'].record.name + '" on the post, "' + REAL['33004'].pin.name + '" on the pin') > -1,
    '1e: 33004 — bridge 86010000 pictured as bridge 86016000 is refused, and the reason shows both names in full '
    + '(they differ only in their last digits, so a shortened name would read as the same)');
}
{
  const m = HS.mapsPinRecordMismatch(REAL['78703'].pin, REAL['78703'].record);
  ok(m.indexOf('folderrsn=13778856" on the post') > -1 && m.indexOf('folderrsn=150239" on the pin') > -1,
    '1e₁: …and the two record links are shown in full too');
}
// Fails closed in every way a field can go missing.
ok(/no content/.test(HS.mapsPinRecordMismatch(null, REAL['85008'].record)),
  '1f: no pin content from Map 1 is a refusal, never a pass');
{
  const pin = { ...REAL['85008'].pin }; delete pin.date_kind;
  ok(/date meaning: Map 1 did not return it/.test(HS.mapsPinRecordMismatch(pin, REAL['85008'].record)),
    '1g: a field the reader stops returning is a refusal, so the check cannot silently pass');
}
{
  const rec = { ...REAL['85008'].record }; delete rec.source_ref;
  ok(/read without source_ref/.test(HS.mapsPinRecordMismatch(REAL['85008'].pin, rec)),
    '1h: a post record read without a compared field is a refusal too');
}
ok(HS.mapsPinRecordMismatch({ ...REAL['85008'].pin, type_raw: '' }, REAL['85008'].record) !== '',
  '1i: an empty string is not the same as the stored value');
ok(HS.mapsPinRecordMismatch({ ...REAL['33004'].pin, name: REAL['33004'].record.name }, REAL['33004'].record) === '',
  '1j: control — null on both sides (33004 type_raw) is the same value');

// ── §2 THE BINDING ───────────────────────────────────────────────────────────────────
const P1 = '11111111-2222-3333-4444-555555555555';
function projectPost(visualExtra) {
  const post = { id: 'x', zip: '85008', content_family: 'MAPS', tile: 'development', image_bucket_path: 'maps/85008/x.png',
    evidence: { project_id: P1, lat: 33.4, lng: -112.0, type: 'Industrial', type_raw: 'LIQ PROPANE GAS SYS ABOVE GROUND INSTALL',
      status: 'Proposed', project_name: 'INSTALL 2-120 GAL VERT PROPANE TANKS', source_key: 'arcgis:phoenix-building-permits:2603494' } };
  post.evidence.visual = { scope: 'project', state: 'REAL_MAP_VISUAL', popup_open: true, ...visualExtra };
  post.evidence.visual.capture_key = HS.mapsCaptureKey(post, 'project');
  return post;
}
ok(HS.mapsCaptureBound(projectPost({ record_match: true })) === true, '2a: control — a project pin that records the match binds');
ok(HS.mapsCaptureBound(projectPost({})) === false, '2b: a project pin with no record check recorded does not bind');
ok(HS.mapsCaptureBound(projectPost({ record_match: false })) === false, '2c: a project pin recorded as another record does not bind');
ok(HS.mapsCaptureBound(projectPost({ record_match: 'true' })) === true
   && HS.mapsCaptureBound(projectPost({ record_match: 'yes' })) === false,
  '2d: only true (or the string "true", as SQL reads it) counts — nothing else is truthy enough');
ok(HS.mapsMapGateBlock(projectPost({ record_match: true })) === '', '2e: control — the dashboard gate passes the checked pin');

// ── §3 THE STAMP PASS, EXECUTED ──────────────────────────────────────────────────────
// Same harness technique as test/maps-capture-attach-executes.test.mjs: the module exports
// nothing and runs main() on import, so the entry call is removed, playwright is stubbed and
// an export is appended. Each transformation is asserted.
const SRC = fs.readFileSync(new URL('../scripts/maps-social-image.mjs', import.meta.url), 'utf8');
const ENTRY = 'main().catch((e) => { console.error(e); process.exit(1); });';
const PW = "import { chromium } from 'playwright';";
ok(SRC.includes(ENTRY) && SRC.includes(PW), '3₀: the harness finds the entry call and the playwright import');
const patched = SRC.replace(ENTRY, '/* entry removed by the test harness */')
  .replace(PW, "const chromium = { launch: async () => { throw new Error('stubbed'); } };")
  + '\nexport { stampRecordMatch };\n';
const dir = fs.mkdtempSync(path.join(path.dirname(new URL('.', import.meta.url).pathname), '.record-harness-'));
const file = path.join(dir, 'mod.mjs');
fs.writeFileSync(file, patched);
process.env.SUPABASE_URL = 'https://stub.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';

// The stubbed database. Rows are built from the production shapes above.
const PIDS = { A: 'a0000000-0000-0000-0000-00000000000a', B: 'b0000000-0000-0000-0000-00000000000b',
               C: 'c0000000-0000-0000-0000-00000000000c', D: 'd0000000-0000-0000-0000-00000000000d' };
function row(id, status, zip, pid, markerLabel) {
  const r = { id, zip, status, content_family: 'MAPS', tile: 'development', revision: 7,
    post_text: 'post ' + id, source_url: 'https://homesignal.net/x', embed_kind: 'image', embed: { uri: 'u' },
    hashtags: ['development'], image_bucket_path: `maps/${zip}/${id}.png`,
    evidence: { project_id: pid, project_name: 'n', visual: { scope: 'project', state: 'REAL_MAP_VISUAL',
      popup_open: true, marker_label: markerLabel, capture_key: 'v1|' + zip + '|' + pid + '|k' } } };
  return r;
}
const projects = {
  [PIDS.A]: { id: PIDS.A, zip: '85008', lat: 33.4, lng: -112.0, record_kind: 'development',
    source_key: REAL['85008'].pin.project_ref, ...REAL['85008'].record },
  [PIDS.B]: { id: PIDS.B, zip: '10475', lat: 40.8, lng: -73.8, record_kind: 'development',
    source_key: REAL['10475'].pin.project_ref, ...REAL['10475'].record },
  // C: Map 1 now shows this record, but the stored picture's popup showed another name.
  [PIDS.C]: { id: PIDS.C, zip: '85008', lat: 33.4, lng: -112.0, record_kind: 'development',
    source_key: REAL['85008'].pin.project_ref, ...REAL['85008'].record },
  // D: an APPROVED post whose pin shows another record.
  [PIDS.D]: { id: PIDS.D, zip: '78703', lat: 30.27, lng: -97.76, record_kind: 'development',
    source_key: REAL['78703'].pin.project_ref, ...REAL['78703'].record },
};
const pinsByZip = { '85008': REAL['85008'].pin, '10475': REAL['10475'].pin, '78703': REAL['78703'].pin };
function rpcPayload(zip) {
  const pin = pinsByZip[zip];
  return { mode: 'authoritative', zip, status: 'boundary_complete', membership_count: 1, marker_count: 1, project_count: 1,
    projects: [pin], markers: [{ project_ref: pin.project_ref, marker_seq: 1, lat: 33.4, lng: -112.0, marker_rule: 'POINT_AUTHORITATIVE' }] };
}

async function runStamp(rows, { movedOnReread } = {}) {
  const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const reply = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });
    if (method === 'PATCH') { writes.push({ url: u, body }); return reply([{ id: 'w' }]); }
    if (u.includes('/rpc/app_zip_projects_markers')) return reply(rpcPayload(body.p_zip));
    if (u.includes('/app_projects?')) {
      const id = decodeURIComponent(u.match(/id=eq\.([^&]+)/)[1]);
      return reply(projects[id] ? [projects[id]] : []);
    }
    if (u.includes('/social_posts?select=id,status,')) {          // the re-read of approved rows
      const ids = u.match(/id=in\.\(([^)]+)\)/)[1].split(',');
      return reply(rows.filter((r) => ids.includes(r.id)).map((r) => ({ ...r,
        ...(movedOnReread ? { post_text: r.post_text + ' (edited)' } : {}) })));
    }
    if (u.includes('/social_posts?select=')) return reply(rows.map((r) => JSON.parse(JSON.stringify(r))));
    throw new Error('unexpected request ' + method + ' ' + u);
  };
  let threw = null;
  const before = process.exitCode;
  try { await mod.stampRecordMatch(); } catch (e) { threw = e; }
  const exitCode = process.exitCode; process.exitCode = before;
  return { writes, threw, exitCode };
}

let mod;
try { mod = await import(pathToFileURL(file).href); } catch (e) { ok(false, '3₁: patched module imports: ' + e.message); }
ok(mod && typeof mod.stampRecordMatch === 'function', '3₁: the stamp pass is reachable');

if (mod) {
  const rows = [
    row('rowA', 'approved', '85008', PIDS.A, REAL['85008'].record.name),
    row('rowB', 'draft', '10475', PIDS.B, 'FO WRIGHT AVENUE'),
    row('rowC', 'draft', '85008', PIDS.C, 'SOME OLDER NAME'),
    row('rowD', 'approved', '78703', PIDS.D, 'PUBLIC STORAGE RETAIL CENTER'),
    { ...row('rowE', 'draft', '84302', null, null), evidence: { visual: { scope: 'zip' } } },
  ];
  const { writes, threw, exitCode } = await runStamp(rows);
  ok(!threw, '3a: the pass runs' + (threw ? ` (threw: ${threw.message})` : ''));
  const wA = writes.filter((w) => /id=eq\.rowA/.test(w.url));
  ok(wA.length === 1 && /status=eq\.approved&revision=eq\.7/.test(wA[0].url),
    '3b: the matching APPROVED post is stamped, with its status and revision pinned in the write');
  ok(wA.length === 1 && JSON.stringify(Object.keys(wA[0].body)) === '["evidence"]'
     && wA[0].body.evidence.visual.record_match === true
     && wA[0].body.evidence.visual.record_checked_by === 'stamp-record-match',
    '3c: …with evidence alone (no picture, text or status), recording record_match true');
  const wB = writes.filter((w) => /id=eq\.rowB/.test(w.url));
  const vB = wB.length ? wB[0].body.evidence.visual : {};
  ok(wB.length === 1 && /status=eq\.draft/.test(wB[0].url) && vB.state === 'CAPTURE_INELIGIBLE'
     && vB.record_match === false && /"NB WRIGHT AVENUE" on the post, "FO WRIGHT AVENUE" on the pin/.test(vB.record_mismatch || ''),
    '3d: the 10475-shaped draft is refused — INELIGIBLE, record_match false, with the comparison\'s words');
  ok(wB.length === 1 && !('image_bucket_path' in wB[0].body), '3e: …and the refusal writes no picture');
  ok(writes.every((w) => !/id=eq\.rowC/.test(w.url)),
    '3f: a draft whose stored picture is out of date (Map 1 now matches) is left unbound for a fresh capture, not stamped');
  ok(writes.every((w) => !/id=eq\.rowD/.test(w.url)) && exitCode === 1,
    '3g: an APPROVED post whose pin shows another record is never written, and the run fails');
  ok(writes.every((w) => !/id=eq\.rowE/.test(w.url)), '3h: a post with no project is untouched');
  ok(writes.length === 2, `3i: exactly two writes in all (${writes.length})`);

  // Already stamped: nothing to do.
  const again = await runStamp([{ ...row('rowA', 'approved', '85008', PIDS.A, REAL['85008'].record.name),
    evidence: { ...row('rowA', 'approved', '85008', PIDS.A, REAL['85008'].record.name).evidence,
      visual: { ...row('rowA', 'approved', '85008', PIDS.A, REAL['85008'].record.name).evidence.visual, record_match: true } } }]);
  ok(!again.threw && again.writes.length === 0 && again.exitCode !== 1, '3j: a post already checked is not written again');

  // The approved payload must not move. If the re-read shows any fingerprint input changed,
  // the run refuses to report success.
  const moved = await runStamp([row('rowA', 'approved', '85008', PIDS.A, REAL['85008'].record.name)], { movedOnReread: true });
  ok(moved.threw && /REFUSING TO REPORT SUCCESS: approved row rowA changed post_text/.test(moved.threw.message),
    '3k: if an approved post\'s payload reads back changed, the run refuses to report success');
}

// ── §4 THE LIVE CAPTURE COMPARES BEFORE IT PHOTOGRAPHS ────────────────────────────────
// Comment-stripped, because the comments quote the rule.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
                .replace(/(^|[^:])\/\/[^\n]*$/gm, '$1');
const iCmp = CODE.indexOf('HS.mapsPinRecordMismatch(auth.entry, proj)');
const iShot = CODE.indexOf('r = await capture(page, d, proj, theme)');
ok(iCmp > -1 && iShot > -1 && iCmp < iShot,
  '4a: the capture loop compares the pin with the post\'s record before it opens the browser');
ok((CODE.match(/r\.recordMatch = true/g) || []).length === 1
   && /if \(r\.ok\) \{[^}]*r\.recordMatch = true/.test(CODE),
  '4b: …and marks a picture as checked in one place only, after a successful capture');
ok(/if \(mismatch\) \{ await projectPinRefusal\(d, label, results, mismatch, mismatch\); continue; \}/.test(CODE),
  '4c: …and a mismatch is a recorded refusal, never a photograph');
ok(/,\$\{HS\.MAPS_PIN_RECORD_FIELDS\.join\(','\)\}/.test(CODE),
  '4d: the post\'s record is read with every compared field, from the same list the rule uses');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
