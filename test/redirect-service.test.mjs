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
  ['a service that drops the query string', (req, res) => { if (req.url === '/.well-known/did.json' || req.url === '/robots.txt') return good()(req, res); res.writeHead(301, { Location: 'https://jodytracks.com' + req.url.split('?')[0] }); res.end(); }, false],
  ['a service that redirects the DID document too', (req, res) => { res.writeHead(301, { Location: 'https://jodytracks.com' + req.url }); res.end(); }, false],
]) {
  const { s, url } = await serve(h);
  const r = await probe(url);
  s.close();
  check(`4 live probe: ${name} ${want ? 'passes' : 'is refused'}`, (r.status === 0) === want, r.stdout.slice(0, 300));
}

rmSync(base, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
