// AIR PERMITS & FILINGS (founder requirement 2026-11-21) — the offline half. The executable SQL half is
// test/air_permits_pg/run.sh (air-permits-suite.yml).
//   A  every reader state renders its own words; blocked / not covered / stale / failed NEVER read as "none"
//   B  presentation rules: no "approved", renewals and changes are not new construction, comment dates, no emission amounts,
//      permitted limits are not measured exposure, people are never named
//   C  the regression case (registration 185303 / project 414660) in the reader's own shape — a FIXTURE, not evidence
//   D  the Map 1 layer: its own predicate and marker, ZIP-member admission, records (not pins) counted, separate from development
//   E  wiring: every surface reads the same reader; Map 1 has its chip, band and URL switch; ZIP page and the QoL page have the section
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let fails = 0;
const ok = (c, name, detail) => {
  if (c) console.log('PASS — ' + name);
  else { fails++; console.log('FAIL — ' + name + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ctx = { window: {}, URL };
vm.createContext(ctx);
vm.runInContext(read('lib/air-permits.js'), ctx);
vm.runInContext(read('lib/air-permits-map.js'), ctx);
const HS = ctx.window.HS, A = HS.airPermits;
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const NOW = new Date('2026-11-21T12:00:00Z');

// FIXTURE in the exact shape public.air_permits_for_zip returns (identifiers from the task brief; location is a reviewed point).
const DOC = 'https://records.tceq.texas.gov/cs/idcplg?IdcService=TCEQ_EXTERNAL_SEARCH_GET_FILE&Rendition=Web&dID=10258370&searchType=External';
const SPACEX = { record_id: 'tx_tceq_nsr:414660', source: 'tx_tceq_nsr', state: 'TX', permit_no: '185303', project_no: '414660',
  facility_ref: 'RN112524897', facility_name: 'BOCA CHICA FACILITY', applicant: 'Space Exploration Technologies Corp.',
  permit_type: 'Standard permit, electric generating facilities', action_kind: 'registration', status: 'PENDING', received_on: '2026-09-08',
  record_url: DOC, location_basis: 'reviewed_point', points: [{ lat: 25.950101, lng: -97.395252, zip_membership: 'member' }] };
const body = (over) => Object.assign({ zip: '78521', state: 'TX', state_name: 'Texas', agency: 'Texas Commission on Environmental Quality',
  permit_types: ['New Source Review permits'], status: 'complete', checked_at: '2026-11-21T08:00:00+00:00', records: [SPACEX] }, over || {});

// A — states
const s = (b) => text(A.sectionHTML(b, NOW));
ok(A.outcome(null) === 'read_failed' && A.outcome({ status: 'complete' }) === 'read_failed' && A.outcome({ status: 'x', records: [] }) === 'read_failed', 'A1 malformed answers are failed reads');
ok(/could not be read just now/.test(s(null)) && !/no air-permit records/i.test(s(null)), 'A2 a failed read says so and never says none');
ok(/cannot be read by HomeSignal yet.*unknown, not absent/.test(s(body({ status: 'blocked', records: [] }))), 'A3 blocked reads "unknown, not absent"');
ok(/does not read Texas’s air-permit records yet.*says nothing about whether permits exist/.test(s({ status: 'not_covered', state_name: 'Texas', records: [] })), 'A4 not covered reads as our gap');
ok(/no mapped Census area/.test(s(body({ status: 'not_measured', records: [] }))), 'A5 not_measured has its own sentence');
const none = s(body({ records: [] }));
ok(/No air-permit records in Texas Commission on Environmental Quality’s list lie in this ZIP\. Checked Nov 21, 2026\. Covers: New Source Review permits\./.test(none), 'A6 only a complete read may say none, naming agency, day and coverage', none);
ok(!/No air-permit records/.test(s(body({ status: 'unavailable', records: [] }))) && /unknown/.test(s(body({ status: 'unavailable', records: [] }))), 'A7 a stale source with nothing never says none');
ok(/could not be refreshed on the last check; these were last confirmed Nov 21, 2026/.test(s(body({ status: 'unavailable' }))), 'A8 a stale source shows its last records as "last confirmed"');
for (const st of ['blocked', 'not_covered', 'unavailable', 'not_measured']) ok(!/\bno air-permit records\b/i.test(s(body({ status: st, records: [] }))), 'A9 ' + st + ' never claims absence');

// B — presentation rules
const full = text(A.sectionHTML(body(), NOW));
ok(!/approved/i.test(A.sectionHTML(body(), NOW)), 'B1 the word "approved" never appears for a pending registration');
ok(/Registration 185303/.test(full) && /Agency status: PENDING/.test(full) && /Facility: BOCA CHICA FACILITY \(RN112524897\)/.test(full), 'B2 type, status and facility are the agency’s words', full);
ok(full.includes(A.NOTE) && /not approval of a whole development/.test(full) && /not measured air quality/.test(full), 'B3 the section says an authorization is not project approval and limits are not measured exposure');
ok(!/\b(tons?|tpy|ppm|µg|lbs?)\b/i.test(full) && !/emission(s)? (of|totaling)/i.test(full), 'B4 no emission amount is ever printed');
const ren = Object.assign({}, SPACEX, { record_id: 'r', permit_no: '1', action_kind: 'renewal', status: 'RENEWAL PENDING' });
const mod = Object.assign({}, SPACEX, { record_id: 'm', permit_no: '2', action_kind: 'modification' });
const iss = Object.assign({}, SPACEX, { record_id: 'i', permit_no: '3', action_kind: 'issued', status: 'ISSUED', action_on: '2026-11-16' });
const rt = text(A.sectionHTML(body({ records: [SPACEX, ren, mod, iss] }), NOW));
ok(/Renewal of an existing authorization, not a new project/.test(rt) && /Changes an existing authorization/.test(rt), 'B5 a renewal and a modification say they concern an existing authorization');
ok(/1 application or registration, 1 issued, 2 renewals or changes/.test(rt), 'B6 counts keep renewals and changes out of the "new" number', rt);
ok(A.counts([SPACEX, ren, mod, iss]).new_filings === 1, 'B7 only applications, registrations and proposed actions are "new filings"');
ok(/Issued authorization 3/.test(rt) && /Action Nov 16, 2026/.test(rt) && !/approved/i.test(rt), 'B8 an issued authorization is "Issued authorization", with the agency’s action date');
ok(A.commentLine({ comment_until: '2026-12-01' }, NOW) === 'Public comment open until Dec 1, 2026' && A.commentLine({ comment_until: '2026-11-01' }, NOW) === 'Public comment period ended Nov 1, 2026' && A.commentLine({}, NOW) === '', 'B9 public comment only when the source states a deadline, open vs ended');
ok(/approximate/.test(A.locationLine({ location_basis: 'reviewed_point' })) && /approximate/.test(A.locationLine({ location_basis: 'geocoded_address' })) && A.locationLine({ location_basis: 'source_point' }) === '', 'B10 reviewed and geocoded locations are labelled approximate');
ok(/Applicant: Individual applicant/.test(text(A.sectionHTML(body({ records: [Object.assign({}, SPACEX, { applicant: 'Individual applicant' })] }), NOW))), 'B11 a withheld person is shown as the server sends it');
ok(/more record in this county is listed without a location and could not be placed/.test(text(A.sectionHTML(body({ unlocated_in_county: 1 }), NOW))), 'B12 records without a point are counted, not placed');
ok(!/href="javascript:|href="http:/.test(A.sectionHTML(body({ records: [Object.assign({}, SPACEX, { record_url: 'http://x.example/a' })] }), NOW)), 'B13 a non-https link is never linked');
ok(A.sectionHTML(body(), NOW).includes('href="' + DOC + '"'.replace(/&/g, '&amp;')) || A.sectionHTML(body(), NOW).includes(DOC.replace(/&/g, '&amp;')), 'B14 the official record link is the one the reader supplied');
ok(!/data-center|data center/i.test(full), 'B15 no data-center connection is asserted from an air permit alone');

// C — regression case through the Map layer
const sites = HS.airPermitsSitesFrom(body());
ok(sites.length === 1 && HS.isAirPermit(sites[0]) && sites[0].air.record.permit_no === '185303' && sites[0].air.record.project_no === '414660' && sites[0].air.record.facility_ref === 'RN112524897', 'C1 the regression record becomes one Map 1 site with its identifiers', sites.length);
ok(sites[0].record_url === DOC && sites[0].zip_membership === 'member', 'C2 the site keeps the official link and the polygon verdict');
ok(/Registration · Agency status: PENDING/.test(HS.airPermitTypeLine(sites[0], NOW)) && !/approved/i.test(HS.airPermitPopupHTML(sites[0], (x) => x, false)), 'C3 popup and type line never say approved');
ok(HS.airPermitPopupHTML(sites[0], (x) => String(x), false).includes('not approval of a whole development'), 'C4 the popup carries the not-approval and not-exposure note');

// D — layer rules
ok(HS.airPermitMarker().isFacility === false && HS.airPermitMarker().typeKey === null && HS.airPermitMarker().filterKey === 'air_permits', 'D1 an air permit is not a facility and not a project Type');
ok(HS.AIR_PERMITS_LEGEND.chipLabel === 'Air permits & filings', 'D2 the chip is labelled "Air permits & filings"');
const two = HS.airPermitsSitesFrom(body({ records: [SPACEX, Object.assign({}, SPACEX, { record_id: 'tx_tceq_nsr:2', permit_no: '186000', action_kind: 'renewal' })] }));
ok(two.length === 1 && HS.airPermitGroupOf(two[0]).length === 2 && HS.airPermitRecords(two).length === 2, 'D3 two records at one point are one pin and two records');
ok(HS.airPermitsSitesFrom(body({ status: 'blocked' })).length === 0 && HS.airPermitsOutcome(body({ status: 'blocked' })) === 'blocked' && HS.airPermitsOutcome(null) === 'unavailable', 'D4 a blocked or unreadable answer draws nothing and says why');
ok(HS.airPermitsSitesFrom({ status: 'complete', sources: [{ source: 'tx_tceq_nsr', status: 'blocked', agency: 'TCEQ' }], records: [SPACEX] }).length === 0, 'D5 the circle reader’s blocked source contributes no pins');
ok(HS.airPermitsSitesFrom(body({ records: [Object.assign({}, SPACEX, { record_url: 'http://x.example' })] })).length === 0 && HS.airPermitsSitesFrom(body({ records: [Object.assign({}, SPACEX, { points: [] })] })).length === 0, 'D6 no https link or no point draws nothing');
ok(HS.airPermitsFromUrl('https://x/?air=0') === false && HS.airPermitsFromUrl('https://x/?air=1') === true && HS.airPermitsFromUrl('https://x/') === null, 'D7 ?air=0/1 is the switch');
const listing = HS.airPermitsListHTML(two, (x) => String(x), 12);
ok((listing.match(/class='rec'/g) || []).length === 2, 'D8 the list shows one row per RECORD');

// E — wiring (each surface reads the one reader; nothing is counted as development)
const mp = read('lib/map.js'), map = read('homesignalmap.html'), com = read('lib/community-page.js'), dev = read('development.html'), zip = read('lib/zip-authoritative.js');
ok(/rpc\/air_permits_for_zip/.test(map) && /rpc\/map1_air_permits_near/.test(map), 'E1 Map 1 reads both readers (ZIP mode and address mode)');
ok(/id="airBand"/.test(map) && /buildAirPermitsChip\(host\)/.test(map) && /airPermitsVisible\(\)/.test(map) && /set\("air"/.test(map), 'E2 Map 1 has the band, the chip, the visibility filter and the URL switch');
ok(/HS\.zipModeSites\(rsSites, auth, natlSites, cleanupSites, waterSites, airSites\)/.test(map) && /airSites/.test(zip) && /HS\.zipMemberAdmitted/.test(zip), 'E3 ZIP-mode air points enter the one admission door');
ok(/contentCount = sites\.length - cleanupSites\.length - waterSites\.length - airSites\.length/.test(map), 'E4 air permits never make a page "have content" or indexable');
ok(/!\(HS\.isAirPermit && HS\.isAirPermit\(s\)\); \}\);/.test(map), 'E5 air permits are excluded from the EPA facility list on Map 1');
ok(/HS\.isAirPermit\(s\) \? HS\.airPermitMarker\(s\) : resolveBefore/.test(read('lib/air-permits-map.js')) && !/airPermit/.test(mp), 'E6 the resolver wrapper gives air permits their own marker before any Type rule; lib/map.js is untouched');
{ const c2 = { window: { HS: { resolveTrackerMarker: (s) => ({ typeKey: 'industrial', from: 'map' }) } }, URL }; vm.createContext(c2); vm.runInContext(read('lib/air-permits-map.js'), c2);
  const H = c2.window.HS; const site = HS.airPermitsSitesFrom(body())[0];
  ok(H.resolveTrackerMarker(site).isAirPermit === true && H.resolveTrackerMarker({ relevance: 'development' }).from === 'map', 'E6b wrapped resolver: air permit -> its marker; any other record -> the original resolver'); }
ok(/HS\.airPermits\.load\(zip\)/.test(com) && /HS\.airPermits\.sectionHTML\(airPermits\)/.test(com), 'E7 the ZIP page renders the section');
ok(/HS\.airPermits\.load\(S\.zip\)/.test(dev) && /airSection\(\)/.test(dev), 'E8 the Quality of Life Impact page (development.html) renders the section');
ok(/air-permits\.js/.test(read('community.html')) && /air-permits\.js/.test(read('scripts/gen_zip_pages.py')) && /air-permits-map\.js/.test(map) && /air-permits\.js/.test(dev), 'E9 every host that renders it loads the module');
ok(!/air_permit|airPermit/.test(read('lib/data.js')), 'E10 nothing in the development data path reads air permits, so no development count can include one');
ok(/'air'|\bair\b/.test(read('docs/air-permits.sql')) === true && /project_link_ref/.test(read('docs/air-permits.sql')) && !/air_permit_records[^;]*app_projects/.test(read('docs/air-permits.sql')), 'E11 facility, project link and permit record are separate in the SQL; no development table is touched');

if (fails) { console.log('\n' + fails + ' FAILURE(S)'); process.exit(1); }
console.log('\nair-permits: all checks pass');
