// THE DEVELOPMENT ACTIVITY REPORT VIEW — driven in a real browser (Development Activity plan, Order I; the full layout is step 3 of
// docs/development-activity-build-steps-100526.md).
//
// test/da-report-view.test.mjs proves WHAT the view says, from its HTML string. This proves how it LIVES on a page, which a string cannot:
//   * a phone-width viewport (390px) has no horizontal overflow, even with long unbroken publisher text, and the sections stack in the
//     plan's mobile order (plan lines 713-735, the sections this step builds);
//   * cards stack in one column on a phone, the lifecycle text and shape are visible on every card without opening anything, and every
//     source link is a tappable target;
//   * keyboard focus: Tab reaches every source link, in reading order, each with a visible focus ring;
//   * text contrast is at least 4.5:1 on the lifecycle labels, the counts and the evidence copy (plan: accessible text contrast);
//   * hostile publisher text, rendered by a real parser, runs nothing and creates no element;
//   * the view makes NO network request, mounts its stylesheet once, and renders nothing for a response that is not a report.
//
// The page is a minimal harness (app.css + the module + one container): no site page loads the view, because none may yet. Every
// response is the real engine's output (test/lib/da-report-view-world.mjs). Nothing here touches production.
// Run: node test/da-report-view.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { RICH, COLD, RIGHTS_NONE, ADDRESS, wire, clone, FAM_B } from './lib/da-report-view-world.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0, total = 0;
const ok = (c, name, detail) => {
  total++;
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const HARNESS = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>report view harness</title><link rel="stylesheet" href="/app.css"><script src="/lib/da-report-view.js"></script></head>'
  + '<body><main id="host"></main></body></html>';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const requested = [];
const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  requested.push(url);
  if (url === '/__harness.html') { res.writeHead(200, { 'content-type': 'text/html' }).end(HARNESS); return; }
  const p = normalize(join(root, decodeURIComponent(url)));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(await readFile(p)); }
  catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();

async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  await page.goto(base + '/__harness.html', { waitUntil: 'load' });
  return { ctx, page, errors };
}
const mount = (page, resp, subject) => page.evaluate(([r, s]) => window.HS.daReportView.mount(document.getElementById('host'), r, s === undefined ? {} : { subject: s }), [resp, subject]);

const W = await wire(RICH);
const WNONE = await wire(RICH, { rights: RIGHTS_NONE });
const WCOLD = await wire(COLD);

// a report whose publisher text cannot wrap by itself, and whose text tries to run code
const hostile = clone(W);
const HP = (k) => hostile.report.projects.find((p) => p.project_id === k);
HP('k-approved').name = 'Unbroken' + 'X'.repeat(140);
HP('k-approved').publisher_status = 'Status' + 'Y'.repeat(120);
HP('k-approved').source.url = 'https://example.gov/' + 'z'.repeat(200);
HP('k-first').name = '<script>window.__pwned=1</script><img src=x onerror="window.__pwned=2">';
HP('k-first').publisher_status = '"><svg onload="window.__pwned=3">';
HP('k-first').source.attribution = '<iframe srcdoc="<script>parent.__pwned=4</script>"></iframe>';

// ---- 1. desktop ---------------------------------------------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await open(1280, 900);
  const before = requested.length;
  const shown = await mount(page, W, ADDRESS);
  ok(shown === true, '1a mount() returns true for a report');
  const after = requested.length;
  ok(after === before, '1b mounting the report made NO network request (the view fetches nothing)', requested.slice(before));
  const info = await page.evaluate(() => ({
    h2: [...document.querySelectorAll('.da-rv h2')].map((h) => h.textContent.trim()),
    styleTags: document.querySelectorAll('#da-rv-style').length,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    addr: document.querySelector('.da-rv-addr').textContent,
    cards: document.querySelectorAll('.da-rv-table tbody tr').length,
  }));
  ok(info.h2.join('|') === 'Type and stage|Nearby Development|Development Activity Map|Change History|Official evidence & coverage',
    '1c the sections render as headings, in the final layout\'s order: the records table, then the map, history and evidence', info.h2);
  ok(info.styleTags === 1 && info.overflow <= 0 && info.addr === ADDRESS && info.cards === 8, '1d one stylesheet, no horizontal overflow at 1280px, the address as header text, eight table rows', info);
  await mount(page, W, ADDRESS); await mount(page, W, ADDRESS);
  ok(await page.evaluate(() => document.querySelectorAll('#da-rv-style').length) === 1, '1e mounting again does not add a second stylesheet');

  // contrast: computed colour against the first opaque background above the element
  const contrast = await page.evaluate(() => {
    const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const bg = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0)) return c.slice(0, 3); } return [255, 255, 255]; };
    const ratio = (el) => { const f = rgb(getComputedStyle(el).color).slice(0, 3), b = bg(el); const a = lum(f), d = lum(b); return (Math.max(a, d) + 0.05) / (Math.min(a, d) + 0.05); };
    const pick = (sel) => [...document.querySelectorAll(sel)].map((e) => [sel, +ratio(e).toFixed(2)]);
    return [].concat(pick('.da-rv-lifetext'), pick('.da-rv-life'), pick('.da-rv-metric span'), pick('.da-rv-line'), pick('.da-rv-link'), pick('.da-rv-p'), pick('.da-rv-tag'), pick('.da-rv-eyebrow'), pick('.da-rv-meta'), pick('.da-rv-h2'), pick('.da-rv-ev'),
      pick('.da-rv-stage'), pick('.da-rv-chip'), pick('.da-rv-chipn'), pick('.da-rv-flab'), pick('.da-rv-revmeta'), pick('.da-rv-onrecord'), pick('.da-rv-act'), pick('.da-rv-soon'), pick('.da-rv-gen'), pick('.da-rv-legend li'), pick('.da-rv-brief'));
  });
  const worst = contrast.reduce((m, c) => (c[1] < m[1] ? c : m), ['', 99]);
  ok(contrast.length > 60 && worst[1] >= 4.5, '1f every text colour measured (' + contrast.length + ' elements: lifecycle labels, counts, lines, links, evidence copy) has at least 4.5:1 contrast; the lowest is ' + worst[0] + ' at ' + worst[1], worst);
  const lifeColours = await page.evaluate(() => [...new Set([...document.querySelectorAll('.da-rv-life')].map((e) => e.className.match(/da-rv-life--(\w+)/)[1]))].sort());
  ok(lifeColours.join() === 'approved,operating,proposed,unknown', '1g all four lifecycle labels were on the page and measured (control)', lifeColours);
  await ctx.close();
  ok(errors.length === 0, '1h no page error and no console error', errors);
}

// ---- 2. a phone ---------------------------------------------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await open(390, 844);
  await mount(page, hostile, ADDRESS);
  await page.evaluate(() => document.querySelectorAll('.da-rv-detail').forEach((d) => { d.open = true; }));
  const m = await page.evaluate(() => {
    const vw = window.innerWidth;
    const root = document.querySelector('.da-rv');
    const wide = [...root.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > vw + 0.5 && !e.closest('svg')).map((e) => e.tagName + '.' + (e.className.baseVal === undefined ? e.className : ''));
    return { docOver: document.documentElement.scrollWidth - vw, bodyOver: document.body.scrollWidth - vw, rootRight: root.getBoundingClientRect().right, wide, longName: document.body.textContent.includes('X'.repeat(140)) };
  });
  ok(m.docOver <= 0 && m.bodyOver <= 0 && m.wide.length === 0, '2a at 390px there is NO horizontal scroll, with a 140-character unbroken name, a 120-character unbroken status and a 200-character URL on the page', m);
  ok(m.longName, '2a (control) the long unbroken text really is on the page, so the overflow check had something to fail on');
  await mount(page, W, ADDRESS);
  await page.evaluate(() => document.querySelectorAll('.da-rv-detail').forEach((d) => { d.open = true; })); // the cards sit in an expandable detail below each table; measure them open
  const lay = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('.da-rv-sec')].map((s) => ({ label: s.getAttribute('aria-label'), top: s.getBoundingClientRect().top + scrollY, left: s.getBoundingClientRect().left, width: s.getBoundingClientRect().width }));
    const cols = [...document.querySelectorAll('.da-rv-cards')].map((g) => [...new Set([...g.children].map((c) => Math.round(c.getBoundingClientRect().left)))].length);
    const cardW = [...document.querySelectorAll('.da-rv-card')].map((c) => c.getBoundingClientRect().width);
    const head = document.querySelector('.da-rv-head').getBoundingClientRect();
    return { secs, cols, cardW, headBottom: head.bottom + scrollY, viewport: innerWidth };
  });
  ok(lay.secs.every((s, i) => i === 0 || s.top > lay.secs[i - 1].top) && lay.secs[0].top >= lay.headBottom - 1, '2b the sections are stacked top to bottom in order, below the property header', lay.secs.map((s) => s.label + '@' + Math.round(s.top)));
  const PLAN_MOBILE = ['Type and stage', 'Nearby Development', 'Development Activity Map', 'Change History', 'Official evidence & coverage'];
  ok(lay.secs.map((s) => s.label).join('|') === PLAN_MOBILE.join('|'), '2c and that order is the page order: the filters, the one records table, the map, history, evidence', lay.secs.map((s) => s.label));
  const bar = await page.evaluate(() => { const b = document.querySelector('.da-rv-actions').getBoundingClientRect(), ev = document.querySelector('.da-rv-sec--evidence').getBoundingClientRect(); return [b.top > ev.top, b.right <= innerWidth + 0.5]; });
  ok(bar[0] && bar[1], '2c2 the action bar comes last and fits the phone screen', bar);
  const plot = await page.evaluate(() => { const r = document.querySelector('.da-rv-plot').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), r.right <= innerWidth + 0.5]; });
  ok(plot[0] >= 300 && plot[1] >= 300 && plot[2], '2c3 the map is legible on a phone (at least 300px square) and fits the screen', plot);
  const rowsPhone = await page.evaluate(() => [...document.querySelectorAll('.da-rv-table tbody tr')].map((r) => { const c = [...r.children].map((x) => x.getBoundingClientRect()); const vw = innerWidth; return { oneColumn: new Set(c.map((x) => Math.round(x.left))).size === 1, fits: c.every((x) => x.right <= vw + 0.5 && x.width >= 200) }; }));
  ok(rowsPhone.length === 8 && rowsPhone.every((r) => r.oneColumn), '2d on a phone each table row stacks its three cells in ONE column (Development, Stage, Quality-of-Life Impact)', rowsPhone);
  ok(rowsPhone.every((r) => r.fits), '2e each cell fits the screen and is wide enough to read');
  const vis = await page.evaluate(() => [...document.querySelectorAll('.da-rv-evrec')].map((c) => { const r = c.getBoundingClientRect(); return r.width > 200 && r.height > 20 && c.querySelector('.da-rv-link') && getComputedStyle(c).visibility === 'visible'; }));
  ok(vis.length === 8 && vis.every(Boolean), '2f every supporting-evidence entry is visible once its detail is open (8 of 8), each with its source link', vis);
  const rowsVis = await page.evaluate(() => [...document.querySelectorAll('.da-rv-table tbody tr')].map((r) => { const sv = r.querySelector('.da-rv-td--stage svg.da-rv-shape'), n = r.querySelector('.da-rv-td--dev .da-rv-sub:not(.da-rv-sub--type):not(.da-rv-sub--src)'); const a = sv && sv.getBoundingClientRect(), b = n && n.getBoundingClientRect(); const op = r.getAttribute('data-da-stage') === 'operating'; return !!(a && b && a.width >= 12 && a.height >= 12 && b.width > 4 && (op || /Map \d+/.test(n.textContent))); }));
  ok(rowsVis.length === 8 && rowsVis.filter(Boolean).length === 7 && rowsVis[7] === false, '2f2 every table row shows its stage or lifecycle shape, and every staged row its "Map N" number, without opening anything (7 of 8: six staged rows and the operating row; the eighth says "Stage not stated" and has no shape)', rowsVis);
  const links = await page.evaluate(() => [...document.querySelectorAll('.da-rv-link')].map((a) => { const r = a.getBoundingClientRect(); return [Math.round(r.height), Math.round(r.width)]; }));
  const tableLinks = await page.evaluate(() => document.querySelectorAll('.da-rv-table .da-rv-link').length);
  ok(tableLinks > 0 && links.length === 8 + tableLinks && links.every(([h, w]) => h >= 32 && w >= 60), '2g every source link (8 evidence entries, ' + tableLinks + ' table rows) is at least 32px tall and 60px wide on a phone: tappable', links);
  const chipsH = await page.evaluate(() => [...document.querySelectorAll('.da-rv-chip, .da-rv-act')].map((b) => Math.round(b.getBoundingClientRect().height)));
  ok(chipsH.length >= 8 && chipsH.every((h) => h >= 36), '2g2 every filter chip and action button is at least 36px tall on a phone', chipsH);
  const sr = await page.evaluate(() => { const e = document.querySelector('.da-rv-sr'); const r = e.getBoundingClientRect(); return [r.width, r.height]; });
  ok(sr[0] <= 2 && sr[1] <= 2, '2h the record name added to each link for screen readers takes up no room');
  await ctx.close();
  ok(errors.length === 0, '2i no page error and no console error', errors);
}

// ---- 3. keyboard ------------------------------------------------------------------------------------------------------------------------------
{
  const { ctx, page } = await open(1280, 900);
  await mount(page, W, ADDRESS);
  const probe = () => page.evaluate(() => {
    const a = document.activeElement;
    const inReport = !!(a && a.closest && a.closest('.da-rv'));
    if (!inReport) return { inReport: false, tag: a ? a.tagName : null };
    const cs = getComputedStyle(a), r = a.getBoundingClientRect(), box = (a.closest('.da-rv-card, .da-rv-rev') || a).getBoundingClientRect();
    return { inReport: true, kind: a.classList.contains('da-rv-link') ? 'link' : a.classList.contains('da-rv-chip') ? 'chip' : a.classList.contains('da-rv-act') ? 'action' : a.tagName,
      href: a.getAttribute('href'), outline: cs.outlineStyle, outlineWidth: parseFloat(cs.outlineWidth), top: Math.round(box.top + scrollY), inView: r.top >= -1 && r.bottom <= innerHeight + 1 };
  });
  const seq = [];
  for (let i = 0; i < 60; i++) { await page.keyboard.press('Tab'); const p = await probe(); if (!p.inReport) { seq.push(p); break; } seq.push(p); }
  const inside = seq.filter((s) => s.inReport), left = seq[seq.length - 1];
  const reached = inside.filter((s) => s.kind === 'link');
  const kinds = inside.map((s) => s.kind);
  const expect = await page.evaluate(() => ({ table: document.querySelectorAll('.da-rv-table .da-rv-link').length, sums: document.querySelectorAll('.da-rv-sum').length }));
  ok(expect.table === 8 && expect.sums === 1 && reached.length === 8 && kinds.filter((k) => k === 'chip').length === 10 && kinds.filter((k) => k === 'action').length === 4
    && kinds.filter((k) => k === 'SUMMARY').length === 1 && kinds.every((k) => ['link', 'chip', 'action', 'SUMMARY'].includes(k)) && left.inReport === false,
    '3a Tab reaches every filter chip (10), the table links (8), the one "Supporting evidence" toggle and the four actions, one per press, and then leaves the report; the entries inside the closed detail are not tab stops', [expect, kinds.join()]);
  ok(inside.every((s) => s.outline !== 'none' && s.outlineWidth >= 2), '3b every focused link, chip and action shows a visible focus ring of at least 2px', inside.filter((s) => !(s.outline !== 'none' && s.outlineWidth >= 2)).map((s) => s.kind));
  ok(inside.every((s, i) => i === 0 || s.top >= inside[i - 1].top - 1), '3c focus follows reading order, top to bottom (items in one row share a top)', inside.map((s) => s.top));
  ok(reached.every((s) => s.inView), '3d each focused link was scrolled into view', reached.filter((s) => !s.inView));
  // a keyboard user opens a detail with Enter and the next Tab press lands on a card inside it
  await page.focus('.da-rv-sum');
  await page.keyboard.press('Enter');
  const opened = await page.evaluate(() => document.querySelector('.da-rv-sum').parentElement.open);
  await page.keyboard.press('Tab');
  const nxt = await page.evaluate(() => { const a = document.activeElement; return { inCard: !!(a && a.closest && a.closest('.da-rv-detail[open] .da-rv-evrec')), tag: a ? a.tagName : null }; });
  ok(opened === true && nxt.inCard, '3e Enter on "Supporting evidence" opens it, and the next Tab press lands on a link inside the opened entries', [opened, nxt]);
  const hrefs = reached.map((s) => s.href);
  ok(new Set(hrefs).size === 8 && hrefs.every((h) => /^https:\/\/example\.gov\/records\/k-/.test(h)), '3e the links are the eight records\' own official sources (each row links to its record\'s source)', [...new Set(hrefs)]);
  const attrs = await page.evaluate(() => [...document.querySelectorAll('.da-rv-link')].map((a) => a.target + ' ' + a.rel));
  ok(attrs.every((a) => a === '_blank noopener noreferrer'), '3f each opens in a new tab with noopener noreferrer');
  await ctx.close();
}

// ---- 4. hostile text, in a real parser --------------------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await open(1280, 900);
  await mount(page, hostile, '"><img src=x onerror="window.__pwned=5">' + ADDRESS);
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({
    pwned: window.__pwned === undefined ? null : window.__pwned,
    imgs: document.querySelectorAll('.da-rv img, .da-rv iframe, .da-rv script, .da-rv object, .da-rv embed, .da-rv form, .da-rv input').length,
    onattrs: [...document.querySelectorAll('.da-rv *')].reduce((n, e) => n + [...e.attributes].filter((a) => /^on/i.test(a.name)).length, 0),
    text: document.querySelector('.da-rv').textContent,
    svgs: document.querySelectorAll('.da-rv svg').length, shapeSvgs: document.querySelectorAll('.da-rv svg.da-rv-shape').length, plots: document.querySelectorAll('.da-rv svg.da-rv-plot').length,
  }));
  ok(r.pwned === null, '4a nothing ran: window.__pwned is still undefined after rendering script, img onerror, svg onload and iframe srcdoc payloads', r.pwned);
  ok(r.imgs === 0 && r.onattrs === 0 && r.svgs === r.shapeSvgs + r.plots && r.plots === 1, '4b and no script, img, iframe, form or input element exists, no on* attribute, and every svg is one of ours (the shapes and the one map)', r);
  ok(r.text.includes('<script>window.__pwned=1</script>') && r.text.includes('"><svg onload="window.__pwned=3">') && r.text.includes('<img src=x onerror="window.__pwned=5">'), '4c the hostile text is visible as text, not dropped');
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('.da-rv a')].map((a) => a.getAttribute('href')));
  ok(hrefs.every((h) => /^https:\/\/example\.gov\//.test(h)), '4d every link on the page still goes to an https record URL');
  await ctx.close();
  ok(errors.length === 0, '4e no page error and no console error', errors);
}

// ---- 5. the address is text only, and an empty report speaks plainly ---------------------------------------------------------------------------------
{
  const { ctx, page } = await open(1280, 900);
  await mount(page, W, ADDRESS);
  const a = await page.evaluate((addr) => {
    const frag = ['742', 'Evergreen', 'Springfield'];
    const bad = [];
    document.querySelectorAll('.da-rv *').forEach((e) => [...e.attributes].forEach((at) => { if (frag.some((f) => at.value.includes(f))) bad.push(e.tagName + '[' + at.name + ']'); }));
    return { bad, url: location.href, inText: document.querySelector('.da-rv').textContent.split(addr).length - 1, title: document.title };
  }, ADDRESS);
  ok(a.bad.length === 0 && a.inText === 1 && !/742|Evergreen/.test(a.url + a.title), '5a the address is in the document once, as text, and in no attribute, the URL or the title', a);
  await mount(page, WNONE, ADDRESS);
  const e = await page.evaluate(() => {
    const li = document.querySelector('.da-rv-lims li'), cs = getComputedStyle(li);
    const op = document.querySelector('.da-rv-outcome-p'), ocs = op && getComputedStyle(op), h = op && op.closest('section').querySelector('h2');
    return { sections: [...document.querySelectorAll('.da-rv-sec')].map((s) => s.getAttribute('aria-label')), text: li.textContent, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), hasCards: document.querySelectorAll('.da-rv-card').length,
      outcome: h ? h.textContent : null, outcomeSize: ocs ? parseFloat(ocs.fontSize) : 0, outcomeVisible: !!(op && op.getBoundingClientRect().height > 0) };
  });
  ok(e.sections.join() === 'No data ingested,Official evidence & coverage' && e.hasCards === 0 && e.text === 'No official development source for this area is included in this report.',
    '5b the shipped state (nothing cleared) says "No data ingested" over the engine\'s limitation text, with no card (founder ruling R5)', e);
  ok(e.outcome === 'No data ingested' && e.outcomeVisible && e.outcomeSize >= 16, '5b2 the outcome is a visible heading and a readable sentence (16px or more)', [e.outcome, e.outcomeSize]);
  ok(e.size >= 16 && e.weight >= 600, '5c and that text is drawn prominently (16px or more, semibold), because it is all the page says', [e.size, e.weight]);
  const cold = await mount(page, WCOLD, undefined);
  const c = await page.evaluate(() => ({ addr: document.querySelector('.da-rv-addr').textContent, brief: [...document.querySelectorAll('[data-da-briefing] li')].map((l) => l.textContent).join(' ') }));
  ok(cold === true && c.addr === 'Address unavailable' && /none recorded yet/.test(c.brief), '5d with no address supplied the header says "Address unavailable", and with no ledger the briefing says no change is recorded yet', c);
  await ctx.close();
}

// ---- 6. a response that is not a report -----------------------------------------------------------------------------------------------------------------
{
  const { ctx, page } = await open(1280, 900);
  await mount(page, W, ADDRESS);
  const r1 = await mount(page, { status: 'OUTSIDE_COVERAGE', zip: '99999', report: null, stored: false }, ADDRESS);
  ok(r1 === false && (await page.evaluate(() => document.getElementById('host').innerHTML)) === '', '6a OUTSIDE_COVERAGE clears the container and shows nothing: the caller owns that message');
  const r2 = await mount(page, { status: 'ADDRESS_NOT_RESOLVED', report: null, stored: false }, ADDRESS);
  ok(r2 === false && (await page.evaluate(() => document.getElementById('host').innerHTML)) === '', '6b ADDRESS_NOT_RESOLVED likewise');
  ok((await page.evaluate(() => window.HS.daReportView.mount(null, {}, {}))) === false, '6c mount(null) is a no-op that returns false');
  await ctx.close();
}

// ---- 7. the Type and Stage filters (100526 plan): presentation only, map and cards in step ------------------------------------------------------------
{
  // ---- 7. the filters: one table, one evidence list and the map follow the Type and Stage chips ----
  const { ctx, page, errors } = await open(1280, 900);
  await mount(page, W, ADDRESS);
  const state = () => page.evaluate(() => {
    const vis = (sel) => [...document.querySelectorAll(sel)].filter((e) => !e.hasAttribute('hidden') && e.getBoundingClientRect().height > 0).length;
    return {
      rows: vis('.da-rv-table tbody tr'), marks: vis('.da-rv-mk'), noMatch: [...document.querySelectorAll('.da-rv-nomatch')].filter((e) => !e.hasAttribute('hidden')).length,
      pressed: [...document.querySelectorAll('.da-rv-chip[aria-pressed="true"]')].map((b) => b.dataset.daFilter + ':' + b.dataset.daValue).sort().join(),
      briefing: document.querySelector('[data-da-briefing]').textContent,
    };
  });
  const s0 = await state();
  ok(s0.rows === 8 && s0.marks === 6 && s0.pressed === 'stage:all,type:all' && s0.noMatch === 0, '7a at rest: All and All are pressed, every row and map marker is shown', s0);
  await page.click('.da-rv-chip[data-da-filter="stage"][data-da-value="proposed"]');
  const s1 = await state();
  ok(s1.rows === 4 && s1.marks === 4 && s1.pressed === 'stage:proposed,type:all', '7b Stage = Proposed / Under Review: only the four proposed rows and markers stay', s1);
  await page.click('.da-rv-chip[data-da-filter="type"][data-da-value="residential"]');
  const s2 = await state();
  ok(s2.rows === 1 && s2.marks === 1 && s2.pressed === 'stage:proposed,type:residential', '7c Type and Stage combine: Residential + Proposed leaves the one proposed residential record, in the table and on the map', s2);
  ok(s2.briefing === s0.briefing, '7d filtering changes what is shown, never the report: the briefing is unchanged', [s2.briefing.length, s0.briefing.length]);
  await page.click('.da-rv-chip[data-da-filter="stage"][data-da-value="permitted"]');
  const s2b = await state();
  ok(s2b.rows === 0 && s2b.noMatch === 1, '7d2 when the filters match nothing the section says so, and draws no empty table', s2b);
  await page.click('.da-rv-chip[data-da-filter="type"][data-da-value="all"]');
  await page.click('.da-rv-chip[data-da-filter="stage"][data-da-value="all"]');
  const s3 = await state();
  ok(s3.rows === s0.rows && s3.marks === s0.marks && s3.noMatch === 0, '7e All and All bring everything back', s3);
  await page.click('.da-rv-chip[data-da-filter="stage"][data-da-value="operating"]');
  ok((await state()).rows === 1, '7e2 the Operating / Built chip leaves the operating record');
  await page.click('.da-rv-chip[data-da-filter="stage"][data-da-value="all"]');
  await page.focus('.da-rv-chip[data-da-filter="stage"][data-da-value="approved"]');
  await page.keyboard.press('Enter');
  ok((await state()).pressed === 'stage:approved,type:all', '7f a chip works from the keyboard (Enter)');
  await ctx.close();
  ok(errors.length === 0, '7g no page error and no console error', errors);
}
{
  // A host page whose own CSS sets display on rows, paragraphs and SVG groups would otherwise show a row the filter hid: the view's own rule must win.
  const { ctx, page } = await open(1280, 900);
  await page.addStyleTag({ content: 'article,p,li,g,tr{display:block}' });
  await mount(page, W, ADDRESS);
  await page.click('.da-rv-chip[data-da-filter="stage"][data-da-value="proposed"]');
  const laidOut = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.da-rv-table tbody tr')].filter((e) => e.getBoundingClientRect().height > 0).length,
    marks: [...document.querySelectorAll('.da-rv-mk')].filter((e) => e.getBoundingClientRect().height > 0).length,
  }));
  ok(laidOut.rows === 4 && laidOut.marks === 4, '7h on a host page whose CSS sets display on rows and g, a filtered-out row and marker still take no space', laidOut);
  await ctx.close();
}

{
  // ---- 12. the one table: desktop is a real three-column table, a phone stacks, evidence is collapsed on screen and printed in full ----
  const { execFileSync } = await import('node:child_process');
  {
    const { ctx, page, errors } = await open(1280, 900);
    await mount(page, W, ADDRESS);
    const d = await page.evaluate(() => {
      const t = document.querySelector('.da-rv-table'), th = [...t.querySelectorAll('thead th')].map((x) => x.textContent.trim());
      const head = t.querySelector('thead').getBoundingClientRect(), cs = getComputedStyle(t);
      const det = document.querySelector('.da-rv-detail');
      const first = [...t.querySelectorAll('tbody tr')[0].children].map((c) => Math.round(c.getBoundingClientRect().top));
      return { display: cs.display, th, headH: Math.round(head.height), rows: t.querySelectorAll('tbody tr').length, entries: det.querySelectorAll('.da-rv-evrec').length, open: det.open,
        shown: det.querySelector('.da-rv-evrec').checkVisibility({ contentVisibilityAuto: true, checkVisibilityCSS: true }), sameLine: new Set(first).size === 1, tables: document.querySelectorAll('.da-rv-table').length,
        titles: [...t.querySelectorAll('tbody th[scope=row] .da-rv-name')].map((x) => x.textContent.trim()), evTitles: [...det.querySelectorAll('.da-rv-evtitle')].map((x) => x.textContent.replace(/^Map \d+\s*/, '').trim()) };
    });
    ok(d.display === 'table' && d.headH > 10 && d.th.join('|') === 'Development|Stage|Quality-of-Life Impact' && d.rows === 8 && d.tables === 1 && d.sameLine, '12a on a desktop there is ONE real table of exactly three columns, one row per record, the three cells side by side', d);
    ok(d.open === false && d.shown === false && d.entries === 8 && d.titles.join('|') === d.evTitles.join('|'), '12b the supporting evidence is in the DOM but collapsed until opened, and lists the same records in the same order', [d.open, d.shown, d.titles, d.evTitles]);
    ok(errors.length === 0, '12c no page error and no console error', errors);
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(390, 844);
    await mount(page, W, ADDRESS);
    const m = await page.evaluate(() => {
      const t = document.querySelector('.da-rv-table'), vw = innerWidth;
      const row = t.querySelector('tbody tr'), r = row.getBoundingClientRect(), head = t.querySelector('thead').getBoundingClientRect();
      const labels = [...row.querySelectorAll('.da-rv-lab')].filter((l) => getComputedStyle(l).display !== 'none').map((l) => l.textContent.trim());
      return { rowDisplay: getComputedStyle(row).display, rowW: Math.round(r.width), vw, headW: Math.round(head.width), headH: Math.round(head.height), labels, over: document.documentElement.scrollWidth - vw,
        role: t.getAttribute('role'), rowRole: row.getAttribute('role'), hasRowHeader: !!row.querySelector('th[role=rowheader]'),
        tops: [...row.children].map((c) => Math.round(c.getBoundingClientRect().top)) };
    });
    ok(m.rowDisplay === 'block' && m.rowW <= m.vw - 20 && m.headW <= 1 && m.headH <= 1 && m.over <= 0, '12f on a phone the table stacks: one block per record, inside the screen, the header row gone from view, no sideways scroll', m);
    ok(m.labels.join('|') === 'Stage:|Quality-of-Life Impact:' && m.tops.every((t, i) => i === 0 || t >= m.tops[i - 1]),
      '12g on a phone each stacked cell says what it is ("Stage:", "Quality-of-Life Impact:"; the record name is the row heading), and the three run top to bottom', m);
    ok(m.role === 'table' && m.rowRole === 'row' && m.hasRowHeader, '12h the stacked rows keep their table roles (table, row, row header) for screen readers', m);
    ok(errors.length === 0, '12i no page error and no console error on a phone', errors);
    await ctx.close();
  }
  {
    // an absent field stays absent: no distances (a reopened or shared report) and no links still leave exactly three columns
    const bare = clone(W); delete bare.render; bare.report.projects.forEach((p) => { p.source = { url: '', attribution: '' }; });
    const { ctx, page } = await open(1280, 900);
    await mount(page, bare, ADDRESS);
    const th = await page.evaluate(() => [...document.querySelectorAll('.da-rv-table')].map((t) => [...t.querySelectorAll('thead th')].map((x) => x.textContent.trim()).join('|')));
    ok(th.length === 1 && th[0] === 'Development|Stage|Quality-of-Life Impact', '12j with no distances and no links the table still has exactly three columns, never an extra or a missing one', th);
    await ctx.close();
  }
  {
    // long publisher text in the table must wrap inside its cell: no overflow at desktop or phone
    const { ctx, page } = await open(1280, 900);
    await mount(page, hostile, ADDRESS);
    const o = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, wide: [...document.querySelectorAll('.da-rv-table td, .da-rv-table th')].filter((c) => c.scrollWidth > c.clientWidth + 1).length }));
    ok(o.over <= 0 && o.wide === 0, '12j2 a 140-character unbroken name, status and address wrap inside their table cells on a desktop', o);
    await ctx.close();
  }
  {
    // print: the evidence is collapsed on screen, but a printed report is the whole report; real print-to-PDF when poppler is here
    const { ctx, page } = await open(1280, 900);
    await mount(page, W, ADDRESS);
    await page.emulateMedia({ media: 'print' });
    const bg = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).backgroundColor]);
    ok(bg[0] === 'rgb(255, 255, 255)', '12e print: the page background is white, so no grey block fills a short last page', bg);
    await page.emulateMedia({ media: null });
    let havePdfText = true;
    try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' }); } catch { havePdfText = false; }
    if (!havePdfText) console.log('SKIP — 12k/12l/12n real print-to-PDF checks: poppler (pdftotext, pdfinfo) is not installed on this machine');
    else {
      const { writeFileSync, mkdtempSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const dir = mkdtempSync(join(tmpdir(), 'da-print-'));
      const pdf = async (name, pg) => { const f = join(dir, name); writeFileSync(f, await pg.pdf({ preferCSSPageSize: true, printBackground: true })); return f; };
      const text = (f) => execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
      const pages = (f) => Number(execFileSync('pdfinfo', [f], { encoding: 'utf8' }).match(/Pages:\s+(\d+)/)[1]);
      const tClosed = text(await pdf('closed.pdf', page));
      await page.evaluate(() => document.querySelectorAll('.da-rv-detail').forEach((d) => { d.open = true; }));
      const tOpen = text(await pdf('open.pdf', page));
      const n = (t, re) => (t.match(re) || []).length;
      ok(tClosed === tOpen && n(tClosed, /Status in HomeSignal's record:/g) >= 8 && !/Supporting evidence for each record/.test(tClosed),
        '12k printing with the evidence collapsed on screen prints exactly what it prints with it open (the whole report), and not the toggle', { same: tClosed === tOpen, status: n(tClosed, /Status in HomeSignal's record:/g) });
      ok(/DEVELOPMENT\s+STAGE\s+QUALITY-OF-LIFE IMPACT/i.test(tClosed) && n(tClosed, /Official source/g) >= 16 && n(tClosed, /Potential|Denied or withdrawn:/g) >= 7 && n(tClosed, /https:\/\/example\.gov\/records\//g) === 8,
        '12l the printed report carries the three-column table, an "Official source" link per record in the table and in its evidence entry, and each full address exactly once (in the evidence entry only)', { src: n(tClosed, /Official source/g), urls: n(tClosed, /https:\/\/example\.gov\/records\//g) });
      ok(/Page 1 of \d/.test(tClosed) && /HomeSignal Development Activity report/.test(tClosed), '12l2 each printed page carries HomeSignal\'s own footer and "Page N of M"');
      // the 3-record road corridor (the Brigham City sample shape) is a short report: two pages
      const { proj, row, FAM_A: FA } = await import('./lib/da-report-view-world.mjs');
      const sr = (id, nm) => proj(id, FA, { name: nm, type: 'Utility', status: 'Approved', stage: 'Under Construction', date_kind: 'filed', submitted_at: '2024-08-26' });
      const BRIG = await wire({ rows: [row('r1', 0.12, FA), row('r2', 0.2, FA), row('r3', 0.3, FA)], projects: [sr('r1', 'SR-13 (Main St) & 100 North'), sr('r2', 'SR-13 (Main St) & 200 North'), sr('r3', 'SR-13 (Main St) & 300 North')], ledger: [], events: [], health: [] });
      await page.evaluate(([r, a]) => window.HS.daReportView.mount(document.getElementById('host'), r, { subject: a, brokerage: 'Summit Realty', agent: 'Jordan Lee' }), [BRIG, '20 N MAIN ST, BRIGHAM CITY, UT 84302']);
      const fb = await pdf('brigham.pdf', page), tb = text(fb), pcb = pages(fb);
      const pagesText = tb.split('\f');
      const firstPage = (re) => pagesText.findIndex((t) => re.test(t));
      ok(pcb <= 3, '12m the three-record sample prints in no more than three pages (target two): ' + pcb, pcb);
      ok(/20 N Main St, Brigham City, UT 84302/.test(tb) && !/20 N MAIN ST/.test(tb), '12m2 the printed address uses display capitalization only', tb.slice(0, 200));
      const verifyPages = [...tb.split('\f').entries()].flatMap(([i, t]) => [...t.matchAll(/Verify:/g)].map(() => i));
      const namePages = ['100 North', '200 North', '300 North'].map((nm) => firstPage(new RegExp('SR-13 \\(Main St\\) & ' + nm)));
      ok(verifyPages.length >= 3 && namePages.every((p, i) => p === verifyPages[i]), '12n no table row is split across pages: each record\'s name and its stale-record warning are on the same page', { namePages, verifyPages });
      ok(n(tb, /Verify: Filed Aug 26, 2024/g) === 3 && pagesText[0].includes('Verify:'), '12o each stale record carries its concise warning in the printed table');
      // a large report: it paginates, the header row repeats, no row is stranded
      const many = { rows: [], projects: [], ledger: [], events: [], health: [] };
      for (let i = 0; i < 40; i++) { many.rows.push(row('m' + i, 0.05 + i * 0.011, i % 2 ? FA : FAM_B)); many.projects.push(proj('m' + i, i % 2 ? FA : FAM_B, { name: 'Project ' + String(i).padStart(2, '0') + ' Long Descriptive Development Name', status: ['Approved', 'Proposed', 'Under Construction'][i % 3], date_kind: 'filed', submitted_at: '2026-0' + (1 + (i % 8)) + '-10' })); }
      const BIG = await wire(many);
      await page.evaluate(([r, a]) => window.HS.daReportView.mount(document.getElementById('host'), r, { subject: a }), [BIG, ADDRESS]);
      const fl = await pdf('large.pdf', page), pcl = pages(fl), tl = text(fl).split('\f');
      const withRows = tl.filter((t) => /Project \d\d Long Descriptive/.test(t) && /Potential (construction|disruption)/.test(t));
      ok(pcl > pcb && pcl <= 14 && withRows.length >= 2 && withRows.slice(0, -1).every((t) => /DEVELOPMENT\s+STAGE\s+QUALITY-OF-LIFE IMPACT/i.test(t)) && withRows.every((t) => /DEVELOPMENT\s+STAGE\s+QUALITY-OF-LIFE IMPACT/i.test(t)),
        '12p a 40-record report paginates (' + pcl + ' pages) and the table header repeats on every page that carries rows', { pcl, withRows: withRows.length });
      let split = 0;
      for (let i = 0; i < 40; i++) { const nm = 'Project ' + String(i).padStart(2, '0') + ' Long'; const pg = tl.findIndex((t) => t.includes(nm)); const lines = tl[pg].split('\n'); const li = lines.findIndex((l) => l.includes(nm)); const rest = lines.slice(li, li + 6).join(' '); if (!/Official source/.test(rest)) split++; }
      ok(split === 0, '12q in a 40-record report no row is stranded: each record\'s name has its "Official source" link on the same page', split);
    }
    await ctx.close();
  }
}

{
  // The client briefing: a short list under the header that must read on a phone, print, and never bring the internal lifecycle line back.
  for (const [width, label] of [[390, 'phone'], [1280, 'desktop']]) {
    const { ctx, page, errors } = await open(width, 900);
    await mount(page, W, ADDRESS);
    const m = await page.evaluate(() => {
      const b = document.querySelector('.da-rv-brief'), h = document.querySelector('.da-rv-head'), f = document.querySelector('.da-rv-sec');
      if (!b) return null;
      const r = b.getBoundingClientRect(), hr = h.getBoundingClientRect(), fr = f.getBoundingClientRect();
      return { w: Math.round(r.width), vw: document.documentElement.clientWidth, below: r.top >= hr.bottom - 1, above: r.bottom <= fr.top + 1, scrollW: document.documentElement.scrollWidth, text: b.textContent.length, items: b.querySelectorAll('li').length,
        life: [...document.querySelectorAll('.da-rv-evrec')].filter((c) => /HomeSignal lifecycle/.test(c.textContent)).length };
    });
    ok(m && m.below && m.above && m.w <= m.vw && m.scrollW <= m.vw && m.text > 100 && m.items >= 3 && m.items <= 6, '11-' + label + 'a the briefing sits between the header and the first section, fits the ' + label + ' width, and is a short list', m);
    ok(m && m.life === 0, '11-' + label + 'b no entry in the customer view carries a "HomeSignal lifecycle" line', m);
    if (width === 390) {
      await page.emulateMedia({ media: 'print' });
      const pr = await page.evaluate(() => { const b = document.querySelector('.da-rv-brief'); const cs = b && getComputedStyle(b); return b ? { shown: cs.display !== 'none', avoid: cs.breakInside } : null; });
      ok(pr && pr.shown && pr.avoid === 'avoid', '11-printa in print the briefing is shown and is not split across pages', pr);
    }
    ok(errors.length === 0, '11-' + label + 'c no page error and no console error', errors);
    await ctx.close();
  }
}

{
  // Layout refinement (screen): heading hierarchy, a framed three-column table that does not overflow, nothing scrolls sideways on a phone.
  const { ctx, page } = await open(1280, 900);
  await mount(page, W, ADDRESS);
  const d = await page.evaluate(() => {
    const fs = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
    const t = document.querySelector('.da-rv-sec--records .da-rv-table'), wrap = t.closest('.da-rv-tablewrap');
    return { addr: fs('.da-rv-addr'), h2: fs('.da-rv-h2'), body: fs('.da-rv-p'), cols: t.querySelectorAll('thead th').length, over: wrap.scrollWidth - wrap.clientWidth,
      cell: parseFloat(getComputedStyle(t.querySelector('td')).paddingTop), secBorder: getComputedStyle(document.querySelector('.da-rv-sec--records')).borderTopWidth };
  });
  ok(d.addr > d.h2 && d.h2 > d.body, '13a type hierarchy: address > section heading > supporting text', d);
  ok(d.cols === 3 && d.over <= 0 && d.cell >= 14 && d.secBorder === '1px', '13b the table keeps exactly three columns, does not overflow, rows have room, and sections are separated by a hairline', d);
  const m = await open(390, 800);
  await mount(m.page, W, ADDRESS);
  ok((await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, '13c on a phone nothing scrolls sideways', null);
  await m.ctx.close();
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n' + (total - fails) + ' passed, ' + fails + ' failed of ' + total);
process.exit(fails ? 1 : 0);
