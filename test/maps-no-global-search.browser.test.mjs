// MAPS: THE UNIVERSAL SEARCH CONTROL IS SUPPRESSED — driven in a real browser.
// Run: node test/maps-no-global-search.browser.test.mjs
//
// WHY. On Maps, a resident who searches "data center" gets "No matches" while Data center is
// a first-class, POPULATED Maps type sitting on the same screen — because the universal index
// holds projects, changes and saved properties, not map categories. A search control that
// cannot answer the page's own vocabulary is worse than no control, so it is removed from the
// Maps header until universal search is Maps-aware. This is a TEMPORARY UI suppression: the
// search implementation, its index and its behaviour everywhere else are untouched, which is
// what §3 below proves on the same shipped code in the same run.
//
// WHY IT MUST BE A BROWSER SUITE. The markup lives in partials/shell.html, which every page
// injects identically; the suppression is a runtime decision in shell.js::injectShell() keyed
// on <body data-nav>. Reading either file offline cannot tell you what a Maps page renders.
//
// WHY "not visible" IS NOT THE ASSERTION. A CSS hide would leave the button in the tab order
// and HS.openSearch() able to open the panel. §1 asserts the NODES ARE ABSENT, §2 asserts the
// two ways in are closed anyway (keyboard reach, and the API called directly).
//
// Every network call is answered locally or aborted; no production service is touched.
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

async function open(url, viewport) {
  const page = await browser.newPage({ viewport });
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/cdn\.jsdelivr\.net/.test(u)) return route.continue();
    return route.abort();
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#hs-top');       // the shell is injected
  await page.waitForTimeout(2500);             // ...and boot() has run past wireSearch()
  return page;
}
// Count the nodes rather than ask whether one is visible: absence is the contract.
const searchNodes = page => page.evaluate(() => ({
  wrap: document.querySelectorAll('#hs-searchwrap').length,
  btn: document.querySelectorAll('#hs-search-btn').length,
  panel: document.querySelectorAll('#hs-search-panel').length,
  input: document.querySelectorAll('#hs-search').length,
  results: document.querySelectorAll('#hs-search-results').length,
  // Anything at all in the header that reads as a search affordance to a resident.
  labelled: [...document.querySelectorAll('#hs-top button, #hs-top input')]
    .map(e => (e.textContent || '') + '|' + (e.getAttribute('aria-label') || '') + '|' + (e.placeholder || ''))
    .filter(t => /search/i.test(t)),
}));

const VIEWPORTS = [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
];

for (const [name, viewport] of VIEWPORTS) {
  const page = await open(base + '/homesignalmap.html?zip=84302&data=seed', viewport);

  // ── 1. the control is not in the Maps document at all ────────────────────────────────
  const n = await searchNodes(page);
  ok(n.wrap === 0 && n.btn === 0 && n.panel === 0 && n.input === 0 && n.results === 0,
    `1a ${name}: no global-search node exists on Maps`, n);
  ok(n.labelled.length === 0,
    `1b ${name}: nothing in the Maps header reads as a search affordance`, n.labelled);

  // ── 2. neither way in is open ─────────────────────────────────────────────────────────
  // Keyboard: tab the whole header and prove no focusable element is the search control.
  const reached = await page.evaluate(() => {
    const focusables = [...document.querySelectorAll(
      '#hs-top a[href], #hs-top button, #hs-top input, #hs-top [tabindex]:not([tabindex="-1"])')];
    return focusables.filter(e => e.id === 'hs-search-btn' || e.id === 'hs-search'
      || (e.closest && e.closest('#hs-searchwrap'))).length;
  });
  ok(reached === 0, `2a ${name}: the search control is not keyboard-reachable in the header`, reached);
  // API: the panel cannot be opened even by calling the opener directly.
  const opened = await page.evaluate(() => {
    try { window.HS.openSearch(); } catch (e) { return 'threw: ' + e.message; }
    return document.querySelectorAll('#hs-search-panel:not(.hidden)').length;
  });
  ok(opened === 0, `2b ${name}: HS.openSearch() opens no panel on Maps`, opened);

  // ── 3. everything else in the Maps header and page is untouched ───────────────────────
  const kept = await page.evaluate(() => ({
    share: [...document.querySelectorAll('#hs-top button')].some(b => /share/i.test(b.textContent || '')),
    bell: !!document.querySelector('#hs-top [aria-label="Notifications"]'),
    avatar: !!document.querySelector('#hs-avatar'),
    // The Maps address field stays the prominent, primary way into near-home results.
    addr: !!document.querySelector('#addr'),
    addrVisible: !!(document.querySelector('#addr')
      && document.querySelector('#addr').getBoundingClientRect().width > 0),
    // The Data center type filter stays visible and operable.
    datacenter: !!document.querySelector('[data-cat="datacenter"]'),
  }));
  ok(kept.share && kept.bell && kept.avatar,
    `3a ${name}: Share, notifications and profile are unchanged`, kept);
  ok(kept.addr && kept.addrVisible,
    `3b ${name}: the Maps address field is present and visible`, kept);
  ok(kept.datacenter, `3c ${name}: the Data center type filter is present`, kept);

  // The Data center chip still toggles the filter state it has always toggled.
  const toggled = await page.evaluate(() => {
    const chip = document.querySelector('[data-cat="datacenter"]');
    if (!chip) return null;
    const before = !!window.HS.getCategoryFilters().datacenter;
    chip.click();
    const after = !!window.HS.getCategoryFilters().datacenter;
    chip.click();                                   // leave the map as we found it
    return { before, after, restored: !!window.HS.getCategoryFilters().datacenter };
  });
  ok(toggled && toggled.before !== toggled.after && toggled.restored === toggled.before,
    `3d ${name}: the Data center filter still toggles`, toggled);

  await page.close();
}

// ── 4. THE BIDIRECTIONAL PROOF: a NON-Maps page still ships the control, same code ───────
// Without this, "no button on Maps" is equally satisfied by having deleted the feature.
{
  const page = await open(base + '/alerts.html?data=seed', { width: 1440, height: 900 });
  const n = await searchNodes(page);
  ok(n.wrap === 1 && n.btn === 1 && n.panel === 1 && n.input === 1,
    '4a a non-Maps page still renders the global-search control', n);
  await page.click('#hs-search-btn');
  const open4 = await page.evaluate(() =>
    document.querySelectorAll('#hs-search-panel:not(.hidden)').length);
  ok(open4 === 1, '4b ...and its button still opens the panel', open4);
  await page.close();
}

console.log('='.repeat(72));
console.log(fails ? 'FAILS: ' + fails : 'ALL PASS');
await browser.close();
server.close();
if (fails) process.exit(1);
