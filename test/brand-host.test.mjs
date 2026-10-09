// Jody migration, Step 7 plumbing: the public origin comes from the brand contract through ONE module (scripts/brand_host.py).
// Run: node test/brand-host.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let failures = 0;
const check = (n, ok, why) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` — ${why}`}`); if (!ok) failures++; };
const py = (code) => spawnSync('python3', ['-c', `import sys; sys.path.insert(0,'scripts'); ${code}`], { encoding: 'utf8' });
const contract = JSON.parse(readFileSync('docs/brand/brand-contract.v1.json', 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'brand-host-'));
const write = (name, obj) => { const p = join(tmp, name); writeFileSync(p, JSON.stringify(obj)); return p; };

// 1. today's behaviour is unchanged
check('1a the shipped contract is still homesignal-current (this PR must not activate Jody)', contract.current_identity === 'homesignal' && contract.identities.jody.state === 'inactive', JSON.stringify(contract.current_identity));
const r = py('import brand_host as b; print(b.origin()); print(b.host())');
check('1b origin/host equal the strings that were hard-coded before', r.status === 0 && r.stdout === 'https://homesignal.net\nhomesignal.net\n', r.stdout + r.stderr);
const m = py('import page_semantics as p, gen_zip_pages as g, gen_sitemap as s, indexnow as i; print(p.BASE, g.BASE, s.BASE, i.HOST)');
check('1c all four consumers resolve to the same unchanged origin', m.status === 0 && m.stdout.trim() === 'https://homesignal.net https://homesignal.net https://homesignal.net homesignal.net', m.stdout + m.stderr);

// 2. a contract that makes Jody current moves the answer (the future cutover is a contract change only)
const jodyActive = JSON.parse(JSON.stringify(contract)); jodyActive.current_identity = 'jody'; jodyActive.identities.jody.state = 'active'; jodyActive.identities.homesignal.state = 'inactive';
const j = py(`import brand_host as b; print(b.origin(b.Path(${JSON.stringify(write('jody.json', jodyActive))}))); print(b.host(b.Path(${JSON.stringify(join(tmp, 'jody.json'))})))`);
check('2a a contract with jody current yields the jody origin and host', j.status === 0 && j.stdout === 'https://jodytracks.com\njodytracks.com\n', j.stdout + j.stderr);

// 3. it refuses to guess
const bad = (name, obj) => py(`import brand_host as b; b.origin(b.Path(${JSON.stringify(write(name, obj))}))`);
const inactiveCurrent = JSON.parse(JSON.stringify(contract)); inactiveCurrent.identities.homesignal.state = 'inactive';
const httpOrigin = JSON.parse(JSON.stringify(contract)); httpOrigin.identities.homesignal.origin = 'http://homesignal.net';
const withPath = JSON.parse(JSON.stringify(contract)); withPath.identities.homesignal.origin = 'https://homesignal.net/x';
const unknown = JSON.parse(JSON.stringify(contract)); unknown.current_identity = 'nobody';
for (const [n, o] of [['an inactive current identity', inactiveCurrent], ['a non-https origin', httpOrigin], ['an origin with a path', withPath], ['an unknown current identity', unknown]]) {
  const x = bad(`${n.replace(/\W/g, '_')}.json`, o);
  check(`3 refuses ${n}`, x.status !== 0, 'accepted');
}
const missing = py(`import brand_host as b; b.origin(b.Path(${JSON.stringify(join(tmp, 'nope.json'))}))`);
check('3 refuses a missing contract (no silent default host)', missing.status !== 0, 'accepted');

// 4. no consumer keeps its own copy of the host
for (const f of ['scripts/page_semantics.py', 'scripts/gen_zip_pages.py', 'scripts/gen_sitemap.py', 'scripts/indexnow.py']) {
  const code = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#') && !l.trim().startsWith('*') && !l.trim().startsWith('"""'));
  const assigns = code.filter((l) => /^(BASE|HOST)\s*=/.test(l));
  check(`4 ${f} assigns BASE/HOST only from the contract chain`, assigns.length >= 1 && assigns.every((l) => !/["']https?:\/\/homesignal\.net|["']homesignal\.net["']/.test(l)), assigns.join(' | '));
}
process.exit(failures ? 1 : 0);
