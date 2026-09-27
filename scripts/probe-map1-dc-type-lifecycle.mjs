// probe-map1-dc-type-lifecycle.mjs — does every data-centre row Map 1 receives draw as a
// Data center, in the lifecycle its source states, with its name?
//
// WHY. HS.map1DcSite (lib/data.js) once filled `type`/`status`/`name` while Map 1 classifies from
// `use_type`/`bucket`/`label` (lib/map.js trackerSiteItem). Measured 2026-09-27 on production:
// all 1,816 rows on 757 ZIP pages drew as "Other project · lifecycle unknown" with a blank name,
// and every offline check passed because none of them took the page's path. This probe reads the
// REAL page against REAL data and compares it with the backend's own answer.
//
// TWO INDEPENDENT READS PER ZIP:
//   backend — public.map1_dc_zip_members, fetched here with the page's public anon key; the
//             expected lifecycle of each row is its map_status through the ONE lifecycle
//             vocabulary (lib/project-type.js), computed in node from the shipped file.
//   page    — homesignalmap.html?zip=Z in a real browser; every data-centre site the page
//             accepted (window.__HS_SITES) is resolved by the page's own resolver
//             (window.__HS_RESOLVE_TRACKER, the function its pins, filters and lists use).
//
// Env: SITE_BASE (default https://homesignal.net), ZIPS (default: the deterministic sample in
// test/fixtures/map1-dc-zip-sample-2026-09-27.json — the first ZIP in collate "C" order for each
// (map_status, source basis) group, plus the first carrying all three lifecycles).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const html = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
globalThis.window = globalThis.window || globalThis;
(0, eval)(readFileSync(new URL('../lib/project-type.js', import.meta.url), 'utf8'));
const HS = globalThis.window.HS;
const grab = (n) => {
  const m = html.match(new RegExp(`var ${n}\\s*=\\s*["']([^"']+)["']`));
  if (!m) throw new Error('could not read ' + n);
  return m[1];
};
const ENDPOINT = grab('ENDPOINT');
const APIKEY = grab('APIKEY');
const SUPABASE_URL = ENDPOINT.replace(/\/functions\/v1\/.*$/, '');
const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const DEFAULT_ZIPS = '01040,01852,07033,20187,23150';
const ZIPS = (process.env.ZIPS || DEFAULT_ZIPS).split(',').map((z) => z.trim()).filter(Boolean);
const hdr = { apikey: APIKEY, Authorization: 'Bearer ' + APIKEY, 'Content-Type': 'application/json' };

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!c) fails++;
};

async function backend(zip) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/map1_dc_zip_members`,
    { method: 'POST', headers: hdr, body: JSON.stringify({ p_zip: zip }) });
  if (!r.ok) throw new Error('map1_dc_zip_members ' + zip + ' -> HTTP ' + r.status);
  const rows = await r.json();
  if (!Array.isArray(rows)) throw new Error('map1_dc_zip_members ' + zip + ' -> not an array');
  return rows.filter((x) => x && x.zip_membership === 'member');
}

console.log('SITE_BASE=' + SITE_BASE + '  ZIPS=' + ZIPS.join(','));
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let totalRows = 0, totalGood = 0;
const byLife = {}, basisSeen = {};
for (const zip of ZIPS) {
  let rows;
  try { rows = await backend(zip); } catch (e) { ok(false, zip + ' backend read', String(e.message)); continue; }
  const want = new Map(rows.map((x) => [x.source_key, HS.canonicalLifecycle({ status: x.map_status }).key]));
  // CONTROL: the backend must return rows for a sample ZIP, or every check below is vacuous.
  // A zero here is a fact about production, not about the page: e.g. the canonical layer is empty
  // between a Compute Atlas acquisition and the next identity (:25) / geography (:35) run
  // (CLAUDE.md §7.13). Nothing was verified for such a ZIP, so it fails rather than passes.
  ok(rows.length > 0, zip + ' backend returns data-centre rows (control)',
    rows.length + (rows.length ? '' : ' — nothing to verify here; if the canonical layer is between'
      + ' acquisition and resolution, re-run after the next :35 geography run'));
  rows.forEach((x) => { basisSeen[x.publication_basis] = (basisSeen[x.publication_basis] || 0) + 1; });

  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(SITE_BASE + '/homesignalmap.html?zip=' + zip, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES) && window.__HS_NATIONAL_PLANE !== undefined,
    null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const got = await page.evaluate(() => {
    const plane = window.__HS_NATIONAL_PLANE || null;
    const sites = (window.__HS_SITES || []).filter((s) => s && (s.publication_basis === 'canonical'
      || s.publication_basis === 'legacy_osm_compat'));
    return { plane, sites: sites.map((s) => {
      const mk = window.__HS_RESOLVE_TRACKER ? window.__HS_RESOLVE_TRACKER(s) : {};
      return { key: s.source_key, label: s.label || '', type: mk.typeKey, life: mk.lifecycle, shape: mk.shape };
    }) };
  });
  await page.context().close();

  ok(errors.length === 0, zip + ' no page errors', errors[0]);
  ok(got.plane && got.plane.status === 'ok' && got.plane.admitted === true,
    zip + ' the data-centre plane was read and admitted', got.plane ? got.plane.status + '/' + got.plane.admitted : 'no signal');
  ok(got.sites.length === rows.length, zip + ' the page accepted every backend row',
    got.sites.length + ' of ' + rows.length);
  const bad = got.sites.filter((s) => s.type !== 'datacenter' || s.life !== want.get(s.key) || !s.label);
  ok(bad.length === 0, zip + ' every data-centre pin: Data center, lifecycle = map_status, named',
    bad.slice(0, 3).map((s) => s.key + '=' + s.type + '/' + s.life + (s.label ? '' : '/unnamed')).join(' '));
  got.sites.forEach((s) => { byLife[s.life] = (byLife[s.life] || 0) + 1; });
  totalRows += rows.length;
  totalGood += got.sites.length - bad.length;
}
await browser.close();
console.log('\nSUMMARY  rows=' + totalRows + '  correct=' + totalGood + '  by lifecycle=' + JSON.stringify(byLife)
  + '  by source basis=' + JSON.stringify(basisSeen));
// The default sample was chosen to carry BOTH populations (canonical entities and the OSM
// compatibility layer). A pass over only one of them is not a pass over the contract.
if (ZIPS.join(',') === DEFAULT_ZIPS) {
  ok(basisSeen.canonical > 0 && basisSeen.legacy_osm_compat > 0,
    'the sample verified both source populations (canonical and legacy_osm_compat)', JSON.stringify(basisSeen));
}
ok(totalRows > 0 && totalGood === totalRows, 'every data-centre row across the sample draws correctly',
  totalGood + ' of ' + totalRows);
process.exit(fails ? 1 : 0);
