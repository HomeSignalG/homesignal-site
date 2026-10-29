// STATE CLEANUP SITES on Map 1 (founder decision 2026-10-21) — the offline half.
// The executable SQL half is test/state_cleanup_pg/run.sh (state-cleanup-suite.yml).
//   A  the mapping: only sourced, located rows become sites; codes in DEP's own words
//   B  the marker: own shape/colour/letter, no lifecycle colour, no regulatory R, no Type
//   C  ZIP mode admits cleanup sites on the server's 'member' verdict only
//   D  the page: one predicate everywhere; cleanup sites never enter the EPA facility set,
//      never make a page indexable, and answer only their own switch
//   E  2026-10-22: a withheld private name, the checked date, a shared record link, and sites at one
//      point drawn as one pin while every list and count stays per site
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
vm.runInContext(read('lib/project-type.js'), ctx);
vm.runInContext(read('lib/map.js'), ctx);
vm.runInContext(read('lib/zip-authoritative.js'), ctx);
vm.runInContext(read('lib/state-cleanup.js'), ctx);
const HS = ctx.window.HS;
const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');

// Real row shape from public.map1_state_cleanup_zip_members (local PostGIS run, 2026-10-21).
const ROW = { lat: 26.119515886579535, lng: -80.12843878201893, city: 'FORT LAUDERDALE', name: 'CITGO (FORMER)',
  state: 'FL', agency: 'Florida DEP', source: 'fl_dep_cleanup', status: 'ACTIVE', address: '1500 E LAS OLAS BLVD',
  category: 'PETRO', site_key: '89287788', program_id: '8839695',
  record_url: 'https://prodenv.dep.state.fl.us/DepNexus/public/electronic-documents/8839695/facility!search',
  zip_membership: 'member', source_loaded_at: '2026-10-21T07:00:09+00:00' };

// ── A ──
const s = HS.stateCleanupSite(ROW);
ok(s && s.scope === 'point' && s.relevance === 'state_cleanup', 'A1 a reader row becomes a state-cleanup point');
ok(s.lat === ROW.lat && s.lng === ROW.lng && s.record_url === ROW.record_url, 'A2 point and record link are the row’s own');
ok(HS.stateCleanupSite({ ...ROW, record_url: null }) === null, 'A3 no record link -> no site');
ok(HS.stateCleanupSite({ ...ROW, record_url: 'http://x' }) === null, 'A4 a non-https link -> no site');
ok(HS.stateCleanupSite({ ...ROW, lat: null }) === null, 'A5 no point -> no site');
ok(HS.stateCleanupTypeLine(s) === 'Petroleum · Florida DEP status: Active', 'A6 the type line is DEP’s legend word + status', HS.stateCleanupTypeLine(s));
ok(HS.stateCleanupCategoryLabel(HS.stateCleanupSite({ ...ROW, category: 'FED' })) === 'Cleanup category FED',
  'A7 a code DEP’s legend does not name is shown as the code, not guessed');
ok(HS.stateCleanupStatusLabel(HS.stateCleanupSite({ ...ROW, status: 'ONHOLD' })) === 'On hold', 'A8 ONHOLD reads "On hold"');
ok(HS.stateCleanupSitesFrom({ status: 'complete', sites: [ROW, { ...ROW, record_url: '' }] }).length === 1,
  'A9 the body mapping drops unsourced rows');
ok(HS.stateCleanupOutcome(null) === 'unavailable' && HS.stateCleanupOutcome({ status: 'not_measured', sites: [] }) === 'not_measured',
  'A10 a failed read is "unavailable", never a measured empty');
ok(/not a finding about any owner/.test(HS.stateCleanupPopupHTML(s, esc)), 'A11 the popup carries the public-record framing');
ok(!/ECHO|purple|violation/i.test(HS.stateCleanupPopupHTML(s, esc)), 'A12 the popup claims nothing EPA');

// Real Washington row shape (Ecology CleanupSites layer, pg_net read 2026-10-21; reader shape from the
// local PostGIS suite): status in words, no category, the site's own Ecology page.
const WA = { lat: 48.211804727846456, lng: -122.68578411499313, city: 'COUPEVILLE', name: 'Coupeville Country Store',
  state: 'WA', agency: 'Washington Ecology', source: 'wa_ecology_cleanup', status: 'Cleanup Started', address: '1 S MAIN ST',
  site_key: '10008', program_id: '10008', record_url: 'https://apps.ecology.wa.gov/cleanupsearch/site/10008',
  zip_membership: 'member' };
const w = HS.stateCleanupSite(WA);
ok(w && HS.stateCleanupTypeLine(w) === 'Cleanup site · Washington Ecology status: Cleanup Started',
  'A13 a Washington site reads its own status words, no invented category', w && HS.stateCleanupTypeLine(w));
ok(HS.stateCleanupStatusLabel(HS.stateCleanupSite({ ...WA, status: 'ACTIVE' })) === 'ACTIVE',
  'A14 Florida\u2019s code words are not applied to another state\u2019s values');
ok(/Washington Ecology site documents/.test(HS.stateCleanupPopupHTML(w, esc)), 'A15 the popup names the agency that publishes it');

// ── B ──
const mk = HS.resolveTrackerMarker(s, (x) => x.registry_id);
ok(mk.isStateCleanup === true && mk.shape === 'circle' && mk.label === 'C', 'B1 resolveTrackerMarker gives the cleanup marker');
ok(mk.signal === null && mk.typeKey === null, 'B2 no regulatory R and no project Type');
const typeSymbols = Object.values(HS.CATEGORY_REGISTRY || {}).map((c) => c.symbol);
ok(!typeSymbols.includes(mk.shape), 'B3 no project Type or the facility square uses its shape', typeSymbols);
ok(!Object.values(HS.LIFECYCLE_HEX || {}).includes(mk.color), 'B4 its colour is not a lifecycle colour');
const epa = HS.resolveTrackerMarker({ scope: 'point', registry_id: '110000', label: 'X', layer: 'industrial' }, (x) => x.registry_id);
ok(!epa.isStateCleanup, 'B5 an EPA facility is unchanged by this layer');

// ── C ──
const nonMember = HS.stateCleanupSite({ ...ROW, site_key: '2', zip_membership: 'outside' });
const noVerdict = HS.stateCleanupSite({ ...ROW, site_key: '3', zip_membership: undefined });
const zs = HS.zipModeSites([], null, [], [s, nonMember, noVerdict]);
ok(zs.length === 1 && zs[0] === s, 'C1 ZIP mode admits only the member', zs.length);
ok(HS.zipModeSites([], null, []).length === 0, 'C2 the old three-argument call still works');

// ── D ── the page
const PAGE = read('homesignalmap.html');
ok(/<script src="lib\/state-cleanup\.js\?v=[^"]+"><\/script>/.test(PAGE), 'D1 the page loads the module');
ok(PAGE.indexOf('<script src="lib/state-cleanup.js') > PAGE.indexOf('<script src="lib/map.js'), 'D2 after lib/map.js');
const fn = (name) => { const i = PAGE.indexOf('function ' + name + '('); return PAGE.slice(i, PAGE.indexOf('\n  }', i)); };
ok(/isStateCleanup\(p\)\) return HS\.stateCleanupVisible\(\)/.test(fn('siteVisible')), 'D3 siteVisible: own switch only');
ok(/isStateCleanup\(x\.s\)\) return HS\.stateCleanupVisible\(\)/.test(fn('markerVisible')), 'D4 markerVisible: own switch only');
ok(/isStateCleanup\(s\)\) return HS\.stateCleanupPopupHTML/.test(fn('popupHTML')), 'D5 popupHTML branches first');
ok(/isStateCleanup\(s\)/.test(fn('infoCard3')) && /isStateCleanup\(s\)/.test(fn('kind3')), 'D6 the 3D card and type line branch');
const R = fn('render');
ok(/var fac = sites\.filter\(function\(s\)\{ return s\.scope==="point" && s\.relevance!=="development"\s*&& !\(HS\.isStateCleanup && HS\.isStateCleanup\(s\)\)/.test(R),
  'D7 cleanup sites never enter the EPA facility set (count, rails, facilities-only)');
ok(/setIndexable\(ZIP_MODE && ZIP_INDEXABLE && contentCount > 0\)/.test(R) && !/setIndexable\(ZIP_MODE && ZIP_INDEXABLE && sites\.length > 0\)/.test(R),
  'D8 cleanup sites never make a page indexable');
ok(/map1_state_cleanup_zip_members/.test(fn('loadZip')) && /zipModeSites\(rsSites, auth, natlSites, cleanupSites(, waterSites)?\)/.test(fn('loadZip')),
  'D9 ZIP mode reads the member reader through the one door');
ok(/map1_state_cleanup_near/.test(PAGE), 'D10 address mode reads the near reader');
ok(/id="cleanupBand" hidden/.test(PAGE), 'D11 the band starts hidden');
ok(/function buildStateCleanupChip/.test(PAGE) && /buildStateCleanupChip\(host\)/.test(fn('buildRegulatoryRow')),
  'D12 the switch lives in the Regulatory records row');
ok(!/setCategoryFilter\(HS\.STATE_CLEANUP/.test(PAGE), 'D13 the switch never writes a Type/Regulatory filter key');

// ── E ── (reader shapes from the local PostGIS suite, 2026-10-22)
const C2 = { ...ROW, checked_at: '2026-10-22T10:20:00.16563+00:00', record_url_sites: 1 };
const sc = HS.stateCleanupSite(C2);
ok(HS.stateCleanupCheckedLine(sc) === 'From Florida DEP\u2019s list, checked Oct 22, 2026', 'E1 the checked line', HS.stateCleanupCheckedLine(sc));
ok(/checked Oct 22, 2026/.test(HS.stateCleanupPopupHTML(sc, esc)) && /checked Oct 22, 2026/.test(HS.stateCleanupCardHTML(sc, esc)),
  'E2 popup and 3D card both carry it');
ok(HS.stateCleanupCheckedLine(HS.stateCleanupSite(ROW)) === '' && !/checked/.test(HS.stateCleanupPopupHTML(s, esc)),
  'E3 no date from the reader -> no checked line (never invented)');
ok(/Florida DEP site documents/.test(HS.stateCleanupPopupHTML(sc, esc)), 'E4 a link of its own says "site documents"');
const shared = HS.stateCleanupSite({ ...C2, record_url_sites: 74 });
ok(HS.stateCleanupLinkLabel(shared) === 'Florida DEP facility documents (74 cleanup sites here)'
  && /facility documents \(74 cleanup sites here\)/.test(HS.stateCleanupListHTML([shared], esc, 12)),
  'E5 a shared link says how many sites it covers, in the popup and the list', HS.stateCleanupLinkLabel(shared));
const home = HS.stateCleanupSite({ ...WA, name: 'Residential property', name_withheld: true });
ok(home.label === 'Residential property' && home.cleanup.name_withheld === true
  && /Residential property/.test(HS.stateCleanupPopupHTML(home, esc)), 'E6 a withheld name is shown as the reader sends it');
const A = { ...C2, site_key: 'a1', name: 'SITE A' }, B = { ...C2, site_key: 'b1', name: 'SITE B', category: 'OTHCU' },
      D = { ...C2, site_key: 'd1', name: 'SITE D', lat: 26.2, lng: -80.2 };
const pins = HS.stateCleanupSitesFrom({ status: 'complete', sites: [A, B, D] });
ok(pins.length === 2, 'E7 two sites at one point + one elsewhere -> two pins', pins.length);
const grp = pins[0];
ok(HS.stateCleanupGroupOf(grp).length === 2 && grp.label === '2 cleanup sites at this location'
  && grp.lat === A.lat && grp.lng === A.lng && grp.record_url === A.record_url && grp.zip_membership === 'member',
  'E8 the group pin keeps the point, a link and the member verdict');
ok(pins[1].label === 'SITE D' && !HS.stateCleanupGroupOf(pins[1]), 'E9 a lone site is unchanged');
ok(HS.stateCleanupMembers(pins).length === 3, 'E10 counts are of sites, not pins');
const lh = HS.stateCleanupListHTML(pins, esc, 12);
ok((lh.match(/class='rec'/g) || []).length === 3 && /SITE A/.test(lh) && /SITE B/.test(lh) && /SITE D/.test(lh),
  'E11 the list shows every site, not the pin');
const gp = HS.stateCleanupPopupHTML(grp, esc);
ok(/2 cleanup sites at this location/.test(gp) && /SITE A/.test(gp) && /SITE B/.test(gp) && /Other waste cleanup/.test(gp),
  'E12 the group popup lists each site with its own type line');
ok(HS.stateCleanupTitle(grp) === 'State cleanup sites: 2 at this location', 'E13 the group pin title');
const many = HS.stateCleanupSitesFrom({ status: 'complete', sites: Array.from({ length: 11 }, (_, i) => ({ ...C2, site_key: 'k' + i, name: 'S' + i })) });
ok(many.length === 1 && /The other 3 are in the State cleanup sites list/.test(HS.stateCleanupPopupHTML(many[0], esc)),
  'E14 a big group popup caps at 8 and points to the list');
ok(HS.zipModeSites([], null, [], pins).length === 2, 'E15 ZIP mode admits the group pin on its member verdict');
ok(/__HS_STATE_CLEANUP = \{[^}]*stateCleanupMembers\(cleanupSites\)\.length/.test(PAGE), 'E16 the published count is of sites');
ok(/HS\.stateCleanupCardHTML\(s, esc\)/.test(fn('infoCard3')), 'E17 the 3D card uses the shared card');

if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('ALL PASS');
