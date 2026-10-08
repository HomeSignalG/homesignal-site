#!/usr/bin/env node
// A DECIDED APPLICATION BROWSES AS PROPOSED — IN EVERY RULE THAT MAPS A STORED STATUS TO A LIFECYCLE (2026-10-01).
//
// public.app_refresh_zip writes status 'Decided' for a record whose source stated a decision. Measured
// 2026-10-01 22:38Z over record_kind 'development' (2,930,690 rows): Operating 1,353,584 · Approved 1,206,058 ·
// Proposed 351,679 · Decided 19,364 · Active 5 (it was 0 Decided on 2026-09-20, before any connector stamped a
// decision). The decision-history contract (CLAUDE.md §7.05) says a denied application is a HISTORICAL PROPOSAL
// and stays in the Proposed browsing category; the engine's browsingBucketFor() always answers `proposed`.
//
// THREE places turn a stored status into a lifecycle, and only one of them knew:
//   lib/n5-radius.js      n5BucketFromStatus   'decided' -> 'proposed'  (Map 1 ZIP mode; had it since 2026-09-20)
//   lib/project-type.js   lifecycleKey         'decided' -> 'unknown'   <- the canonical vocabulary. WRONG.
//   lib/templates.js      statusKey            'decided' -> null        <- card bar fell to the impact heuristics, while
//                                                                          devCard() says it "keeps the Proposed styling"
// So a Decided row asked of the canonical vocabulary read "Lifecycle unknown", asserting we do not know its stage when
// we know it exactly. This file holds the three together. It does not unify them (they answer slightly different
// questions: n5 deliberately leaves 'Active' unknown, the other two read it as operating) — it makes any NEW
// disagreement a failing test instead of a silent one.
//
// What it must NOT do: the decision is never carried by the lifecycle, and a Decided row is still refused by every
// ACTIVE count (HS.isActiveUndecided). Both are pinned below, beside the fix, because "browses as Proposed" read
// carelessly is how a denied application would start counting as a live proposal.
//
// Every expectation is a literal. Run: node test/decided-lifecycle-parity.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let failures = 0;
let checks = 0;
const ok = (c, name, detail) => {
  checks++;
  if (c) console.log('PASS — ' + name);
  else { failures++; console.error('FAIL — ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
};
// A pin never matches the comment that quotes the code it forbids.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function load(files) {
  const win = { HS: {} };
  for (const f of files) new Function('window', 'document', read(f))(win, undefined);
  return win.HS;
}
const HS = load(['lib/project-type.js', 'lib/map.js', 'lib/n5-radius.js', 'lib/zip-authoritative.js', 'lib/templates.js']);
const HEX = HS.statusHex;

// ── §1 the closed stored vocabulary, one literal row per member ──────────────────────────────────
// [stored status, canonical key, n5 bucket, the card-bar colour it must take (null = not a lifecycle colour)]
const TABLE = [
  ['Proposed',  'proposed',  'proposed',  HEX.proposed],
  ['Decided',   'proposed',  'proposed',  HEX.proposed],
  ['Approved',  'approved',  'approved',  HEX.approved],
  ['Operating', 'operating', 'operating', HEX.operating],
  ['On file',   'unknown',   'unknown',   null],
  ['',          'unknown',   'unknown',   null],
];
ok(HEX && HEX.proposed === '#c47a1a' && HEX.approved === '#3f7fb0' && HEX.operating === '#1f9d5c',
  '1a the lifecycle colours are the ones this file expects (so a changed palette fails here, not silently)');
for (const [status, key, n5, bar] of TABLE) {
  const label = JSON.stringify(status);
  ok(HS.projectType.lifecycleKey(status) === key, `1b ${label}: canonical lifecycleKey -> ${key}`, HS.projectType.lifecycleKey(status));
  ok(HS.canonicalLifecycle({ status }).key === key, `1c ${label}: HS.canonicalLifecycle -> ${key}`);
  ok(HS.mapStatus({ status }).k === key, `1d ${label}: Map 1 statusTier -> ${key}`, HS.mapStatus({ status }).k);
  ok(HS.n5BucketFromStatus(status) === n5, `1e ${label}: Map 1 ZIP-mode bucket -> ${n5}`, HS.n5BucketFromStatus(status));
  const barColour = HS.barColor({ status, impact_score: 20 });
  if (bar) ok(barColour === bar, `1f ${label}: card bar takes the ${key} colour`, barColour);
  else ok(!Object.values(HEX).includes(barColour), `1f ${label}: card bar takes no lifecycle colour`, barColour);
}
ok(HS.canonicalLifecycle({ status: 'Decided' }).label === 'Proposed',
  '1g a Decided row is labelled "Proposed", never "Lifecycle unknown"', HS.canonicalLifecycle({ status: 'Decided' }).label);
ok(JSON.stringify(HS.projectType.LIFECYCLE_KEYS) === '["proposed","approved","operating","unknown"]'
   && !('decided' in HS.projectType.LIFECYCLE_LABELS),
  '1h Decided is NOT a fifth lifecycle: the keys stay four and no label exists for it');

// ── §2 the one divergence that is declared, not accidental ───────────────────────────────────────
// 'Active' (5 rows): the canonical vocabulary and the card bar read it as operating; n5BucketFromStatus deliberately
// does not (its comment: it is not one of the three lifecycle words). Pinned so it moves on purpose, either way.
ok(HS.projectType.lifecycleKey('Active') === 'operating' && HS.barColor({ status: 'Active', impact_score: 20 }) === HEX.operating
   && HS.n5BucketFromStatus('Active') === 'unknown',
  "2a 'Active' is the known divergence: operating / operating / unknown (a change to any of the three must be deliberate)");

// ── §3 the PATH THE PAGE TAKES: a ZIP-mode marker -> a tracker marker -> a pin ───────────────────
{
  const marker = { lat: 40.1, lng: -111.6, project_ref: 'p1', marker_rule: 'centroid' };
  const proj = (status) => ({ status, type: 'Industrial', name: 'Test plant', registry_id: 'r', source_ref: 'https://example.test/r/1', project_ref: 'p1' });
  const pin = (status) => HS.resolveTrackerMarker(HS.zipAuthSiteFromMarker(marker, proj(status)), () => '');
  const dec = pin('Decided');
  const prop = pin('Proposed');
  ok(dec.lifecycle === 'proposed' && dec.lifecycleLabel === 'Proposed',
    '3a a Decided ZIP-mode project draws as a Proposed pin', dec.lifecycle + '/' + dec.lifecycleLabel);
  ok(['lifecycle', 'color', 'shape', 'filterKey', 'typeKey', 'statusKey'].every((k) => dec[k] === prop[k]),
    '3b a Decided pin is byte-identical to a Proposed pin on lifecycle, colour, shape, filter, type and status key');
  const none = pin('On file');
  ok(none.lifecycle === 'unknown', '3c control: a status that states nothing is still Lifecycle unknown', none.lifecycle);
}

// ── §4 browsing is not eligibility: Decided is still refused from every ACTIVE count ─────────────
ok(HS.isActiveUndecided({ status: 'Proposed' }) === true, '4a control: a Proposed row counts as an active undecided proposal');
ok(HS.isActiveUndecided({ status: 'Decided' }) === false, '4b a Decided row is NOT an active undecided proposal');
ok(HS.isActiveUndecided({ status: 'Decided', bucket: 'proposed' }) === false, '4c a Decided row stays refused when its bucket says proposed');
ok(HS.activeUndecidedCount([{ status: 'Proposed' }, { status: 'Decided' }, { status: 'Decided' }, { status: 'Approved' }]) === 1,
  '4d three proposals-or-decided rows and one approved count as exactly ONE active undecided proposal');

// ── §5 a decision never moves the pin ────────────────────────────────────────────────────────────
{
  const denied = { outcome: 'denied', source_url: 'https://example.test/decision/1' };
  const withDecision = HS.resolveMarker({ type: 'Industrial', use_type: 'Industrial', name: 'x', status: 'Proposed', decision: denied });
  const without = HS.resolveMarker({ type: 'Industrial', use_type: 'Industrial', name: 'x', status: 'Proposed' });
  ok(withDecision.lifecycle === 'proposed' && withDecision.lifecycle === without.lifecycle && withDecision.color === without.color,
    '5a a sourced denial leaves lifecycle and colour exactly where a plain Proposed row has them');
  ok(withDecision.isActiveUndecided === false && without.isActiveUndecided === true,
    '5b ...and is the only thing that takes it out of the active count');
}

// ── §6 where the rule lives (comment-stripped, anchored to the function it is about) ─────────────
{
  const pt = code(read('lib/project-type.js'));
  const lk = pt.slice(pt.indexOf('function lifecycleKey'), pt.indexOf('function canonicalLifecycle'));
  ok(/s === 'proposed' \|\| s === 'decided'\) \? 'proposed'/.test(lk) && (lk.match(/decided/g) || []).length === 1,
    '6a lifecycleKey maps decided -> proposed, once, and nowhere else in the function');
  const tp = code(read('lib/templates.js'));
  const sk = tp.slice(tp.indexOf('function statusKey'), tp.indexOf('function barColor'));
  ok(/s === 'proposed' \|\| s === 'decided'\) \? 'proposed'/.test(sk) && (sk.match(/decided/g) || []).length === 1,
    '6b statusKey (the card bar) maps decided -> proposed, once');
  const n5 = code(read('lib/n5-radius.js'));
  ok(/if \(s === 'decided'\) return 'proposed';/.test(n5), '6c n5BucketFromStatus maps decided -> proposed (unchanged)');
  const mp = code(read('lib/map.js'));
  const ia = mp.slice(mp.indexOf('HS.isActiveUndecided = function'), mp.indexOf('const DEC_MONTHS'));
  ok(/toLowerCase\(\) === 'decided'\) return false;/.test(ia),
    '6d isActiveUndecided still refuses a Decided status by name');
}

console.log('\n' + (checks - failures) + ' passed, ' + failures + ' failed of ' + checks);
process.exit(failures ? 1 : 0);
