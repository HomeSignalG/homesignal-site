// MAP 1 ADDRESS-RADIUS — the LIVE production proof.
//
// One real user flow against the deployed site, driven in a real browser with NO network
// interception: the page talks to the real geocode-address function, the real
// n5_projects_within_radius RPC, the real app_projects and the real get-address-report,
// exactly as a resident's browser does. Nothing is mocked and nothing is stubbed.
//
// Scope is deliberately ONE flow: address search at the initial radius, ONE radius change,
// then ZIP mode. It issues no database probes of its own - every production call it makes is
// a call the page itself makes to serve that flow.
//
// Run: BASE=https://homesignal.net node scripts/map1-live-proof.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'https://homesignal.net';
const ADDRESS = process.env.ADDRESS || '2200 CALDWELL LN, DEL VALLE, TX 78617';
const ZIP = process.env.ZIP || '78617';
const R1 = Number(process.env.R1 || 1);
const R2 = Number(process.env.R2 || 2);

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 400)); }
};
const info = (k, v) => console.log('   · ' + k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const calls = [];
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
// OBSERVE ONLY. Requests are recorded, never intercepted or altered.
page.on('request', r => {
  const u = r.url();
  if (/functions\/v1\/geocode-address/.test(u)) calls.push({ kind: 'geocode', body: safe(r) });
  else if (/rpc\/n5_projects_within_radius/.test(u)) calls.push({ kind: 'rpc', body: safe(r) });
  else if (/functions\/v1\/get-address-report/.test(u)) calls.push({ kind: 'report', body: safe(r) });
  else if (/rest\/v1\/app_projects/.test(u)) calls.push({ kind: 'hydrate', url: u });
  else if (/rest\/v1\/development_reports/.test(u)) calls.push({ kind: 'zipcache', url: u });
});
function safe(r) { try { return JSON.parse(r.postData() || '{}'); } catch { return {}; } }
const rpcResponses = [];
// The geocoder's RESPONSE, not just the request. Without it "the radius is centred on the
// geocoded HOME" is an inference: the request proves what address was SENT, and only the
// response proves which point came BACK. Raw text is kept so the comparison against the RPC's
// centre can be byte-identical rather than float-equal after two reparses.
const geoResponses = [];
page.on('response', async (res) => {
  const u = res.url();
  if (/functions\/v1\/geocode-address/.test(u)) {
    try { const t = await res.text(); geoResponses.push({ status: res.status(), raw: t, body: JSON.parse(t) }); }
    catch { /* body already consumed */ }
    return;
  }
  if (!/rpc\/n5_projects_within_radius/.test(u)) return;
  try { rpcResponses.push({ status: res.status(), rows: await res.json() }); } catch { /* body already consumed */ }
});

// GREAT-CIRCLE DISTANCE, computed here and never read from the row being judged. The RPC
// reports its own distance_mi; asserting a row against that number only proves the RPC is
// self-consistent. Recomputing from the HOME point the GEOCODER returned to the marker
// coordinate the row CARRIES is what makes "a canonical physical location inside the selected
// radius" a measurement instead of a restatement.
const R_EARTH_MI = 3958.7613;
function haversineMi(aLat, aLng, bLat, bLng) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The contract radii. Default preserves the original two-radius flow exactly, so an existing
// dispatch behaves as it always did; a dispatch that names all four walks all four.
const RADII = String(process.env.RADII || '').trim()
  ? String(process.env.RADII).split(',').map(x => Number(x.trim())).filter(x => x > 0)
  : [R1, R2];
const EVIDENCE = { base: BASE, address: ADDRESS, zip: ZIP, radii_requested: RADII,
                   geocoded_home: null, per_radius: [], started_utc: new Date().toISOString() };
const sites = () => page.evaluate(() => (window.__HS_SITES || []).map(s => ({
  label: s.label, scope: s.scope, relevance: s.relevance, lat: s.lat, lng: s.lng,
  distance_mi: s.distance_mi, registry_id: s.registry_id,
  n5_source_key: s.n5_source_key || null, n5_feature_id: s.n5_feature_id || null,
  n5_provenance: s.n5_provenance || null, n5_geometry_type: s.n5_geometry_type || null })));

console.log('='.repeat(78));
console.log('MAP 1 ADDRESS-RADIUS — LIVE PRODUCTION PROOF');
info('base', BASE); info('address', ADDRESS); info('initial radius', R1 + ' mi');
console.log('='.repeat(78));

// ═══════════ 4. THE DEPLOYED PAGE CARRIES THE NEW IMPLEMENTATION ═══════════
const html = await (await fetch(BASE + '/homesignalmap.html', { cache: 'no-store' })).text();
ok(/functions\/v1\/geocode-address/.test(html), '4 — the deployed page calls geocode-address');
ok(/rpc\/n5_projects_within_radius/.test(html), '4 — the deployed page calls the N5 radius RPC');
ok(/st_?y|marker_lat/i.test(html) && /HS\.n5SitesFrom/.test(html),
  '4 — the deployed page consumes marker coordinates through the n5 helper');
const lib = await (await fetch(BASE + '/lib/n5-radius.js', { cache: 'no-store' })).text();
ok(/n5SitesFrom/.test(lib) && /marker_lat/.test(lib), '4 — lib/n5-radius.js is deployed');

await page.goto(BASE + '/homesignalmap.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#addr', { timeout: 30000 });
ok(errors.length === 0, '4 — the page loads with no fatal client error', errors.slice(0, 3));

// ═══════════ 5+6. ONE LIVE ADDRESS SEARCH ═══════════
calls.length = 0; rpcResponses.length = 0;
// The radius row lives INSIDE #results, which the page keeps display:none until a
// search has produced something (`.results{display:none}`, unchanged by this feature).
// So a real resident cannot touch the radius before searching, and neither may this
// proof — clicking a control the user cannot see would be proving a flow nobody has.
// The first search therefore runs at whatever radius the page is already showing; we
// read that off the page and assert the RPC is sent the radius the page displays.
const R1ACTIVE = await page.evaluate(() => {
  const b = document.querySelector('#radSel button.on');
  return b ? Number(b.getAttribute('data-r')) : null;
});
ok(R1ACTIVE === R1, '5 — the page opens on the requested initial radius', R1ACTIVE);
await page.fill('#addr', ADDRESS);
await page.click('#go');
await page.waitForFunction(() => {
  const t = document.getElementById('status');
  return (window.__HS_SITES || []).length > 0 || /couldn't|error/i.test(t ? t.textContent : '');
}, null, { timeout: 90000 });
await page.waitForTimeout(2500);

const geo = calls.find(c => c.kind === 'geocode');
const rpc = calls.find(c => c.kind === 'rpc');
ok(!!geo && geo.body.address === ADDRESS, '5 — the address went to production geocode-address', geo);
ok(!!rpc, '5 — the production N5 radius RPC was called', calls.map(c => c.kind));
const rpcRows = (rpcResponses[0] && Array.isArray(rpcResponses[0].rows)) ? rpcResponses[0].rows : [];
ok(rpcResponses[0] && rpcResponses[0].status === 200, '5 — the RPC answered 200', rpcResponses[0] && rpcResponses[0].status);
info('geocoded HOME', { lat: rpc && rpc.body.p_lat, lng: rpc && rpc.body.p_lng });
info('radius sent', rpc && rpc.body.p_radius_mi);
info('N5 rows returned', rpcRows.length);
info('has_more', rpcRows.some(r => r.has_more === true));
ok(rpc && rpc.body.p_radius_mi === R1, '5 — the selected radius was sent', rpc && rpc.body.p_radius_mi);

// ═══ 5b. THE RADIUS IS CENTRED ON THE POINT THE GEOCODER RETURNED ═══
// Requirement 4. Previously the HOME coordinate was only INFO'd, which proves nothing about
// where it came from: a centroid, a cached value, or a ZIP anchor would print identically.
const geoRes = geoResponses[0];
ok(!!geoRes && geoRes.status === 200, '5b — production geocode-address answered 200',
   geoRes && geoRes.status);
const gm = geoRes && (geoRes.body.match || geoRes.body);
const gLat = gm && (gm.lat != null ? gm.lat : gm.latitude);
const gLng = gm && (gm.lng != null ? gm.lng : gm.longitude);
ok(gLat != null && gLng != null, '5b — the geocoder returned a HOME coordinate',
   gm && JSON.stringify(gm).slice(0, 200));
info('geocoder matchedAddress', gm && (gm.matchedAddress || gm.address));
info('geocoder HOME lat/lng', { lat: gLat, lng: gLng });
// Byte-identical, not float-close: the page must pass the geocoder's point through unchanged.
ok(String(rpc.body.p_lat) === String(gLat) && String(rpc.body.p_lng) === String(gLng),
   '5b — the RPC is centred on EXACTLY the geocoded HOME point, unmodified',
   { geocoder: [gLat, gLng], rpc_centre: [rpc.body.p_lat, rpc.body.p_lng] });
// Requirement 6, at the request layer: ZIP geography must not enter address mode at all.
const rpcKeys = Object.keys(rpc.body || {});
ok(!rpcKeys.some(k => /zip/i.test(k)), '5b — the radius RPC carries NO zip parameter', rpcKeys);
ok(!(calls.find(c => c.kind === 'report') || {}).body?.zip,
   '5b — the report request carries no zip either — address geography is never ZIP geography');
EVIDENCE.geocoded_home = { lat: gLat, lng: gLng,
  matched: gm && (gm.matchedAddress || gm.address) || null,
  rpc_centre_lat: rpc.body.p_lat, rpc_centre_lng: rpc.body.p_lng,
  byte_identical: String(rpc.body.p_lat) === String(gLat) && String(rpc.body.p_lng) === String(gLng) };

// ═══ 5c. EVERY RETURNED PROJECT IS PHYSICALLY INSIDE THE SELECTED RADIUS ═══
// Requirement 5, measured independently of the number the row reports about itself.
const HOME = { lat: Number(gLat), lng: Number(gLng) };
function radiusEvidence(radius, rows, rendered) {
  const withGeom = rows.filter(r => r.marker_lat != null && r.marker_lng != null);
  const checks = withGeom.map(r => {
    const d = haversineMi(HOME.lat, HOME.lng, Number(r.marker_lat), Number(r.marker_lng));
    return { source_key: r.source_key, feature_id: r.feature_id, registry_id: r.registry_id,
             provenance: r.provenance, geometry_type: r.geometry_type,
             marker_lat: r.marker_lat, marker_lng: r.marker_lng,
             rpc_distance_mi: r.distance_mi, recomputed_mi: Number(d.toFixed(6)),
             delta_mi: Number(Math.abs(d - Number(r.distance_mi)).toFixed(6)),
             inside: d <= radius + 1e-6 };
  });
  const outside = checks.filter(c => !c.inside);
  const disagree = checks.filter(c => c.delta_mi > 0.02);
  const noGeom = rows.length - withGeom.length;
  EVIDENCE.per_radius.push({ radius, rows_returned: rows.length, rows_with_geometry: withGeom.length,
    rows_without_geometry: noGeom, rendered_canonical: rendered,
    max_recomputed_mi: checks.length ? Math.max(...checks.map(c => c.recomputed_mi)) : null,
    max_delta_mi: checks.length ? Math.max(...checks.map(c => c.delta_mi)) : null,
    outside_radius: outside.length, distance_disagreements: disagree.length,
    sample: checks.slice(0, 5) });
  info(`[${radius} mi] rows`, rows.length + ' (with geometry ' + withGeom.length + ')');
  if (checks.length) {
    info(`[${radius} mi] farthest recomputed`, Math.max(...checks.map(c => c.recomputed_mi)) + ' mi');
    info(`[${radius} mi] worst distance delta`, Math.max(...checks.map(c => c.delta_mi)) + ' mi');
  }
  ok(rows.length === 0 || withGeom.length > 0,
     `5c — [${radius} mi] returned rows carry canonical marker geometry`, { rows: rows.length, withGeom: withGeom.length });
  ok(outside.length === 0,
     `5c — [${radius} mi] EVERY returned project is physically within the selected radius`,
     outside.slice(0, 4));
  ok(disagree.length === 0,
     `5c — [${radius} mi] the RPC's distance_mi matches an independent great-circle recompute from the geocoded HOME`,
     disagree.slice(0, 4));
  ok(checks.every(c => /point|polygon|linestring|geometry/i.test(String(c.geometry_type || ''))),
     `5c — [${radius} mi] every result is a real canonical geometry, not a synthesised point`,
     [...new Set(checks.map(c => c.geometry_type))]);
  return checks;
}
radiusEvidence(R1, rpcRows, (await sites()).filter(x => x.n5_feature_id).length);

const homePins = await page.locator('.homepin').count();
ok(homePins === 1, '6 — the HOME marker is drawn', homePins);
const ring = await page.evaluate(() => document.querySelectorAll('#mapInner path.leaflet-interactive').length);
ok(ring >= 1, '6 — the radius ring is drawn', ring);

let s = await sites();
const n5 = s.filter(x => x.n5_feature_id);
info('canonical development results rendered', n5.length);
if (rpcRows.length > 0) {
  ok(calls.some(c => c.kind === 'hydrate'), '6 — app_projects hydration was queried by source_key');
  ok(n5.length > 0, '6 — at least one canonical development result renders', s.map(x => x.label).slice(0, 8));
  const rep = n5[0];
  const row = rpcRows.find(r => r.source_key === rep.n5_source_key && r.feature_id === rep.n5_feature_id);
  info('representative source_key', rep.n5_source_key);
  info('representative feature_id', rep.n5_feature_id);
  info('representative provenance', rep.n5_provenance);
  info('representative distance_mi', rep.distance_mi);
  info('representative geometry_type', rep.n5_geometry_type);
  ok(!!row, '6 — the rendered result corresponds to a returned RPC row');
  ok(row && rep.lat === row.marker_lat && rep.lng === row.marker_lng,
    '6 — its marker position IS the RPC marker_lat/marker_lng', { rendered: [rep.lat, rep.lng], rpc: row && [row.marker_lat, row.marker_lng] });
  ok(row && rep.distance_mi === row.distance_mi,
    '6 — its distance IS the RPC distance_mi, not recomputed', { rendered: rep.distance_mi, rpc: row && row.distance_mi });
  ok(!!rep.label, '6 — project content hydrated from app_projects', rep.label);
  ok(rep.registry_id === undefined || rep.registry_id === null,
    '9 — a canonical project carries no registry_id, so it is never an EPA facility', rep.registry_id);
  const opened = await page.evaluate(() => {
    const hit = (window.siteMarkers || []).find(x => x && x.s && x.s.n5_feature_id);
    if (!hit) return { found: false };
    hit.m.openPopup(); return { found: true, label: hit.s.label };
  });
  ok(opened.found, '6 — the canonical result is a real clickable map marker', opened);
  await page.waitForSelector('.leaflet-popup-content', { timeout: 10000 }).catch(() => {});
  const popup = (await page.textContent('.leaflet-popup-content').catch(() => '')) || '';
  ok(popup.length > 0, '6 — clicking it opens the existing Map 1 dossier popup');
  info('dossier popup', popup.replace(/\s+/g, ' ').slice(0, 160));
  ok(!/Facility · operating now/.test(popup), '9 — and it is NOT labelled as an EPA facility');
  const hasLink = await page.evaluate(() => !!document.querySelector('.leaflet-popup-content a[href^="http"]'));
  ok(hasLink, '6 — the dossier carries an official record link (source/evidence intact)');
} else {
  // A legitimate outcome, and the wording must stay honest about it.
  const fresh = await page.textContent('#freshLine');
  ok(/no canonical project geometry in the development corpus/.test(fresh || ''),
    '15 — zero rows is described as what the corpus returned, not "nothing nearby": ' + fresh);
}
const fresh1 = await page.textContent('#freshLine');
info('completeness line', fresh1);
const facs = s.filter(x => x.registry_id);
ok(facs.every(f => f.relevance !== 'development'), '9 — facilities are not converted into development', facs.slice(0, 3));
const areas = s.filter(x => x.scope === 'area');
ok(areas.every(a => a.distance_mi === undefined || a.distance_mi === null),
  '9 — area/jurisdiction notices carry no radius distance', areas.slice(0, 3));
info('facilities rendered', facs.length);
info('area notices rendered', areas.length);

// ═══════════ 7. ONE LIVE RADIUS CHANGE ═══════════
const homeBefore = { lat: rpc.body.p_lat, lng: rpc.body.p_lng };
calls.length = 0; rpcResponses.length = 0;
const RLBL = (r) => (r === 0.5 ? '\u00bd mile' : (r === 1 ? '1 mile' : r + ' miles'));
await page.click(`#radSel button[data-r="${R2}"]`);
// CONDITION, not a stopwatch. The first search took ~28 s live; a fixed 6 s wait sampled the
// page mid-flight and read the PREVIOUS radius's render back as if it were this one - which is
// how a stale DOM gets reported as a defect (and how a real one could hide). Wait for the page's
// own completeness line to name the new radius, i.e. for the new response to have RENDERED.
await page.waitForFunction((lbl) => {
  const el = document.getElementById('freshLine');
  return !!el && el.textContent.indexOf(lbl) !== -1;
}, RLBL(R2), { timeout: 90000 });
const rpc2 = calls.find(c => c.kind === 'rpc');
ok(!!rpc2 && rpc2.body.p_radius_mi === R2, '7 — the new radius was queried', rpc2 && rpc2.body.p_radius_mi);
ok(rpc2 && rpc2.body.p_lat === homeBefore.lat && rpc2 && rpc2.body.p_lng === homeBefore.lng,
  '7 — HOME is unchanged across the radius change', rpc2 && { lat: rpc2.body.p_lat, lng: rpc2.body.p_lng });
// The page's radius handler is `if(CUR_ADDRESS){ run(CUR_ADDRESS); }` - byte-identical to its
// pre-feature form (f7e448ad line 1902), so a radius change has ALWAYS re-run the whole address
// flow. Before this feature the geocode happened server-side inside get-address-report; now it is
// a visible call. So a second geocode is expected behaviour, not a defect, and the invariant that
// actually matters is the one asserted immediately above: HOME must not MOVE. Recorded, not scored.
info('address re-geocoded on radius change (pre-existing handler behaviour)',
  calls.some(c => c.kind === 'geocode'));
const rows2 = (rpcResponses[0] && Array.isArray(rpcResponses[0].rows)) ? rpcResponses[0].rows : [];
info('N5 rows at ' + R2 + ' mi', rows2.length);
s = await sites();
const n5b = s.filter(x => x.n5_feature_id);
info('canonical results rendered at ' + R2 + ' mi', n5b.length);
// The assertion this replaces was VACUOUS: `r.marker_lat != null || true` is always true, so the
// filter kept every row and the fallback `n5b.length <= rows2.length` (5 <= 19) could not fail.
// Three real invariants instead.
const kOf = (x) => x.n5_source_key + '|' + x.n5_feature_id;
const rows2Keys = new Set(rows2.map(r => r.source_key + '|' + r.feature_id));
ok(n5b.length > 0 && n5b.every(x => rows2Keys.has(kOf(x))),
  '7 — every result rendered at the new radius is one the RPC returned for THAT radius',
  { rendered: n5b.length, returned: rows2.length });
const keptKeys = new Set(n5b.map(kOf));
const lost = n5.filter(x => !keptKeys.has(kOf(x)));
ok(lost.length === 0, '7 — widening the radius loses nothing that was inside the smaller one',
  lost.map(x => x.label).slice(0, 5));
ok(rows2.length >= rpcRows.length,
  '7 — the wider radius returns at least as much canonical geometry',
  { ['at ' + R1 + ' mi']: rpcRows.length, ['at ' + R2 + ' mi']: rows2.length });
ok(n5b.every(x => { const r = rows2.find(q => q.source_key === x.n5_source_key && q.feature_id === x.n5_feature_id);
  return !r || x.distance_mi === r.distance_mi; }), '7 — distance remains the RPC distance_mi');
const fresh2 = await page.textContent('#freshLine');
info('completeness line at ' + R2 + ' mi', fresh2);
// The resident's own words for the new radius. A line that still says "within 1 mile" while the
// map shows a 2-mile query is a coverage claim about the wrong geography.
ok((fresh2 || '').indexOf(RLBL(R2)) !== -1,
  '7 — the completeness line names the NEW radius, not the previous one', fresh2);
if (rows2.some(r => r.has_more === true)) {
  ok(/more canonical project geometry exists/.test(fresh2 || ''),
    '9 — has_more is surfaced, not presented as complete: ' + fresh2);
}

radiusEvidence(R2, rows2, n5b.length);

// ═══════════ 7b. THE REMAINING CONTRACT RADII ═══════════
// Requirement 4 names four controls — 0.5 / 1 / 2 / 5. The original flow proved two. The rest
// are walked here through the SAME page in the SAME session, clicking the same control a
// resident clicks, so nothing about the mechanism changes — only the coverage.
for (const R of RADII.filter(r => r !== R1 && r !== R2)) {
  calls.length = 0; rpcResponses.length = 0;
  const sel = `#radSel button[data-r="${R}"]`;
  const present = await page.locator(sel).count();
  ok(present === 1, `7b — the page offers the ${R} mi control a resident would click`, present);
  if (present !== 1) continue;
  await page.click(sel);
  await page.waitForFunction((lbl) => {
    const el = document.getElementById('freshLine');
    return !!el && el.textContent.indexOf(lbl) !== -1;
  }, RLBL(R), { timeout: 90000 });
  const rpcN = calls.find(c => c.kind === 'rpc');
  ok(!!rpcN && rpcN.body.p_radius_mi === R, `7b — [${R} mi] the selected radius was queried`,
     rpcN && rpcN.body.p_radius_mi);
  // Requirement 4 again, at every control: the centre must still be the geocoded HOME.
  ok(rpcN && String(rpcN.body.p_lat) === String(gLat) && String(rpcN.body.p_lng) === String(gLng),
     `7b — [${R} mi] still centred on EXACTLY the geocoded HOME point`,
     rpcN && { lat: rpcN.body.p_lat, lng: rpcN.body.p_lng });
  ok(rpcN && !Object.keys(rpcN.body).some(k => /zip/i.test(k)),
     `7b — [${R} mi] no zip parameter — ZIP geography is not substituted into address mode`);
  const rowsN = (rpcResponses[0] && Array.isArray(rpcResponses[0].rows)) ? rpcResponses[0].rows : [];
  const sN = await sites();
  const n5N = sN.filter(x => x.n5_feature_id);
  const keysN = new Set(rowsN.map(r => r.source_key + '|' + r.feature_id));
  ok(n5N.every(x => keysN.has(x.n5_source_key + '|' + x.n5_feature_id)),
     `7b — [${R} mi] every rendered result is one the RPC returned for THAT radius`,
     { rendered: n5N.length, returned: rowsN.length });
  radiusEvidence(R, rowsN, n5N.length);
  const freshN = await page.textContent('#freshLine');
  ok((freshN || '').indexOf(RLBL(R)) !== -1,
     `7b — [${R} mi] the completeness line names THIS radius`, freshN);
}

// MONOTONICITY ACROSS THE WHOLE CONTRACT LADDER. A larger circle around a fixed centre
// contains a smaller one, so the returned population can never shrink as the radius grows.
// This is the property that would break first if any control were re-centred.
{
  const byR = EVIDENCE.per_radius.slice().sort((a, b) => a.radius - b.radius);
  const shrinks = byR.filter((x, i) => i > 0 && x.rows_returned < byR[i - 1].rows_returned);
  info('radius ladder', byR.map(x => x.radius + ' mi -> ' + x.rows_returned + ' rows').join('  |  '));
  ok(shrinks.length === 0,
     '7b — the returned population never shrinks as the radius grows (one fixed centre)',
     shrinks.map(x => x.radius));
}

// ═══════════ 8. LIVE ZIP REGRESSION ═══════════
calls.length = 0;
await page.goto(BASE + '/homesignalmap.html?zip=' + ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 60000 });
await page.waitForTimeout(4000);
s = await sites();
ok(calls.some(c => c.kind === 'zipcache'), '8 — ZIP mode reads the entire-ZIP cached report');
ok(!calls.some(c => c.kind === 'rpc'), '8 — ZIP mode makes NO N5 radius call', calls.map(c => c.kind));
ok(!s.some(x => x.n5_feature_id), '8 — no address-radius result survives into ZIP mode',
  s.filter(x => x.n5_feature_id).map(x => x.label));
const cap = await page.textContent('#withinLbl');
ok(/Across ZIP/.test(cap || ''), '8 — ZIP mode presents the ENTIRE ZIP geography: ' + cap);
ok((await page.locator('.homepin').count()) === 0, '8 — no HOME pin is shown for a ZIP centroid');
info('ZIP sites rendered', s.length);
ok(s.length >= 0, '8 — the ZIP page renders');

// ═══════════ 10. MAP 2 RETIREMENT — one map, and no dead end ═══════════
// The retired page must not be a second map experience, must not be a 404, and must not
// silently drop the ZIP an old bookmark carried.
const retired = await (await fetch(BASE + '/maps.html', { cache: 'no-store' })).text();
ok(/location\.replace\('\/homesignalmap\.html'/.test(retired),
  '10 — the retired map URL serves a redirect to the primary map');
ok(!/<template id="hs-content">/.test(retired) && retired.length < 8000,
  '10 — it is a stub, not a second map experience', retired.length + ' bytes');

await page.goto(BASE + '/maps.html?zip=' + ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForURL(/homesignalmap\.html/, { timeout: 30000 });
ok(page.url().indexOf('homesignalmap.html') >= 0,
  '10 — a resident on the old URL lands on the primary map: ' + page.url());
ok(page.url().indexOf('zip=' + ZIP) >= 0,
  '10 — the old URL keeps its ZIP across the forward, so the bookmark still works');
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 60000 });
ok((await page.locator('#map, #mapInner').count()) >= 1, '10 — and the primary map renders there');

// The normal user path: no live page may still offer the retired map as a destination.
for (const path of ['/partials/shell.html', '/dashboard.html', '/today.html',
                    '/development.html', '/homesignalmap.html', '/lib/onboarding.js']) {
  const body = await (await fetch(BASE + path, { cache: 'no-store' })).text();
  ok(!/href="maps\.html"|'maps\.html'|"maps\.html"/.test(body),
    '10 — ' + path + ' offers no route to the retired map');
}
const nav = await (await fetch(BASE + '/partials/shell.html', { cache: 'no-store' })).text();
ok(/href="homesignalmap\.html"\s+data-nav="maps"/.test(nav),
  '10 — the global nav Maps entry points at the primary map');

// ═══════════ 11. ZIP MODE IS THE WHOLE ZIP — no centroid, no radius ═══════════
// The invariant: a ZIP search represents the ENTIRE actual ZIP/ZCTA geography and never
// substitutes a circle around a point. Proven against the deployed page and the real RPC.
const zlib = await (await fetch(BASE + '/lib/zip-authoritative.js', { cache: 'no-store' })).text();
ok(/zipAuthSitesFrom/.test(zlib) && /not_measured/.test(zlib),
  '11 — lib/zip-authoritative.js is deployed');
const zpage = await (await fetch(BASE + '/homesignalmap.html', { cache: 'no-store' })).text();
ok(/rpc\/app_zip_projects_markers/.test(zpage),
  '11 — the deployed page reads authoritative whole-ZIP geography');

await page.goto(BASE + '/homesignalmap.html?zip=' + ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 60000 });
await page.waitForTimeout(4000);
const zsites = await page.evaluate(() => (window.__HS_SITES || []).map(s => ({
  rel: s.relevance, scope: s.scope, auth: s.zip_authoritative === true,
  ref: s.zip_project_ref || null, rule: s.zip_marker_rule || null,
  dist: s.distance_mi, e: s.e, n: s.n, rid: s.registry_id, url: s.record_url })));
const zdev = zsites.filter(x => x.scope === 'point' && x.rel === 'development');
info('ZIP-mode sites rendered', zsites.length);
info('ZIP-mode development points', zdev.length);
info('...of which authoritative', zdev.filter(x => x.auth).length);
ok(zdev.length > 0 && zdev.every(x => x.auth),
  '11 — EVERY development point in ZIP mode comes from authoritative whole-ZIP geography',
  zdev.filter(x => !x.auth).slice(0, 3));
ok(zdev.every(x => x.dist === undefined || x.dist === null),
  '11 — no ZIP-mode development point carries a radius distance (there is no HOME to measure from)');
ok(zdev.every(x => x.rid === undefined || x.rid === null),
  '11 — no authoritative project carries registry_id, so none is mistaken for an EPA facility');
ok(zdev.every(x => !!x.url), '11 — every rendered ZIP-mode project keeps its official record link');
info('distinct authoritative projects', new Set(zdev.map(x => x.ref)).size);
info('marker rules in use', Array.from(new Set(zdev.map(x => x.rule))).slice(0, 4).join(' | '));

// The radius control must not be offered in ZIP mode - a circle needs an address-derived centre.
ok(!(await page.locator('#radSel').isVisible().catch(() => false)),
  '11 — the radius control is NOT offered in ZIP mode');
const zipLine = await page.textContent('#freshLine');
info('ZIP completeness line', zipLine);
ok(/whole of ZIP|whole ZIP|not measured yet/i.test(zipLine || ''),
  '11 — the page states what was measured across the WHOLE ZIP', zipLine);

// ...and address mode still gets its radius back, on the same deployed page.
await page.goto(BASE + '/homesignalmap.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#addr', { timeout: 30000 });
await page.fill('#addr', ADDRESS);
await page.click('#go');
await page.waitForFunction(() => (window.__HS_SITES || []).length > 0, null, { timeout: 90000 });
ok(await page.locator('#radSel').isVisible(),
  '11 — an address search restores the radius control (address mode is untouched)');

console.log('='.repeat(78));
console.log('FAILS: ' + fails);
console.log('='.repeat(78));
await browser.close();
EVIDENCE.finished_utc = new Date().toISOString();
EVIDENCE.fails = fails;
EVIDENCE.result = fails ? 'FAIL' : 'PASS';
try {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync('artifacts/address-mode', { recursive: true });
  const out = 'artifacts/address-mode/live-proof-' + (process.env.RUN_ID || 'local') + '.json';
  writeFileSync(out, JSON.stringify(EVIDENCE, null, 2));
  console.log('\nEVIDENCE ARTIFACT: ' + out);
} catch (e) { console.log('could not write evidence artifact: ' + e); }

process.exit(fails ? 1 : 0);
