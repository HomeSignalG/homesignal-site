// THIS SUITE EXISTS BECAUSE EVERY OTHER TEST OF THE CAPTURE JOB IS A GREP.
//
// `scripts/maps-social-image.mjs` exports nothing and calls `main()` on import, so a test
// cannot reach its functions. Every pin over it in this repo therefore reads its SOURCE
// TEXT — which can prove a line is present, and can never prove the line runs.
//
// ⚠️ WHAT THAT COST, MEASURED IN PRODUCTION AND NOT IN A FIXTURE. The ZIP-fallback change
// shipped with a 148-check matrix, six structural pins over this very file, and a full
// offline suite at baseline. The first real capture it attempted died on:
//
//     ReferenceError: scope is not defined
//         at attach (scripts/maps-social-image.mjs:1036)
//         at finishCapture (:775)   at async zipFallback (:892)
//
// `scope` is a local of `finishCapture`; the visual literal inside `attach` referenced it
// as a free variable. No grep can see an unbound identifier, and no library test can
// either — the library was fine. The only instrument that catches this is one that RUNS
// the function.
//
// HOW IT RUNS A MODULE THAT RUNS ITSELF: the source is read, the trailing `main()` call is
// removed, an export is appended, and the result is imported from a temp file with `fetch`
// and the environment stubbed. That is the same source-text technique the comment-stripping
// pins already use, pointed at execution instead of matching. The transformation is
// ASSERTED (§0) rather than assumed, because a harness that silently failed to strip
// `main()` would hang, and one that silently failed to append the export would throw
// something that reads like a real failure.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS — ' + m); }
                       else { fail++; console.log('FAIL — ' + m); } };

const SRC_PATH = new URL('../scripts/maps-social-image.mjs', import.meta.url);
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

// Comment-stripped source, used by the structural pins below. Defined once, up here,
// because §5 needs it too and a second copy is how two strippers drift apart.
const CODE_EARLY = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
                     .replace(/(^|[^:])\/\/[^\n]*$/gm, '$1');

// ── §0 THE HARNESS PROVES ITS OWN TRANSFORMATION ─────────────────────────────────────
const ENTRY = 'main().catch((e) => { console.error(e); process.exit(1); });';
ok(SRC.includes(ENTRY),
  '0a: the module still self-invokes exactly as expected — if this fails the harness below '
  + 'is stripping something that is no longer there and proves nothing');
const stripped = SRC.replace(ENTRY, '/* entry point removed by the test harness */');
ok(!stripped.includes(ENTRY) && stripped.length < SRC.length,
  '0b: …and the strip actually removed it');

// ⚠️ `playwright` IS STUBBED, AND THE TEMP MODULE LIVES INSIDE THE REPO. Two separate
// resolution problems, both of which made this harness report a fake failure before they
// were fixed. `attach` never launches a browser, but the module imports chromium at the
// top, so an environment without playwright (this repo's own sandbox) could not import it
// at all; and a module written to the OS temp dir cannot resolve the repo's node_modules.
// Both are asserted below rather than hoped for.
const PW = "import { chromium } from 'playwright';";
ok(SRC.includes(PW), '0b1: the playwright import is where the harness expects it');
// `zipMapFallback` calls `captureAbsence`, which drives a real Playwright page. To execute
// the FALLBACK's own body offline, the patched copy gets one injectable early return — the
// same source-patch technique as the playwright stub above, and asserted the same way. The
// real body is left intact and is still what runs when the global is unset.
const ABS = 'async function captureAbsence(page, draft, theme) {';
ok(SRC.includes(ABS), '0b3: the absence-capture declaration is where the harness expects it');
const patched = stripped.replace(PW, "const chromium = { launch: async () => { throw new Error('stubbed'); } };")
  .replace(ABS, ABS + ' if (globalThis.__TEST_ABSENCE) return globalThis.__TEST_ABSENCE(page, draft, theme);')
  + '\nexport { attach, finishCapture, zipMapFallback };\n';
ok(!patched.includes(PW), '0b2: …and the stub replaced it');
ok(patched.includes(ABS + ' if (globalThis.__TEST_ABSENCE)'),
  '0b4: …and the absence-capture injection point was spliced in');

const dir = fs.mkdtempSync(path.join(path.dirname(new URL('.', import.meta.url).pathname), '.attach-harness-'));
const file = path.join(dir, 'mod.mjs');
fs.writeFileSync(file, patched);

// The module reads these at import time. They are stubs; nothing leaves this process.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://stub.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'stub-key';

// Every PATCH is captured, never sent. Returning one row is what `guardedPatch` reads as
// a successful, non-raced write.
const patches = [];
globalThis.fetch = async (url, init = {}) => {
  // ⚠️ NOT EVERY BODY IS JSON. `upload()` sends the PNG bytes, and an unguarded
  // `JSON.parse` there crashed the harness the first time §5 executed a path that uploads —
  // a harness fault reported as a product failure. Record what was sent; parse only when it
  // parses.
  let parsed = null;
  if (init.body) { try { parsed = JSON.parse(init.body); } catch { parsed = null; } }
  patches.push({ url: String(url), method: init.method || 'GET', body: parsed });
  return { ok: true, status: 200, headers: new Map(),
           text: async () => '[{"id":"d1"}]', json: async () => [{ id: 'd1' }] };
};

let mod;
try { mod = await import(pathToFileURL(file).href); }
catch (e) { console.log('FAIL — 0c: the patched module could not be imported: ' + e.message); fail++; }

ok(mod && typeof mod.attach === 'function',
  '0c: `attach` is reachable and is a function — the export splice worked');

const draft = { id: 'd1', zip: '80210', revision: 3, content_family: 'MAPS',
                evidence: { project_id: 'p1', theme: 'datacenter' } };
// The fixture carries the fields `attach` actually reads, taken from the shape the two
// capture functions return. Nothing here is invented to make a test pass: a missing
// sub-object surfaced as a TypeError rather than a silent pass, which is the harness
// behaving correctly.
const okResult = (extra) => ({
  ok: true, file: '/dev/null', absence: true,
  checks: { markersDrawn: 0, panelInFrame: true, homePinAbsent: true, targetOnMap: false },
  marker: null, framed: null, auth: null, clip: null, panel: null,
  theme: 'datacenter',
  policy: { policy: 'dc-map-state@1', applied: true, final: {}, rendered: {} },
  rendered: { target_sought: false, on_map_total: 0 },
  ...extra,
});

// ── §1 THE REGRESSION ITSELF ─────────────────────────────────────────────────────────
// A ZIP fallback: `proj` is null, `zip_scope_reason` is set, scope is 'zip'. This is the
// exact shape that threw in production.
if (mod) {
  let threw = null, res = null;
  try {
    res = await mod.attach(draft, 'maps/80210/zip-abc.png',
      okResult({ zip_scope_reason: 'the project row is no longer in app_projects' }), null, 'zip');
  } catch (e) { threw = e; }
  ok(!threw, '1a: a ZIP-scope attach RUNS — this is the ReferenceError that reached production'
    + (threw ? ` (threw: ${threw.message})` : ''));
  ok(res && res.ok, '1b: …and reports a successful single-row write');

  const body = patches.length ? patches[patches.length - 1].body : null;
  ok(body && body.evidence && body.evidence.visual,
    '1c: …and the patch carries an evidence.visual block');
  ok(body && body.evidence.visual.scope === 'zip',
    '1d: …whose scope is the value finishCapture passed, not one re-derived here');
  ok(body && body.evidence.visual.zip_scope_reason
       === 'the project row is no longer in app_projects',
    '1e: …and which records WHY the picture is of the ZIP');
  ok(body && typeof body.evidence.visual.capture_key === 'string'
       && body.evidence.visual.capture_key.length > 0,
    '1f: …and a NON-NULL capture key, so the row can bind — the whole point of the change');
  ok(body && body.evidence.visual.capture_key.includes('80210'),
    '1g: …keyed on THIS ZIP');
}

// ── §2 THE PROJECT PATH IS UNCHANGED ─────────────────────────────────────────────────
if (mod) {
  const proj = { id: 'p1', lat: 39.1, lng: -104.9, status: 'Approved', record_kind: 'development' };
  const projResult = okResult({
    absence: false,
    marker: { lat: 39.1, lng: -104.9, key: 'p1', popupOpen: true, halo: true, drawn: true, id: 'p1' },
    framed: { lat: 39.1, lng: -104.9 },
    auth: { present: true },
    rendered: { target_sought: true, on_map_total: 4 },
  });
  let threw = null;
  try {
    await mod.attach(draft, 'maps/80210/p1-abc.png',
      projResult, proj, 'project');
  } catch (e) { threw = e; }
  ok(!threw, '2a: a project-scope attach still runs' + (threw ? ` (threw: ${threw.message})` : ''));
  const body = patches.length ? patches[patches.length - 1].body : null;
  ok(body && body.evidence.visual.scope === 'project', '2b: …and records project scope');
  ok(body && !('zip_scope_reason' in body.evidence.visual),
    '2c: …with no zip_scope_reason, which must be absent rather than null when it does not apply');
}

// ── §3 THE GUARD IS LOUD, NOT SILENT ─────────────────────────────────────────────────
// ⚠️ THE FAILURE MODE THIS REPLACES was an unbound identifier deep inside an object
// literal. A missing or bogus scope must now fail by NAME, immediately, so the next person
// reads a sentence instead of a stack trace.
if (mod) {
  for (const [bad, label] of [[undefined, 'omitted'], [null, 'null'], ['ZIP', 'wrong case'],
                              ['', 'empty'], ['county', 'not in the vocabulary']]) {
    let msg = null;
    try { await mod.attach(draft, 'maps/80210/x.png', okResult({}), null, bad); }
    catch (e) { msg = e.message; }
    ok(msg && /scope must be 'project' or 'zip'/.test(msg),
      `3: a ${label} scope is refused by name, not by ReferenceError`);
  }
}

// ── §4 CALL-SITE / SIGNATURE PARITY ──────────────────────────────────────────────────
// Execution above covers `attach`. This covers the thing execution cannot see from here:
// that the ONE production call site still passes the argument. Both halves are needed —
// the ingest `source_type` defect was exactly a copier and its source disagreeing, and
// only pinning both closed it.
ok(/async function attach\(draft, objectPath, r, proj, scope\)/.test(SRC),
  '4a: the signature declares scope');
const calls = SRC.match(/await attach\([^)]*\)/g) || [];
ok(calls.length === 1, `4b: control — exactly one production call site (found ${calls.length})`);
ok(calls.every((c) => /,\s*scope\)/.test(c)),
  '4c: …and it passes the scope finishCapture computed');
// ⚠️ COMMENT-STRIPPED, AND THAT IS NOT OPTIONAL. The fix's own comment QUOTES the
// expression this forbids, in order to record what was removed — so a check over the raw
// file matches the explanation and fails on a correct tree. Fourth occurrence of "a pin
// that names the string it forbids" in this workstream; the control below is what proves
// the stripper did not simply delete everything.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '')
                .replace(/(^|[^:])\/\/[^\n]*$/gm, '$1');
ok(/async function attach\(/.test(CODE) && !/fourth occurrence/i.test(CODE),
  '4d-control: the comment stripper kept the code and dropped the prose');
ok(!/r\.scope\s*\|\|/.test(CODE),
  '4d: the second derivation is gone — nothing ever set that field, so it always fell '
  + 'through to re-deriving what finishCapture had already decided');

// ── §5 THE ZIP FALLBACK'S BODY IS EXECUTED, NOT JUST WIRED ───────────────────────────
// WHY THIS SECTION EXISTS: `zipFallback` was a closure inside `main()`, so nothing offline
// could reach it. The suite could assert that all five record-refusal exits CALL it and
// NOTHING about what it then did — which is why the mutation that guts its body survived
// the entire set. Lifting it to module scope is what makes the assertions below possible;
// they are the point of the lift, not a bonus.
ok(mod && typeof mod.zipMapFallback === 'function',
  '5a: `zipMapFallback` is reachable at module scope — the lift worked');

if (mod && typeof mod.zipMapFallback === 'function') {
  const zipDraft = { id: 'd1', zip: '80210', revision: 3, content_family: 'MAPS',
                     evidence: { project_id: 'p1', theme: 'datacenter' } };

  // — the SUCCESS path: a real ZIP picture, bound at ZIP scope, reason recorded —
  globalThis.__TEST_ABSENCE = async () => okResult({});
  patches.length = 0;
  let results = [];
  await mod.zipMapFallback({}, zipDraft, 'lbl', results, 'the project has no coordinates');
  const row = results[0] || {};
  ok(results.length === 1 && row.ok === true,
    `5b: a successful ZIP capture produces one READY result (got ${JSON.stringify(row.state ?? row)})`);
  const wrote = patches.filter((x) => x.method === 'PATCH');
  const vis = wrote.length ? (wrote[wrote.length - 1].body?.evidence?.visual || {}) : {};
  ok(vis.scope === 'zip',
    `5c: …recorded at ZIP scope, because proj is passed as null (got ${JSON.stringify(vis.scope)})`);
  ok(typeof vis.capture_key === 'string' && vis.capture_key.startsWith('v1|80210|'),
    `5d: …and the key names THIS ZIP (got ${JSON.stringify(vis.capture_key)})`);
  ok(!/^v1\|80210\|[0-9a-f-]{36}\|/.test(String(vis.capture_key || '')),
    '5e: …and never names a record as the subject — the exact rule #560 dropped from SQL');
  ok(vis.zip_scope_reason === 'the project has no coordinates',
    `5f: the reason the picture is of the ZIP rides on the row (got ${JSON.stringify(vis.zip_scope_reason)})`);

  // — the THROW path: caught, recorded as a failure, and the run is NOT aborted —
  globalThis.__TEST_ABSENCE = async () => { throw new Error('browser exploded'); };
  patches.length = 0;
  results = [];
  let threw = false;
  try { await mod.zipMapFallback({}, zipDraft, 'lbl', results, 'whatever'); }
  catch { threw = true; }
  ok(!threw,
    '5g: a capture that throws does not propagate — one bad draft must not abort the run');
  const bad = results[0] || {};
  ok(results.length === 1 && bad.ok === false && /capture threw/.test(String(bad.reason || '')),
    `5h: …it is recorded as a real failure naming the throw (got ${JSON.stringify(bad.reason)})`);
  const badWrote = patches.filter((x) => x.method === 'PATCH');
  const badVis = badWrote.length ? (badWrote[badWrote.length - 1].body?.evidence?.visual || {}) : {};
  ok(badVis.state === 'CAPTURE_FAILED' && /capture threw/.test(String(badVis.failure_reason || '')),
    `5i: …and the row records a capture FAILURE, not a ZIP finding (got ${JSON.stringify(badVis.state)})`);

  // ⚠️ THE FIRST VERSION OF 5j ASSERTED `badVis.zip_scope_reason === undefined` AND WAS
  // VACUOUS — it passed with the guard deleted, which a mutation caught. Measured: on the
  // failure path `finishCapture` routes to `recordOutcome`, which COMPOSES ITS OWN visual
  // block and never reads `rz.zip_scope_reason`, so the field cannot reach the row whatever
  // the guard does. A behavioural pin for this does not exist to be written. The guard is
  // still worth keeping — it stops a failed capture from carrying a "we deliberately chose
  // the ZIP map" reason internally — so it is pinned STRUCTURALLY, and this comment records
  // that the weaker pin is the honest ceiling rather than an oversight.
  ok(/if \(rz\.ok\) rz\.zip_scope_reason = why;/.test(CODE_EARLY),
    '5j: the reason is attached only on success (structural — see the note above for why no '
    + 'behavioural assertion is possible)');

  delete globalThis.__TEST_ABSENCE;
}

// ── §6 …AND THE LIFT DID NOT COST THE WIRING PIN ─────────────────────────────────────
// Both halves, for the same reason §4 keeps both: execution proves the body, the greps
// prove every refusal still reaches it.
ok(/^async function zipMapFallback\(page, d, label, results, why\)/m.test(SRC),
  '6a: the fallback is declared at MODULE scope with every value passed explicitly — a '
  + 'closure is what made it untestable, and what produced the #1287 ReferenceError');
const fallbackCalls = (SRC.match(/await zipFallback\(/g) || []).length;
ok(fallbackCalls === 5,
  `6b: all five record-refusal exits still reach the fallback (found ${fallbackCalls})`);
ok(/zipMapFallback\(page, d, label, results, why\)/.test(SRC),
  '6c: …through a thin adapter that forwards the loop locals, so the call sites are unchanged');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
