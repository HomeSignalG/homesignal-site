// THE not_measured READ CONTRACT, PROVEN ON REAL PAGES AGAINST THE LIVE DATABASE.
//
// It checks the SAME four ZIP states twice: once on the DEPLOYED build, and once on this
// branch's build served locally. Both talk to the live database, so the DB half of the repair
// is exercised identically by each; the only difference is the page code. That is what
// separates "the read path is repaired" from "a resident can tell the states apart".
//
// ⚠️ BOUNDED ON PURPOSE (the previous unit's verifier saturated production: 15 concurrent
// PostgREST queries, 9 of them app_projects_for_zip, one running 71 s, and a twelve-project ZIP
// slowed from 1.2 s to 11 s). Every page load here is SEQUENTIAL, there are eight of them, and
// not one is a dense ZIP. A correctness probe must not manufacture the outage it is looking for.
//
// Run: node scripts/verify-zip-development-contract.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOYED = process.env.HS_BASE || 'https://homesignal.net';
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (detail !== undefined ? '  [' + detail + ']' : ''));
  if (!c) fails++;
};

// The four states, one representative each. Deliberately NO dense ZIP.
const CASES = [
  { zip: '10015', state: 'not_measured', tag: 'repaired — was a stale cutover false zero' },
  { zip: '01004', state: 'not_measured', tag: 'established — was 90 legacy rows' },
  { zip: '01009', state: 'measured_zero', tag: 'boundary_complete, genuinely zero' },
  { zip: '28456', state: 'authoritative', tag: 'boundary_complete, 12 records' }
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(await readFile(p)); }
  catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const LOCAL = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch();

// One page load. Returns what the RPC answered and what the page then said.
async function read(base, zip) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // KEY ON THE REQUEST BODY, NOT ON THE RESPONSE SHAPE. Development and facilities share this
  // endpoint, and the first version of this probe took "the first array" as the development
  // answer — which silently captured the FACILITY call every time. The tell was that every n it
  // reported equalled that ZIP's facility count (10015 -> 10, 01004 -> 5, 01009 -> 26,
  // 28456 -> 5, never 12). A probe that reads the wrong call reports a wrong product.
  let rpc = null;
  page.on('response', async (r) => {
    if (!r.url().includes('/rpc/app_projects_for_zip')) return;
    let kind = null;
    try { kind = JSON.parse(r.request().postData() || '{}').p_kind; } catch (_e) { return; }
    if (kind !== 'development') return;
    try {
      const j = await r.json();
      rpc = Array.isArray(j) ? { kind: 'array', n: j.length }
          : (j && j.unavailable) ? { kind: 'unavailable', status: j.zip_geography_status }
          : { kind: 'other', body: JSON.stringify(j).slice(0, 80) };
    } catch (_e) { rpc = { kind: 'unreadable' }; }
  });
  await page.goto(`${base}/community.html?zip=${zip}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const txt = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');
  await ctx.close();
  return {
    rpc,
    claimsZero: /No permit or planning records on file for this ZIP yet/i.test(txt),
    saysNotMeasured: /not available for ZIP|not resolved yet/i.test(txt),
    saysNotAZero: /not a finding of zero/i.test(txt),
    refusesCircle: /circle around the ZIP centre/i.test(txt),
    keepsFacilities: /Regulated facilit/i.test(txt)
  };
}

for (const label of ['DEPLOYED', 'THIS BRANCH']) {
  const base = label === 'DEPLOYED' ? DEPLOYED : LOCAL;
  console.log(`\n══ ${label} — ${base} ══`);
  for (const c of CASES) {
    const r = await read(base, c.zip);                       // sequential, one at a time
    console.log(`── ${c.zip} (${c.state} · ${c.tag}) rpc=${JSON.stringify(r.rpc)}`);
    if (label === 'THIS BRANCH') {
      if (c.state === 'not_measured') {
        ok(r.rpc && r.rpc.kind === 'unavailable', `${c.zip}: the read is UNAVAILABLE, not an array`, JSON.stringify(r.rpc));
        ok(r.saysNotMeasured, `${c.zip}: the page SAYS whole-ZIP development is not measured`);
        ok(r.saysNotAZero, `${c.zip}: ...and says outright it is not a finding of zero`);
        ok(r.refusesCircle, `${c.zip}: ...and refuses the centroid substitute`);
        ok(!r.claimsZero, `${c.zip}: it no longer claims "no records on file" — that asserted a measurement`);
        ok(r.keepsFacilities, `${c.zip}: facilities survive — empty development is not an empty page`);
      }
      if (c.state === 'measured_zero') {
        ok(r.rpc && r.rpc.kind === 'array' && r.rpc.n === 0, `${c.zip}: a measured zero is still an ARRAY of 0`, JSON.stringify(r.rpc));
        ok(r.claimsZero, `${c.zip}: ...and still says there are no records, which is TRUE here`);
        ok(!r.saysNotMeasured, `${c.zip}: ...and never claims to be unmeasured`);
      }
      if (c.state === 'authoritative') {
        ok(r.rpc && r.rpc.kind === 'array' && r.rpc.n > 0, `${c.zip}: authoritative development still served`, JSON.stringify(r.rpc));
        ok(!r.saysNotMeasured && !r.claimsZero, `${c.zip}: ...and makes neither empty claim`,
           `claims-zero=${r.claimsZero} says-not-measured=${r.saysNotMeasured}`);
      }
    } else {
      // The deployed build has the DB fix but not the page fix. Reported, not asserted — this
      // is the measurement that says what a resident sees right now.
      console.log(`   deployed says: claims-zero=${r.claimsZero} not-measured=${r.saysNotMeasured} facilities=${r.keepsFacilities}`);
    }
  }
}

await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILURE(S)` : '\nZIP-DEVELOPMENT CONTRACT: PASS');
process.exit(fails ? 1 : 0);
