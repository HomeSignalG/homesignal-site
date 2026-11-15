// THE BUILD-TIME PAGE BLOCK (#hs-ssr) MUST BE STYLED (founder report, 2026-11-15).
// Every generated ZIP, city, project-list, project and guide document carries a <main id="hs-ssr">
// block, and no stylesheet had a rule for it. It rendered at browser defaults, flush against the
// window's left edge: on every ZIP page until the app loaded, permanently on the 155 ZIPs whose
// app keeps the block (data_quality coverage_coming, measured 2026-11-15), and on every guide/city/
// project page, which ship no script. Inline ".quiet" counts drew as dashed panels over the text.
//
// This builds the SHIPPED generator over the committed fixture and renders each document with
// JavaScript OFF (what a visitor sees before the app loads, and all a script-free page ever shows).
// Run: node test/ssr-block-styled.browser.test.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (d !== undefined) console.log('    detail: ' + JSON.stringify(d)); } };

const out = mkdtempSync(join(tmpdir(), 'ssr-'));
writeFileSync(join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
execFileSync('python3', [join(root, 'scripts', 'gen_zip_pages.py'), '--fixture', join(root, 'test', 'fixtures', 'zip-pages.json'),
  '--out', out, '--now', '2026-09-04T00:00:00'], { encoding: 'utf8' });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  for (const p of rel.endsWith('/') ? [join(out, rel, 'index.html')] : [join(out, rel), join(root, rel)]) {
    if (!normalize(p).startsWith(out) && !normalize(p).startsWith(root)) continue;
    let body; try { body = readFileSync(p); } catch { continue; }
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body); return;
  }
  res.writeHead(404).end('not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const docs = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === 'index.html') docs.push('/' + p.slice(out.length + 1).replace(/index\.html$/, '')); } })(out);

const browser = await chromium.launch();
let checked = 0;
const kinds = new Set();
for (const [w, h] of [[1280, 900], [390, 844]]) {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: w, height: h } });
  for (const u of docs) {
    const pg = await ctx.newPage();
    await pg.goto(base + u);
    const r = await pg.evaluate(() => {
      const m = document.getElementById('hs-ssr'); if (!m) return null;
      const cs = getComputedStyle(m), h1 = m.querySelector('h1');
      const inlineQuiet = [...m.querySelectorAll('li .quiet, span.quiet')];
      return {
        padL: parseFloat(cs.paddingLeft), maxW: cs.maxWidth,
        h1: h1 ? parseFloat(getComputedStyle(h1).fontSize) : null,
        quiet: inlineQuiet.length,
        boxedQuiet: inlineQuiet.filter((e) => { const s = getComputedStyle(e); return s.borderStyle !== 'none' || s.display === 'block'; }).length,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    await pg.close();
    if (!r) continue;
    checked++; kinds.add(u.split('/')[1] || 'root');
    const tag = `${u} @${w}px`;
    ok(r.padL >= 16, `${tag}: the block has the site gutter (left padding ${r.padL}px, not 0)`, r);
    ok(r.maxW !== 'none', `${tag}: the block is held to the site's reading width`, r);
    ok(r.h1 !== null && r.h1 <= 30, `${tag}: the heading uses the site size, not the 32px browser default`, r);
    ok(r.boxedQuiet === 0, `${tag}: an inline count (.quiet) is plain text, not a dashed panel (${r.quiet} checked)`, r);
    ok(r.overflow <= 0, `${tag}: no sideways scrolling`, r);
  }
  await ctx.close();
}
await browser.close(); server.close(); rmSync(out, { recursive: true, force: true });
ok(checked >= 10, `control: ${checked} document renders carried #hs-ssr (kinds: ${[...kinds].join(', ')})`);
ok(kinds.has('community') && kinds.has('guides'), 'control: both ZIP pages and guide pages were rendered');
console.log(fails ? `FAILS: ${fails}` : 'All #hs-ssr styling assertions passed.');
process.exit(fails ? 1 : 0);
