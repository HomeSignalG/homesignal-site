// THE ZIP DEVELOPMENT LISTS HOLD THE SAME PROJECTS MAP 1 DRAWS (2026-11-12).
// Run: node test/zip-development-map-parity.test.mjs
//
// THE DEFECT. Map 1 draws two planes for a ZIP: authoritative development records (app_projects)
// and the national data-centre plane (public.map1_dc_zip_members). The ZIP page
// (lib/community-page.js) and development.html read only the first, so a data centre drawn on the
// map as Proposed was missing from both lists and from the "Development projects" tile. Measured
// 2026-11-12 on 94612: Behring 415 20th Street Data Center (Compute Atlas, canonical entity
// e59b8d43-9ec7-436f-a180-378d1ecfbbec) is a 'member' drawn as Proposed; the lists held the 205
// app_projects rows only. lib/data.js nationalDataCenters() had been written for this and had no caller.
//
// THE FIX: one combiner, HS.data.zipDevelopment, used by both list pages. It decides nothing (the
// server's membership verdict and map_status), merges nothing across planes, keeps the
// authoritative geography verdict, and stamps every national row a third-party listing so no card
// can read it as an official application, approval or permit.
//
// This drives the SHIPPED lib/data.js and lib/templates.js against a stubbed client. The national
// fixture is the real 94612 row read from production on 2026-11-12.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (p) => readFileSync(join(root, p), 'utf8');
const exec = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|#)/.test(l)).join('\n');

// The production row (map1_dc_zip_members('94612'), 2026-11-12), verbatim.
const BEHRING = {
  lat: 37.8086782, lng: -122.267477, has_more: false, map_status: 'Proposed', raw_status: 'proposed',
  source_key: 'dc:e59b8d43-9ec7-436f-a180-378d1ecfbbec',
  source_url: 'https://www.kqed.org/news/12095308/developer-councilmember-say-proposed-oakland-data-center-isnt-what-you-might-think',
  distance_mi: null, source_name: 'Compute Atlas (Edward Kubiak)', last_seen_at: '2026-11-06T09:45:05.255227+00:00',
  project_name: 'Behring 415 20th Street Data Center (former LBNL supercomputing building)', project_type: 'datacenter',
  source_count: 1, location_text: '415 20th Street, Oakland, CA', quality_flags: ['PUBLISHER_APPROXIMATE', 'CORROBORATED_BY_DERIVED_ADDRESS'],
  source_licence: 'CC BY 4.0', zip_membership: 'member', normalized_status: 'proposed', publication_basis: 'canonical',
  location_precision: 'approximate_campus_area', canonical_entity_id: 'e59b8d43-9ec7-436f-a180-378d1ecfbbec',
  developer_or_operator: 'Behring Companies',
};
const NOT_MEMBER = Object.assign({}, BEHRING, { source_key: 'dc:other', project_name: 'Elsewhere DC', zip_membership: 'outside' });
const devRow = (id, status) => ({ id, name: 'Permit ' + id, status, record_url: 'https://city.example/r/' + id, lat: 37.81, lng: -122.27 });

function load(byRpc) {
  for (const m of ['../lib/data.js', '../lib/zip-authoritative.js', '../lib/project-type.js', '../lib/templates.js']) {
    delete require.cache[require.resolve(m)];
  }
  const sb = { rpc: async (name) => { const r = byRpc[name]; if (r instanceof Error) throw r; return r || { data: [], error: null }; } };
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

console.log('\n1. The list holds the authoritative rows AND the national member the map draws');
{
  const HS = load({
    app_projects_for_zip: { data: [devRow(1, 'Approved'), devRow(2, 'Proposed')], error: null },
    map1_dc_zip_members: { data: [BEHRING, NOT_MEMBER], error: null },
  });
  const r = await HS.data.zipDevelopment('94612', null);
  ok(r.length === 3, '1a 2 authoritative + 1 national member (the non-member is not listed)');
  const b = r.find((p) => p.id === BEHRING.source_key);
  ok(!!b, '1b Behring is in the list');
  ok(b && b.status === 'Proposed', '1c its status is the server\'s map_status, Proposed');
  ok(!r.some((p) => p.name === 'Elsewhere DC'), '1d a row the server did not call a member is excluded, as on Map 1');
  // The ZIP page's Proposed browsing filter, applied to the same rows.
  const proposed = r.filter((p) => p.status === 'Proposed' || p.status === 'Decided');
  ok(proposed.some((p) => p.id === BEHRING.source_key), '1e it lands in the Proposed list without any permit');
  ok(r.authoritative_count === 2 && r.national.count === 1 && r.national.complete === true, '1f counts carried for the tile');
  ok(r.complete === true && r.outcome === 'complete', '1g the geography verdict is the authoritative read\'s');
}

console.log('\n2. A third-party listing is never presented as an official filing');
{
  const HS = load({ app_projects_for_zip: { data: [devRow(1, 'Approved')], error: null }, map1_dc_zip_members: { data: [BEHRING], error: null } });
  const r = await HS.data.zipDevelopment('94612', null);
  const b = r.find((p) => p.id === BEHRING.source_key);
  const T = HS.tpl;
  ok(b.provenance_kind === 'third_party_listing' && b.provenance_source === 'Compute Atlas (Edward Kubiak)', '2a stamped third-party, with its publisher');
  ok(/Compute Atlas \(Edward Kubiak\), CC BY 4\.0, a third-party source/.test(b.sowhat), '2b the record line names the source and its licence');
  ok(/Not an official application, approval or permit; no official filing has been verified\./.test(b.sowhat), '2c and says it is not an official filing');
  ok(b.sowhat_factual === true, '2d labelled "On the record", never "How it impacts you"');
  ok(T.browsingStatusLabel(b) === 'Proposed · third-party listing', '2e the status label says whose word it is');
  const card = T.devCard(b);
  ok(card.includes('data-provenance="third_party_listing"') && card.includes(BEHRING.source_url), '2f the card opens the source\'s own page');
  ok(!/development\.html\?id=/.test(card), '2g it does not open a HomeSignal dossier (there is none for a listing)');
  ok(!/Application on file|[Pp]ermit issued|Approved/.test(card), '2h no application, approval or permit wording');
  const auth = r.find((p) => p.id === 1);
  ok(!T.isThirdPartyListing(auth) && T.browsingStatusLabel(auth) === 'Approved' && /development\.html\?id=1/.test(T.devCard(auth)), '2i an official record\'s card is unchanged');
}

console.log('\n2b. The card says whose word the status is and where its link goes (2026-11-14)');
{
  const UC = Object.assign({}, BEHRING, { source_key: 'dc:uc', map_status: 'Approved', raw_status: 'under_construction', normalized_status: 'under_construction' });
  const HS = load({ app_projects_for_zip: { data: [], error: null }, map1_dc_zip_members: { data: [BEHRING, UC], error: null } });
  const r = await HS.data.zipDevelopment('94612', null);
  const T = HS.tpl;
  const b = r.find((p) => p.id === BEHRING.source_key), u = r.find((p) => p.id === 'dc:uc');
  ok(T.browsingStatusLabel(u) === 'Approved · listed as under construction', '2b1 the map column and the source\'s own word, when they differ');
  ok(/^Listed as under construction by Compute Atlas/.test(u.sowhat), '2b2 the record line uses the source\'s word');
  ok(T.browsingStatusLabel(b) === 'Proposed · third-party listing', '2b3 the same word is not repeated');
  const card = T.devCard(b);
  ok(/Opens kqed\.org, the page Compute Atlas \(Edward Kubiak\) cites/.test(card), '2b4 the card names the host its link opens and that the source cites it');
  const off = T.linkNote({ record_url: 'https://city.example/r/1' }, 'https://city.example/r/1');
  ok(!/the page .* cites/.test(off), '2b5 an official record\'s link note is unchanged');
}

console.log('\n3. Failures are reported, never read as "none"');
{
  const HS = load({ app_projects_for_zip: { data: [devRow(1, 'Approved')], error: null }, map1_dc_zip_members: { data: null, error: { message: 'boom' } } });
  const r = await HS.data.zipDevelopment('94612', null);
  ok(r.length === 1 && r.national.complete === false, '3a a failed national read keeps the official rows and says it failed');
  const HS2 = load({ app_projects_for_zip: { data: { unavailable: true, zip_geography_status: 'not_measured', projects: null }, error: null }, map1_dc_zip_members: { data: [BEHRING], error: null } });
  const r2 = await HS2.data.zipDevelopment('94612', null);
  ok(r2.outcome === 'not_measured' && r2.complete === false, '3b an unmeasured authoritative read stays unmeasured (no absence claim is unlocked)');
  ok(r2.some((p) => p.id === BEHRING.source_key), '3c ... and the national member is still listed');
  const HS3 = load({ app_projects_for_zip: { data: [], error: null }, map1_dc_zip_members: new Error('network') });
  const r3 = await HS3.data.zipDevelopment('94612', null);
  ok(r3.national.complete === false && r3.national.plane.status === 'unavailable', '3d a thrown national read is caught and labelled unavailable');
}

console.log('\n4. Both list pages read the one combiner; no page re-decides membership or provenance');
{
  const cp = exec(read('lib/community-page.js'));
  const dv = exec(read('development.html'));
  ok(/HS\.data\.zipDevelopment\(zip, home\)/.test(cp), '4a the ZIP page reads zipDevelopment');
  ok(/HS\.data\.zipDevelopment\(S\.zip, home\)/.test(dv), '4b development.html reads zipDevelopment');
  ok(/metaCount\('development projects', authCount\) \+ natlCount/.test(cp), '4c the tile counts the listed national rows too');
  for (const [n, s] of [['community-page', cp], ['development.html', dv]]) {
    ok(!/zip_membership|map1_dc_zip_members|provenance_kind\s*=/.test(s), `4d ${n} decides neither membership nor provenance`);
  }
  ok(/isThirdPartyListing\(p\)/.test(dv), '4e development.html sends a listing to its source, not to a dossier');
  // Every page that lists a ZIP's development reads the combiner; a direct projects() call is
  // only the fallback beside it (2026-11-14).
  for (const f of ['lib/community-page.js', 'development.html', 'property.html', 'properties.html', 'index.html']) {
    const src = exec(read(f));
    const direct = (src.match(/HS\.data\.projects\(/g) || []).length;
    const combined = (src.match(/HS\.data\.zipDevelopment\(/g) || []).length;
    ok(combined >= 1 && direct <= combined, `4f ${f}: every ZIP list reads zipDevelopment (direct projects() only as its fallback)`, );
  }
  ok(/pickTopCards\(topProjects, 3\)/.test(cp), '4g the ZIP page picks its three cards with pickTopCards');
}

console.log('\n5. The official-portal register: states are facts about what was checked');
{
  const reg = JSON.parse(read('data/official-record-portals.json'));
  const DS = ['not_investigated', 'portal_found', 'automated_search_verified', 'manual_only', 'access_restricted', 'integrated'];
  const RC = ['not_verified', 'search_only', 'bulk_verified', 'integrated'];
  const DC = ['not_verified', 'not_public', 'public_verified'];
  const MR = ['matched', 'no_match_in_checked_sources', 'lookup_failed', 'not_researched'];
  ok(Array.isArray(reg.portals) && reg.portals.length > 0, '5a the register has entries');
  for (const p of reg.portals) {
    ok(DS.includes(p.discovery_state) && RC.includes(p.record_coverage) && DC.includes(p.document_coverage), `5b ${p.id}: every state is in its vocabulary`);
    ok(p.state && p.county && p.jurisdiction && /^https:\/\//.test((p.urls || {}).portal || ''), `5c ${p.id}: names its jurisdiction and an https portal`);
    ok((p.checks || []).length > 0 && p.checks.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && /^https:\/\//.test(c.url) && Number.isInteger(c.http) && c.finding),
      `5d ${p.id}: every check has a date, URL, HTTP status and finding`);
    ok(p.discovery_state !== 'integrated' || p.record_coverage === 'integrated', `5e ${p.id}: integrated only with integrated records`);
    ok(p.record_coverage !== 'bulk_verified' && p.record_coverage !== 'integrated' || p.discovery_state === 'integrated' || p.discovery_state === 'automated_search_verified',
      `5f ${p.id}: bulk coverage needs verified automation`);
    for (const m of p.project_matches || []) {
      ok(MR.includes(m.result), `5g ${p.id}: match result "${m.result}" is in its vocabulary`);
      ok(m.result === 'matched' ? /^https:\/\//.test(m.record_url || '') : !m.record_url, `5h ${p.id}: only a match carries a record link`);
    }
    ok(!/no (application|record)s? exists?|does not exist|no permits exist/i.test(JSON.stringify(p)), `5i ${p.id}: never claims that no record exists`);
  }
  const oak = reg.portals.find((p) => p.id === 'oakland-ca-accela');
  ok(oak && oak.document_coverage === 'not_verified' && oak.record_coverage === 'search_only', '5j Oakland: search verified, documents not verified');
  ok(oak && oak.project_matches.some((m) => /e59b8d43/.test(m.project) && m.result === 'no_match_in_checked_sources'),
    '5k Oakland: the Behring project carries no linked record (the leads found share no confirmed address)');
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL PASS');
