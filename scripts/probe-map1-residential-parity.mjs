// probe-map1-residential-parity.mjs — does every Residential record the ZIP-mode builder
// qualifies reach the map as a marker, in every lifecycle slice?
//
// THE DEFECT THIS WATCHES (fixed 2026-09-27). Map 1 checks Residential qualification twice:
// where a ZIP-mode site is BUILT (lib/zip-authoritative.js, with the full app_projects row) and
// again at DRAW time in render() (HS.residentialQualifySites). The draw-time check read the
// class field as `type_raw`, which the builder carries as `permit_class`, so records qualified
// on their class field were built and then removed before they could be drawn.
//
// FOUR NUMBERS PER ZIP AND SLICE (proposed / approved / operating / unknown), each counted as
// markers and as distinct projects:
//   assigned   the shipped builder's Residential sites for the payload the PAGE itself fetched
//              (captured off the page's own RPC response, so both halves read the same data),
//              after the page's record-URL gate
//   canonical  of those markers, the ones whose project row passes HS.residentialActivity on the
//              FULL row - independent of the builder
//   qualified  Residential ZIP-mode sites in the page's rendered set (window.__HS_SITES)
//   drawn      Residential ZIP-mode markers actually on the Leaflet map (window.siteMarkers,
//              marker attached to a map)
// PASS requires all four equal. `pre` is the same payload through the draw-time check with the
// builder's recorded evidence removed - the page before the fix - and is reported so a run can
// show the population it measured was actually affected.
//
// Env: SITE_BASE (default https://homesignal.net; the workflow serves the checked-out tree on
// localhost), ZIPS (comma list, required), EXPECT ('parity' fails on any inequality; 'report'
// only prints - for reading what production draws before the fix is deployed).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

globalThis.window = globalThis.window || globalThis;
for (const f of ['../lib/project-type.js', '../lib/map.js', '../lib/residential-qualify.js', '../lib/n5-radius.js', '../lib/zip-authoritative.js']) {
  (0, eval)(readFileSync(new URL(f, import.meta.url), 'utf8'));
}
const HS = globalThis.window.HS;

const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const ZIPS = (process.env.ZIPS || '').split(',').map((z) => z.trim()).filter((z) => /^\d{5}$/.test(z));
const EXPECT = process.env.EXPECT === 'report' ? 'report' : 'parity';
if (!ZIPS.length) { console.error('ZIPS is required (comma-separated 5-digit ZIPs)'); process.exit(2); }

const SLICES = ['proposed', 'approved', 'operating', 'unknown'];
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!c) fails++;
};

// The page's own record-URL gate (homesignalmap.html sourced()), so "assigned" is comparable to
// what the page can draw at all.
const sourced = (s) => !!(s && ((s.url && String(s.url).trim()) || (s.record_url && String(s.record_url).trim())));
const isRes = (s) => { try { return HS.resolveTrackerMarker(s).typeKey === 'residential'; } catch (e) { return false; } };
const sliceOf = (s) => { let lc = null; try { lc = HS.resolveTrackerMarker(s, () => '').lifecycle; } catch (e) { lc = null; }
  return SLICES.indexOf(lc) === -1 ? 'unknown' : lc; };
function tally(sites, slice, ref) {
  const t = Object.fromEntries(SLICES.map((k) => [k, { markers: 0, projects: 0 }]));
  const seen = Object.fromEntries(SLICES.map((k) => [k, new Set()]));
  for (const s of sites) {
    const k = slice(s);
    t[k].markers++;
    const r = ref(s);
    if (!seen[k].has(r)) { seen[k].add(r); t[k].projects++; }
  }
  return t;
}
const withoutEvidence = (s) => { const c = Object.assign({}, s); delete c.residential_evidence; return c; };

const browser = await chromium.launch();
console.log(`Map 1 Residential draw-time parity — ${SITE_BASE} — ${ZIPS.length} ZIP(s), expect=${EXPECT}\n`);
const totals = { assigned: 0, drawn: 0, pre: 0 };

for (const zip of ZIPS) {
  const ctx = await browser.newContext();      // fresh storage: the page's default filters
  const page = await ctx.newPage();
  let payload = null;
  const captured = new Promise((resolve) => {
    page.on('response', async (resp) => {
      try {
        if (!resp.url().includes('/rpc/app_zip_projects_markers')) return;
        if (!/"development"/.test(resp.request().postData() || '')) return;
        payload = await resp.json();
        resolve();
      } catch (e) { /* a failed body read leaves payload null; reported below */ }
    });
  });
  try {
    await page.goto(`${SITE_BASE}/homesignalmap.html?zip=${encodeURIComponent(zip)}`,
                    { waitUntil: 'domcontentloaded', timeout: 60000 });
    await Promise.race([captured, new Promise((r) => setTimeout(r, 120000))]);
    await page.waitForFunction(() => window.__HS_VERIFY && Array.isArray(window.__HS_SITES)
                                      && Array.isArray(window.siteMarkers), null, { timeout: 180000 });
  } catch (e) {
    ok(false, `${zip}: the page loaded and drew`, String(e && e.message).slice(0, 160));
    await ctx.close();
    continue;
  }
  if (!payload || !HS.zipAuthIsComplete(payload)) {
    ok(false, `${zip}: the page's own development read was captured and is complete`,
       payload ? 'outcome ' + HS.zipAuthOutcome(payload) : 'no response captured');
    await ctx.close();
    continue;
  }

  // ── the builder's answer and the canonical control, from the page's own payload ──
  const byRef = Object.create(null);
  payload.projects.forEach((p) => { if (p && p.project_ref && !byRef[p.project_ref]) byRef[p.project_ref] = p; });
  const built = HS.zipAuthSitesFrom(payload).filter(sourced);
  const assignedSites = built.filter(isRes);
  const gate = HS.residentialGateAtConstruction;
  HS.residentialGateAtConstruction = null;          // the same builder with the gate detached
  const ungated = HS.zipAuthSitesFrom(payload).filter(sourced);
  HS.residentialGateAtConstruction = gate;
  const canonicalSites = ungated.filter(isRes).filter((s) => {
    const p = byRef[s.zip_project_ref];
    return !!p && HS.residentialActivity(p).verdict === 'DEVELOPMENT';
  });
  const preSites = HS.residentialQualifySites(built.map(withoutEvidence)).filter(isRes);
  const refOf = (s) => s.zip_project_ref;
  const A = tally(assignedSites, sliceOf, refOf);
  const C = tally(canonicalSites, sliceOf, refOf);
  const P = tally(preSites, sliceOf, refOf);

  // ── what the page qualified and drew ──
  const m = await page.evaluate((SL) => {
    const HSp = window.HS;
    const lc = (s) => { let v = null; try { v = HSp.resolveTrackerMarker(s, () => '').lifecycle; } catch (e) { v = null; }
      return SL.indexOf(v) === -1 ? 'unknown' : v; };
    const res = (s) => { try { return HSp.resolveTrackerMarker(s).typeKey === 'residential'; } catch (e) { return false; } };
    const zero = () => Object.fromEntries(SL.map((k) => [k, { markers: 0, projects: 0, refs: {} }]));
    const q = zero(), d = zero();
    (window.__HS_SITES || []).forEach((s) => {
      if (!s || s.zip_authoritative !== true || !res(s)) return;
      const t = q[lc(s)]; t.markers++; if (!t.refs[s.zip_project_ref]) { t.refs[s.zip_project_ref] = 1; t.projects++; }
    });
    let otherResDrawn = 0;
    (window.siteMarkers || []).forEach((x) => {
      if (!x || !x.m || !x.m._map || !x.mk || x.mk.typeKey !== 'residential') return;
      if (!x.s || x.s.zip_authoritative !== true) { otherResDrawn++; return; }
      const k = SL.indexOf(x.bucket) === -1 ? 'unknown' : x.bucket;
      const t = d[k]; t.markers++; if (!t.refs[x.s.zip_project_ref]) { t.refs[x.s.zip_project_ref] = 1; t.projects++; }
    });
    SL.forEach((k) => { delete q[k].refs; delete d[k].refs; });
    const v = window.__HS_VERIFY || {};
    return { q, d, otherResDrawn, allTypesOff: v.allTypesOff, stagesOn: v.stagesOn || [],
             mapMarkers: v.mapMarkers, visibleMarkers: v.visibleMarkers };
  }, SLICES);

  const sum = (t, f) => SLICES.reduce((n, k) => n + t[k][f], 0);
  totals.assigned += sum(A, 'projects'); totals.drawn += sum(m.d, 'projects'); totals.pre += sum(P, 'projects');
  console.log(`── ${zip} · filters: all types on=${m.allTypesOff === false}, stages on=[${m.stagesOn.join(',')}]`
    + ` · ${m.visibleMarkers}/${m.mapMarkers} markers visible · pre-fix loss ${sum(A, 'projects') - sum(P, 'projects')} project(s)`);
  for (const k of SLICES) {
    const line = `markers ${A[k].markers}/${C[k].markers}/${m.q[k].markers}/${m.d[k].markers}`
      + ` · projects ${A[k].projects}/${C[k].projects}/${m.q[k].projects}/${m.d[k].projects}`
      + ` · pre-fix drawn ${P[k].projects}`;
    const equal = ['markers', 'projects'].every((f) =>
      A[k][f] === C[k][f] && C[k][f] === m.q[k][f] && m.q[k][f] === m.d[k][f]);
    if (EXPECT === 'parity') ok(equal, `${zip} ${k}: assigned = canonical = qualified = drawn`, line);
    else console.log(`   ${equal ? 'EQUAL  ' : 'UNEQUAL'} ${k}: assigned/canonical/qualified/drawn  ${line}`);
  }
  await ctx.close();
}
await browser.close();

console.log(`\nTOTAL Residential projects over ${ZIPS.length} ZIP(s): assigned ${totals.assigned} · drawn ${totals.drawn}`
  + ` · drawn before the fix (same payloads) ${totals.pre}`);
if (EXPECT === 'parity') {
  // The run must have looked at the affected population, or a PASS would say nothing.
  ok(totals.assigned > totals.pre,
     'CONTROL: these ZIPs carry Residential records the pre-fix draw-time check removed',
     `${totals.assigned - totals.pre} project(s)`);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
}
