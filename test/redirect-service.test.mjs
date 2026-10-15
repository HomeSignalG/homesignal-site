// Jody migration, Step 5: the zero-cost redirect service for the old host. Run: node test/redirect-service.test.mjs
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let failures = 0;
const check = (n, ok, why) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` — ${why}`}`); if (!ok) failures++; };
const py = (args) => spawnSync('python3', args, { encoding: 'utf8' });

const base = mkdtempSync(join(tmpdir(), 'redir-'));
const D = join(base, 'site');
const b = py(['scripts/build_redirect_site.py', '--out', D]);
check('1a the redirect site builds', b.status === 0, b.stderr);
const files = readdirSync(D, { recursive: true }).filter((f) => !readdirSync(join(D), { withFileTypes: true }).some((e) => e.name === f && e.isDirectory()));
check('1b it holds exactly the expected files', JSON.stringify(readdirSync(D).sort()) === JSON.stringify(['.well-known', '_redirects', 'google59e1ae3ef6b75e3a.html', 'netlify.toml', 'robots.txt']), readdirSync(D).join());
check('1c did.json is byte-identical to the repo file (the immutable Bluesky identity)', readFileSync(join(D, '.well-known/did.json')).equals(readFileSync('.well-known/did.json')), 'differs');
check('1d the DID still names the OLD host (did:web:homesignal.net must keep resolving there)', /"id": "did:web:homesignal\.net"/.test(readFileSync(join(D, '.well-known/did.json'), 'utf8')), 'did');
check('1e the Google ownership file is byte-identical', readFileSync(join(D, 'google59e1ae3ef6b75e3a.html')).equals(readFileSync('google59e1ae3ef6b75e3a.html')), 'differs');
check('1f robots.txt is permissive and lists no sitemap', readFileSync(join(D, 'robots.txt'), 'utf8') === 'User-agent: *\nAllow: /\n', 'robots');
const rules = readFileSync(join(D, '_redirects'), 'utf8');
check('1g the destination is the contract\'s Jody origin and it is the ONLY redirect target', /\/\*  https:\/\/jodytracks\.com\/:splat  301!/.test(rules) && (rules.match(/https:\/\/[^\s/]+/g) || []).every((u) => u === 'https://jodytracks.com'), rules);
check('1h --check passes on a fresh build and is deterministic', py(['scripts/build_redirect_site.py', '--out', D, '--check']).status === 0, 'drift');

const sim = py(['scripts/verify_redirect_service.py', '--simulate', D]);
check('2a the rules answer every case correctly (13 paths: pages, queries, sitemaps, unknown, DID, robots)', sim.status === 0 && JSON.parse(sim.stdout).cases >= 13, sim.stdout);

// negative controls on the folder
function mutated(name, fn, expectCheckFails = true) {
  const M = join(base, 'm-' + name); cpSync(D, M, { recursive: true }); fn(M);
  const s = py(['scripts/verify_redirect_service.py', '--simulate', M]);
  const c = py(['scripts/build_redirect_site.py', '--out', M, '--check']);
  check(`3 ${name}: caught by the verifier or the drift check`, s.status !== 0 || c.status !== 0, 'passed both');
}
mutated('catch-all moved first', (M) => { const t = readFileSync(join(M, '_redirects'), 'utf8').split('\n'); const i = t.findIndex((l) => l.startsWith('/*')); const [c] = t.splice(i, 1); t.splice(1, 0, c); writeFileSync(join(M, '_redirects'), t.join('\n')); });
mutated('did.json rule dropped', (M) => writeFileSync(join(M, '_redirects'), readFileSync(join(M, '_redirects'), 'utf8').replace(/^\/\.well-known\/did\.json.*\n/m, '')));
mutated('redirect made temporary (302)', (M) => writeFileSync(join(M, '_redirects'), readFileSync(join(M, '_redirects'), 'utf8').replace('301!', '302!')));
mutated('wrong destination host', (M) => writeFileSync(join(M, '_redirects'), readFileSync(join(M, '_redirects'), 'utf8').replace('jodytracks.com', 'jodytracks.net')));
mutated('splat dropped (everything lands on the home page)', (M) => writeFileSync(join(M, '_redirects'), readFileSync(join(M, '_redirects'), 'utf8').replace('/:splat', '/')));
mutated('did.json edited', (M) => writeFileSync(join(M, '.well-known/did.json'), readFileSync(join(M, '.well-known/did.json'), 'utf8').replace('homesignal.net', 'jodytracks.com')));
mutated('robots.txt gains a sitemap line', (M) => writeFileSync(join(M, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://homesignal.net/sitemap.xml\n'));
mutated('an extra file appears', (M) => writeFileSync(join(M, 'index.html'), '<html></html>'));

// 4. the LIVE probe, against a local stand-in that behaves per the rules (and variants that must fail)
function serve(handlerFor) {
  const s = createServer((req, res) => handlerFor(req, res));
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, url: `http://127.0.0.1:${s.address().port}` })));
}
const did = readFileSync(join(D, '.well-known/did.json'));
const good = (status = 301, didBody = did) => (req, res) => {
  if (req.url === '/.well-known/did.json') { res.writeHead(200); res.end(didBody); return; }
  if (req.url === '/robots.txt') { res.writeHead(200); res.end(readFileSync(join(D, 'robots.txt'))); return; }
  if (req.url === '/google59e1ae3ef6b75e3a.html') { res.writeHead(200); res.end(readFileSync(join(D, 'google59e1ae3ef6b75e3a.html'))); return; }
  res.writeHead(status, { Location: 'https://jodytracks.com' + req.url }); res.end();
};
// ASYNC spawn: the stand-in server lives in THIS process, so a blocking spawnSync would starve it (and make every probe fail).
const probe = (url) => new Promise((r) => {
  const p = spawn('python3', ['scripts/verify_redirect_service.py', '--base', url, '--files', D]);
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => r({ status: code, stdout: out }));
});
for (const [name, h, want] of [
  ['a correct service', good(), true],
  ['a service answering 302', good(302), false],
  ['a service serving the wrong DID bytes', good(301, Buffer.from('{}')), false],
  ['a service that drops the query string', (req, res) => { if (req.url === '/.well-known/did.json' || req.url === '/robots.txt' || req.url === '/google59e1ae3ef6b75e3a.html') return good()(req, res); res.writeHead(301, { Location: 'https://jodytracks.com' + req.url.split('?')[0] }); res.end(); }, false],
  ['a service that redirects the DID document too', (req, res) => { res.writeHead(301, { Location: 'https://jodytracks.com' + req.url }); res.end(); }, false],
]) {
  const { s, url } = await serve(h);
  const r = await probe(url);
  s.close();
  check(`4 live probe: ${name} ${want ? 'passes' : 'is refused'}`, (r.status === 0) === want, r.stdout.slice(0, 300));
}


// 5. Render adapter (the Netlify account is unavailable): same builder, same cases, same live probe - provider-specific rules only
const R = join(base, 'render');
const rb = py(['scripts/build_redirect_site.py', '--out', R, '--provider', 'render']);
check('5a the Render folder builds', rb.status === 0, rb.stderr);
const rfiles = readdirSync(R, { recursive: true }).filter((f) => !f.endsWith('.well-known') && !f.endsWith('public')).sort();
check('5b it holds exactly render.yaml + public/{did.json, google token, robots.txt} and no _redirects/netlify.toml/index.html', JSON.stringify(rfiles) === JSON.stringify(['public/.well-known/did.json', 'public/google59e1ae3ef6b75e3a.html', 'public/robots.txt', 'render.yaml']), rfiles.join());
check('5c did.json and the Google file are byte-identical to the repo files', readFileSync(join(R, 'public/.well-known/did.json')).equals(readFileSync('.well-known/did.json')) && readFileSync(join(R, 'public/google59e1ae3ef6b75e3a.html')).equals(readFileSync('google59e1ae3ef6b75e3a.html')), 'differs');
const ry = readFileSync(join(R, 'render.yaml'), 'utf8');
check('5d ONE permanent redirect route /* -> the contract origin, free static site, blueprint kept OUTSIDE the publish dir', /type: redirect\n\s+source: \/\*\n\s+destination: https:\/\/jodytracks\.com\/\*\n/.test(ry) && (ry.match(/- type: /g) || []).length === 2 && /plan: free/.test(ry) && /staticPublishPath: public/.test(ry), ry);
check('5e the COMMITTED redirect-service/render equals a fresh build (nobody hand-edits it)', py(['scripts/build_redirect_site.py', '--out', 'redirect-service/render', '--provider', 'render', '--check']).status === 0, 'drift');
const rs = py(['scripts/verify_redirect_service.py', '--simulate', R]);
check('5f the Render rules answer all cases (>= 19: community/76227, map?zip=76227, shared-report + unsubscribe queries, encoded/duplicate params, DID, Google token, robots)', rs.status === 0 && JSON.parse(rs.stdout).cases >= 19, rs.stdout);
function rmut(name, fn) {
  const M = join(base, 'rm-' + name); cpSync(R, M, { recursive: true }); fn(M);
  const s2 = py(['scripts/verify_redirect_service.py', '--simulate', M]);
  const c2 = py(['scripts/build_redirect_site.py', '--out', M, '--provider', 'render', '--check']);
  check(`5g render mutation "${name}" is caught`, s2.status !== 0 || c2.status !== 0, 'passed both');
}
const ed = (M, f, fn) => writeFileSync(join(M, f), fn(readFileSync(join(M, f), 'utf8')));
rmut('wrong destination host', (M) => ed(M, 'render.yaml', (t) => t.replace('jodytracks.com', 'jodytracks.net')));
rmut('destination loses the splat', (M) => ed(M, 'render.yaml', (t) => t.replace('/*\n', '/\n').replace('com/\n', 'com/\n')));
rmut('route is a rewrite, not a redirect', (M) => ed(M, 'render.yaml', (t) => t.replace('type: redirect', 'type: rewrite')));
rmut('route narrowed to /community/*', (M) => ed(M, 'render.yaml', (t) => t.replace('source: /*', 'source: /community/*')));
rmut('an index.html is published (/ would answer 200)', (M) => writeFileSync(join(M, 'public/index.html'), '<html></html>'));
rmut('render.yaml leaks into the publish dir', (M) => writeFileSync(join(M, 'public/render.yaml'), ry));
rmut('did.json edited', (M) => ed(M, 'public/.well-known/did.json', (t) => t.replace('homesignal.net', 'jodytracks.com')));
rmut('did.json missing', (M) => rmSync(join(M, 'public/.well-known/did.json')));
rmut('robots.txt gains a sitemap line', (M) => writeFileSync(join(M, 'public/robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://homesignal.net/sitemap.xml\n'));
rmut('a stray static page is published', (M) => writeFileSync(join(M, 'public/about.html'), 'x'));

// the live probe against a stand-in that implements Render's DOCUMENTED precedence (file wins, else the rule), plus failing variants
const rdid = readFileSync(join(R, 'public/.well-known/did.json'));
const rgoogle = readFileSync(join(R, 'public/google59e1ae3ef6b75e3a.html'));
const renderLike = (loc = (u) => 'https://jodytracks.com' + u, status = 301) => (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/.well-known/did.json') { res.writeHead(200); res.end(rdid); return; }
  if (path === '/robots.txt') { res.writeHead(200); res.end(readFileSync(join(R, 'public/robots.txt'))); return; }
  if (path === '/google59e1ae3ef6b75e3a.html') { res.writeHead(200); res.end(rgoogle); return; }
  res.writeHead(status, { Location: loc(req.url) }); res.end();
};
const rprobe = (url, extra = []) => new Promise((r) => {
  const p = spawn('python3', ['scripts/verify_redirect_service.py', '--base', url, '--files', join(R, 'public'), ...extra]);
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => r({ status: code, stdout: out }));
});
// What Render MEASURABLY does (run 38405046317, 2026-10-13): every byte kept, query keys stably sorted. Founder-approved 2026-10-13.
const sortQ = (u) => { const [b, q] = [u.split('?')[0], u.includes('?') ? u.slice(u.indexOf('?') + 1) : '']; return q ? b + '?' + q.split('&').map((p, i) => [p, i]).sort((x, y) => (x[0].split('=')[0] < y[0].split('=')[0] ? -1 : x[0].split('=')[0] > y[0].split('=')[0] ? 1 : x[1] - y[1])).map((x) => x[0]).join('&') : b; };
const SORTED = ['--query-order', 'sorted'];
const renderSorted = (u) => 'https://jodytracks.com' + sortQ(u);
for (const [name, h, want, extra] of [
  ['a Render-like service (file wins, else 301, keys sorted) under --query-order sorted', renderLike(renderSorted), true, SORTED],
  ['the SAME Render-like service under the strict default (documents the measured difference)', renderLike(renderSorted), false, []],
  ['a service that strips the query string', renderLike((u) => 'https://jodytracks.com' + u.split('?')[0]), false, SORTED],
  ['a service that re-encodes a value (%2F -> /)', renderLike((u) => renderSorted(u).replace('%2F', '/')), false, SORTED],
  ['a service that drops one parameter', renderLike((u) => renderSorted(u).replace('&utm_source=bluesky', '').replace('utm_source=bluesky&', '')), false, SORTED],
  ['a service that swaps the order of a duplicate key (d=1&d=2 -> d=2&d=1)', renderLike((u) => renderSorted(u).replace('d=1&d=2', 'd=2&d=1')), false, SORTED],
  ['a service that changes a value (case)', renderLike((u) => renderSorted(u).replace('abc123', 'ABC123')), false, SORTED],
  ['a 302 service', renderLike(renderSorted, 302), false, SORTED],
  ['a service that redirects to its own host (loop)', (req, res) => { const p = req.url.split('?')[0]; if (['/.well-known/did.json', '/robots.txt', '/google59e1ae3ef6b75e3a.html'].includes(p)) return renderLike()(req, res); res.writeHead(301, { Location: 'http://' + req.headers.host + req.url }); res.end(); }, false, SORTED],
  ['a correct service probed over plain http with --require-https', renderLike(renderSorted), false, [...SORTED, '--require-https']],
]) {
  const { s, url } = await serve(h);
  const r = await rprobe(url, extra);
  s.close();
  check(`5h live probe: ${name} ${want ? 'passes' : 'is refused'}`, (r.status === 0) === want, r.stdout.slice(0, 300));
}

// 6. the www alias (founder-approved 2026-10-15): every case is ONE permanent hop to the apex, same path and query, byte for byte
const hopProbe = (url, extra = ['--expect-apex-hop', 'homesignal.net']) => new Promise((r) => {
  const p = spawn('python3', ['scripts/verify_redirect_service.py', '--base', url, ...extra]);
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => r({ status: code, stdout: out }));
});
const toApex = (loc = (u) => 'https://homesignal.net' + u, status = 301) => (req, res) => { res.writeHead(status, { Location: loc(req.url) }); res.end(); };
for (const [name, h, want, extra] of [
  ['a www alias that 301s every path (DID, robots, Google token included) to the apex with the query kept byte for byte', toApex(), true],
  ['a www alias that 302s', toApex((u) => 'https://homesignal.net' + u, 302), false],
  ['a www alias that skips the apex and goes straight to jodytracks.com', toApex((u) => 'https://jodytracks.com' + u), false],
  ['a www alias that sorts the query keys', toApex((u) => 'https://homesignal.net' + sortQ(u)), false],
  ['a www alias that drops the query string', toApex((u) => 'https://homesignal.net' + u.split('?')[0]), false],
  ['a www alias that answers 200 on the DID document', (req, res) => { if (req.url === '/.well-known/did.json') { res.writeHead(200); res.end(did); return; } toApex()(req, res); }, false],
  ['a base that is the apex itself with --expect-apex-hop', toApex(), false, ['--expect-apex-hop', '127.0.0.1:0']],
]) {
  const { s, url } = await serve(h);
  const ex = extra && extra[1] === '127.0.0.1:0' ? ['--expect-apex-hop', url.replace('http://', '')] : extra;
  const r = await hopProbe(url, ex);
  s.close();
  check(`6 www alias probe: ${name} ${want ? 'passes' : 'is refused'}`, (r.status === 0) === want, r.stdout.slice(0, 300));
}
{
  const { s, url } = await serve(toApex());
  const r = await hopProbe(url, ['--require-https', '--expect-apex-hop', 'homesignal.net']);
  s.close();
  check('6 www alias probe: --require-https still refuses a plain-http base', r.status !== 0, r.stdout.slice(0, 200));
}
// the workflow wires the input through and the apex path keeps its strict probe
const wf = readFileSync('.github/workflows/jody-redirect-verify.yml', 'utf8');
check('6 workflow: expect_apex_hop input exists and is passed to --expect-apex-hop only in probe mode', /expect_apex_hop:/.test(wf) && /APEX_HOP: \$\{\{ inputs\.mode == 'probe' && inputs\.expect_apex_hop \|\| '' \}\}/.test(wf) && /--expect-apex-hop "\$APEX_HOP"/.test(wf), 'not wired');
check('6 workflow: the default (apex) probe is unchanged - still --files _redirect with the strict/sorted query order', /--base "\$TARGET" --files _redirect --require-https --query-order/.test(wf), 'changed');

rmSync(base, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
