// Browser proof for the development dossier's expandable information tiles (2026-11-06).
// Builds the pages with the SHIPPED generator (test/lib/development-pages-fixture.mjs), serves
// them, and checks in Chromium at 1440px and 390px: tiles start closed, open and close on click
// and from the keyboard, several stay open at once, a link to a section opens its tile and shows
// it below the sticky site header, the page header keeps the critical facts visible, nothing
// scrolls sideways, and dark mode keeps the tiles readable. The page runs no script, so all of
// this is the browser's own <details> behaviour.
//
// Run: node test/development-pages-tiles.browser.test.mjs   (SHOT_DIR=<dir> also saves screenshots)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { W, dossiers, build } from './lib/development-pages-fixture.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP development-pages-tiles.browser.test.mjs — playwright not installed');
  process.exit(0);
}

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

// A dossier with every kind of section: an open protest window, grouped entities, documents,
// a news report, videos and posts, an impact statement, and a linked record page.
function rich() {
  const x = dossiers();
  const v = x.dossiers['valley-campus'];
  v.links[2].facts.protest = { protest_end: '2026-12-01', protested: 'Protested', record_url: W, checked_at: '2026-10-28T12:29:08Z',
    agency: 'Example Water Agency', form_url: 'https://agency.example.gov/protest-form', form_label: 'File a protest with the agency',
    help_url: 'https://agency.example.gov/protest-guide.pdf', help_label: 'Protest guide',
    who: 'Anyone affected may file a protest.', how: 'The form asks for your reasons.' };
  v.links.push(
    { kind: 'organization', ref: 'MA:Example Digital, LLC', role: 'master_developer', grade: 'a', evidence_url: W,
      evidence_label: 'Change record x123', text: 'Named as the developer in the change record', facts: {} },
    { kind: 'organization', ref: 'MA:Example Authority', role: 'governing_body', grade: 'a', evidence_url: 'https://notice.example.gov/1',
      evidence_label: 'Authority notices', text: 'Adopted the project area plan', facts: {} },
    { kind: 'document', ref: 'https://water.example.gov/doc.pdf', role: 'primary_document', grade: 'a', date: '2026-10-15',
      date_label: 'Filed', evidence_url: 'https://water.example.gov/doc.pdf', evidence_label: 'Scanned document 1',
      text: 'Change application x123, as filed, with exhibits', aspect: 'Water', facts: {} },
    { kind: 'news_report', ref: 'https://news.example.com/a', role: 'reported_by', grade: 'b', date: '2026-06-04',
      date_label: 'Published', evidence_url: 'https://news.example.com/a', evidence_label: 'Example News', text: 'Developer shrinks the site', facts: {} });
  v.statements.push({ kind: 'impact', body: 'Truck traffic on the ranch road during construction.', evidence_url: W, evidence_label: 'Change record x123' },
    { kind: 'known', body: 'The ranch water right is being changed to industrial use.', evidence_url: W, evidence_label: 'Change record x123' });
  return x;
}

const { r, out } = build(rich());
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const PATH = '/development/ma/valley-campus/';

const server = createServer(async (req, res) => {
  let p = normalize(join(out, decodeURIComponent(req.url.split('?')[0].split('#')[0])));
  if (!p.startsWith(out)) { res.writeHead(403).end(); return; }
  if (p.endsWith('/')) p = join(p, 'index.html');
  try { res.writeHead(200, { 'content-type': 'text/html' }).end(await readFile(p)); }
  catch { res.writeHead(404).end('not found'); }
});
await new Promise((res) => server.listen(0, '127.0.0.1', res));
const BASE = `http://127.0.0.1:${server.address().port}`;
const SHOT = process.env.SHOT_DIR;
if (SHOT) mkdirSync(SHOT, { recursive: true });

const browser = await chromium.launch();
try {
  for (const [label, vp] of [['desktop 1440', { width: 1440, height: 900 }], ['mobile 390', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + PATH);

    const state = () => page.$$eval('.tile details', (ds) => ds.map((d) => d.open));
    const initial = await state();
    ok(initial.length >= 7 && initial.every((o) => !o), `${label}: every tile starts closed`, initial);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no sideways scroll, tiles closed`);

    // Critical facts stay visible with every tile closed.
    for (const sel of ['h1', '.where', '.pill.type', '.pill.life', '.actions .btn', '.protest .btn']) {
      ok(await page.isVisible(sel), `${label}: ${sel} is visible above the tiles`);
    }
    if (SHOT) await page.screenshot({ path: join(SHOT, `after-${vp.width}-closed.png`), fullPage: true });

    // Click opens; click again closes; several stay open.
    const sum = (id) => `section[aria-labelledby="h-${id}"] summary`;
    await page.click(sum('timeline'));
    ok(await page.isVisible('#timeline .timeline'), `${label}: clicking a tile shows its content`);
    await page.click(sum('entities'));
    const both = await page.$$eval('.tile details', (ds) => ds.filter((d) => d.open).length);
    ok(both === 2 && await page.isVisible('#timeline .timeline'), `${label}: two tiles stay open together`, both);
    const rot = await page.$eval(`${sum('timeline')} .chev`, (e) => getComputedStyle(e).transform);
    const rotClosed = await page.$eval(`${sum('map')} .chev`, (e) => getComputedStyle(e).transform);
    ok(rot !== rotClosed, `${label}: the chevron turns when a tile is open`, [rot, rotClosed]);
    await page.click(sum('timeline'));
    ok(!(await page.isVisible('#timeline .timeline')), `${label}: clicking again closes it`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no sideways scroll, tiles open`);

    // Keyboard: the summary is focusable and Enter / Space toggle it.
    await page.focus(sum('documents'));
    ok(await page.evaluate(() => document.activeElement.tagName === 'SUMMARY'), `${label}: a tile is reachable from the keyboard`);
    await page.keyboard.press('Enter');
    ok(await page.isVisible('#documents .cards'), `${label}: Enter opens a tile`);
    await page.keyboard.press(' ');
    ok(!(await page.isVisible('#documents .cards')), `${label}: Space closes it`);

    // Every tile open at once still fits the screen (the video reel must not widen the column).
    await page.$$eval('.tile details', (ds) => ds.forEach((d) => { d.open = true; }));
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no sideways scroll, every tile open`,
       await page.evaluate(() => document.documentElement.scrollWidth));
    await page.$$eval('.tile details', (ds) => ds.forEach((d) => { d.open = false; }));

    // Every link the closed page carries is still in the page (a <details> hides, never removes).
    const hrefs = await page.$$eval('main a[href]', (as) => as.length);
    ok(hrefs > 20, `${label}: the source links are all in the page`, hrefs);

    if (SHOT) {
      for (const id of ['overview', 'next', 'impacts', 'timeline', 'entities', 'documents', 'map', 'coverage']) {
        const s = sum(id);
        if (await page.$(s) && !(await page.$eval(`section[aria-labelledby="h-${id}"] details`, (d) => d.open))) await page.click(s);
      }
      await page.screenshot({ path: join(SHOT, `after-${vp.width}-open.png`), fullPage: true });
    }

    // Deep links: a link to a section opens its tile and shows it below the sticky header.
    for (const [pth, id] of [[PATH, 'timeline'], [PATH, 'next'], [PATH, 'coverage'], ['/development/ma/olympia-mixed-use/', 'records']]) {
      const p2 = await ctx.newPage();
      await p2.goto(`${BASE}${pth}#${id}`);
      await p2.waitForTimeout(150);
      const res = await p2.evaluate((id) => {
        const t = document.getElementById(id), d = t && t.closest('details');
        const head = document.querySelector('.hs-header');
        const hb = head ? head.getBoundingClientRect().bottom : 0;
        const sm = d && d.querySelector('summary').getBoundingClientRect();
        return { open: !!(d && d.open), top: t ? t.getBoundingClientRect().top : null, hb, sumTop: sm && sm.top,
                 inView: t ? t.getBoundingClientRect().top < window.innerHeight : false };
      }, id);
      ok(res.open && res.inView && res.top >= res.hb, `${label}: #${id} opens its tile and is shown below the header`, res);
      await p2.close();
    }
    ok(errors.length === 0, `${label}: no page errors`, errors);
    await ctx.close();
  }

  // Dark mode keeps the tiles readable.
  const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const dp = await dark.newPage();
  await dp.goto(BASE + PATH);
  const c = await dp.$eval('.tile details', (e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e.querySelector('h2')).color]);
  ok(c[0] !== 'rgb(255, 255, 255)' && c[1] !== c[0], 'dark mode: tiles use the dark surface with light text', c);
  if (SHOT) await dp.screenshot({ path: join(SHOT, 'after-1440-dark.png'), fullPage: true });
  await dark.close();

  // A page with few sections draws only the tiles it has.
  const lone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const lp = await lone.newPage();
  await lp.goto(BASE + '/development/ma/olympia-mixed-use/');
  const ids = await lp.$$eval('.tile .tb', (ts) => ts.map((t) => t.id));
  ok(ids.length >= 1 && !ids.includes('coverage') && !ids.includes('impacts'), 'a sparse page draws only its non-empty tiles', ids);
  ok(await lp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'a sparse page does not scroll sideways');
  await lone.close();
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `\n${fails} failed` : '\nAll development-page tile assertions passed.');
process.exit(fails ? 1 : 0);
