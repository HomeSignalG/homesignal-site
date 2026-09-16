// MAP 1 ZIP-STATE GATE — the producer->page-state mapping, proven offline in both directions.
// No browser, no network, no DB.
//
// WHY THIS TEST EXISTS. scripts/verify-map1-zip-states.mjs hardcoded each control ZIP's state
// in a literal list captured once and commented "Verified against production before this run".
// ZIP 08005 then moved from `pending` to a measured zero, and the gate reported the page as
// broken for nine days across nine unrelated branches — two red assertions, both false, on a
// page that was correct. The kind is now RESOLVED from the producer per run; this pins the
// mapping that does the resolving, and pins that the gate can still tell a resolution failure
// from a contract failure.
import { readFileSync } from 'node:fs';
import { kindFromProducer, ZIP_STATE_KINDS } from '../scripts/lib/zip-state-kind.mjs';

const GATE = readFileSync(new URL('../scripts/verify-map1-zip-states.mjs', import.meta.url), 'utf8');
const strip = (src) => src
  .replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1 ')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
const CODE = strip(GATE);

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m); } };

// ── 1 · the four real shapes, verbatim from production 2026-09-15 ───────────────────────────
ok(kindFromProducer({ zip: '94128', mode: 'authoritative', status: 'unknown', projects: null, markers: null })
   === 'pending', '1a: status "unknown" (no producer row) is the PENDING state');
ok(kindFromProducer({ zip: '01004', mode: 'authoritative', status: 'not_measured', projects: null, markers: null })
   === 'not_measured', '1b: an explicit not_measured stays not_measured');
ok(kindFromProducer({ zip: '01001', status: 'boundary_complete', project_count: 12, marker_count: 12 })
   === 'authoritative', '1c: boundary_complete with projects is AUTHORITATIVE');
ok(kindFromProducer({ zip: '01009', status: 'boundary_complete', project_count: 0, marker_count: 0 })
   === 'measured_zero', '1d: boundary_complete with zero projects is a MEASURED ZERO');

// ── 2 · the exact regression that caused the nine-day false red ──────────────────────────────
// 08005's real payload today. The old gate called this `pending` from a literal; the mapping
// calls it what the producer says it is.
const eight = { zip: '08005', mode: 'authoritative', status: 'boundary_complete',
                project_count: 0, marker_count: 0, membership_count: 0 };
ok(kindFromProducer(eight) === 'measured_zero',
   '2a: 08005 resolves to measured_zero — the state it actually has');
ok(kindFromProducer(eight) !== 'pending',
   '2b: …and is NOT pending, which is the assertion that was failing falsely');

// ── 3 · a failed or unrecognised read is NOT a state ─────────────────────────────────────────
// This is the half that keeps a false GREEN out: guessing a kind here would assert the wrong
// contract against a real page and report the verdict as fact.
ok(kindFromProducer(null) === null, '3a: a null payload resolves to nothing');
ok(kindFromProducer(undefined) === null, '3b: undefined resolves to nothing');
ok(kindFromProducer('boundary_complete') === null, '3c: a bare string is not a payload');
ok(kindFromProducer([]) === null, '3d: an array is not a payload');
ok(kindFromProducer({}) === null, '3e: a payload with no status resolves to nothing');
ok(kindFromProducer({ status: 'partially_measured' }) === null,
   '3f: a NOVEL status is unresolvable — the allow-list is not a catch-all');
ok(kindFromProducer({ status: 'boundary_complete' }) === null,
   '3g: complete with NO count is not a measurement (same refusal zipAuthOutcome makes)');
ok(kindFromProducer({ status: 'boundary_complete', project_count: null }) === null,
   '3h: complete with a NULL count is not a measurement either');
ok(kindFromProducer({ status: 'boundary_complete', project_count: '3' }) === null,
   '3i: a stringy count is not trusted — no coercion');

// ── 4 · every state the gate asserts has a mapping, and vice versa ───────────────────────────
const produced = new Set([
  kindFromProducer({ status: 'unknown' }),
  kindFromProducer({ status: 'not_measured' }),
  kindFromProducer({ status: 'boundary_complete', project_count: 1 }),
  kindFromProducer({ status: 'boundary_complete', project_count: 0 }),
]);
ok(ZIP_STATE_KINDS.every((k) => produced.has(k)),
   '4a: every declared kind is reachable from a real producer status');
ok(produced.size === ZIP_STATE_KINDS.length,
   '4b: and the mapping produces no kind the gate does not declare');

// ── 5 · the GATE ITSELF no longer hardcodes a kind ───────────────────────────────────────────
ok(!/\{\s*zip:\s*'\d{5}'\s*,\s*kind:\s*'/.test(CODE),
   '5a: no { zip, kind } literal survives — the defect was a hardcoded pair');
ok(/const CASES = KINDS\s*\n?\s*\.map\(/.test(CODE),
   '5b: CASES is derived from the resolved producer states');
ok(/await resolveKind\(zip\)/.test(CODE),
   '5c: every candidate is resolved against the producer at run time');

// ── 6 · the two failure classes stay DISTINGUISHABLE ─────────────────────────────────────────
// A read that could not resolve and a page that broke its contract need different fixes, and
// this gate has already had one misfiled as the other.
ok(/COVERAGE: no candidate ZIP is currently in the/.test(GATE),
   '6a: an unexercised state fails LOUDLY rather than passing vacuously');
ok(/COVERAGE/.test(GATE) && /went UNTESTED this run/.test(GATE),
   '6b: …and says it went untested, so it cannot be read as the page being broken');
ok(/every candidate ZIP resolved to a known producer state/.test(GATE),
   '6c: an unresolvable producer read is its own reported failure');

// ── 7 · the candidate pool still covers all four states ──────────────────────────────────────
const pool = (CODE.match(/const CANDIDATES = \[([\s\S]*?)\]/) || [])[1] || '';
const zips = pool.match(/'\d{5}'/g) || [];
ok(zips.length >= 4, '7a: the candidate pool is populated', );
ok(zips.length > ZIP_STATE_KINDS.length,
   '7b: it is REDUNDANT — more candidates than states, so one ZIP graduating costs no coverage');

// ── 8 · READINESS: the gate waits for the RENDER, not for a variable to exist ────────────────
// The defect this pins was measured in production: one write to __HS_SITES per load, landing at
// 4105-5343ms on 01001/01009 and 681-927ms on 01004/94128, while the gate measured at ~3000ms.
// It read before the only write on the two heavy ZIPs and called an unfinished page empty.
ok(!/__HS_SITES !== undefined/.test(CODE),
   '8a: the bare "defined" readiness check is gone — it is satisfiable before the render');
ok(!/waitForTimeout\(3000\)/.test(CODE),
   '8b: the fixed 3s sleep is gone — a bigger guess is still a guess');
ok(/async function waitForRenderSettled\(/.test(CODE) && /const settle = await waitForRenderSettled\(page\)/.test(CODE),
   '8c: it waits for the render to SETTLE, and that wait is actually called');
ok(/Array\.isArray\(window\.__HS_SITES\)/.test(CODE),
   '8d: readiness requires an ARRAY, not merely a defined name');
ok(/Date\.now\(\) - lastChange >= quietMs/.test(CODE),
   '8e: settling means the value STOPPED CHANGING, not that time passed');
ok(/ok\(settle\.settled,/.test(CODE) && /NEVER SETTLED/.test(GATE),
   '8f: a page that never settles is a VISIBLE failure, never a silent skip');
// The masking question, answered structurally: a genuinely empty ZIP settles at 0 and still
// runs every assertion, because the skip is keyed on NOT SETTLING, never on being empty.
ok(!/if \(settle\.n === 0\)/.test(CODE) && /if \(!settle\.settled\) \{/.test(CODE),
   '8g: only a NON-SETTLING page is skipped — an empty one is still fully asserted');

// ── 9 · THE TWO FAILURE SENTENCES ARE DIFFERENT, AND THE GATE NOW KNOWS BOTH ─────────────────
// Cross-file pin. The page has two distinct failure copies; this gate only ever matched one, so
// an honest "the page could not load" was scored as a contract violation. These assertions read
// the SHIPPED page and would fail if either sentence were reworded away from the pattern.
const PAGE = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const catchLit = (PAGE.match(/status\("(Couldn't load ZIP )" \+ zip \+ "([^"]*)"/) || []);
ok(catchLit.length === 3, '9a: located the page\'s own outer-catch sentence', catchLit[1] || 'NOT FOUND');
const rendered = (catchLit[1] || '') + '01001' + (catchLit[2] || '');
const loadFailedRe = /Couldn't load ZIP/i;
const couldNotReadRe = /could not be read/i;
ok(loadFailedRe.test(rendered),
   '9b: the gate\'s loadFailed pattern MATCHES the page\'s real sentence', JSON.stringify(rendered.slice(0, 48)));
ok(!couldNotReadRe.test(rendered),
   '9c: …and couldNotRead does NOT — which is exactly why a failed load was misfiled');
ok(couldNotReadRe.test('Development coverage for 01001 could not be read just now.'),
   '9d: couldNotRead still matches zipAuthNote\'s sentence — it was never wrong, only incomplete');
ok(/loadFailed: \/Couldn't load ZIP\/i\.test\(txt\)/.test(GATE),
   '9e: the gate reads that sentence off the page');
ok(/INFRASTRUCTURE: \$\{c\.zip\} reported a failed load/.test(GATE) && /NOTHING was verified/.test(GATE),
   '9f: a failed load is reported as INFRASTRUCTURE, never as a contract result');
ok(/if \(m\.loadFailed\) \{[\s\S]{0,400}?continue;/.test(CODE),
   '9g: …and the state assertions are SKIPPED rather than run against a page that never loaded');

console.log(`\n${n - bad}/${n} passed`);
if (bad) process.exit(1);
