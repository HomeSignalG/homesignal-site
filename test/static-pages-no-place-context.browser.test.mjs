// Static legal/support pages never show the "Viewing · <address>" context line (2026-10-09).
// A signed-in resident's saved address was drawn under the Privacy / Terms / Refund Policy
// headings by the shared HS.paintWhereLine. The fix is a page-type declaration read by that
// one injector. Positive control: the SAME page with the declaration removed DOES draw the
// line, so a pass is not an injector that never runs.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
let chromium;
try { ({ chromium } = await import('playwright')); } catch (e) {
  console.log('SKIP static-pages-no-place-context.browser.test.mjs — playwright not installed'); process.exit(0);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, n, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 300)); } };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(readFileSync(p)); }
  catch { res.writeHead(404).end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('**/cdn.jsdelivr.net/**', (r) => r.abort());
const SAVED = { id: 'p1', address: '20 N MAIN ST', zip: '', lat: 1, lng: 1 };
const probe = () => page.evaluate(async (saved) => {
  const slot = document.getElementById('hs-slot');
  // a saved real home in the viewed ZIP: exactly the state that leaked the address
  saved.zip = window.HS.state ? window.HS.state.zip : '';
  window.HS.realHome = function () { return { id: 'p1', address: '20 N MAIN ST', zip: saved.zip }; };
  window.HS.homeAddressLine = function (p) { return p.address; };
  await window.HS.paintWhereLine();
  const el = document.getElementById('phWhere');
  return { line: el && el.style.display !== 'none' ? el.textContent : '', anyViewing: /Viewing\s*·/.test(slot.textContent), ph: !!slot.querySelector('.ph') };
}, SAVED);
for (const f of ['privacy.html', 'terms.html', 'refund-policy.html', 'about.html', 'contact.html', 'how-it-works.html']) {
  await page.goto(base + '/' + f, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#hs-slot .ph', { timeout: 15000 });
  await page.waitForTimeout(500);
  const r = await probe();
  ok(r.ph && r.line === '' && !r.anyViewing, f + ': no Viewing/address line under the heading', r);
}
// positive control: strip the declaration and the line appears
await page.goto(base + '/terms.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#hs-slot .ph', { timeout: 15000 });
await page.evaluate(() => { delete document.body.dataset.pageType; });
const c = await probe();
ok(/Viewing · 20 N MAIN ST/.test(c.line), 'control: without the page type the same injector DOES draw the address line', c);
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
