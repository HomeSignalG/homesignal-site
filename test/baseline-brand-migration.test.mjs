// F1: the page-state BASELINE across a brand/host migration (scripts/page_semantics.py::fetch_baseline).
// Drives the SHIPPED function with a stubbed `get` (no network). Pinned:
//   M1 a 404 on the new host still seeds ('absent')                       (unchanged behaviour)
//   M2 a valid state of the SAME host is returned as the baseline         (unchanged behaviour)
//   M3 new host unreadable + OLD host serving a valid own-host state  -> 'absent' (migration seed), no file
//   M4 new host serves the OLD host's valid state (old tree under the new domain) -> 'absent'
//   M5 new host unreadable + old host unreadable too                  -> FAILS (never a silent first run)
//   M6 new host unreadable + old host serves a state that is NOT valid / not its own -> FAILS
//   M7 new host serves a document of an UNKNOWN host                  -> FAILS (BaselineError)
//   M8 old host redirects to the new host after cutover (flaky new-host read): the document is of the NEW host -> FAILS
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const check = (n, c, d = '') => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : '  ' + d}`); };

const PY = String.raw`
import sys, json, os, tempfile
sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))})
import page_semantics as ps
NEW, OLD = 'https://jodytracks.com', 'https://homesignal.net'
ps.BASE = NEW
pages = {'/community/01002/': {'h': 'a'*8, 'i': 1, 'l': None}}
def doc(host):
    d = ps.build_document(pages, '2026-10-14T00:00:00Z'); d['host'] = host; return json.dumps(d)
def run(responses):
    seen = []
    def get(u):
        seen.append(u.split('?')[0]); r = responses.get(u.split('?')[0], 'neterr')
        if r == 'neterr': raise OSError('tls handshake failure')
        return r
    out = os.path.join(tempfile.mkdtemp(), 'b.json')
    open(out, 'w').write('stale')
    try:
        res = ps.fetch_baseline(out, get=get, sleep=lambda s: None, tries=2, known_origins=[OLD])
    except SystemExit as e: res = 'EXIT'
    except ps.BaselineError as e: res = 'BASELINEERROR'
    return {'res': res, 'file': os.path.exists(out), 'seen': seen}
U = lambda o: o + '/sitemaps/page-state.json'
cases = {
 'M1': run({U(NEW): (404, b'')}),
 'M2': run({U(NEW): (200, doc(NEW).encode())}),
 'M3': run({U(NEW): 'neterr', U(OLD): (200, doc(OLD).encode())}),
 'M4': run({U(NEW): (200, doc(OLD).encode())}),
 'M5': run({U(NEW): 'neterr', U(OLD): 'neterr'}),
 'M6a': run({U(NEW): 'neterr', U(OLD): (200, b'not json')}),
 'M6b': run({U(NEW): 'neterr', U(OLD): (200, doc(NEW).encode())}),
 'M7': run({U(NEW): (200, doc('https://evil.example').encode())}),
 'M8': run({U(NEW): (503, b''), U(OLD): (200, doc(NEW).encode())}),
}
print(json.dumps(cases))
`;
const r = spawnSync('python3', ['-I', '-c', PY], { encoding: 'utf8' });
if (r.status !== 0) { console.log(r.stderr); process.exit(1); }
const c = JSON.parse(r.stdout.trim().split('\n').pop());
check('M1 404 seeds', c.M1.res === 'absent' && !c.M1.file);
check('M2 same-host state is the baseline', c.M2.res === 'ok' && c.M2.file);
check('M3 new host unreadable + valid old-host state seeds', c.M3.res === 'absent' && !c.M3.file, JSON.stringify(c.M3));
check('M4 old tree under the new domain seeds', c.M4.res === 'absent' && !c.M4.file, JSON.stringify(c.M4));
check('M5 both unreadable fails closed', c.M5.res === 'EXIT', JSON.stringify(c.M5));
check('M6a old host serving garbage fails closed', c.M6a.res === 'EXIT', JSON.stringify(c.M6a));
check('M6b old host serving the NEW host document is not migration evidence', c.M6b.res === 'EXIT', JSON.stringify(c.M6b));
check('M7 unknown host fails closed', c.M7.res === 'BASELINEERROR', JSON.stringify(c.M7));
check('M8 post-cutover redirect yields a new-host document: not evidence', c.M8.res === 'EXIT', JSON.stringify(c.M8));
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
