// IndexNow transport and policy (scripts/indexnow.py). No network: every POST and GET is a fake.
//
//   K/L/M  only canonical https://homesignal.net page URLs are ever submitted
//   N      never more than 10,000 URLs in one POST
//   O      duplicate changed inputs collapse to one URL
//   S      200 and 202 are accepted
//   T      400 / 403 / 422 fail loudly and are NOT retried
//   U      429 (and 5xx, and network errors) retry with bounded exponential backoff, then fail
//   V      the key is never printed, logged, put in a receipt or in an error
//   W      nothing is submitted until the live site serves the new build (deploy first, notify second)
//   X      no INDEXNOW_KEY: the build is unaffected and IndexNow skips safely
//   +      the key file, the artifact hygiene check, and the mass-change hold
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(root, 'scripts');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

const KEY = 'a1b2c3d4-e5f6-4789-abcd-0123456789ab';   // a fake, valid-format test key
const PRE = `import sys, json; sys.path.insert(0, ${JSON.stringify(SCRIPTS)}); import indexnow as ix, page_semantics as ps\n`;
function py(code, env = {}) {
  const r = spawnSync('python3', ['-c', PRE + code], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { status: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}
const J = (code, env) => { const r = py(code, env); try { return { ...r, v: JSON.parse(r.out.trim().split('\n').pop()) }; } catch { return { ...r, v: null }; } };

// ---------------------------------------------------------------- K / L / M — URL policy
const bad = J(`
res = {}
for label, path in [
  ('map_query', '/homesignalmap.html?zip=84302'), ('legacy_query', '/community.html?zip=84302'),
  ('query_on_canonical', '/community/84302/?utm_source=x'), ('fragment', '/community/84302/#a'),
  ('other_host_path', '//evil.example/community/84302/'), ('plain_root', '/'), ('zip_list', '/community/84302/projects/'),
  ('tracking', '/community/84302/?cb=1')]:
    try:
        ix.canonical_url(path); res[label] = 'ACCEPTED'
    except ix.IndexNowError:
        res[label] = 'refused'
for label, url in [('http', 'http://homesignal.net/community/84302/'), ('www', 'https://www.homesignal.net/community/84302/'),
                   ('supabase', 'https://qwnnmljucajnexpxdgxr.supabase.co/community/84302/'),
                   ('github_pages', 'https://homesignalg.github.io/homesignal-site/community/84302/'),
                   ('map_url', 'https://homesignal.net/homesignalmap.html?zip=84302'),
                   ('legacy_url', 'https://homesignal.net/community.html?zip=84302')]:
    try:
        ix.check_url(url); res[label] = 'ACCEPTED'
    except ix.IndexNowError:
        res[label] = 'refused'
print(json.dumps(res))`);
ok(bad.v && Object.values(bad.v).every((x) => x === 'refused'),
   `K/L  query-string map URLs, legacy community.html?zip=, other hosts, previews, tracking: all refused ${bad.v ? JSON.stringify(Object.entries(bad.v).filter(([, x]) => x !== 'refused')) : bad.all}`);
const good = J(`
paths = ['/community/84302/', '/city/ut/brigham-city/', '/project/arcgis-x/case-1-1a2b3c4d/', '/guides/what-is-being-built-near-me/']
us = ix.url_list(paths); print(json.dumps({'urls': us, 'host_ok': all(u.startswith('https://homesignal.net/') for u in us)}))`);
ok(good.v && good.v.urls.length === 4 && good.v.host_ok, 'M  every canonical family is accepted and every URL is on homesignal.net');
const dup = J(`print(json.dumps(ix.url_list(['/community/84302/', '/community/84302/', '/community/84303/', '/community/84302/'])))`);
ok(dup.v && dup.v.length === 2, 'O  duplicate changed inputs collapse to one URL');

// ---------------------------------------------------------------- N — batch size
const bs = J(`
urls = [f'https://homesignal.net/community/{i:05d}/' for i in range(25001)]
cs = ix.chunks(urls)
try:
    ix.chunks(urls, 10001); big = 'ACCEPTED'
except ix.IndexNowError: big = 'refused'
try:
    ix.chunks(urls, 0); zero = 'ACCEPTED'
except ix.IndexNowError: zero = 'refused'
print(json.dumps({'n': len(cs), 'max': max(len(c) for c in cs), 'total': sum(len(c) for c in cs), 'big': big, 'zero': zero}))`);
ok(bs.v && bs.v.n === 3 && bs.v.max === 10000 && bs.v.total === 25001 && bs.v.big === 'refused' && bs.v.zero === 'refused',
   'N  25,001 URLs split into 10,000 / 10,000 / 5,001; a larger batch size is refused');
const wire = J(`
sent = []
def post(url, body, headers):
    sent.append((url, json.loads(body))); return 200, {}, b''
urls = [f'https://homesignal.net/community/{i:05d}/' for i in range(10001)]
rec = ix.submit(urls, ${JSON.stringify(KEY)}, post=post, sleep=lambda s: None)
b = sent[0][1]
print(json.dumps({'posts': len(sent), 'endpoint': sent[0][0], 'host': b['host'], 'keyLocation': b['keyLocation'], 'sizes': [len(x[1]['urlList']) for x in sent], 'hasKey': b['key'] == ${JSON.stringify(KEY)}, 'fields': sorted(b)}))`);
ok(wire.v && wire.v.endpoint === 'https://api.indexnow.org/indexnow' && wire.v.host === 'homesignal.net'
   && wire.v.keyLocation === 'https://homesignal.net/indexnow.txt' && wire.v.hasKey
   && JSON.stringify(wire.v.sizes) === '[10000,1]' && JSON.stringify(wire.v.fields) === '["host","key","keyLocation","urlList"]',
   'N1 the POST is the documented bulk shape: host, key, keyLocation, urlList, to api.indexnow.org, 10,000 max');

// ---------------------------------------------------------------- S / T / U — response handling
const sub = (statuses, extra = '') => J(`
seq = ${JSON.stringify(statuses)}; calls = {'n': 0}; sleeps = []
def post(url, body, headers):
    i = min(calls['n'], len(seq) - 1); calls['n'] += 1
    s = seq[i]
    if s == 'net': raise OSError('connection reset by peer ' + ${JSON.stringify(KEY)})
    return s, ${extra || '{}'}, b'detail'
try:
    rec = ix.submit(['https://homesignal.net/community/84302/'], ${JSON.stringify(KEY)}, post=post, sleep=sleeps.append)
    print(json.dumps({'ok': True, 'rec': rec, 'calls': calls['n'], 'sleeps': sleeps}))
except ix.IndexNowError as e:
    print(json.dumps({'ok': False, 'err': str(e), 'calls': calls['n'], 'sleeps': sleeps}))`);
ok(sub([200]).v.ok && sub([200]).v.rec[0].result === 'accepted', 'S  200 is accepted');
const r202 = sub([202]).v;
ok(r202.ok && r202.rec[0].result === 'accepted-key-validation-pending', 'S1 202 is accepted (key validation pending)');
for (const code of [400, 403, 422]) {
  const t = sub([code]).v;
  ok(!t.ok && t.calls === 1 && t.sleeps.length === 0, `T  HTTP ${code} fails loudly after ONE attempt (not retried)`);
}
const t404 = sub([404]).v;
ok(!t404.ok && t404.calls === 1, 'T1 any other 4xx is also a hard failure, never retried');
const u1 = sub([429, 429, 200]).v;
ok(u1.ok && u1.calls === 3 && JSON.stringify(u1.sleeps) === '[2,4]' && u1.rec[0].retries === 2,
   'U  429 retries with exponential backoff (2s, 4s) and then succeeds');
const u2 = sub([429]).v;
ok(!u2.ok && u2.calls === 5 && u2.sleeps.length === 4 && Math.max(...u2.sleeps) <= 60,
   `U1 a 429 that never clears gives up after 1+4 attempts, backoff capped (${JSON.stringify(u2.sleeps)})`);
const u3 = sub([503, 502, 200]).v;
ok(u3.ok && u3.calls === 3, 'U2 5xx is retried');
const u4 = sub(['net', 200]).v;
ok(u4.ok && u4.calls === 2, 'U3 a network error is retried');
const u5 = sub([429, 200], "{'Retry-After': '999'}").v;
ok(u5.ok && u5.sleeps[0] === 60, 'U4 Retry-After is honoured but capped at 60s');
const v1 = sub(['net']).v;
ok(!v1.ok && !JSON.stringify(v1).includes(KEY), 'V  a network error that echoes the key is redacted from the raised error');

// ---------------------------------------------------------------- V — the key never leaks
const hard = sub([403]).v;
ok(!JSON.stringify(hard).includes(KEY) && !JSON.stringify(sub([200]).v).includes(KEY), 'V1 receipts and errors never contain the key');
const bad2 = J(`
try:
    ix.submit(['https://homesignal.net/community/84302/'], 'short', post=lambda *a: (200, {}, b''))
    print(json.dumps('ACCEPTED'))
except ix.IndexNowError as e: print(json.dumps('refused'))`);
ok(bad2.v === 'refused', 'V2 a malformed key (too short) is refused before any request');
const keyChecks = J(`
print(json.dumps({'ok': ix.valid_key('abcdefgh'), 'hyphen': ix.valid_key('a-b-c-d-e-f'), 'len128': ix.valid_key('a' * 128),
  'len129': ix.valid_key('a' * 129), 'len7': ix.valid_key('a' * 7), 'space': ix.valid_key('abcdefgh ij'),
  'underscore': ix.valid_key('abcdefgh_ij'), 'nl': ix.valid_key('abcdefgh\\n'), 'empty': ix.valid_key('')}))`).v;
ok(keyChecks.ok && keyChecks.hyphen && keyChecks.len128 && !keyChecks.len129 && !keyChecks.len7 && !keyChecks.space
   && !keyChecks.underscore && !keyChecks.nl && !keyChecks.empty,
   'V3 key format = protocol: 8-128 chars, letters digits hyphen only');

// the CLI: no output path may print the key
function cli(args, env, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'inxcli-'));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), typeof c === 'string' ? c : JSON.stringify(c));
  const r = spawnSync('python3', [join(SCRIPTS, 'indexnow.py'), ...args.map((a) => a.replace('{dir}', dir))],
    { encoding: 'utf8', env: { ...process.env, INDEXNOW_KEY: '', GITHUB_EVENT_NAME: '', ...env }, cwd: dir });
  return { ...r, dir, all: r.stdout + r.stderr };
}

// ---------------------------------------------------------------- X — absent key
const art = mkdtempSync(join(tmpdir(), 'inxart-'));
const wk0 = cli(['write-key', '--out', art], { INDEXNOW_KEY: '' });
ok(wk0.status === 0 && !existsSync(join(art, 'indexnow.txt')) && /not configured/.test(wk0.all),
   'X  no INDEXNOW_KEY: write-key exits 0, writes nothing, says IndexNow will skip (the build is unaffected)');
const delta = { build_id: 'r-1', baseline_state_hash: 'b', candidate_state_hash: 'c', candidate_pages: 100, seed: false,
  added: [], changed: ['/community/84302/'], indexability_changed: [], removed: [], submit: ['/community/84302/'],
  verify: { present: {}, absent: [] } };
const n0 = cli(['notify', '--delta', '{dir}/d.json', '--receipt', '{dir}/r.json'], { INDEXNOW_KEY: '' }, { 'd.json': delta });
ok(n0.status === 0 && /skipped: INDEXNOW_KEY is not configured/.test(n0.all), 'X1 no key: notify exits 0 and records "skipped"');
const wkBad = cli(['write-key', '--out', art], { INDEXNOW_KEY: 'bad key!' });
ok(wkBad.status === 0 && !existsSync(join(art, 'indexnow.txt')) && /malformed/.test(wkBad.all) && !wkBad.all.includes('bad key!'),
   'X2 a malformed key never blocks the build and is not written or printed');
const nBad = cli(['notify', '--delta', '{dir}/d.json'], { INDEXNOW_KEY: 'bad key!' }, { 'd.json': delta });
ok(nBad.status === 1 && !nBad.all.includes('bad key!'), 'X3 a malformed key makes the NOTIFY job fail loudly (the only red)');

// ---------------------------------------------------------------- the key file
const wk1 = cli(['write-key', '--out', art], { INDEXNOW_KEY: KEY });
ok(wk1.status === 0 && readFileSync(join(art, 'indexnow.txt'), 'utf8') === KEY && !wk1.all.includes(KEY),
   'F1 indexnow.txt contains exactly the key (no newline) and the step never prints it');
const art2 = mkdtempSync(join(tmpdir(), 'inxart-'));
const wkPr = cli(['write-key', '--out', art2], { INDEXNOW_KEY: KEY, GITHUB_EVENT_NAME: 'pull_request' });
ok(wkPr.status === 0 && !existsSync(join(art2, 'indexnow.txt')), 'F2 a pull_request run never writes the key file');
const chk = (setup) => { const d = mkdtempSync(join(tmpdir(), 'inxchk-')); setup(d); return cli(['check-artifact', '--dir', d], { INDEXNOW_KEY: KEY }); };
ok(chk((d) => { writeFileSync(join(d, 'indexnow.txt'), KEY); writeFileSync(join(d, 'index.html'), '<html>ok</html>'); }).status === 0,
   'F3 hygiene passes: the key is in indexnow.txt and nowhere else');
const leak = chk((d) => { writeFileSync(join(d, 'indexnow.txt'), KEY); mkdirSync(join(d, 'community')); writeFileSync(join(d, 'community', 'x.html'), `oops ${KEY}`); });
ok(leak.status === 1 && /community\/x\.html/.test(leak.all) && !leak.all.includes(KEY), 'F4 hygiene FAILS if the key appears in any other file, and does not print it');
const wrong = chk((d) => { writeFileSync(join(d, 'indexnow.txt'), KEY + '\n'); });
ok(wrong.status === 1, 'F5 hygiene fails if indexnow.txt is not exactly the key');
const orphan = cli(['check-artifact', '--dir', (() => { const d = mkdtempSync(join(tmpdir(), 'inxchk-')); writeFileSync(join(d, 'indexnow.txt'), 'x'); return d; })()], { INDEXNOW_KEY: '' });
ok(orphan.status === 1, 'F6 a key file that ships with no configured key fails hygiene');

// ---------------------------------------------------------------- W — deploy first, notify second
const live = (over = '') => `
posted = {'n': 0}
sleeps = []
def post(url, body, headers):
    posted['n'] += 1; return 200, {}, b''
pages = {'https://homesignal.net/community/84302/': b'<html>new</html>'}
import hashlib
want = hashlib.sha256(pages['https://homesignal.net/community/84302/']).hexdigest()[:32]
state = {'state_hash': 'c'}
def get(url):
    ${over}
    base = url.split('?')[0]
    if base.endswith('/indexnow.txt'): return 200, ${JSON.stringify(KEY)}.encode()
    if base.endswith('/sitemaps/page-state.json'): return 200, json.dumps(state).encode()
    if base in pages: return 200, pages[base]
    return 404, b''
delta = {'build_id': 'r-1', 'baseline_state_hash': 'b', 'candidate_state_hash': 'c', 'candidate_pages': 100, 'seed': False,
  'added': [], 'changed': ['/community/84302/'], 'indexability_changed': [], 'removed': ['/project/x-y/gone-1a2b3c4d/'],
  'submit': ['/community/84302/', '/project/x-y/gone-1a2b3c4d/'],
  'verify': {'present': {'/community/84302/': want}, 'absent': ['/project/x-y/gone-1a2b3c4d/']}}
clock = {'t': 0}
def tick(): clock['t'] += 100; return clock['t']
`;
const w1 = J(live() + `
rec = ix.notify(delta, ${JSON.stringify(KEY)}, post=post, get=get, sleep=lambda s: None, wait=600, every=1, clock=tick)
print(json.dumps({'posted': posted['n'], 'outcome': rec['outcome'], 'submitted': rec['submitted']}))`);
ok(w1.v && w1.v.posted === 1 && w1.v.submitted === 2 && w1.v.outcome === 'submitted',
   'W0 control: with the new build live (key file, state, exact page bytes, removed page 404) the set is submitted once');
const w2 = J(live("if url.split('?')[0].endswith('/community/84302/'): return 200, b'<html>OLD stale bytes</html>'") + `
try:
    ix.notify(delta, ${JSON.stringify(KEY)}, post=post, get=get, sleep=lambda s: None, wait=300, every=1, clock=tick)
    print(json.dumps({'raised': False, 'posted': posted['n']}))
except ix.IndexNowError as e:
    print(json.dumps({'raised': True, 'posted': posted['n'], 'why': str(e)}))`);
ok(w2.v && w2.v.raised && w2.v.posted === 0 && /community\/84302/.test(w2.v.why),
   'W  the live page still serving OLD bytes => NOTHING is submitted (no notification before the page is live)');
const w3 = J(live("if url.split('?')[0].endswith('/sitemaps/page-state.json'): return 200, json.dumps({'state_hash': 'previous'}).encode()") + `
try:
    ix.notify(delta, ${JSON.stringify(KEY)}, post=post, get=get, sleep=lambda s: None, wait=300, every=1, clock=tick)
    print(json.dumps({'raised': False, 'posted': posted['n']}))
except ix.IndexNowError as e:
    print(json.dumps({'raised': True, 'posted': posted['n']}))`);
ok(w3.v && w3.v.raised && w3.v.posted === 0, 'W1 the live state not yet equal to the candidate state => nothing submitted');
const w4 = J(live("if url.split('?')[0].endswith('/project/x-y/gone-1a2b3c4d/'): return 200, b'still here'") + `
try:
    ix.notify(delta, ${JSON.stringify(KEY)}, post=post, get=get, sleep=lambda s: None, wait=300, every=1, clock=tick)
    print(json.dumps({'raised': False}))
except ix.IndexNowError as e:
    print(json.dumps({'raised': True, 'posted': posted['n']}))`);
ok(w4.v && w4.v.raised && w4.v.posted === 0, 'W2 a "removed" page that still answers 200 => nothing submitted');
const w5 = J(live("raise OSError('dns')") + `
try:
    ix.notify(delta, ${JSON.stringify(KEY)}, post=post, get=get, sleep=lambda s: None, wait=300, every=1, clock=tick)
    print(json.dumps({'raised': False}))
except ix.IndexNowError as e:
    print(json.dumps({'raised': True, 'posted': posted['n']}))`);
ok(w5.v && w5.v.raised && w5.v.posted === 0, 'W3 a live site that cannot be read is a reason to wait and then fail, never to submit');
const w6 = J(live("if len(sleeps) < 2 and url.split('?')[0].endswith('/community/84302/'): sleeps.append(1); return 200, b'old'") + `
rec = ix.notify(delta, ${JSON.stringify(KEY)}, post=post, get=get, sleep=lambda s: None, wait=900, every=1, clock=tick)
print(json.dumps({'posted': posted['n'], 'waited': len(sleeps)}))`);
ok(w6.v && w6.v.posted === 1 && w6.v.waited === 2, 'W4 CDN lag: it polls until the new bytes appear, then submits (once)');

// ---------------------------------------------------------------- seed / empty / mass hold
const seed = J(`
rec = ix.notify({'seed': True, 'seed_reason': 'first', 'submit': ['/community/84302/'], 'candidate_pages': 3}, ${JSON.stringify(KEY)}, post=lambda *a: (_ for _ in ()).throw(AssertionError('posted')))
print(json.dumps(rec['outcome']))`);
ok(seed.v && /^seed/.test(seed.v), 'H6 a seed delta submits nothing even if it somehow listed URLs');
const empty = J(`
rec = ix.notify({'seed': False, 'submit': [], 'candidate_pages': 3}, ${JSON.stringify(KEY)}, post=lambda *a: (_ for _ in ()).throw(AssertionError('posted')))
print(json.dumps(rec['outcome']))`);
ok(empty.v && /nothing to notify/.test(empty.v), 'F7 an empty delta submits nothing');
const mass = J(live() + `
big = {'seed': False, 'candidate_pages': 12000, 'submit': [f'/community/{i:05d}/' for i in range(7000)], 'candidate_state_hash': 'c',
       'verify': {'present': {}, 'absent': []}}
try:
    ix.notify(big, ${JSON.stringify(KEY)}, post=post, get=get, sleep=lambda s: None, wait=1, every=1, clock=tick)
    print(json.dumps({'raised': False}))
except ix.IndexNowError as e:
    print(json.dumps({'raised': True, 'posted': posted['n'], 'why': str(e)[:60]}))
rec = ix.notify(big, ${JSON.stringify(KEY)}, allow_mass=True, post=post, get=get, sleep=lambda s: None, wait=1, every=1, clock=tick)
print(json.dumps({'posted': posted['n'], 'batches': len(rec['batches'])}))`);
ok(mass.v && mass.v.posted === 1 && mass.v.batches === 1,
   'M1 more than half of all pages changing is HELD (template change / fingerprint defect); allow_mass sends it');
const heldOnly = J(live() + `
big = {'seed': False, 'candidate_pages': 12000, 'submit': [f'/community/{i:05d}/' for i in range(7000)], 'candidate_state_hash': 'c', 'verify': {'present': {}, 'absent': []}}
try:
    ix.notify(big, ${JSON.stringify(KEY)}, post=post, get=get, sleep=lambda s: None, wait=1, every=1, clock=tick)
    print(json.dumps({'raised': False, 'posted': posted['n']}))
except ix.IndexNowError as e:
    print(json.dumps({'raised': True, 'posted': posted['n']}))`);
ok(heldOnly.v && heldOnly.v.raised && heldOnly.v.posted === 0, 'M2 a held mass change posts NOTHING and fails loudly');
const small = J(`print(json.dumps(ix.mass_change({'submit': ['/x/'] * 900, 'candidate_pages': 1000})))`);
ok(small.v === false, 'M3 the hold has a floor: a small site changing mostly is not a mass change');

// ---------------------------------------------------------------- carry-over of unsent notifications
const carry = (runs, jobs, deltas, extra = '') => J(`
import datetime as dt
now = dt.datetime(2026, 10, 7, 12, 0, tzinfo=dt.timezone.utc)
runs = ${JSON.stringify(runs)}; jobs = ${JSON.stringify(jobs)}; deltas = ${JSON.stringify(deltas)}
asked = []
def gh(args):
    asked.append(args)
    if args[0] == 'api' and '/workflows/pages.yml/runs' in args[1]: return json.dumps({'workflow_runs': runs})
    if args[0] == 'api' and '/jobs' in args[1]:
        rid = args[1].split('/runs/')[1].split('/')[0]
        return json.dumps({'jobs': jobs.get(rid, [])})
    if args[0] == 'run' and args[1] == 'download':
        rid = args[2]
        if rid not in deltas: raise RuntimeError('artifact expired')
        d = args[args.index('-D') + 1]
        open(d + '/indexnow-delta.json', 'w').write(json.dumps(deltas[rid]))
        return ''
    raise AssertionError(args)
${extra}
got = ix.unsent_paths('o/r', '999', gh=gh, now=now)
print(json.dumps({'got': got, 'downloads': [a[2] for a in asked if a[:2] == ['run', 'download']]}))`);
const R = (id, hrsAgo) => ({ id, created_at: new Date(Date.UTC(2026, 9, 7, 12) - hrsAgo * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z') });
const jb = (c) => [{ name: 'build', conclusion: 'success' }, { name: 'indexnow', conclusion: c }];
const c1 = carry([R(201, 1), R(200, 5), R(199, 9)], { 201: jb('failure'), 200: jb('failure'), 199: jb('success') },
  { 201: { submit: ['/community/00001/'] }, 200: { submit: ['/community/00002/', '/community/00001/'] } }).v;
ok(c1 && JSON.stringify(c1.got) === '["/community/00001/","/community/00002/"]' && c1.downloads.join() === '201,200',
   'B1 two failed notifications are carried (deduplicated); the older SUCCESS is where the walk stops');
const c2 = carry([R(201, 1), R(200, 5)], { 201: jb('success'), 200: jb('failure') }, { 200: { submit: ['/community/00009/'] } }).v;
ok(c2 && c2.got.length === 0 && c2.downloads.length === 0,
   'B2 a later successful notification covers everything older (it carried it): nothing is re-sent forever');
const c3 = carry([R(201, 1), R(200, 5)], { 201: [{ name: 'build', conclusion: 'success' }, { name: 'indexnow', conclusion: 'skipped' }],
  200: [{ name: 'build', conclusion: 'failure' }] }, {}).v;
ok(c3 && c3.got.length === 0 && c3.downloads.length === 0,
   'B3 runs whose indexnow job never ran (nothing to send, or the build/deploy failed so the pages are NOT live) carry nothing');
const c4 = carry([R(999, 0.1), R(201, 1)], { 999: jb('failure'), 201: jb('failure') }, { 999: { submit: ['/community/11111/'] }, 201: { submit: ['/community/00001/'] } }).v;
ok(c4 && JSON.stringify(c4.got) === '["/community/00001/"]', 'B4 the current run is never read as "earlier"');
const c5 = carry([R(201, 1), R(150, 24 * 8)], { 201: jb('failure'), 150: jb('failure') }, { 201: { submit: ['/community/00001/'] }, 150: { submit: ['/community/00005/'] } }).v;
ok(c5 && JSON.stringify(c5.got) === '["/community/00001/"]', 'B5 anything older than 7 days is not carried (the sitemap lastmod covers it)');
const c6 = carry([R(201, 1)], { 201: jb('failure') }, {}).v;
ok(c6 && c6.got.length === 0, 'B6 an expired delta artifact is skipped with a warning, not a crash');
const c7 = carry([R(201, 1)], { 201: jb('failure') }, { 201: { submit: ['/community/00001/', '/homesignalmap.html?zip=1', '/x/'] } }).v;
ok(c7 && JSON.stringify(c7.got) === '["/community/00001/"]', 'B7 only canonical paths survive the carry-over');
const m1 = J(`
d = {'seed': False, 'submit': ['/community/00003/']}
print(json.dumps([ix.merge_backlog(dict(d), ['/community/00002/', '/community/00003/', '/nope/'])['submit'],
                  ix.merge_backlog({'seed': True, 'submit': []}, ['/community/00002/'])]))`).v;
ok(m1 && JSON.stringify(m1[0]) === '["/community/00002/","/community/00003/"]' && m1[1].submit.length === 0 && m1[1].carried.length === 0,
   'B8 carried URLs merge into the set, deduplicated; a seed/reseed announces nothing, carried or not');
const dc = J(`
d = {'seed': False, 'baseline_state_hash': 'h', 'candidate_state_hash': 'h', 'baseline_commit': 'abc', 'carried': ['/community/00001/']}
print(json.dumps([ps.decide(d, freshness=True, sha='abc')['proceed'], ps.decide({**d, 'carried': []}, freshness=True, sha='abc')['proceed']]))`).v;
ok(JSON.stringify(dc) === '[true,false]', 'B9 a freshness run with nothing new but a backlog still publishes, so the backlog is sent');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
