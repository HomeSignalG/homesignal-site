// Browser proof (U01): the Development Activity page shows a client the report and nothing
// of HomeSignal's own bookkeeping, and the internal views are still there for HomeSignal.
//
// A grep of the page source proves a string was written, not that a visitor sees it. This
// drives the real page in Chromium with NYC Open Data stubbed, and reads what renders.
//
// Run: node test/fsr-audience.browser.test.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP fsr-audience.browser.test.mjs — playwright not installed');
  process.exit(0);
}

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
const PAGE = base + '/future-surroundings-report.html';

// Dates are relative to the run, so a fixture can never age out of the 365-day window.
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);
const us = (d) => iso(d).slice(5, 7) + '/' + iso(d).slice(8, 10) + '/' + iso(d).slice(0, 4);

const centre = {
  the_geom: { type: 'Point', coordinates: [-74.003758107366, 40.712980288068] },
  addresspointid: '1001387', house_number: '1', street_name: 'CENTRE',
  full_street_name: 'CENTRE ST', zipcode: '10007', boroughcode: '1'
};
const issuanceNear = {
  permit_type: 'NB', permit_status: 'ISSUED', issuance_date: us(daysAgo(30)),
  house__: '2', street_name: 'CENTRE', gis_latitude: '40.7132', gis_longitude: '-74.0039',
  job__: 'JOB1', zip_code: '10007'
};
const filingNear = {
  job_type: 'New Building', filing_status: 'Plan Examiner Review',
  filing_date: iso(daysAgo(20)) + 'T00:00:00.000', house_no: '4', street_name: 'CENTRE',
  latitude: '40.7133', longitude: '-74.0040', job_filing_number: 'M0001-I1', postcode: '10007', zip: '11050'
};

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

async function open(url, { addressPoints = [centre] } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  await page.route('**/*', async (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (u.startsWith('https://data.cityofnewyork.us/')) {
      const json = (body) => route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const m = u.match(/\/(?:api\/views|resource)\/([a-z0-9]{4}-[a-z0-9]{4})\.json/);
      if (!m) return route.abort();
      if (u.includes('/api/views/')) return json({ id: m[1], name: m[1], viewLastModified: 1, rowsUpdatedAt: 2 });
      if (m[1] === 'uf93-f8nk') return json(addressPoints);
      if (m[1] === 'ipu4-2q9a') return json([issuanceNear]);
      if (m[1] === 'w9ak-ipjd') return json([filingNear]);
      return json([]);
    }
    return route.abort();
  });
  await page.goto(url);
  return { context, page, errors };
}

const text = (page, sel) => page.locator(sel).evaluate((el) => el.textContent);
const BOOKKEEPING = /Signed paid pilots|Verdict|NOT YET/;
const STACKS = /get-address-report|Census|OpenAddresses|Geoclient|ArcGIS|OpenStreetMap|Atlas/;

// 1. The default page is the customer's page ---------------------------------------------
{
  const { context, page, errors } = await open(PAGE);
  ok((await page.title()) === 'HomeSignal Development Activity', '1a the tab title is the product name');
  const body = await page.evaluate(() => document.body.innerText);
  ok(!BOOKKEEPING.test(body), '1b the visible page carries no pilot or verdict copy', body.match(BOOKKEEPING));
  ok(!/Surroundings/i.test(body), '1c nothing on the page says "surroundings" (the legacy name, and a completeness claim)');
  ok(/HOMESIGNAL DEVELOPMENT ACTIVITY/.test(body) && /NEW YORK CITY/.test(body),
    '1d the eyebrow names the product and the one market it covers');
  ok(body.includes("Planned, approved, permitted and changing development found in HomeSignal's covered official sources."),
    '1e the plan’s scope statement is visible');
  ok(body.includes('It is not an inventory of existing schools, parks, businesses, buildings, or neighborhood amenities.'),
    '1f the "not an inventory" statement is visible');
  ok(!(await page.locator('.fsr-nav').isVisible()), '1g the internal nav is not visible');
  ok(!(await page.locator('#fsrInternalBanner').isVisible()), '1h the internal banner is not visible');
  ok((await page.locator('.fsr-nav button:visible').count()) === 0, '1i no internal view button is reachable');
  ok(errors.length === 0, '1j no script errors on load', errors);
  await context.close();
}

// 2. A customer cannot reach an internal view by URL -------------------------------------
for (const view of ['coverage', 'listing', 'portfolio', 'usage']) {
  const { context, page } = await open(PAGE + '?view=' + view);
  ok(await page.locator('#fsrReportView').isVisible(), '2a ?view=' + view + ' still lands on the report');
  ok(!(await page.locator('#fsr' + view[0].toUpperCase() + view.slice(1) + 'View').isVisible()),
    '2b ?view=' + view + ' does not open the internal view');
  const body = await page.evaluate(() => document.body.innerText);
  ok(!BOOKKEEPING.test(body), '2c ?view=' + view + ' shows no pilot or verdict copy');
  await context.close();
}

// 3. A built report, seen by a customer --------------------------------------------------
{
  const { context, page, errors } = await open(PAGE);
  await page.fill('#fsrAddress', '1 Centre Street');
  await page.fill('#fsrZip', '10007');
  await page.click('#fsrGo');
  await page.waitForSelector('#fsrOut table', { timeout: 15000 });
  const out = await text(page, '#fsrOut');
  const rows = await page.locator('#fsrOut tbody tr').count();
  ok(rows === 2, '3a the report lists the two stubbed records (a permit and a filing)', rows);
  ok(out.includes('HomeSignal summarizes selected official public records available to its covered sources.'),
    '3b the standard client disclosure is in the rendered report');
  ok(/Attribution/.test(out) && /New York City Department of Buildings/.test(out),
    '3c the attribution the City’s law requires is still shown');
  ok(!STACKS.test(out), '3d no engineering or rights-gate stack names anywhere in the report', out.match(STACKS));
  ok(!BOOKKEEPING.test(out), '3e no pilot or verdict copy in the report');
  ok((await page.locator('#fsrOut .excl').count()) === 0, '3f the exclusions list is not rendered for a customer');
  ok((await page.locator('#fsrPortfolioAdd').count()) === 0, '3g "Add to portfolio" is not offered to a customer');
  ok((await page.locator('#fsrPrint').count()) === 1 && (await page.locator('#fsrShare').count()) === 1
    && (await page.locator('#fsrJson').count()) === 1, '3h print, share and JSON are still offered');
  const fp = page.locator('#fsrOut details.fingerprint');
  ok((await fp.count()) === 1, '3i the report fingerprint is present');
  ok((await fp.evaluate((el) => el.open)) === false, '3j the fingerprint starts collapsed');
  const order = await page.evaluate(() => {
    const table = document.querySelector('#fsrOut table');
    const attr = document.querySelector('#fsrOut .attr');
    const fingerprint = document.querySelector('#fsrOut details.fingerprint');
    const F = Node.DOCUMENT_POSITION_FOLLOWING;
    return {
      tableThenAttr: !!(table.compareDocumentPosition(attr) & F),
      attrThenFingerprint: !!(attr.compareDocumentPosition(fingerprint) & F)
    };
  });
  ok(order.tableThenAttr && order.attrThenFingerprint,
    '3k the fingerprint sits after the records and the attribution, not ahead of them', order);
  ok(/not a receipt/.test(await text(page, '#fsrOut details.fingerprint')) && /different id/.test(await text(page, '#fsrOut details.fingerprint')),
    '3l the fingerprint still says what it is and is not');
  ok(errors.length === 0, '3m no script errors while building', errors);
  await context.close();
}

// 4. An address that is not on the City's record, in plain language ----------------------
{
  const { context, page } = await open(PAGE, { addressPoints: [] });
  await page.fill('#fsrAddress', '1 Nowhere Street');
  await page.click('#fsrGo');
  await page.waitForSelector('#fsrOut .miss', { timeout: 15000 });
  const miss = await text(page, '#fsrOut .miss');
  ok(/No match for this address/.test(miss), '4a a miss says so plainly', miss);
  ok(!/AddressPoint|Census|OpenAddresses|Geoclient|rooftop/.test(miss), '4b the miss names no data product or service', miss);
  ok(!/could not be determined/i.test(miss), '4c an ordinary miss is not reported as an undeterminable read');
  await context.close();
}

// 5. HomeSignal's own view is still there ------------------------------------------------
{
  const { context, page, errors } = await open(
    PAGE + '?audience=internal&address=' + encodeURIComponent('1 Centre Street') + '&zip=10007&radius_mi=0.5');
  ok(await page.locator('.fsr-nav').isVisible(), '5a the internal nav is visible with ?audience=internal');
  ok((await page.locator('.fsr-nav button:visible').count()) === 5, '5b all five views are offered');
  ok(await page.locator('#fsrInternalBanner').isVisible(), '5c the page says it is an internal view');
  await page.waitForSelector('#fsrOut table', { timeout: 15000 });
  ok((await page.locator('#fsrOut .excl').count()) === 1, '5d the exclusions list is shown to HomeSignal');
  ok((await page.locator('#fsrPortfolioAdd').count()) === 1, '5e "Add to portfolio" is offered to HomeSignal');
  await page.click('.fsr-nav [data-view="coverage"]');
  ok(await page.locator('#fsrCoverageView').isVisible(), '5f the coverage view opens');
  const cov = await text(page, '#fsrCoverageView');
  ok(/Signed paid pilots: 0/.test(cov) && /Verdict: NOT YET/.test(cov),
    '5g the coverage view still states the pilot count and the verdict', cov.slice(0, 200));
  await page.click('.fsr-nav [data-view="usage"]');
  ok(/Signed paid pilots: 0/.test(await text(page, '#fsrUsageView')), '5h the usage view still states the pilot count');
  ok(errors.length === 0, '5i no script errors in the internal views', errors);
  await context.close();
}

await browser.close();
server.close();
if (fails) { console.log('\n' + fails + ' failed'); process.exit(1); }
console.log('\nall passed');
