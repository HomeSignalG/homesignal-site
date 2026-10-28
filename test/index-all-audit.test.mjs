// INDEX-ALL AUDIT: the shipped audit passes a clean artifact and fails each violation class.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };
const audit = (d) => spawnSync('python3', [join(root, 'scripts', 'audit_index_all.py'), '--dir', d], { encoding: 'utf8' });
const page = (robots, canon) => `<!doctype html><html><head><title>t</title>${robots ? `<meta name="robots" content="${robots}">` : ''}${canon ? `<link rel="canonical" href="${canon}">` : ''}</head><body></body></html>`;

function build(over = {}) {
  const d = mkdtempSync(join(tmpdir(), 'idxall-'));
  mkdirSync(join(d, 'community', '98401'), { recursive: true });
  mkdirSync(join(d, 'sitemaps'), { recursive: true });
  writeFileSync(join(d, 'community', '98401', 'index.html'), over.page ?? page('index, follow', 'https://jodytracks.com/community/98401/'));
  writeFileSync(join(d, 'robots.txt'), over.robots ?? 'User-agent: *\nDisallow: /dashboard.html\nSitemap: https://jodytracks.com/sitemap.xml\n');
  writeFileSync(join(d, 'sitemap.xml'), over.sitemap ?? '<urlset><url><loc>https://jodytracks.com/community/98401/</loc></url></urlset>');
  return d;
}
const cases = [];
let d = build(); let r = audit(d);
ok(r.status === 0 && /PASSED/.test(r.stdout), 'clean artifact passes');
rmSync(d, { recursive: true });
d = build({ page: page('noindex, follow', 'https://jodytracks.com/community/98401/') }); r = audit(d);
ok(r.status === 1 && /noindex directive/.test(r.stdout), 'public noindex fails');
rmSync(d, { recursive: true });
d = build({ page: page('index, follow', 'https://jodytracks.com/other/') }); r = audit(d);
ok(r.status === 1 && /canonical is not itself/.test(r.stdout), 'non-self canonical fails');
rmSync(d, { recursive: true });
d = build({ sitemap: '<urlset><url><loc>https://jodytracks.com/x/</loc></url></urlset>' }); r = audit(d);
ok(r.status === 1 && /in no sitemap/.test(r.stdout), 'page missing from sitemap fails');
rmSync(d, { recursive: true });
d = build({ robots: 'User-agent: *\nDisallow: /community/\nSitemap: https://jodytracks.com/sitemap.xml\n' }); r = audit(d);
ok(r.status === 1, 'sitemap URL blocked by robots.txt fails');
rmSync(d, { recursive: true });
r = audit(join(tmpdir(), 'no-such-dir-idxall'));
ok(r.status === 2, 'missing artifact exits 2 (cannot run), not pass');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
