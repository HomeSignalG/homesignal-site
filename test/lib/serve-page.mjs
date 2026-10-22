// A local page server for the browser suites reads the site's HTML through this readFile.
//
// WHY. Every page loads supabase-js from the CDN pinned to one exact version WITH an integrity hash (audit item,
// 2026-10-08: "lock every page to one exact, checked version"). The browser suites replace that CDN request with a stand-in
// (page.route ... route.fulfill), and a stand-in cannot match the real file's hash, so the browser would refuse it. This
// strips the integrity attribute from that ONE script tag, and only when a test serves the page to itself. The shipped
// files are untouched, and test/supabase-js-pin.test.mjs pins that every shipped page carries the exact version and hash.
import { readFile as rf } from 'node:fs/promises';
import { readFileSync as rfs } from 'node:fs';

const SRI = /(<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[0-9.]+") integrity="[^"]*" crossorigin="anonymous"(><\/script>)/g;

export async function readFile(p, ...rest) {
  const out = await rf(p, ...rest);
  if (typeof p !== 'string' || !p.endsWith('.html')) return out;
  const text = Buffer.isBuffer(out) ? out.toString('utf8') : out;
  const stripped = text.replace(SRI, '$1$2');
  return Buffer.isBuffer(out) ? Buffer.from(stripped, 'utf8') : stripped;
}

// The same for a suite that serves its pages with the synchronous reader.
export function readFileSync(p, ...rest) {
  const out = rfs(p, ...rest);
  if (typeof p !== 'string' || !p.endsWith('.html')) return out;
  const text = Buffer.isBuffer(out) ? out.toString('utf8') : out;
  const stripped = text.replace(SRI, '$1$2');
  return Buffer.isBuffer(out) ? Buffer.from(stripped, 'utf8') : stripped;
}

// THE SHORT MAP ADDRESS (founder, 2026-10-22). Map 1 shows /map/<zip> in the address bar, so a
// reload, Back or Forward asks the server for that path. On GitHub Pages /map/<zip> 301s to
// /map/<zip>/ (query kept) and that is the document scripts/gen_zip_pages.py::render_map_route
// writes. A test server answers the same way: mapRoute(req.url) -> {status, headers, body} or null.
import { spawnSync } from 'node:child_process';
import { dirname as _dirname, join as _join } from 'node:path';
import { fileURLToPath as _f2p } from 'node:url';
const _REPO = _join(_dirname(_f2p(import.meta.url)), '..', '..');
const _forward = {};
export function mapRoute(url) {
  const [path, qs] = String(url).split('?');
  let m = path.match(/^\/map\/(\d{5})$/);
  if (m) return { status: 301, headers: { Location: '/map/' + m[1] + '/' + (qs ? '?' + qs : '') }, body: '' };
  m = path.match(/^\/map\/(\d{5})\/$/);
  if (!m) return null;
  if (!_forward[m[1]]) {
    const r = spawnSync('python3', ['-I', '-c', 'import sys; sys.path.insert(0,"scripts"); import gen_zip_pages as g; sys.stdout.write(g.render_map_route(sys.argv[1]))', m[1]], { cwd: _REPO, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('render_map_route failed: ' + r.stderr);
    _forward[m[1]] = r.stdout;
  }
  return { status: 200, headers: { 'Content-Type': 'text/html' }, body: _forward[m[1]] };
}
