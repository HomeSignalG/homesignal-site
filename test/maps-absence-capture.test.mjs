// ═══════════════════════════════════════════════════════════════════════════════════════
// EVERY MAPS POST GETS A MAP, INCLUDING THE "NO DATA CENTER" ONE
// ⚖️ FOUNDER RULING, 2026-09-21 — stated three times before it was implemented
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// 🔑 WHAT KEPT LOSING THE INSTRUCTION WAS ONE SUBSTITUTION, written down in four places:
// "there is no PROJECT to photograph" read as "there is no MAP to photograph". They are
// different facts. A ZIP's Map 1 page renders whether or not a data centre has ever been
// filed there, and a screenshot of that page — Data center the only PROJECT TYPE selected,
// showing no recent filings — is a real screenshot of a real page. The founder's "no fake
// graphics, EVER" rule is satisfied in full: nothing is drawn that the page did not draw.
//
// The four places, all corrected in the same change:
//   scripts/maps-social-image.mjs       refused the draft outright         -> captureAbsence
//   lib/maps-capture-binding.js         key null, state INELIGIBLE         -> keyed, WAITING
//   lib/maps-capture-policy.js          policy did not govern an absence   -> it governs
//   acquisition.html                    image not mandatory for an absence -> mandatory
//
// THIS FILE IS THE CAPTURE-JOB HALF. The library half is pinned behaviourally by
// test/maps-capture-state-authority.test.mjs and test/maps-dc-policy-parity.test.mjs; the
// capture job cannot be driven offline (it needs a browser and the live site), so what is
// asserted here is the SHIPPED SOURCE — that the refusal is gone, that the replacement is
// the project capture minus the marker work rather than a different picture, and that the
// two paths share one finish path instead of becoming two implementations.
//
// ⛔ NO PRODUCTION ZIP, ROW ID OR PLACE NAME APPEARS HERE.
import { readFileSync } from 'node:fs';

const GEN = readFileSync(new URL('../scripts/maps-social-image.mjs', import.meta.url), 'utf8');
const POLICY = readFileSync(new URL('../lib/maps-capture-policy.js', import.meta.url), 'utf8');

// ⚠️ EVERY STRUCTURAL ASSERTION BELOW READS A COMMENT-STRIPPED COPY, and that is not
// tidiness. This change necessarily quotes the retired sentence in its own supersession
// comments — "the draft carries no project_id, so there is nothing to photograph" appears
// verbatim in three files as the dated record of what was removed — so a pin that searched
// the raw file for that string would fail on a correct tree. This repo has hit that exact
// trap before ("a pin that names the string it forbids cannot also search the whole file
// for it"), which is why the stripper is asserted in both directions before it is trusted.
const strip = (src) => src
  .replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1 ')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
const GEN_CODE = strip(GEN);
const POLICY_CODE = strip(POLICY);

let n = 0, bad = 0;
const ok = (cond, msg) => { n++; if (cond) console.log('PASS — ' + msg); else { bad++; console.log('FAIL — ' + msg); } };

// ── §0 THE INSTRUMENT ────────────────────────────────────────────────────────────────
// A stripper that removed too much would make every absence-pin below pass by reading
// nothing, and a stripper that removed too little would fail §1 on a correct tree.
ok(/nothing to photograph/.test(GEN),
  '0a: control — the retired sentence IS present in the raw file, as the dated record');
ok(!/nothing to photograph/.test(GEN_CODE),
  '0b: …and the stripper removes it, because it survives only inside comments');
ok(/captureAbsence/.test(GEN_CODE),
  '0c: …while leaving real code intact — the stripper is not simply emptying the file');

// ── §1 THE REFUSAL IS GONE, AND THE REPLACEMENT IS A CAPTURE ─────────────────────────
// The single line the founder was reading off the dashboard:
//   if (!pid) { await ineligible('the draft carries no project_id, …'); continue; }
ok(!/ineligible\([^)]*project_id/.test(GEN_CODE),
  '1a: no branch refuses a draft for carrying no project_id');
ok(/if \(!pid\)/.test(GEN_CODE) && /captureAbsence\(page, d, themeA\)/.test(GEN_CODE),
  '1b: the projectless branch CAPTURES instead — the ruling, in the one place it was lost');
ok(/async function captureAbsence\(page, draft, theme\)/.test(GEN_CODE),
  '1c: and captureAbsence exists as a real function, not a comment about one');

const ABS = GEN_CODE.slice(GEN_CODE.indexOf('async function captureAbsence'),
  GEN_CODE.indexOf('async function upload'));
ok(ABS.length > 400, '1d: control — the captureAbsence body was actually located');

// ── §2 IT IS THE SAME PICTURE, MINUS THE MARKER WORK ─────────────────────────────────
// A DIFFERENT capture would be a second implementation of "what a Map 1 screenshot is",
// and the two would drift. Same page, same embed card, same policy, same clip, same veto.
ok(/homesignalmap\.html\?zip=/.test(ABS), '2a: it opens the real public Map 1 ZIP page');
ok(/EMBED_PARAM/.test(ABS), '2b: …in the shipped embed mode, as the project capture does');
ok(/applyDataCenterCapturePolicy\(page, null\)/.test(ABS),
  '2c: …applies the SAME Data Center map-state policy, with a null target');
ok(/mapsDcCaptureVerifyAtShutter\(null\)/.test(ABS),
  '2d: …and re-verifies it AT THE SHUTTER, which is where a project capture verifies too');
ok(/mapsDcCapturePolicyEvidence/.test(ABS),
  '2e: …then validates the record with the SHIPPED validator before any image is kept');
ok(/panelSectionsInFrame/.test(ABS),
  '2f: …and asserts the panel is in frame, so the controls are visible in the picture');
ok(/homePins > 0/.test(ABS),
  '2g: the home-marker veto is unchanged — a broadcast post has no home and no radius');
ok(/\.card\.mapcard/.test(ABS), '2h: …and it clips to the same Map 1 product card');

// ── §3 THE THREE THINGS IT DELIBERATELY DOES NOT DO ──────────────────────────────────
// Each of these would be wrong rather than merely absent, so they are pinned as refusals.
ok(!/setView/.test(ABS),
  '3a: it never re-frames the map — there are no project coordinates to frame on, so the '
  + 'ZIP\'s own framing stands, which is what a resident opening the link would see');
ok(!/openPopup|haloPresent/.test(ABS),
  '3b: it opens no popup and asserts no halo — a halo means "this marker is the subject", '
  + 'and an absence post\'s subject is the absence');
ok(!/drew\b|markersDrawn\s*[<>]/.test(ABS.replace(/markersDrawn:/g, '')),
  '3c: there is NO minimum-markers floor — zero drawn is the success case here, and a '
  + 'floor would invert the whole rule');

// ── §4 IT WAITS FOR THE RIGHT THING ──────────────────────────────────────────────────
// Waiting for a NON-EMPTY marker list would time out on exactly the ZIPs this exists to
// photograph. It must wait for the page to have issued its reads instead.
ok(/Array\.isArray\(window\.__HS_SITES\)/.test(ABS),
  '4a: it waits for the page to have ISSUED its reads, not for markers to exist');
ok(!/siteMarkers\s*\|\|\s*\[\]\)\.length\s*>\s*0/.test(ABS),
  '4b: …and never on a non-empty marker list, which would never arrive');

// ── §5 ONE FINISH PATH, NOT TWO ──────────────────────────────────────────────────────
// 🔑 THE DEFECT CLASS THIS CHANGE IS CORRECTING IS "one rule, several implementations".
// Shipping the absence capture with its own upload/attach/record tail would have created a
// fifth copy in the same session that removed four.
ok(/async function finishCapture\(d, label, r, proj, results\)/.test(GEN_CODE),
  '5a: there is ONE shared finish path');
// ⚖️ THREE CALL SITES NOW. The third is `zipFallback`, which turns the four
// record-shaped refusals (the project row is gone / is not a development row / has no
// coordinates / is outside the ZIP's authoritative set) into ZIP-scope captures instead of
// leaving those drafts with no map. Corrected with its reason recorded rather than by
// relaxing the count: what must hold is that every path finishes through the SAME function,
// so the FAILED record, the key-fingerprinted object name and the attach stay one
// implementation.
ok((GEN_CODE.match(/await finishCapture\(/g) || []).length === 3,
  '5b: …and every path finishes through it — project, absence, and the ZIP fallback');
ok(/const zipFallback = async/.test(GEN_CODE),
  '5b₁: …including the ZIP fallback for a project that cannot truthfully be pinned');
ok((GEN_CODE.match(/await upload\(objectPath, r\.file\)/g) || []).length === 1,
  '5c: the upload happens in exactly one place');
// ⚠️ 5d USED TO PIN THE WHOLE ARGUMENT LIST, `await attach(d, objectPath, r, proj)`, and
// went red the day `attach` correctly gained a parameter. Its point is that there is ONE
// attach call site, not what that call's arity happens to be today — the same staleness
// that a literal filename caused in the ingest repo's claim-guard pin. It asserts the
// property now, with the argument it genuinely cares about named separately.
const ATTACH_CALLS = GEN_CODE.match(/await attach\([^)]*\)/g) || [];
ok(ATTACH_CALLS.length === 1,
  `5d: and so does the attach — neither path carries its own copy (found ${ATTACH_CALLS.length})`);
ok(ATTACH_CALLS.every((c) => /,\s*scope\)/.test(c)),
  '5d₁: …and it hands attach the scope finishCapture computed, rather than letting attach '
  + 'work it out again — a ZIP capture that re-derived its own scope is how the two halves '
  + 'of one decision drift apart');

const FIN = GEN_CODE.slice(GEN_CODE.indexOf('async function finishCapture'),
  GEN_CODE.indexOf('async function main'));
ok(FIN.length > 300, '5e: control — the finishCapture body was actually located');
ok(/upload/.test(FIN) && FIN.indexOf('upload') < FIN.indexOf('attach'),
  '5f: it still uploads BEFORE attaching — an orphan object is harmless, a row naming a '
  + 'missing object is not');
ok(/wrote\.ok/.test(FIN),
  '5g: …and still refuses to write over a draft that moved during the capture');

// ── §6 THE OBJECT PATH DOES NOT INVENT A PROJECT ─────────────────────────────────────
ok(/proj \? String\(proj\.id\) :/.test(FIN) && /'nodc'/.test(FIN),
  '6a: an absence object is named `nodc`, never a project-shaped placeholder that the next '
  + 'reader would take for a project id that has stopped resolving');
// ⚠️ 6a USED TO PIN THE WHOLE TERNARY LITERALLY, `proj ? String(proj.id) : 'nodc'`, WHICH
// MADE IT A PIN AGAINST A THIRD CASE EXISTING rather than against inventing a project. A
// project-backed row whose pin could not be drawn is NOT an absence, and filing its object
// under `nodc` asserts the project does not exist. The rule 6a is really about — the false
// branch never produces a project-shaped id — is unchanged and still holds for both values.
ok(/zip_scope_reason \? 'zip' : 'nodc'/.test(FIN),
  '6a1: …and a project-backed ZIP fallback is named `zip`, so the bucket distinguishes '
  + '"nothing is here" from "something is here and the map could not pin it"');
ok(!/: *'?(undefined|null|0)'?\)/.test(FIN.slice(FIN.indexOf('const subject'), FIN.indexOf('const subject') + 200)),
  '6a2: control — the subject is never an empty or falsy literal, which would collide '
  + 'every ZIP\'s fallback objects onto one name');
ok(/keyStamp\(d, scope\)/.test(FIN),
  '6b: …and still carries the binding key\'s fingerprint, so a re-capture writes a new '
  + 'object rather than silently overwriting the old one');

// ── §7 THE EVIDENCE SAYS WHAT WAS ACTUALLY PHOTOGRAPHED ──────────────────────────────
// ⚠️ THE NOTE FIELDS ARE EVIDENCE, NOT DECORATION. The project note names a popup, a halo
// and a project-coordinate frame; an absence capture has none of the three, so reusing it
// would put three false statements in the one field whose job is to say what was taken.
const ATT = GEN_CODE.slice(GEN_CODE.indexOf('async function attach'),
  GEN_CODE.indexOf('async function recordOutcome'));
ok(ATT.length > 500, '7a: control — the attach body was actually located');
ok(/r\.absence \? 'map1_zip_screenshot_no_project' : 'map1_zip_screenshot'/.test(ATT),
  '7b: the stored visual names its own kind, so the two captures are distinguishable');
ok(/subject: 'zip_no_qualifying_project'/.test(ATT),
  '7c: an absence record states its subject rather than leaving a project block blank');
ok(!/project_lat: null|marker_lat: null/.test(ATT),
  '7d: …and no project field is null-FILLED — a present-but-empty marker_lat reads as a '
  + 'lookup that failed, while its absence reads as a picture with no project subject');
ok(/r\.absence\s*$|note: r\.absence/m.test(ATT) || /note: r\.absence/.test(ATT),
  '7e: the human-readable note branches on which capture this was');
ok(/no popup opened and no halo drawn/.test(ATT),
  '7f: …and the absence note says so in its own words');

// ── §8 THE POLICY VALIDATOR KNOWS "NO TARGET" FROM "TARGET MISSING" ──────────────────
// These are opposite facts that both read `target_on_map: false`. One is the picture
// working exactly as intended; the other is a capture that must be refused.
ok(/target_sought: !!targetKey/.test(POLICY_CODE),
  '8a: the rendered snapshot records whether a target was sought at all');
ok(/target_sought: verifyResult\.rendered\.target_sought/.test(POLICY_CODE),
  '8b: …and the stored record carries it through to the offline validator');
ok(/r\.target_sought !== false && r\.target_on_map !== true/.test(POLICY_CODE),
  '8c: …which relaxes the drawn-target requirement ONLY when no target was sought');
ok(/target_sought !== false/.test(POLICY_CODE) && !/target_sought === true/.test(POLICY_CODE),
  '8d: the default is "a target WAS sought", so every record stored before this field '
  + 'existed keeps the assertion instead of being excused by it');
// ⛔ THE ASSERTION THAT WAS WRITTEN HERE AND KILLED BY ITS OWN NUMBERS.
ok(!/target_sought === false && r\.on_map_total !== 0/.test(POLICY_CODE),
  '8e: there is NO "an absence map must be empty" rule — the absence sentence is bounded '
  + 'to a recency window while this policy turns all four STATUS controls on, so an '
  + 'operating data centre filed years ago is legitimately drawn and contradicts nothing');

console.log(`\n${n - bad} passed, ${bad} failed`);
if (bad) process.exit(1);
