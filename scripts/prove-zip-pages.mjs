// CANDIDATE CRAWLER PROOF — runs against the built _site artifact over a local static
// server, so it proves the INITIAL HTTP RESPONSE contract before any deployment exists.
//
// It asserts the two things a post-JS DOM check cannot: that the bytes a crawler receives
// already carry the SEO contract, and that executing JavaScript does not reverse it.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const SITE = process.env.SITE_DIR || '_site';
const PORT = 8099;
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
                '.json':'application/json', '.xml':'application/xml' };
const UA_MOB = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const UA_DESK = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(SITE, p);
  try {
    if (!(await stat(f)).isFile()) throw new Error('dir');
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1>'); }
});

const grab = (h, re) => { const m = re.exec(h); return m ? m[1].trim() : null; };

const main = async () => {
  await new Promise((r) => server.listen(PORT, r));
  const base = `http://127.0.0.1:${PORT}`;
  const controls = JSON.parse(process.env.CONTROLS || '{}');
  const { pass_zip: P, fail_zip: F } = controls;
  if (!P || !F) throw new Error('CONTROLS must supply pass_zip and fail_zip');

  // ---- initial HTTP response, three user agents -----------------------------------------
  const seen = {};
  for (const [label, ua] of [['normal', null], ['gbot-mobile', UA_MOB], ['gbot-desktop', UA_DESK]]) {
    for (const z of [P, F]) {
      const r = await fetch(`${base}/community/${z}/`, { headers: ua ? { 'User-Agent': ua } : {} });
      const h = await r.text();
      seen[`${label}:${z}`] = h;
      if (label === 'normal') {
        const wantIdx = z === P;
        ok(r.status === 200, `[${z}] initial response is HTTP 200`);
        ok(h.includes(`content="${wantIdx ? 'index, follow' : 'noindex, follow'}"`),
           `[${z}] initial HTML carries ${wantIdx ? 'index, follow' : 'noindex, follow'}`);
        ok(grab(h, /<link rel="canonical" href="([^"]+)"/) === `https://homesignal.net/community/${z}/`,
           `[${z}] canonical is the ZIP path`);
        ok((grab(h, /<title>([^<]+)<\/title>/) || '').includes(z) ||
           (grab(h, /<h1>([^<]+)<\/h1>/) || '').includes(z), `[${z}] title/H1 carry the ZIP identity`);
        ok(/<h1>[^<]*\d{5}[^<]*<\/h1>/.test(h), `[${z}] ZIP-specific H1 present`);
        ok(/<meta name="description" content="[^"]{40,}"/.test(h), `[${z}] meta description present`);
        ok(!/distance_mi|data-home|\bmi<\/|home_lat|centroid/.test(h),
           `[${z}] no distance/HOME/centroid anywhere in the initial HTML`);
        if (wantIdx) ok(/<section class="zsec"><h2>[^<]+<\/h2><ul>/.test(h),
           `[${z}] initial HTML contains actual Alerts items`);
      }
    }
  }
  ok(seen[`normal:${P}`] === seen[`gbot-mobile:${P}`] && seen[`normal:${P}`] === seen[`gbot-desktop:${P}`],
     'Googlebot smartphone and desktop receive byte-identical HTML — no cloaking');
  ok(seen[`normal:${P}`] !== seen[`normal:${F}`], 'two ZIPs return different documents');

  // ---- unknown / non-canonical ZIP -------------------------------------------------------
  const bad = await fetch(`${base}/community/00000/`);
  ok(bad.status === 404, 'a non-canonical ZIP path is not a page (404, never an indexable shell)');

  // ---- JavaScript must not reverse the build-time decision -------------------------------
  const browser = await chromium.launch();
  for (const z of [P, F]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`${base}/community/${z}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => ({
      robots: (document.querySelector('meta[name=robots]') || {}).content || null,
      canonical: (document.querySelector('link[rel=canonical]') || {}).href || null,
      h1: (document.querySelector('h1') || {}).textContent || null,
    }));
    const want = z === P ? 'index, follow' : 'noindex, follow';
    ok(after.robots === want, `[${z}] robots is STILL "${want}" after JavaScript executes`);
    ok((after.canonical || '').endsWith(`/community/${z}/`), `[${z}] canonical survives hydration`);
    ok((after.h1 || '').includes(z), `[${z}] ZIP identity survives hydration`);
    ok(errs.length === 0, `[${z}] no uncaught page errors during hydration (${errs.slice(0,1)})`);
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
};
main().catch((e) => { console.error(e); process.exit(1); });
