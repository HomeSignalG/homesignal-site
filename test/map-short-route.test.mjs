// The short map address /map/<zip>/ (2026-10-21). Posts and e-mails show this link instead of the
// page file name. The generated document must forward to the one Map 1 page for that ZIP, keep the
// link's query (campaign tags) and hash, say noindex, and name no brand. 404.html covers a ZIP
// that has no generated document. Runs the real document script in a vm with a fake location.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

const py = spawnSync('python3', ['-c',
  "import sys; sys.path.insert(0,'scripts'); import gen_zip_pages as g; sys.stdout.write(g.render_map_route('06704'))"],
  { encoding: 'utf8' });
assert.equal(py.status, 0, py.stderr);
const doc = py.stdout;

function run(src, path, search, hash) {
  let went = null;
  const location = { pathname: path, search, hash, replace: (u) => { went = u; } };
  vm.runInNewContext(src, { location, window: { location } });
  return went;
}
const script = doc.match(/<script>([\s\S]*?)<\/script>/)[1];

// 1. forwards to Map 1 for this ZIP, keeping the query and hash
ok(run(script, '/map/06704/', '?utm_source=bluesky&utm_medium=social&utm_campaign=maps', '')
  === '/homesignalmap.html?zip=06704&utm_source=bluesky&utm_medium=social&utm_campaign=maps', 'query kept');
ok(run(script, '/map/06704/', '', '') === '/homesignalmap.html?zip=06704', 'bare link');
ok(run(script, '/map/06704/', '', '#x') === '/homesignalmap.html?zip=06704#x', 'hash kept');
// a query that tries another zip cannot change which map opens: the page reads the first zip=
ok(run(script, '/map/06704/', '?zip=99999', '').startsWith('/homesignalmap.html?zip=06704&'), 'own zip first');

// 2. not an indexable page, no brand word, no-JS fallback present
ok(/<meta name="robots" content="noindex, follow">/.test(doc), 'noindex');
ok(!/HomeSignal/.test(doc.replace(/homesignalmap\.html/g, '')), 'no brand word');
ok(/http-equiv="refresh" content="1; url=\/homesignalmap\.html\?zip=06704"/.test(doc), 'meta refresh');
ok(/<a href="\/homesignalmap\.html\?zip=06704">/.test(doc), 'visible link');

// 3. a non-ZIP is refused
const bad = spawnSync('python3', ['-c',
  "import sys; sys.path.insert(0,'scripts'); import gen_zip_pages as g; g.render_map_route('../x')"], { encoding: 'utf8' });
ok(bad.status !== 0, 'non-ZIP refused');

// 4. the build writes one route per community document, and the build gate checks it
const gen = readFileSync('scripts/gen_zip_pages.py', 'utf8');
ok(/nmap = build_map_routes\(pages, a\.out\)/.test(gen), 'build writes the routes');
ok(/if nmap != stats\["documents"\]:/.test(gen), 'count checked against documents');
const wf = readFileSync('.github/workflows/pages.yml', 'utf8');
ok(/p\.startswith\('map\/'\)/.test(wf), 'artifact audit allows map/');
ok(/test "\$MAPS" -eq "\$DOCS"/.test(wf), 'pages gate counts map routes');

// 5. 404.html forwards /map/<zip> with its query
const nf = readFileSync('404.html', 'utf8');
const nfScript = nf.match(/<script>([\s\S]*?)<\/script>/)[1];
ok(run(nfScript, '/map/84684', '?utm_source=bluesky', '') === '/homesignalmap.html?zip=84684&utm_source=bluesky', '404 map route');
ok(run(nfScript, '/map/84684/', '', '') === '/homesignalmap.html?zip=84684', '404 map route bare');
ok(run(nfScript, '/development/84302', '', '') === '/homesignalmap.html?zip=84302', '404 development route unchanged');

console.log(`map-short-route: ${pass} checks passed`);
