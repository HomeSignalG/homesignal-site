// MAP 1 MUST NOT CLAIM A CLEAN EPA RECORD WITHOUT COMPLIANCE TRACKING.
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
const hasClean = (s) => texts(s).some((t) => /no recorded EPA violations/i.test(t));

ok(typeof envSignals === 'function' && typeof HS.fac.interpret === 'function',
  'control — extracted envSignals and loaded HS.fac.interpret');

ok(/HS\.fac\.interpret/.test(pageSrc) && /interp\.tracking\s*===\s*true/.test(pageSrc),
  'Map 1 asks HS.fac.interpret for tracking, same rule as the ZIP page');

ok(!/out\.push\(lv>0 \? \{ text: lv\+" recorded violation"/.test(pageSrc),
  'the unguarded FRS-id fallback (false clean line) is gone');

// ── the cases the audit named ────────────────────────────────────────────────
ok(!hasClean(site({})),
  'FRS id only (ECHO failed / no env) is NOT a clean record',
  texts(site({})));

ok(!hasClean(site({ env: { link_type: 'geo_matched' } })),
  'geo_matched with no epa block is NOT a clean record');

ok(!hasClean(site({ env: { epa: { in_violation: [] } } })),
  'ECHO answered but tracking unknown is NOT a clean record');

ok(!hasClean(site({
  env: { epa: { in_violation: [], permit_status: 'Terminated', compliance_tracking_on: false } },
})),
  'Terminated / tracking off is NOT a clean record');

ok(!hasClean(site({
  env: { epa: { in_violation: [], permits: [{ npdes_id: 'TX000', status: 'Denied' }] } },
})),
  'CWA-only unknown status (Denied) is NOT a clean record');

ok(!hasClean(site({ tceq_rn: 'RN123', env: { tceq: { programs: ['AIRNSR'] } } })),
  'TCEQ-only does not invent an EPA clean line');

{
  const s = site({
    env: { epa: { in_violation: [], permit_status: 'Effective', compliance_tracking_on: true } },
  });
  ok(hasClean(s),
    'tracking ON + no violations IS the clean line',
    texts(s));
  ok(texts(s).some((t) => /compliance tracking on/.test(t)),
    'the clean line names that tracking is on — same words as HS.fac.signals');
}

{
  const s = site({ viol: 2 });
  ok(texts(s).join(' ').includes('2 recorded violations'),
    'legacy viol>0 still surfaces as recorded violations',
    texts(s));
  ok(!hasClean(s), 'a viol count never also claims a clean record');
}

{
  const s = site({
    env: { epa: { in_violation: ['CWA'], action_year: '2024', permit_status: 'Effective', compliance_tracking_on: true } },
  });
  ok(texts(s).some((t) => /open water violation/.test(t)),
    'an open violation is the headline, not the clean line',
    texts(s));
  ok(!hasClean(s), 'open violations suppress the clean line');
}

// ── parity with the ZIP page for the clean-line decision ─────────────────────
const cases = [
  { epa: { in_violation: [], permit_status: 'Effective', compliance_tracking_on: true } },
  { epa: { in_violation: [], permit_status: 'Expired', compliance_tracking_on: true } },
  { epa: { in_violation: [], permit_status: 'Terminated', compliance_tracking_on: false } },
  { epa: { in_violation: [], permit_status: 'Pending', compliance_tracking_on: false } },
  { epa: { in_violation: [] } },
  { epa: { in_violation: ['CAA'], permit_status: 'Effective', compliance_tracking_on: true } },
  {},
];
for (const fenv of cases) {
  const zipClean = HS.fac.signals(fenv).some((g) => /no recorded EPA violations/i.test(g.text));
  const mapClean = hasClean(site({ env: fenv }));
  ok(zipClean === mapClean,
    `parity — ZIP page and Map 1 agree on clean-line for ${JSON.stringify(fenv.epa || {})}`,
    `zip=${zipClean} map=${mapClean}`);
}

if (prevWindow === undefined) delete g.window; else g.window = prevWindow;

console.log(fails === 0 ? '\nALL PASS — map1-epa-clean-record' : `\n${fails} FAILURE(S) — map1-epa-clean-record`);
process.exit(fails === 0 ? 0 : 1);
