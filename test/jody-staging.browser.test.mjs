// Jody migration, Step 3: a real browser loads the STAGED Jody tree (never deployed) and sees Jody.
// Run: node test/jody-staging.browser.test.mjs   (stages + overlays a temp copy; SKIPs without playwright)
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';

let chromium;
try { ({ chromium } = await import('playwright')); } catch { console.log('SKIP jody-staging.browser.test.mjs — playwright not installed'); process.exit(0); }

let failures = 0;
const check = (n, ok, why) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` — ${why}`}`); if (!ok) failures++; };

const jodyRoot = mkdtempSync(join(tmpdir(), 'jody-stage-'));
const root = jodyRoot;
const baseRoot = mkdtempSync(join(tmpdir(), 'hs-stage-'));
execFileSync('python3', ['scripts/stage_site.py', '--src', '.', '--out', root], { stdio: 'pipe' });
execFileSync('python3', ['scripts/stage_site.py', '--src', '.', '--out', baseRoot], { stdio: 'pipe' });
execFileSync('python3', ['scripts/brand_stage.py', '--dir', root, '--identity', 'jody', '--staging'], { stdio: 'pipe' });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain' };
async function serve(dir) {
  const server = createServer((req, res) => {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p.endsWith('/')) p += 'index.html';
    const f = join(dir, p);
    if (!f.startsWith(dir) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const J = await serve(jodyRoot), B = await serve(baseRoot);
const base = J.base;

const exe = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
// Third-party and database calls are not what this test is about; refuse them so nothing leaves the machine.
await page.route((u) => !u.href.startsWith(J.base) && !u.href.startsWith(B.base), (r) => r.abort());
let pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const PATHS = ['/index.html', '/about.html', '/contact.html'];
// Baseline: the same pages from the UNREWRITTEN tree. With the CDN refused both trees throw the same offline
// errors; the rewrite may not add one.
for (const path of PATHS) { await page.goto(B.base + path, { waitUntil: 'load' }); await page.waitForTimeout(600); }
const baselineErrors = new Set(pageErrors); pageErrors = [];

for (const path of PATHS) {
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const t = await page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText,
    canonical: (document.querySelector('link[rel=canonical]') || {}).href || '',
    robots: (document.querySelector('meta[name=robots]') || {}).content || '',
  }));
  check(`${path} title says Jody`, /Jody/.test(t.title) && !/HomeSignal/.test(t.title), t.title);
  check(`${path} no visible "HomeSignal" in the rendered page`, !/HomeSignal/.test(t.text), (t.text.match(/.{0,30}HomeSignal.{0,30}/) || [''])[0]);
  check(`${path} canonical is the Jody origin`, t.canonical.startsWith('https://jodytracks.com/'), t.canonical);
  check(`${path} is noindex`, /noindex/.test(t.robots), t.robots);
}
await page.goto(base + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(600);
const foot = await page.evaluate(() => (document.querySelector('.hs-footer__tagline') || {}).innerText || '');
check('the footer tagline renders', foot === 'Know what’s coming.', JSON.stringify(foot));
check('the home page title carries the tagline', /Know what’s coming\./.test(await page.title()), await page.title());
const added = pageErrors.filter((e) => !baselineErrors.has(e));
check('the rewrite adds no uncaught page error (same pages, unrewritten tree as baseline)', added.length === 0, added.slice(0, 2).join(' | '));
check('the baseline run really loaded the pages (control)', PATHS.length === 3 && B.base !== J.base, 'ports');

await browser.close(); J.server.close(); B.server.close(); rmSync(baseRoot, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
