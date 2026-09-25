#!/usr/bin/env node
// REGISTRATION IS NOT OPERATION — the unsourced EPA "Operating" is gone (2026-09-24).
//
// EPA FRS returns no lifecycle field. Every surface nevertheless asserted "Operating" for every
// EPA facility, from SEVEN places: the producer's type:"built" stamp, app_refresh_zip's literal
// status, resolveMarker's three hard-coded lifecycle:'operating' branches, the Map 1 popup's
// "operating now", Map 1's "Operating now" rail (which appended every facility), the ZIP card
// literal and the facility detail literal. They now all read ONE canonical decision —
// trackerSiteItem (what counts as evidence) → statusTier (proposed|approved|operating|unknown) —
// and a facility with no sourced lifecycle is `unknown`.
//
// THE HARD GATE (founder, 2026-09-24): UNSUPPORTED OPERATING → UNKNOWN, never → another inferred
// status. EPA program/permit statuses (Effective, Terminated, Admin Continued, Permanently Closed,
// discontinued reporting) are REGULATORY evidence about a program, preserved verbatim; they are NOT
// mapped to a physical lifecycle here, and there is no Closed lifecycle to map them to.
//
//   §1  EPA membership alone cannot yield Operating (all three facility identities)
//   §2  no lifecycle evidence → canonical unknown (both item shapes)
//   §3  regulatory statuses do not become lifecycle (Effective / Terminated / Admin Continued / …)
//   §4  Cromby (ICIS-Air "Permanently Closed") — NOT Operating and NOT Closed
//   §5  A.C. Miller (both 19475 records) — unknown
//   §6  Type, R, categories and filter membership unchanged
//   §7  the four visible surfaces carry no facility "Operating" assertion
//   §8  development lifecycle unchanged; a SOURCED status still flows (positive control)
//   §9  one authority — no second lifecycle classifier
//   §10 the database splice changes the status token and nothing else
//
// Run: node test/facility-lifecycle-unknown.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let failures = 0;
const ok = (c, name, detail) => {
  if (c) console.log('PASS — ' + name);
  else { failures++; console.error('FAIL — ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
};
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function load(files, HS0) {
  const win = { HS: HS0 || {} };
  for (const f of files) new Function('window', 'document', read(f))(win, undefined);
  return win.HS;
}
const HS = load(['lib/project-type.js', 'lib/map.js', 'lib/templates.js']);
const frs = (s) => (s && s.registry_id != null) ? String(s.registry_id).trim() : '';
const LC = HS.LIFECYCLE_HEX;

// The committed EPA evidence: program rows extracted in-database from the live ECHO reports.
const FX_PATH = 'fixtures/epa/zip19475-dfr-programs-2026-09-24.json';
const FX_RAW = readFileSync(join(root, FX_PATH));
const FX = JSON.parse(FX_RAW.toString('utf8'));
ok(createHash('md5').update(FX_RAW).digest('hex') === 'd9354fad995a296216132caac64075f4',
  '0a the EPA fixture is byte-identical to the in-database extraction (md5 d9354fad…)');
const byRid = Object.fromEntries(FX.facilities.map((f) => [f.registry_id, f]));
ok(['110000584868', '110070275643', '110070105263'].every((r) => byRid[r]),
  '0b the fixture carries Cromby and both A.C. Miller records');

// A cached development_reports FRS element exactly as the old producer wrote it (type:'built'),
// and the same element as the producer writes it now (no type at all).
const cached = (o) => Object.assign({ scope: 'point', type: 'built', src: 'EPA FRS', record_url: 'https://echo.epa.gov/x' }, o);
const fresh = (o) => { const s = cached(o); delete s.type; return s; };

// ── §1 EPA membership alone cannot yield Operating ────────────────────────────────────────
const identities = [
  ['dual', { label: 'X DATA CENTER', layer: 'datacenter', registry_id: '110000000001' }],
  ['overlay', { label: 'ANDURIL INDUSTRIES', layer: 'industrial', registry_id: '110000000002' }],
  ['plain', { label: 'GENERIC EPA SITE', registry_id: '110000000003' }]
];
for (const [kind, base] of identities) {
  for (const [shape, s] of [['cached type:built', cached(base)], ['fresh no-type', fresh(base)]]) {
    // Both call shapes Map 1 uses: the real rid function, and bucketOf()'s empty one.
    const a = HS.resolveTrackerMarker(s, frs);
    const b = HS.resolveTrackerMarker(s, () => '');
    ok(a.lifecycle === 'unknown' && b.lifecycle === 'unknown' && a.lifecycle !== 'operating',
      `1 ${kind} facility, ${shape}: lifecycle unknown on both call shapes`, a.lifecycle + '/' + b.lifecycle);
  }
}
ok(HS.trackerSiteItem(cached(identities[1][1]), () => '').lifecycleBucket === 'unknown'
   && HS.trackerSiteItem(cached(identities[1][1]), () => '').status === 'Unknown',
  '1d the evidence rule refuses the stamp even when the caller passes an EMPTY rid function (bucketOf)');

// ── §2 no lifecycle evidence → canonical unknown ──────────────────────────────────────────
for (const st of ['On file', undefined, '', 'Unknown']) {
  const m = HS.resolveMarker({ record_kind: 'facility', _facility: true, type: 'industrial', name: 'X', status: st });
  ok(m.lifecycle === 'unknown' && m.lifecycleLabel === 'Lifecycle unknown',
    `2 an app_projects facility with status ${JSON.stringify(st)} resolves to canonical unknown`, m.lifecycle);
}
ok(JSON.stringify(HS.LIFECYCLE_KEYS) === JSON.stringify(['proposed', 'approved', 'operating', 'unknown']),
  '2e the canonical contract is unchanged: four keys, no Closed');

// ── §3 regulatory statuses are not lifecycle ─────────────────────────────────────────────
const REGULATORY = ['Effective', 'Terminated', 'Retired', 'Admin Continued', 'Expired', 'Not Needed',
  'Permanently Closed', 'Inactive (     )', 'Active (H    )', 'Last Reported for 2012',
  'Reporting Year 2023:  Emitter Last Reported in 2013 - Discontinued reporting with a valid reason.'];
for (const ps of REGULATORY) {
  const site = cached({ label: 'SITE', layer: 'industrial', registry_id: '110000000009',
    env: { link_type: 'geo_matched', epa: { permit_status: ps, permits: [{ status: ps, statute: 'CWA' }] } } });
  const row = { record_kind: 'facility', _facility: true, type: 'industrial', name: 'SITE', status: 'On file',
    facility_env: { epa: { permit_status: ps, permits: [{ status: ps }] } } };
  const a = HS.resolveTrackerMarker(site, frs), b = HS.resolveMarker(row);
  ok(a.lifecycle === 'unknown' && b.lifecycle === 'unknown',
    `3 regulatory status ${JSON.stringify(ps)} does not become a lifecycle (neither operating nor closed)`, a.lifecycle + '/' + b.lifecycle);
}

// ── §4 Cromby Generating Station — the adversarial case ──────────────────────────────────
const cromby = byRid['110000584868'];
const prog = (sys) => cromby.programs.filter((p) => p.EPASystem === sys).map((p) => p.FacilityStatus);
ok(prog('ICIS-Air').includes('Permanently Closed')
   && cromby.programs.some((p) => p.EPASystem === 'ICIS-NPDES' && p.FacilityName === 'FORMER CROMBY GENERATING STATION' && p.FacilityStatus === 'Effective')
   && prog('TRI').includes('Last Reported for 2012')
   && prog('GHGRP').some((x) => /Last Reported in 2013 - Discontinued reporting/.test(x)),
  '4a the fixture holds the contradicting EPA facts verbatim (Permanently Closed · FORMER … · TRI 2012 · GHGRP 2013)');
{
  // Cromby as it sits in production: app_projects type 'energy', and as a cached FRS element,
  // carrying every one of its EPA program statuses beside it.
  const env = { link_type: 'geo_matched', epa: { permit_status: 'Effective',
    permits: [{ type: 'NPDES Individual Permit', status: 'Effective', statute: 'CWA', npdes_id: 'PA0011631' }],
    programs: cromby.programs } };
  const site = cached({ label: 'CROMBY GENERATING STATION', layer: 'energy', registry_id: '110000584868', env });
  const row = { record_kind: 'facility', _facility: true, type: 'energy', name: 'CROMBY GENERATING STATION',
    status: 'On file', registry_id: '110000584868', facility_env: env };
  const pin = HS.resolveTrackerMarker(site, frs), card = HS.resolveMarker(row);
  ok(pin.lifecycle !== 'operating' && card.lifecycle !== 'operating',
    '4b Cromby is NOT Operating (pin and stored row)', pin.lifecycle + '/' + card.lifecycle);
  ok(pin.lifecycle === 'unknown' && card.lifecycle === 'unknown' && !/clos/i.test(pin.lifecycleLabel + card.lifecycleLabel),
    '4c Cromby is NOT inferred Closed either — the canonical result is unknown', pin.lifecycleLabel);
  ok(pin.categoryKey === 'infrastructure' && card.categoryKey === 'infrastructure'
     && HS.canonicalFacilityType(row).label === 'Roads & infrastructure' && pin.signal && pin.signal.letter === 'R',
    '4d Cromby keeps its canonical Type (Roads & infrastructure) and its R');
  ok(JSON.stringify(row.facility_env.epa.programs) === JSON.stringify(cromby.programs),
    '4e resolving the marker does not touch or drop the EPA facts it carries');
}

// ── §5 A.C. Miller, both records in 19475 ─────────────────────────────────────────────────
for (const rid of ['110070275643', '110070105263']) {
  const f = byRid[rid];
  const name = f.programs.find((p) => p.EPASystem === 'FRS').FacilityName;
  const site = cached({ label: name, layer: 'industrial', registry_id: rid });
  const row = { record_kind: 'facility', _facility: true, type: 'industrial', name, status: 'On file', registry_id: rid };
  const pin = HS.resolveTrackerMarker(site, frs), card = HS.resolveMarker(row);
  ok(pin.lifecycle === 'unknown' && card.lifecycle === 'unknown' && pin.categoryKey === 'industrial'
     && HS.canonicalFacilityType(row).label === 'Industrial' && pin.signal && pin.signal.letter === 'R',
    `5 ${name}: lifecycle unknown, Type Industrial, R kept`);
}
ok(byRid['110070105263'].programs.some((p) => p.EPASystem === 'ICIS-NPDES' && p.FacilityStatus === 'Effective'),
  '5c the Spring City plant\'s Effective NPDES permit is in the evidence — and §5 still reads unknown');

// ── §6 Type, R, categories, filter membership unchanged ──────────────────────────────────
for (const [kind, base] of identities) {
  const now = HS.resolveTrackerMarker(cached(base), frs);
  const want = { dual: ['datacenter', 'octagon', ['datacenter', 'facility'], 'R'],
                 overlay: ['industrial', 'triangle', ['industrial', 'facility'], 'R'],
                 plain: ['facility', 'square', ['facility'], null] }[kind];
  ok(now.categoryKey === want[0] && now.shape === want[1] && JSON.stringify(now.categories) === JSON.stringify(want[2])
     && (now.signal ? now.signal.letter : null) === want[3] && now.filterKey === 'facility' && now.statusKey === 'facility',
    `6 ${kind}: Type ${want[0]}, shape ${want[1]}, categories, R and filterKey unchanged`, now.categoryKey + ' ' + now.shape);
}
{
  const plain = HS.resolveTrackerMarker(cached(identities[2][1]), frs);
  ok(plain.color === HS.markerRegistry.facilityHex, '6d the plain facility square keeps the facility purple');
  const ov = HS.resolveTrackerMarker(cached(identities[1][1]), frs);
  ok(ov.color === LC.unknown && ov.color !== LC.operating, '6e a Type-overlay facility takes the EXISTING unknown colour — no new colour');
  ok((HS.STATUS_LEGEND_ROWS || []).some((r) => r.key === 'unknown'),
    '6f "unknown" is an existing legend row, so the Map 1 stage filter shows these pins by default');
}

// ── §7 the visible surfaces ──────────────────────────────────────────────────────────────
const PAGE = read('homesignalmap.html');
const kl = PAGE.slice(PAGE.indexOf('function kindLabel(s){'), PAGE.indexOf('var MARKER_TITLE_STAGE'));
ok(kl.length > 200 && !/operating now/i.test(code(kl)) && /mk\.lifecycleLabel/.test(kl),
  '7a Map 1 popup: no "operating now" literal; the facility line reads the resolver\'s lifecycleLabel');
ok(/var points = permits\.concat\(fac\);/.test(PAGE)
   && /var builtRows = points\.filter\(function\(s\)\{ return bucketOf\(s\.type, s\)==="operating"; \}\);/.test(PAGE)
   && !/builtRows = [^;]*\.concat\(fac\);/.test(code(PAGE)),
  '7b Map 1 "Operating now" rail: facilities pass the same lifecycle test, never appended unconditionally');
ok(!/EPA-registered facilities and completed construction filings/.test(PAGE) && !/No EPA-registered facility on record here/.test(PAGE),
  '7c the rail no longer tells a resident that EPA facilities are "standing today"');
ok(/function stageOf\(s\)\{[^}]*bucketOf\(s && s\.type, s\)/.test(PAGE),
  '7d stageOf passes the SITE, so a cached FRS stamp cannot re-enter through the marker title');
// 7e/7f — THE ZIP PAGE NO LONGER DRAWS FACILITY CARDS (founder decision, 2026-09-25: static
// regulatory inventory is not a "What's changing" item). What these checks protected — no literal
// "Operating" on an EPA facility — is now true by absence on the ZIP page, and the lifecycle
// itself is still decided by the one authority (HS.canonicalLifecycle), pinned here directly.
const RT = code(read('lib/community-page.js'));
ok(/HS\.tpl\.statTile\(facTotal, 'Regulated facilities', ''\)/.test(RT)
   && !/facilities\.slice\(0,6\)\.map/.test(RT) && !/HS\.fac(LifecycleLabel|TypeBadge)/.test(RT),
  '7e ZIP page: positive control (the runtime is the one with the facility summary tile), and it renders no facility card that could carry a lifecycle word');
{
  const cromby = { name: 'CROMBY GENERATING STATION', type: 'energy', status: 'On file', record_kind: 'facility',
    source_ref: 'https://echo.epa.gov/x' };
  ok(HS.canonicalLifecycle(cromby).label === 'Lifecycle unknown' && HS.canonicalLifecycle(cromby).key === 'unknown'
     && HS.canonicalFacilityType(cromby).label === 'Roads & infrastructure',
    '7f Cromby at the shared authority: "Lifecycle unknown", Type Roads & infrastructure — never Operating');
}
const DEV = read('development.html');
const hdr = DEV.slice(DEV.indexOf('Regulated facility <span class="status'), DEV.indexOf('Regulated facility <span class="status') + 300);
ok(hdr.length > 50 && !/>Operating</.test(hdr) && !/status active/.test(hdr) && /HS\.canonicalLifecycle\(f\)\.label/.test(hdr),
  '7g facility detail: no literal "Operating", no operating colour class; the pill prints the stored status in the shared vocabulary');
ok(!/An existing regulated facility/.test(DEV), '7h facility detail no longer calls the facility "existing"');
const PRODUCER = read('supabase/functions/get-address-report/index.ts');
const push = code(PRODUCER).match(/kept\.push\(\{ label: name,[^\n]*\}\);/);
ok(push && !/\btype:/.test(push[0]) && /registry_id: rid/.test(push[0]) && /layer: classifyLayer\(name\)/.test(push[0]),
  '7i the producer emits the FRS element with its identity fields and NO lifecycle `type`', push && push[0].slice(0, 120));

// ── §8 development unchanged; a sourced status still flows ───────────────────────────────
const devCases = [['built', 'operating'], ['operating', 'operating'], ['approved', 'approved'], ['proposed', 'proposed'], ['', 'unknown']];
for (const [t, want] of devCases) {
  const s = { scope: 'point', relevance: 'development', label: 'P', use_type: 'Industrial', layer: 'industrial', type: t };
  ok(HS.resolveTrackerMarker(s, frs).lifecycle === want && HS.resolveTrackerMarker(s, () => '').lifecycle === want,
    `8 development site type ${JSON.stringify(t)} still resolves ${want}`);
}
for (const [st, want] of [['Operating', 'operating'], ['Active', 'operating'], ['Approved', 'approved'], ['Proposed', 'proposed'], ['On file', 'unknown']]) {
  ok(HS.resolveMarker({ type: 'Industrial', status: st }).lifecycle === want, `8 development row status ${st} → ${want}`);
}
// POSITIVE CONTROL: the facility branch reads data, not identity. A stored or declared lifecycle
// flows through unchanged — so "unknown" above is the evidence speaking, not a new constant.
ok(HS.resolveMarker({ record_kind: 'facility', _facility: true, type: 'industrial', status: 'Operating' }).lifecycle === 'operating'
   && HS.resolveTrackerMarker(cached({ label: 'X', layer: 'industrial', registry_id: '1', bucket: 'operating' }), frs).lifecycle === 'operating',
  '8p positive control: a facility whose data STATES operating (stored status / declared bucket) still resolves operating');
{
  // POSITIVE CONTROL B — a data centre whose SOURCE states operational (Compute Atlas
  // raw_status 'operational' → server map_status 'Operating', live row MGHPCC, Holyoke 01040,
  // read from public.map1_dc_zip_members on 2026-09-24) still resolves operating through the
  // canonical statusTier. Built with the shipped HS.map1DcSite mapping, not a hand-made item.
  const D = read('lib/data.js');
  new Function('HS', D.slice(D.indexOf('HS.map1DcSite = function'), D.indexOf('HS.map1DcCredits')))(HS);
  const dc = HS.map1DcSite({ source_key: 'dc:c46a54a1', project_name: 'Massachusetts Green High Performance Computing Center',
    map_status: 'Operating', normalized_status: 'operational', raw_status: 'operational', lat: 42.20285, lng: -72.60693,
    source_url: 'https://en.wikipedia.org/wiki/Massachusetts_Green_High_Performance_Computing_Center', zip_membership: 'member' });
  const m = HS.resolveMarker(dc);
  ok(m.lifecycle === 'operating' && m.categoryKey === 'datacenter' && !m.isFacility,
    '8q positive control: a data centre whose source states operational still resolves Operating (not a facility, not refused)');
}

// ── §9 one authority ─────────────────────────────────────────────────────────────────────
const MAP = code(read('lib/map.js'));
const facBlock = MAP.slice(MAP.indexOf('if (isFacilityItem(item)) {'), MAP.indexOf('const typeInfo = classifyProjectType(item);'));
// The legend row that LABELS the operating stage (STATUS_LEGEND_ROWS) is legitimate; what may not
// exist is an ASSERTED operating lifecycle, anywhere, or any operating tier inside the facility branches.
ok(facBlock.length > 500 && !/lifecycle:\s*'operating'/.test(MAP) && !/STATUS_TIERS\.operating|LIFECYCLE_HEX\.operating/.test(facBlock),
  '9a no literal operating lifecycle in lib/map.js, and no operating tier or colour inside the facility branches');
ok((facBlock.match(/statusTier\(item\)/g) || []).length === 1 && (facBlock.match(/lifecycle: st\.k,/g) || []).length === 3,
  '9b the facility branches take their lifecycle from the ONE statusTier call (3 branches, 1 decision)');
ok((MAP.match(/function statusTier\(/g) || []).length === 1 && (MAP.match(/function lifecycleColour\(/g) || []).length === 1
   && !/function \w*[Ff]acility\w*[Ll]ifecycle/.test(MAP + code(PAGE) + code(RT) + code(DEV)),
  '9c no facility-specific lifecycle classifier exists in any touched file');
ok(!/'Closed'|lifecycle:\s*'closed'/.test(MAP), '9d no Closed lifecycle was introduced');

// ── §10 the database splice ──────────────────────────────────────────────────────────────
const SQL = read('docs/facility-lifecycle-unknown-migration.sql');
const oldLit = (SQL.match(/_old\s+text := \$old\$([\s\S]*?)\$old\$;/) || [])[1];
const newLit = (SQL.match(/_new\s+text := \$new\$([\s\S]*?)\$new\$;/) || [])[1];
ok(oldLit && newLit, '10a the migration declares its anchor and replacement');
const newCode = newLit ? newLit.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n') : '';
ok(oldLit && newCode === oldLit.replace("'Operating',", "'On file',"),
  '10b the replacement is the anchor with ONLY the status token changed (Operating → On file)', newCode);
ok(/coalesce\(nullif\(el->>'src',''\),'Public registry'\)/.test(oldLit || '') && /_n <> 1/.test(SQL)
   && /md5\(replace\(_after, _new, _old\)\) <> md5\(_before\)/.test(SQL),
  '10c fail-closed: facility-only anchor, exactly-once check, and the reversal proof');
ok(!/Closed|Terminated|Effective'|Admin Continued/.test(code(SQL.replace(/^--.*$/gm, ''))),
  '10d the SQL maps no regulatory status to anything');


// ── §11 OLD CACHED ELEMENT and NEW PRODUCER ELEMENT converge to ONE Map 1 result ─────────
for (const [kind, base] of identities) {
  const a = HS.resolveTrackerMarker(cached(base), frs), b = HS.resolveTrackerMarker(fresh(base), frs);
  ok(JSON.stringify(a) === JSON.stringify(b),
    `11a ${kind}: the cached type:'built' element and the new producer element resolve to the IDENTICAL marker`);
}
// The page's own bucketOf / siteVisible / rail, evaluated from homesignalmap.html's source.
const grab = (src, head) => {
  const i = src.indexOf(head); if (i < 0) return null;
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
  return null;
};
const bucketSrc = grab(PAGE, 'function bucketOf(t, site){');
const visSrc = grab(PAGE, 'function siteVisible(p){');
ok(bucketSrc && visSrc && /FILTER\[bucketOf\(p\.type, p\)\]/.test(visSrc) && /HS\.categoryVisible/.test(visSrc),
  '11b the page\'s bucketOf and siteVisible are found (lifecycle chip AND Type category)');
ok(/LEGEND\.forEach\(function\(it\)\{ FILTER\[it\.b\] = true; \}\);/.test(PAGE)
   && /STATUS_LEGEND_ROWS \|\| \[\]\)\.filter\(function\(r\)\{ return r\.key !== "facility"; \}\)/.test(PAGE),
  '11c the stage FILTER is built from STATUS_LEGEND_ROWS minus facility, every chip ON by default');
const FILTER = {};
(HS.STATUS_LEGEND_ROWS || []).filter((r) => r.key !== 'facility').forEach((r) => { FILTER[r.key] = true; });
FILTER.built = true;
const pageFns = new Function('HS', 'FILTER', 'frsRid', bucketSrc + '\n' + visSrc + '\nreturn { bucketOf: bucketOf, siteVisible: siteVisible };');
const P = pageFns(HS, FILTER, frs);
const railOf = (sites) => {
  const permits = sites.filter((s) => s.scope === 'point' && s.relevance === 'development');
  const fac = sites.filter((s) => s.scope === 'point' && s.relevance !== 'development');
  return permits.concat(fac).filter((s) => P.bucketOf(s.type, s) === 'operating');
};
{
  const oldEl = cached({ label: 'AC MILLER CONCRETE - SPRING CITY PLANT', layer: 'industrial', registry_id: '110070105263' });
  const newEl = fresh({ label: 'AC MILLER CONCRETE - SPRING CITY PLANT', layer: 'industrial', registry_id: '110070105263' });
  const devOp = { scope: 'point', relevance: 'development', label: 'BUILT PERMIT', use_type: 'Industrial', layer: 'industrial', type: 'built', record_url: 'x' };
  for (const [nm, el] of [['old cached', oldEl], ['new producer', newEl]]) {
    const mk = HS.resolveTrackerMarker(el, frs);
    ok(P.bucketOf(el.type, el) === 'unknown' && mk.categoryKey === 'industrial' && mk.signal && mk.signal.letter === 'R'
       && P.siteVisible(el) === true && railOf([devOp, el]).indexOf(el) === -1,
      `11d ${nm} FRS element: Type Industrial, lifecycle unknown, R, VISIBLE on Map 1, NOT in the Operating-now rail`);
  }
  ok(railOf([devOp, oldEl]).length === 1 && railOf([devOp, oldEl])[0] === devOp,
    '11e positive control: the rail still lists a development record whose source records it built');
  // ── §12 the filter matrix (existing semantics: Type filters decide the base pin; the
  //        regulatory switch owns only the R; the lifecycle chip is the record's lifecycle) ──
  const setAll = (on) => Object.keys(FILTER).forEach((k) => { FILTER[k] = on; });
  const reg = HS.REGULATORY_LEGEND.key;
  setAll(true);
  const mk = HS.resolveTrackerMarker(oldEl, frs);
  ok(P.siteVisible(oldEl) === true, '12a DEFAULT map (every chip, every Type on): visible');
  HS.setCategoryFilter(reg, true);
  ok(P.siteVisible(oldEl) === true && HS.visibleSignal(mk) && HS.visibleSignal(mk).letter === 'R', '12b REGULATORY ON: visible with R');
  HS.setCategoryFilter(reg, false);
  ok(P.siteVisible(oldEl) === true && HS.visibleSignal(mk) === null,
    '12c REGULATORY OFF: base pin stays (Type decides it), R hidden — the existing overlay semantics');
  HS.setCategoryFilter(reg, true);
  setAll(false); FILTER.unknown = true;
  ok(P.siteVisible(oldEl) === true, '12d LIFECYCLE UNKNOWN chip alone: visible');
  setAll(false); FILTER.operating = true; FILTER.built = true;
  ok(P.siteVisible(oldEl) === false && P.siteVisible(devOp) === true,
    '12e OPERATING chip alone: the facility is NOT selected as operating (a built development record is)');
  setAll(true);
  HS.setCategoryFilter('industrial', false);
  const offT = P.siteVisible(oldEl);
  HS.setCategoryFilter('industrial', true);
  ok(offT === false && P.siteVisible(oldEl) === true, '12f TYPE filter: still selected by its canonical Type (Industrial off hides it, on shows it)');
}

// ── §13 the replay guard ─────────────────────────────────────────────────────────────────
const GUARD = read('docs/facility-lifecycle-guard.sql');
const gFnStart = GUARD.indexOf('create or replace function public.app_projects_facility_lifecycle_guard()');
const gFn = gFnStart >= 0 ? GUARD.slice(gFnStart, GUARD.indexOf('$fn$;', gFnStart)) : '';
const gFnCode = gFn.replace(/^\s*--.*$/gm, '');
ok(/create trigger app_projects_facility_lifecycle_guard_trg\s+before insert or update of status, record_kind on public\.app_projects\s+for each row\s+when \(new\.record_kind = 'facility' and new\.status = 'Operating'\)\s+execute function public\.app_projects_facility_lifecycle_guard\(\);/.test(GUARD),
  '13a the guard trigger is CREATED on app_projects, before insert/update of status, filtered to facility + Operating');
ok(gFnCode.length > 100 && /raise exception using/.test(gFnCode) && !/new\.\w+\s*:=/.test(gFnCode)
   && !/raise (notice|warning|info)/.test(gFnCode) && !/(update|insert into)\s+public\./i.test(gFnCode),
  '13a2 the guard function REFUSES (raises) and never rewrites or writes a value — no second write authority');
ok(/A_insert_facility_operating' = 'refused'/.test(GUARD) && /B_insert_facility_on_file' = 'accepted'/.test(GUARD)
   && /C_update_facility_into_operating' = 'refused'/.test(GUARD) && /D_insert_development_operating' = 'accepted'/.test(GUARD)
   && /raise exception 'facility lifecycle guard selftest failed/.test(GUARD),
  '13b the apply fails unless the self-test passes in BOTH directions (refuses the defect, accepts unknown and development Operating)');
// Every committed artifact still carrying the obsolete facility literal is a KNOWN dated
// receipt. A new copy (a fresh snapshot, a restored rollback) must be reviewed, not slip in.
import('node:child_process').then(({ execSync }) => {
  const hits = execSync("git ls-files -z | xargs -0 grep -lF \"'Operating', coalesce(nullif(el->>'src',''),'Public registry')\" || true",
    { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean).sort();
  const KNOWN = ['docs/app-maps-backbone-migration.sql', 'docs/app-projects-stable-key-migration.sql',
    'docs/app-projects-stable-key-rollback.sql', 'docs/app-refresh-zip-gin-containment-migration.sql',
    'docs/app-refresh-zip-live-snapshot-2026-07-24.sql', 'docs/app-refresh-zip-local-news-migration.sql',
    'docs/facility-lifecycle-guard.sql', 'docs/facility-lifecycle-unknown-migration.sql',
    'test/facility-lifecycle-unknown.test.mjs'];  // this file names the literal in its own grep
  const unknown = hits.filter((h) => !KNOWN.includes(h));
  ok(hits.length >= 7 && unknown.length === 0,
    `13c every file carrying the obsolete facility literal is a known dated receipt (${hits.length} found)`, unknown.join(', '));
  finish();
});

function finish() {
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
}
