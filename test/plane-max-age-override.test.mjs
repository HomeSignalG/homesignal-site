// Identity-only cutover: the Rule D plane freshness guard has ONE bounded, manual, dispatch-only override.
// Drives the shipped load_dev_plane and reads pages.yml. Pinned:
//   A  default behaviour unchanged: an 81h plane is refused (36h guard)
//   B  max_age_hours=100 accepts that 81h plane
//   C  a plane older than the named window is still refused
//   D  the ceiling (336h), zero and negatives are refused even when named
//   E  pages.yml: the input is dispatch-only, defaults to empty, is not set by push/schedule, and the
//      inline fetch check and the generator agree on the same window
//   F  --plane-max-age-hours is refused with --fixture (fixtures never use the clock)
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
let fails = 0;
const check = (n, c, d = '') => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : '  ' + d}`); };

const gen81 = new Date(Date.now() - 81 * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z');
const plane = join(tmpdir(), `plane-age-${Date.now()}.json`);
writeFileSync(plane, JSON.stringify({ version: '1.0.0', rule: 'D', threshold: 3, identity: 'base_project_key',
  generated_at: gen81, lock_n: 0, eligible_n: 0, held_n: 0, zips: {}, cities: {}, projects: {} }));
const load = (arg) => spawnSync('python3', ['-I', '-c', `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('g', ${JSON.stringify(GEN)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
try:
    g.load_dev_plane(${JSON.stringify(plane)}, required=True${arg})
    print('LOADED')
except SystemExit as e:
    print('EXIT', e)
`], { encoding: 'utf8' });
const o = (arg) => { const r = load(arg); return (r.stdout + r.stderr); };

check('A default: 81h plane refused', /stale/.test(o('')) && !/LOADED/.test(o('')), o(''));
check('B 100h window accepts the 81h plane (passes the freshness clock)', !/stale/.test(o(', max_age_hours=100')) && !/outside/.test(o(', max_age_hours=100')), o(', max_age_hours=100'));
check('C a 24h window still refuses it', /stale/.test(o(', max_age_hours=24')), o(', max_age_hours=24'));
check('D1 above the 336h ceiling refused', /outside/.test(o(', max_age_hours=400')), o(', max_age_hours=400'));
check('D2 zero refused', /outside/.test(o(', max_age_hours=0')), o(', max_age_hours=0'));
check('D3 negative refused', /outside/.test(o(', max_age_hours=-5')), o(', max_age_hours=-5'));

const y = readFileSync(join(root, '.github/workflows/pages.yml'), 'utf8');
check('E1 input exists, string, default empty', /plane_max_age_hours:[\s\S]{0,300}?type: string\s+default: ''/.test(y));
check('E2 env only from workflow_dispatch', /PLANE_MAX_AGE_HOURS: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.plane_max_age_hours \|\| '' \}\}/.test(y));
check('E3 the fetch check and the generator both honour the same value', /age > limit/.test(y) && /--plane-max-age-hours \$PLANE_MAX_AGE_HOURS/.test(y));
check('E4 a loud warning names the override', /IDENTITY-ONLY BUILD/.test(y));
check('E5 normal window is still 36 in the workflow and generator', /limit = 36\.0/.test(y) && /RULE_D_PLANE_MAX_AGE_HOURS = 36/.test(readFileSync(GEN, 'utf8')));
check('E6 ceiling enforced in both places', /1 <= limit <= 336/.test(y) && /RULE_D_PLANE_MAX_AGE_CEILING_HOURS = 336/.test(readFileSync(GEN, 'utf8')));
const f = spawnSync('python3', ['-I', GEN, '--fixture', 'x.json', '--plane-max-age-hours', '100'], { encoding: 'utf8' });
check('F refused with --fixture', /production-only/.test(f.stdout + f.stderr), f.stdout + f.stderr);
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
