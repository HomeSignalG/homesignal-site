// DATA-CENTER LISTINGS IN THE PRE-BUILT ZIP DOCUMENT (2026-11-14).
//
// The live ZIP page lists Map 1's data-center listings (lib/data.js HS.data.zipDevelopment); the
// document the build writes at /community/<zip>/ now prints them too, from the per-ZIP rows
// docs/zip-dc-listing.sql stores (map1_dc_zip_members' own 'member' rows).
//   1. The same rows give the same words in the browser and in the build: the status label, the
//      third-party note and the "Opens <host>, the page <source> cites" note.
//   2. A real build: fresh rows print, stale / truncated / missing rows print nothing, nothing ever
//      says "no data centers", the list is capped with a map link, and the live proof's Alerts
//      counter does not count the section.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

// The production row (map1_dc_zip_members('94612'), 2026-11-12), and variants of it.
const BEHRING = {
  lat: 37.8086782, lng: -122.267477, has_more: false, map_status: 'Proposed', raw_status: 'proposed',
  source_key: 'dc:e59b8d43-9ec7-436f-a180-378d1ecfbbec',
  source_url: 'https://www.kqed.org/news/12095308/developer-councilmember-say-proposed-oakland-data-center-isnt-what-you-might-think',
  distance_mi: null, source_name: 'Compute Atlas (Edward Kubiak)', last_seen_at: '2026-11-06T09:45:05.255227+00:00',
  project_name: 'Behring 415 20th Street Data Center (former LBNL supercomputing building)', project_type: 'datacenter',
  source_count: 1, location_text: '415 20th Street, Oakland, CA', quality_flags: ['PUBLISHER_APPROXIMATE'],
  source_licence: 'CC BY 4.0', zip_membership: 'member', normalized_status: 'proposed', publication_basis: 'canonical',
  location_precision: 'approximate_campus_area', canonical_entity_id: 'e59b8d43-9ec7-436f-a180-378d1ecfbbec',
  developer_or_operator: 'Behring Companies',
};
const ROWS = [
  BEHRING,
  Object.assign({}, BEHRING, { source_key: 'dc:b', project_name: 'Builder Site', map_status: 'Approved',
    raw_status: 'under_construction', normalized_status: 'under_construction', source_url: 'https://news.example.org/a' }),
  Object.assign({}, BEHRING, { source_key: 'osm:c', project_name: 'Quiet Hall', map_status: 'Operating',
    raw_status: 'operating', normalized_status: 'operating', source_name: 'OpenStreetMap', source_licence: 'ODbL',
    developer_or_operator: null, source_url: 'https://www.openstreetmap.org/way/1' }),
  Object.assign({}, BEHRING, { source_key: 'dc:d', project_name: 'No Word', map_status: 'Operating',
    raw_status: null, normalized_status: null, source_licence: null, developer_or_operator: null,
    source_url: 'https://Example.COM/x' }),
];
// What docs/zip-dc-listing.sql stores per row.
const STORED = (r) => ({
  source_key: r.source_key, source_name: r.source_name, source_url: r.source_url, source_licence: r.source_licence,
  project_name: r.project_name, developer_or_operator: r.developer_or_operator, raw_status: r.raw_status,
  normalized_status: r.normalized_status, map_status: r.map_status, project_type: r.project_type,
});

// ---- 1. one set of words ------------------------------------------------------------------
function loadHS() {
  for (const m of ['../lib/data.js', '../lib/zip-authoritative.js', '../lib/project-type.js', '../lib/templates.js']) {
    delete require.cache[require.resolve(m)];
  }
  const sb = { rpc: async (name) => name === 'map1_dc_zip_members' ? { data: ROWS, error: null } : { data: [], error: null } };
  global.window = {
    HS_CONFIG: { DATA_SOURCE: 'supabase', DEFAULT_ZIP: '94612' },
    HS: { state: { session: null, zip: '94612' } },
    supabase: { createClient: () => sb },
  };
  global.document = undefined;
  require('../lib/project-type.js');
  require('../lib/templates.js');
  require('../lib/zip-authoritative.js');
  require('../lib/data.js');
  return global.window.HS;
}
const HS = loadHS();
const list = await HS.data.zipDevelopment('94612', null);
const listed = list.filter((p) => HS.tpl.isThirdPartyListing(p));
ok(listed.length === ROWS.length, `the browser path lists all ${ROWS.length} rows (${listed.length})`);
const text = (h) => String(h || '').replace(/<span aria-hidden="true">[^<]*<\/span>/g, '')
  .replace(/<span class="sr-only">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '').trim();

const py = JSON.parse(execFileSync('python3', ['-c',
  'import json,sys; sys.path.insert(0,"scripts"); import gen_zip_pages as g;'
  + 'rows=json.loads(sys.argv[1]);'
  + 'print(json.dumps([[g.listing_status_label(x), g.listing_note(x), g.listing_link_note(x, g.safe_url(x["source_url"]))] for x in rows]))',
  JSON.stringify(ROWS.map(STORED))], { cwd: root, encoding: 'utf8' }));

ROWS.forEach((r, i) => {
  const p = listed.find((x) => x.source_key === r.source_key) || {};
  const js = [HS.tpl.browsingStatusLabel(p), HS.tpl.thirdPartyListingNote(p), text(HS.tpl.listingLinkNote(p, r.source_url))];
  ok(js[0] === py[i][0], `[${r.project_name}] status label: js ${JSON.stringify(js[0])} = py ${JSON.stringify(py[i][0])}`);
  ok(js[1] === py[i][1], `[${r.project_name}] third-party note matches (${JSON.stringify(py[i][1]).slice(0, 70)}…)`);
  ok(js[2] === py[i][2], `[${r.project_name}] link note: js ${JSON.stringify(js[2])} = py ${JSON.stringify(py[i][2])}`);
});
ok(py[0][0] === 'Proposed · third-party listing' && py[1][0] === 'Approved · listed as under construction',
  'the label keeps the map column and adds the source word only when it differs');
ok(py[0][2] === 'Opens kqed.org, the page Compute Atlas (Edward Kubiak) cites', 'Behring opens kqed.org, named as what Compute Atlas cites');

// ---- 2. a real build -----------------------------------------------------------------------
const NOW = '2026-11-14T12:00:00';
const zipsAll = ['94612', '94607', '94608', '94609', '94610'];
const communities = [{ id: 'r', name: 'Alameda County', level: 'county', parent_id: null, zip_codes: zipsAll },
  ...zipsAll.map((z) => ({ id: 'z' + z, name: 'Oakland (' + z + ')', level: 'zip', parent_id: 'r', zip_codes: [z] }))];
const meta = zipsAll.map((z) => ({ zip: z, name: 'Oakland (' + z + ')', county: 'Alameda', state: 'CA', data_quality: 'pass', indexable: true }));
const many = Array.from({ length: 15 }, (_, k) => STORED(Object.assign({}, BEHRING, {
  source_key: 'dc:m' + String(k).padStart(2, '0'), project_name: 'Hall ' + String(k).padStart(2, '0') + ' <&>',
  map_status: k < 2 ? 'Proposed' : 'Operating', raw_status: k < 2 ? 'proposed' : 'operating' })));
const row = (zip, listings, extra = {}) => Object.assign({ zip, listings, member_count: listings.length, truncated: false,
  checked_at: '2026-11-14T10:00:00+00:00' }, extra);
const FIX = { zips: zipsAll, meta, changes: [], agency: [], retractions: [], communities, meetings: [],
  dc_listings: [
    row('94612', ROWS.map(STORED)),
    row('94607', many),
    row('94608', ROWS.map(STORED), { checked_at: '2026-11-11T10:00:00+00:00' }),   // 74h old
    row('94609', ROWS.map(STORED), { truncated: true }),
  ] };
const dir = mkdtempSync(join(tmpdir(), 'zdcl-'));
const build = (fix, out) => {
  writeFileSync(join(dir, out + '.json'), JSON.stringify(fix));
  return execFileSync('python3', [GEN, '--fixture', join(dir, out + '.json'), '--out', join(dir, out), '--now', NOW, '--allow-missing-dev-plane'],
    { cwd: root, encoding: 'utf8' });
};
try {
  const log = build(FIX, 'o');
  const doc = (z) => readFileSync(join(dir, 'o', 'community', z, 'index.html'), 'utf8');
  ok(/data-center listings: 2 ZIP pages, 1 skipped as older than 48h, 1 skipped as truncated/.test(log),
    'the build log counts used, stale and truncated rows');
  const d1 = doc('94612');
  ok(d1.includes('<h2>Data-center listings</h2>'), '94612 prints the Data-center listings section');
  ok(d1.includes('Behring 415 20th Street Data Center (former LBNL supercomputing building)'), '94612 names Behring');
  ok(d1.includes('href="' + BEHRING.source_url + '" rel="nofollow noopener"'), 'Behring links to the page its source cites');
  ok(d1.includes('Proposed · third-party listing') && d1.includes('Approved · listed as under construction'), 'status labels as the live page');
  ok(d1.includes('Not an official application, approval or permit'), 'each listing says it is not an official filing');
  ok(d1.indexOf('Behring 415') < d1.indexOf('Builder Site') && d1.indexOf('Builder Site') < d1.indexOf('No Word'),
    'listings are ordered Proposed, Approved, Operating');
  const m = (h) => (h.match(/<section class="zsec"><h2>[^<]+<\/h2><ul>/g) || []).length;
  const zdcl = /<section class="zsec zdcl"><h2>Data-center listings<\/h2><p/.test(d1);
  ok(zdcl && m(d1) === m(doc('94610')), 'the live proof\'s Alerts counter does not count the listings section');
  const d2 = doc('94607');
  ok((d2.match(/<li><a href="https:\/\/www\.kqed\.org/g) || []).length === 12, '94607 prints 12 of 15 listings');
  ok(d2.includes('href="/map/94607/">3 more data-center listings on the development map for 94607</a>'), 'the rest are named, with a map link');
  ok(d2.includes('Hall 00 &lt;&amp;&gt;') && !d2.includes('Hall 00 <&>'), 'names are escaped');
  for (const z of ['94608', '94609', '94610']) {
    ok(!doc(z).includes('Data-center listings'), `${z} prints no listings section (stale, truncated or none)`);
  }
  ok(!/no data[- ]cent(er|re)s?/i.test(zipsAll.map(doc).join('')), 'no page says there are no data centers');

  // Without the table (fetch_dc_listings returns None) nothing changes.
  const FIX0 = Object.assign({}, FIX); delete FIX0.dc_listings;
  build(FIX0, 'p');
  const same = zipsAll.every((z) => !readFileSync(join(dir, 'p', 'community', z, 'index.html'), 'utf8').includes('Data-center listings'));
  ok(same, 'a build with no listings data prints no section');
  // Stable: rebuilding the same input gives byte-identical documents.
  build(FIX, 'q');
  ok(zipsAll.every((z) => readFileSync(join(dir, 'q', 'community', z, 'index.html'), 'utf8') === doc(z)), 'the documents are byte-identical across two builds');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
