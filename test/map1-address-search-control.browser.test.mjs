// MAP 1 — THE ADDRESS SEARCH IS ONE FIELD WITH AN ICON, driven in a real browser.
//
// The hero used to carry a full-width green "See development nearby" button beside the
// address field. It read as the page's primary action when the primary action is typing an
// address, and on a phone it wrapped below the field and squeezed it. It was replaced by a
// magnifying-glass submit button INSIDE the input.
//
// What this suite pins is the part that is easy to break and invisible when it breaks: the
// icon is not a new search path. It kept #go and type="submit", so the click still runs the
// form's own submit handler — the same one Enter and "See a sample" run. A future session
// restyling this control could easily turn it into a type="button" with its own click
// handler, and every screen would still LOOK right while the disabled-while-searching state
// and the Enter key quietly diverged from it.
//
// It also pins the half that only exists because the green button left: with `required` gone
// from the input (the browser's validity bubble preempts the submit event, so the page could
// never show its own message while it was there), an EMPTY submit must be caught in JS. A
// regression there does not throw — it fires a geocode for the empty string.
//
// Every network call is answered from fixtures; no production service is touched.
//
// Run: node test/map1-address-search-control.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
const GEO = { match: { matchedAddress: '2200 CALDWELL LN, DEL VALLE, TX, 78617',
  lat: 30.215054966235, lng: -97.53885104845, zip: '78617', city: 'DEL VALLE', state: 'TX' } };
const REPORT = { address: '2200 CALDWELL LN, DEL VALLE, TX 78617', home: { lat: 30.99, lng: -97.99 },
  counts: { facilities: 1 }, sites: [
    { scope: 'point', label: 'ACME PLATING CO', registry_id: '110000123456', layer: 'industrial',
      url: 'https://echo.epa.gov/detailed-facility-report?fid=110000123456',
      lat: 30.2160, lng: -97.5400, src: 'EPA FRS' }] };
const N5ROW = { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2021-0320D', feature_id: 'pt:1',
  provenance: 'proven_stored_point', distance_mi: 0.2, geometry_type: 'ST_Point',
  marker_lat: 30.21520, marker_lng: -97.53980, has_more: false };
const PROJECTS = [{ source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2021-0320D',
  name: 'Caldwell Lane', type: 'Industrial', status: 'Approved', registry_id: 'austin-site-plan-cases',
  source_ref: 'https://abc.austintexas.gov/web/permit/public-search-other?t_selected_folderrsn=12774743',
  submitted_at: '2021-09-07', date_kind: 'filed', impact_score: 55, impact_dimensions: null }];
const ZIP_ROW = [{ zip: '78617', home_lat: 30.1745, home_lng: -97.6134, counts: { facilities: 1 },
  refreshed_at: '2026-09-01T00:00:00Z', paywall: false, facilities_unavailable: false, sites: [
    { scope: 'point', label: 'ZIP-ONLY FACILITY', registry_id: '110000555555',
      url: 'https://echo.epa.gov/x', lat: 30.1750, lng: -97.6140 }] }];
const ZIP_AUTH = { zip: '78617', mode: 'authoritative', status: 'boundary_complete',
  projects: [{ project_ref: 'p1', name: 'Del Valle logistics center', type: 'Industrial',
    status: 'Proposed', registry_id: 'austin-site-plan-cases', source_ref: 'https://example.gov/rec/p1',
    submitted_at: '2026-01-15', date_kind: 'filed', type_raw: 'Commercial - New Construction' }],
  markers: [{ project_ref: 'p1', lat: 30.1620, lng: -97.6600, marker_rule: 'POINT', marker_seq: 0 }] };

const browser = await chromium.launch();
const pageErrors = [];
// Every geocode call is COUNTED, because "did not run an empty search" is a claim about a
// request that must not exist — and an absent request is indistinguishable from a broken
// test unless the same counter also proves the real searches DID fire.
let geocodeCalls = [];
const routeHandler = async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  const J = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.includes('/functions/v1/geocode-address')) {
    try { geocodeCalls.push(JSON.parse(route.request().postData() || '{}').address); } catch { geocodeCalls.push(null); }
    return J(GEO);
  }
  if (url.includes('/rpc/n5_projects_within_radius')) return J([N5ROW]);
  if (url.includes('/rpc/app_zip_projects_markers')) return J(ZIP_AUTH);
  if (url.includes('/functions/v1/get-address-report')) return J(REPORT);
  if (url.includes('/rest/v1/app_projects')) return J(PROJECTS);
  if (url.includes('/rest/v1/development_reports')) return J(ZIP_ROW);
  if (url.includes('/rest/v1/')) return J([]);
  if (url.includes('leaflet@1.9.4/dist/leaflet.js') || url.includes('leaflet@1.9.4/dist/leaflet.css')) {
    const css = url.endsWith('.css');
    let local = null;
    try { local = require.resolve('leaflet/dist/leaflet' + (css ? '.css' : '.js')); } catch (e) { local = null; }
    if (!local) return route.continue();
    return route.fulfill({ status: 200, contentType: css ? 'text/css' : 'text/javascript',
      body: await readFile(local, 'utf8') });
  }
  if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200,
    contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript',
    body: url.endsWith('.css') ? '' : 'window.supabase=window.supabase||{createClient:function(){var q={select:function(){return q;},eq:function(){return q;},in:function(){return q;},order:function(){return q;},limit:function(){return q;},then:function(r){return Promise.resolve({data:[],error:null}).then(r);}};return{from:function(){return q;},rpc:function(){return Promise.resolve({data:[],error:null});},auth:{getSession:function(){return Promise.resolve({data:{session:null}});},onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};}}};}};' });
  if (url.includes('tile.openstreetmap')) return route.fulfill({ status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  return J({});
};

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
await page.route('**/*', r => routeHandler(r));

const waitZip = () => page.waitForFunction(
  () => Array.isArray(window.__HS_SITES) && !(window.__HS_SITES || []).some(s => s.n5_feature_id)
        && document.getElementById('results')
        && getComputedStyle(document.getElementById('results')).display !== 'none',
  null, { timeout: 30000 });
const waitAddr = () => page.waitForFunction(
  () => (window.__HS_SITES || []).some(s => s.n5_feature_id), null, { timeout: 30000 });

await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitZip(); await page.waitForTimeout(400);

// ══════════════ 1. THE CONTROL ITSELF ════════════════════════════════════════════════════════
const ctl = await page.evaluate(() => {
  const form = document.getElementById('form');
  const input = document.getElementById('addr');
  const go = document.getElementById('go');
  const r = go ? go.getBoundingClientRect() : null;
  const ir = input ? input.getBoundingClientRect() : null;
  return {
    // A button whose only content is an icon must still announce itself to a screen reader,
    // and the old button's visible label was that announcement until now.
    label: go ? (go.getAttribute('aria-label') || '') : null,
    text: go ? go.textContent.trim() : null,
    hasSvg: !!(go && go.querySelector('svg')),
    type: go ? go.getAttribute('type') : null,
    inForm: !!(go && form && form.contains(go)),
    w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0,
    // "Inside the field, at the far right" is a geometric claim, so it is measured rather
    // than inferred from the CSS having been written.
    insideField: !!(r && ir && r.left >= ir.left && r.right <= ir.right + 1
                    && r.top >= ir.top - 1 && r.bottom <= ir.bottom + 1),
    rightAligned: !!(r && ir && (ir.right - r.right) < 12),
    // The field must not have grown to hold a 44px control.
    fieldH: ir ? Math.round(ir.height) : 0,
    placeholder: input ? input.getAttribute('placeholder') : null,
    required: !!(input && input.hasAttribute('required')),
    hint: (document.querySelector('.hint') || {}).textContent || null,
    greenButtonGone: !/See development nearby/i.test(document.body.textContent || '')
  };
});
ok(ctl.greenButtonGone, '1a the "See development nearby" button is gone from the page');
ok(ctl.hasSvg && ctl.text === '', '1b the submit control is an icon, not a text button', ctl.text);
ok(/search/i.test(ctl.label || ''), '1c ...with an accessible name a screen reader can announce', ctl.label);
ok(ctl.type === 'submit' && ctl.inForm, '1d ...and it is still the FORM\'s submit button', ctl);
ok(ctl.w >= 44 && ctl.h >= 44, '1e the tap target is at least 44x44', { w: ctl.w, h: ctl.h });
ok(ctl.insideField && ctl.rightAligned, '1f ...sitting inside the input at its far right', ctl);
ok(ctl.fieldH <= 52, '1g ...without making the field look oversized', ctl.fieldH);
ok(ctl.placeholder === 'Enter a street address, e.g., 13313 Coomes Dr', '1h the placeholder is the example address', ctl.placeholder);
ok(/press Enter, or click search/i.test(ctl.hint || ''), '1i the helper text names all three ways to search', ctl.hint);
ok(!ctl.required, '1j `required` is gone, so the page can show its own message instead of the browser bubble');

// ══════════════ 2. AN EMPTY SUBMIT NEVER SEARCHES ════════════════════════════════════════════
geocodeCalls = [];
await page.click('#go');
await page.waitForTimeout(400);
const empty = await page.evaluate(() => {
  const e = document.getElementById('addrErr');
  return { shown: !!(e && !e.hidden), msg: e ? e.textContent.trim() : null,
           invalid: document.getElementById('addr').getAttribute('aria-invalid') };
});
ok(geocodeCalls.length === 0, '2a clicking the icon with an empty box runs NO search', geocodeCalls);
ok(empty.shown, '2b ...and shows the inline validation message');
ok(/valid address/i.test(empty.msg || ''), '2c ...naming what to do', empty.msg);
ok(empty.invalid === 'true', '2d ...and marks the field invalid for assistive tech');

// Typing is the resident fixing exactly what the message complained about.
await page.fill('#addr', '2');
await page.waitForTimeout(200);
ok(await page.evaluate(() => !!document.getElementById('addrErr').hidden),
   '2e the message clears as soon as the resident types');

// ══════════════ 3. THE ICON RUNS THE SAME SEARCH THE GREEN BUTTON RAN ════════════════════════
geocodeCalls = [];
await page.fill('#addr', '2200 Caldwell Ln, Del Valle, TX 78617');
await page.click('#go');
await waitAddr(); await page.waitForTimeout(400);
ok(geocodeCalls.length === 1 && /Caldwell/i.test(geocodeCalls[0] || ''),
   '3a the icon click geocodes the typed address', geocodeCalls);
ok(await page.evaluate(() => (window.__HS_SITES || []).some(s => s.n5_feature_id)),
   '3b ...and near-home results render');
ok(await page.evaluate(() => !document.getElementById('go').disabled),
   '3c ...and the button is re-enabled when the search finishes');

// ══════════════ 4. ENTER RUNS IT TOO ═════════════════════════════════════════════════════════
await page.goto(base + '/homesignalmap.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitZip(); await page.waitForTimeout(400);
geocodeCalls = [];
await page.fill('#addr', '2200 Caldwell Ln, Del Valle, TX 78617');
await page.focus('#addr');
await page.keyboard.press('Enter');
await waitAddr(); await page.waitForTimeout(400);
ok(geocodeCalls.length === 1 && /Caldwell/i.test(geocodeCalls[0] || ''),
   '4a pressing Enter in the field runs the same search', geocodeCalls);

// ══════════════ 5. THE WAY BACK TO THE WHOLE-ZIP VIEW ════════════════════════════════════════
const link = await page.evaluate(() => {
  const a = document.getElementById('zipAllLink');
  return { hidden: !a || a.hidden, text: a ? a.textContent.trim() : null,
           href: a ? a.getAttribute('href') : null };
});
ok(!link.hidden, '5a the ZIP browse link is offered in address mode');
ok(/Browse all development in ZIP 78617/.test(link.text || ''), '5b ...naming the real ZIP', link.text);
ok(/[?&]zip=78617\b/.test(link.href || ''), '5c ...and pointing at the existing ZIP-wide view', link.href);

// A ZIP is never guessed: with no ZIP anywhere the link stays hidden rather than printing a
// placeholder. This is the anti-fabrication rule applied to a link instead of a record.
const p2 = await ctx.newPage();
p2.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
await p2.route('**/*', r => routeHandler(r));
await p2.goto(base + '/homesignalmap.html', { waitUntil: 'domcontentloaded' });
await p2.waitForTimeout(700);
ok(await p2.evaluate(() => { const a = document.getElementById('zipAllLink'); return !a || a.hidden; }),
   '5d with no ZIP context at all the link is hidden, never a placeholder ZIP');

// ══════════════ 7. THE PRODUCTION addressCta GUARD STILL HAS A SOURCE ════════════════════════
// verify-map1-zip-states asserts, against LIVE production, that a PENDING ZIP still directs the
// resident to address mode. It tests document.body.innerText — which does NOT see a placeholder
// attribute — with the predicate copied verbatim below. That check runs post-deploy and cannot
// run from the sandbox, so removing the ZIP-mode hint override (#1088 recorded the hint as the
// pending state's last rendered source) risked reddening it on production with nothing local to
// catch it.
//
// Measured here instead, and measured on the RIGHT ELEMENT. Asserting over body.innerText looked
// right and was not: this fixture's page also renders the loadZip() catch banner "Couldn't load
// ZIP 08005. Enter your address for the live view.", which satisfies the pattern all by itself —
// so a body-wide assertion PASSED even with the note's sentence deleted, i.e. it was measuring
// fixture noise rather than the guarantee. The note element is the source that actually ships,
// so that is what is read.
const ADDRESS_CTA = /\b(enter|type|search)\b[^.\n]{0,24}\baddress\b/i;
const p3 = await ctx.newPage();
p3.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
await p3.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  const J = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  // status 'unknown' is the PENDING outcome — nobody has measured this ZIP yet.
  if (url.includes('/rpc/app_zip_projects_markers')) return J({ zip: '08005', mode: 'authoritative', status: 'unknown', projects: [], markers: [] });
  if (url.includes('/rest/v1/development_reports')) return J([{ zip: '08005', home_lat: 39.76, home_lng: -74.31,
    counts: { facilities: 0 }, refreshed_at: '2026-09-01T00:00:00Z', paywall: false, facilities_unavailable: false, sites: [] }]);
  return routeHandler(route);
});
await p3.goto(base + '/homesignalmap.html?zip=08005', { waitUntil: 'domcontentloaded' });
await p3.waitForTimeout(2500);
const pending = await p3.evaluate(() => ({
  fresh: (document.getElementById('freshLine') || {}).textContent || '',
  hint: (document.querySelector('.hint') || {}).textContent || ''
}));
ok(/not measured yet/i.test(pending.fresh), '7a the fixture really is the PENDING state (control)',
   pending.fresh.slice(0, 140));
ok(ADDRESS_CTA.test(pending.fresh),
   '7b the pending note itself directs the resident to address mode, with no help from the hint',
   (ADDRESS_CTA.exec(pending.fresh) || [])[0] || pending.fresh.slice(0, 200));
// The two controls that make 7b mean something. Without them it could be passing on the new
// copy, or on a banner that only this fixture renders.
ok(!ADDRESS_CTA.test(pending.hint),
   '7c ...and the new helper text does NOT satisfy the guard, so 7b is the note carrying it',
   pending.hint);
ok(!/Couldn't load ZIP/i.test(pending.fresh),
   '7d ...and the note is not the loadZip error banner, which also matches the pattern', pending.fresh);

// ══════════════ 6. NO FATAL CLIENT ERROR ═════════════════════════════════════════════════════
ok(pageErrors.length === 0, '6 the whole journey ran with no fatal client error', pageErrors);

await browser.close(); server.close();
console.log('='.repeat(72));
console.log(fails ? (fails + ' FAILED') : 'ALL PASS');
process.exit(fails ? 1 : 0);
