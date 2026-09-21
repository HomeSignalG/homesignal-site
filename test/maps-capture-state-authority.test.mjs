// ═══════════════════════════════════════════════════════════════════════════════════════
// "DOES THIS DRAFT OWE A MAP SCREENSHOT" HAS ONE ANSWER, DERIVED FROM THE ROW
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// ⚖️ FOUNDER RULING, 2026-09-21, STATED THREE TIMES BEFORE IT WAS IMPLEMENTED: **every
// MAPS post gets a map, even when there is no data centre.** An absence post — the honest
// "no qualifying filings here" answer — is photographed like any other, and this file now
// pins that. It previously pinned the exact opposite, and the flip is deliberate.
//
// 🔑 THE ERROR THE RULING CORRECTS IS ONE SUBSTITUTION: "there is no PROJECT to photograph"
// was read as "there is no MAP to photograph". A ZIP's Map 1 page renders whether or not a
// data centre has ever been filed there, and a screenshot of that page — Data center the
// only PROJECT TYPE, nothing drawn — is a real picture of a real page saying exactly what
// the post says in words. Three separate files had written the substitution down, which is
// why the instruction kept being re-derived away:
//
//   homesignal-ingest bluesky/lib/maps-image-state.mjs -> NOT_REQUIRED for an absence
//   lib/maps-capture-policy.js::mapsDcCapturePolicyApplies -> false for an absence
//   lib/maps-capture-binding.js::mapsCaptureState -> INELIGIBLE for an absence
//
// THE EARLIER DEFECT THIS FILE WAS WRITTEN FOR IS STILL REAL AND STILL PINNED (§3).
// Measured on production 2026-09-21: an absence draft read "AWAITING MAP CAPTURE" until the
// capture worker in the OTHER repo happened to visit it and stamp `evidence.visual`, after
// which it read CAPTURE_INELIGIBLE. Two rows it had reached, sixteen it had not; identical
// rows, opposite answers, decided by whether another repo's scheduled job had run.
//
// 🔑 THE PROPERTY THIS FILE PINS IS "DERIVED, NOT STAMPED". §3 is the load-bearing one: an
// absence row with NO `evidence.visual` at all must report the same state as one carrying
// the worker's stamp — INCLUDING a stamp left by the superseded rule. A test that only
// checked one of the two rows would have passed on the broken code, and would pass now on
// code that read a stale CAPTURE_INELIGIBLE back out of the row.
//
// ⛔ NO PRODUCTION ZIP, ROW ID OR PLACE NAME APPEARS HERE. The witness is a synthetic
// unseen geography, so adding a ZIP, county or state requires no edit to this file.
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || globalThis;
for (const f of ['../lib/map.js', '../lib/maps-social-theme.js', '../lib/maps-capture-policy.js',
                 '../lib/maps-capture-binding.js']) {
  (0, eval)(readFileSync(new URL(f, import.meta.url), 'utf8'));
}
const HS = globalThis.window.HS;
const S = HS.MAPS_CAPTURE_STATES;

let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (cond) console.log('PASS — ' + msg); else { bad++; console.log('FAIL — ' + msg); } };

const ZIP = '99999';

// ── THE FOUR SHAPES ──────────────────────────────────────────────────────────────────
// A project-backed Data Center Theme draft: has a project, so it owes the real Map 1
// screenshot and Approve is blocked until one exists.
const CASE_A = {
  id: 'a', content_family: 'MAPS', tile: 'development', status: 'draft', zip: ZIP,
  post_text: 'x', image_bucket_path: null,
  evidence: {
    theme: 'datacenter', project_id: 'p-1', type: 'Data center', type_raw: 'DATA CENTER',
    status: 'Proposed', lat: 44.1, lng: -121.1,
    map_zip: ZIP, map_zip_label: 'Northfell (99999)',
  },
};

// An ABSENCE draft: no project at all — and, since the ruling, still a ZIP whose Map 1 page
// is the picture it is owed.
const CASE_B = {
  id: 'b', content_family: 'MAPS', tile: 'development', status: 'draft', zip: ZIP,
  post_text: 'x', image_bucket_path: null,
  evidence: {
    theme: 'datacenter', theme_answer: 'none_found', scan_complete: true, rows_scanned: 12,
    map_zip: ZIP, map_zip_label: 'Northfell (99999)',
  },
};

// The SAME absence row as the SUPERSEDED capture worker left it. This exact stamp is what
// sits on production rows written before the ruling, and the sentence in `failure_reason` is
// the one the founder was reading off the Acquisition Dashboard when they corrected it.
const CASE_B_STAMPED = {
  ...CASE_B, id: 'b2',
  evidence: {
    ...CASE_B.evidence,
    visual: {
      state: S.INELIGIBLE, status: 'NO_PROJECT_SPECIFIC_VISUAL', attempts: 0,
      failure_reason: 'the draft carries no project_id, so there is nothing to photograph',
    },
  },
};

// An ordinary MAPS draft — a real project, but NOT the Data Center Theme. It publishes the
// link card, whose image belongs to the destination page, so no capture is mandatory.
const CASE_C = {
  id: 'c', content_family: 'MAPS', tile: 'development', status: 'draft', zip: ZIP,
  post_text: 'x', image_bucket_path: null,
  evidence: {
    theme: null, project_id: 'p-2', type: 'Residential', type_raw: 'SINGLE FAMILY',
    status: 'Proposed', map_zip: ZIP, map_zip_label: 'Northfell (99999)',
  },
};

// Malformed: MAPS-shaped but carrying no evidence at all.
const CASE_D = {
  id: 'd', content_family: 'MAPS', tile: 'development', status: 'draft', zip: ZIP,
  post_text: 'x', image_bucket_path: null, evidence: null,
};

// ── §1 THE POLICY AND THE STATE MACHINE AGREE ON EVERY SHAPE ─────────────────────────
// The two site-side implementations are asked the same question about the same rows. They
// answered differently on CASE B before this fix, which is the whole defect.
ok(HS.mapsDcCapturePolicyApplies(CASE_A) === true,
  '1a: policy GOVERNS a project-backed Data Center draft');
ok(HS.mapsCaptureState(CASE_A) === S.WAITING,
  '1b: and its state is AWAITING — a capture really is owed');

ok(HS.mapsDcCapturePolicyApplies(CASE_B) === true,
  '1c: policy GOVERNS an absence draft — the map state IS the subject of its picture');
ok(HS.mapsCaptureState(CASE_B) === S.WAITING,
  '1d: and its state agrees — AWAITING, because a capture is genuinely owed for it too');

ok(HS.mapsDcCapturePolicyApplies(CASE_C) === false,
  '1e: policy does NOT govern an ordinary (non-theme) MAPS draft');
ok(HS.mapsCaptureState(CASE_C) === S.WAITING,
  '1f: an ordinary project draft may still be photographed, so AWAITING is correct there');

ok(HS.mapsDcCapturePolicyApplies(CASE_D) === false,
  '1g: a malformed row is not governed — the policy fails closed rather than guessing');
ok(typeof HS.mapsCaptureState(CASE_D) === 'string',
  '1h: and the state machine still answers rather than throwing');

// ── §2 ABSENCE IS RECOGNISED, AND AN ABSENCE WITHOUT AN IMAGE STILL CLAIMS NOTHING ───
// 🛑 THIS SECTION'S HEADING USED TO READ "ABSENCE IS NOT IMAGE-MANDATORY, AND MUST NEVER
// BECOME SO", quoting the instruction the earlier fix was written under. The founder's
// 2026-09-21 ruling supersedes exactly that clause and nothing else in this file. What the
// old §2c protected — a row must never report READY on the strength of being an absence —
// is UNCHANGED and is still asserted below: READY requires a real bound image, here as
// everywhere.
ok(HS.mapsSocialIsAbsence(CASE_B) === true, '2a: the absence predicate recognises CASE B');
ok(HS.mapsSocialIsAbsence(CASE_A) === false, '2b: and does NOT claim a project draft is one');
ok(HS.mapsCaptureState(CASE_B) !== S.READY,
  '2c: an absence with no image never reports READY — being an absence is not a substitute '
  + 'for a picture, it is now a reason to take one');

// AND WITH A BOUND IMAGE IT DOES REACH READY, which is the half that was previously
// unreachable: `mapsCaptureKey` returned null for these rows, so no stored key could ever
// equal it and `mapsCaptureBound` answered false forever.
// The measured map state an absence capture records: the same policy as a project capture,
// with `target_sought: false` — no target was looked for, because there is none.
const ABSENCE_POLICY = {
  policy: (HS.MAPS_DC_CAPTURE_POLICY || {}).key,
  applied: { statuses: { operating: true, approved: true, proposed: true, unknown: true },
             types: { datacenter: true, industrial: false, residential: false, infrastructure: false,
                      commercial: false, civic: false, other: false }, regulatory: false },
  final:   { statuses: { operating: true, approved: true, proposed: true, unknown: true },
             types: { datacenter: true, industrial: false, residential: false, infrastructure: false,
                      commercial: false, civic: false, other: false }, regulatory: false },
  rendered: { target_sought: false, target_on_map: false, on_map_total: 0,
              non_datacenter_development_on_map: 0, regulatory_only_on_map: 0,
              regulatory_badges_drawn: 0, dual_identity_target: false },
};
const absBound = { ...CASE_B, id: 'b3', image_bucket_path: 'maps/99999/nodc-abc.png' };
absBound.evidence = { ...CASE_B.evidence, visual: {
  capture_key: HS.mapsCaptureKey(absBound),
  capture_policy: JSON.parse(JSON.stringify(ABSENCE_POLICY)),
} };
ok(typeof HS.mapsCaptureKey(absBound) === 'string',
  '2d: an absence draft is keyable at all — null here made READY structurally unreachable');
ok(HS.mapsCaptureBound(absBound) === true,
  '2e: …and a real absence capture BINDS, under the same policy as a project capture');
ok(HS.mapsCaptureState(absBound) === S.READY,
  '2f: …so it reaches READY. This was unreachable before the ruling, in two independent ways.');

// ⚠️ THE `target_sought` RELAXATION IS SCOPED, AND THIS IS THE OVER-FLAGGING DIRECTION.
// A PROJECT capture that lost its marker must still be refused — the new key must not have
// become a general excuse for "the target was not drawn".
const lostTarget = JSON.parse(JSON.stringify(absBound));
lostTarget.evidence.visual.capture_policy.rendered.target_sought = true;
ok(HS.mapsDcCapturePolicyEvidence(lostTarget.evidence.visual).ok === false,
  '2g: the same record claiming a target WAS sought is refused — target_on_map is false');
// And a record predating the field (no `target_sought` at all) is treated as having sought
// one, so the entire existing corpus keeps the assertion rather than being excused by it.
const legacyRendered = JSON.parse(JSON.stringify(absBound));
delete legacyRendered.evidence.visual.capture_policy.rendered.target_sought;
ok(HS.mapsDcCapturePolicyEvidence(legacyRendered.evidence.visual).ok === false,
  '2h: a record with no target_sought key defaults to "a target was sought" — the safe way');

// ── §3 DERIVED, NOT STAMPED — THE LOAD-BEARING ONE ───────────────────────────────────
// The unstamped and stamped absence rows must be indistinguishable. Before the fix the
// unstamped one read AWAITING and the stamped one read INELIGIBLE, so correctness depended
// on whether a job in another repository had reached the row.
ok(HS.mapsCaptureState(CASE_B) === HS.mapsCaptureState(CASE_B_STAMPED),
  '3a: an absence row reports the SAME state with and without the worker’s visual stamp');
ok(!CASE_B.evidence.visual,
  '3b: control — the derived case genuinely carries no visual stamp to read');
ok(CASE_B_STAMPED.evidence.visual.state === S.INELIGIBLE,
  '3c: control — the stamped case genuinely carries one');

// ── §4 THE FIX IS SCOPED: NOTHING ELSE MOVED ─────────────────────────────────────────
// A project-backed row with a bound image is still READY; one with a stale image is still
// AWAITING. The carve-out must not have swallowed the ordinary paths.
const bound = { ...CASE_A, id: 'a2', image_bucket_path: 'maps/99999/x.png' };
bound.evidence = { ...CASE_A.evidence, visual: { capture_key: HS.mapsCaptureKey(bound) } };
ok(HS.mapsCaptureState(bound) !== S.INELIGIBLE,
  '4a: a project draft with an image is never swept into the absence carve-out');
const stale = { ...CASE_A, id: 'a3', image_bucket_path: 'maps/99999/y.png',
  evidence: { ...CASE_A.evidence, visual: { capture_key: 'not-the-current-key' } } };
ok(HS.mapsCaptureState(stale) === S.WAITING,
  '4b: a project draft whose image no longer binds still reports AWAITING (a capture is owed again)');

// ── §5 STRUCTURAL: THE ABSENCE CHECK READS ROW TRUTH, NOT A STORED STATE ─────────────
// A behavioural test cannot tell "derived from the shared predicate" from "derived from a
// different stored field that happens to correlate". This pins the mechanism.
//
// 🛑 §5b USED TO ASSERT THE PREDICATE WAS CONSULTED *BEFORE* THE STORED STAMP, because the
// carve-out it guarded returned INELIGIBLE outright. Under the ruling the absence check is
// no longer a carve-out that short-circuits; it is a refusal to read BACK a verdict the
// current rule cannot produce, so it necessarily sits beside the stamp it discounts. What
// the old assertion protected — derived beats stamped — is unchanged and is now §5b's
// behavioural twin in §3.
const BIND = readFileSync(new URL('../lib/maps-capture-binding.js', import.meta.url), 'utf8');
// ⚠️ THE END ANCHOR IS SEARCHED **FROM THE START ANCHOR**, AND THE SLICE IS CONTROLLED.
// A bare `BIND.indexOf('HS.mapsCaptureStateCopy')` finds the FIRST occurrence anywhere in
// the file, so the moment another function ABOVE `mapsCaptureState` called that helper —
// which `mapsMapGateBlock` now does — the end index landed before the start and `slice`
// returned the empty string. A positive regex then fails, which is the lucky direction; a
// `!/.../ ` assertion beside it would have gone GREEN on nothing.
const fnStart = BIND.indexOf('HS.mapsCaptureState = function');
const fn = BIND.slice(fnStart, BIND.indexOf('HS.mapsCaptureStateCopy', fnStart));
ok(fnStart > -1 && fn.length > 200 && fn.length < 8000
  && /HS\.mapsCaptureState = function/.test(fn) && /STATES\.READY/.test(fn)
  && !/HS\.mapsMapGateBlock = function/.test(fn),
  '5₀: the structural slice IS mapsCaptureState and nothing else (control for §5)',
  `${fn.length} chars`);
ok(/mapsSocialIsAbsence/.test(fn),
  '5a: the state machine consults the shared absence predicate');
ok(/typeof HS\.mapsSocialIsAbsence === 'function'/.test(fn),
  '5c: it fails closed if the predicate module did not load, rather than assuming');
// ⛔ AND IT MUST NOT RETURN INELIGIBLE FOR AN ABSENCE AGAIN. A behavioural assertion alone
// would pass on code that reached the same answer for one shape and not another; this
// refuses the shape itself — an INELIGIBLE returned from an absence branch.
ok(!/mapsSocialIsAbsence\(post\)\)\s*\{?\s*return STATES\.INELIGIBLE/.test(fn),
  '5d: no branch returns INELIGIBLE because a row is an absence — the superseded rule');

// THE KEY FUNCTION IS THE OTHER HALF, AND IT IS SCOPED TO THE SHARED PREDICATE TOO. A
// branch keyed on `!e.project_id` alone would hand a real key to any malformed MAPS row.
const keyFn = BIND.slice(BIND.indexOf('HS.mapsCaptureKey = function'),
  BIND.indexOf('HS.mapsCaptureBound = function'));
ok(/mapsSocialIsAbsence/.test(keyFn),
  '5e: the key function gates its absence branch on the shared predicate, not on a bare '
  + 'missing project_id');
ok(/typeof HS\.mapsSocialIsAbsence !== 'function'/.test(keyFn),
  '5f: …and fails closed to null when that module did not load');

console.log(`\n${n - bad} passed, ${bad} failed`);
if (bad) process.exit(1);
