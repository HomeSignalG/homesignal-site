// The lifecycle value is read from the field that CARRIES it — `status` on a national
// data-centre record, `type` everywhere else — and never from `bucket`.
//
// This pins a defect that sat red on 7 of 12 representative ZIPs: `lifecycleValueRecognised`
// read `site.type` alone, so the national plane's project CATEGORY ('datacenter') was judged
// as a lifecycle and reported as unrecognised. Correspondence with the national plane was
// exact in BOTH directions on 2026-09-21 — every failing ZIP's failure count equalled its
// `national_dc_for_zip` record count (60601 12, 85004 7, 98101 6, 80202 3, and 78617 /
// 02138 / 58102 at 1 each) and all five ZIPs with zero national records passed.
import { createRequire } from 'node:module';
import {
  lifecycleRaw,
  lifecycleRail,
  lifecycleValueRecognised,
  LIFECYCLE_BUCKETS,
} from '../scripts/lib/verify-dev-helpers.mjs';

let failed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; } else { console.log('ok:', msg); }
}

// (1) THE DEFECT. A national record verbatim in the shape lib/data.js built until 2026-09-27:
// `type` is the CATEGORY, the lifecycle is in `status`.
const national = { relevance: 'development', type: 'datacenter', status: 'Operating',
                   record_kind: 'national_project' };
ok(lifecycleRaw(national) === 'operating', 'national record reads its lifecycle from status');
ok(lifecycleValueRecognised(national), 'national record is RECOGNISED (was the false failure)');
ok(lifecycleRail(national) === 'built', 'national Operating rails to built');
ok(lifecycleValueRecognised({ type: 'datacenter', status: 'Approved' }), 'national Approved recognised');
ok(lifecycleRail({ type: 'datacenter', status: 'Approved' }) === 'approved', 'national Approved rails');

// (1b) THE SHAPE lib/data.js BUILDS SINCE 2026-09-27, built by the SHIPPED HS.map1DcSite (never
// hand-written, so this cannot drift from the real mapper): the lifecycle key is in `type` and
// `bucket`, the Type in `use_type`, and `status` still carries map_status.
{
  const require = createRequire(import.meta.url);
  global.window = { HS: {}, HS_CONFIG: { DATA_SOURCE: 'supabase', DEFAULT_ZIP: '20187' },
                    supabase: { createClient: () => ({}) } };
  require('../lib/data.js');
  require('../lib/project-type.js');
  const map = global.window.HS.map1DcSite;
  const row = (st) => ({ source_key: 'dc:x', source_url: 'https://e.x/r', project_name: 'A Campus',
    map_status: st, project_type: 'datacenter', zip_membership: 'member', lat: 1, lng: 1 });
  ok(typeof map === 'function', 'the shipped HS.map1DcSite loads (positive control)');
  for (const [st, key, rail] of [['Operating', 'operating', 'built'], ['Approved', 'approved', 'approved'],
                                 ['Proposed', 'proposed', 'proposed']]) {
    const site = map(row(st));
    ok(site.type === key && lifecycleRaw(site) === key && lifecycleValueRecognised(site) && lifecycleRail(site) === rail,
      `current-shape national ${st} reads ${key} and rails to ${rail}`);
  }
  const unk = map(row('Unknown'));
  ok(unk.type === 'unknown' && lifecycleValueRecognised(unk) && lifecycleRail(unk) === null,
    'current-shape national Unknown is recognised and belongs to no rail');
}

// (2) NO-OP FOR EVERY OTHER PLANE. Cached engine sites and authoritative markers carry no
// `status` key at all — measured over 237,713 cached sites across 1,481 ZIPs: 0 with a
// `status` key, against a control of 237,713 carrying `type`.
for (const t of ['built', 'operating', 'approved', 'proposed', 'unknown', 'onfile']) {
  ok(lifecycleRaw({ type: t }) === t, `cached site with type=${t} still reads type`);
  ok(lifecycleValueRecognised({ type: t }), `cached site with type=${t} recognised`);
}
ok(lifecycleRaw({ type: 'proposed', bucket: 'proposed' }) === 'proposed',
  'authoritative marker (type===bucket) unchanged');
ok(lifecycleValueRecognised({}) && lifecycleRaw({}) === '', 'honest absence still passes');
ok(!lifecycleValueRecognised({ type: 'mystery-value' }), 'a genuinely unmapped type STILL fails');

// (3) THE OVER-FLAGGING DIRECTION, WHICH IS WHY `bucket` IS EXCLUDED. lib/map.js's
// isActiveUndecided reads `bucket` first because it answers an ELIGIBILITY question and is
// decision-aware. `bucket` carries the §7.05 DECISION vocabulary, which is NOT lifecycle
// vocabulary: a denied proposal is bucket:'denied' with lifecycle type:'proposed'. Measured
// on the panel's cached corpus: 52 withdrawn + 6 denied sit over type:'proposed'. Reading
// bucket here would have invented 58 failures while fixing 31.
for (const decided of ['denied', 'withdrawn']) {
  ok(!LIFECYCLE_BUCKETS.has(decided), `${decided} is NOT lifecycle vocabulary`);
  const site = { relevance: 'development', bucket: decided, type: 'proposed' };
  ok(lifecycleRaw(site) === 'proposed', `bucket='${decided}' does not displace the lifecycle`);
  ok(lifecycleValueRecognised(site), `a ${decided} proposal is still lifecycle-recognised`);
  ok(lifecycleRail(site) === 'proposed', `a ${decided} proposal still rails to proposed`);
}

// (4) STRUCTURAL: neither function may go back to reading `type` alone, and neither may
// start reading `bucket`. A behavioural test cannot see a second copy of the precedence.
const src = (await import('node:fs')).readFileSync(
  new URL('../scripts/lib/verify-dev-helpers.mjs', import.meta.url), 'utf8');
const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
for (const fn of ['lifecycleRail', 'lifecycleValueRecognised']) {
  const m = new RegExp(`export function ${fn}\\(site\\)\\s*\\{([\\s\\S]*?)\\n\\}`).exec(body);
  ok(!!m, `${fn} is present (positive control for the slice)`);
  ok(m && /lifecycleRaw\(site\)/.test(m[1]), `${fn} derives via lifecycleRaw`);
  ok(m && !/site\.type/.test(m[1]), `${fn} does not read site.type directly`);
}
const rawFn = /export function lifecycleRaw\(site\)\s*\{([\s\S]*?)\n\}/.exec(body);
ok(!!rawFn, 'lifecycleRaw is present');
ok(rawFn && !/\bbucket\b/.test(rawFn[1]), 'lifecycleRaw does NOT read bucket (decision vocabulary)');
ok(rawFn && /\.status\b/.test(rawFn[1]) && /\.type\b/.test(rawFn[1]),
  'lifecycleRaw reads status and type');

if (failed) { console.error('\n' + failed + ' failure(s)'); process.exit(1); }
console.log('\nAll lifecycle-raw national-plane tests passed.');
