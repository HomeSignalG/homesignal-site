// The development dossier page's header buttons (lib/dossier-header.js), in Chromium, with the page's
// real header (development_pages.SITE_HEADER), its header CSS and its script-src 'self' CSP.
// Founder, 2026-11-06: "where is share button and login in top right corner".
// Proves: signed out shows Share + Sign in (to the site sign-in, returning here), no avatar; a stored
// session shows the initials avatar (to My Places) instead of Sign in; Share copies the page link
// where there is no share sheet; without the script, Sign in still works and Share stays hidden.
//   Run: node test/dossier-header.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 400)); } };

const py = spawnSync('python3', ['-c', 'import sys,json; sys.path.insert(0,"scripts"); import development_pages as d; '
  + 'print(json.dumps({"h": d.SITE_HEADER.replace(d.RETURN_TOKEN, "%2Fdevelopment%2Fut%2Fx%2F"), "css": d.CHROME_CSS, "v": d.HEADER_JS_V}))'],
  { cwd: root, encoding: 'utf8' });
const { h, css, v } = JSON.parse(py.stdout);
const page = (withScript) => `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self';">
<link rel="canonical" href="https://jodytracks.com/development/ut/x/"><title>X dossier</title><style>${css}</style></head>
<body>${h}<main>page</main>${withScript ? `<script src="/lib/dossier-header.js?v=${v}" defer></script>` : ''}</body></html>`;
const JS = readFileSync(join(root, 'lib', 'dossier-header.js'), 'utf8');
const srv = createServer((req, res) => {
  if (req.url.startsWith('/lib/dossier-header.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(JS); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(!req.url.includes('noscript')));
});
await new Promise(r => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const vis = (sel) => p.locator(sel).isVisible();

// 1. Signed out.
await p.goto(base + '/development/ut/x/'); await p.waitForLoadState('load');
ok(await vis('#hs-share'), 'signed out: Share is shown');
ok(await vis('#hs-signin'), 'signed out: Sign in is shown');
ok(!(await vis('#hs-avatar')), 'signed out: no avatar');
ok(await p.getAttribute('#hs-signin', 'href') === '/?signin=1&return=%2Fdevelopment%2Fut%2Fx%2F', 'Sign in goes to the site sign-in and returns here');
const box = await p.locator('#hs-share').boundingBox(), sbox = await p.locator('#hs-signin').boundingBox();
ok(box && sbox && box.x > 640 && sbox.x > box.x && box.y < 80, 'Share and Sign in sit at the top right', { box, sbox });

// 2. Share copies the link where there is no share sheet.
await p.evaluate(() => { try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch (e) {} });
await p.click('#hs-share');
await p.waitForFunction(() => document.getElementById('hs-share').textContent === 'Link copied');
ok(await p.evaluate(() => navigator.clipboard.readText()) === 'https://jodytracks.com/development/ut/x/', 'Share copied the page link');

// 3. Signed in (a stored session in this browser).
await p.evaluate(() => localStorage.setItem('sb-qwnnmljucajnexpxdgxr-auth-token',
  JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id: 'u1', email: 'jane@example.com' } })));
await p.reload(); await p.waitForLoadState('load');
ok(await vis('#hs-avatar') && !(await vis('#hs-signin')), 'signed in: avatar instead of Sign in');
ok((await p.textContent('#hs-avatar')).trim() === 'JA', 'the avatar shows the initials, as the site does');
ok(await p.getAttribute('#hs-avatar', 'href') === '/properties.html', 'the avatar opens My Places');

// 4. A broken session entry reads as signed out.
await p.evaluate(() => localStorage.setItem('sb-qwnnmljucajnexpxdgxr-auth-token', '{not json'));
await p.reload(); await p.waitForLoadState('load');
ok(await vis('#hs-signin') && !(await vis('#hs-avatar')), 'an unreadable session entry reads as signed out');

// 5. Without the script.
await p.evaluate(() => localStorage.clear());
await p.goto(base + '/noscript'); await p.waitForLoadState('load');
ok(!(await vis('#hs-share')) && await vis('#hs-signin') && !(await vis('#hs-avatar')), 'without the script: Sign in works, Share stays hidden');

// 6. Narrow screen: the menu still opens.
await p.setViewportSize({ width: 390, height: 800 });
await p.goto(base + '/development/ut/x/'); await p.waitForLoadState('load');
ok(await vis('#hs-signin') && await vis('.hs-header__menu'), 'phone: Sign in and Menu are shown');
await p.click('.hs-header__menu');
ok(await vis('.hs-nav'), 'phone: Menu opens the nav');

ok(errors.length === 0, 'no page errors or CSP violations', errors);
await browser.close(); srv.close();
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
