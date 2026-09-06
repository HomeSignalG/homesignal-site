// HEADER SEARCH — THE POPOVER'S INPUT MUST ANSWER THE KEYBOARD AND MUST NEVER GO SILENTLY
// DEAD, driven in a real browser.
//
// Reported from production: "after i click enter after writing data center nothing happens."
// Reproduced on the shipped code, and it was TWO defects wearing one symptom:
//
//   1. wireSearch() bound an 'input' listener and NOTHING ELSE. Pressing Enter did nothing —
//      no navigation, no submit — because the control has only ever been click-to-navigate.
//      Measured on a222545: hits rendered, Enter -> url unchanged.
//   2. The listeners were attached AFTER `await Promise.all([projects, changes])`. Any
//      rejection in that read — a null client, an RPC error, one bad row — meant the
//      listener was never attached at all, so typing produced NO dropdown: not results, not
//      even "No matches". A dead field and a field with nothing to say looked identical.
//      Measured on a222545 with the data layer unreachable: results box hidden, textContent "".
//
// Both are pinned here because both are invisible at runtime: nothing throws where a user or
// a reviewer would see it, and the offline suite cannot reach either without a browser.
//
// Every network call is answered locally or aborted; no production service is touched.
//
// Run: node test/header-search.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

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

const browser = await chromium.launch();

// Open the page, open the search popover, type a query. `block` cuts the supabase-js CDN
// script so window.supabase is undefined and HS.data's reads reject — the degraded state,
// produced deterministically rather than by waiting for a network to misbehave.
async function typeQuery(url, q, block) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (block && /@supabase/.test(u)) return route.abort();
    if (/cdn\.jsdelivr\.net/.test(u)) return route.continue();
    return route.abort();
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#hs-search-btn');
  await page.waitForTimeout(2500);              // let boot() reach wireSearch()
  await page.click('#hs-search-btn');
  await page.type('#hs-search', q, { delay: 15 });
  await page.waitForTimeout(300);
  return page;
}
const boxState = page => page.$eval('#hs-search-results',
  e => ({ hidden: e.classList.contains('hidden'), text: e.textContent.trim(),
          hrefs: [...e.querySelectorAll('a')].map(a => a.getAttribute('href')) }));

// ── 1. the dropdown still filters and still links (result semantics unchanged) ──────────
let page = await typeQuery(base + '/homesignalmap.html?data=seed', 'data center', false);
let st = await boxState(page);
ok(!st.hidden && st.hrefs.length > 0, '1a a matching query renders linked results', st);
ok(st.hrefs.every(h => /^(development|alerts|property)\.html/.test(h)),
  '1b every result links into the app, not to a new search surface', st.hrefs);

// ── 2. Enter opens the top match ────────────────────────────────────────────────────────
const top = st.hrefs[0];
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
ok(page.url() === base + '/' + top, '2 Enter navigates to the TOP hit', { url: page.url(), top });
await page.close();

// ── 3. Enter with nothing to open must not invent a destination ─────────────────────────
page = await typeQuery(base + '/homesignalmap.html?data=seed', 'zzzznotathing', false);
st = await boxState(page);
ok(!st.hidden && st.text === 'No matches', '3a a query with no hits says so', st);
const before = page.url();
await page.keyboard.press('Enter');
await page.waitForTimeout(700);
ok(page.url() === before, '3b Enter on an empty result set stays put', page.url());
await page.close();

// ── 4. THE REGRESSION: a failed index degrades to "No matches", never to a dead field ───
page = await typeQuery(base + '/homesignalmap.html', 'data center', true);
st = await boxState(page);
ok(!st.hidden, '4a a degraded index still opens the dropdown (the field is not dead)', st);
ok(st.text === 'No matches', '4b ...and says "No matches" rather than nothing at all', st);
await page.close();

console.log('='.repeat(72));
console.log(fails ? 'FAILS: ' + fails : 'ALL PASS');
await browser.close();
server.close();
if (fails) process.exit(1);
