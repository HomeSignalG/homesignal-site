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

// DATE POLICY (founder, 2026-11-20): ONE rolling 365-day window on ApplicationDate for every Boulder County record, whatever its status.
// No status exception, no fixed historical cutoff. The window is the engine's default clause (recency_days + the file_date column).
ok(E.recency_days === 365, 'window = 365 days');
ok(!('recency_expr' in E), 'no recency_expr: no status-based exception to the date window', String(E.recency_expr || '').slice(0, 120));
ok(E.column_map.file_date === 'ApplicationDate', 'the window column is ApplicationDate (column_map.file_date)');
ok(!JSON.stringify(E).match(/DATE '20[0-2][0-9]-/), 'no fixed historical date anywhere in the entry');
const DISCLOSURE = 'Boulder County records shown are applications filed within the last 365 days. Older applications are excluded, including those with pending statuses, so this report is not a complete inventory of ongoing projects. County record statuses do not confirm that construction is underway.';
ok(E.scope_note === DISCLOSURE, 'the source-window disclosure is carried word for word (registry scope_note -> report "Source scope")');
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
const sent = reqs[0];
ok(!!sent, 'the connector sends the Boulder County query');
const body = decodeURIComponent(String(sent?.init?.body || sent?.u || '').replace(/\+/g, ' '));
ok(dockets.every((d) => body.includes("'" + d + "'")) && body.includes('ApplicationDate >= DATE') && body.includes('resultRecordCount'), 'the query carries all 28 dockets, the 365-day window and paging');
ok(reqs.every((r) => r.init?.method === 'POST' || r.u.length <= 2048), 'no GET exceeds the 2,048-character IIS limit (a longer query is sent as a form POST)');
ok(coverageMatches(E.coverage, [{ state: 'CO', county: 'Boulder' }]) && !coverageMatches(E.coverage, [{ state: 'CO', county: 'Weld' }]) && !coverageMatches(E.coverage, [{ state: 'CO', county: 'Broomfield' }]), 'gate allows Boulder County, blocks Weld and Broomfield');
const c2 = []; const r2 = await arcgisForZip('80020', [{ state: 'CO', county: 'Broomfield' }], [E], { fetch: async (u) => { c2.push(u); return { ok: true, status: 200, json: async () => FIX }; }, zipCentroid: { lat: 39.9, lng: -105.1 } });
ok(r2.sites.length === 0 && c2.length === 0, 'a Broomfield ZIP never fetches the layer');

// ── the query the connector actually sends, evaluated on rows of every status and age ─────────────────────────────────────────
// The layer filters server-side, so the test reads the WHERE the shipped connector builds and applies its date predicate to sample rows.
const decodeQ = (r) => decodeURIComponent((String(r.init?.body || r.u)).replace(/\+/g, ' '));
async function whereAt(nowMs) {
  const real = Date.now; Date.now = () => nowMs;
  const rq = [];
  try { await arcgisForZip('80302', [{ state: 'CO', county: 'Boulder' }], [E], { fetch: async (u, init) => { rq.push({ u: String(u), init }); return { ok: true, status: 200, json: async () => ({ features: [] }) }; }, zipCentroid: { lat: 40.0407, lng: -105.3167 } }); }
  finally { Date.now = real; }
  return decodeQ(rq[0]);
}
const NOW = Date.parse('2026-11-20T15:00:00Z');
const Wq = await whereAt(NOW);
const m = Wq.match(/ApplicationDate >= DATE '(\d{4}-\d{2}-\d{2})'/);
ok(!!m, 'the sent query carries the ApplicationDate window');
const cutoff = m ? m[1] : '';
ok(cutoff === new Date(NOW - 365 * 86400000).toISOString().slice(0, 10), 'cutoff follows the engine convention: now - 365 x 86,400,000 ms, ISO date (UTC)', cutoff);
ok(!/\bOR\b/i.test(Wq.replace(/DocketType IN \([^)]*\)/, '')), 'the sent query has no OR branch (no date-independent exception)');
ok(!/ApplicationStatus/.test(Wq), 'the sent query does not mention ApplicationStatus at all (no status-based inclusion)');
ok(!/20[0-2][0-9]-01-01/.test(Wq), 'the sent query has no fixed historical cutoff');
const keeps = (row) => row.ApplicationDate >= cutoff;
const rows = [
  { id: 'recent-pending', ApplicationStatus: 'Under Review', ApplicationDate: '2026-09-01', want: true },
  { id: 'recent-approved', ApplicationStatus: 'Permit Issued', ApplicationDate: '2026-02-10', want: true },
  { id: 'old-approved-final', ApplicationStatus: 'Determination Final', ApplicationDate: '1972-12-19', want: false },
  { id: 'old-bocc-approved', ApplicationStatus: 'BOCC Approved', ApplicationDate: '2018-06-01', want: false },
  { id: 'old-pending', ApplicationStatus: 'Ready to Issue', ApplicationDate: '2019-03-04', want: false },
  { id: 'ancient-pending', ApplicationStatus: 'Accepted', ApplicationDate: '2000-05-05', want: false },
  { id: 'on-cutoff-day', ApplicationStatus: 'Incomplete', ApplicationDate: cutoff, want: true },
  { id: 'day-before-cutoff', ApplicationStatus: 'Incomplete', ApplicationDate: new Date(Date.parse(cutoff) - 86400000).toISOString().slice(0, 10), want: false },
];
for (const r of rows) ok(keeps(r) === r.want, `window ${r.want ? 'includes' : 'excludes'} ${r.id} (${r.ApplicationStatus}, filed ${r.ApplicationDate})`);
// the boundary moves with the clock, not with a stored date
const W2 = await whereAt(NOW + 30 * 86400000);
const c2b = (W2.match(/ApplicationDate >= DATE '(\d{4}-\d{2}-\d{2})'/) || [])[1];
ok(c2b === new Date(NOW + 30 * 86400000 - 365 * 86400000).toISOString().slice(0, 10) && c2b > cutoff, 'the window is rolling: 30 days later the cutoff is 30 days later', c2b);
// other registries are unchanged by this policy
const LM = REG.arcgis.find((e) => e.registry_id === 'longmont-active-development');
ok(LM && !('recency_expr' in LM) && !LM.recency_days, 'Longmont (a different source) has no window of this kind and is unchanged');
ok(REG.arcgis.filter((e) => /ApplicationStatus IN/.test(e.recency_expr || '')).length === 0, 'no registry entry keeps a status-based date exception on ApplicationStatus');
ok(REG.arcgis.filter((e) => e.recency_expr).every((e) => e.registry_id !== 'boulder-county-accela-applications'), 'no other entry\'s recency_expr was borrowed for Boulder County');
console.log(fails ? `\n${fails} FAILED` : '\nAll boulder-county-accela assertions passed.');
process.exit(fails ? 1 : 0);
