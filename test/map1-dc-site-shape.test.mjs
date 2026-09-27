// MAP 1 DATA-CENTRE PINS ARE DRAWN AS DATA CENTRES, IN THEIR OWN LIFECYCLE (2026-09-27).
//
// THE DEFECT. HS.map1DcSite (lib/data.js) turns each row of public.map1_dc_zip_members into a
// Map 1 site. It put the data-centre value in `type`, the lifecycle in `status` and the name in
// `name`. Map 1 classifies every site through HS.resolveTrackerMarker → HS.trackerSiteItem, which
// reads the Type from `use_type`, the name from `label`, and the lifecycle from `bucket` (then
// `type`, as a lifecycle word) — none of the fields the mapping filled. Measured on production
// 2026-09-27 over all 12,722 registry ZIPs: 1,816 of 1,816 rows on 757 ZIP pages drew as
// "Other project" + "Lifecycle unknown" with a blank name.
//
// WHY NO TEST SAW IT. The one positive control (facility-lifecycle-unknown 8q) called
// HS.resolveMarker(site) directly, which does read `type` and `status`. The page never takes that
// path. Every assertion here goes through HS.resolveTrackerMarker, the page's path.
//
// THE EVIDENCE. test/fixtures/map1-dc-zip-sample-2026-09-27.json holds 28 real rows from a
// deterministic ZIP sample, fingerprinted against production (§0 recomputes the md5), plus the
// production population grouped by the only fields the mapping reads.
//
// Run: node test/map1-dc-site-shape.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d === undefined ? '' : '  ' + JSON.stringify(d))); } };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|[^:"'\\])\/\/.*$/, '$1')).join('\n');

global.window = {
  HS: {}, HS_CONFIG: { DATA_SOURCE: 'supabase', DEFAULT_ZIP: '20187' },
  supabase: { createClient: () => ({}) },
};
await import('../lib/templates.js');
await import('../lib/project-type.js');
await import('../lib/map.js');
await import('../lib/zip-authoritative.js');
require('../lib/data.js');
const HS = global.window.HS;
ok(typeof HS.map1DcSite === 'function' && typeof HS.resolveTrackerMarker === 'function'
   && typeof HS.zipModeSites === 'function' && typeof HS.canonicalLifecycle === 'function',
  '0 the shipped mapping, the page resolver, the ZIP-mode door and the lifecycle vocabulary all load');

const FIX = JSON.parse(read('test/fixtures/map1-dc-zip-sample-2026-09-27.json'));
const EXPECT = { Operating: 'operating', Approved: 'approved', Proposed: 'proposed' };
// the page's own frsRid: a national data-centre row carries no EPA registry id
const frsRid = (s) => (s && s.registry_id) || '';
const page = (site) => HS.resolveTrackerMarker(site, frsRid);
// a COMPLETE authoritative payload, so HS.zipModeSites admits the national plane exactly as it
// does on a ZIP page with whole-ZIP geography
const AUTH = { zip: '00000', mode: 'development', status: 'boundary_complete', projects: [], markers: [] };

// ── §0 THE FIXTURE IS PRODUCTION ───────────────────────────────────────────────────────────
{
  const rows = FIX.rows.slice().sort((a, b) => (a.zip < b.zip ? -1 : a.zip > b.zip ? 1
    : a.source_key < b.source_key ? -1 : a.source_key > b.source_key ? 1 : 0));
  const text = rows.map((r) => [r.zip, r.source_key, r.map_status, r.project_type, r.project_name,
    r.publication_basis].join('|')).join('\n');
  const md5 = createHash('md5').update(text, 'utf8').digest('hex');
  ok(rows.length === FIX.fingerprint.n && md5 === FIX.fingerprint.md5,
    '§0a the fixture fingerprints to the production read (n=28, md5 1cb8a5cb…)', { n: rows.length, md5 });
  const zips = [...new Set(FIX.rows.map((r) => r.zip))].sort().join(',');
  ok(zips === '01040,01852,07033,20187,23150', '§0b the deterministic ZIP sample', zips);
  const groups = new Set(FIX.rows.map((r) => r.map_status + '|' + r.publication_basis));
  const popGroups = FIX.population.groups.map((g) => g.map_status + '|' + g.publication_basis);
  ok(popGroups.every((g) => groups.has(g)), '§0c the sample covers every (map_status, source basis) group in the population', [...groups]);
  const z20187 = FIX.rows.filter((r) => r.zip === '20187').map((r) => r.map_status).sort().join(',');
  ok(z20187 === 'Approved,Operating,Proposed,Proposed', '§0d ZIP 20187 carries all three published lifecycles', z20187);
}

// ── §1 EVERY SAMPLE ROW, ON THE PAGE'S PATH ────────────────────────────────────────────────
{
  const sites = FIX.rows.map(HS.map1DcSite);
  const admitted = HS.zipModeSites([], AUTH, sites);
  ok(admitted.length === sites.length, '§1a HS.zipModeSites admits every member row (the mapping keeps the verdict)',
    { admitted: admitted.length, rows: sites.length });
  const wrong = [];
  FIX.rows.forEach((r, i) => {
    const s = sites[i], mk = page(s), want = EXPECT[r.map_status];
    const why = [];
    if (mk.typeKey !== 'datacenter' || mk.categoryKey !== 'datacenter') why.push('type=' + mk.typeKey);
    if (mk.typeLabel !== 'Data center' || mk.legendLabel !== 'Data center') why.push('label=' + mk.typeLabel);
    if (mk.shape !== HS.CATEGORY_REGISTRY.datacenter.symbol) why.push('shape=' + mk.shape);
    if (mk.lifecycle !== want || mk.filterKey !== want) why.push('lifecycle=' + mk.lifecycle);
    if (JSON.stringify(mk.categories) !== '["datacenter"]') why.push('categories=' + mk.categories);
    if (mk.isFacility || mk.signal) why.push('facility');
    if (s.label !== r.project_name) why.push('name');
    if (mk.popupLabel.indexOf(r.project_name + ', Data center') !== 0) why.push('popup=' + mk.popupLabel);
    if (why.length) wrong.push(r.zip + ' ' + r.source_key + ': ' + why.join(' '));
  });
  ok(wrong.length === 0, '§1b all 28 rows: Data center octagon, lifecycle = map_status, the name, no regulatory overlay', wrong);
  // Expected counts are DERIVED from the fixture's own map_status (production), never typed here.
  const tally = {}, want = {};
  FIX.rows.forEach((r, i) => {
    const k = page(sites[i]).lifecycle; tally[k] = (tally[k] || 0) + 1;
    want[EXPECT[r.map_status]] = (want[EXPECT[r.map_status]] || 0) + 1;
  });
  ok(JSON.stringify(tally, Object.keys(want).sort()) === JSON.stringify(want, Object.keys(want).sort())
     && !tally.unknown && want.operating > 0 && want.approved > 0 && want.proposed > 0,
    '§1c the sample splits across all three lifecycles exactly as map_status does, 0 unknown', { tally, want });
  const t20187 = FIX.rows.filter((r) => r.zip === '20187')
    .map((r) => r.project_name + '=' + page(HS.map1DcSite(r)).typeKey + '/' + page(HS.map1DcSite(r)).lifecycle).sort();
  ok(JSON.stringify(t20187) === JSON.stringify([
    'Blackwell Road Data Center (Warrenton)=datacenter/approved',
    'CyrusOne Vint Hill Campus=datacenter/proposed',
    'OVH US East Vint Hill=datacenter/operating',
    'Vint Hill Corners=datacenter/proposed']), '§1d ZIP 20187, by name', t20187);
}

// ── §2 THE RAILS: bucketOf(s.type) WITH NO SITE, AND stageOf(s) ────────────────────────────
// homesignalmap.html builds its Approved/Proposed rails from bucketOf(s.type) — a bare {type}
// with no site — and stageOf(s) reads s.bucket first. Both must see the lifecycle.
{
  const wrong = [];
  FIX.rows.forEach((r) => {
    const s = HS.map1DcSite(r), want = EXPECT[r.map_status];
    const bare = HS.resolveTrackerMarker({ type: s.type }, () => '').lifecycle;
    if (bare !== want) wrong.push(r.source_key + ' bare type=' + bare);
    if (s.bucket !== want || s.type !== want) wrong.push(r.source_key + ' bucket=' + s.bucket + ' type=' + s.type);
  });
  ok(wrong.length === 0, '§2 every row: `bucket` and `type` carry the lifecycle, so the rails agree with the pin', wrong);
}

// ── §3 THE WHOLE PRODUCTION POPULATION ─────────────────────────────────────────────────────
// Grouped on production by (map_status, publication_basis, project_type), with project_name blank
// on 0 rows — the only inputs the mapping reads. Each group is driven through the shipped path.
{
  let total = 0, dc = 0, rightLife = 0, other = 0, unknown = 0;
  FIX.population.groups.forEach((g) => {
    const s = HS.map1DcSite({ source_key: 'k', source_url: 'https://e.x/r', project_name: 'Any Named Facility',
      map_status: g.map_status, project_type: g.project_type, publication_basis: g.publication_basis,
      zip_membership: 'member', lat: 1, lng: 1 });
    const mk = page(s);
    total += g.n;
    if (mk.typeKey === 'datacenter') dc += g.n;
    if (mk.lifecycle === EXPECT[g.map_status]) rightLife += g.n;
    if (mk.typeKey === 'other') other += g.n;
    if (mk.lifecycle === 'unknown') unknown += g.n;
  });
  ok(total === 1816 && FIX.population.rows === 1816 && FIX.population.zips === 757,
    '§3a the population is the measured one: 1,816 rows on 757 ZIP pages', { total });
  ok(dc === 1816 && rightLife === 1816, '§3b 1,816 of 1,816 draw as Data center in their own lifecycle', { dc, rightLife });
  ok(other === 0 && unknown === 0, '§3c 0 Other project, 0 Lifecycle unknown', { other, unknown });
}

// ── §4 IDENTITY, GEOGRAPHY AND SOURCE PASS THROUGH UNCHANGED ───────────────────────────────
// The fix maps fields; it decides nothing about which record this is, where it is, or which
// layer it came from. Every such field is the row's own value, byte for byte.
{
  const wrong = [];
  FIX.rows.forEach((r) => {
    const s = HS.map1DcSite(r);
    const pairs = [['id', r.source_key], ['source_key', r.source_key], ['canonical_entity_id', r.canonical_entity_id],
      ['publication_basis', r.publication_basis], ['zip_membership', r.zip_membership], ['lat', r.lat], ['lng', r.lng],
      ['record_url', r.source_url], ['url', r.source_url], ['source_name', r.source_name],
      ['source_licence', r.source_licence], ['location_precision', r.location_precision],
      ['name', r.project_name], ['status', r.map_status], ['normalized_status', r.normalized_status],
      ['raw_status', r.raw_status], ['scope', 'point'], ['relevance', 'development'], ['record_kind', 'national_project']];
    pairs.forEach(([k, v]) => { if (s[k] !== v) wrong.push(r.source_key + ' ' + k); });
    if (JSON.stringify(s.quality_flags) !== JSON.stringify(r.quality_flags)) wrong.push(r.source_key + ' quality_flags');
    // Fields that would change behaviour beyond the mapping: registry_id makes a row an EPA
    // facility; source_id / zip_project_ref / n5_source_key / project_ref make it a capture target
    // or collapse rail rows (dedupe); layer / type_raw / permit_class / src / decision feed other
    // classifiers. None may appear.
    ['registry_id', 'source_id', 'zip_project_ref', 'n5_source_key', 'project_ref', 'layer',
     'type_raw', 'permit_class', 'src', 'decision', 'decision_evidence'].forEach((k) => {
      if (s[k] !== undefined) wrong.push(r.source_key + ' gained ' + k);
    });
  });
  ok(wrong.length === 0, '§4 identity, geography, membership, source and licence are the row\'s own values, and no identity/dedupe field is added', wrong);
  const osm = FIX.rows.filter((r) => r.publication_basis === 'legacy_osm_compat').map(HS.map1DcSite);
  ok(osm.length > 0 && osm.every((s) => s.canonical_entity_id === null && /^osm:/.test(s.source_key)),
    '§4b OSM compatibility rows stay OSM: no canonical id, osm: keys, their own licence', osm.length);
}

// ── §5 SILENCE STAYS SILENCE ───────────────────────────────────────────────────────────────
{
  const base = { source_key: 'dc:x', source_url: 'https://e.x/r', project_name: 'Unstated Campus',
    project_type: 'datacenter', zip_membership: 'member', lat: 1, lng: 1 };
  const unk = page(HS.map1DcSite(Object.assign({}, base, { map_status: 'Unknown' })));
  ok(unk.typeKey === 'datacenter' && unk.lifecycle === 'unknown',
    '§5a map_status Unknown (the contract\'s word for "no source states a lifecycle") stays Lifecycle unknown, still a Data center');
  const odd = HS.map1DcSite(Object.assign({}, base, { map_status: 'Cancelled' }));
  ok(odd.bucket === 'unknown' && page(odd).lifecycle === 'unknown', '§5b an unrecognised status is unknown, never a guessed stage');
  const D = read('lib/data.js');
  const body = D.slice(D.indexOf('HS.map1DcSite = function'), D.indexOf('HS.map1DcCredits'));
  const bare = {};
  new Function('HS', body)(bare);
  ok(bare.map1DcSite(Object.assign({}, base, { map_status: 'Operating' })).bucket === 'unknown',
    '§5c with the lifecycle vocabulary absent the mapping says unknown — it never invents one');
  const noType = page(HS.map1DcSite(Object.assign({}, base, { project_type: null, project_name: 'Riverside Campus', map_status: 'Operating' })));
  ok(noType.typeKey === 'other' && noType.lifecycle === 'operating',
    '§5d the Type is the server\'s project_type: a row without one is not labelled a data centre by the page', noType.typeKey);
}

// ── §6 NEGATIVE CONTROL: THE OLD SHAPE FAILS THESE CHECKS ─────────────────────────────────
// The pre-2026-09-27 mapping, field for field. If §1 could not fail on it, §1 would prove nothing.
{
  const old = (r) => ({ id: r.source_key, name: r.project_name, status: r.map_status,
    normalized_status: r.normalized_status, raw_status: r.raw_status, type: 'datacenter',
    record_kind: 'national_project', lat: r.lat, lng: r.lng, scope: 'point', record_url: r.source_url,
    url: r.source_url, source_key: r.source_key, zip_membership: r.zip_membership, relevance: 'development' });
  const res = FIX.rows.map((r) => page(old(r)));
  ok(res.every((m) => m.typeKey === 'other' && m.lifecycle === 'unknown'),
    '§6 the old shape draws every sample row as Other project / Lifecycle unknown on the page path (the defect, reproduced)',
    res.map((m) => m.typeKey + '/' + m.lifecycle).slice(0, 3));
}

// ── §7 STRUCTURE ───────────────────────────────────────────────────────────────────────────
{
  const D = stripJs(read('lib/data.js'));
  const body = D.slice(D.indexOf('HS.map1DcSite = function'), D.indexOf('HS.map1DcCredits'));
  ok(body.length > 200 && /use_type:\s*r\.project_type/.test(body) && /label:\s*r\.project_name/.test(body)
     && /bucket:\s*bucket,\s*type:\s*bucket/.test(body),
    '§7a the mapping fills the fields the page classifies from: use_type, label, bucket and type');
  ok(/HS\.canonicalLifecycle\(\{\s*status:\s*r\.map_status\s*\}\)/.test(body),
    '§7b the lifecycle comes from map_status through the ONE lifecycle vocabulary');
  ok(!/type:\s*'datacenter'/.test(body) && !/normalized_status\s*\)/.test(body),
    '§7c no Type literal in the lifecycle slot, and the lifecycle is not re-derived from normalized_status');
  const P = stripJs(read('homesignalmap.html'));
  ok((P.match(/\.map\(HS\.map1DcSite\)/g) || []).length === 1 && /resolveTrackerMarker/.test(P),
    '§7d the page maps the contract rows through HS.map1DcSite once and classifies through resolveTrackerMarker');
  // The mapping fails closed to `unknown` when the lifecycle vocabulary is absent (§5c). That is
  // right for a missing script, and it would silently recreate this defect — so every shipped page
  // that calls the mapping must also load lib/project-type.js.
  const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const callers = pages.filter((f) => /HS\.map1DcSite/.test(stripJs(read(f))));
  const missing = callers.filter((f) => !/<script[^>]+src="\/?lib\/project-type\.js/.test(read(f)));
  ok(callers.length >= 1 && callers.includes('homesignalmap.html') && missing.length === 0,
    '§7e every page that maps contract rows loads the lifecycle vocabulary', { callers, missing });
}

console.log(`\n${n - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
