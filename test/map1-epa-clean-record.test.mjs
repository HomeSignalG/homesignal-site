// MAP 1 AND THE ZIP PAGE CLAIM A CLEAN EPA RECORD ONLY ON EPA'S OWN "NO VIOLATION IDENTIFIED" (2026-11-09).
//
// WHY THIS FILE EXISTS. homesignalmap.html's envSignals used to print
// "no recorded EPA violations" for any FRS facility that lacked a stronger
// signal. That is a positive fact about EPA compliance. It is true ONLY while
// ECHO data is present AND compliance tracking is on — the rule HS.fac.signals
// already enforces on the ZIP page. Without that check, ECHO-failed, unmatched,
// CWA-only, and tracking-off sites all rendered as a clean record (audit
// 2026-09-27: 199,409 stored facility sites). Attacks 15 and 16 succeeded on
// Map 1 and failed on the ZIP page because the two surfaces decided the same
// fact two different ways.
//
// The functions are EXTRACTED FROM THE SHIPPED PAGE and driven, not re-read
// as comments. HS.fac.interpret is the one tracking rule; Map 1 must call it.
//
// Run: node test/map1-epa-clean-record.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const pageSrc = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
const grabFn = (name) => {
  const i = pageSrc.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('not found in homesignalmap.html: ' + name);
  let depth = 0, j = pageSrc.indexOf('{', i);
  for (let k = j; k < pageSrc.length; k++) {
    if (pageSrc[k] === '{') depth++;
    else if (pageSrc[k] === '}') { depth--; if (depth === 0) return pageSrc.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
};
const grabAssign = (name) => {
  const i = pageSrc.indexOf('var ' + name + ' = ');
  if (i === -1) throw new Error('not found: var ' + name);
  const start = pageSrc.indexOf('=', i) + 1;
  let depth = 0, end = start;
  for (; end < pageSrc.length; end++) {
    const ch = pageSrc[end];
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === ';' && depth === 0) return pageSrc.slice(i, end + 1);
  }
  throw new Error('unterminated: ' + name);
};

const g = globalThis;
const prevWindow = g.window;
g.window = { HS: {} };
new Function(readFileSync(join(root, 'lib/templates.js'), 'utf8')).call(g);
const HS = g.window.HS;
g.HS = HS;

const envApi = (0, eval)(
  '(function(HS){\n' +
  grabFn('frsRid') + '\n' +
  grabFn('tceqRn') + '\n' +
  grabFn('hasEnvRecord') + '\n' +
  grabAssign('ENV_STATUTE_WORD') + '\n' +
  grabAssign('ENV_TCEQ_PROGRAMS') + '\n' +
  grabAssign('ENV_TONE_RANK') + '\n' +
  grabFn('envProgramMeaning') + '\n' +
  grabFn('envSignals') + '\n' +
  'return { envSignals: envSignals };\n' +
  '})'
)(HS);
const envSignals = envApi.envSignals;

const site = (over) => Object.assign({
  scope: 'point',
  registry_id: '110000000001',
  label: 'Fixture Plant',
}, over);

const texts = (s) => envSignals(s).map((g) => g.text);
const CLEAN_RE = /no current violation|no recorded EPA violations/i;
const hasClean = (s) => texts(s).some((t) => CLEAN_RE.test(t));
// An ECHO compliance match for this facility, as interpretEcho stores it.
const echo = (over) => Object.assign({ in_violation: [], no_violation: ['CWA', 'CAA'], current_as_of: '2026-11-09' }, over);

ok(typeof envSignals === 'function' && typeof HS.fac.noViolationLine === 'function',
  'control — extracted envSignals and loaded HS.fac.noViolationLine');
ok(/HS\.fac\.noViolationLine\(epa\)/.test(pageSrc) && !/interp\.tracking\s*===\s*true/.test(pageSrc),
  'Map 1 asks the one shared rule; tracking alone no longer decides');
ok(!/no recorded EPA violations \(compliance tracking on\)/.test(pageSrc + readFileSync(join(root, 'lib/templates.js'), 'utf8')),
  'the tracking-only sentence is gone from both surfaces');

// ── unknown: no sentence ─────────────────────────────────────────────────────
ok(!hasClean(site({})), 'FRS id only (ECHO failed / not queried) is NOT a clean record', texts(site({})));
ok(!hasClean(site({ env: { link_type: 'geo_matched' } })), 'geo_matched with no epa block is NOT a clean record');
ok(!hasClean(site({ env: { epa: { in_violation: [], permit_status: 'Effective', compliance_tracking_on: true } } })),
  'CWA permit Effective + tracking on, but no ECHO compliance match (beyond the 500-row / 5-mile lookup) is NOT a clean record');
ok(!hasClean(site({ env: { epa: { in_violation: [] } } })), 'an ECHO block with no date and no statute status is NOT a clean record');
ok(!hasClean(site({ env: { epa: echo({ no_violation: [] }) } })),
  'ECHO matched but listed no statute as "No Violation Identified" (blank / Not Applicable / Terminated) is NOT a clean record');
ok(!hasClean(site({ env: { epa: echo({ current_as_of: undefined }) } })), 'a statute list with no date is NOT a clean record');
ok(!hasClean(site({ env: { epa: echo({ no_violation: ['CWA'], compliance_tracking_on: false, permit_status: 'Terminated' }) } })),
  'a Clean Water Act "no violation" on a permit EPA no longer tracks is NOT a clean record');
ok(!hasClean(site({ env: { epa: echo({ snc: true }) } })), 'significant non-compliance suppresses the clean line');
ok(!hasClean(site({ env: { epa: echo({ quarters_nc: 2 }) } })), 'quarters out of compliance suppress the clean line');
ok(!hasClean(site({ env: { epa: echo({ in_violation: ['CWA'] }) } })), 'an open violation suppresses the clean line');
ok(!hasClean(site({ tceq_rn: 'RN123', env: { tceq: { programs: ['AIRNSR'] } } })), 'TCEQ-only does not invent an EPA clean line');

// ── known: the sentence names the laws and the date ──────────────────────────
{
  const t = texts(site({ env: { epa: echo({}) } }));
  ok(t.length === 1 && t[0] === 'EPA lists no current violation under the Clean Water Act and Clean Air Act (ECHO, checked Nov 9, 2026)',
    'an ECHO "No Violation Identified" match is the clean line, naming the laws and the date', t);
  const one = texts(site({ env: { epa: echo({ no_violation: ['RCRA'], current_as_of: '2026-03-02' }) } }));
  ok(one[0] === 'EPA lists no current violation under the hazardous-waste law (RCRA) (ECHO, checked Mar 2, 2026)',
    'only the laws ECHO cleared are named', one);
  const drop = texts(site({ env: { epa: echo({ no_violation: ['CWA', 'RCRA'], compliance_tracking_on: false }) } }));
  ok(drop[0] && /hazardous-waste law/.test(drop[0]) && !/Clean Water/.test(drop[0]),
    'a tracking-off CWA permit drops only the Clean Water Act from the sentence', drop);
}
{
  const s = site({ viol: 2 });
  ok(texts(s).join(' ').includes('2 recorded violations'), 'legacy viol>0 still surfaces as recorded violations', texts(s));
  ok(!hasClean(s), 'a viol count never also claims a clean record');
}

// ── parity with the ZIP page / dossier (HS.fac.signals) ──────────────────────
const cases = [
  { epa: echo({}) },
  { epa: echo({ no_violation: [] }) },
  { epa: echo({ current_as_of: null }) },
  { epa: { in_violation: [], permit_status: 'Effective', compliance_tracking_on: true } },
  { epa: echo({ no_violation: ['CWA'], compliance_tracking_on: false }) },
  { epa: echo({ in_violation: ['CAA'] }) },
  { epa: { in_violation: [] } },
  {},
];
for (const fenv of cases) {
  const zipClean = HS.fac.signals(fenv).some((g) => CLEAN_RE.test(g.text));
  const mapClean = hasClean(site({ env: fenv }));
  ok(zipClean === mapClean, `parity — ZIP page and Map 1 agree on clean-line for ${JSON.stringify(fenv.epa || {})}`, `zip=${zipClean} map=${mapClean}`);
}

if (prevWindow === undefined) delete g.window; else g.window = prevWindow;

console.log(fails === 0 ? '\nALL PASS — map1-epa-clean-record' : `\n${fails} FAILURE(S) — map1-epa-clean-record`);
process.exit(fails === 0 ? 0 : 1);
