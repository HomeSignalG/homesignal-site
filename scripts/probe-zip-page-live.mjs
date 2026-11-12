// One-off, read-only live check of /community/<zip>/ after the meetings-card fix (#2840). Branch only.
import { chromium, devices } from 'playwright';
const BASE = 'https://jodytracks.com', ZIP = (process.env.ZIPS || '97149').split(',')[0].trim();
const URL0 = BASE + '/community/' + ZIP + '/';
// Expected upcoming meetings (public.meetings, 2026-11-12): [Mountain date, CivicClerk event id, cancelled]
const EXP = [["2026-11-17","2445",true],["2026-11-18","2512",true],["2026-11-18","2405",true],["2026-11-24","2562",false],["2026-11-25","2721",false],["2026-11-25","2668",false],["2026-12-01","2563",false],["2026-12-02","2669",false],["2026-12-02","2722",false],["2026-12-07","2772",false],["2026-12-08","2564",false],["2026-12-09","2670",false],["2026-12-09","2723",false]];
const byId = Object.fromEntries(EXP.map(([d, id, c]) => [id, { d, c }]));
let fails = 0; const ok = (c, n, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (c || d === undefined ? '' : '  ' + JSON.stringify(d).slice(0, 400))); if (!c) fails++; };
const fmt = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const browser = await chromium.launch();
{ // saved HTML
  const ctx = await browser.newContext({ javaScriptEnabled: false }); const p = await ctx.newPage();
  const r = await p.goto(URL0 + '?nojs=' + Date.now()); const html = await p.content();
  const items = [...html.matchAll(/event\/(\d+)\/overview[^>]*>([^<]*)<\/a>( <span class="mtg-cancelled">Cancelled<\/span>)? <time>([\d-]+)<\/time>/g)].map(m => [m[1], m[4], !!m[3]]);
  ok(r.status() === 200, 'saved: HTTP 200');
  ok(!/No upcoming public meetings on file/.test(html), 'saved: no "no upcoming meetings" sentence');
  ok(items.length >= 6, 'saved: meetings listed (' + items.length + ')', items);
  ok(items.every(([id, d, c]) => byId[id] && byId[id].d === d && byId[id].c === c), 'saved: every listed meeting has its database date and cancelled flag', items);
  ok(/Neskowin/.test(html) && /Tillamook County/.test(html), 'saved: names Neskowin and Tillamook County');
  await ctx.close();
}
for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['mobile', { ...devices['iPhone 13'] }]]) {
  const ctx = await browser.newContext(opts); const p = await ctx.newPage();
  const errs = [], bad = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  p.on('pageerror', e => errs.push('pageerror ' + String(e.message).slice(0, 200)));
  p.on('requestfailed', q => bad.push((q.failure() || {}).errorText + ' ' + q.url().slice(0, 140)));
  p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 140)); });
  const r = await p.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const cardOk = await p.waitForFunction(() => document.querySelector('#commPage [data-mtg-list]'), null, { timeout: 45000 }).then(() => true, () => false);
  await p.waitForTimeout(5000);
  const L = label + ': ';
  ok(r.status() === 200 && cardOk, L + 'page rendered with the new meetings list');
  const s = await p.evaluate(() => {
    const card = document.querySelector('#commPage [data-mtg-list]');
    const head = ((document.getElementById('commPage') || {}).textContent || '').match(/Government\s*&\s*civic\s*—\s*(\d+) upcoming/);
    return { h1: (document.querySelector('h1') || {}).textContent, head: head ? +head[1] : null,
      rows: card ? [...card.querySelectorAll('li.mtg-row')].map(li => ({ t: li.textContent.replace(/\s+/g, ' ').trim(), href: (li.querySelector('a') || {}).href || '', badge: !!li.querySelector('.mtg-cancelled') })) : [],
      text: card ? card.textContent.replace(/\s+/g, ' ') : '', page: (document.getElementById('commPage') || {}).textContent || '',
      over: document.documentElement.scrollWidth > innerWidth + 1, vw: innerWidth, sw: document.documentElement.scrollWidth };
  });
  console.log(L + 'rows ' + JSON.stringify(s.rows.map(x => x.t)));
  ok(/97149 · Neskowin, OR/.test(s.h1 || ''), L + 'heading names Neskowin, OR', s.h1);
  ok(s.rows.length === 6, L + 'six meetings listed', s.rows.length);
  const ids = s.rows.map(x => (x.href.match(/tillamookcoor\.portal\.civicclerk\.com\/event\/(\d+)\/overview$/) || [])[1]);
  ok(ids.every(id => id && byId[id]), L + 'each row links its own Tillamook County calendar event', s.rows.map(x => x.href));
  ok(new Set(ids).size === ids.length, L + 'no two rows share a link');
  ok(s.rows.every((x, i) => byId[ids[i]] && x.t.endsWith(fmt(byId[ids[i]].d))), L + 'each row shows its own meeting date', s.rows.map((x, i) => [x.t, ids[i] && fmt(byId[ids[i]].d)]));
  const firstSix = EXP.slice(0, 6).map(e => e[0]).join(); const shown = ids.map(id => byId[id] && byId[id].d).join();
  ok(shown === firstSix, L + 'they are the next six meetings, in date order', { shown, firstSix });
  ok(s.rows.every((x, i) => byId[ids[i]] && x.badge === byId[ids[i]].c), L + 'Cancelled badge on exactly the cancelled meetings', s.rows.map(x => x.badge));
  const more = s.text.match(/(\d+) more upcoming meeting/);
  ok(s.head != null && more && +more[1] === s.head - 6, L + 'remaining count = group count (' + s.head + ') minus 6', more && more[0]);
  ok(!/agenda/i.test(s.text) && !/development and environment items/i.test(s.page), L + 'no claim about agenda contents anywhere on the page');
  ok(errs.length === 0, L + 'no browser errors', errs);
  ok(bad.length === 0, L + 'no failed or 4xx/5xx requests', bad);
  ok(!s.over, L + 'no horizontal overflow (' + s.sw + ' vs ' + s.vw + ')');
  if (label === 'desktop') {
    const res = [];
    for (const x of s.rows) { const rr = await ctx.request.get(x.href, { timeout: 30000 }).catch(e => ({ status: () => 'ERR' })); res.push(rr.status()); }
    ok(res.every(c => c === 200), 'desktop: all six county links answer 200', res);
  }
  await ctx.close();
}
await browser.close();
console.log('FAILS: ' + fails);
process.exit(fails ? 1 : 0);
