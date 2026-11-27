// The REAL arcgis connector, driven with the REAL registry entry of a source that declares source_updated, over an OFFLINE response shaped like an ArcGIS FeatureServer answer
// (report-accuracy-universal, 2026-11-20). What this proves: the registry mapping, the connector's date reading (epoch milliseconds AND ISO strings), and the record shape.
// What it does NOT prove: that the live service returns the field in this encoding today (that needs a live read: see docs/report-accuracy-universal-2026-11-19.md).
// Run: node --experimental-strip-types test/report-source-dates-connector.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { arcgisForZip } = await import(join(root, 'supabase/functions/get-address-report/sources/arcgis.ts'));
let n = 0, fails = 0;
const ok = (c, name, d) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 400)); } };
const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const E = REG.arcgis.find((e) => e.column_map?.source_updated);
ok(!!E && E.file_date_basis === 'record_created', 'a registry entry maps source_updated and declares its date basis (' + E?.registry_id + ')');
const cm = E.column_map;
const status = Object.values(E.status_to_bucket).flat()[0];
const DAY = (s) => Date.parse(s + 'T00:00:00Z');
const attrs = (over) => ({ [cm.title[0]]: 'Bridge replacement', [cm.title[1]]: 'SR-13', [cm.status_raw]: status, [cm.type_source]: Object.keys(E.type_map)[0], [cm.case_number]: 'PIN-1', [cm.address]: 'SR-13', ...over });
const feat = (a) => ({ attributes: a, geometry: { x: -112.0, y: 41.5 } });
const run = async (rows) => {
  const deps = { zipCentroid: { lat: 41.5, lng: -112.0 }, zipBounds: null, zipMembers: null, geocode: async () => null,
    fetch: async () => { const body = { features: rows.map(feat), exceededTransferLimit: false }; return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }; } };
  return (await arcgisForZip('84302', [{ state: E.coverage[0].state, county: 'Box Elder' }], [E], deps)).sites;
};
// epoch milliseconds (how ArcGIS serialises esriFieldTypeDate in f=json)
let sites = await run([attrs({ [cm.file_date]: DAY('2024-08-26'), [cm.source_updated]: DAY('2026-04-27') })]);
ok(sites.length === 1 && sites[0].source_dates?.created === undefined && sites[0].source_dates?.updated === '2026-04-27', 'epoch-millisecond modification date is read as a day; the record date stays the filing/creation column', sites[0]?.source_dates);
ok(sites[0]?.file_date === '2024-08-26', 'file_date (the record date) is unchanged by the new mapping', sites[0]?.file_date);
// ISO string encoding (a FeatureServer with f=pjson dates, or a Socrata-like column)
sites = await run([attrs({ [cm.file_date]: DAY('2024-08-26'), [cm.source_updated]: '2026-04-29T00:00:00+00:00' })]);
ok(sites[0]?.source_dates?.updated === '2026-04-29', 'an ISO string modification date is read the same way', sites[0]?.source_dates);
// missing / blank / sentinel
sites = await run([attrs({ [cm.file_date]: DAY('2024-08-26'), [cm.source_updated]: null })]);
ok(sites.length === 1 && !('source_dates' in sites[0]), 'a blank modification date adds no source_dates (the record is kept)', sites[0]);
sites = await run([attrs({ [cm.file_date]: DAY('2024-08-26'), [cm.source_updated]: 'not a date' })]);
ok(sites.length === 1 && !('source_dates' in sites[0]), 'an unreadable modification date adds nothing and does not drop the record');
// LIVE-CAPTURED shape (read-only request to the service, 2026-11-20): the layer declares both columns as esriFieldTypeTimestampOffset and returns them as ISO strings with an offset,
// e.g. created_dt "2018-07-06T16:49:36+00:00", current_mod_date "2026-11-19T00:00:00+00:00". These three attribute sets are the live values, unaltered.
const LIVE = [{ pin: 16938, created_dt: '2018-07-06T16:49:36+00:00', pin_stat_nm: 'Scoping', current_mod_date: '2026-11-19T00:00:00+00:00' },
  { pin: 22095, created_dt: '2024-06-19T20:38:07+00:00', pin_stat_nm: 'Scoping', current_mod_date: '2026-11-19T00:00:00+00:00' },
  { pin: 22091, created_dt: '2024-06-19T19:44:54+00:00', pin_stat_nm: 'Scoping', current_mod_date: '2026-11-18T00:00:00+00:00' }];
const live = await run(LIVE.map((l) => attrs({ [cm.case_number]: l.pin, [cm.status_raw]: l[cm.status_raw] ?? status, [cm.file_date]: l.created_dt, [cm.source_updated]: l.current_mod_date })));
ok(live.length === 3 && live.map((x) => x.source_dates?.updated).join() === '2026-11-19,2026-11-19,2026-11-18', 'live-captured ISO values with an offset are read as the modification day', live.map((x) => x.source_dates));
ok(live.map((x) => x.file_date).join() === '2018-07-06,2024-06-19,2024-06-19', 'and the live created_dt values remain the record date (creation), unchanged');
// the record identity and the engine's exact-identity key do not read it
const a1 = (await run([attrs({ [cm.file_date]: DAY('2024-08-26'), [cm.source_updated]: DAY('2026-04-27') })]))[0];
const a2 = (await run([attrs({ [cm.file_date]: DAY('2024-08-26'), [cm.source_updated]: DAY('2026-05-30') })]))[0];
const key = (s) => [s.title, s.label, s.case_number, s.record_url, s.url, s.file_date, s.decision_date, s.lat, s.lng, s.bucket, s.scope, s.relevance, s.registry_id, s.source_registry_id, s.source_id].map((v) => (v == null ? '' : String(v))).join('|');
ok(key(a1) === key(a2) && a1.source_dates.updated !== a2.source_dates.updated, 'two reads that differ ONLY in the modification date have the same exact-identity key (no duplicate pin, no identity change)');
console.log(`\n${n - fails}/${n} passed`); process.exit(fails ? 1 : 0);
