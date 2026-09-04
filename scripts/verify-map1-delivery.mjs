// verify-map1-delivery.mjs — does the ACTUAL public Map 1 ZIP page serve AUTHORITATIVE
// development geography?
//
// WHY A SECOND VERIFIER. verify-development.mjs proves the anti-fabrication invariant and the
// facility count against the cached report — and it passed all the way through the delivery gap,
// because it never asked WHERE development came from. On 2026-09-04 production_geography_verified
// read 10,821 while every one of those pages rendered the legacy 3-mile centroid-radius cache.
// A gate that cannot tell those two apart is not a gate, so this one compares the RENDERED page
// against the authoritative contract itself.
//
// It drives a real browser against SITE_BASE (default https://homesignal.net; set it to a local
// server to prove a branch before it ships) and reads window.__HS_VERIFY / window.__HS_SITES,
// which the page publishes for exactly this purpose.
//
// Env: SITE_BASE, ZIP_PATH (default "/homesignalmap.html?zip={zip}"), ZIPS (comma list).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const html = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const grabVar = (name) => {
  const m = html.match(new RegExp(`var ${name}\\s*=\\s*["']([^"']+)["']`));
  if (!m) throw new Error(`Could not read ${name} from homesignalmap.html`);
  return m[1];
};
const ENDPOINT = grabVar('ENDPOINT');
const APIKEY = grabVar('APIKEY');
const SUPABASE_URL = ENDPOINT.replace(/\/functions\/v1\/.*$/, '');
const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const ZIP_PATH = process.env.ZIP_PATH || '/homesignalmap.html?zip={zip}';
const hdr = { apikey: APIKEY, Authorization: 'Bearer ' + APIKEY };
const zipUrl = (zip) => SITE_BASE + ZIP_PATH.replace('{zip}', encodeURIComponent(zip));

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!c) fails++;
};

async function jget(url) {
  const r = await fetch(url, { headers: hdr });
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return r.json();
}

// The BACKEND truth for one ZIP, read the same way the page reads it.
async function backend(zip) {
  const q = encodeURIComponent(zip);
  const [state, recs, rep] = await Promise.all([
    jget(`${SUPABASE_URL}/rest/v1/app_zip_geography_state?zip=eq.${q}&select=geography_state&limit=1`),
    fetch(`${SUPABASE_URL}/rest/v1/rpc/app_projects_for_zip`, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, hdr),
      body: JSON.stringify({ p_zip: zip, p_kind: 'development' }),
    }).then((r) => (r.ok ? r.json() : null)),
    jget(`${SUPABASE_URL}/rest/v1/development_reports?zip=eq.${q}&select=counts,sites&limit=1`),
  ]);
  const geographyState = (state && state[0] && state[0].geography_state) || 'pending';
  const list = Array.isArray(recs) ? recs : [];
  // What the page WILL render: an authoritative project is withheld only when it has no official
  // record link, and those are counted rather than hidden.
  const linkable = list.filter((r) => r && r.source_ref);
  const markers = linkable.reduce(
    (n, r) => n + (Array.isArray(r._markers) ? r._markers.filter((m) => typeof m.lat === 'number').length : 0), 0);
  const cached = (rep && rep[0]) || null;
  const cachedSites = (cached && cached.sites) || [];
  const sourced = (s) => !!(s && ((s.url && String(s.url).trim()) || (s.record_url && String(s.record_url).trim())));
  return {
    geographyState,
    authProjects: list.length,
    servedProjects: linkable.length,
    unlinkable: list.length - linkable.length,
    servedMarkers: markers,
    cachedDevelopment: cachedSites.filter((s) => sourced(s) && s.relevance === 'development').length,
    cachedFacilities: cachedSites.filter((s) => sourced(s) && s.scope === 'point' && s.relevance !== 'development').length,
  };
}

// WAIT ON THE PAGE'S OWN SIGNAL, NOT ON 'load'. This page pulls OSM/Esri map tiles, so the load
// event can be minutes away or never arrive on a runner - the first run of this gate spent its
// whole 30-minute budget in page.goto and returned no verdict at all, which is worse than a
// failure. domcontentloaded plus __HS_VERIFY (which the page publishes only after it has finished
// rendering) waits for exactly the thing being measured.
async function pageState(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => window.__HS_VERIFY && Array.isArray(window.__HS_SITES), null, { timeout: 45000 });
  return page.evaluate(() => ({
    v: window.__HS_VERIFY,
    sites: window.__HS_SITES.length,
    dev: window.__HS_SITES.filter((s) => s && s.relevance === 'development').length,
    fac: window.__HS_SITES.filter((s) => s && s.scope === 'point' && s.relevance !== 'development').length,
    unsourced: window.__HS_SITES.filter((s) => !(s && ((s.url && String(s.url).trim()) || (s.record_url && String(s.record_url).trim())))).length,
    covNote: (window.__HS_VERIFY && window.__HS_VERIFY.covNote) || '',
  }));
}

const ZIPS = (process.env.ZIPS || '10804,76104,76135,20742,01004').split(',').map((z) => z.trim()).filter(Boolean);

const browser = await chromium.launch();
const page = await browser.newPage();
// A page error is the most likely cause of a missing __HS_VERIFY, and without this the failure
// would read as an unexplained timeout.
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
console.log(`Map 1 delivery gate — ${ZIPS.length} ZIP(s) against ${SITE_BASE}\n`);

for (const zip of ZIPS) {
  const b = await backend(zip);
  let p;
  try { p = await pageState(page, zipUrl(zip)); }
  catch (e) { ok(false, `${zip}: page loaded`, String(e.message || e) + (pageErrors.length ? ' | ' + pageErrors.slice(-3).join(' ; ') : '')); pageErrors.length = 0; continue; }
  console.log(`\n── ${zip} (${b.geographyState}) ──`);
  ok(p.v.geographyState === b.geographyState,
     `${zip}: the page resolved the same geography state as the backend`,
     `page ${p.v.geographyState} · backend ${b.geographyState}`);
  ok(p.unsourced === 0, `${zip}: every rendered site carries a record link (anti-fabrication)`);

  if (b.geographyState === 'authoritative') {
    ok(p.dev === b.servedProjects,
       `${zip}: development CARDS === authoritative projects`,
       `page ${p.dev} · authoritative ${b.authProjects} minus ${b.unlinkable} unlinkable = ${b.servedProjects}`);
    ok(p.v.devMarkers === b.servedMarkers,
       `${zip}: development MARKERS === authoritative marker relation`,
       `page ${p.v.devMarkers} · relation ${b.servedMarkers}`);
    ok(p.v.legacyDevelopment === false,
       `${zip}: NO legacy radius development record was rendered`);
    ok(b.servedProjects === 0 || p.v.authoritativeDev === true,
       `${zip}: every rendered development record is stamped authoritative`);
    if (b.servedMarkers > b.servedProjects) {
      ok(p.v.devMarkers > p.dev,
         `${zip}: a multi-marker project keeps ONE card and draws several markers`,
         `${p.dev} cards · ${p.v.devMarkers} markers`);
    }
    if (b.servedProjects === 0) {
      ok(p.dev === 0 && p.v.legacyDevelopment === false,
         `${zip}: authoritative MEASURED-ZERO serves zero and does not fall back`,
         `cache would have offered ${b.cachedDevelopment}`);
    }
  } else if (b.geographyState === 'not_measured') {
    ok(p.dev === 0, `${zip}: not_measured serves no development`,
       `cache would have offered ${b.cachedDevelopment}`);
    ok(/cannot measure/i.test(p.covNote),
       `${zip}: the page says it cannot measure the ZIP rather than claiming zero`,
       p.covNote.slice(0, 90));
  } else {
    ok(p.v.geographyState === 'pending', `${zip}: pending keeps its current behaviour, unlabelled as authoritative`);
  }

  // FACILITIES ARE OUT OF SCOPE AND MUST NOT MOVE — checked on every state, against a control
  // that has to be non-zero somewhere or the check attests to nothing.
  ok(p.fac === b.cachedFacilities, `${zip}: facilities unchanged from the cached report`,
     `page ${p.fac} · cache ${b.cachedFacilities}`);
}

// ADDRESS MODE stays a separate contract, and this proves it at the REQUEST, which is where the
// two modes would actually get conflated: a street address the resident typed, a radius the
// resident chose, and NO ZIP in the payload. Asserting the request rather than the render also
// makes the gate independent of how long the live edge function takes to answer.
//
// ⚠️ `?addr=` is NOT address mode - boot() routes it to loadProperty(), the property page. Driving
// the real form is the only way to exercise the address contract, and the first two runs failed
// here purely because the verifier used the URL parameter. The page was never at fault.
{
  const addr = process.env.ADDR || '20 North Main Street, Brigham City, UT 84302';
  const RADIUS = 2;                       // explicitly CHOSEN, so "user-selected" is what is tested
  console.log('\n── address mode ──');
  try {
    let sent = null;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/functions/v1/get-address-report')) {
        try { sent = JSON.parse(r.postData() || '{}'); } catch (_e) { sent = { unparseable: true }; }
      }
    });
    await page.goto(`${SITE_BASE}/homesignalmap.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('#addr', { timeout: 30000 });
    await page.click(`#radSel button[data-r="${RADIUS}"]`);
    await page.fill('#addr', addr);
    await page.click('#go');
    // The request is dispatched by the submit handler; give it a moment to leave.
    for (let i = 0; i < 60 && !sent; i++) await page.waitForTimeout(250);

    ok(!!sent, 'address mode issued a live address request');
    ok(!!(sent && typeof sent.address === 'string' && sent.address.trim() === addr),
       'the request carries the street address the resident typed', sent && sent.address);
    ok(!!(sent && sent.radius_mi === RADIUS),
       'the request carries the radius the resident selected', sent && String(sent.radius_mi));
    ok(!!(sent && sent.zip === undefined),
       'the request carries NO zip — ZIP membership is never the basis for an address search');
    const st = await page.evaluate(() => ({
      zipMode: document.body.classList.contains('zipmode'),
      within: (document.getElementById('withinLbl') || {}).textContent || '',
    }));
    ok(st.zipMode === false, 'the page left ZIP mode for an address search');
  } catch (e) { ok(false, 'address mode exercised', String(e.message || e)); }
}

await browser.close();
console.log(`\n${fails === 0 ? 'ALL DELIVERY GATES PASSED' : fails + ' FAILURE(S)'}`);
process.exit(fails ? 1 : 0);
