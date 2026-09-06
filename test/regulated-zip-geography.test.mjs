// REGULATED FACILITIES — ZIP GEOGRAPHY TRUTH, and the ceiling that is not a count.
//
// Map 1 has two geography contracts and they must never be conflated. For the Regulated Type:
//
//   ADDRESS MODE  HOME (geocoded) + the radius the resident picked. Proven correct; pinned in
//                 test/regulated-facility-type.test.mjs §9.
//   ZIP MODE      still `ZIP centroid -> 3-mile radius -> nearest MAX_FACILITIES`, which is NOT
//                 the ZIP's geography. geo.zip_authoritative_membership held 0 rows keyed
//                 `epa_frs:%` when this file was written, so no facility has whole-ZIP
//                 membership yet.
//
// This file does two jobs. It pins the DISCLOSURE that makes the current state honest, and it
// carries the adversarial production cases as a fixture so that the day whole-ZIP facility
// membership lands, the acceptance test is already written.
//
// The adversarial cases are real records, measured against authoritative TIGER ZCTA polygons
// (geo.zcta_boundary, TIGER/Line 2025) on 2026-09-05:
//
//   INSIDE THE ZIP, BEYOND THE RADIUS, NOT SHOWN — 84321 (Logan UT)
//     HYRUM CITY POWER            7.19 mi from the ZIP centroid
//     NIBLEY WASH PLANT           6.64
//     CUSTOM MANUFACTURING        5.41
//     ELECTRICAL POWER SYSTEMS    4.69
//   OUTSIDE THE ZIP, INSIDE THE RADIUS, SHOWN ANYWAY
//     CENTRAL HEATING PLANT       0.05 mi from the 84408 centroid, outside the 84408 ZCTA
//     OGDEN PLANT                 0.63
//     GOSSNER GRADE A NORTH WAREHOUSE 0.96 mi from the 84321 centroid, outside the 84321 ZCTA
//   MORE THAN THE CAP — 84321 holds at least 56 qualifying facilities inside its own ZCTA and
//     the page shows 40.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };

const page = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
const engine = readFileSync(join(root, 'supabase/functions/get-address-report/index.ts'), 'utf8');

// ── 1. the page's cap constant must equal the engine's, or disclosure goes stale ──
const engineCap = /const MAX_FACILITIES = (\d+);/.exec(engine);
const pageCap = /var FACILITY_QUERY_CAP = (\d+);/.exec(page);
ok(!!engineCap, '1: engine still declares MAX_FACILITIES');
ok(!!pageCap, '1: page still declares FACILITY_QUERY_CAP');
ok(engineCap && pageCap && engineCap[1] === pageCap[1],
  `1: page cap ${pageCap && pageCap[1]} === engine cap ${engineCap && engineCap[1]}`);
// and the engine must still be the thing that slices, or the disclosure describes nothing
ok(/kept\.slice\(0, MAX_FACILITIES\)/.test(engine),
  '1: the engine still truncates to the nearest MAX_FACILITIES — the fact being disclosed');

// ── 2. the disclosure rule itself, evaluated from the shipped source ─────────────
const block = (() => {
  const i = page.indexOf('    var facShown = (data.counts && data.counts.facilities) != null');
  // End at the DEVELOPMENT counter's own comment, not at cDev: main's development
  // not-measured block sits between the two and reads `window`, which does not exist here.
  // The span must be exactly the facility disclosure - this Type's block and nothing else.
  const j = page.indexOf('    // DEVELOPMENT: same rule as facilities above', i);
  if (i < 0 || j < 0) throw new Error('the facility-count disclosure block moved or was removed');
  return page.slice(i, j);
})();

function renderFacTile({ facShown, facUnavailable, zipMode }) {
  const nodes = { cFac: { textContent: '', parentNode: { title: '' } }, kFac: { textContent: '' } };
  const fn = new Function('data', 'fac', 'FAC_UNAVAILABLE', 'ZIP_MODE', 'FACILITY_QUERY_CAP', '$',
    block + '\n return { n: $("cFac").textContent, k: $("kFac").textContent, title: $("cFac").parentNode.title };');
  return fn({ counts: { facilities: facShown } }, [], facUnavailable, zipMode,
    Number(pageCap[1]), (id) => nodes[id]);
}

const CAP = Number(pageCap[1]);

// A capped page states a LOWER BOUND, never a total.
const zipCapped = renderFacTile({ facShown: CAP, facUnavailable: false, zipMode: true });
ok(zipCapped.n === CAP + '+', `2: ZIP at the cap renders "${CAP}+" (got ${zipCapped.n})`);
ok(/nearest 40 shown/.test(zipCapped.k), `2: the label says which forty (got ${zipCapped.k})`);
ok(/there may be more/i.test(zipCapped.title), '2: the tooltip says more may exist');
ok(/Nearby/.test(zipCapped.k), '2: and it still says NEARBY, never "in this ZIP"');

// An uncapped page states the exact number and claims nothing about truncation.
const zipUnder = renderFacTile({ facShown: 7, facUnavailable: false, zipMode: true });
ok(zipUnder.n === '7', `2: below the cap renders the exact count (got ${zipUnder.n})`);
ok(!/nearest/.test(zipUnder.k), '2: below the cap the label makes no truncation claim');
ok(/Every regulated facility/.test(zipUnder.title), '2: below the cap the tooltip says the set is complete for the search');

// Zero is a real zero and must not be dressed up.
const zipZero = renderFacTile({ facShown: 0, facUnavailable: false, zipMode: true });
ok(zipZero.n === '0', '2: a genuine zero still renders 0');

// An EPA failure is unknown, not zero, and never capped.
const unavail = renderFacTile({ facShown: 0, facUnavailable: true, zipMode: true });
ok(unavail.n === '—', '2: an unavailable read renders an em-dash, not 0');
ok(/unknown rather than zero/.test(unavail.title), '2: and says why');

// ── 3. address mode is capped by the SAME slice, so it discloses too ─────────────
const addrCapped = renderFacTile({ facShown: CAP, facUnavailable: false, zipMode: false });
ok(addrCapped.n === CAP + '+', '3: address mode at the cap also renders a lower bound');
ok(/nearest 40 shown/.test(addrCapped.k), '3: address mode discloses the same truncation');
// ...but its GEOGRAPHY is untouched by this change.
ok(/facilitySites\(lat, lng, radiusMi\)/.test(engine), '3: address mode still queries from HOME at the chosen radius');
ok(/if \(d > radiusMi \+ 0\.05\) continue;/.test(engine), '3: address mode still culls by true distance from HOME');

// ── 4. ZIP mode must not claim whole-ZIP facility coverage while it has none ─────
ok(/ZIP_RADIUS_MI = 3;/.test(engine), '4: the ZIP facility query is still a centroid radius');
ok(/facilitySites\(clat, clng, zipRadius\)/.test(engine), '4: and that radius still selects them');
ok(/Nearby regulated facilities/.test(page), '4: the ZIP tile says NEARBY');
ok(!/regulated facilities (in|across|throughout) (this )?ZIP/i.test(page),
  '4: no wording anywhere claims facilities are measured across the ZIP');
// the development half DOES make a whole-ZIP claim, and that separation must survive
ok(/New projects proposed across this ZIP/.test(page),
  '4: development still names itself as the whole-ZIP measurement');
ok(/counts a ZIP page can add together|adding whole-ZIP development to nearby/.test(page),
  '4: the two scopes are still documented as non-additive');

// ── 5. the adversarial fixture — the acceptance test for the eventual fix ────────
// Each row is a real production record measured against its authoritative ZCTA polygon.
// TODAY these are the defect. When epa_frs whole-ZIP membership lands, `expectShown` is what
// the ZIP query must return, and this fixture becomes the proof.
const ADVERSARIAL = [
  { zip: '84321', name: 'HYRUM CITY POWER',                 miFromCentroid: 7.19, insideZcta: true,  shownToday: false, expectShown: true },
  { zip: '84321', name: 'NIBLEY WASH PLANT',                miFromCentroid: 6.64, insideZcta: true,  shownToday: false, expectShown: true },
  { zip: '84321', name: 'CUSTOM MANUFACTURING',             miFromCentroid: 5.41, insideZcta: true,  shownToday: false, expectShown: true },
  { zip: '84321', name: 'ELECTRICAL POWER SYSTEMS',         miFromCentroid: 4.69, insideZcta: true,  shownToday: false, expectShown: true },
  { zip: '84408', name: 'CENTRAL HEATING PLANT',            miFromCentroid: 0.05, insideZcta: false, shownToday: true,  expectShown: false },
  { zip: '84408', name: 'OGDEN PLANT',                      miFromCentroid: 0.63, insideZcta: false, shownToday: true,  expectShown: false },
  { zip: '84321', name: 'GOSSNER GRADE A NORTH WAREHOUSE',  miFromCentroid: 0.96, insideZcta: false, shownToday: true,  expectShown: false },
];
// The fixture must actually exercise both failure directions, or it proves nothing.
ok(ADVERSARIAL.some((r) => r.insideZcta && r.miFromCentroid > 3),
  '5: fixture contains an in-ZIP facility beyond the 3-mile radius (omission case)');
ok(ADVERSARIAL.some((r) => !r.insideZcta && r.miFromCentroid < 3),
  '5: fixture contains an out-of-ZIP facility inside the radius (contamination case)');
// The contract the fix must satisfy: membership follows the polygon, never the distance.
for (const r of ADVERSARIAL) {
  ok(r.expectShown === r.insideZcta,
    `5: ${r.zip} ${r.name} — expected membership follows the ZCTA polygon, not ${r.miFromCentroid} mi`);
  ok(r.shownToday !== r.expectShown,
    `5: ${r.zip} ${r.name} — is a real defect today (shown=${r.shownToday}, should be ${r.expectShown})`);
}
// 84321 holds at least 56 inside its own ZCTA; the cap is 40. Geographic truth cannot be
// redefined as "the nearest 40", which is exactly why the tile now says 40+.
ok(56 > CAP, '5: 84321 exceeds the cap — its truth is not "the nearest 40"');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
