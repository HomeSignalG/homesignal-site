// `type_raw` — the publisher's OWN project-type value, verbatim, BEFORE type_map is applied.
//
// WHY THIS FIELD EXISTS, and why the test is about EVIDENCE rather than about a value.
//
// `use_type` is the MAPPED classification (the closed six-value vocabulary in
// lib/map.js::TYPE_EXACT). Every connector emits `use_type: "unclassified"` when the entry's
// `type_map` MISSES — and "unclassified" is also what an entry that maps no type column at all
// emits. So once a record is stored, two completely different situations are indistinguishable:
//
//   (a) the publisher genuinely states no project type      → the generic pin is CORRECT
//   (b) the publisher stated a value our type_map lacks     → the generic pin is a CONFIG GAP
//
// Measured 2026-08-18: 128,387 of 2,932,766 stored development rows carry `use_type`
// "unclassified", and answering "which of those are (b)?" required re-probing 43 live sources —
// an answer that goes stale the moment a publisher adds a value. `type_raw` makes that question
// one GROUP BY, permanently.
//
// THE TEST THEREFORE PINS THE PROPERTY THAT MAKES IT EVIDENCE: verbatim, pre-mapping, and
// SURVIVING A MAPPING MISS. A `type_raw` that had been normalised, lower-cased, or filled in
// from the mapped value would look populated and prove nothing — that failure would be invisible
// in production, which is exactly why it is asserted here against the SHIPPED connectors.
//
// Run: node test/type-raw-provenance.test.mjs   (discovered by scripts/run-unit-tests.mjs)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'supabase/functions/get-address-report/sources');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

// The connectors are TypeScript. Node >= 22.18 strips types on import, so these checks drive the
// SHIPPED code rather than a copy. On an older runtime fail loudly — a green run must mean the
// assertions actually executed (CLAUDE.md: "an instrument must prove it ran").
let ckanForZip, socrataForZip, arcgisForZip, cartoForZip, csvForZip, _clearCsvCache;
try {
  ({ ckanForZip } = await import(join(SRC, 'ckan.ts')));
  ({ socrataForZip } = await import(join(SRC, 'socrata.ts')));
  ({ arcgisForZip } = await import(join(SRC, 'arcgis.ts')));
  ({ cartoForZip } = await import(join(SRC, 'carto.ts')));
  ({ csvForZip, _clearCsvCache } = await import(join(SRC, 'csv.ts')));
} catch (err) {
  console.log('FAIL — import connectors (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

const PGH = { lat: 40.5012, lng: -80.0686 };            // 15202 centroid
const COVER_PA = [{ state: 'PA', county: 'Allegheny' }];
const jsonFetch = (body) => (async () => new Response(JSON.stringify(body), { status: 200 }));
const textFetch = (body) => (async () => new Response(body, { status: 200 }));

const COMMON = {
  jurisdiction: 'Allegheny County',
  coverage: COVER_PA,
  status_to_bucket: { approved: ['Active - Issued'] },
};
const CM = {
  title: 'facility_name', status_raw: 'status', type_source: 'project_type',
  file_date: 'permit_issue_date', address: 's_address', zip: 'zip_code', case_number: 'permit_number',
};
const baseRow = {
  permit_number: 'PAA1', facility_name: '294 UNION AVENUE', status: 'Active - Issued',
  permit_issue_date: '2026-06-01', s_address: '294 UNION AVENUE', zip_code: '15202',
};

// Five drivers over the same row + entry shape, so a divergence between connectors shows up as a
// per-connector failure rather than as one connector standing in for all five.
const driveCkan = (row, over) => ckanForZip('15202', COVER_PA,
  [{ ...COMMON, registry_id: 'tr-ckan', platform: 'ckan', base_url: 'https://data.wprdc.org', resource_id: 'r1', dataset_url: 'https://data.wprdc.org/dataset/x', column_map: CM, ...over }],
  { fetch: jsonFetch({ success: true, result: { records: [row] } }), zipCentroid: PGH });
const driveSocrata = (row, over) => socrataForZip('15202', COVER_PA,
  [{ ...COMMON, registry_id: 'tr-socrata', platform: 'socrata', domain: 'data.x.gov', dataset_id: 'aaaa-bbbb', dataset_url: 'https://data.x.gov/d/aaaa-bbbb', column_map: CM, ...over }],
  { fetch: jsonFetch([row]), zipCentroid: PGH });
const driveArcgis = (row, over) => arcgisForZip('15202', COVER_PA,
  [{ ...COMMON, registry_id: 'tr-arcgis', platform: 'arcgis', service_url: 'https://x.gov/arcgis/rest/services/P/MapServer/0', dataset_url: 'https://x.gov/p', column_map: CM, ...over }],
  { fetch: jsonFetch({ features: [{ attributes: row }] }), zipCentroid: PGH });
const driveCarto = (row, over) => cartoForZip('15202', COVER_PA,
  [{ ...COMMON, registry_id: 'tr-carto', platform: 'carto', sql_url: 'https://phl.carto.com/api/v2/sql', table: 't', dataset_url: 'https://phl.carto.com/api/v2/sql?q=1', column_map: CM, geom_col: 'the_geom', ...over }],
  { fetch: jsonFetch({ rows: [row] }), zipCentroid: PGH });
const driveCsv = (row, over) => {
  _clearCsvCache();
  // A CSV cell is text; the connector reads whatever the file says. Quote every value so a
  // value carrying a comma or leading spaces survives the parse intact.
  const keys = Object.keys(row);
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const body = keys.join(',') + '\n' + keys.map((k) => q(row[k])).join(',') + '\n';
  return csvForZip('15202', COVER_PA,
    [{ ...COMMON, registry_id: 'tr-csv', platform: 'csv', url: 'https://x.gov/a.csv', dataset_url: 'https://x.gov/a', column_map: CM, ...over }],
    { fetch: textFetch(body), zipCentroid: PGH });
};
const DRIVERS = [['ckan', driveCkan], ['socrata', driveSocrata], ['arcgis', driveArcgis],
                 ['carto', driveCarto], ['csv', driveCsv]];

const first = async (drive, row, over) => {
  const r = await drive(row, over);
  return { site: r.sites?.[0], report: r.reports?.[0] };
};

for (const [name, drive] of DRIVERS) {
  // ── 1. A MAPPED value: `use_type` is the mapping, `type_raw` is what the publisher said ──
  // These two must be DIFFERENT strings here, or the test could pass on a connector that just
  // copied the mapped value into type_raw.
  {
    const { site } = await first(drive, { ...baseRow, project_type: 'PAA' }, { type_map: { PAA: 'Development' } });
    ok(site?.use_type === 'Development', `${name}: use_type carries the MAPPED value`, `got ${JSON.stringify(site?.use_type)}`);
    ok(site?.type_raw === 'PAA', `${name}: type_raw carries the PUBLISHER's value, verbatim`, `got ${JSON.stringify(site?.type_raw)}`);
    ok(site?.type_raw !== site?.use_type,
      `${name}: the two are distinct fields — type_raw is not a copy of the mapping`);
  }

  // ── 2. THE WHOLE POINT: a type_map MISS keeps the evidence ────────────────────────────
  // Before this field, this record and case 3 below were byte-identical once stored.
  {
    const { site } = await first(drive, { ...baseRow, project_type: 'Solar Array' }, { type_map: { PAA: 'Development' } });
    ok(site?.use_type === 'unclassified', `${name}: an unmapped value still classifies as unclassified (unchanged)`);
    ok(site?.type_raw === 'Solar Array',
      `${name}: …and type_raw NAMES the value that missed — the config gap is now measurable`,
      `got ${JSON.stringify(site?.type_raw)}`);
  }

  // ── 3. The publisher stated NOTHING — null, never '' and never 'unclassified' ──────────
  // This is the honest-absence case. It must be distinguishable from case 2 by the value of
  // type_raw alone, because that distinction is the field's entire job.
  {
    const { site } = await first(drive, { ...baseRow, project_type: '' }, { type_map: { PAA: 'Development' } });
    ok(site?.use_type === 'unclassified', `${name}: an empty type still classifies as unclassified`);
    ok(site?.type_raw === null,
      `${name}: an empty publisher value is NULL, not '' and not the mapped word`,
      `got ${JSON.stringify(site?.type_raw)}`);
  }

  // ── 4. The entry maps no type column at all → null ─────────────────────────────────────
  {
    const cm = { ...CM }; delete cm.type_source;
    const { site } = await first(drive, { ...baseRow, project_type: 'PAA' },
      { column_map: cm, type_map: { PAA: 'Development' } });
    ok(site?.type_raw === null,
      `${name}: no type_source column → null (the connector never invents a source field)`,
      `got ${JSON.stringify(site?.type_raw)}`);
  }

  // ── 5. Case and inner spacing are PRESERVED on a case-insensitive map hit ──────────────
  // The connectors resolve type_map case-insensitively. `type_raw` must report what the
  // publisher SENT, not the registry key that matched it — otherwise it silently becomes a
  // second copy of the config and can no longer contradict it.
  {
    const { site } = await first(drive, { ...baseRow, project_type: '  nEw  Construction  ' },
      { type_map: { 'New  Construction': 'Development' } });
    ok(site?.type_raw === 'nEw  Construction',
      `${name}: outer whitespace trimmed, inner spacing and CASE preserved verbatim`,
      `got ${JSON.stringify(site?.type_raw)}`);
    ok(site?.type_raw !== 'New  Construction',
      `${name}: …specifically NOT the registry key that matched it`);
  }

  // ── 6. type_raw never changes what the record IS ───────────────────────────────────────
  // An audit field that moved a pin, a bucket or a count would be a behavioural change wearing
  // an observability label. Same row, mapped vs unmapped: everything except use_type/type_raw
  // must be byte-identical.
  {
    const a = (await first(drive, { ...baseRow, project_type: 'PAA' }, { type_map: { PAA: 'Development' } })).site;
    const b = (await first(drive, { ...baseRow, project_type: 'PAA' }, {})).site;
    const strip = (s) => { const o = { ...s }; delete o.use_type; delete o.type_raw; return JSON.stringify(o); };
    ok(!!a && !!b && strip(a) === strip(b),
      `${name}: every other field is identical with and without a type_map — type_raw is inert`,
      `A=${strip(a || {}).slice(0, 200)}\n     B=${strip(b || {}).slice(0, 200)}`);
  }
}

// ── 7. The field is declared ONCE, in the shared NormalizedRecord contract ────────────────
{
  const socrata = readFileSync(join(SRC, 'socrata.ts'), 'utf8');
  ok(/type_raw: string \| null;/.test(socrata),
    '7a NormalizedRecord declares type_raw as `string | null` — null is part of the contract, '
    + 'not an accident of an untyped emit');
  const emits = ['arcgis', 'carto', 'ckan', 'csv', 'socrata'].filter((f) =>
    /type_raw: typeSrcVal \|\| null,/.test(readFileSync(join(SRC, `${f}.ts`), 'utf8')));
  ok(emits.length === 5,
    '7b all five connectors emit it from the SAME expression — a connector that computed it '
    + 'differently would produce a field that means something different per source',
    `emitting: ${emits.join(', ')}`);
}

// ── 8. type_raw is NOT in the engine's v22 exact-identity dedup key ───────────────────────
// Ruled and recorded: the key decides whether two rows are the SAME REAL FILING, and widening
// it is how a genuine duplicate starts surviving as two pins (the 2026-07-23 cleanup removed
// 9,631 excess copies). A future session must not "complete" the key with this field.
{
  const idx = readFileSync(join(ROOT, 'supabase/functions/get-address-report/index.ts'), 'utf8');
  const m = idx.match(/const dedupeExactPermits[\s\S]{0,1200}?\n {4}\};/);
  ok(!!m, '8a the dedupeExactPermits body was located (so 8b is checking something real)');
  ok(!!m && !/type_raw/.test(m[0]),
    '8b …and it does NOT reference type_raw — the audit field cannot change what the page renders');
  ok(/⛔ `type_raw` IS DELIBERATELY NOT IN THIS KEY/.test(idx),
    '8c the reason is recorded AT the key, not only in a doc a future session may not read');
}

console.log(fails ? `\n${fails} type-raw-provenance assertion(s) FAILED.` : '\nAll type-raw-provenance assertions passed.');
process.exit(fails ? 1 : 0);
