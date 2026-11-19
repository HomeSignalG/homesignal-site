// Offline checks for the `boulder-county-accela-applications` registry entry (Boulder County's own PLANNING/OP_Accela_Point
// MapServer layer: UNINCORPORATED Boulder County only, never municipal). The SHIPPED connector (sources/arcgis.ts) is driven
// over two REAL captured rows (fixtures/boulder-county/accela-point-sample.json, pg_net read 2026-11-19).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : '')); if (!c) fails++; };

const { arcgisForZip, coverageMatches } = await import(join(root, 'supabase/functions/get-address-report/sources/arcgis.ts'));
const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const E = REG.arcgis.find((e) => e.registry_id === 'boulder-county-accela-applications');
ok(!!E, 'registry carries boulder-county-accela-applications');
ok(/unincorporated/i.test(E.jurisdiction) && /not municipal/i.test(E.jurisdiction), 'jurisdiction label says unincorporated, not municipal');
ok(E.service_url === 'https://maps.bouldercounty.org/arcgis/rest/services/PLANNING/OP_Accela_Point/MapServer/0', "service_url is the county's own layer");
ok(E.coverage.length === 1 && E.coverage[0].state === 'CO' && E.coverage[0].county === 'Boulder', 'coverage is exactly [{CO, Boulder}]');
ok(E.record_url_precision === 'record' && E.column_map.record_url === 'Link', 'per-record Accela link');

// every whitelisted docket is typed, into the closed vocabulary
const USE = new Set(['Residential', 'Commercial', 'Industrial', 'Utility', 'Development']);
const dockets = [...E.extra_where.matchAll(/'([^']+)'/g)].map((m) => m[1]);
ok(dockets.length === Object.keys(E.type_map).length && dockets.every((d) => Object.hasOwn(E.type_map, d)), 'every whitelisted DocketType has a type_map entry');
ok(Object.values(E.type_map).every((v) => USE.has(v)), 'every type_map value is a canonical use_type');
for (const noise of ['Reroofing', 'Furnace', 'Water Heater', 'Window and Door Replacement', 'Generator']) ok(!dockets.includes(noise), `routine docket "${noise}" is not in the whitelist`);

// status vocabulary observed live (groupBy, Planning+Building since 2025-11-19): bucketed once, none twice
const LIVE = ['Permit Complete','Permit Issued','Mapped','Closed Complete','PAC Held','Under Review','BLOT','','Closed','Payment Pending','Additional Information Request','Determination Final','In Process','Permit Specialist to Review','Final Balance Due','PAC Scheduled','Complete','Outstanding Requirements','Pre-Check Complete','PAC Not Held','Application Withdrawn','Issued','Withdrawn','Application Deposit Due','Void','Permit Withdrawn','Incomplete','Final Complete','BLOTNOT','On Hold','Zoning Hold','Transfer to Building','Ready to Issue','Approval Final & Complete','Planning Process Required','Combined and Subsumed','Plans Examiner to Review','CLOMR Process Fee','Final Approval Complete','Accepted Completed','BOCC Packet Available','Incorrect Jurisdiction','Cataloged','BOCC Approved','Redirected','Post Approval','Approved with Conditions','Application Received','LOMR FEMA Review','Hold','TDC Sold','Accepted','BOCC Hearing','Public Review','Application Accepted','CLOMR FEMA Review','Extinguished','Not Accepted','Received','BOA Denied','Approved','TDC Extinguished','BOCC Denied','BOCC Tabled to Date Certain','Public Review of Director Appr','Access and Engineering Hold','BOA Approved','Closed-Withdrawn','HPAB Hearing Scheduled','Permit Not Required'];
const all = Object.values(E.status_to_bucket).flat();
ok(new Set(all).size === all.length, 'no status is in two buckets');
ok(LIVE.every((s) => all.includes(s)), 'every live status is bucketed', LIVE.filter((s) => !all.includes(s)).join(' | '));
ok(E.status_to_bucket.approved.includes('Permit Issued') && E.status_to_bucket.operating.includes('Permit Complete'), 'Permit Issued -> approved, Permit Complete -> operating');
ok(['PAC Held','On Hold','Zoning Hold','Hold'].every((s) => E.status_to_bucket.exclude.includes(s)), 'hold statuses are excluded, never proposed');
ok(E.status_to_bucket.exclude.includes('Final Balance Due') && E.status_to_bucket.exclude.includes('Mapped'), 'statuses with no stated meaning are excluded, not guessed');

const W = E.recency_expr || '';
ok(/ApplicationDate >= DATE '\{cutoff\}'/.test(W) && !/20[0-2][0-9]-01-01/.test(W), 'window = recent applications OR open/pending status; no fixed historical cutoff');
const inList = (W.match(/ApplicationStatus IN \(([^)]*)\)/) || [,''])[1].match(/'([^']+)'/g)?.map((x) => x.slice(1, -1)) || [];
ok(inList.length > 0 && inList.every((st) => !E.status_to_bucket.exclude.includes(st) && all.includes(st)), 'older-record statuses are bucketed and none is an excluded status');
ok(!inList.some((st) => /withdr|void|denied|hold|expired|extinguish|combined|redirect/i.test(st)), 'window never keeps old withdrawn/void/denied/held/superseded records');
const FIX = JSON.parse(readFileSync(join(root, 'fixtures/boulder-county/accela-point-sample.json'), 'utf8'));
const calls = [];
const stub = async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => (calls.length === 1 ? FIX : { features: [] }) }; };
const { sites } = await arcgisForZip('80302', [{ state: 'CO', county: 'Boulder' }], [E], { fetch: stub, zipCentroid: { lat: 40.0407, lng: -105.3167 } });
ok(sites.length >= 1, `connector emits records from the real rows (got ${sites.length})`);
const spr = sites.find((s) => /SPR-26-0053/.test(JSON.stringify(s)));
ok(!!spr, 'SPR-26-0053 (Site Plan Review) is emitted');
if (spr) {
  ok(spr.record_url && spr.record_url.startsWith('https://boco.org/CapDetail'), 'record_url is the per-record Accela link');
  ok(spr.use_type === 'Development', 'Site Plan Review -> Development');
  ok(typeof spr.lat === 'number' && spr.scope === 'point', 'pinned from its own geometry');
}
ok(sites.every((s) => s.record_url), 'every record has a record_url (anti-fabrication gate)');
const reqs = [];
await arcgisForZip('80302', [{ state: 'CO', county: 'Boulder' }], [E], { fetch: async (u, init) => { reqs.push({ u: String(u), init }); return { ok: true, status: 200, json: async () => ({ features: [] }) }; }, zipCentroid: { lat: 40.0407, lng: -105.3167 } });
const post = reqs.find((r) => r.init && r.init.method === 'POST');
ok(!!post, 'the connector sends the long 28-docket query as a form POST (a GET would be refused by IIS at 2,048 characters)');
const body = decodeURIComponent(String(post?.init?.body || '').replace(/\+/g, ' '));
ok(dockets.every((d) => body.includes("'" + d + "'")) && body.includes('ApplicationStatus IN') && body.includes('resultRecordCount'), 'the POST body carries all 28 dockets, the status window and paging');
ok(reqs.every((r) => !(r.init?.method !== 'POST' && r.u.length > 2048)), 'no GET exceeds the 2,048-character IIS limit');
ok(coverageMatches(E.coverage, [{ state: 'CO', county: 'Boulder' }]) && !coverageMatches(E.coverage, [{ state: 'CO', county: 'Weld' }]) && !coverageMatches(E.coverage, [{ state: 'CO', county: 'Broomfield' }]), 'gate allows Boulder County, blocks Weld and Broomfield');
const c2 = []; const r2 = await arcgisForZip('80020', [{ state: 'CO', county: 'Broomfield' }], [E], { fetch: async (u) => { c2.push(u); return { ok: true, status: 200, json: async () => FIX }; }, zipCentroid: { lat: 39.9, lng: -105.1 } });
ok(r2.sites.length === 0 && c2.length === 0, 'a Broomfield ZIP never fetches the layer');
console.log(fails ? `\n${fails} FAILED` : '\nAll boulder-county-accela assertions passed.');
process.exit(fails ? 1 : 0);
