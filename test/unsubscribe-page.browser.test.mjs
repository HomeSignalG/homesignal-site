// homesignal.net/unsubscribe, driven in a real browser: what the page SHOWS for each answer
// the unsubscribe function can give. The function is replaced by a route that fulfils the
// fetch, so the test decides the answer and asserts the rendered title, paragraphs and link.
//
// The founder's Development-alerts text (2026-09-26) appears only for status unsubscribed +
// maps_only === true + a 5-digit ZIP; everything else keeps the general page.
// Run: node test/unsubscribe-page.browser.test.mjs   (needs playwright; reported in CI's browser job)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { FOUNDER_TITLE, FOUNDER_LINES, FOUNDER_CTA, GENERAL_TITLE, GENERAL_TEXT } from './lib/unsubscribe-founder-copy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': 'text/html' }).end(await readFile(p)); }
  catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const FN = 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/unsubscribe';

const browser = await chromium.launch();

// Load the page with ?t=<token>, answer the function call with `answer`, read what renders.
async function render(answer, { token = 'tok', width = 1280 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  let asked = null;
  await page.route(FN + '*', async (route) => {
    asked = route.request().url();
    if (answer === 'http500') return route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) });
  });
  await page.goto(base + '/unsubscribe.html' + (token === null ? '' : '?t=' + encodeURIComponent(token)));
  await page.waitForFunction(() => document.getElementById('title').textContent !== 'One moment…');
  const out = await page.evaluate(() => ({
    title: document.getElementById('title').textContent,
    paras: [...document.querySelectorAll('#msg p')].map(p => p.textContent),
    msg: document.getElementById('msg').textContent,
    cta: document.getElementById('cta').textContent,
    href: document.getElementById('cta').getAttribute('href'),
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    injected: !!document.querySelector('#msg img, #msg script, #title *'),
  }));
  await page.close();
  return { ...out, asked };
}

// 1. A map sign-up: the founder's text, in order, and the map link.
const m = await render({ status: 'unsubscribed', maps_only: true, zip: '97702' }, { token: 'a b/c' });
ok(m.title === FOUNDER_TITLE, '1 title', m.title);
ok(JSON.stringify(m.paras) === JSON.stringify(FOUNDER_LINES('97702')), '1 the three lines, verbatim and in order', m.paras);
ok(m.cta === FOUNDER_CTA('97702'), '1 link text', m.cta);
ok(m.href === 'https://homesignal.net/homesignalmap.html?zip=97702', '1 link opens Map 1 for the ZIP', m.href);
ok(m.asked === FN + '?t=a%20b%2Fc', '1 the token is sent encoded', m.asked);
ok(!m.overflow, '1 no sideways scroll at 1280px');
const phone = await render({ status: 'unsubscribed', maps_only: true, zip: '97702' }, { width: 390 });
ok(phone.title === FOUNDER_TITLE && !phone.overflow, '1b same page on a phone, no sideways scroll', phone.overflow);

// 2. Any other identity: the general page, unchanged.
for (const [name, answer] of [
  ['2a no maps_only', { status: 'unsubscribed' }],
  ['2b maps_only as a string', { status: 'unsubscribed', maps_only: 'true', zip: '97702' }],
  ['2c maps_only with no ZIP', { status: 'unsubscribed', maps_only: true }],
  ['2d a ZIP that is not 5 digits', { status: 'unsubscribed', maps_only: true, zip: '9770' }],
]) {
  const g = await render(answer);
  ok(g.title === GENERAL_TITLE && g.msg === GENERAL_TEXT && g.paras.length === 0, name + ': general text', g);
  ok(g.cta === 'Go to HomeSignal' && g.href === 'https://homesignal.net', name + ': general link', [g.cta, g.href]);
}

// 3. Markup in an answer is never rendered as markup.
const x = await render({ status: 'unsubscribed', maps_only: true, zip: '<img src=x onerror=alert(1)>' });
ok(x.title === GENERAL_TITLE && !x.injected, '3 markup in the ZIP is refused, not rendered', x);

// 4. The other statuses win over maps_only, and a failure is a failure.
const nf = await render({ status: 'not_found', maps_only: true, zip: '97702' });
ok(nf.title === 'Link not recognized', '4a not_found stays not_found', nf.title);
const er = await render('http500');
ok(er.title === 'Something went wrong', '4b a non-JSON 500 is an error', er.title);
const mt = await render(null, { token: null });
ok(mt.title === 'Invalid link' && mt.asked === null, '4c no token: no call, invalid link', mt);

await browser.close();
server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
