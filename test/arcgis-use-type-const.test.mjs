// Offline regression checks for the ArcGIS connector's `use_type_const` — the MIRROR of the
// existing `status_const`, for layers whose only type-bearing column is free text.
//
// WHY THIS EXISTS, and why it is a test rather than a config note.
//
// `use_type_const` was already accepted as "complete" by the Live scoreboard's
// entryCompleteness() — but NO connector implemented it and NO registry entry used it. That
// combination is a false-Live trap: the moment an entry set it, the scoreboard would count the
// state's pages as covered while the connector emitted `use_type: "unclassified"` and the pages
// rendered unclassified pins. Complete-looking config, wrong pins, nothing failing. These
// assertions drive the SHIPPED connector so "the scoreboard accepts it" and "the connector
// honours it" can never drift apart again.
//
// The case that forced it — Sussex County DE conditional-use applications (the only dark DE
// county). `proposed_use` is the semantically correct column and is free prose: 400+ distinct
// values over 2,566 rows, mostly n=1, typos and sentences. Rule 5 terminal, no type_map exists.
// `current_zoning` IS a closed 38-value vocabulary but describes the PARCEL, not the PROPOSAL —
// a conditional use is by definition something the zoning does not already allow, so
// AR-1 → Residential would label an electrical substation "Residential". A constant is the only
// non-fabricating option.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const SRC = join(root, 'supabase/functions/get-address-report/sources/arcgis.ts');
let arcgisForZip;
try {
  ({ arcgisForZip } = await import(SRC));
} catch (err) {
  console.log('FAIL — import sources/arcgis.ts (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

// A stub server: any query returns one feature; metadata requests return a minimal layer doc.
const feature = {
  attributes: {
    OBJECTID: 1,
    development_name: 'Bayside Commons',
    proposed_use: 'operate a food truck for a period exceeding three days',
    current_zoning: 'AR-1',
    cc_decision: 'Approved',
    application_number: 'CU-2411',
    application_rcvd_date: 1785196800000,
  },
  geometry: { rings: [[[-75.4, 38.6], [-75.3, 38.6], [-75.3, 38.7], [-75.4, 38.7], [-75.4, 38.6]]] },
};
const stubFetch = async () => new Response(JSON.stringify({
  objectIdFieldName: 'OBJECTID', geometryType: 'esriGeometryPolygon',
  fields: [], features: [feature], exceededTransferLimit: false,
}), { status: 200, headers: { 'content-type': 'application/json' } });

const baseEntry = {
  registry_id: 'sussex-county-de-conditional-use',
  platform: 'arcgis',
  service_url: 'https://example.invalid/FeatureServer/0',
  dataset_url: 'https://example.invalid/planning',
  jurisdiction: 'Sussex County, Delaware',
  coverage: [{ state: 'DE', county: 'Sussex' }],
  column_map: { title: ['development_name'], status_raw: 'cc_decision', case_number: 'application_number' },
  spatial_zip_radius_mi: 5,
  status_to_bucket: { proposed: [], approved: ['Approved'], operating: [], exclude: [] },
};
const deps = { fetch: stubFetch, zipCentroid: { lat: 38.65, lng: -75.35 } };
const sussex = [{ state: 'DE', county: 'Sussex' }];
const run = (entry, communities = sussex) => arcgisForZip('19966', communities, [entry], deps);

// ── 1. the constant is applied when there is no mappable type column ────────────
{
  const { sites } = await run({ ...baseEntry, use_type_const: 'Development' });
  ok(sites.length === 1, 'a record is emitted');
  ok(sites[0]?.use_type === 'Development',
    'use_type_const supplies the classification', `got ${JSON.stringify(sites[0]?.use_type)}`);
  ok(sites[0]?.use_type !== 'unclassified',
    'THE POINT: without this the pin would be unclassified while the scoreboard called the state Live');
}

// ── 2. without it, the same layer is honestly unclassified — never guessed ──────
{
  const { sites } = await run(baseEntry);
  ok(sites[0]?.use_type === 'unclassified',
    'no constant and no type_map → unclassified, never inferred from title or free text');
}

// ── 3. a MAPPED value always outranks the constant ──────────────────────────────
{
  const { sites } = await run({
    ...baseEntry,
    column_map: { ...baseEntry.column_map, type_source: 'current_zoning' },
    type_map: { 'AR-1': 'Residential' },
  });
  ok(sites[0]?.use_type === 'Residential',
    'a real type_map hit wins — the constant can never override a publisher-stated type');
}

// ── 4. setting BOTH is a config error and the entry is QUARANTINED, not resolved ─
{
  const { sites, reports } = await run({
    ...baseEntry,
    use_type_const: 'Development',
    column_map: { ...baseEntry.column_map, type_source: 'current_zoning' },
    type_map: { 'AR-1': 'Residential' },
  });
  ok(sites.length === 0, 'a both-set entry emits nothing rather than silently picking one');
  ok(/config error: use_type_const AND type_map both set/.test(reports[0]?.quarantined?.[0]?.reason ?? ''),
    'and it says so by name — an author who set a constant must not be left believing it applied',
    JSON.stringify(reports[0]?.quarantined));
}

// ── 5. the coverage gate still binds — a constant does not widen reach ──────────
{
  const { sites, reports } = await run({ ...baseEntry, use_type_const: 'Development' },
    [{ state: 'DE', county: 'Kent' }]);
  ok(sites.length === 0 && reports.length === 0,
    'out-of-coverage county: the entry never runs at all (bidirectional gate proof)');
}

// ── 6. the shipped registry entry actually carries the constant, and no type_map ─
{
  const { readFileSync } = await import('node:fs');
  const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
  const e = reg.arcgis.find((x) => x.registry_id === 'sussex-county-de-conditional-use');
  ok(!!e, 'sussex-county-de-conditional-use is in the registry');
  ok(e?.use_type_const === 'Development', 'it uses the generic member of the closed vocabulary');
  ok(!e?.type_map, 'and carries no type_map, so rule 4 above cannot fire on it');
  ok(JSON.stringify(e?.coverage) === JSON.stringify([{ state: 'DE', county: 'Sussex' }]),
    'scoped to DE/Sussex only');
  const buckets = e?.status_to_bucket ?? {};
  const all = [...(buckets.proposed ?? []), ...(buckets.approved ?? []), ...(buckets.operating ?? []), ...(buckets.exclude ?? [])];
  ok(!all.includes('8/19/2025'),
    "the publisher's data-entry error ('8/19/2025' typed into a decision field) stays UNMAPPED and fail-closed");
  ok(new Set(all).size === all.length, 'no status value is bucketed twice');
}

// ── 7. EVERY arcgis entry must have a geography path — the error I actually made ────
// Omitting column_map.lat/lng is SILENT: returnGeometry=true is always sent, featurePoint()
// resolves the polygon centroid correctly, and the coordinates are simply never read. The
// records still publish, still carry a record_url, and still count toward coverage — so no
// count, no CI job and no anti-fabrication gate notices. They just all land on the ZIP
// centroid instead of their own parcel. That is what happened to all 468 Sussex records on
// their first cache, and it was caught only by checking `scope` on the live rows.
{
  const { readFileSync } = await import('node:fs');
  const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
  const missing = reg.arcgis.filter((e) => {
    const cm = e.column_map ?? {};
    return !(cm.lat && cm.lng) && !cm.address;   // no own point, and nothing to geocode from
  }).map((e) => e.registry_id);
  ok(missing.length === 0,
    'every arcgis entry maps coordinates (__lat/__lng or real columns) OR an address to geocode',
    missing.join(', '));

  const sx = reg.arcgis.find((e) => e.registry_id === 'sussex-county-de-conditional-use');
  ok(sx?.column_map?.lat === '__lat' && sx?.column_map?.lng === '__lng',
    'sussex reads the flattened polygon centroid — records pin to their parcel, not the ZIP centroid');
}

console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
