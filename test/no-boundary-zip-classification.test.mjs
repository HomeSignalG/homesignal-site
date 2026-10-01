// Fix 4 — the classification of every canonical ZIP with no Census ZCTA boundary
// Run: node test/no-boundary-zip-classification.test.mjs
//
// scripts/fix4_classify_no_boundary_zips.py is the ONE place a class is decided. This test
// does not decide classes again. It checks that what is committed is internally whole and
// agrees with the evidence it was built from:
//
//   §1 the input is the production export the database fingerprinted, row for row;
//   §2 the output covers exactly that input, in order, and matches its own summary;
//   §3 the vocabulary is closed and every class carries the founder's disposition
//      (legitimate non-ZCTA -> stays not_measured; a HomeSignal omission -> correct the
//      boundary, never accept it);
//   §4 "Census has no current ZCTA" rests on a checked Census read, and an omission is
//      exactly a ZIP that read found;
//   §5 there are no omissions today.
//
// Regeneration from the pinned USPS dataset is proven separately by
// .github/workflows/no-boundary-zip-classification.yml (`--check`), which needs PyPI.
let fails = 0;
const ok = (c, name, ev) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (c || ev === undefined ? '' : '\n        ' + ev));
  if (!c) fails++;
};

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');

const DIR = 'docs/maps-coverage/fix4/';
const ev = JSON.parse(read(DIR + 'census-zcta-evidence-2026-10-01.json'));
const psv = read(DIR + 'no-boundary-zips-2026-10-01.psv');
const csvText = read(DIR + 'no-boundary-zip-classification.csv');
const summary = JSON.parse(read(DIR + 'no-boundary-zip-classification.summary.json'));

// ── §1 the input is the database's export ────────────────────────────────────────────────
const inLines = psv.replace(/\n$/, '').split('\n');
const inZips = inLines.map((l) => l.split('|')[0]);
ok(inLines.length === ev.no_boundary_input.rows && inLines.length > 0,
  `1a the input has the ${ev.no_boundary_input.rows} rows the database exported`, inLines.length);
ok(md5(inLines.join('\n')) === ev.no_boundary_input.rows_md5,
  '1b ...and its rows fingerprint to the database\'s rows_md5', md5(inLines.join('\n')));
ok(md5(inZips.join(',')) === ev.no_boundary_input.zip_md5,
  '1c ...and its ZIPs to the database\'s zip_md5', md5(inZips.join(',')));
ok(new Set(inZips).size === inZips.length && inZips.every((z, i) => i === 0 || inZips[i - 1] < z),
  '1d ZIPs are unique and in byte order');
ok(inLines.every((l) => /^\d{5}\|[A-Z]{2}\|[^|]+\|[^|]+$/.test(l)),
  '1e every row is zip|state|county|page_name', inLines.find((l) => !/^\d{5}\|[A-Z]{2}\|[^|]+\|[^|]+$/.test(l)));
ok(ev.serving.not_measured_zip_md5 === ev.no_boundary_input.zip_md5
   && ev.serving.not_measured === ev.no_boundary_input.rows,
  '1f the serving generation marked exactly these ZIPs not_measured when the export was read');

// ── §2 the output covers exactly the input ───────────────────────────────────────────────
const HEADER = 'zip,state,county,page_name,usps_type,usps_active,usps_city,census_zcta_2020,census_zcta_2010,class,disposition';
const csvLines = csvText.replace(/\n$/, '').split('\n');
ok(csvLines[0] === HEADER, '2a the output header is the documented one', csvLines[0]);
// No field in this file can contain a comma or a quote: page names, cities and counties are
// checked here so the split below is a real parse, not a hope.
ok(!/"/.test(csvText), '2b no quoted field (so a plain comma split is exact)');
const rows = csvLines.slice(1).map((l) => {
  const f = l.split(',');
  return Object.fromEntries(HEADER.split(',').map((h, i) => [h, f[i]]));
});
ok(csvLines.slice(1).every((l) => l.split(',').length === 11), '2c every output row has 11 fields');
ok(rows.length === inLines.length, '2d one output row per input row', rows.length);
ok(rows.every((r, i) => [r.zip, r.state, r.county, r.page_name].join('|') === inLines[i]),
  '2e ...in the same order, carrying the input\'s page columns unchanged',
  rows.find((r, i) => [r.zip, r.state, r.county, r.page_name].join('|') !== inLines[i]));
ok(md5(csvText) === summary.csv_md5, '2f the CSV is the one its summary describes', md5(csvText));
ok(summary.rows === rows.length && summary.zip_md5 === ev.no_boundary_input.zip_md5,
  '2g ...over the same rows');

// ── §3 a closed vocabulary, each class with the founder's disposition ────────────────────
const DISPOSITION = {
  HOMESIGNAL_OMISSION: 'correct_boundary',
  NOT_IN_USPS_DATASET: 'not_measured',
  USPS_RETIRED: 'not_measured',
  USPS_PO_BOX: 'not_measured',
  USPS_UNIQUE: 'not_measured',
  USPS_MILITARY: 'not_measured',
  USPS_STANDARD_NO_CENSUS_ZCTA: 'not_measured',
};
ok(rows.every((r) => r.class in DISPOSITION), '3a every class is in the closed vocabulary',
  rows.find((r) => !(r.class in DISPOSITION)));
ok(rows.every((r) => r.disposition === DISPOSITION[r.class]),
  '3b every row carries its class\'s disposition: legitimate stays not_measured, an omission is corrected',
  rows.find((r) => r.disposition !== DISPOSITION[r.class]));
ok(JSON.stringify(Object.keys(summary.classes).sort()) === JSON.stringify(Object.keys(DISPOSITION).sort()),
  '3c the summary reports every class, and only those');
const counted = {};
for (const r of rows) counted[r.class] = (counted[r.class] || 0) + 1;
ok(Object.keys(DISPOSITION).every((c) => (counted[c] || 0) === summary.classes[c]),
  '3d the summary\'s counts are the CSV\'s counts', JSON.stringify(counted));
ok(JSON.stringify(summary.dispositions) === JSON.stringify(DISPOSITION),
  '3f the generator\'s class -> disposition table is the founder\'s contract, including for classes no row carries',
  JSON.stringify(summary.dispositions));
ok(summary.legitimate_not_measured + summary.homesignal_omissions === rows.length,
  '3e legitimate + omissions = every row (the two groups partition the input)');

// ── §4 "no current ZCTA" rests on a checked Census read ──────────────────────────────────
const layers = ev.census_zcta_2020_layers.layers;
ok(layers.length > 0, '4a at least one current Census layer was read');
ok(layers.every((l) => l.http_status === 200 && l.features === ev.boundary_table.rows
                    && l.codes_md5 === ev.boundary_table.codes_md5),
  '4b every current Census layer is exactly geo.zcta_boundary\'s code set (so no Census ZCTA is missing from it)');
ok(layers.every((l) => l.in_census_not_in_boundary_table === 0 && l.in_boundary_table_not_in_census === 0),
  '4c ...in both directions');
ok(layers.every((l) => l.positive_control_registry_zips_with_boundary_found > 0)
   && ev.census_zcta_2010.positive_control_registry_zips_with_boundary_found > 0,
  '4d every Census read found registry ZIPs it should find, so its zero for these ZIPs means something');
const hits2020 = new Set(ev.census_zcta_2020_layers.no_boundary_hits);
const hits2010 = new Set(ev.census_zcta_2010.no_boundary_hits);
ok(rows.every((r) => r.census_zcta_2020 === (hits2020.has(r.zip) ? 'true' : 'false'))
   && rows.every((r) => r.census_zcta_2010 === (hits2010.has(r.zip) ? 'true' : 'false')),
  '4e the census columns are the evidence file\'s hits, no more and no less');
ok(rows.every((r) => (r.class === 'HOMESIGNAL_OMISSION') === (r.census_zcta_2020 === 'true')),
  '4f a row is an omission exactly when Census has a current ZCTA for it — never on USPS type alone');
ok(rows.filter((r) => r.census_zcta_2010 === 'true').length === summary.had_2010_zcta,
  '4g a 2010 ZCTA is recorded as context only and counted', summary.had_2010_zcta);

// ── §5 the finding ───────────────────────────────────────────────────────────────────────
ok(summary.homesignal_omissions === 0 && !rows.some((r) => r.class === 'HOMESIGNAL_OMISSION'),
  '5a no HomeSignal omission: a non-zero here is a boundary to restore, not a row to accept',
  rows.filter((r) => r.class === 'HOMESIGNAL_OMISSION').map((r) => r.zip).join(','));

console.log(`\n${fails ? 'FAILED' : 'OK'} — ${rows.length} rows; ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
