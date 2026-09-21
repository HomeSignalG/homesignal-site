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
for (const f of ['../lib/map.js', '../lib/maps-social-theme.js', '../lib/maps-capture-policy.js',
                 '../lib/maps-capture-binding.js']) {
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
// The measured map state a CURRENT Data Center capture records. The Pennhurst fixture is a
// project-backed Data Center Theme draft, so a capture of it is governed by
// dc-map-state@1 — a fixture without this record would describe a state that can no longer
// be bound, and every "bound" assertion below would be testing the wrong thing.
const COMPLIANT_POLICY = {
  policy: (HS.MAPS_DC_CAPTURE_POLICY || {}).key,
  applied: { statuses: { operating: true, approved: true, proposed: true, unknown: true },
             types: { datacenter: true, industrial: false, residential: false, infrastructure: false,
                      commercial: false, civic: false, other: false }, regulatory: false },
  final:   { statuses: { operating: true, approved: true, proposed: true, unknown: true },
             types: { datacenter: true, industrial: false, residential: false, infrastructure: false,
                      commercial: false, civic: false, other: false }, regulatory: false },
  rendered: { target_on_map: true, on_map_total: 3, non_datacenter_development_on_map: 0,
              regulatory_only_on_map: 0, regulatory_badges_drawn: 0, dual_identity_target: false },
};
// A draft with a real, bound capture.
function bound(over) {
  const d = draft(over);
  d.image_bucket_path = 'maps/' + d.zip + '/proj.png';
  d.evidence.visual = Object.assign({
    status: 'REAL_MAP_VISUAL', state: S.READY, capture_key: HS.mapsCaptureKey(d), attempts: 0,
    capture_policy: JSON.parse(JSON.stringify(COMPLIANT_POLICY))
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
// ⚖️ AT THE SCOPE THE SHUTTER ACTUALLY USED. Keying at the draft's own widest scope
// stamps a PROJECT key on a ZIP-scope picture, which then never matches what
// `mapsCaptureBound` computes for it — permanently unbound, the same shape as the null key
// #1280 replaced for the absence post. The scope argument is the load-bearing half.
ok(/visual\.capture_key = HS\.mapsCaptureKey\(draft, r\.scope \|\| \(proj \? 'project' : 'zip'\)\)/.test(GEN),
  '10c: a successful capture records the binding key AT THE SCOPE IT SHOT');
ok(/attempted_key: HS\.mapsCaptureKey\(draft, scope\)/.test(GEN),
  '10d: a refusal records the inputs it was refusing, at the scope it attempted, so a later change can release the clock');
ok(/const scope = proj \? 'project' : 'zip';/.test(GEN),
  '10d₁: …and that scope is fixed once in finishCapture, so key, path and refusal cannot disagree');
ok(/-\$\{keyStamp\(d, scope\)\}\.png/.test(GEN),
  '10e: the object name carries the key stamp AT THE SHOT SCOPE, so a re-capture cannot silently overwrite the old image');
// EVERY refusal branch must record an outcome. Five of them used to `continue` silently,
// which under a recurring job means re-selecting the same row on every single fire.
// ⚖️ THE COUNT DROPPED because five record-shaped refusals became ZIP-scope CAPTURES.
// Corrected with its reason recorded, rather than by lowering a threshold to make it pass:
// what must still hold is that a refusal is never silent, and there are still both a
// definition and a call site.
ok((GEN.match(/recordOutcome\(/g) || []).length >= 2,
  '10f: refusals are still recorded on the row rather than dropped silently');
// ⚠️ COMMENT-STRIPPED. The source quotes `await ineligible(...)` verbatim in order to
// record what was removed, so a pin that searches the whole file finds the very string it
// forbids — the trap this repo has already paid for twice.
const GEN_EXEC = GEN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok(/const zipFallback = async/.test(GEN_EXEC),
  '10f₀₀: the comment-stripped source still holds the real code (control for §10f₀)');
ok(!/await ineligible\(/.test(GEN_EXEC),
  '10f₀: …and no record-shaped condition ends a draft with no picture any more');
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
// ⚠️ ANCHORED ON `if(`, NOT A BARE SUBSTRING. A substring pin matches happily inside
// `if(false && <the condition>)`, so a one-word mutation that disables the whole gate went
// green against the earlier form of both of these lines — MEASURED, not hypothesised. The
// condition has to be the WHOLE of the `if`, or the pin is not pinning the branch.
// ⚖️ SUPERSEDED — EVERY MAPS POST MUST HAVE A MAP. This pinned a condition scoped to ONE
// theme, so the basic question was only ever asked of a minority of the corpus. The pin is
// now the strictly stronger one: the gate must consult a predicate keyed on the FAMILY.
ok(/var mapBlock = bskyMapGateBlock\(p\);\n\s*if\(mapBlock\)\{/.test(DASH),
  '10q: EVERY MAPS draft needs a BOUND map — the handler gate is universal, not per-theme');
ok(/function bskyMapGateBlock\(p\)\{\n\s*if\(!p \|\| p\.content_family !== 'MAPS'\) return '';/.test(DASH),
  '10q₁: …and that predicate keys on the FAMILY, so no theme carve-out can narrow it');
ok(/if\(p\.content_family==='MAPS' && p\.image_bucket_path && !bskyCaptureBound\(p\)\)\{/.test(DASH),
  '10r: and ANY MAPS draft with an unbound image is blocked ahead of every other check');
ok(/if \(row && bskyMapGateBlock\(row\)\) \{/.test(DASH),
  '10s: …and the BUTTON gate calls the SAME predicate, whole, so button and handler cannot disagree');
ok(/if\(mapsImageRequired\(p\) && !_bskyImgOk\[_bskyImgKey\(p\)\]\)\{/.test(DASH),
  '10t: …as does the "you must have SEEN this exact image" rule');


// ── §11 THE DATA CENTER MAP-STATE POLICY: KEYS, INVALIDATION AND BLAST RADIUS ─────────
// The Pennhurst fixture above IS a project-backed Data Center Theme draft, so it is governed
// by the policy. That is what makes §11 a measurement rather than a description.
const DCPOL = HS.MAPS_DC_CAPTURE_POLICY;
const dcPost = draft();
ok(HS.mapsDcCapturePolicyApplies(dcPost) === true,
  '11a: the fixture draft is a project-backed Data Center Theme post, so the policy governs it');
ok(HS.mapsCaptureKey(dcPost).endsWith('|' + DCPOL.key),
  '11b: its capture key carries the policy version', HS.mapsCaptureKey(dcPost).slice(-24));

// ⛔ THE BLAST RADIUS. An ordinary MAPS capture is governed by no map-state policy and its
// picture is exactly as valid as it was, so its key must be BYTE-FOR-BYTE what it was before
// this change. A global 'v1' -> 'v2' bump would have invalidated all of them.
const ordinary = draft({ evidence: { type: 'Residential', type_raw: 'New Building',
  project_name: 'New Building 1764 S Sherman ST ADU', status: 'Approved' } });
ok(HS.mapsDcCapturePolicyApplies(ordinary) === false,
  '11c: a non-data-centre MAPS draft is NOT governed by the policy');
ok(HS.mapsCaptureKey(ordinary).indexOf(DCPOL.key) === -1,
  '11d: …so its capture key carries NO policy segment', HS.mapsCaptureKey(ordinary));
ok(HS.mapsCaptureKey(ordinary).split('|').length === 11,
  '11e: …and is the same 11-field shape it has always been',
  HS.mapsCaptureKey(ordinary).split('|').length);
ok(HS.mapsCaptureKey(ordinary).startsWith('v1|'),
  '11f: the key PREFIX is untouched — no global version bump');

// A full policy record, built by the SHIPPED builder rather than typed here.
const compliantPolicy = COMPLIANT_POLICY;
function dcBound(over) {
  const d = draft();
  d.image_bucket_path = 'maps/19475/x.png';
  d.evidence.visual = Object.assign({ state: S.READY, capture_key: null,
    capture_policy: JSON.parse(JSON.stringify(compliantPolicy)) }, over || {});
  if (d.evidence.visual.capture_key === null) d.evidence.visual.capture_key = HS.mapsCaptureKey(d);
  return d;
}
ok(HS.mapsCaptureBound(dcBound()) && HS.mapsCaptureState(dcBound()) === S.READY,
  '11g: a compliant Data Center capture is BOUND and READY');
ok(!HS.mapsCaptureDue(dcBound(), T0).due && HS.mapsCaptureDue(dcBound(), T0).skip === 'bound',
  '11h: …so a second run against it is a NO-OP');
ok(!HS.mapsCaptureDue(dcBound(), T0, { ignoreClock: true }).due,
  '11i: …and --ids does not re-photograph it either — an explicit id bypasses the CLOCK, never boundness');

// LEGACY INVALIDATION. Every image captured before this policy existed carries a key without
// the policy segment AND no measured evidence. It must become unbound and due.
const legacy = draft();
legacy.image_bucket_path = 'maps/19475/legacy.png';
legacy.evidence.visual = { state: S.READY, status: 'REAL_MAP_VISUAL',
  capture_key: 'v1|19475|0cd2dcd6-9710-4b1b-a670-78f9abec5b86|'
    + 'arcgis:chester-county-pa-act247-plans:CU-03-26-18866|40.19413|-75.56109|Industrial|Industrial|'
    + 'Proposed|Pennhurst Data Centers|datacenter' };
ok(!HS.mapsCaptureBound(legacy), '11j: a PRE-POLICY Data Center capture is UNBOUND');
ok(HS.mapsCaptureState(legacy) === S.WAITING,
  '11k: …reported as awaiting capture, never as READY — the picture renders, and that is the danger');
ok(HS.mapsCaptureDue(legacy, T0).due, '11l: …and due for replacement on the next run');

// A CURRENT-LOOKING KEY IS NOT ENOUGH. This is the "matching key conceals contradictory
// evidence" path: the key is exactly right and the measurements are not.
for (const [name, over] of [
  ['no capture_policy at all', { capture_policy: undefined }],
  ['a stale policy version', { capture_policy: Object.assign({}, compliantPolicy, { policy: 'dc-map-state@0' }) }],
  ['REGULATORY left on', { capture_policy: JSON.parse(JSON.stringify(
      Object.assign({}, compliantPolicy, {
        applied: Object.assign({}, compliantPolicy.applied, { regulatory: true }),
        final: Object.assign({}, compliantPolicy.final, { regulatory: true }) }))) }],
  ['non-data-centre markers rendered', { capture_policy: JSON.parse(JSON.stringify(
      Object.assign({}, compliantPolicy, {
        rendered: Object.assign({}, compliantPolicy.rendered, { non_datacenter_development_on_map: 4 }) }))) }],
]) {
  const row = dcBound(over);
  ok(row.evidence.visual.capture_key === HS.mapsCaptureKey(row),
    `11m/${name}: the key MATCHES this draft exactly`);
  ok(!HS.mapsCaptureBound(row), `11n/${name}: …and it is still NOT bound`);
  ok(HS.mapsCaptureDue(row, T0).due, `11o/${name}: …so a capture is owed`);
}

// TEXT-ONLY EDITS STILL DO NOT RECAPTURE. The policy must not have widened the key into
// things that do not change a screenshot.
const reworded = dcBound();
reworded.post_text = 'A completely different sentence about the same project.';
ok(HS.mapsCaptureBound(reworded),
  '11p: a text-only edit leaves the capture BOUND — no recapture for a recompose');

// ⚖️ THE ABSENCE POST IS GOVERNED AND KEYED LIKE ANY OTHER — FOUNDER RULING, 2026-09-21:
// every MAPS post gets a map, even when there is no data centre. This block previously
// asserted the opposite on both counts; it is flipped, not deleted, so the change of rule
// is visible where the old rule was pinned.
const absence = { id: 'abs', content_family: 'MAPS', tile: 'development', status: 'draft',
  zip: '64155', image_bucket_path: null,
  evidence: { theme: 'datacenter', theme_answer: 'none_found' } };
ok(HS.mapsSocialIsAbsence(absence) === true, '11q: the absence post is recognised as one');
ok(HS.mapsDcCapturePolicyApplies(absence) === true,
  '11r: …and the map-state policy DOES govern it — the map state is the whole subject of '
  + 'its picture, so an unpoliced absence capture would be unreadable as evidence');

// ITS KEY IS REAL, WHICH IS WHAT MAKES THE RULING REACHABLE AT ALL. While this returned
// null an absence capture could never report bound, however real the screenshot was.
const absKey = HS.mapsCaptureKey(absence);
ok(typeof absKey === 'string' && absKey.length > 0,
  '11s: an absence draft has a capture key rather than null');
ok(absKey.indexOf('|absence|') > -1,
  '11t: …carrying a literal absence segment, so it can never collide with a project key');
ok(absKey.indexOf('64155') > -1 && absKey.indexOf(HS.MAPS_DC_CAPTURE_POLICY.key) > -1,
  '11u: …and it names the ZIP it photographs and the map-state policy it was taken under');

// THE KEY MOVES WITH THE POLICY AND WITH NOTHING ELSE THAT CANNOT CHANGE THE PICTURE.
const absReworded = JSON.parse(JSON.stringify(absence));
absReworded.post_text = 'Different words about the same empty map.';
ok(HS.mapsCaptureKey(absReworded) === absKey,
  '11v: a text-only edit does NOT move an absence key either — wording is not a map state');

// A MAPS ROW WITH NO PROJECT THAT IS *NOT* A GENUINE ABSENCE ANSWER IS KEYED AT ZIP SCOPE.
const notAbsence = JSON.parse(JSON.stringify(absence));
delete notAbsence.evidence.theme_answer;
// ⚖️ SUPERSEDED — the founder's matrix lists "no project_id -> zip" as its own case,
// distinct from the absence answer. Leaving such a row unkeyed left it permanently
// unbindable, and a post cannot be required to have a map it can never bind to. It is keyed
// at ZIP scope with the OTHER subject token, because it claims nothing about filings.
const naKey = HS.mapsCaptureKey(notAbsence);
ok(typeof naKey === 'string' && naKey.indexOf(`v1|${notAbsence.zip}|zip-scope|`) === 0,
  '11w: a projectless row that is not an absence answer is keyed at ZIP scope, not left unkeyed', naKey);
ok(naKey !== HS.mapsCaptureKey(absence),
  '11w₁: …and it is a DIFFERENT key from the absence answer\'s, so neither picture says the other\'s thing',
  `${naKey} vs ${HS.mapsCaptureKey(absence)}`);

// A CAPTURE FAILURE IS NEVER A FINDING ABOUT A ZIP — and §9 above only covers the four
// STATE sentences. The policy's own refusal reasons are shown to the founder beside them, so
// they are held to the same bar: each one names an instrument (a control, the policy, the
// map's own drawing), never the absence of development.
const POLICY_SRC = readFileSync(new URL('../lib/maps-capture-policy.js', import.meta.url), 'utf8');
const reasonLines = POLICY_SRC.split('\n').filter((l) => /reason:|problems\.push|return lbl|v := /.test(l));
ok(reasonLines.length > 0, '11s: the policy module has refusal text to check', reasonLines.length);
ok(!/\bno\b[^'"]{0,40}\b(data cent|development|project)s?\b[^'"]{0,20}\b(here|in this zip|found)\b/i.test(POLICY_SRC),
  '11t: none of it claims a ZIP has no data centres — the failure names the instrument');

// ── §12 THE ATTACH IS CONDITIONAL — STRUCTURAL PINS ──────────────────────────────────
// A read-then-unconditional-write is a race with a comment on it. These pin the preconditions
// into the WHERE clause, which is the only place Postgres will evaluate them atomically.
ok(/status=eq\.draft&revision=eq\.\$\{Number\(draft\.revision\)\}/.test(GEN),
  '12a: every write filters on status=draft AND the observed revision');
ok(/Prefer: 'return=representation'/.test(GEN),
  '12b: …and asks for the rows back, so a refused precondition is VISIBLE rather than silent');
ok(/return guardedPatch\(draft, \{/.test(GEN) && (GEN.match(/guardedPatch\(draft/g) || []).length >= 2,
  '12c: BOTH the success attach and the failure record go through that one guard');
ok(!/social_posts\?id=eq\.\$\{draft\.id\}`, \{\n\s*method: 'PATCH'/.test(GEN),
  '12d: the old unconditional PATCH is gone');
ok(/select=id,zip,tile,post_text,evidence,image_bucket_path,status,content_family,revision/.test(GEN),
  '12e: the selector reads `revision`, or the guard would have nothing to compare');
ok(/SKIPPED \(stale\)/.test(GEN),
  '12f: a refused attach is reported as stale and skipped — never forced');
ok(/state: WAITING, stale: true/.test(GEN),
  '12g: …and the row is left for the next run rather than marked failed');

// ── §13 THE POLICY REACHES THE CAPTURE PATH AND THE DASHBOARD ────────────────────────
ok(/mapsDcCaptureApplyPolicy/.test(GEN), '13a: the capture script applies the SHIPPED policy');
ok(/mapsDcCaptureVerifyAtShutter/.test(GEN),
  '13b: …and re-verifies at the shutter, after framing and the popup');
ok(/mapsDcCapturePolicyEvidence/.test(GEN),
  '13c: …and validates its own record before an image is written');
ok(/addScriptTag\(\{ content: POLICY_SRC \}\)/.test(GEN),
  '13d: the policy module is INJECTED, never re-typed inside the capture script');
ok(!/applyDataCenterTypeFilter/.test(GEN),
  '13e: the old PROJECT-TYPE-only filter helper is gone');
ok(/removeItem\('hs\.map\.categoryFilters'\)/.test(GEN),
  '13f: each capture starts from the product default — the sessionStorage bleed that produced '
  + 'the Mesa evidence\'s identical before/after is closed');
ok(/lib\/maps-capture-policy\.js\?v=/.test(DASH),
  '13g: the dashboard loads the policy module, with a cache key');
ok(/_bskyImgKey\(p\)/.test(DASH),
  '13h: its image cache is keyed on the IMAGE PATH, so a new capture cannot be masked by an old blob');
ok(/mapsDcCapturePolicyCopy/.test(DASH),
  '13i: …and it explains policy staleness in its own words, never as "the project changed"');
ok(/The draft has NOT changed/.test(DASH),
  '13j: the tooltip says so explicitly');

console.log(`\n${n - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
