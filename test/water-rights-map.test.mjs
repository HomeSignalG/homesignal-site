// STATE WATER-RIGHTS FILINGS on Map 1 (2026-10-29) — the offline half.
// The SQL half (both readers) is test/state_water_rights_pg (state-water-rights-suite.yml).
//   A  mapping from BOTH reader shapes (real production bodies), sourced points only
//   B  marker, switch, grouping and per-filing lists
//   C  ZIP mode admits water-rights pins only on the server's 'member' verdict
//   D  the page: one predicate; never in the facility count; only its own switch
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let fails = 0;
const ok = (c, name, detail) => {
  if (c) console.log('PASS — ' + name);
  else { fails++; console.log('FAIL — ' + name + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ctx = { window: {}, URL, document: undefined };
vm.createContext(ctx);
for (const f of ['lib/project-type.js', 'lib/map.js', 'lib/zip-authoritative.js', 'lib/state-cleanup.js', 'lib/water-rights.js', 'lib/water-rights-map.js']) {
  vm.runInContext(read(f), ctx);
}
const HS = ctx.window.HS;
const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
const FX = JSON.parse(read('test/fixtures/water-rights/map1-readers-2026-10-29.json'));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── A ──
const zs = HS.waterRightsSitesFrom(clone(FX.zip));
ok(zs.length === 4 && zs.every(HS.isWaterRight), 'A1 ZIP reader: one site per point (2 filings × 2 points)', zs.length);
ok(zs.every((s) => s.zip_membership === 'member'), 'A2 ZIP sites keep the server verdict');
const a = zs.find((s) => s.water.filing.filing_no === 'a55167');
ok(a && a.record_url === 'https://www.waterrights.utah.gov/search/?q=a55167' && a.water.filing.agency === 'Utah Division of Water Rights',
  'A3 the agency and record link are the reader\'s own');
ok(a.water.filing.uses === '', 'A4 an undecoded use code ("OP") is not shown');
const ns = HS.waterRightsSitesFrom(clone(FX.near));
ok(ns.length === 2 && ns.every((s) => s.zip_membership === undefined), 'A5 circle reader: points, and no ZIP verdict', ns.length);
ok(ns[0].water.filing.agency === 'Utah Division of Water Rights' && /^2026-10-29/.test(ns[0].water.filing.checked_at),
  'A6 circle reader: agency and checked date come from that filing\'s own source');
const bad = clone(FX.zip); bad.filings[0].record_url = 'http://x'; bad.filings[1].points = [{ lat: 'x', lng: 1 }];
ok(HS.waterRightsSitesFrom(bad).length === 0, 'A7 no https link, or no numeric point -> nothing drawn');
ok(HS.waterRightsOutcome(null) === 'unavailable' && HS.waterRightsSitesFrom({}).length === 0, 'A8 an unreadable body is unavailable, never "none"');
ok(HS.waterRightsOutcome({ status: 'unavailable', filings: [] }) === 'stale', 'A9 a load older than 48h reads stale');

// ── B ──
const m = HS.resolveTrackerMarker(a);
ok(m.isWaterRight && m.label === 'W' && m.color === '#1c6ea4' && m.typeKey === null && !m.isFacility,
  'B1 own marker: letter W, own colour, no Type, not a facility', m);
HS.setWaterRightsVisible(false); ok(!HS.waterRightsVisible(), 'B2 the switch turns the layer off'); HS.setWaterRightsVisible(true);
ok(HS.waterRightsFromUrl('https://x/homesignalmap.html?water=0') === false && HS.waterRightsFromUrl('https://x/?water=1') === true
  && HS.waterRightsFromUrl('https://x/') === null, 'B3 ?water=0/1, else default');
const twin = clone(FX.zip); twin.filings[1].points = clone(twin.filings[0].points).slice(0, 1);
const g = HS.waterRightsSitesFrom(twin);
const grp = g.find((s) => HS.waterRightGroupOf(s));
ok(g.length === 2 && grp && HS.waterRightGroupOf(grp).length === 2, 'B4 two filings at one point = one pin listing both', g.length);
ok(HS.waterRightFilings(zs).length === 2 && HS.waterRightFilings(g).length === 2, 'B5 lists count FILINGS, once each');
const html = HS.waterRightsListHTML(zs, esc, 12);
ok((html.match(/class='rec'/g) || []).length === 2 && /Agency status: Unapproved/.test(html) && /Individual applicant/.test(html),
  'B6 list rows: one per filing, agency status word, private applicant withheld');
const pop = HS.waterRightPopupHTML(a, esc);
ok(/From Utah Division of Water Rights’s list, checked Oct 29, 2026/.test(pop) && /a55167/.test(pop), 'B7 popup names source and checked date');

// ── C ──
const noVerdict = Object.assign({}, a); delete noVerdict.zip_membership;
const outside = Object.assign({}, a, { zip_membership: 'outside' });
ok(HS.zipModeSites([], null, [], [], [a, noVerdict, outside]).length === 1, 'C1 ZIP mode admits only the member verdict');
ok(HS.zipModeSites([], null, [], []).length === 0, 'C2 the four-argument call still works');

// ── D ──
const PAGE = read('homesignalmap.html');
ok(/rpc\/water_rights_for_zip/.test(PAGE) && /rpc\/map1_water_rights_near/.test(PAGE), 'D1 ZIP mode and address mode each read their reader');
ok(/zipModeSites\(rsSites, auth, natlSites, cleanupSites, waterSites\)/.test(PAGE), 'D2 ZIP mode passes water sites through the one door');
ok(/&& !\(HS\.isWaterRight && HS\.isWaterRight\(s\)\); \}\);/.test(PAGE), 'D3 water-rights pins never enter the facility set');
ok(/HS\.waterRightsVisible\(\)/.test(PAGE) && /waterToggle/.test(PAGE), 'D4 the pins answer their own switch');
ok(/lib\/water-rights-map\.js\?v=[0-9a-f]{8}/.test(PAGE), 'D5 the module is loaded with a content key');

if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('ALL PASS — water rights on Map 1');
