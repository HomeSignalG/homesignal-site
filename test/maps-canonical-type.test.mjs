// The canonical Map 1 DEVELOPMENT TYPE of a MAPS social post — and proof that "Data Center
// Theme" is a view of it, not a second Type system.
//
// WHY THIS EXISTS (2026-09-22). HomeSignal's Bluesky custom feeds subscribe residents to MAPS
// posts by TYPE and by ZIP. The first cut of the feed read `evidence.theme` for TYPE. Measured
// over all 55 production MAPS rows, that field is a Data-Center-only flag: it is `datacenter` or
// empty, while the canonical Type Map 1 resolves for the 37 project posts is residential 16 ·
// datacenter 8 · other 7 · commercial 5 · infrastructure 1. Twenty-two posts carry a real
// canonical Type the theme field cannot represent. A feed built on it could never offer
// Industrial, Residential or Commercial without another `<type>-theme` classifier.
//
// So TYPE is now `HS.mapsSocialTypeKey` — HS.resolveMarker(...).typeKey, the call that already
// picks the marker's shape and PROJECT TYPE bucket on Map 1 — recorded by the capture job as
// `evidence.visual.type_key`. The theme is DERIVED from it. This suite pins both halves.
//
// Run: node test/maps-canonical-type.test.mjs
import fs from 'node:fs';

globalThis.window = globalThis.window || globalThis;
for (const f of ['lib/project-type.js', 'lib/map.js', 'lib/maps-social-theme.js', 'lib/maps-capture-policy.js', 'lib/maps-capture-binding.js']) {
  (0, eval)(fs.readFileSync(f, 'utf8'));
}
const HS = globalThis.window.HS;

let failures = 0;
const check = (name, ok, why) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${ok ? '' : ` (${why})`}`);
  if (!ok) failures++;
};

const FIX = JSON.parse(fs.readFileSync('test/fixtures/maps-social-types-2026-09-22.json', 'utf8')).rows;
const asPost = (r) => ({ content_family: r.content_family, tile: r.tile, zip: r.zip,
  evidence: { theme: r.theme, theme_answer: r.theme_answer, type: r.type, type_raw: r.type_raw,
    project_name: r.project_name, status: r.ev_status, project_id: r.project_id } });
const markerOf = (r) => ({ record_kind: 'development', type: r.type, type_raw: r.type_raw,
  name: r.project_name, status: r.ev_status });

// ── 1. The fixture is the population it claims to be (positive control) ─────────────────
check('1 control: the fixture holds all 55 production MAPS rows', FIX.length === 55, `got ${FIX.length}`);
const absence = FIX.filter((r) => HS.mapsSocialIsAbsence(asPost(r)));
const project = FIX.filter((r) => !HS.mapsSocialIsAbsence(asPost(r)));
check('1b control: 18 absence + 37 project rows', absence.length === 18 && project.length === 37,
  `${absence.length} + ${project.length}`);

// ── 2. Canonical Type IS the resolver's typeKey, for every project row ───────────────────
let same = 0;
for (const r of project) if (HS.mapsSocialTypeKey(asPost(r)) === HS.resolveMarker(markerOf(r)).typeKey) same++;
check('2 mapsSocialTypeKey === HS.resolveMarker(...).typeKey on every project row', same === project.length,
  `${same}/${project.length}`);

// ── 3. It is NOT data-centre-only: the real population spans several Types ───────────────
const dist = {};
for (const r of project) { const t = HS.mapsSocialTypeKey(asPost(r)); dist[t] = (dist[t] || 0) + 1; }
check('3 canonical Types measured: residential 16 · datacenter 8 · other 7 · commercial 5 · infrastructure 1',
  JSON.stringify(dist) === JSON.stringify({ commercial: 5, other: 7, residential: 16, datacenter: 8, infrastructure: 1 })
  || (dist.residential === 16 && dist.datacenter === 8 && dist.other === 7 && dist.commercial === 5 && dist.infrastructure === 1),
  JSON.stringify(dist));
for (const t of Object.keys(dist)) {
  check(`3b ${t} is a CATEGORY_REGISTRY key with Map 1's own label`, !!HS.mapsSocialTypeLabel(t)
    && HS.mapsSocialTypeLabel(t) === HS.CATEGORY_REGISTRY[t].label, t);
}

// ── 4. The stored theme is a LOSSY projection of the canonical Type ─────────────────────
const lossy = project.filter((r) => !r.theme && !['other'].includes(HS.mapsSocialTypeKey(asPost(r))));
check('4 22 posts carry a real canonical Type that evidence.theme cannot represent', lossy.length === 22,
  `got ${lossy.length}`);

// ── 5. The theme is DERIVED from the Type, and agrees with production 55/55 ─────────────
let derived = 0, prod = 0;
for (const r of FIX) {
  const p = asPost(r);
  const t = HS.mapsSocialTypeKey(p);
  const expect = HS.MAPS_SOCIAL_THEMES.some((x) => x.key === t) ? t : null;
  if (HS.mapsSocialThemeKey(p) === expect) derived++;
  if (HS.mapsSocialThemeKey(p) === (r.theme || null)) prod++;
}
check('5 mapsSocialThemeKey === (canonical Type if a campaign exists for it) on all 55', derived === 55, `${derived}/55`);
check('5b the generator\'s stamped theme agrees with Map 1 on all 55 production rows', prod === 55, `${prod}/55`);

// ── 6. The disagreement guard ───────────────────────────────────────────────────────────
const P = (ev) => ({ content_family: 'MAPS', tile: 'development', evidence: ev });
check('6 a theme Map 1 does not share is refused', /is not Map 1's Development Type "residential"/.test(
  HS.mapsSocialTypeProblem(P({ project_id: 'x', type: 'Residential', project_name: 'Condos', theme: 'datacenter' })) || ''), '');
check('6b the real Pennhurst shape (type Industrial, name "Data Centers") is datacenter and passes',
  HS.mapsSocialTypeKey(P({ project_id: 'x', type: 'Industrial', project_name: 'Pennhurst Data Centers', theme: 'datacenter' })) === 'datacenter'
  && HS.mapsSocialTypeProblem(P({ project_id: 'x', type: 'Industrial', project_name: 'Pennhurst Data Centers', theme: 'datacenter' })) === null, '');
check('6c an unthemed record needs no theme to have a Type', HS.mapsSocialTypeProblem(P({ project_id: 'x', type: 'Residential', project_name: 'Condos' })) === null
  && HS.mapsSocialTypeKey(P({ project_id: 'x', type: 'Residential', project_name: 'Condos' })) === 'residential', '');
check('6d an absence post takes the Type it answers, only when that is a registry key',
  HS.mapsSocialTypeKey(P({ theme_answer: 'none_found', theme: 'datacenter' })) === 'datacenter'
  && HS.mapsSocialTypeKey(P({ theme_answer: 'none_found', theme: 'industrial' })) === 'industrial'
  && HS.mapsSocialTypeKey(P({ theme_answer: 'none_found', theme: 'solar' })) === null
  && HS.mapsSocialTypeKey(P({ theme_answer: 'none_found', theme: 'facility' })) === null, '');
check('6e not MAPS / not development / no backbone -> null, never a guess',
  HS.mapsSocialTypeKey({ content_family: 'ALERTS', tile: 'development', evidence: { type: 'Residential' } }) === null
  && HS.mapsSocialTypeKey({ content_family: 'MAPS', tile: 'news', evidence: { type: 'Residential' } }) === null, '');

// ── 7. No Type vocabulary lives in the theme module (it would be a second authority) ────
const SRC = fs.readFileSync('lib/maps-social-theme.js', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
check('7 maps-social-theme.js holds no Type names or data-centre vocabulary in code',
  !/industrial|residential|commercial|infrastructure|data\s*cent|hyperscale/i.test(SRC.replace(/var THEMES = \[.*\];/, '')), '');
check('7b the theme is computed FROM mapsSocialTypeKey, with no resolver call of its own',
  /HS\.mapsSocialThemeKey = function \(post\) \{\s*var t = HS\.mapsSocialTypeKey\(post\);/.test(SRC)
  && (SRC.match(/HS\.resolveMarker\(/g) || []).length === 1, '');

// ── 8. The capture job records it, refuses before upload, and backfills only READY rows ─
// Comment-stripped: a call that survives only inside a comment must not satisfy a pin.
const JOB = fs.readFileSync('scripts/maps-social-image.mjs', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const fin = JOB.slice(JOB.indexOf('async function finishCapture('), JOB.indexOf('async function attach('));
check('8 control: finishCapture region located', fin.includes('await upload(objectPath, r.file)'), '');
check('8b the Type problem is checked BEFORE the upload', fin.indexOf('HS.mapsSocialTypeProblem(d)') > 0
  && fin.indexOf('HS.mapsSocialTypeProblem(d)') < fin.indexOf('await upload('), '');
check('8c attach stamps type_key and type_label from the canonical functions',
  /type_key: HS\.mapsSocialTypeKey\(draft\)/.test(JOB) && /type_label: HS\.mapsSocialTypeLabel\(HS\.mapsSocialTypeKey\(draft\)\)/.test(JOB), '');
const stamp = JOB.slice(JOB.indexOf('async function stampTypes('), JOB.indexOf('async function main('));
check('8d the backfill touches only READY rows and writes through guardedPatch',
  /mapsCaptureState\(d\) !== READY/.test(stamp) && /guardedPatch\(d,/.test(stamp) && !/method: 'PATCH'/.test(stamp), '');

// ── 9. Stamping the Type does not move the capture binding key ──────────────────────────
let keySame = 0;
for (const r of FIX) {
  const p = asPost(r);
  const withType = { ...p, evidence: { ...p.evidence, visual: { type_key: HS.mapsSocialTypeKey(p) || 'x', type_label: 'y' } } };
  if (HS.mapsCaptureKey(p) === HS.mapsCaptureKey(withType)) keySame++;
}
check('9 adding visual.type_key leaves HS.mapsCaptureKey unchanged on all 55 (no picture is unbound)', keySame === 55, `${keySame}/55`);

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nall checks passed');
