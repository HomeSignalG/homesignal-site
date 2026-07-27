// PRODUCTION verifier for the Maps marker SYMBOLOGY across the WHOLE plotted set —
// the exact home view the founder reviews: 13313 COOMES DR, ZIP 78617, Map view 1.5 mi.
//
// WHY THIS EXISTS
// The lettered A–P pins are DOM nodes, so scripts/verify-map-markers.mjs can read their
// SVG geometry and prove "shape = project type". Everything PAST the 16th record rides
// the rest layer, which on the tile maps is drawn to a canvas — no DOM, no verifier
// coverage. That blind spot is how a real defect reached production: the rest layer was
// a MapLibre `circle` layer and the Leaflet fallback used `circleMarker`, both of which
// can express only COLOUR. `restFeatureCollection` computed each record's real shape and
// then dropped it. On this exact view that meant 97 of 113 markers were circles when only
// 24 were honestly unclassifiable — the classifier was right the whole time.
//
// So this verifier reads LIVE renderer state (window.__HS_REST_VERIFY): the MapLibre
// layer's actual `type`, its real `icon-image` expression, whether each generated icon
// image is registered in the GL style, and the shape every renderer drew per record.
//
// WHAT IT ASSERTS (structure, not a frozen census — the record set legitimately changes)
//   1. every plotted rest record renders the shape HS.resolveMarker gave it,
//   2. NO circle without an honest FALLBACK:other classification + stated reason,
//   3. Street / Satellite / Focus agree on shape, record for record,
//   4. regulated facilities (square) stay distinct from data centers (octagon),
//   5. the legend explains every shape actually drawn,
//   6. the production console is clean.
// The observed shape distribution is PRINTED every run and compared to the acceptance
// baseline as INFORMATION only — a changed count is news, not a failure.
//
// THE HOME ANCHOR (privacy): this repo is public, so a resident's precise parcel geocode
// is not committed. The anchor defaults to the Del Valle coordinate already in the repo
// (~0.2 mi from the parcel, so the 1.5 mi record set is very nearly the same). Supply
// HOME_LAT/HOME_LNG (GitHub secrets — masked in logs) to reproduce the parcel-exact view.
// Only the ACCOUNT read is stubbed; the page, its data, and every renderer are the real
// deployed production code.
//
// Run: node scripts/verify-maps-rest-shapes.mjs            (against production)
//      SITE_BASE=http://localhost:8765 node scripts/verify-maps-rest-shapes.mjs
import { chromium } from 'playwright';

const BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const ZIP = process.env.HOME_ZIP || '78617';
const RADIUS_MI = Number(process.env.RADIUS_MI || 1.5);
const HOME = {
  id: 'hs-verify-home',
  label: 'home',
  tag: 'home',
  address: process.env.HOME_ADDRESS || '13313 COOMES DR',
  city: 'DEL VALLE', state: 'TX', zip: ZIP,
  lat: Number(process.env.HOME_LAT || 30.174),
  lng: Number(process.env.HOME_LNG || -97.614),
};
// Acceptance evidence from the founder's 2026-07-26 review of this view. Reported, never
// asserted: these are a snapshot of live public records, not a product requirement.
const BASELINE = { plotted: 113, classified: 89, honestCircles: 24 };

const fails = [];
const notes = [];
const ok = (cond, msg, detail) => {
  if (cond) console.log('  PASS — ' + msg + (detail ? '  [' + detail + ']' : ''));
  else { fails.push(msg + (detail ? ' — ' + detail : '')); console.log('  FAIL — ' + msg + (detail ? '  [' + detail + ']' : '')); }
};

// Sign-in cannot happen on a CI runner, so the account read is intercepted before any
// page script runs. Everything downstream (records, classification, rendering) is real.
function injectHome(page, home) {
  return page.addInitScript((h) => {
    let _HS;
    Object.defineProperty(window, 'HS', {
      configurable: true,
      get() { return _HS; },
      set(v) {
        if (_HS === v) return;                     // `HS = HS || {}` re-assigns the same object
        _HS = v;
        let _data;
        Object.defineProperty(_HS, 'data', {
          configurable: true,
          get() { return _data; },
          set(d) {
            _data = d;
            if (d && typeof d.properties === 'function') d.properties = async () => [h];
          },
        });
      },
    });
  }, home);
}

async function openPage(browser, { blockGL = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page._errs = [];
  page.on('pageerror', (e) => page._errs.push('pageerror: ' + String(e.message).slice(0, 240)));
  page.on('console', (m) => { if (m.type() === 'error') page._errs.push('console: ' + m.text().slice(0, 240)); });
  if (blockGL) await page.route(/maplibre-gl@.*\.js/i, (r) => r.abort());
  await injectHome(page, HOME);
  await page.goto(`${BASE}/maps.html?zip=${ZIP}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__HS_MAP && typeof window.__HS_REST_VERIFY === 'function',
    { timeout: 45000 });
  await page.waitForTimeout(1500);
  return page;
}

const hist = (arr) => arr.reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {});
const fmt = (h) => Object.keys(h).sort().map((k) => `${k}:${h[k]}`).join(' ') || '(none)';

const browser = await chromium.launch();
let page;
try {
  page = await openPage(browser);

  // ── the view under test is the one the founder reviews ──────────────────────────
  console.log('\n== the exact home view ==');
  const view = await page.evaluate(() => {
    const v = window.__HS_REST_VERIFY();
    return {
      hasHome: v.hasHome, homeAddress: v.homeAddress, radiusMi: v.radiusMi,
      lettered: window.__HS_MAP.items.filter((x) => x._letter).length,
      visibleTotal: window.__HS_MAP.visibleTotal,
      complete: window.__HS_MAP.complete,
    };
  });
  ok(view.hasHome && String(view.homeAddress || '').toUpperCase().includes('COOMES'),
    'the map is anchored on the home under test', JSON.stringify(view.homeAddress));
  ok(view.radiusMi === RADIUS_MI, `Map view is ${RADIUS_MI} mi`, 'got ' + view.radiusMi);
  ok(view.complete !== false, 'the record read completed (no silent prefix)');
  ok(view.lettered <= 16, 'the lettered head stays capped at 16', 'lettered=' + view.lettered);
  notes.push(`view: home=${view.homeAddress} radius=${view.radiusMi}mi lettered=${view.lettered} visible=${view.visibleTotal}`);

  // ── Focus (schematic SVG) ───────────────────────────────────────────────────────
  console.log('\n== Focus (schematic) ==');
  const focus = await page.evaluate(() => window.__HS_REST_VERIFY());
  ok(focus.restTotal > 16, 'the view plots well past the 16-letter head (>16 rest records)',
    'rest=' + focus.restTotal);
  ok(!!focus.focus && focus.focus.count === focus.restTotal,
    'Focus draws EVERY rest record', focus.focus ? `${focus.focus.count}/${focus.restTotal}` : 'no rest pins');
  const expShapes = focus.expected.map((e) => e.shape);
  if (focus.focus) {
    const bad = focus.focus.shapes.map((s, i) => (s === expShapes[i] ? null : `#${i} drew ${s}, resolver said ${expShapes[i]}`)).filter(Boolean);
    ok(bad.length === 0, 'every Focus rest pin draws its resolved shape', bad.slice(0, 5).join('; '));
  }

  // ── Street + Satellite (the MapLibre symbol layer) ──────────────────────────────
  const glReads = {};
  for (const mode of ['street', 'satellite']) {
    console.log(`\n== ${mode[0].toUpperCase() + mode.slice(1)} (MapLibre) ==`);
    await page.click(`[data-mode="${mode}"]`);
    await page.waitForFunction(() => { const v = window.__HS_REST_VERIFY(); return v.gl && v.gl.featureCount > 0; },
      { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const v = await page.evaluate(() => window.__HS_REST_VERIFY());
    glReads[mode] = v;
    if (!v.gl) { ok(false, `${mode}: the MapLibre rest layer is live`, 'no GL state (WebGL unavailable on this runner?)'); continue; }

    // The regression itself: a `circle` layer can only express colour.
    ok(v.gl.layerType === 'symbol', `${mode}: hs-rest-pt is a SYMBOL layer, not a circle layer`, v.gl.layerType);
    ok(/\["get","icon"\]/.test(v.gl.iconImage.replace(/\s/g, '')), `${mode}: it draws the per-record icon`, v.gl.iconImage);
    ok(v.gl.featureCount === v.restTotal, `${mode}: one GL feature per rest record`, `${v.gl.featureCount}/${v.restTotal}`);

    const byId = {}; v.expected.forEach((e) => { byId[e.id] = e; });
    const wrong = v.gl.features.filter((f) => byId[f.id] && byId[f.id].shape !== f.shape)
      .map((f) => `${f.id}: drew ${f.shape}, resolver said ${byId[f.id].shape}`);
    ok(wrong.length === 0, `${mode}: every rest feature carries its resolved shape`, wrong.slice(0, 5).join('; '));

    const unregistered = v.gl.features.filter((f) => !f.imageRegistered).map((f) => f.icon);
    ok(unregistered.length === 0, `${mode}: every icon image is registered in the GL style (locally generated, no external dependency)`,
      [...new Set(unregistered)].slice(0, 5).join(', '));

    const colourless = v.gl.features.filter((f) => !/^#[0-9a-f]{6}$/i.test(String(f.col)));
    ok(colourless.length === 0, `${mode}: status colour preserved per marker (shape=type, colour=lifecycle)`,
      colourless.length + ' without a status colour');

    console.log('  shape distribution: ' + fmt(hist(v.gl.features.map((f) => f.shape))));
  }

  // ── the three views must agree, record for record ───────────────────────────────
  console.log('\n== Street / Satellite / Focus parity ==');
  if (glReads.street && glReads.satellite && glReads.street.gl && glReads.satellite.gl) {
    const s = glReads.street.gl.features, t = glReads.satellite.gl.features;
    const diff = s.filter((f, i) => !t[i] || t[i].id !== f.id || t[i].shape !== f.shape).length;
    ok(diff === 0, 'Street and Satellite draw identical shapes', diff + ' differing records');
    const focusH = focus.focus ? fmt(hist(focus.focus.shapes)) : '(none)';
    const glH = fmt(hist(s.map((f) => f.shape)));
    ok(focusH === glH, 'Focus and the tile maps draw the same shape distribution', `focus[${focusH}] vs tiles[${glH}]`);
  }

  // ── regulated facility vs data center stay visually distinct ────────────────────
  console.log('\n== facility (square) vs data center (octagon) ==');
  const reg = await page.evaluate(() => ({
    facility: window.HS.CATEGORY_REGISTRY.facility.symbol,
    datacenter: window.HS.CATEGORY_REGISTRY.datacenter.symbol,
  }));
  ok(reg.facility === 'square' && reg.datacenter === 'octagon' && reg.facility !== reg.datacenter,
    'the registry keeps facilities and data centers on different symbols', JSON.stringify(reg));
  const drawn = glReads.street && glReads.street.gl ? glReads.street.gl.features : [];
  const sq = drawn.filter((f) => f.shape === 'square').length, oct = drawn.filter((f) => f.shape === 'octagon').length;
  // Reported, not asserted: whether this particular view happens to contain a data center
  // is a fact about live public records. The distinctness that CAN be asserted is above
  // (registry) and per-record (shape parity) — both hold whatever the view contains.
  console.log(`  drawn on this view: square(regulated facility)=${sq}  octagon(data center)=${oct}`);

  // ── the legend explains every shape actually drawn ──────────────────────────────
  console.log('\n== legend agreement ==');
  const legendCheck = await page.evaluate(() => {
    const rows = (window.HS.markerRegistry && window.HS.markerRegistry.shapeLegend) || [];
    const legend = new Set(rows.map((r) => r.shape));
    const facSym = window.HS.CATEGORY_REGISTRY.facility.symbol;
    const v = window.__HS_REST_VERIFY();
    const drawn = new Set((v.gl ? v.gl.features.map((f) => f.shape) : v.expected.map((e) => e.shape)));
    return { rows: rows.length, missing: [...drawn].filter((s) => s !== facSym && !legend.has(s)) };
  });
  ok(legendCheck.rows > 0 && legendCheck.missing.length === 0,
    'every shape drawn on this view has a legend row', legendCheck.missing.join(', '));

  // ── the founder's question: any circle NOT backed by an honest fallback? ────────
  console.log('\n== circle accounting (the anti-fabrication check) ==');
  const acct = glReads.street || focus;
  const total = acct.restTotal + view.lettered;
  const circles = acct.shapeCounts.circle || 0;
  const classified = acct.restTotal - circles;
  console.log(`  plotted (lettered + rest): ${total}`);
  console.log(`  rest records: ${acct.restTotal}`);
  console.log(`  classified to a real category: ${classified}`);
  console.log(`  circles: ${circles}  (honest fallbacks: ${acct.fallbackCounts.honest || 0}, unexplained: ${acct.fallbackCounts.UNEXPLAINED || 0})`);
  console.log(`  full shape distribution: ${fmt(acct.shapeCounts)}`);
  console.log(`  acceptance baseline (informational, 2026-07-26): plotted ~${BASELINE.plotted}, classified ${BASELINE.classified}, honest circles ${BASELINE.honestCircles}`);
  ok((acct.fallbackCounts.UNEXPLAINED || 0) === 0,
    'every circle is an honest FALLBACK:other with a stated reason — no record loses its shape',
    acct.unexplainedCircles.slice(0, 8).map((c) => `${c.name || c.id} (srcType="${c.srcType}", rule=${c.rule})`).join('; '));
  if (acct.unexplainedCircles.length) {
    console.log('\n  UNEXPLAINED CIRCLES (shape computed but not honest fallback):');
    acct.unexplainedCircles.forEach((c) => console.log(`    - ${c.name || c.id} | srcType="${c.srcType}" | rule=${c.rule}`));
  }

  // ── Leaflet raster fallback (no WebGL) ─────────────────────────────────────────
  console.log('\n== Leaflet fallback (WebGL blocked) ==');
  const lf = await openPage(browser, { blockGL: true });
  try {
    await lf.click('[data-mode="street"]').catch(() => {});
    await lf.waitForSelector('#maplf .leaflet-marker-icon .hspin.hsrest svg', { timeout: 30000 }).catch(() => {});
    await lf.waitForTimeout(2000);
    const lv = await lf.evaluate(() => window.__HS_REST_VERIFY());
    if (!lv.leaflet) {
      ok(false, 'the Leaflet fallback rendered rest markers', 'no .hspin.hsrest markers found');
    } else {
      ok(lv.leaflet.count === lv.restTotal, 'the Leaflet fallback draws EVERY rest record',
        `${lv.leaflet.count}/${lv.restTotal}`);
      const lfExp = lv.expected.map((e) => e.shape);
      const lfBad = lv.leaflet.shapes.map((s, i) => (s === lfExp[i] ? null : `#${i} drew ${s}, resolver said ${lfExp[i]}`)).filter(Boolean);
      ok(lfBad.length === 0, 'the Leaflet fallback uses the computed shape, not circleMarkers',
        lfBad.slice(0, 5).join('; '));
      console.log('  shape distribution: ' + fmt(hist(lv.leaflet.shapes)));
    }
    ok(lf._errs.length === 0, 'Leaflet-fallback console clean', lf._errs.slice(0, 3).join(' | '));
  } finally { await lf.close(); }

  // ── production console ─────────────────────────────────────────────────────────
  console.log('\n== console ==');
  ok(page._errs.length === 0, 'production console clean on the verified view',
    page._errs.slice(0, 5).join(' | '));
} finally {
  if (page) await page.close().catch(() => {});
  await browser.close();
}

console.log('\n' + notes.join('\n'));
if (fails.length) {
  console.error(`\nVERIFY FAILED (${fails.length}):\n - ` + fails.join('\n - '));
  process.exit(1);
}
console.log('\nverify-maps-rest-shapes passed — every plotted record renders its resolved shape on Street, Satellite, Focus and the Leaflet fallback, and every circle is an honest fallback.');
