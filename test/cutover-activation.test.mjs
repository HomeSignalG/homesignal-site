// Jody Step 16 - the cutover machinery is INERT until the brand contract is changed, and correct once it is.
// Offline. Run: node test/cutover-activation.test.mjs
//   A  the build step that applies the published identity is a no-op while HomeSignal is current, and is NOT keyed to the contract
//      (it rewrites a Jody-current tree too: activation must not publish a HomeSignal-branded site on the Jody host)
//   B  the Search Console slot ships only on a Jody LAUNCH tree, and refuses a file that would not verify
//   C  IndexNow is held for a non-HomeSignal identity, fails closed, and is not consulted for HomeSignal
//   D  the workflow wiring: one pipeline, the step is where it must be, nothing else builds the site
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let failures = 0;
const check = (n, ok, why) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` - ${why}`}`); if (!ok) failures++; };
const py = (args, opts = {}) => spawnSync('python3', args, { encoding: 'utf8', ...opts });
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const snapshot = (d) => Object.fromEntries(walk(d).map((p) => [p.slice(d.length), readFileSync(p, 'utf8')]));

const base = mkdtempSync(join(tmpdir(), 'cutover-'));
const contractV1 = JSON.parse(readFileSync('docs/brand/brand-contract.v1.json', 'utf8'));
const v2 = JSON.parse(JSON.stringify(contractV1));
v2.contract_version = 2; v2.current_identity = 'jody'; v2.future_identity = 'homesignal';
v2.identities.jody.state = 'active'; v2.identities.homesignal.state = 'inactive';
const V2 = join(base, 'contract.v2.json'); writeFileSync(V2, JSON.stringify(v2, null, 2));

function tree(name, files) {
  const d = join(base, name); mkdirSync(d, { recursive: true });
  for (const [rel, text] of Object.entries(files)) { const p = join(d, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); }
  return d;
}
const PAGE = '<html><head><title>HomeSignal</title><link rel="canonical" href="https://homesignal.net/"></head><body>HomeSignal at https://homesignal.net/ ' +
  'Home<span class="x">Signal</span> mail hello@homesignal.net</body></html>';
const FILES = {
  'index.html': PAGE, 'robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://homesignal.net/sitemap.xml\n',
  'google59e1ae3ef6b75e3a.html': 'google-site-verification: google59e1ae3ef6b75e3a.html',
  'lib/share-text.js': "var ALLOWED_HOSTS = ['homesignal.net', 'www.homesignal.net'];\n",
};
const stage = (d, ...a) => py(['scripts/brand_stage.py', '--dir', d, ...a]);

// ---- A. the identity step -------------------------------------------------------------------------------------------------------
{
  const a = tree('a-home', FILES); const before = snapshot(a);
  const r = stage(a, '--identity', 'homesignal');
  check('A1 --identity homesignal is a byte-for-byte no-op', r.status === 0 && JSON.stringify(snapshot(a)) === JSON.stringify(before), r.stderr);
  const cur = py(['scripts/brand_host.py', '--identity']).stdout.trim();
  check('A2 the build step\'s own argument (`brand_host.py --identity`) is homesignal for the committed contract', cur === 'homesignal', cur);
  const b = tree('a-pipeline', FILES); const bb = snapshot(b);
  check('A3 …so the exact command the workflow runs changes nothing today', stage(b, '--identity', cur).status === 0 && JSON.stringify(snapshot(b)) === JSON.stringify(bb), 'changed');

  // activation: the contract says Jody is current; the SOURCE tree is still HomeSignal-branded; the step must still rewrite it
  const j = tree('a-jody-current', FILES);
  const r2 = stage(j, '--identity', 'jody', '--contract', V2);
  const idx = readFileSync(join(j, 'index.html'), 'utf8');
  check('A4 with Jody CURRENT in the contract the overlay still rewrites the source tree (not keyed to the contract)', r2.status === 0 && idx.includes('https://jodytracks.com/') && !/HomeSignal(?![\w-])/.test(idx.replace(/<[^>]+>/g, ' ')) && idx.includes('Jo<span class="x">dy</span>'), r2.stderr + idx);
  check('A5 the old domain\'s Google token is not shipped on the Jody host', !existsSync(join(j, 'google59e1ae3ef6b75e3a.html')), 'present');
  check('A6 the e-mail address, the DID and file names are untouched (identifiers, not brand words)', idx.includes('hello@homesignal.net'), idx);
  check('A7 robots.txt names the Jody sitemap, not the old one', /Sitemap: https:\/\/jodytracks\.com\/sitemap\.xml/.test(readFileSync(join(j, 'robots.txt'), 'utf8')), readFileSync(join(j, 'robots.txt'), 'utf8'));
  const st = readFileSync(join(j, 'lib/share-text.js'), 'utf8');
  check('A8 the share allowlist keeps BOTH hosts (old digest e-mails carry u=https://homesignal.net/...)', st.includes("'jodytracks.com'") && st.includes("'homesignal.net'") && st.includes("'www.homesignal.net'") && st.includes("'www.jodytracks.com'"), st);
  check('A9 --staging is refused for the CURRENT identity (a noindex tree must never be mistaken for the live brand)', stage(tree('a-stg', FILES), '--identity', 'jody', '--staging', '--contract', V2).status !== 0, 'accepted');
}

// ---- B. the Search Console slot ----------------------------------------------------------------------------------------------------
{
  const slot = join(base, 'slot'); mkdirSync(slot);
  const NAME = 'google0123456789abcdef.html';
  writeFileSync(join(slot, NAME), `google-site-verification: ${NAME}\n`);
  const run = (id, extra = [], dir = slot) => py(['-c', `import sys; sys.path.insert(0,'scripts'); import brand_stage as b, json, pathlib; c=b.load_contract(); r=b.run(pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]=='1', c, pathlib.Path(sys.argv[4])); print(json.dumps(r['verification_files']))`, ...extra]);
  // helper: invoke run() directly so the slot directory is injectable
  const launch = (identity, staging = '0', dir = slot) => { const d = tree(`b-${identity}-${staging}-${Math.random()}`, FILES); const r = run(null, [d, identity, staging, dir]); return { r, d }; };
  const l = launch('jody');
  check('B1 a valid Google file in the slot ships at the root of a Jody LAUNCH tree', l.r.status === 0 && existsSync(join(l.d, NAME)) && readFileSync(join(l.d, NAME), 'utf8').includes(NAME), l.r.stderr);
  const s = launch('jody', '1');
  check('B2 …and does NOT ship on a staging tree', s.r.status === 0 && !existsSync(join(s.d, NAME)), 'shipped');
  const h = launch('homesignal');
  check('B3 …and not on the HomeSignal tree', h.r.status === 0 && !existsSync(join(h.d, NAME)), 'shipped');
  const empty = join(base, 'empty-slot'); mkdirSync(empty);
  const e = launch('jody', '0', empty);
  check('B4 an EMPTY slot (today) ships nothing and is not an error', e.r.status === 0 && walk(e.d).every((p) => !/google[0-9a-f]{16}/.test(p)), e.r.stderr);
  for (const [why, name, text] of [['a wrong file name', 'verify.html', 'google-site-verification: verify.html'], ['content that does not name the file', 'google0123456789abcdef.html', 'hello'], ['a wrong-length token', 'google0123.html', 'google-site-verification: google0123.html']]) {
    const bad = join(base, 'bad-' + why.replace(/\W/g, '')); mkdirSync(bad); writeFileSync(join(bad, name), text);
    const r = launch('jody', '0', bad).r;
    check(`B5 ${why} in the slot is REFUSED (a file that cannot verify is found out after GO LIVE otherwise)`, r.status !== 0, r.stdout);
  }
}

// ---- C. the IndexNow launch hold ----------------------------------------------------------------------------------------------------
{
  const holdFile = (obj) => { const p = join(base, 'hold-' + Math.random() + '.json'); writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj)); return p; };
  const hold = (identity, file) => {
    const r = py(['-c', `import sys, json; sys.path.insert(0,'scripts'); import indexnow as i; print(json.dumps(i.launch_hold(sys.argv[1], sys.argv[2])))`, identity, file]);
    return r.status === 0 ? JSON.parse(r.stdout) : 'ERR:' + r.stderr;
  };
  check('C1 HomeSignal is never held (today\'s notifications are untouched), whatever the file says', hold('homesignal', holdFile({ hold: true })) === null && hold('homesignal', '/no/such/file') === null, 'held');
  check('C2 Jody is held while hold=true', typeof hold('jody', holdFile({ hold: true })) === 'string', 'not held');
  check('C3 Jody is released only by an explicit hold=false', hold('jody', holdFile({ hold: false })) === null, 'held');
  for (const [why, f] of [['a missing file', '/no/such/hold.json'], ['non-JSON', holdFile('not json')], ['a missing key', holdFile({})], ['a string "false"', holdFile({ hold: 'false' })], ['null', holdFile({ hold: null })], ['0', holdFile({ hold: 0 })]]) {
    check(`C4 Jody is held on ${why} (fails closed)`, typeof hold('jody', f) === 'string', JSON.stringify(hold('jody', f)));
  }
  const committed = JSON.parse(readFileSync('docs/brand/indexnow-jody-hold.json', 'utf8'));
  check('C5 the committed hold is hold=true (nothing is released by this change)', committed.hold === true, JSON.stringify(committed));
  // the whole guarded step, not just the predicate: a held notify makes no request and is not an error
  const r = py(['-c', `import sys, json; sys.path.insert(0,'scripts'); import indexnow as i
calls=[]
def post(*a, **k): calls.append(a); raise AssertionError('POSTED')
def get(*a, **k): calls.append(a); raise AssertionError('FETCHED')
i.launch_hold = lambda identity=None, hold_file=None: 'held for test'
d={'submit':['/community/84302/'],'seed':False,'candidate_pages':9999}
rec=i.notify(d,'abcdefgh12345678',post=post,get=get)
print(json.dumps({'outcome':rec['outcome'],'submitted':rec['submitted'],'calls':len(calls)}))`]);
  const out = r.status === 0 ? JSON.parse(r.stdout) : null;
  check('C6 a held notify() makes NO network request, submits nothing and returns normally (a good deploy stays green)', !!out && out.calls === 0 && out.submitted === 0 && /^HELD/.test(out.outcome), r.stderr + r.stdout);
}

// ---- D. workflow wiring ---------------------------------------------------------------------------------------------------------
{
  const wf = readFileSync('.github/workflows/pages.yml', 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const at = (re) => { const m = wf.match(re); return m ? m.index : -1; };
  const gen = at(/name: Generate one document per canonical ZIP/), ov = at(/name: Apply the published brand identity/), key = at(/name: Publish the IndexNow key file/), gates = at(/name: Build gates/), dep = at(/^  deploy:/m);
  check('D1 the identity step runs AFTER the documents are generated and BEFORE the key file, the gates and the deploy', gen > 0 && ov > gen && ov < key && ov < gates && ov < dep, [gen, ov, key, gates, dep].join());
  check('D2 it takes its identity from the contract (brand_host.py), never a literal', /brand_stage\.py --dir _site --identity "\$\(python3 scripts\/brand_host\.py --identity\)"/.test(wf), 'literal');
  check('D3 it is not staging (a staging tree would be noindex everywhere)', !/brand_stage\.py[^\n]*--staging/.test(wf), 'staging');
  const others = readdirSync('.github/workflows').filter((f) => f.endsWith('.yml') && /actions\/deploy-pages/.test(readFileSync(join('.github/workflows', f), 'utf8')));
  check('D4 exactly ONE workflow deploys the site to Pages (no second pipeline)', JSON.stringify(others) === JSON.stringify(['pages.yml']), others.join());
}

rmSync(base, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
