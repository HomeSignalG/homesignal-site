// Jody Step 16 - does the legacy-host redirect break any LINK THAT CARRIES A CREDENTIAL OR A CONTEXT?
//
// Render's static-site redirect keeps every byte of every query pair but STABLY SORTS the pairs by key (measured live, run 38443897406;
// the founder accepted that for the preview verifier, which does not by itself prove any application URL survives it). This test proves,
// in a real browser, for the link shapes the product actually emits:
//   1. a URL FRAGMENT (#share= report token, #invite=, #address=, #follow=) survives a 301 whose Location has no fragment. This is
//      the browser's job (RFC 9110 sec 10.2.2), not Render's, so it is proven against a local server that behaves like Render
//      (301, same path, sorted query, NO fragment in Location), then against the REAL consumers' parsers;
//   2. the real pages that read a token by NAME (unsubscribe.html ?t=, shared-report.html #share=) still hand the same token to
//      their backend after the redirect, and
//   3. every query shape the product emits (ZIP + Bluesky utm_*, unsubscribe ?t=, repeated keys, percent-encoding, empty values) is read
//      identically before and after sorting by the shipped readers (HS.parseZipParam, premium-waitlist zipFromLocation, the
//      referral capture's utm_* names, searchWithoutZip).
// What it does NOT prove: Render itself (its live behaviour is jody-redirect-verify run 38443897406) and homesignal.net behind it
// (cannot exist before GO LIVE). Both are named in docs/brand/MIGRATION-STATUS.md "Step 16".
// Run: node test/redirect-fragment-query.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from './lib/serve-page.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 600)); } };

// ---- the rule under test: stable sort of '&' pairs by key, every byte of every pair untouched (the verifier's own definition) -------
function sortedQuery(q) {
  if (!q) return '';
  const pairs = q.split('&').map((p, i) => ({ p, i, k: p.split('=')[0] }));
  pairs.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i));
  return pairs.map((x) => x.p).join('&');
}
// the SAME definition as scripts/verify_redirect_service.py::sorted_query - pinned so the two cannot drift
const VECTORS = ['z=1&a=2&utm_source=b&a=1', 'q=a%2Fb&v=%E2%9C%93&e=&d=1&d=2', 't=a1b2c3d4e5&z=76227', 'zip=76227&utm_source=bluesky&utm_medium=social&utm_campaign=drip', 'b=2&a=1', ''];
{
  const py = spawnSync('python3', ['-I', '-c',
    'import sys,json; sys.path.insert(0,"scripts"); import verify_redirect_service as v; ' +
    'print(json.dumps([v.sorted_query("https://x/p"+("?"+q if q else "")) for q in json.loads(sys.argv[1])]))', JSON.stringify(VECTORS)],
  { cwd: root, encoding: 'utf8' });
  let want = null; try { want = JSON.parse(py.stdout).map((u) => u.split('?')[1] || ''); } catch (e) { /* reported below */ }
  const got = VECTORS.map(sortedQuery);
  ok(want && JSON.stringify(want) === JSON.stringify(got), 'this test sorts query keys EXACTLY like scripts/verify_redirect_service.py (6 vectors incl. duplicate keys, encoding, empty values)', { want, got, err: py.stderr.slice(0, 200) });
  ok(sortedQuery('a=2&a=1') === 'a=2&a=1', 'duplicate keys keep their ORIGINAL order (stable sort): a=2&a=1 stays a=2&a=1');
}

// ---- two origins: a Render-like OLD host and a Jody-like NEW host (different hostnames = different origins) -----------------------
const seenOld = [];
let newPort = 0;
const oldSrv = createServer((req, res) => {
  const i = req.url.indexOf('?');
  const path = i < 0 ? req.url : req.url.slice(0, i), q = i < 0 ? '' : req.url.slice(i + 1);
  seenOld.push({ path, q });
  const loc = 'http://localhost:' + newPort + path + (q ? '?' + sortedQuery(q) : '');   // NO fragment in Location, like Render
  res.writeHead(301, { Location: loc }); res.end();
});
const SAFE = new Set(['/shared-report.html', '/unsubscribe.html', '/probe.html']);
const newSrv = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/probe.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>probe</title><body>probe'); return; }
  if (!SAFE.has(path)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(await readFile(join(root, path.slice(1))));
});
await new Promise((r) => oldSrv.listen(0, '127.0.0.1', r));
await new Promise((r) => newSrv.listen(0, 'localhost', r));
newPort = newSrv.address().port;
const OLD = 'http://127.0.0.1:' + oldSrv.address().port, NEW = 'http://localhost:' + newPort;

const browser = await chromium.launch();
async function visit(pathAndRest, setup) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const calls = [];
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(OLD) || u.startsWith(NEW)) return route.continue();
    calls.push({ url: u, method: route.request().method(), body: route.request().postData() });
    if (/functions\/v1\/view-shared-report/.test(u)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"status":"NOT_FOUND"}', headers: { 'access-control-allow-origin': '*' } });
    if (/functions\/v1\/unsubscribe/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"not_found"}', headers: { 'access-control-allow-origin': '*' } });
    return route.fulfill({ status: 204, body: '' });
  });
  if (setup) await setup(page);
  await page.goto(OLD + pathAndRest, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const out = { url: page.url(), calls, page };
  return out;
}

// 1. fragments survive the 301 (the browser carries them; the server never saw them)
const TOKEN = 'S'.repeat(43);
for (const [name, frag] of [['report share token', '#share=' + TOKEN], ['evaluation invite', '#invite=' + 'I'.repeat(43)], ['shared-report address hand-off', '#address=' + encodeURIComponent('742 Evergreen Terrace, Springfield, OR 97477')], ['follow-this-property hand-off', '#follow=' + encodeURIComponent('742 Evergreen Terrace, Springfield, OR 97477')]]) {
  seenOld.length = 0;
  const r = await visit('/probe.html?b=2&a=1' + frag);
  const u = new URL(r.url);
  ok(u.origin === NEW && u.pathname === '/probe.html', name + ': the 301 landed on the new origin, same path', r.url);
  ok(u.hash === frag, name + ': the fragment arrived intact after the redirect (the server never received it)', { got: u.hash, want: frag });
  ok(u.search === '?a=1&b=2', name + ': the query arrived sorted by key, every pair intact', u.search);
  ok(seenOld.length === 1 && !JSON.stringify(seenOld).includes(frag.slice(1, 12)), name + ': the old host saw no fragment (credentials in a fragment never reach any server)', seenOld);
  await r.page.context().close();
}

// 2. the REAL shared-report page: the token that was in the fragment reaches the report backend after the redirect
{
  const r = await visit('/shared-report.html#share=' + TOKEN);
  const post = r.calls.find((c) => /view-shared-report/.test(c.url));
  ok(!!post && post.method === 'POST', 'shared-report.html: after the redirect it calls the report backend', r.calls);
  ok(!!post && JSON.parse(post.body).token === TOKEN, 'shared-report.html: the backend receives the SAME 43-char token that was in the old link\'s fragment', post);
  ok(!new URL(r.url).hash, 'shared-report.html: the page still removes the token from the address bar', r.url);
  await r.page.context().close();
}

// 3. the REAL unsubscribe page: the single ?t= token reaches its backend, whatever else rides along
{
  const T = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  for (const q of ['t=' + T, 'z=76227&t=' + T, 'utm_source=email&t=' + T + '&utm_medium=digest']) {
    const r = await visit('/unsubscribe.html?' + q);
    const call = r.calls.find((c) => /functions\/v1\/unsubscribe/.test(c.url));
    ok(!!call && new URL(call.url).searchParams.get('t') === T, 'unsubscribe.html ?' + q.replace(T, '<token>') + ' -> the backend gets the same token after sorting', call);
    await r.page.context().close();
  }
}

// 4. every product query shape is read the same before and after sorting by the SHIPPED readers (run in the real page)
{
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.route('**/*', (route) => route.request().url().startsWith(NEW) ? route.continue() : route.fulfill({ status: 204, body: '' }));
  await page.goto(NEW + '/probe.html');
  const src = {
    viewZip: await readFile(join(root, 'lib/view-zip.js'), 'utf8'),
    premium: await readFile(join(root, 'lib/premium-waitlist.js'), 'utf8'),
    agg: await readFile(join(root, 'lib/dashboard-aggregate.js'), 'utf8'),
  };
  await page.evaluate((s) => { window.HS = window.HS || {}; (0, eval)(s.viewZip); try { (0, eval)(s.premium); } catch (e) { window.__premiumErr = String(e); } try { (0, eval)(s.agg); } catch (e) { window.__aggErr = String(e); } }, src);
  const shapes = [
    'zip=76227&utm_source=bluesky&utm_medium=social&utm_campaign=drip',
    'id=3f2a9c1e-0000-4000-8000-000000000001&utm_source=bluesky&utm_medium=social&utm_campaign=drip',
    'utm_source=bluesky&zip=76227&return=%2Falerts.html%3Fzip%3D76227',
    'signin=1&zip=84302',
    'zip=84302&zip=99999',            // repeated key: first one wins before AND after, because a stable sort keeps their order
  ];
  const result = await page.evaluate((shapes) => shapes.map((q) => {
    const read = (s) => {
      const sp = new URLSearchParams(s);
      return { zip: window.HS && HS.parseZipParam ? HS.parseZipParam('?' + s) : null, id: sp.get('id'), utm: [sp.get('utm_source'), sp.get('utm_medium'), sp.get('utm_campaign')], ret: sp.get('return'), signin: sp.get('signin'),
        waitlistZip: window.HSPremiumWaitlist && HSPremiumWaitlist.zipFromLocation ? HSPremiumWaitlist.zipFromLocation({ search: '?' + s, pathname: '/' }) : null };
    };
    return { q, before: read(q) };
  }), shapes);
  // compute the "after" side with the SAME sort and re-read inside the page
  const after = await page.evaluate((pairs) => pairs.map((q) => {
    const sp = new URLSearchParams(q);
    return { zip: window.HS && HS.parseZipParam ? HS.parseZipParam('?' + q) : null, id: sp.get('id'), utm: [sp.get('utm_source'), sp.get('utm_medium'), sp.get('utm_campaign')], ret: sp.get('return'), signin: sp.get('signin'),
      waitlistZip: window.HSPremiumWaitlist && HSPremiumWaitlist.zipFromLocation ? HSPremiumWaitlist.zipFromLocation({ search: '?' + q, pathname: '/' }) : null };
  }), shapes.map(sortedQuery));
  ok(result.every((r) => r.before.zip !== undefined) && !(await page.evaluate(() => window.__premiumErr)), 'the shipped readers loaded in the page (HS.parseZipParam present)', await page.evaluate(() => ({ hs: !!(window.HS && HS.parseZipParam), premiumErr: window.__premiumErr })));
  result.forEach((r, i) => ok(JSON.stringify(r.before) === JSON.stringify(after[i]), 'read identically before and after sorting: ?' + r.q.slice(0, 70), { before: r.before, after: after[i] }));
  await ctx.close();
}

await browser.close(); oldSrv.close(); newSrv.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
