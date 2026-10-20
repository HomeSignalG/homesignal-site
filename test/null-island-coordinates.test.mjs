// (0, 0) IS NOT A PLACE — Arizona pre-launch (2026-10-20).
//
// Gilbert AZ, Overland Park KS and Little Rock AR publish Latitude 0 / Longitude 0 for "no
// coordinates". Every connector took that as a real point, so the row skipped the geocoder, the
// materializer's outlier guard later blanked it, and the permit was never pinned on Map 1
// (measured: 9,536 cached records, all with a street address). sources/null-island.ts treats the
// pair as absent. This drives the SHIPPED five connectors with the same row, so a connector that
// forgets the guard fails on its own line.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'supabase/functions/get-address-report/sources');
let fails = 0, passes = 0;
const ok = (c, name, detail) => { if (c) { passes++; console.log('PASS — ' + name); } else { fails++; console.log('FAIL — ' + name + (detail ? '\n     ' + detail : '')); } };

const { dropNullIsland } = await import(join(SRC, 'null-island.ts'));
const { ckanForZip } = await import(join(SRC, 'ckan.ts'));
const { socrataForZip } = await import(join(SRC, 'socrata.ts'));
const { arcgisForZip } = await import(join(SRC, 'arcgis.ts'));
const { cartoForZip } = await import(join(SRC, 'carto.ts'));
const { csvForZip, _clearCsvCache } = await import(join(SRC, 'csv.ts'));

ok(JSON.stringify(dropNullIsland(0, 0)) === '[null,null]', 'the pair (0,0) is absent');
ok(JSON.stringify(dropNullIsland(0, -111.7)) === '[0,-111.7]', 'a single zero is kept');
ok(JSON.stringify(dropNullIsland(33.3, 0)) === '[33.3,0]', 'a single zero longitude is kept');
ok(JSON.stringify(dropNullIsland(null, null)) === '[null,null]', 'absent stays absent');
ok(JSON.stringify(dropNullIsland(33.35, -111.79)) === '[33.35,-111.79]', 'a real point is untouched');

const PGH = { lat: 40.5012, lng: -80.0686 };
const COVER = [{ state: 'PA', county: 'Allegheny' }];
const jsonFetch = (body) => (async () => new Response(JSON.stringify(body), { status: 200 }));
const textFetch = (body) => (async () => new Response(body, { status: 200 }));
const COMMON = { jurisdiction: 'Allegheny County', coverage: COVER, status_to_bucket: { approved: ['Issued'] } };
const CM = { title: 'name', status_raw: 'status', file_date: 'issued', address: 'addr', zip: 'zip',
             case_number: 'num', lat: 'Latitude', lng: 'Longitude' };
const row = { num: 'RESD-2026-00410', name: 'New home', status: 'Issued', issued: '2026-06-01',
              addr: '294 UNION AVENUE', zip: '15202', Latitude: 0, Longitude: 0 };

const drivers = {
  ckan: (deps) => ckanForZip('15202', COVER, [{ ...COMMON, registry_id: 'ni-ckan', platform: 'ckan', base_url: 'https://d.x.org', resource_id: 'r', dataset_url: 'https://d.x.org/d', column_map: CM }],
    { fetch: jsonFetch({ success: true, result: { records: [row] } }), zipCentroid: PGH, ...deps }),
  socrata: (deps) => socrataForZip('15202', COVER, [{ ...COMMON, registry_id: 'ni-socrata', platform: 'socrata', domain: 'd.x.gov', dataset_id: 'aaaa-bbbb', dataset_url: 'https://d.x.gov/d', column_map: CM }],
    { fetch: jsonFetch([row]), zipCentroid: PGH, ...deps }),
  arcgis: (deps) => arcgisForZip('15202', COVER, [{ ...COMMON, registry_id: 'ni-arcgis', platform: 'arcgis', service_url: 'https://x.gov/arcgis/rest/services/P/MapServer/0', dataset_url: 'https://x.gov/p', column_map: CM }],
    { fetch: jsonFetch({ features: [{ attributes: row }] }), zipCentroid: PGH, ...deps }),
  carto: (deps) => cartoForZip('15202', COVER, [{ ...COMMON, registry_id: 'ni-carto', platform: 'carto', sql_url: 'https://phl.carto.com/api/v2/sql', table: 't', dataset_url: 'https://phl.carto.com/q', column_map: CM }],
    { fetch: jsonFetch({ rows: [row] }), zipCentroid: PGH, ...deps }),
  csv: (deps) => {
    _clearCsvCache();
    const keys = Object.keys(row);
    const body = keys.join(',') + '\n' + keys.map((k) => '"' + String(row[k]) + '"').join(',') + '\n';
    return csvForZip('15202', COVER, [{ ...COMMON, registry_id: 'ni-csv', platform: 'csv', url: 'https://x.gov/a.csv', dataset_url: 'https://x.gov/a', column_map: CM }],
      { fetch: textFetch(body), zipCentroid: PGH, ...deps });
  },
};

for (const [name, drive] of Object.entries(drivers)) {
  // Without a geocoder: the record is kept, but as an area record, never pinned at (0,0).
  const r = await drive({});
  const s = r.sites?.[0];
  ok(!!s, `${name}: the record is still emitted`, JSON.stringify(r.reports?.[0]?.quarantined ?? []).slice(0, 200));
  ok(s && s.lat === null && s.lng === null, `${name}: (0,0) is not stored as a point`, s && `lat=${s.lat} lng=${s.lng}`);
  ok(s && s.scope === 'area', `${name}: the record is area scope`, s && `scope=${s.scope}`);
  // With a geocoder: the record's own address is geocoded instead of being skipped.
  const asked = [];
  await drive({ geocode: async (a) => { asked.push(a); return null; } });
  ok(asked.length === 1 && /294 UNION AVENUE/.test(asked[0]), `${name}: the row's own address is sent to the geocoder`, `asked=${JSON.stringify(asked)}`);
}

// Real Gilbert / Overland Park / Little Rock entries keep their address column and geocoding on,
// so a (0,0) row there now reaches the geocoder.
const reg = JSON.parse(readFileSync(join(ROOT, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
for (const id of ['gilbert-energov-permits', 'overland-park-building-permits', 'little-rock-permits']) {
  const e = reg.arcgis.find((x) => x && x.registry_id === id);
  ok(!!e && !!e.column_map.address && e.geocode_assemble === true, `${id}: address column + geocode_assemble`);
}

console.log(`${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
