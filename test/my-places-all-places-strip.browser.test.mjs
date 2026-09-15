// MY PLACES — the strip measures EVERY Place, and refuses to state a number it did not measure.
//
// The two middle tiles used to read the VIEWED ZIP alone and label themselves with it
// ("Need you · ZIP 78617") on the page whose whole subject is the resident's whole
// membership. This drives the SHIPPED page with a controlled data layer and asserts what
// the strip renders.
//
// WHY A BROWSER TEST AND NOT A UNIT TEST: the logic is page-local (inside properties.html's
// HS.onReady closure), so it is reachable only by running the page. The data layer is
// replaced by appending to shell.js — HS.ready callbacks run in REGISTRATION order, and
// shell.js is parsed before the page's inline script, so these overrides are installed
// before the page's own callback runs. Nothing about properties.html is modified for the test.
//
// Run: node test/my-places-all-places-strip.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 400)); }
};

// Two saved Addresses and three followed ZIPs = FIVE Places over THREE distinct ZIPs
// (78617 backs both an Address and a ZIP follow — one query, two Places).
const OVERRIDE = `
(function () {
  var ADDR = [
    { id: 'a1', address: '13313 COOMES DR', city: 'DEL VALLE', state: 'TX', zip: '78617' },
    { id: 'a2', address: '96 ISLAND DR', city: 'HORSESHOE BAY', state: 'TX', zip: '78657' }
  ];
  var ZIPS = [
    { zip: '78617', name: 'Del Valle (78617)', state: 'TX' },
    { zip: '78657', name: 'Horseshoe Bay (78657)', state: 'TX' },
    { zip: '75009', name: 'Celina (75009)', state: 'TX' }
  ];
  // ONE county notice reachable from TWO of the resident's ZIPs — materialized once per
  // ZIP, so it must be counted ONCE. Identical on every field changeKey reads.
  var SHARED = { source_ref: 'https://example.gov/notice/1', title: 'County hearing',
                 occurred_at: '2026-09-01', category: 'Planning', window_closes_at: '2099-01-01' };
  var WINDOWED = [
    Object.assign({ id: 'c1', zip: '78617' }, SHARED),
    Object.assign({ id: 'c2', zip: '78657' }, SHARED),
    { id: 'c3', zip: '75009', source_ref: 'https://example.gov/notice/2', title: 'Celina hearing',
      occurred_at: '2026-09-02', category: 'Planning', window_closes_at: '2099-01-01' },
    // CLOSED window — present in the read, must not be counted.
    { id: 'c4', zip: '75009', source_ref: 'https://example.gov/notice/3', title: 'Old hearing',
      occurred_at: '2020-01-01', category: 'Planning', window_closes_at: '2020-02-01' }
  ];
  window.__calls = { projects: [], windows: 0 };
  HS.followedCommunities = function () { return ZIPS.slice(); };
  HS.ready.then(function () { HS.state.properties = ADDR.slice(); });
  HS.data.projects = async function (zip) {
    window.__calls.projects.push(zip);
    if (zip === '78617') { var a = new Array(500).fill(0).map(function (_, i) { return { id: 'p' + i }; }); a.complete = true; return a; }
    if (zip === '78657') { var b = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }]; b.complete = true; return b; }
    // 75009: geography not cut over -> rpcAllRows reports complete:false with NO rows.
    var c = []; c.complete = false; return c;
  };
  HS.data.openWindowChangesForZips = async function (zips) {
    window.__calls.windows++;
    return WINDOWED.filter(function (r) { return zips.indexOf(r.zip) >= 0; });
  };
})();
`;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const p = normalize(join(root, rel));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(p);
    if (rel === '/shell.js') body = Buffer.concat([body, Buffer.from('\n' + OVERRIDE)]);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
await page.route('**/*', r => r.request().url().startsWith(base)
  ? r.continue()
  : r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.supabase={createClient:function(){return{}}};' }));

await page.goto(base + '/properties.html?data=seed&demo=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelectorAll('#propStrip > *').length >= 3, null, { timeout: 15000 })
  .catch(() => {});

const got = await page.evaluate(() => ({
  tiles: [].map.call(document.querySelectorAll('#propStrip > *'),
    t => (t.textContent || '').replace(/\s+/g, ' ').trim()),
  calls: window.__calls,
  chip: (document.getElementById('locLabel') || {}).textContent || '',
  where: !!document.getElementById('phWhere')
}));
const tileText = got.tiles.join(' | ');

console.log('--- rendered strip ---\n' + got.tiles.map(t => '  ' + t).join('\n'));

console.log('\n--- 1. every Place is measured, and the label says how many ---');
ok(/5\s*Places/.test(tileText), '1a: the Places tile still counts all five Places', tileText);
// 500 (78617) + 4 (78657); 75009 did not read, so it is excluded from BOTH the total and
// the place count beside it.
ok(/504Developments found · 4 of 5 places/.test(tileText),
  '1b: Developments = 504 across the 4 Places that actually read', tileText);
ok(!/\+/.test(tileText),
  '1c: NO "+" — the authoritative RPC returns one untruncatable array, so 500 is exact');

console.log('\n--- 2. a notice reachable from two Places counts ONCE ---');
// c1/c2 are one county notice materialized per ZIP; c3 is a second real one; c4 is closed.
ok(/2Need you · all 5 places/.test(tileText),
  '2a: Need you = 2 (shared notice deduped, closed window excluded)', tileText);

console.log('\n--- 3. the two tiles are scoped INDEPENDENTLY ---');
ok(/Need you · all 5 places/.test(tileText) && /Developments found · 4 of 5 places/.test(tileText),
  '3a: one tile read every Place, the other did not — and each says so', tileText);

console.log('\n--- 4. every Place ZIP was queried, once ---');
// The VIEWED ZIP is read once at the top of the page for the Address cards. The strip
// must REUSE that payload, not pull the same 500 rows again — so the total is three calls
// for three ZIPs, with the viewed ZIP appearing exactly once.
ok(got.calls && got.calls.projects.length === 3,
  '4a: three ZIP reads in total — the viewed ZIP is not fetched twice', got.calls);
ok(got.calls && got.calls.projects.filter(z => z === '78617').length === 1,
  '4a2: the viewed ZIP was read exactly once and its payload reused', got.calls);
ok(got.calls && ['78617', '78657', '75009'].every(z => got.calls.projects.indexOf(z) >= 0),
  '4b: the Address-only ZIP and the follow-only ZIP are both included', got.calls);
ok(got.calls && got.calls.windows === 1, '4c: the comment-window read is ONE query for all ZIPs', got.calls);

console.log('\n--- 5. the page still names itself, not one of its Places ---');
ok(got.chip === 'Viewing · ALL MY PLACES', '5a: the Viewing chip names ALL MY PLACES', got.chip);
ok(got.where === false, '5b: no single-address context line under the heading');

console.log('\n--- 6. no page errors ---');
ok(pageErrors.length === 0, '6a: the page threw nothing', pageErrors);

await browser.close(); server.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nAll My Places strip assertions passed.');
process.exit(fails ? 1 : 0);
