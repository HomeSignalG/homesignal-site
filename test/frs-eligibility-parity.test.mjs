// ELIGIBILITY PARITY — the national whole-ZIP facility build must qualify EXACTLY
// the facilities the shipped engine qualifies today.
//
// Map 1's Regulated facility population is moving from a ZIP-centroid radius query to
// whole-ZIP ST_Intersects membership. That changes WHICH ZIP a facility belongs to. It
// must not change WHICH FACILITIES QUALIFY — otherwise the correction silently ships a
// differently defined facility universe, which is the one outcome that would be worse
// than the radius bug it fixes.
//
// The shipped predicate is supabase/functions/get-address-report/index.ts::looksIndustrial.
// The build applies it from Python (scripts/frs_eligibility.py) on a runner. This file is
// the differential proof between the two, and it is deliberately built so neither side can
// be "made to agree" by editing a copied list:
//
//   * the JS side is EVALUATED FROM THE SHIPPED SOURCE TEXT of index.ts — the real
//     LAYER_KEYWORDS / INCLUDE / EXCLUDE / tokenize / looksIndustrial spans, not a
//     re-typed copy. Change index.ts and this side changes with it.
//   * the Python side PARSES the same file for its token sets (frs_eligibility.py), so
//     only the 5-line evaluation ORDER is independently implemented — which is exactly
//     the thing worth proving.
//
// Both extractions FAIL CLOSED: a rename or reflow in index.ts fails this test rather
// than quietly comparing two empty sets and reporting green. Required: 0 mismatches.

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };

const ENGINE = join(root, 'supabase/functions/get-address-report/index.ts');
const src = readFileSync(ENGINE, 'utf8');

// ── extract the shipped spans, failing closed ────────────────────────────────
function span(opener, closer, label) {
  const i = src.indexOf(opener);
  if (i < 0) throw new Error(`index.ts no longer contains ${label} opener: ${opener}`);
  const j = src.indexOf(closer, i + opener.length);
  if (j < 0) throw new Error(`index.ts ${label} span is unterminated`);
  return src.slice(i, j + closer.length);
}

const layersSrc = span('const LAYER_KEYWORDS: [string, string[]][] = [', '\n];', 'LAYER_KEYWORDS')
  .replace(': [string, string[]][]', '');
const includeSrc = span('const INCLUDE = new Set([', '\n]);', 'INCLUDE');
const excludeSrc = span('const EXCLUDE = new Set([', '\n]);', 'EXCLUDE');
// tokenize is a ONE-LINE function in index.ts, so its span must end at that line's
// newline. Closing on '\n}' instead would run past it and swallow looksIndustrial's own
// annotated signature into this span, leaving a type annotation in the evaluated text.
const tokenizeSrc = span('function tokenize(name: string): Set<string> {', '}\n', 'tokenize')
  .replace('(name: string): Set<string>', '(name)');
const predicateSrc = span('function looksIndustrial(name: string): boolean {', '\n}', 'looksIndustrial')
  .replace('(name: string): boolean', '(name)');

// Nothing typed survives into the evaluated JS — if a future edit adds an annotation the
// strip above does not know about, `new Function` throws and the suite fails loudly.
const shipped = new Function(
  `${layersSrc}\n${includeSrc}\n${excludeSrc}\n${tokenizeSrc}\n${predicateSrc}\n` +
  'return { looksIndustrial, INCLUDE, EXCLUDE };')();

ok(shipped.INCLUDE instanceof Set && shipped.INCLUDE.size >= 30,
  `1: shipped INCLUDE evaluated (size ${shipped.INCLUDE.size})`);
ok(shipped.EXCLUDE instanceof Set && shipped.EXCLUDE.size >= 30,
  `1: shipped EXCLUDE evaluated (size ${shipped.EXCLUDE.size})`);

// ── the corpus ───────────────────────────────────────────────────────────────
const corpusPath = join(root, 'test/fixtures/frs-eligibility-names.json');
const names = JSON.parse(readFileSync(corpusPath, 'utf8'));
ok(Array.isArray(names) && names.length >= 500, `2: corpus loaded (${names.length} names)`);

// On a runner, scripts/frs_bulk_probe.py emits a large sample of REAL FacilityName values
// straight out of the EPA bulk archive. When it is present the differential runs over that
// too, which is Gate 1's "substantial sample of real FRS names" at national scale rather
// than at fixture scale. Offline the committed fixture stands alone and this is a no-op.
const extraPath = process.env.EXTRA_NAMES_FILE || '';
if (extraPath && existsSync(extraPath)) {
  const extra = JSON.parse(readFileSync(extraPath, 'utf8'));
  ok(Array.isArray(extra) && extra.length > 0, `2: extra corpus loaded (${extra.length} names)`);
  for (const n of extra) names.push(n);
  console.log(`corpus extended from ${extraPath}: total ${names.length}`);
}

// A corpus that only ever produces one answer proves nothing about the other branch —
// the vacuous-invariant shape. Both verdicts must actually occur.
const jsVerdicts = names.map((n) => shipped.looksIndustrial(n));
const yes = jsVerdicts.filter(Boolean).length;
ok(yes > 50 && yes < names.length - 50,
  `2: corpus exercises BOTH verdicts (${yes} eligible / ${names.length - yes} not)`);

// ── the Python side, run as the build will run it ────────────────────────────
const py = spawnSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))})
from frs_eligibility import looks_industrial, INCLUDE, EXCLUDE
names = json.load(sys.stdin)
print(json.dumps({"v": [looks_industrial(n) for n in names],
                  "inc": sorted(INCLUDE), "exc": sorted(EXCLUDE)}))
`], { encoding: 'utf8', input: JSON.stringify(names), maxBuffer: 512 * 1024 * 1024 });

ok(py.status === 0, `3: python evaluator ran — ${(py.stderr || '').slice(0, 400)}`);
const pyOut = py.status === 0 ? JSON.parse(py.stdout) : { v: [], inc: [], exc: [] };

// ── 4. the token sets themselves must be identical, not merely agreeing on this corpus
const jsInc = [...shipped.INCLUDE].sort(), jsExc = [...shipped.EXCLUDE].sort();
ok(JSON.stringify(jsInc) === JSON.stringify(pyOut.inc),
  `4: INCLUDE identical (js ${jsInc.length} / py ${pyOut.inc.length})`);
ok(JSON.stringify(jsExc) === JSON.stringify(pyOut.exc),
  `4: EXCLUDE identical (js ${jsExc.length} / py ${pyOut.exc.length})`);

// ── 5. THE DIFFERENTIAL: zero classification mismatches ──────────────────────
const mismatches = [];
for (let i = 0; i < names.length; i++) {
  if (jsVerdicts[i] !== pyOut.v[i]) mismatches.push({ name: names[i], js: jsVerdicts[i], py: pyOut.v[i] });
}
ok(mismatches.length === 0,
  `5: 0 classification mismatches — got ${mismatches.length}: ` +
  JSON.stringify(mismatches.slice(0, 5)));

// ── 6. the ordering rule, pinned explicitly ──────────────────────────────────
// EXCLUDE is checked BEFORE the data-center literal, so a name carrying both is
// rejected. A future refactor that reorders the three steps would still pass the
// differential (both sides would move together only if both are edited), so the
// product-visible behaviour is asserted here directly against the shipped function.
ok(shipped.looksIndustrial('SCHOOL DATA CENTER') === false,
  '6: EXCLUDE veto beats the data-center literal (shipped)');
ok(shipped.looksIndustrial('ALIGNED DATA CENTER SLC-4') === true,
  '6: a real data centre still qualifies (shipped)');
ok(shipped.looksIndustrial('BANK DATA CENTER') === false,
  '6: excluded-token data centre rejected (shipped)');

// ── 7. radius / distance / cap are NOT part of eligibility ───────────────────
// The whole point of the correction. If any of these ever leaks into the predicate the
// national build would inherit a geographic filter it must not have.
for (const forbidden of ['radius', 'distance', 'MAX_FACILITIES', 'search_radius', '_d']) {
  ok(!predicateSrc.includes(forbidden),
    `7: looksIndustrial contains no geographic term (${forbidden})`);
}

console.log(`eligible ${yes} / not-eligible ${names.length - yes} over ${names.length} names`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
