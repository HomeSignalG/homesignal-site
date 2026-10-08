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
import { RICH, COLD, RIGHTS_NONE, ADDRESS, wire, clone } from './lib/da-report-view-world.mjs';

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
    cards: document.querySelectorAll('.da-rv-card').length,
  }));
  ok(info.h2.join('|') === 'What Changed Around This Property|Recent Official Activity|Type and stage|Development Activity Map|Things to Review With Your Client|Approved / Coming|Proposed / Under Review|Permitted / Under Construction|Change History|Official evidence & coverage',
    '1c the sections render as headings, in the plan\'s order with the filters directly above the map', info.h2);
  ok(info.styleTags === 1 && info.overflow <= 0 && info.addr === ADDRESS && info.cards === 8, '1d one stylesheet, no horizontal overflow at 1280px, the address as header text, eight cards', info);
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
  const PLAN_MOBILE = ['What Changed Around This Property', 'Recent Official Activity', 'Type and stage', 'Development Activity Map', 'Things to Review With Your Client', 'Approved / Coming', 'Proposed / Under Review',
    'Permitted / Under Construction', 'Change History', 'Official evidence & coverage'];
  ok(lay.secs.map((s) => s.label).join('|') === PLAN_MOBILE.join('|'), '2c and that order is the page-one order with the filters directly above the map: what changed, the filters, the map, things to review, the three stages, history, evidence', lay.secs.map((s) => s.label));
  const bar = await page.evaluate(() => { const b = document.querySelector('.da-rv-actions').getBoundingClientRect(), ev = document.querySelector('.da-rv-sec--evidence').getBoundingClientRect(); return [b.top > ev.top, b.right <= innerWidth + 0.5]; });
  ok(bar[0] && bar[1], '2c2 the action bar comes last and fits the phone screen', bar);
  const plot = await page.evaluate(() => { const r = document.querySelector('.da-rv-plot').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), r.right <= innerWidth + 0.5]; });
  ok(plot[0] >= 300 && plot[1] >= 300 && plot[2], '2c3 the map is legible on a phone (at least 300px square) and fits the screen', plot);
  ok(lay.cols.length > 0 && lay.cols.every((c) => c === 1), '2d cards stack in ONE column on a phone', lay.cols);
  ok(lay.cardW.every((w) => w <= lay.viewport - 20 && w >= 200), '2e each card fits the screen and is wide enough to read', lay.cardW.map(Math.round));
  const vis = await page.evaluate(() => [...document.querySelectorAll('.da-rv-card')].map((c) => {
    const t = c.querySelector('.da-rv-lifetext'), s = c.querySelector('svg.da-rv-shape');
    const rt = t.getBoundingClientRect(), rs = s.getBoundingClientRect(), cs = getComputedStyle(t);
    return rt.width > 20 && rt.height > 8 && rs.width >= 12 && rs.height >= 12 && cs.visibility === 'visible' && cs.display !== 'none' && t.textContent.trim().length > 0;
  }));
  ok(vis.length === 8 && vis.every(Boolean), '2f the lifecycle text AND its shape are visible on every card once its detail is open (8 of 8); the rows above show the marker shape without opening anything (2f2)', vis);
  const rowsVis = await page.evaluate(() => [...document.querySelectorAll('.da-rv-table tbody tr')].map((r) => { const sv = r.querySelector('svg.da-rv-shape'), n = r.querySelector('.da-rv-td--num span'); const a = sv && sv.getBoundingClientRect(), b = n && n.getBoundingClientRect(); return !!(a && b && a.width >= 12 && a.height >= 12 && b.width > 4 && /^\d+$/.test(n.textContent.trim())); }));
  ok(rowsVis.length === 6 && rowsVis.every(Boolean), '2f2 every table row shows its marker shape and map number without opening anything (6 of 6: the eight cards less the two hero rows that sit outside the stage sections)', rowsVis);
  const links = await page.evaluate(() => [...document.querySelectorAll('.da-rv-link')].map((a) => { const r = a.getBoundingClientRect(); return [Math.round(r.height), Math.round(r.width)]; }));
  const tableLinks = await page.evaluate(() => document.querySelectorAll('.da-rv-table .da-rv-link').length);
  ok(tableLinks > 0 && links.length === 11 + tableLinks && links.every(([h, w]) => h >= 32 && w >= 60), '2g every source link (8 cards, 3 review items, ' + tableLinks + ' table rows) is at least 32px tall and 60px wide on a phone: tappable', links);
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
      href: a.getAttribute('href'), outline: cs.outlineStyle, outlineWidth: parseFloat(cs.outlineWidth), top: Math.round(box.top + scrollY), inView: r.top >= 0 && r.bottom <= innerHeight };
  });
  const seq = [];
  for (let i = 0; i < 60; i++) { await page.keyboard.press('Tab'); const p = await probe(); if (!p.inReport) { seq.push(p); break; } seq.push(p); }
  const inside = seq.filter((s) => s.inReport), left = seq[seq.length - 1];
  const reached = inside.filter((s) => s.kind === 'link');
  const kinds = inside.map((s) => s.kind);
  const expect = await page.evaluate(() => ({ reachable: [...document.querySelectorAll('.da-rv-link')].filter((a) => !a.closest('details:not([open])')).length, review: document.querySelectorAll('.da-rv-rev .da-rv-link').length, table: document.querySelectorAll('.da-rv-table .da-rv-link').length, sums: document.querySelectorAll('.da-rv-sum').length }));
  ok(expect.review === 3 && expect.table > 0 && expect.sums === 2 && reached.length === expect.reachable && expect.reachable === 2 + expect.review + expect.table && kinds.filter((k) => k === 'chip').length === 8 && kinds.filter((k) => k === 'action').length === 4
    && kinds.filter((k) => k === 'SUMMARY').length === 2 && kinds.every((k) => ['link', 'chip', 'action', 'SUMMARY'].includes(k)) && left.inReport === false,
    '3a Tab reaches the two hero links, the review links (3), the table links (' + expect.table + '), every filter chip (8), the two "Full official detail" toggles (the Permitted section is empty in this report) and the four actions, one per press, and then leaves the report; the cards inside a closed detail are not tab stops', kinds.join(','));
  ok(inside.every((s) => s.outline !== 'none' && s.outlineWidth >= 2), '3b every focused link, chip and action shows a visible focus ring of at least 2px', inside.filter((s) => !(s.outline !== 'none' && s.outlineWidth >= 2)).map((s) => s.kind));
  ok(inside.every((s, i) => i === 0 || s.top >= inside[i - 1].top - 1), '3c focus follows reading order, top to bottom (items in one row share a top)', inside.map((s) => s.top));
  ok(reached.every((s) => s.inView), '3d each focused link was scrolled into view');
  // a keyboard user opens a detail with Enter and the next Tab press lands on a card inside it
  await page.focus('.da-rv-sum');
  await page.keyboard.press('Enter');
  const opened = await page.evaluate(() => document.querySelector('.da-rv-sum').parentElement.open);
  await page.keyboard.press('Tab');
  const nxt = await page.evaluate(() => { const a = document.activeElement; return { inCard: !!(a && a.closest && a.closest('.da-rv-detail[open] .da-rv-card')), tag: a ? a.tagName : null }; });
  ok(opened === true && nxt.inCard, '3e Enter on "Full official detail" opens it, and the next Tab press lands on a link inside the opened cards', [opened, nxt]);
  const hrefs = reached.map((s) => s.href);
  ok(new Set(hrefs).size === 8 && hrefs.every((h) => /^https:\/\/example\.gov\/records\/k-/.test(h)), '3e the links are the eight records\' own official sources (a Things to Review item links to its record\'s source)', [...new Set(hrefs)]);
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
  const c = await page.evaluate(() => ({ addr: document.querySelector('.da-rv-addr').textContent, hero: document.querySelector('.da-rv-hero h2').textContent }));
  ok(cold === true && c.addr === 'Address unavailable' && c.hero === 'Recent Official Activity', '5d with no address supplied the header says "Address unavailable", and with no ledger the hero is Recent Official Activity', c);
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
  const { ctx, page, errors } = await open(1280, 900);
  await mount(page, W, ADDRESS);
  const state = () => page.evaluate(() => {
    const vis = (sel) => [...document.querySelectorAll(sel)].filter((e) => !e.hasAttribute('hidden') && e.getBoundingClientRect().height > 0).length;
    return {
      cards: { approved: vis('.da-rv-sec--approved .da-rv-card'), proposed: vis('.da-rv-sec--proposed .da-rv-card'), permitted: vis('.da-rv-sec--permitted .da-rv-card') },
      marks: vis('.da-rv-mk'), noMatch: [...document.querySelectorAll('.da-rv-nomatch')].filter((e) => !e.hasAttribute('hidden')).map((e) => e.closest('.da-rv-sec').getAttribute('aria-label')),
      pressed: [...document.querySelectorAll('.da-rv-chip[aria-pressed="true"]')].map((b) => b.dataset.daFilter + ':' + b.dataset.daValue).sort().join(),
      counts: document.querySelector('.da-rv-sec--proposed .da-rv-count').textContent, review: document.querySelectorAll('.da-rv-rev').length, hero: !!document.querySelector('.da-rv-hero'),
    };
  });
  const s0 = await state();
  ok(JSON.stringify(s0.cards) === '{"approved":2,"proposed":4,"permitted":0}' && s0.marks === 6 && s0.pressed === 'stage:all,type:all', '7a at rest: All and All are pressed, every staged card and map marker is shown', s0);
  await page.click('.da-rv-chip[data-da-filter="stage"][data-da-value="proposed"]');
  const s1 = await state();
  ok(JSON.stringify(s1.cards) === '{"approved":0,"proposed":4,"permitted":0}' && s1.marks === 4 && s1.pressed === 'stage:proposed,type:all' && s1.noMatch.join() === 'Approved / Coming',
    '7b Stage = Proposed / Under Review: only proposed cards and markers stay, and Approved / Coming says nothing in it matches the filters', s1);
  await page.click('.da-rv-chip[data-da-filter="type"][data-da-value="residential"]');
  const s2 = await state();
  ok(JSON.stringify(s2.cards) === '{"approved":0,"proposed":1,"permitted":0}' && s2.marks === 1 && s2.pressed === 'stage:proposed,type:residential', '7c Type and Stage combine: Residential + Proposed leaves the one proposed residential record, on the map and in the list', s2);
  ok(s2.counts === '4 official records' && s2.review === 3 && s2.hero, '7d filtering changes what is shown, never the report: the section count, Things to Review and the hero are unchanged', s2);
  await page.click('.da-rv-chip[data-da-filter="type"][data-da-value="all"]');
  await page.click('.da-rv-chip[data-da-filter="stage"][data-da-value="all"]');
  const s3 = await state();
  ok(JSON.stringify(s3.cards) === JSON.stringify(s0.cards) && s3.marks === s0.marks && s3.noMatch.length === 0, '7e All and All bring everything back', s3);
  await page.focus('.da-rv-chip[data-da-filter="stage"][data-da-value="approved"]');
  await page.keyboard.press('Enter');
  ok((await state()).pressed === 'stage:approved,type:all', '7f a chip works from the keyboard (Enter)');
  await ctx.close();
  ok(errors.length === 0, '7g no page error and no console error', errors);
}
{
  // A host page whose own CSS sets display on articles, paragraphs and SVG groups (normalize.css does this for article) would otherwise
  // show a card the filter hid: the view's own rule must win. Visibility here is measured by layout alone, never by the attribute.
  const { ctx, page } = await open(1280, 900);
  await page.addStyleTag({ content: 'article,p,li,g{display:block}' });
  await mount(page, W, ADDRESS);
  await page.click('.da-rv-chip[data-da-filter="stage"][data-da-value="proposed"]');
  const laidOut = await page.evaluate(() => ({
    approved: [...document.querySelectorAll('.da-rv-sec--approved .da-rv-card')].filter((e) => e.getBoundingClientRect().height > 0).length,
    marks: [...document.querySelectorAll('.da-rv-mk')].filter((e) => e.getBoundingClientRect().height > 0).length,
  }));
  ok(laidOut.approved === 0 && laidOut.marks === 4, '7h on a host page whose CSS sets display on article and g, a filtered-out card and marker still take no space', laidOut);
  await ctx.close();
}

{
  // The comparison table (realtor wording pass, step 15): rows above the cards, which stay below in an expandable detail.
  // Desktop is a real table; a phone stacks one block per record; the filters, the keyboard and print all still reach every record.
  const { execFileSync } = await import('node:child_process');
  {
    const { ctx, page, errors } = await open(1280, 900);
    await mount(page, W, ADDRESS);
    const d = await page.evaluate(() => {
      const t = document.querySelector('.da-rv-sec--proposed .da-rv-table'), th = [...t.querySelectorAll('thead th')].map((x) => x.textContent.trim());
      const head = t.querySelector('thead').getBoundingClientRect(), cs = getComputedStyle(t);
      const det = document.querySelector('.da-rv-sec--proposed .da-rv-detail');
      const card = det.querySelector('.da-rv-card');
      return { display: cs.display, th, headH: Math.round(head.height), rows: t.querySelectorAll('tbody tr').length, cards: det.querySelectorAll('.da-rv-card').length, open: det.open, cardShown: card.checkVisibility({ contentVisibilityAuto: true, checkVisibilityCSS: true }),
        titles: [...t.querySelectorAll('tbody th[scope=row]')].map((x) => x.textContent.trim()), cardTitles: [...det.querySelectorAll('.da-rv-title')].map((x) => x.textContent.trim()) };
    });
    ok(d.display === 'table' && d.headH > 10 && d.th[0] === 'Map' && d.th[1] === 'Record' && d.th.includes('Official source') && d.rows === 4, '12a on a desktop the stage section opens with a real table: Map, Record, ... Official source, one row per record', d);
    ok(d.open === false && d.cardShown === false && d.cards === 4 && d.rows === d.cards && d.titles.join('|') === d.cardTitles.join('|'), '12b the cards are in the DOM but collapsed until opened, and the rows list the same records in the same order', [d.open, d.cardShown, d.titles, d.cardTitles]);
    ok(errors.length === 0, '12c no page error and no console error', errors);
    // the filters: a Stage filter takes the other sections' rows, table and detail with it; a Type filter does the same inside a section
    await page.click('.da-rv-chip[data-da-filter="stage"][data-da-value="proposed"]');
    const f1 = await page.evaluate(() => ({ approvedWrap: document.querySelector('.da-rv-sec--approved .da-rv-tablewrap').hidden, approvedDet: document.querySelector('.da-rv-sec--approved .da-rv-detail').hidden,
      proposedRows: [...document.querySelectorAll('.da-rv-sec--proposed .da-rv-table tbody tr')].filter((r) => r.getBoundingClientRect().height > 0).length, note: !document.querySelector('.da-rv-sec--approved .da-rv-nomatch').hidden }));
    ok(f1.approvedWrap && f1.approvedDet && f1.proposedRows === 4 && f1.note, '12d Stage = Proposed hides the Approved table and its detail (and says nothing matches there), and the four Proposed rows stay', f1);
    await page.click('.da-rv-chip[data-da-filter="stage"][data-da-value="all"]');
    const types = await page.evaluate(() => [...document.querySelectorAll('.da-rv-chip[data-da-filter="type"]')].map((b) => b.getAttribute('data-da-value')).filter((v) => v !== 'all'));
    await page.click('.da-rv-chip[data-da-filter="type"][data-da-value="' + types[0] + '"]');
    const f2 = await page.evaluate((ty) => ({ shown: [...document.querySelectorAll('.da-rv-table tbody tr')].filter((r) => r.getBoundingClientRect().height > 0).map((r) => r.getAttribute('data-da-type')), all: document.querySelectorAll('.da-rv-table tbody tr').length, ty }), types[0]);
    ok(f2.shown.length > 0 && f2.shown.length < f2.all && f2.shown.every((t) => t === f2.ty), '12e a Type filter leaves only that Type\'s rows in every table (rows carry the same Type and Stage the cards and map markers do)', f2);
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(390, 844);
    await mount(page, W, ADDRESS);
    const m = await page.evaluate(() => {
      const t = document.querySelector('.da-rv-sec--proposed .da-rv-table'), vw = innerWidth;
      const row = t.querySelector('tbody tr'), r = row.getBoundingClientRect(), head = t.querySelector('thead').getBoundingClientRect();
      const labels = [...row.querySelectorAll('.da-rv-lab')].filter((l) => getComputedStyle(l).display !== 'none').map((l) => l.textContent.trim());
      return { rowDisplay: getComputedStyle(row).display, rowW: Math.round(r.width), vw, headW: Math.round(head.width), headH: Math.round(head.height), labels, over: document.documentElement.scrollWidth - vw,
        role: t.getAttribute('role'), rowRole: row.getAttribute('role'), hasRowHeader: !!row.querySelector('th[role=rowheader]'),
        tops: [...row.children].map((c) => Math.round(c.getBoundingClientRect().top)) };
    });
    ok(m.rowDisplay === 'block' && m.rowW <= m.vw - 20 && m.headW <= 1 && m.headH <= 1 && m.over <= 0, '12f on a phone the table stacks: one block per record, inside the screen, the header row gone from view, no sideways scroll', m);
    ok(m.labels.includes('Distance:') && m.labels.includes('Type:') && m.labels.includes('Official source:') && !m.labels.includes('Agency stage:') && m.tops.every((t, i) => i === 0 || t >= m.tops[i - 1]),
      '12g each stacked cell says what it is ("Distance:", "Type:", "Official source:"), a record with no agency stage has no empty "Agency stage:" cell, and the cells run top to bottom', m);
    ok(m.role === 'table' && m.rowRole === 'row' && m.hasRowHeader, '12h the stacked rows keep their table roles (table, row, row header) for screen readers', m);
    ok(errors.length === 0, '12i no page error and no console error on a phone', errors);
    await ctx.close();
  }
  {
    // an absent field stays absent: no distances (a reopened or shared report) means no Distance column, and no links means no Official source column
    const bare = clone(W); delete bare.render; bare.report.projects.forEach((p) => { p.source = { url: '', attribution: '' }; });
    const { ctx, page } = await open(1280, 900);
    await mount(page, bare, ADDRESS);
    const th = await page.evaluate(() => [...document.querySelectorAll('.da-rv-table')].map((t) => [...t.querySelectorAll('thead th')].map((x) => x.textContent.trim()).join('|')));
    ok(th.length === 2 && th.every((h) => !/Distance/.test(h) && !/Official source/.test(h) && /^Map\|Record/.test(h)), '12j a column no record has a value for is left out: no Distance without distances, no Official source without a link', th);
    await ctx.close();
  }
  {
    // print: the cards are collapsed on screen, but a printed report is the whole report
    const { ctx, page } = await open(1280, 900);
    await mount(page, W, ADDRESS);
    const closed = await page.evaluate(() => [...document.querySelectorAll('.da-rv-detail')].every((d) => !d.open));
    // When poppler's pdftotext is on the machine (it is not on the CI runner), prove the print with a real print-to-PDF. Do not emulate a media
    // type before page.pdf(): an explicit "screen" makes the PDF print the screen styles. 12m proves the same CSS everywhere, without the tool.
    let havePdfText = true;
    try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { havePdfText = false; }
    if (!havePdfText) console.log('SKIP — 12k/12l real print-to-PDF text check: pdftotext is not installed on this machine (12m still proves the print stylesheet and the print hook without it)');
    else {
      const { writeFileSync, mkdtempSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const dir = mkdtempSync(join(tmpdir(), 'da-print-'));
      const textOf = async (name) => { writeFileSync(join(dir, name), await page.pdf({ format: 'Letter', printBackground: true })); return execFileSync('pdftotext', ['-layout', join(dir, name), '-'], { encoding: 'utf8' }); };
      const tClosed = await textOf('closed.pdf');
      await page.evaluate(() => document.querySelectorAll('.da-rv-detail').forEach((d) => { d.open = true; }));
      const tOpen = await textOf('open.pdf');
      const n = (t, re) => (t.match(re) || []).length;
      ok(tClosed === tOpen && n(tClosed, /Status in HomeSignal's record:/g) >= 6 && !/Full official detail/.test(tClosed),
        '12k printing the report with every detail collapsed on screen prints exactly what it prints with every detail open (the whole report), and not the "Full official detail" toggle', { same: tClosed === tOpen, status: n(tClosed, /Official agency status:/g), toggle: /Full official detail/.test(tClosed) });
      ok(/MAP\s+RECORD/i.test(tClosed) && n(tClosed, /Official source/g) >= 12, '12l the printed report carries the table (Map, Record ...) and a link line for each record in the table and in its card', [/MAP\s+RECORD/i.test(tClosed), n(tClosed, /Official source/g)]);
      await page.evaluate(() => document.querySelectorAll('.da-rv-detail').forEach((d) => { d.open = false; }));
    }
    await ctx.close();
  }
}

{
  // The client briefing (realtor wording pass, 2026-10-04): a paragraph under the header that must read on a phone, print, and never
  // bring the internal lifecycle line back into the customer view.
  for (const [width, label] of [[390, 'phone'], [1280, 'desktop']]) {
    const { ctx, page, errors } = await open(width, 900);
    await mount(page, W, ADDRESS);
    const m = await page.evaluate(() => {
      const b = document.querySelector('.da-rv-brief'), h = document.querySelector('.da-rv-head'), f = document.querySelector('.da-rv-sec');
      if (!b) return null;
      const r = b.getBoundingClientRect(), hr = h.getBoundingClientRect(), fr = f.getBoundingClientRect();
      return { w: Math.round(r.width), vw: document.documentElement.clientWidth, below: r.top >= hr.bottom - 1, above: r.bottom <= fr.top + 1, scrollW: document.documentElement.scrollWidth, text: b.textContent.length,
        life: document.querySelectorAll('.da-rv-card').length ? [...document.querySelectorAll('.da-rv-card')].filter((c) => /HomeSignal lifecycle/.test(c.textContent)).length : -1 };
    });
    ok(m && m.below && m.above && m.w <= m.vw && m.scrollW <= m.vw && m.text > 100, '11-' + label + 'a the briefing sits between the header and the first section, fits the ' + label + ' width, and causes no sideways scroll', m);
    ok(m && m.life === 0, '11-' + label + 'b no card in the customer view carries a "HomeSignal lifecycle" line', m);
    if (width === 390) {
      await page.emulateMedia({ media: 'print' });
      const pr = await page.evaluate(() => { const b = document.querySelector('.da-rv-brief'); const cs = b && getComputedStyle(b); return b ? { shown: cs.display !== 'none', avoid: cs.breakInside } : null; });
      ok(pr && pr.shown && pr.avoid === 'avoid', '11-printa in print the briefing is shown and is not split across pages', pr);
    }
    ok(errors.length === 0, '11-' + label + 'c no page error and no console error', errors);
    await ctx.close();
  }
}

await browser.close();
server.close();
console.log('\n' + (total - fails) + ' passed, ' + fails + ' failed of ' + total);
process.exit(fails ? 1 : 0);
