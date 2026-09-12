// source-monitor: an UNREACHABLE entry must name WHY, and an array-valued status column must
// be read the way the connector reads it.
//
// WHAT WAS WRONG (measured on the 2026-09-11 nightly, docs/source-monitor-report.md:
// "Registry entries checked: 169 · unreachable: 11"). Every one of the eleven rows carried the
// SAME sentence — "in-window status read returned null (<family> reader could not resolve a
// status domain)" — because arcgisGroupBy, arcgisDistinct and the socrata reader each collapsed
// a 404, a 429, an ArcGIS in-band error and an unsupported field to one bare `null`. `jget`
// already had the status code and a body snippet; every caller discarded it. The report could
// therefore only ever restate that the read failed, never what failed, and eleven entries were
// undiagnosable from the committed artifact for weeks.
//
// That is this repo's own rule turned on the instrument: "no match" and "did not run" must never
// be indistinguishable. An unreachable entry is NOT a clean entry — a value could be dropping
// records there and the run would not know — so the reason is the only thing that makes the
// non-clean state actionable.
//
// THE ONE CAUSE PROVABLE OFFLINE. `kytc-syp-highway-plan` is the only array-valued `status_raw`
// in the registry, and it is in the unreachable cohort. `encodeURIComponent(['A','B'])` yields
// the single string `A,B`, which was sent as one `onStatisticField`; ArcGIS rejects it. The
// remaining ten need the reason string to be diagnosed, which is what the rest of this change
// delivers — this sandbox has no egress and NONE of these publishers was probed here.
//
// Run: node test/source-monitor-unreachable-reason.test.mjs   (discovered by scripts/run-unit-tests.mjs)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fieldList, joinFieldValues, describeFailure } from '../scripts/lib/status-drift.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const MON = readFileSync(join(ROOT, 'scripts/source-monitor.mjs'), 'utf8');
const ARCGIS_TS = readFileSync(join(ROOT, 'supabase/functions/get-address-report/sources/arcgis.ts'), 'utf8');
const REG = JSON.parse(readFileSync(join(ROOT, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));

// ── 1. describeFailure turns each real failure SHAPE into a distinguishable sentence ─────
// The point is not the wording, it is that the four shapes cannot collapse onto each other.
{
  const inBand = describeFailure({ ok: true, status: 200, json: { error: { code: 400, message: 'Unable to complete operation.', details: ['Invalid field: A,B'] } } });
  ok(/400/.test(inBand) && /Invalid field: A,B/.test(inBand),
    '1a an ArcGIS in-band error on HTTP 200 reports its CODE and its detail — the shape that '
    + 'looks like success to any check keyed on the status line', inBand);

  const notFound = describeFailure({ ok: false, status: 404, text: '<html>404</html>', json: null });
  ok(/404/.test(notFound), '1b a real HTTP status is reported as itself', notFound);

  const rate = describeFailure({ ok: false, status: 429, text: '', json: null });
  ok(/429/.test(rate) && /NOT 429/.test(rate),
    '1c 429 says jget does not retry it — three of the eleven unreachable entries are socrata '
    + '(chicago-building-permits, nyc-dobnow-approved-permits, nyc-dob-permit-issuance) and an '
    + 'un-retried throttle is the leading hypothesis the reason string exists to confirm', rate);

  const net = describeFailure({ ok: false, status: 0, text: 'ENOTFOUND example.gov', json: null });
  ok(/ENOTFOUND/.test(net) && !/HTTP 0/.test(net),
    '1d a pre-response network failure is NOT rendered as "HTTP 0", which reads like a status',
    net);

  const all = new Set([inBand, notFound, rate, net]);
  ok(all.size === 4, '1e all four shapes produce DIFFERENT sentences — the whole defect was one '
    + 'sentence for every cause', [...all].join(' | '));

  ok(describeFailure(null) === 'no response object',
    '1f a missing response object is still described, never `undefined` in the report');

  // Body snippets are bounded: a 200KB HTML error page must not land in a committed markdown table.
  const huge = describeFailure({ ok: false, status: 500, text: 'x'.repeat(50000), json: null });
  ok(huge.length < 400, '1g the body snippet is truncated — the report is committed to the repo',
    String(huge.length));
}

// ── 2. joinFieldValues reproduces the SHIPPED connector's readCol, exactly ────────────────
// If the monitor joined differently from sources/arcgis.ts, every row of an array-valued entry
// would read as an unmapped value and the check would manufacture national drift on clean data.
{
  // The shipped semantics, quoted from the connector so this test fails if IT changes.
  const readColSrc = ARCGIS_TS.slice(ARCGIS_TS.indexOf('function readCol'), ARCGIS_TS.indexOf('function readCol') + 400);
  ok(/\.join\("\s"\)/.test(readColSrc) || /\.join\(" "\)/.test(readColSrc),
    '2a sources/arcgis.ts::readCol joins with a SINGLE SPACE (read from the connector, not '
    + 'recalled)', readColSrc.split('\n').find((l) => l.includes('join')) || '(no join line found)');
  ok(/filter\(\(v\) => v != null && String\(v\)\.trim\(\) !== ""\)/.test(readColSrc),
    '2b …and drops null/blank parts before joining', 'filter clause not found in readCol');

  ok(joinFieldValues({ A: 'Under', B: 'Design' }, ['A', 'B']) === 'Under Design',
    '2c two present parts join with one space');
  ok(joinFieldValues({ A: '  Under  ', B: ' Design ' }, ['A', 'B']) === 'Under Design',
    '2d each part is trimmed first — the connector trims, so an untrimmed probe value would '
    + 'never match a mapped key');
  ok(joinFieldValues({ A: 'Under', B: '   ' }, ['A', 'B']) === 'Under',
    '2e a blank part is DROPPED, it does not become a trailing space');
  ok(joinFieldValues({ A: null, B: null }, ['A', 'B']) === undefined,
    '2f all parts blank ⇒ undefined, which the drift check treats as blank_status and fails closed');
  // The single-field case must stay byte-identical to the old behaviour, or 169 clean entries move.
  ok(joinFieldValues({ A: '  Issued ' }, ['A']) === '  Issued ',
    '2g the SINGLE-field case is passed through UNCHANGED — the old reader returned the raw '
    + 'attribute and the drift check trims downstream; trimming here too would be a silent '
    + 'behaviour change on all 168 non-array entries');
  ok(fieldList('A')[0] === 'A' && fieldList(['A', 'B']).length === 2,
    '2h fieldList normalises both shapes');
}

// ── 3. the registry fact this fix is aimed at ────────────────────────────────────────────
{
  const arrayValued = (REG.arcgis || []).filter((e) => Array.isArray(e.column_map?.status_raw));
  ok(arrayValued.length === 1 && arrayValued[0].registry_id === 'kytc-syp-highway-plan',
    '3a exactly ONE arcgis entry has an array-valued status_raw, and it is kytc-syp-highway-plan '
    + '— the one unreachable entry whose cause is provable without egress',
    arrayValued.map((e) => e.registry_id).join(', ') || '(none)');
  if (arrayValued.length === 1) {
    ok(arrayValued[0].column_map.status_raw.length === 2,
      '3b …with two fields, so the joined value is what the connector buckets');
  }
}

// ── 4. the reason actually reaches the report — the composition, which is load-bearing ───
// Every assertion above can pass while the reason is computed and discarded. These pin the wiring.
{
  ok(/const inDiag = \{\};/.test(MON) && /readDomain\(false, inDiag\)/.test(MON),
    '4a the in-window read is handed a diag out-parameter');
  const wired = MON.match(/inDiag\.reason \|\| 'reader returned null without recording a reason'/g) || [];
  ok(wired.length === 2,
    '4b BOTH the status check and its type-drift twin interpolate the captured reason — the two '
    + 'blocks are near-identical and fixing one is the obvious half-fix', String(wired.length));
  ok(!/read returned null \(\$\{family\} reader could not resolve/.test(MON),
    '4c the old cause-free sentence is GONE from both blocks');
  const vDiag = MON.match(/arcgisDistinct\(.*vDiag\);/g) || [];
  ok(vDiag.length === 2,
    '4d the arcgis verbatim-confirmation failure — a SEPARATE unreachable path with its own '
    + 'reason string — is diagnosable too', String(vDiag.length));
  // The recon call sites must keep the old contract: diag is an out-param precisely so they need
  // no change. If they had been given one, this would be a wider behaviour change than claimed.
  // Declaration excluded: `async function arcgisGroupBy(...)` legitimately names diag.
  const reconCalls = (MON.match(/(?<!function )arcgisGroupBy\([^)]*\)/g) || [])
    .filter((c) => !c.includes('e.service_url'));
  ok(reconCalls.every((c) => !/diag/.test(c)),
    '4e the recon call sites are UNTOUCHED — they keep their rows|null contract',
    reconCalls.join(' | '));
}

// ── 5. the array fix itself, in the shipped query builder ────────────────────────────────
{
  const gb = MON.slice(MON.indexOf('async function arcgisGroupBy'), MON.indexOf('async function arcgisDistinct'));
  ok(/onStatisticField: fields\[0\]/.test(gb),
    '5a the statistic is counted on ONE field — ArcGIS rejects a comma-joined onStatisticField, '
    + 'which is why kytc was unreachable every run');
  ok(/groupByFieldsForStatistics=\$\{encodeURIComponent\(fields\.join\(','\)\)\}/.test(gb),
    '5b …while the GROUP BY carries every field, so both parts come back to be joined');
  ok(/merged/.test(gb),
    '5c counts are merged per JOINED value — two field combinations can join to the same string '
    + '(a blank second part joins to the first alone) and emitting it twice would double-count '
    + 'against the 5% volume bound');
  const dv = MON.slice(MON.indexOf('async function arcgisDistinct'));
  ok(/outFields=\$\{encodeURIComponent\(fields\.join\(','\)\)\}/.test(dv.slice(0, 700)),
    '5d the verbatim confirmation requests both fields too, or it could never confirm a joined '
    + 'value and kytc would stay unreachable at the second gate instead of the first');
}

console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
