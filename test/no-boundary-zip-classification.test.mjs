// Fix 4 — the classification of every canonical ZIP with no Census ZCTA boundary
// Run: node test/no-boundary-zip-classification.test.mjs
//
// scripts/fix4_classify_no_boundary_zips.py is the ONE place a class is decided. This test checks
// that what is committed is whole and agrees with the evidence it was built from. What it can and
// cannot prove: it reads only committed files, so it proves the files agree with each other and
// with the RECORDED database and Census reads (the evidence file and the Census code-set file, each
// generated whole by the database; their md5s are pinned below). It does not re-read production.
// Census membership is COMPUTED here from the committed code sets, not read from a list.
// §6 runs the generator's own --self-test-offline (every class rule and every input refusal, no
// PyPI), so removing a rule or a guard fails this required test. Regeneration from the pinned
// zipcodes dataset is proven by the CI job .github/workflows/no-boundary-zip-classification.yml
// (`--check` and `--self-test`), which needs PyPI and is NOT a required check.
//
//   §1 the input is the recorded database export, byte for byte;
//   §2 the output covers exactly that input, in order, and is the published classification
//      (a change to the split must change PUBLISHED below, deliberately);
//   §3 a closed vocabulary, each class with the founder's group and disposition, and each row's
//      class consistent with the source columns written beside it;
//   §4 the Census reads are complete and agree; the committed code sets decode to the recorded
//      sets; and an omission is exactly a ZIP the 2020 code set contains;
//   §5 the recorded finding: the boundary table is the Census set, and there are no omissions;
//   §6 the generator's offline self-test passes, and proves it ran.
let fails = 0;
const ok = (c, name, ev) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (c || ev === undefined ? '' : '\n        ' + ev));
  if (!c) fails++;
};

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readBuf = (p) => readFileSync(join(root, p));
const md5 = (s) => createHash('md5').update(s).digest('hex');

const DIR = 'docs/maps-coverage/fix4/';
const evBuf = readBuf(DIR + 'census-zcta-evidence-2026-10-01.json');
const ev = JSON.parse(evBuf.toString('utf8'));
const codesBuf = readBuf(DIR + 'census-zcta-codes-2026-10-01.json');
const codeFile = JSON.parse(codesBuf.toString('utf8'));
const psvBuf = readBuf(DIR + 'no-boundary-zips-2026-10-01.psv');
const csvText = readBuf(DIR + 'no-boundary-zip-classification.csv').toString('utf8');
const summary = JSON.parse(readBuf(DIR + 'no-boundary-zip-classification.summary.json').toString('utf8'));

// The published result. Changing the classification means changing these, on purpose, with the
// receipt (docs/maps-coverage/N5-FIX4-NO-BOUNDARY-CLASSIFICATION-2026-10-01.md) beside them.
const PUBLISHED = {
  evidence_md5: '51cfa16ddce6cafbb0d94d28008ef114', // returned by the database with the evidence (sql step 4)
  codes_md5: '9d8c90b7bf249f0c9484f253ae456e93', // returned by the database with the code sets (sql step 5)
  csv_md5: '549caaa08d4a49522d54fa98d95533e9',
  classes: {
    HOMESIGNAL_OMISSION: 0, NOT_IN_ZIP_DATASET: 2, DECOMMISSIONED_IN_DATASET: 47,
    PO_BOX_ZIP: 498, UNIQUE_ZIP: 107, MILITARY_ZIP: 0, STANDARD_ZIP_NO_CENSUS_ZCTA: 52,
  },
  groups: { legitimate_non_zcta: 704, existence_not_established: 2, homesignal_omission: 0 },
};

// ── §1 the input is the recorded database export ─────────────────────────────────────────
ok(md5(evBuf) === PUBLISHED.evidence_md5,
  '1a the evidence file is the one the database generated (its md5 is the one the database returned)', md5(evBuf));
ok(md5(codesBuf) === PUBLISHED.codes_md5,
  '1a2 the Census code-set file is the one the database generated', md5(codesBuf));
ok(md5(psvBuf) === ev.input_export.file_md5,
  '1b the input file is byte-identical to the recorded export (file_md5)', md5(psvBuf));
const psv = psvBuf.toString('utf8');
ok(psv.endsWith('\n') && !psv.includes('\r'), '1c the input is LF-terminated rows');
const inLines = psv.slice(0, -1).split('\n');
const inZips = inLines.map((l) => l.split('|')[0]);
ok(inLines.length === ev.input_export.rows && inLines.length > 0,
  `1d the input has the ${ev.input_export.rows} rows of the recorded export`, inLines.length);
ok(md5(inLines.join('\n')) === ev.input_export.rows_md5 && md5(inZips.join(',')) === ev.input_export.zip_md5,
  '1e ...and its rows and ZIPs fingerprint to the recorded rows_md5 and zip_md5');
ok(new Set(inZips).size === inZips.length && inZips.every((z, i) => i === 0 || inZips[i - 1] < z),
  '1f ZIPs are unique and in byte order');
ok(inLines.every((l) => /^\d{5}\|[A-Z]{2}\|[^|]+\|[^|]+$/.test(l)),
  '1g every row is zip|state|county|page_name', inLines.find((l) => !/^\d{5}\|[A-Z]{2}\|[^|]+\|[^|]+$/.test(l)));
ok(ev.input_export.controls.registry_zips_without_boundary === inLines.length
   && ev.input_export.controls.pages_found_for_them === inLines.length
   && ev.input_export.controls.registry_zips_with_boundary + inLines.length === ev.input_export.controls.canonical_registry_zips,
  '1h the recorded controls account for every canonical ZIP (with boundary + without = registry)');
ok(ev.serving.not_measured_zip_md5 === ev.input_export.zip_md5 && ev.serving.not_measured === inLines.length
   && ev.serving.status_disagreeing_with_boundary_table === 0,
  '1i the recorded active generation marked exactly these ZIPs not_measured, with 0 disagreements');
ok(summary.inputs.input_file_md5 === md5(psvBuf) && summary.inputs.evidence_file_md5 === md5(evBuf)
   && summary.inputs.codes_file_md5 === md5(codesBuf),
  '1j the summary was generated from these exact input files');

// ── §2 the output covers exactly the input, and is the published classification ─────────
const HEADER = 'zip,state,county,page_name,zipcodes_type,zipcodes_active,zipcodes_city,census_zcta_2020,census_zcta_2010,class,group,disposition';
const COLS = HEADER.split(',');
const csvLines = csvText.replace(/\n$/, '').split('\n');
ok(csvLines[0] === HEADER, '2a the output header is the documented one', csvLines[0]);
// No field here can contain a comma or a quote; checked, so the split below is a real parse.
ok(!/"/.test(csvText), '2b no quoted field (so a plain comma split is exact)');
ok(csvLines.slice(1).every((l) => l.split(',').length === COLS.length), `2c every output row has ${COLS.length} fields`);
const rows = csvLines.slice(1).map((l) => {
  const f = l.split(',');
  return Object.fromEntries(COLS.map((h, i) => [h, f[i]]));
});
ok(rows.length === inLines.length, '2d one output row per input row', rows.length);
ok(rows.every((r, i) => [r.zip, r.state, r.county, r.page_name].join('|') === inLines[i]),
  '2e ...in the same order, carrying the input\'s page columns unchanged',
  rows.find((r, i) => [r.zip, r.state, r.county, r.page_name].join('|') !== inLines[i]));
ok(md5(csvText) === summary.csv_md5, '2f the CSV is the one its summary describes', md5(csvText));
ok(md5(csvText) === PUBLISHED.csv_md5,
  '2g the CSV is the PUBLISHED classification (a regenerated split must be published deliberately)', md5(csvText));
ok(summary.rows === rows.length && summary.zip_md5 === ev.input_export.zip_md5, '2h the summary covers the same rows');

// ── §3 closed vocabulary; founder's dispositions; class consistent with its source columns ──
const CONTRACT = {
  HOMESIGNAL_OMISSION: ['homesignal_omission', 'correct_boundary'],
  NOT_IN_ZIP_DATASET: ['existence_not_established', 'not_measured'],
  DECOMMISSIONED_IN_DATASET: ['legitimate_non_zcta', 'not_measured'],
  PO_BOX_ZIP: ['legitimate_non_zcta', 'not_measured'],
  UNIQUE_ZIP: ['legitimate_non_zcta', 'not_measured'],
  MILITARY_ZIP: ['legitimate_non_zcta', 'not_measured'],
  STANDARD_ZIP_NO_CENSUS_ZCTA: ['legitimate_non_zcta', 'not_measured'],
};
ok(rows.every((r) => r.class in CONTRACT), '3a every class is in the closed vocabulary', rows.find((r) => !(r.class in CONTRACT)));
ok(rows.every((r) => r.group === CONTRACT[r.class][0] && r.disposition === CONTRACT[r.class][1]),
  '3b every row carries its class\'s group and disposition: only an omission is corrected',
  rows.find((r) => r.group !== CONTRACT[r.class][0] || r.disposition !== CONTRACT[r.class][1]));
ok(Object.keys(CONTRACT).every((c) => summary.class_groups[c] === CONTRACT[c][0] && summary.dispositions[c] === CONTRACT[c][1])
   && Object.keys(summary.dispositions).length === Object.keys(CONTRACT).length,
  '3c the generator\'s class tables are the contract, including for classes no row carries');
// The class must agree with the evidence written beside it. This restates the rule only to check
// that each row is consistent with its own columns; the decision itself is the generator's.
const TYPE = { PO_BOX_ZIP: 'PO BOX', UNIQUE_ZIP: 'UNIQUE', MILITARY_ZIP: 'MILITARY', STANDARD_ZIP_NO_CENSUS_ZCTA: 'STANDARD' };
const consistent = (r) => {
  if (r.class === 'HOMESIGNAL_OMISSION') return r.census_zcta_2020 === 'true';
  if (r.census_zcta_2020 !== 'false') return false;
  if (r.class === 'NOT_IN_ZIP_DATASET') return r.zipcodes_type === '' && r.zipcodes_active === '';
  if (r.class === 'DECOMMISSIONED_IN_DATASET') return r.zipcodes_active === 'false';
  return r.zipcodes_active === 'true' && r.zipcodes_type === TYPE[r.class];
};
ok(rows.every(consistent), '3d each row\'s class is consistent with its zipcodes and Census columns', rows.find((r) => !consistent(r)));
const counted = Object.fromEntries(Object.keys(CONTRACT).map((c) => [c, rows.filter((r) => r.class === c).length]));
ok(Object.keys(CONTRACT).every((c) => counted[c] === summary.classes[c] && counted[c] === PUBLISHED.classes[c]),
  '3e the CSV\'s class counts are the summary\'s and the published ones', JSON.stringify(counted));
ok(Object.keys(PUBLISHED.groups).every((g) => summary.groups[g] === PUBLISHED.groups[g])
   && Object.values(summary.groups).reduce((a, b) => a + b, 0) === rows.length,
  '3f the groups partition every row: 704 legitimate non-ZCTA, 2 existence not established, 0 omissions');
ok(summary.stays_not_measured === rows.filter((r) => r.disposition === 'not_measured').length,
  '3g stays_not_measured counts the rows whose disposition is not_measured');

// ── §4 the recorded Census reads are complete and agree ──────────────────────────────────
const l2020 = ev.census_layers.filter((l) => l.delineation === '2020');
const l2010 = ev.census_layers.filter((l) => l.delineation === '2010');
ok(l2020.length > 0 && l2010.length === 1, '4a the evidence carries the current (2020) delineation and the 2010 one');
ok(ev.census_layers.every((l) => l.http_status === 200 && !l.exceeded_transfer_limit_present
                                 && l.features === l.distinct_codes && l.features > 0),
  '4b every recorded Census read was complete (200, not truncated, no duplicate codes)');
ok(ev.census_layers.every((l) => l.positive_control_registry_zips_with_boundary_found > 0),
  '4c every Census read found registry ZIPs it should find, so its zero for these ZIPs means something');
ok(new Set(l2020.map((l) => l.codes_md5 + '|' + l.no_boundary_hits.join(','))).size === 1,
  '4d the 2020 layers agree with each other (one delineation, served several ways)');
// The committed code sets: one bitmap per delineation, bit i (most significant first) = code i.
const decode = (b64) => {
  const b = Buffer.from(b64, 'base64');
  const out = [];
  if (b.length !== 12500) return null;
  for (let i = 0; i < 100000; i++) if ((b[i >> 3] >> (7 - (i & 7))) & 1) out.push(String(i).padStart(5, '0'));
  return out;
};
const codeSets = {};
for (const c of codeFile.layers) codeSets[c.delineation] = { rec: c, codes: decode(c.bitmap_base64) };
ok(Object.keys(codeSets).sort().join() === '2010,2020' && codeFile.layers.length === 2,
  '4e the code file carries exactly one 2020 and one 2010 code set');
ok(Object.values(codeSets).every(({ rec, codes }) => codes && codes.length === rec.codes && md5(codes.join(',')) === rec.codes_md5),
  '4f each committed bitmap decodes to its recorded count and md5');
ok(codeSets['2020'].rec.codes_md5 === l2020[0].codes_md5 && codeSets['2020'].rec.codes === l2020[0].features
   && codeSets['2010'].rec.codes_md5 === l2010[0].codes_md5 && codeSets['2010'].rec.codes === l2010[0].features,
  '4g ...and each is the code set the evidence recorded for that delineation');
const inSet = new Set(inZips);
const hits2020 = new Set(codeSets['2020'].codes.filter((z) => inSet.has(z)));
const hits2010 = new Set(codeSets['2010'].codes.filter((z) => inSet.has(z)));
const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
ok(same(hits2020, new Set(l2020[0].no_boundary_hits)) && same(hits2010, new Set(l2010[0].no_boundary_hits)),
  '4h Census membership computed from the code sets equals the database\'s recorded hits',
  `2020 ${[...hits2020]} | 2010 ${[...hits2010]}`);
ok(rows.every((r) => r.census_zcta_2020 === (hits2020.has(r.zip) ? 'true' : 'false'))
   && rows.every((r) => r.census_zcta_2010 === (hits2010.has(r.zip) ? 'true' : 'false')),
  '4i the census columns are exactly the computed memberships, no more and no less');
ok(rows.every((r) => (r.class === 'HOMESIGNAL_OMISSION') === (r.census_zcta_2020 === 'true')),
  '4j a row is an omission exactly when the 2020 code set contains it — never on ZIP type alone');
ok(rows.filter((r) => r.census_zcta_2010 === 'true').length === summary.had_2010_zcta,
  '4k a 2010 ZCTA is recorded as context only and counted', summary.had_2010_zcta);

// ── §5 the recorded finding ──────────────────────────────────────────────────────────────
ok(l2020.every((l) => l.codes_md5 === ev.boundary_table.codes_md5 && l.features === ev.boundary_table.rows
                      && l.in_census_not_in_boundary_table === 0 && l.in_boundary_table_not_in_census === 0)
   && summary.boundary_table_equals_census_2020 === true,
  '5a recorded: geo.zcta_boundary held exactly the Census 2020 code set, both directions');
ok(summary.groups.homesignal_omission === 0 && !rows.some((r) => r.class === 'HOMESIGNAL_OMISSION'),
  '5b no HomeSignal omission: a non-zero here is a boundary to restore, not a row to accept',
  rows.filter((r) => r.class === 'HOMESIGNAL_OMISSION').map((r) => r.zip).join(','));

// ── §6 the generator's rules and refusals, run offline ───────────────────────────────────
// An instrument must prove it ran: the self-test's own PASS lines are counted, not just its exit.
const st = spawnSync('python3', [join(root, 'scripts/fix4_classify_no_boundary_zips.py'), '--self-test-offline'],
  { encoding: 'utf8' });
const stPass = (st.stdout || '').split('\n').filter((l) => l.startsWith('PASS - ')).length;
const stFail = (st.stdout || '').split('\n').filter((l) => l.startsWith('FAIL - '));
ok(st.status === 0 && stFail.length === 0 && /\nOK - 0 failure\(s\)\s*$/.test(st.stdout || ''),
  '6a the generator\'s --self-test-offline passes (class rules, contract, every input refusal)',
  `exit ${st.status}; ${stFail.join(' | ')}; ${(st.stderr || '').slice(-300)}`);
ok(stPass >= 27, "6b ...and it ran all of them (at least 27 PASS lines)", stPass);

console.log(`\n${fails ? 'FAILED' : 'OK'} — ${rows.length} rows; ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
