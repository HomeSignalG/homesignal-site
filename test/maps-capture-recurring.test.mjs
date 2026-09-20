// Offline proof that the MAPS capture can run on a SCHEDULE without creating uncontrolled
// load, without re-photographing what it has already photographed, and without ever
// letting a draft keep an image that no longer belongs to it.
//
// BEHAVIOURAL WHERE IT MATTERS. §1–§8 load the SHIPPED lib/map.js +
// lib/maps-social-theme.js + lib/maps-capture-binding.js and RUN them, so a green run is a
// statement about shipped behaviour rather than about a description of it. §9–§10 are
// structural pins on the two files a behavioural test cannot execute: the capture script
// (it imports playwright and calls main() at module load) and the workflow.
//
// WHY THE DUE-PREDICATE LIVES IN A LIB AND IS TESTED HERE. "Which drafts does this run
// touch" is the whole of the load question. While it lived inside maps-social-image.mjs it
// could not be executed by any test at all — which is precisely how a selector meaning
// "everything not yet done" sat there retrying 40 failures per fire with nothing to catch it.
import { readFileSync } from 'node:fs';

const GEN = readFileSync(new URL('../scripts/maps-social-image.mjs', import.meta.url), 'utf8');
const DASH = readFileSync(new URL('../acquisition.html', import.meta.url), 'utf8');
const WF = readFileSync(new URL('../.github/workflows/maps-social-image.yml', import.meta.url), 'utf8');

globalThis.window = globalThis.window || globalThis;
for (const f of ['../lib/map.js', '../lib/maps-social-theme.js', '../lib/maps-capture-binding.js']) {
  (0, eval)(readFileSync(new URL(f, import.meta.url), 'utf8'));
}
const HS = globalThis.window.HS;
const S = HS.MAPS_CAPTURE_STATES;
const R = HS.MAPS_CAPTURE_RETRY;

let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (cond) console.log('PASS — ' + msg); else { bad++; console.log('FAIL — ' + msg); } };

const HOUR = 3600 * 1000;
const T0 = Date.parse('2026-09-20T12:00:00.000Z');

// A MAPS draft shaped exactly like production's. Field names and values are taken verbatim
// from social_posts row 213302f5-eb76-472b-9505-47180a3604a5 (ZIP 19475, Pennhurst Data
// Centers) so the fixture cannot drift into a shape the queue does not actually carry.
function draft(over) {
  const e = Object.assign({
    lat: 40.1941270282218,
    lng: -75.561094677314,
    type: 'Industrial',
    type_raw: 'Industrial',
    status: 'Proposed',
    project_id: '0cd2dcd6-9710-4b1b-a670-78f9abec5b86',
    source_key: 'arcgis:chester-county-pa-act247-plans:CU-03-26-18866',
    project_name: 'Pennhurst Data Centers'
  }, (over && over.evidence) || {});
  if (over && over.visual !== undefined) e.visual = over.visual;
  return {
    id: (over && over.id) || 'row-1',
    content_family: 'MAPS',
    tile: 'development',
    status: 'draft',
    zip: (over && over.zip) || '19475',
    post_text: (over && over.post_text) || 'Is a data center planned near you?',
    image_bucket_path: (over && over.image_bucket_path) !== undefined ? over.image_bucket_path : null,
    evidence: e
  };
}
// A draft with a real, bound capture.
function bound(over) {
  const d = draft(over);
  d.image_bucket_path = 'maps/' + d.zip + '/proj.png';
  d.evidence.visual = Object.assign({
    status: 'REAL_MAP_VISUAL', state: S.READY, capture_key: HS.mapsCaptureKey(d), attempts: 0
  }, (over && over.visual) || {});
  return d;
}

// ── §1 THE BINDING KEY ────────────────────────────────────────────────────────────────
const base = draft();
const k = HS.mapsCaptureKey(base);
ok(typeof k === 'string' && k.startsWith('v1|'), '1a: the key is a readable versioned string, not an opaque digest');
ok(HS.mapsCaptureKey(draft()) === k, '1b: it is deterministic for identical inputs');
ok(k.includes('19475') && k.includes('Pennhurst Data Centers'),
  '1c: it is self-describing — a reader can see WHY two keys differ');
ok(HS.mapsCaptureKey({ content_family: 'MAPS', evidence: {} }) === null,
  '1d: a draft with no project identity has NO key — there is nothing a picture could bind to');
ok(HS.mapsCaptureKey({ content_family: 'ALERTS', evidence: { project_id: 'x' } }) === null,
  '1e: an ALERTS row is never keyed — this contract is MAPS-only');

// Every input that changes WHAT THE PICTURE SHOWS must move the key.
for (const [field, val, why] of [
  ['lat', 41.0, 'the map is framed on the coordinates'],
  ['lng', -76.0, 'the map is framed on the coordinates'],
  ['type', 'Commercial', 'type decides the marker shape'],
  ['type_raw', 'Data Center', 'type_raw decides classification'],
  ['status', 'Approved', 'lifecycle status decides the marker colour'],
  ['project_name', 'Something Else', 'the open popup prints the name'],
  ['source_key', 'arcgis:other:X', 'the marker is matched by source_key'],
  ['project_id', 'other-uuid', 'a different project is a different picture'],
]) {
  ok(HS.mapsCaptureKey(draft({ evidence: { [field]: val } })) !== k,
    `1f: changing ${field} moves the key — ${why}`);
}
ok(HS.mapsCaptureKey(draft({ zip: '19460' })) !== k,
  '1g: changing the ZIP moves the key — it is a different page');

// ⚠️ THE LOAD-BEARING NEGATIVE. homesignal-ingest's recompose-maps-drafts.mjs rewrites
// post_text on every MAPS row and touches nothing else. If post_text were in the key, every
// recompose would invalidate every image and the next run would re-photograph the whole
// queue — load with no truth behind it, on a job that now runs unattended.
ok(HS.mapsCaptureKey(draft({ post_text: 'A completely different sentence.' })) === k,
  '1h: rewriting post_text does NOT move the key — wording is not a map view');

// Coordinate sensitivity matches the capture's own identity test (COORD_EPS 1e-5).
ok(HS.mapsCaptureKey(draft({ evidence: { lat: 40.19412702822180001 } })) === k,
  '1i: a sub-1e-5 coordinate wobble does NOT move the key');
ok(HS.mapsCaptureKey(draft({ evidence: { lat: 40.1942 } })) !== k,
  '1j: a coordinate move the capture would notice DOES move the key');

// ── §2 MULTIPLE ZIPs, ONE SHARED RULE ─────────────────────────────────────────────────
// Nothing in the contract is per-ZIP, and this is what proves it: the same project drafted
// on two ZIP pages is two pictures, and four different ZIPs each key independently.
const zips = ['19475', '64153', '85212', '78617'];
const keys = zips.map((z) => HS.mapsCaptureKey(draft({ zip: z })));
ok(new Set(keys).size === 4, '2a: four ZIPs produce four distinct keys — no ZIP is special-cased');
ok(zips.every((z, i) => keys[i].includes('|' + z + '|')), '2b: each key carries its own ZIP');
ok(zips.every((z) => HS.mapsCaptureDue(draft({ zip: z }), T0).due),
  '2c: a fresh draft in every one of them is due — the rule is shared, not per-ZIP');

// ── §3 FOUR STATES, DERIVED FROM THE ROW ──────────────────────────────────────────────
ok(HS.mapsCaptureState(draft()) === S.WAITING, '3a: a never-attempted draft is WAITING');
ok(HS.mapsCaptureState(bound()) === S.READY, '3b: a bound capture is READY');
ok(HS.mapsCaptureState(draft({ visual: { state: S.FAILED, attempts: 1 } })) === S.FAILED,
  '3c: a recorded capture failure is FAILED');
ok(HS.mapsCaptureState(draft({ visual: { state: S.INELIGIBLE } })) === S.INELIGIBLE,
  '3d: a recorded ineligibility is INELIGIBLE');
// A row written before this module knew only NO_PROJECT_SPECIFIC_VISUAL. It reads as the
// WEAKER claim, which keeps it in the retry population instead of writing it off.
ok(HS.mapsCaptureState(draft({ visual: { status: 'NO_PROJECT_SPECIFIC_VISUAL' } })) === S.FAILED,
  '3e: a pre-existing row with only the legacy status reads as FAILED, not INELIGIBLE');
// THE STORED STATE IS OBSERVABILITY; THE FUNCTION IS THE AUTHORITY.
ok(HS.mapsCaptureState(draft({ visual: { state: S.READY, capture_key: 'v1|anything' } })) === S.WAITING,
  '3f: a row CLAIMING READY with no image still reports WAITING — a stale blob cannot unlock');
const wrongKey = bound(); wrongKey.evidence.visual.capture_key = 'v1|stale';
ok(HS.mapsCaptureState(wrongKey) === S.WAITING,
  '3g: an image whose key no longer matches reports WAITING — owed again, not failed');
const noKey = bound(); delete noKey.evidence.visual.capture_key;
ok(HS.mapsCaptureBound(noKey) === false,
  '3h: an image with NO recorded key is UNBOUND — nothing recorded what those pixels were of');

// ── §4 AN UPDATED DRAFT CANNOT KEEP ITS OLD PICTURE ───────────────────────────────────
const b = bound();
ok(HS.mapsCaptureBound(b) && !HS.mapsCaptureDue(b, T0).due, '4a: before the update it is bound and not due');
// The project moves. Everything else about the row is untouched.
b.evidence.lat = 40.2100;
ok(!HS.mapsCaptureBound(b), '4b: after the coordinates move it is UNBOUND');
ok(HS.mapsCaptureDue(b, T0).due, '4c: and it is due for a fresh capture on the next run');
ok(HS.mapsCaptureState(b) === S.WAITING, '4d: reported as awaiting capture, never as READY');

// ── §5 REPEAT RUNS DO NOT RE-PHOTOGRAPH — THE DUPLICATE PROTECTION ────────────────────
// A run, modelled exactly as scripts/maps-social-image.mjs models one: the shipped
// predicate, then a hard cap.
function run(rows, nowMs, limit) {
  const due = [];
  const skip = { bound: 0, backoff: 0, exhausted: 0 };
  for (const r of rows) {
    const v = HS.mapsCaptureDue(r, nowMs);
    if (!v.due) { if (v.skip in skip) skip[v.skip]++; continue; }
    due.push(r);
    if (due.length >= limit) break;
  }
  return { due, skip };
}
const queue = [bound({ id: 'a' }), bound({ id: 'b' }), draft({ id: 'c' })];
const r1 = run(queue, T0, 8);
ok(r1.due.length === 1 && r1.due[0].id === 'c', '5a: only the imageless draft is picked up');
ok(r1.skip.bound === 2, '5b: the two bound drafts are skipped as already-bound, costing no browser');
// Simulate the capture landing, then run again — the idempotence that makes a 4x/day job safe.
queue[2] = bound({ id: 'c' });
const r2 = run(queue, T0 + HOUR, 8);
ok(r2.due.length === 0 && r2.skip.bound === 3, '5c: the very next run does nothing — repeat runs are a no-op');
const r3 = run(queue, T0 + 30 * 24 * HOUR, 8);
ok(r3.due.length === 0, '5d: and still nothing a month later — boundness is not time-based');

// ── §6 BOUNDED WORK PER RUN ───────────────────────────────────────────────────────────
const big = Array.from({ length: 40 }, (_, i) => draft({ id: 'x' + i, zip: String(19400 + i) }));
ok(run(big, T0, 8).due.length === 8, '6a: a 40-draft backlog yields exactly --limit per run');
ok(run(big, T0, 1).due.length === 1, '6b: the cap is honoured at 1');
ok(run([], T0, 8).due.length === 0, '6c: an empty queue does no work');

// ── §7 LIMITED RETRIES ────────────────────────────────────────────────────────────────
ok(R.MAX_ATTEMPTS === 3 && R.BACKOFF_HOURS.length === 3,
  '7a: the ladder is three attempts — short by design');
const at = (a) => Date.parse(HS.mapsCaptureNextAttemptAt(a, T0)) - T0;
ok(at(1) === 1 * HOUR && at(2) === 4 * HOUR && at(3) === 12 * HOUR,
  '7b: the backoff grows 1h → 4h → 12h');
ok(at(4) === 12 * HOUR && at(99) === 12 * HOUR,
  '7c: past the ladder it FLOORS at 12h rather than growing without bound or stopping');

const failed = draft({ visual: { state: S.FAILED, attempts: 1, next_attempt_at: new Date(T0 + HOUR).toISOString(), attempted_key: k } });
ok(!HS.mapsCaptureDue(failed, T0).due && HS.mapsCaptureDue(failed, T0).skip === 'backoff',
  '7d: inside its backoff a failed draft is skipped, and the skip is NAMED backoff');
ok(HS.mapsCaptureDue(failed, T0 + HOUR + 1).due,
  '7e: once the backoff expires it is due again');
const burned = draft({ visual: { state: S.FAILED, attempts: 3, next_attempt_at: new Date(T0 + 12 * HOUR).toISOString(), attempted_key: k } });
ok(HS.mapsCaptureDue(burned, T0).skip === 'exhausted',
  '7f: a draft past its attempt budget is reported as EXHAUSTED, not confused with a backoff');
// INELIGIBLE IS NOT TERMINAL, and that is deliberate: authoritative geography completes.
const inel = draft({ visual: { state: S.INELIGIBLE, attempts: 0, next_attempt_at: new Date(T0 + R.INELIGIBLE_RETRY_HOURS * HOUR).toISOString(), attempted_key: k } });
ok(!HS.mapsCaptureDue(inel, T0).due, '7g: an ineligible draft waits out its long floor');
ok(HS.mapsCaptureDue(inel, T0 + 25 * HOUR).due,
  '7h: and IS retried after it — a ZIP boundary completing must be able to rescue it');
ok(R.INELIGIBLE_RETRY_HOURS === 24, '7i: that floor is 24h — one cheap RPC a day, not a browser per fire');

// ── §8 A KEY CHANGE RELEASES THE CLOCK ────────────────────────────────────────────────
// A backoff is a verdict about the inputs it was set against. If they moved, waiting out
// the remainder is waiting on a stale answer.
const movedSinceFailure = draft({
  evidence: { lat: 41.5 },
  visual: { state: S.FAILED, attempts: 2, next_attempt_at: new Date(T0 + 4 * HOUR).toISOString(), attempted_key: k }
});
ok(HS.mapsCaptureDue(movedSinceFailure, T0).due,
  '8a: a draft whose inputs changed since the failure is due IMMEDIATELY, backoff notwithstanding');
const notMoved = draft({ visual: { state: S.FAILED, attempts: 2, next_attempt_at: new Date(T0 + 4 * HOUR).toISOString(), attempted_key: k } });
ok(!HS.mapsCaptureDue(notMoved, T0).due, '8b: an unchanged draft still waits — the release is not a bypass');
const legacyNoAttemptedKey = draft({ visual: { state: S.FAILED, attempts: 1, next_attempt_at: new Date(T0 + HOUR).toISOString() } });
ok(!HS.mapsCaptureDue(legacyNoAttemptedKey, T0).due,
  '8c: a pre-module row with no attempted_key falls through to the clock — the conservative direction');
ok(HS.mapsCaptureDue(notMoved, T0, { ignoreClock: true }).due,
  '8d: --ids bypasses the clock (an operator naming a row has decided)');
ok(!HS.mapsCaptureDue(bound(), T0, { ignoreClock: true }).due,
  '8e: but --ids never bypasses BOUNDNESS — a bound row genuinely needs no picture');

// ── §9 NO FAILURE STATE MAY READ AS A FINDING ABOUT A ZIP ─────────────────────────────
// This is the one the founder named explicitly. A failed or ineligible capture must never
// be presentable as "no data centers found here".
for (const st of [S.FAILED, S.INELIGIBLE, S.WAITING]) {
  const copy = HS.mapsCaptureStateCopy(st);
  ok(copy.length > 0, `9a: ${st} has founder-facing copy`);
  ok(!/\bno\b[^.]*\b(data cent|project|development|record)/i.test(copy),
    `9b: ${st} copy makes no claim that nothing exists — it names the instrument`);
}
for (const st of [S.FAILED, S.INELIGIBLE]) {
  ok(/not a finding about the ZIP/i.test(HS.mapsCaptureStateCopy(st)),
    `9c: ${st} copy says outright that it is not a finding about the ZIP`);
}
ok(HS.mapsCaptureStateCopy('SOMETHING_ELSE') === '',
  '9d: an unknown state gets NO invented copy');

// ── §10 STRUCTURAL PINS on the files a behavioural test cannot execute ────────────────
ok(/HS\.mapsCaptureDue\(d, now, \{ ignoreClock: ONLY_IDS\.length > 0 \}\)/.test(GEN),
  '10a: the capture script uses the SHIPPED predicate — not a second copy of it');
ok(/HS\.MAPS_CAPTURE_RETRY/.test(GEN), '10b: and the SHIPPED retry ladder');
ok(/visual\.capture_key = HS\.mapsCaptureKey\(draft\)/.test(GEN),
  '10c: a successful capture records the binding key');
ok(/attempted_key: HS\.mapsCaptureKey\(draft\)/.test(GEN),
  '10d: a refusal records the inputs it was refusing, so a later change can release the clock');
ok(/-\$\{keyStamp\(d\)\}\.png/.test(GEN),
  '10e: the object name carries the key stamp, so a re-capture cannot silently overwrite the old image');
// EVERY refusal branch must record an outcome. Five of them used to `continue` silently,
// which under a recurring job means re-selecting the same row on every single fire.
ok((GEN.match(/recordOutcome\(/g) || []).length >= 3,
  '10f: refusals are recorded on the row rather than dropped silently');
ok(!/results\.push\(\{ id: d\.id, label, ok: false, reason: 'draft carries no project_id' \}\)/.test(GEN),
  '10g: the old silent-continue refusal is gone');
ok(/ineligible\(/.test(GEN), '10h: deterministic refusals go through one INELIGIBLE helper');
ok(/const WRITABLE = \['image_bucket_path', 'evidence'\]/.test(GEN),
  '10i: the write scope is exactly the two columns a capture may touch');
ok(/proveNothingApproved/.test(GEN), '10j: and the run re-reads what it touched to prove it');
ok(!/content_family=eq\.MAPS&limit=500/.test(GEN),
  '10k: the post-run proof is scoped to touched rows, not to the whole queue '
  + '(a global assertion would go red the first time the founder legitimately approves one)');

ok(/cron:/.test(WF), '10l: the workflow has a schedule');
ok(/cancel-in-progress: false/.test(WF), '10m: with non-overlapping runs');
ok(/maps-social-capture/.test(WF), '10n: behind a standing enable switch');

ok(/HS\.mapsCaptureBound/.test(DASH), '10o: the dashboard gate reads the SHIPPED binding rule');
ok(/return !!\(window\.HS && HS\.mapsCaptureBound && HS\.mapsCaptureBound\(p\)\);/.test(DASH),
  '10p: and FAILS CLOSED when that module is absent — no lib means nothing is bound');
ok(/dcThemeImageMandatory\(p\) && !bskyCaptureBound\(p\)/.test(DASH),
  '10q: a Data Center Theme draft needs a BOUND image, not merely any image');
ok(/p\.content_family==='MAPS' && p\.image_bucket_path && !bskyCaptureBound\(p\)/.test(DASH),
  '10r: and ANY MAPS draft with an unbound image is blocked ahead of every other check');

console.log(`\n${n - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
