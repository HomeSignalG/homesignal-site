// ⚖️ EVERY MAPS POST MUST HAVE A MAP. NO EXCEPTIONS. — FOUNDER RULING 2026-09-21
//
//                    EVERY MAPS POST
//                          │
//                 ┌────────┴────────┐
//        truthful project      no truthful project
//                 │                 │
//                 ▼                 ▼
//          PROJECT-SCOPE        ZIP-SCOPE
//               MAP                MAP
//                 └────────┬────────┘
//                          ▼
//                 CURRENT BOUND MAP
//                          ▼
//                   APPROVAL ALLOWED
//
// There is no branch NO PROJECT -> NO MAP REQUIRED, no branch ABSENCE POST ->
// CAPTURE_INELIGIBLE, and no branch NON-DATA-CENTER MAPS POST -> MAP OPTIONAL.
//
// ── WHAT #1280 ALREADY SHIPPED, AND WHAT THIS ADDS ───────────────────────────────────
// #1280 (merge cf10f09) made the ABSENCE post reachable: it keys on the ZIP, so its
// capture can bind. This covers the rest of the founder's matrix, each measured as missing
// on that merge:
//   · a projectless row that is NOT a stamped absence  — key was null, unbindable forever
//   · the four record-shaped demotions (project row gone / not a development row / no
//     coordinates / outside the authoritative ZIP set) — refused outright, no map at all
//   · scope recorded on the picture, so a ZIP map cannot be read back as a project claim
//   · the requirement applying to the 29 un-themed MAPS drafts, not only to one theme
//
// ⛔ NOTHING HERE NAMES A LIVE ZIP, PROJECT OR POST. The scenarios are SHAPES; §8 asserts
// that absence in the shipped rules and §9 proves it on a ZIP invented at run time.
import { readFileSync } from 'node:fs';

const win = { HS: {} };
globalThis.window = win;
for (const f of ['../lib/project-type.js', '../lib/map.js', '../lib/maps-social-theme.js',
  '../lib/maps-capture-policy.js', '../lib/maps-capture-binding.js']) {
  new Function('window', 'document', readFileSync(new URL(f, import.meta.url), 'utf8'))(win, undefined);
}
const HS = win.HS;
const S = HS.MAPS_CAPTURE_STATES;
const POLICY = HS.MAPS_DC_CAPTURE_POLICY.key;

let n = 0, bad = 0;
const ok = (cond, name, detail) => {
  n++;
  if (cond) console.log(`PASS — ${name}`);
  else { bad++; console.log(`FAIL — ${name}${detail !== undefined ? ` [${detail}]` : ''}`); }
};

const FX = JSON.parse(readFileSync(new URL('./fixtures/maps-dc-policy-cases.json', import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const policyBlob = (scope) => ({
  policy: POLICY,
  scope,
  applied: { statuses: clone(FX.compliant_statuses), types: clone(FX.compliant_types), regulatory: false },
  final: { statuses: clone(FX.compliant_statuses), types: clone(FX.compliant_types), regulatory: false },
  observed_before: { statuses: clone(FX.compliant_statuses), types: clone(FX.compliant_types), regulatory: true },
  controls_changed: { statuses: 0, types: 6, regulatory: 1 },
  // ⚠️ THE TWO HALVES SIGNAL "NO TARGET WAS SOUGHT" DIFFERENTLY, AND THIS FIXTURE CARRIES
  // BOTH ON PURPOSE. The browser validator waives the target on `rendered.target_sought ===
  // false` (#1280); the enforced SQL guard waives it on `capture_policy.scope = 'zip'`
  // (#554, applied to production). A fixture carrying only one would pass one half and be
  // silently wrong about the other — which is exactly what happened to the 18 live absence
  // captures, accepted by the browser and refused at the boundary.
  rendered: Object.assign(clone(FX.compliant_rendered),
    scope === 'zip' ? { target_on_map: false, target_sought: false } : {}),
});

const ZIP = '80210';
const P = { project_id: 'src:case-1', source_key: 'src', lat: 39.68421, lng: -104.9612,
  type: 'datacenter', type_raw: 'DATA CENTER', status: 'Approved', project_name: 'North Yard' };
// `scope` is the scope this draft's map must have; `subject` the token the key carries there.
const SCENARIOS = [
  { name: 'normal valid project', scope: 'project', dc: true, evidence: { ...P, theme: 'datacenter' } },
  { name: 'no Data Center project found', scope: 'zip', subject: 'absence', dc: true,
    evidence: { theme: 'datacenter', theme_answer: 'none_found' } },
  { name: 'absence / none_found', scope: 'zip', subject: 'absence', dc: true,
    evidence: { theme: 'datacenter', theme_answer: 'none_found' } },
  { name: 'no project_id', scope: 'zip', subject: 'zip-scope', dc: false, evidence: {} },
  // ⚠️ THE NEXT FOUR CARRY A project_id AND STILL RESOLVE TO ZIP SCOPE. The row cannot know
  // that — only the capture job, reading live data, can. So the DRAFT's widest scope is
  // `project` while the CAPTURE legitimately records `zip`, which is the whole reason
  // `mapsCaptureKey` takes a scope argument.
  { name: 'project row disappeared', scope: 'zip', subject: 'zip-scope', dc: true, demoted: true,
    evidence: { ...P, theme: 'datacenter' } },
  { name: 'project coordinates unavailable', scope: 'zip', subject: 'zip-scope', dc: true, demoted: true,
    evidence: { ...P, theme: 'datacenter' } },
  { name: 'project not in authoritative ZIP set', scope: 'zip', subject: 'zip-scope', dc: true, demoted: true,
    evidence: { ...P, theme: 'datacenter' } },
  { name: 'project cannot truthfully be pinned', scope: 'zip', subject: 'zip-scope', dc: true, demoted: true,
    evidence: { ...P, theme: 'datacenter' } },
];

const draftFor = (sc, zip) => ({
  id: 'draft-' + sc.name.replace(/\W+/g, '-'),
  content_family: 'MAPS', tile: 'development', status: 'draft',
  zip: zip || ZIP, image_bucket_path: null, evidence: clone(sc.evidence),
});
// Attach a picture the way the SHIPPED capture script does. Nothing here types a key.
const capture = (d, scope, opts) => {
  const o = opts || {};
  const p = clone(d);
  p.image_bucket_path = `maps/${o.pathZip || p.zip}/x.png`;
  const visual = { state: S.READY, captured_at: new Date().toISOString() };
  if (!o.dropScope) visual.scope = scope;
  if (HS.mapsDcCapturePolicyApplies(p)) visual.capture_policy = policyBlob(scope);
  visual.capture_key = o.key !== undefined ? o.key : HS.mapsCaptureKey(o.keyFrom || p, scope);
  p.evidence.visual = visual;
  return p;
};

console.log('EVERY MAPS POST MUST HAVE A MAP — the universal contract\n');

// ═══ 1. THE FIXTURE MEASURES WHAT IT CLAIMS ══════════════════════════════════════════
ok(HS.mapsSocialThemeKey(draftFor(SCENARIOS[0])) === 'datacenter',
  '1a: the project scenario classifies as Data center through the SHIPPED Map 1 classifier');
ok(SCENARIOS.filter((s) => s.scope === 'zip').length === 7
  && SCENARIOS.filter((s) => s.scope === 'project').length === 1,
  '1b: the matrix carries both scopes, so neither branch is untested');
ok(SCENARIOS.some((s) => !s.dc) && SCENARIOS.some((s) => s.dc),
  '1c: …and both themed and un-themed posts, so the rule is proven beyond one theme');

// ═══ 2. THE MATRIX (§11) ═════════════════════════════════════════════════════════════
for (const sc of SCENARIOS) {
  const d = draftFor(sc);
  const t = `2/${sc.name}`;

  // (a) A DETERMINISTIC CAPTURE IDENTITY EXISTS — the assertion that fails if a projectless
  // row is ever left unkeyed again.
  const key = HS.mapsCaptureKey(d, sc.scope);
  ok(typeof key === 'string' && key.length > 0, `${t} — deterministic capture identity exists`, key);
  ok(HS.mapsCaptureKey(d, sc.scope) === key, `${t} — …and it is stable across calls`);

  // (b) THE SCOPE IS STATED IN THE IDENTITY, with its own subject token.
  if (sc.scope === 'zip') {
    ok(key.indexOf(`v1|${ZIP}|${sc.subject}|`) === 0,
      `${t} — the identity names the ZIP and its ${sc.subject} subject`, key);
    ok(key.indexOf(String(d.evidence.project_id || '\u0000none\u0000')) === -1,
      `${t} — …and carries no project claim`);
  } else {
    ok(key.indexOf(`v1|${ZIP}|${d.evidence.project_id}|`) === 0,
      `${t} — the identity names the ZIP and the project`, key.slice(0, 40));
  }

  // (c)/(d) THE CAPTURE CAN BE PRODUCED, BINDS, AND REACHES REAL_MAP_VISUAL.
  const shot = capture(d, sc.scope);
  ok(HS.mapsCaptureBound(shot) === true, `${t} — the correct capture BINDS`);
  ok(HS.mapsCaptureState(shot) === S.READY, `${t} — …and reports REAL_MAP_VISUAL`,
    HS.mapsCaptureState(shot));
  ok(HS.mapsMapGateBlock(shot) === '', `${t} — …and the map gate PASSES`,
    HS.mapsMapGateBlock(shot).slice(0, 70));

  // (e) MISSING CAPTURE -> BLOCK.
  ok(HS.mapsMapGateBlock(d) !== '', `${t} — a missing map BLOCKS`);
  ok(HS.mapsCaptureState(d) !== S.READY, `${t} — …and never reads READY`);

  // (f) WRONG SCOPE -> BLOCK.
  const other = sc.scope === 'zip' ? 'project' : 'zip';
  if (!(other === 'project' && !d.evidence.project_id)) {
    const wrong = capture(d, sc.scope, { key: HS.mapsCaptureKey(d, other) });
    ok(HS.mapsMapGateBlock(wrong) !== '', `${t} — a capture keyed at the WRONG scope BLOCKS`);
  }
  if (!d.evidence.project_id) {
    // The direction that must never be tolerated: a picture claiming a project on a row
    // that names none.
    const claims = clone(shot);
    claims.evidence.visual.scope = 'project';
    ok(HS.mapsCaptureBound(claims) === false,
      `${t} — a PROJECT-scope claim on a projectless row is REFUSED`);
    ok(HS.mapsMapGateBlock(claims) !== '', `${t} — …and blocks`);
  }

  // (g) WRONG ZIP -> BLOCK.
  const elsewhere = capture(d, sc.scope, { keyFrom: draftFor(sc, '99999'), pathZip: '99999' });
  ok(HS.mapsMapGateBlock(elsewhere) !== '', `${t} — a capture of a DIFFERENT ZIP BLOCKS`);

  // (h) STALE CAPTURE -> BLOCK.
  ok(HS.mapsMapGateBlock(capture(d, sc.scope, { key: key + '|stale' })) !== '',
    `${t} — a stale capture key BLOCKS`);

  // (i) A SUPERSEDED MAP-STATE POLICY -> BLOCK, where that policy applies.
  if (sc.dc) {
    const old = capture(d, sc.scope);
    old.evidence.visual.capture_policy.policy = 'dc-map-state@0';
    ok(HS.mapsMapGateBlock(old) !== '',
      `${t} — a capture under a SUPERSEDED map-state policy BLOCKS`);
  }
}

// ═══ 3. GENUINE FAILURES STAY FAILURES (§10) ═════════════════════════════════════════
// ⚖️ ZIP scope is where a post's truthful target IS the ZIP. It is NOT a place to hide an
// instrument failure, and the two must stay distinguishable in the record.
const failed = draftFor(SCENARIOS[1]);
failed.evidence.visual = { state: S.FAILED, failure_reason: 'the browser crashed', attempts: 1 };
ok(HS.mapsCaptureState(failed) === S.FAILED,
  '3a: a genuine capture failure still reports CAPTURE_FAILED, not a quiet ZIP fallback');
ok(HS.mapsMapGateBlock(failed) !== '', '3b: …and still blocks approval');
ok(/browser crashed/.test(HS.mapsMapGateBlock(failed)),
  '3c: …and the reported reason reaches the founder rather than being swallowed');
// ⚖️ A STALE `CAPTURE_INELIGIBLE` ON AN ABSENCE ROW IS IGNORED, AND THAT IS #1280's DOING,
// not this change's. 28 production rows carry that stamp from runs that refused what they
// could not pin; for a row whose picture is now owed and coming, reporting the old refusal
// would say a capture will never happen when one is due. It reads AWAITING instead.
const inelAbs = draftFor(SCENARIOS[1]);
inelAbs.evidence.visual = { state: S.INELIGIBLE };
ok(HS.mapsCaptureState(inelAbs) === S.WAITING,
  '3d: a stale INELIGIBLE stamp on an absence row reads AWAITING — a capture really is coming',
  HS.mapsCaptureState(inelAbs));
ok(HS.mapsMapGateBlock(inelAbs) !== '', '3d₁: …and it still blocks until that capture exists');
// …while the value itself is NOT deleted from the vocabulary: a project-bearing row that a
// run genuinely recorded as unphotographable still reports it, so the state stays readable.
const inelProj = draftFor(SCENARIOS[0]);
inelProj.evidence.visual = { state: S.INELIGIBLE };
ok(HS.mapsCaptureState(inelProj) === S.INELIGIBLE,
  '3e: a stored INELIGIBLE on a project row is still readable — the vocabulary is not collapsed');

// ═══ 4. ALERTS IS UNTOUCHED ══════════════════════════════════════════════════════════
ok(HS.mapsMapGateBlock({ content_family: 'ALERTS', zip: ZIP, evidence: {} }) === '',
  '4a: an ALERTS post is not map-gated — the rule is scoped to the MAPS family');
ok(HS.mapsMapRequired({ content_family: 'ALERTS' }) === false
  && HS.mapsMapRequired({ content_family: 'MAPS' }) === true,
  '4b: …and `mapsMapRequired` says so in one line, on the family alone');

// ═══ 5. THE SHIPPED KEY SHAPES ARE BYTE-STABLE ═══════════════════════════════════════
// ⛔ 9 project images and 18 absence images are bound in production by these exact strings.
// Changing either format unbinds them and re-photographs work nothing was wrong with.
ok(HS.mapsCaptureKey(draftFor(SCENARIOS[0]), 'project')
  === `v1|${ZIP}|src:case-1|src|39.68421|-104.96120|datacenter|DATA CENTER|Approved|North Yard|datacenter|${POLICY}`,
  '5a: the PROJECT key format is unchanged, field for field',
  HS.mapsCaptureKey(draftFor(SCENARIOS[0]), 'project'));
ok(HS.mapsCaptureKey(draftFor(SCENARIOS[2])) === `v1|${ZIP}|absence|datacenter|${POLICY}`,
  '5b: #1280\'s ABSENCE key is byte-for-byte unchanged — 18 live images depend on it',
  HS.mapsCaptureKey(draftFor(SCENARIOS[2])));
ok(HS.mapsCaptureKey(draftFor(SCENARIOS[4]), 'zip') === `v1|${ZIP}|zip-scope|datacenter|${POLICY}`,
  '5c: …and a demoted project gets its OWN subject token, not the absence one',
  HS.mapsCaptureKey(draftFor(SCENARIOS[4]), 'zip'));
ok(HS.mapsCaptureKey(draftFor(SCENARIOS[2])) !== HS.mapsCaptureKey(draftFor(SCENARIOS[4]), 'zip'),
  '5d: …so neither picture can ever say the other\'s thing');

// ═══ 6. A PRE-SCOPE BLOB, AND A KEY THAT DECLARES ITS OWN SCOPE ══════════════════════
// The live shape #1280 writes: the absence key, and no scope stamped anywhere.
const liveAbsence = capture(draftFor(SCENARIOS[2]), 'zip', { dropScope: true });
delete liveAbsence.evidence.visual.capture_policy.scope;
ok(HS.mapsCaptureStoredScope(liveAbsence.evidence.visual, liveAbsence) === 'zip',
  '6a: a ZIP-declaring KEY is read as ZIP scope even with no scope field — the live shape');
ok(HS.mapsCaptureBound(liveAbsence) === true,
  '6b: …so the 18 production absence captures stay bound');
const legacy = capture(draftFor(SCENARIOS[0]), 'project', { dropScope: true });
delete legacy.evidence.visual.capture_policy.scope;
ok(HS.mapsCaptureStoredScope(legacy.evidence.visual, legacy) === 'project',
  '6c: a project capture with no scope field still reads as PROJECT — the stricter default');
ok(HS.mapsCaptureBound(legacy) === true, '6d: …so pre-scope project images stay bound');

// ═══ 7. A ZIP FALLBACK ON A PROJECT-BEARING DRAFT IS UPGRADABLE, NOT FINISHED ════════
const fallback = capture(draftFor(SCENARIOS[4]), 'zip');
ok(HS.mapsCaptureBound(fallback) === true, '7a: a project-bearing draft ACCEPTS its ZIP fallback');
ok(HS.mapsMapGateBlock(fallback) === '', '7b: …and is approvable on it — it has a truthful map');

// ═══ 8. NO SPECIAL-CASE POPULATION ANYWHERE (§13) ════════════════════════════════════
const SRC = ['maps-capture-binding', 'maps-capture-policy', 'maps-social-theme']
  .map((f) => readFileSync(new URL(`../lib/${f}.js`, import.meta.url), 'utf8')).join('\n')
  // Comments record dated measurements and quote retired rules in order to forbid them, so
  // they are stripped before any "this string is absent" assertion is made.
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok(/HS\.mapsMapRequired = function/.test(SRC) && SRC.length > 2000,
  '8₀: the comment-stripped source still holds the real code (control for §8)');
const zips = SRC.match(/['"]\d{5}['"]/g) || [];
ok(zips.length === 0, '8a: no shipped rule names a ZIP code', zips.join(','));
ok((`var z = '80210';`.match(/['"]\d{5}['"]/g) || []).length === 1,
  '8a₁: …and that pattern DOES fire on a ZIP literal, so the zero means something');
// ⚠️ NARROWED, AND THE FIRST VERSION WAS WRONG IN THE OVER-FLAGGING DIRECTION. A loose
// `absence…INELIGIBLE` search matched `staleAbsenceStamp = v.state === STATES.INELIGIBLE`,
// which is the line that CLEARS a stale stamp — the opposite of the rule being forbidden. A
// pin that fires on the fix is noise, and noise gets switched off. What is forbidden is a
// RETURN of that state predicated on being an absence post.
ok(!/IsAbsence\(post\)\)\s*\{?\s*return (STATES\.INELIGIBLE|.*NOT_REQUIRED)/.test(SRC),
  '8b: no shipped rule RETURNS INELIGIBLE or NOT_REQUIRED because a post is an absence answer');
ok(/IsAbsence\(post\)\)\s*\{?\s*return STATES\.INELIGIBLE/.test(
  "if (HS.mapsSocialIsAbsence(post)) return STATES.INELIGIBLE;"),
  '8b₁: …and that pattern DOES fire on the rule it forbids, so the absence above means something');
ok(/content_family !== 'MAPS'/.test(SRC) || /content_family === 'MAPS'/.test(SRC),
  '8c: the requirement keys on the FAMILY');

// ═══ 8b. THE CAPTURE JOB ACTUALLY DEMOTES, AND ACTUALLY RECORDS WHAT IT SHOT ════════
// ⚠️ BOTH PINS BELOW EXIST BECAUSE A MUTATION SURVIVED THE WHOLE SUITE WITHOUT THEM.
// Turning a record-shaped demotion back into a refusal, and deleting `scope` from the
// stored visual, each left every behavioural assertion green — because this file exercises
// the LIBRARY, and neither rule lives there. A matrix that cannot see the job it is a
// matrix for is measuring half the pipeline.
const GEN = readFileSync(new URL('../scripts/maps-social-image.mjs', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// ⚠️ UPDATED when the fallback was LIFTED to module scope so its body could be executed
// offline (it was `const zipFallback = async (why) => …` inside `main()`, which is why
// mutation F survived the whole suite). This pin guards that the fallback EXISTS, not
// which syntax declares it — freezing the shape is what made three suites go red on a
// correct change, for the third time in this workstream.
ok(/async function zipMapFallback\(/.test(GEN) && GEN.length > 5000,
  '8b₀: the comment-stripped generator still holds the real code (control for §8b)');
// The four record-shaped conditions are DEMOTIONS, never refusals. Named individually, so
// turning any ONE of them back fails here rather than three of four passing.
for (const cond of [
  ['the project row is no longer in app_projects', 'project row gone'],
  ['the live row is not a development record', 'not a development row'],
  ['the project has no coordinates', 'no coordinates'],
  ['the live coordinates differ from the draft evidence', 'moved away from the draft'],
]) {
  const re = new RegExp(`zipFallback\\('${cond[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  ok(re.test(GEN), `8b: ${cond[1]} is a ZIP-scope DEMOTION, not a refusal`);
}
ok(/await zipFallback\(why\)/.test(GEN),
  '8b: …and so is a project outside the ZIP\'s authoritative development set');
ok(!/await ineligible\(/.test(GEN),
  '8b: no record-shaped condition ends a draft with no picture at all');
// WHAT THE PICTURE IS OF IS WRITTEN DOWN. Without this, a ZIP capture is indistinguishable
// from a project one on the stored row, and the enforced SQL guard defaults it to `project`
// and demands a target it cannot have — which is exactly what blocked all 18 live absence
// captures at the boundary while the browser accepted them.
ok(/const scope = proj \? 'project' : 'zip';/.test(GEN),
  '8b: the shot scope is fixed once, in the one shared finish path');
ok(/\n    scope,\n/.test(GEN),
  '8b: …and is RECORDED on the stored visual, so the row states what its picture is of');
ok(/scope: \(verifyResult && verifyResult\.scope\)/.test(
  readFileSync(new URL('../lib/maps-capture-policy.js', import.meta.url), 'utf8')),
  '8b: …and inside capture_policy, which is where the enforced SQL guard reads it');

// ═══ 9. FINAL ACCEPTANCE (§FINAL) — A ZIP THIS CODE HAS NEVER SEEN ═══════════════════
// Constructed at RUN TIME so it cannot be in any list, in this file or in the product.
const unseen = String(10000 + Math.floor(Math.random() * 89999));
const future = { id: 'synthetic-' + unseen, content_family: 'MAPS', tile: 'development',
  status: 'draft', zip: unseen, image_bucket_path: null,
  evidence: { project_id: null, theme_answer: 'none_found', theme: 'datacenter' } };
ok(HS.mapsCaptureScope(future) === 'zip',
  `9a: a projectless MAPS post in the unseen ZIP ${unseen} resolves to ZIP scope`);
ok(HS.mapsCaptureKey(future) === `v1|${unseen}|absence|datacenter|${POLICY}`,
  '9b: …with a deterministic capture key, derived and not looked up', HS.mapsCaptureKey(future));
ok(HS.mapsMapGateBlock(future) !== '', '9c: …and BEFORE that capture exists, approval is blocked');
const futureShot = capture(future, 'zip');
ok(HS.mapsCaptureBound(futureShot) === true, '9d: …the ZIP capture BINDS');
ok(HS.mapsCaptureState(futureShot) === S.READY, '9e: …reports REAL_MAP_VISUAL');
ok(HS.mapsMapGateBlock(futureShot) === '', '9f: …and only then may it be approved');

console.log(`\n${n - bad} passed, ${bad} failed`);
if (bad) process.exit(1);
