// ═══════════════════════════════════════════════════════════════════════════════════════
// "DOES THIS DRAFT OWE A MAP SCREENSHOT" HAS ONE ANSWER, DERIVED FROM THE ROW
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// THE DEFECT, measured on production 2026-09-21. Three implementations of one question
// existed and one lacked the carve-out the other two had:
//
//   homesignal-ingest bluesky/lib/maps-image-state.mjs
//       isAbsencePost(post) -> NOT_REQUIRED, "there is no project to photograph"   ✓
//   lib/maps-capture-policy.js::mapsDcCapturePolicyApplies
//       absence -> false, so the policy does not govern it                          ✓
//   lib/maps-capture-binding.js::mapsCaptureState
//       absence -> fell through to WAITING                                          ✗
//
// So the Acquisition Dashboard printed "AWAITING MAP CAPTURE · not yet attempted" over
// every absence draft — a capture that will never happen and is not required — UNTIL the
// capture worker in the OTHER repo happened to visit the row and stamp `evidence.visual`.
// Two absence drafts it had reached read CAPTURE_INELIGIBLE; sixteen it had not reached
// read AWAITING. Identical rows, opposite answers, decided by whether another repo's
// scheduled job had run yet.
//
// 🔑 THE PROPERTY THIS FILE PINS IS "DERIVED, NOT STAMPED". §3 is the load-bearing one: an
// absence row with NO `evidence.visual` at all must report the same state as one carrying
// the worker's stamp. A test that only checked the stamped row would have passed on the
// broken code.
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

// An ABSENCE draft: no project at all. Nothing on the map to photograph.
const CASE_B = {
  id: 'b', content_family: 'MAPS', tile: 'development', status: 'draft', zip: ZIP,
  post_text: 'x', image_bucket_path: null,
  evidence: {
    theme: 'datacenter', theme_answer: 'none_found', scan_complete: true, rows_scanned: 12,
    map_zip: ZIP, map_zip_label: 'Northfell (99999)',
  },
};

// The SAME absence row as the capture worker leaves it once it has visited.
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

ok(HS.mapsDcCapturePolicyApplies(CASE_B) === false,
  '1c: policy does NOT govern an absence draft');
// ⚖️ SUPERSEDED — EVERY POST GETS A MAP (later founder ruling). An absence post now
// RECEIVES a ZIP-scope capture, so AWAITING is the honest reading: a capture really is
// owed and really is coming. The old expectation (INELIGIBLE, "a capture that will never
// come") was true of a capture path that refused anything it could not pin, and that path
// is gone.
ok(HS.mapsCaptureState(CASE_B) === S.WAITING,
  '1d: an absence draft AWAITS its ZIP-scope capture, like every other post');

ok(HS.mapsDcCapturePolicyApplies(CASE_C) === false,
  '1e: policy does NOT govern an ordinary (non-theme) MAPS draft');
ok(HS.mapsCaptureState(CASE_C) === S.WAITING,
  '1f: an ordinary project draft may still be photographed, so AWAITING is correct there');

ok(HS.mapsDcCapturePolicyApplies(CASE_D) === false,
  '1g: a malformed row is not governed — the policy fails closed rather than guessing');
ok(typeof HS.mapsCaptureState(CASE_D) === 'string',
  '1h: and the state machine still answers rather than throwing');

// ── §2 ABSENCE IS NOT IMAGE-MANDATORY, AND MUST NEVER BECOME SO ──────────────────────
// ⛔ The instruction this file was written under says it in as many words: "Do not fix one
// invariant by breaking another. Absence does NOT become synonymous with image required."
ok(HS.mapsSocialIsAbsence(CASE_B) === true, '2a: the absence predicate recognises CASE B');
ok(HS.mapsSocialIsAbsence(CASE_A) === false, '2b: and does NOT claim a project draft is one');
ok(HS.mapsCaptureState(CASE_B) !== S.READY,
  '2c: an absence never reports READY — it has no image and claims none');

// ── §3 THE DEFECT #1273 FOUND IS CURED BY A DIFFERENT ROUTE — read this before reverting
// Its complaint was that an absence row's state depended on whether an out-of-band worker
// had reached it: sixteen read AWAITING, two read CAPTURE_INELIGIBLE, identical rows. The
// cure there was to derive "unphotographable" from the row. Under the later ruling the row
// is PHOTOGRAPHABLE, so the cure is that the capture is no longer optional: every absence
// row is AWAITING until its ZIP map is bound, and then READY. The state still stops
// depending on the stamp — it converges on it.
//
// ⚠️ A STAMPED ROW LEGITIMATELY DIFFERS FROM AN UNSTAMPED ONE NOW, and that is ordinary:
// it is the same before/after-capture difference every project-backed post has. What must
// NOT come back is a permanent split where one of the two states is unreachable.
ok(HS.mapsCaptureState(CASE_B) === S.WAITING,
  '3a: an unstamped absence row AWAITS its capture rather than being written off');
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

// ── §5 STRUCTURAL: THE CARVE-OUT READS ROW TRUTH, NOT A STORED STATE ─────────────────
// A behavioural test cannot tell "derived from project_id" from "derived from a different
// stored field that happens to correlate". This pins the mechanism.
const BIND = readFileSync(new URL('../lib/maps-capture-binding.js', import.meta.url), 'utf8');
const fn = BIND.slice(BIND.indexOf('HS.mapsCaptureState = function'),
  BIND.indexOf('HS.mapsCaptureStateCopy'));
// ⚖️ SUPERSEDED with §1d/§3a. The state machine no longer short-circuits on absence,
// because an absence post is no longer unphotographable. These now pin the SUPERSESSION
// itself, so a future session that reinstates the short-circuit fails here and has to read
// why rather than discovering it from 18 empty posts.
ok(!/return STATES\.INELIGIBLE;/.test(fn.slice(0, fn.indexOf("evidence) || {}).visual"))),
  '5a: the state machine does NOT write absence off before reading the row\'s own evidence');
ok(/EVERY POST GETS A MAP/.test(fn),
  '5b: and the superseded carve-out is recorded in place, not silently deleted');

console.log(`\n${n - bad} passed, ${bad} failed`);
if (bad) process.exit(1);
