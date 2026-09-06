// COMMERCIAL WORK-EVIDENCE GATE — regression protection for the founder's Commercial product
// rule (2026-09-05). Offline: loads the REAL lib/map.js and the REAL connector module, plus the
// REAL committed registry. No network, no DB.
//
// THE RULE THIS LOCKS DOWN
//   A Map 1 Commercial object means a real commercial building/site development or material
//   physical construction project. A field describing only property type, occupancy, zoning,
//   land use or building use is INSUFFICIENT by itself. Standalone electrical / plumbing /
//   mechanical / fire-alarm / sprinkler / grease-trap / sign permits, business licences,
//   inspections, administrative renewals and routine maintenance do NOT qualify merely because
//   the property is commercial.
//
// THE DEFECTS IT EXISTS TO PREVENT RECURRING (all measured in production, 2026-09-05)
//   • little-rock-permits contributed 10,021 Commercial objects, 7,574 of them (75.6%)
//     standalone ELE/MEC/PLU trade permits, because BldUseDesc said COMMERCIAL.
//   • ONE address — 100 E MARKHAM ST, ZIP 72201 — produced TWELVE Commercial hexagons.
//   • 17,237 objects took their Type from a property/occupancy/land-use field only.
//   • dallas-specific-use-permits mapped 210 ZONING USE strings to Commercial.
//
// AND THE TRAP THAT MAKES A NAIVE FIX WORTHLESS
//   Downgrading into 'unclassified' or 'Development' would NOT hold: both are in GENERIC_EXACT,
//   i.e. NON-TERMINAL, so the record falls through to the name phase where NAME_RULES matches
//   /commercial|retail|office|hotel/ against its own label — and these labels routinely carry
//   those words ("ELECTRIC COMMERCIAL 1200 SE ...", "Commercial Amusement (Inside)"). §4 proves
//   the terminal bucket actually holds, and is the load-bearing half of this file.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  applyCommercialWorkEvidence,
  NON_QUALIFYING_COMMERCIAL_USE_TYPE,
} from '../supabase/functions/get-address-report/sources/commercial-eligibility.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = { HS: {} };
globalThis.window = win;
globalThis.document = { getElementById: () => null };
new Function('window', 'document', readFileSync(join(root, 'lib/map.js'), 'utf8'))(win, globalThis.document);
const HS = win.HS;

const registry = JSON.parse(readFileSync(
  join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('FAIL ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// Load lib/commercial-coverage.js the way the browser does, into the same window shim.
function require_commercialCoverage() {
  new Function('window', readFileSync(join(root, 'lib/commercial-coverage.js'), 'utf8'))(win);
  return win.HS.commercialCoverage;
}

const entryById = (id) => {
  for (const fam of ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft']) {
    for (const e of registry[fam] || []) if (e && e.registry_id === id) return e;
  }
  return null;
};

// Drive the SHIPPED gate the way the connector does: read from a plain row object, with the
// entry's own type_source as the fallback column.
const gate = (useType, id, row) => {
  const e = entryById(id);
  const ts = e && e.column_map && e.column_map.type_source;
  const soleTypeCol = typeof ts === 'string' ? ts : (Array.isArray(ts) && ts.length === 1 ? ts[0] : null);
  return applyCommercialWorkEvidence(useType, e && e.commercial_work_evidence,
    (col) => row[col], soleTypeCol);
};

// A ZIP-mode Map 1 site, built exactly as lib/zip-authoritative.js::zipAuthSiteFromMarker does:
// `type` carries the STATUS bucket and `use_type` carries the project's stored type.
const zipSite = (useType, label, bucket = 'approved') =>
  ({ scope: 'point', relevance: 'development', bucket, type: bucket,
     use_type: useType, label, record_url: 'x' });

// ─────────────────────────────────────────────────────────────────────────────
console.log('§1 the gate NEVER touches another Map 1 Type');
// This is the containment guarantee the whole workstream rests on: Data Center, Regulated
// Facility, Residential, Roads & Infrastructure and Civic/Public must be unreachable from here.
for (const t of ['Residential', 'Industrial', 'Civic/Public', 'Utility', 'Development',
                 'unclassified', 'Roads & infrastructure', 'data center', 'regulated facility']) {
  // little-rock-permits is the strictest rule in the registry (qualifying = ['BLD'] only) and
  // carries 37,646 Residential objects — exactly the population an entry-wide extra_where
  // would have silently rewritten.
  const r = gate(t, 'little-rock-permits', { PermitType: 'ELE', BldUseDesc: 'SINGLE FAMILY/DUPLEX' });
  eq(r.useType, t, `§1 ${t} passes through untouched`);
  eq(r.downgraded, false, `§1 ${t} is not downgraded`);
}

console.log('§2 an entry with NO rule is byte-for-byte unchanged');
{
  const r = applyCommercialWorkEvidence('Commercial', undefined, () => 'anything', 'SomeCol');
  eq(r.useType, 'Commercial', '§2 no rule ⇒ Commercial survives');
  eq(r.downgraded, false, '§2 no rule ⇒ not downgraded');
  // charlotte-land-dev-commercial-projects is the curated real commercial-project dataset and
  // the audit's positive control. It must carry no rule at all.
  const ch = entryById('charlotte-land-dev-commercial-projects');
  ok(ch && !ch.commercial_work_evidence, '§2 charlotte positive control carries NO gate');
  eq(ch.use_type_const, 'Commercial', '§2 charlotte still declares Commercial');
}

console.log('§3 Little Rock — the largest false-positive family');
{
  // Every value is the source's OWN PermitType vocabulary, enumerated from production.
  for (const w of ['ELE', 'MEC', 'PLU', 'SDG', 'RTW', 'ANT', 'GLA']) {
    const r = gate('Commercial', 'little-rock-permits', { PermitType: w, BldUseDesc: 'COMMERCIAL' });
    eq(r.useType, NON_QUALIFYING_COMMERCIAL_USE_TYPE, `§3 PermitType ${w} is not Commercial`);
    eq(r.downgraded, true, `§3 PermitType ${w} downgraded`);
  }
  const bld = gate('Commercial', 'little-rock-permits', { PermitType: 'BLD', BldUseDesc: 'COMMERCIAL' });
  eq(bld.useType, 'Commercial', '§3 PermitType BLD IS retained — qualifying work is not destroyed');
  eq(bld.downgraded, false, '§3 BLD not downgraded');
  // FAIL-CLOSED: an unknown or absent work value must never inherit Commercial from occupancy.
  eq(gate('Commercial', 'little-rock-permits', { BldUseDesc: 'COMMERCIAL' }).useType,
     NON_QUALIFYING_COMMERCIAL_USE_TYPE, '§3 absent PermitType fails closed');
  eq(gate('Commercial', 'little-rock-permits', { PermitType: '   ' }).useType,
     NON_QUALIFYING_COMMERCIAL_USE_TYPE, '§3 blank PermitType fails closed');
  eq(gate('Commercial', 'little-rock-permits', { PermitType: 'NEWCODE' }).useType,
     NON_QUALIFYING_COMMERCIAL_USE_TYPE, '§3 unknown future PermitType fails closed');
  // Trimmed + case-insensitive, matching how type_map values resolve.
  eq(gate('Commercial', 'little-rock-permits', { PermitType: ' bld ' }).useType,
     'Commercial', '§3 value match is trimmed and case-insensitive');
}

console.log('§4 the downgrade is TERMINAL — the name phase cannot re-promote it');
{
  const t = HS.classifyProjectType(zipSite(NON_QUALIFYING_COMMERCIAL_USE_TYPE, 'ELE 100 E MARKHAM ST'));
  eq(t.typeKey, 'other', '§4 downgraded record resolves to the Other-project category');
  eq(t.shape, HS.CATEGORY_REGISTRY.other.symbol, '§4 downgraded record draws the Other-project symbol, not a hexagon');
  eq(t.legendLabel, 'Other project', '§4 legend label is Other project');

  // THE LEAK, proved absent. Each label below is a real production label shape whose text
  // WOULD match NAME_RULES /commercial|retail|office|hotel/ if the bucket were non-terminal.
  const leaky = [
    'ELECTRIC COMMERCIAL 1200 SE 14TH ST',       // bentonville PERMIT_TYPE + address
    'Commercial Amusement (Inside)',              // dallas SPECIFICUSE, title IS the use string
    'PLU 500 COMMERCIAL ST',                      // a street literally named Commercial
    'MEC 900 RETAIL DR',
    'ELE 1 HOTEL PLAZA',
    'Business License 123 Main St',
    'Sign Permit-Wall Mount/Cabinet',
    'Fats Oil Grease 4151 ASHFORD DUNWOODY RD',
  ];
  for (const label of leaky) {
    const m = HS.resolveMarker(zipSite(NON_QUALIFYING_COMMERCIAL_USE_TYPE, label));
    eq(m.typeKey, 'other', `§4 no re-promotion: ${label}`);
    eq(m.shape, HS.CATEGORY_REGISTRY.other.symbol, `§4 stays Other project: ${label}`);
  }
  // The counterfactual that proves §4 is load-bearing rather than scaffolding: the SAME labels
  // through the generic buckets DO get re-promoted to Commercial, which is why a naive
  // downgrade would have failed.
  const viaGeneric = HS.resolveMarker(zipSite('unclassified', 'ELECTRIC COMMERCIAL 1200 SE 14TH ST'));
  eq(viaGeneric.typeKey, 'commercial',
     '§4 CONTROL: the same record via a GENERIC bucket is re-promoted — the trap is real');
}

console.log('§5 lib/map.js change is strictly ADDITIVE');
{
  // Every use_type string that exists in production today must classify exactly as before.
  const before = {
    'Commercial': 'commercial', 'Residential': 'residential', 'Development': 'other',
    'Utility': 'infrastructure', 'unclassified': 'other', 'Civic/Public': 'civic',
    'Civic': 'civic', 'Industrial': 'industrial', 'Roads & infrastructure': 'infrastructure',
    'Infrastructure': 'infrastructure',
  };
  for (const [ut, want] of Object.entries(before)) {
    // A label that states no building class, so only the type phase can decide.
    eq(HS.classifyProjectType(zipSite(ut, 'BLD 100 E MARKHAM ST')).typeKey, want,
       `§5 existing use_type ${ut} still classifies as ${want}`);
  }
  ok(!HS.SHAPE_LEGEND.some(r => r.categoryKey === 'commercial' && r.shape !== 'hexagon'),
     '§5 Commercial is still the hexagon');
  eq(HS.CATEGORY_REGISTRY.commercial.symbol, 'hexagon', '§5 Commercial symbol unchanged');
  eq(HS.SHAPE_LEGEND.length, 7, '§5 no legend row was added or removed');
}

console.log('§6 the registry rules are complete, well-formed and generator-consistent');
{
  const all = [];
  for (const fam of ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft'])
    for (const e of registry[fam] || []) if (e && e.registry_id) all.push(e);

  const gated = all.filter(e => e.commercial_work_evidence);
  ok(gated.length >= 30, `§6 at least 30 entries carry a rule (got ${gated.length})`);

  for (const e of gated) {
    const r = e.commercial_work_evidence;
    const keys = Object.keys(r).filter(k => !['column', 'qualifying', 'unresolved', 'note'].includes(k));
    eq(keys.length, 0, `§6 ${e.registry_id}: no unknown keys (${keys})`);
    ok(typeof r.note === 'string' && r.note.length > 20,
       `§6 ${e.registry_id}: carries a stated reason`);
    if (r.unresolved) {
      ok(!r.qualifying, `§6 ${e.registry_id}: unresolved carries no whitelist`);
    } else {
      ok(Array.isArray(r.qualifying) && r.qualifying.length > 0,
         `§6 ${e.registry_id}: has a non-empty qualifying whitelist`);
      // A whitelist that names a value the entry's own type_map does not call Commercial is a
      // config error — it would silently qualify nothing.
      if (!r.column) {
        const com = Object.entries(e.type_map || {}).filter(([, v]) => v === 'Commercial').map(([k]) => k);
        const stray = r.qualifying.filter(q => !com.includes(q));
        eq(stray.length, 0, `§6 ${e.registry_id}: whitelist ⊆ its own Commercial type_map (${stray})`);
      }
    }
  }

  // The named false-positive classes from the audit must all be gated somewhere.
  for (const id of ['little-rock-permits', 'dekalb-county-building-permits',
                    'memphis-dpd-building-permits', 'dallas-specific-use-permits',
                    'huntsville-building-permits', 'arlington-permit-applications',
                    'charleston-county-permits', 'bentonville-catalyst-permits']) {
    ok(!!entryById(id)?.commercial_work_evidence, `§6 ${id} is gated`);
  }
  // Business licences and signs, by name, at their source.
  const chas = entryById('charleston-county-permits').commercial_work_evidence.qualifying;
  ok(!chas.includes('Business License'), '§6 charleston: Business License is NOT qualifying');
  ok(!chas.some(v => /^Sign/i.test(v)), '§6 charleston: no sign permit is qualifying');
  ok(chas.includes('Commercial New'), '§6 charleston: real commercial construction retained');
}

console.log('§7 unresolved sources assert nothing');
{
  for (const id of ['huntsville-building-permits', 'durham-building-permits',
                    'dallas-specific-use-permits', 'san-jose-permits']) {
    const r = gate('Commercial', id, { anything: 'Commercial' });
    eq(r.useType, NON_QUALIFYING_COMMERCIAL_USE_TYPE, `§7 ${id} cannot assert Commercial`);
  }
  // …but their OTHER types are untouched, which is what keeps Residential out of this unit.
  eq(gate('Residential', 'huntsville-building-permits', {}).useType, 'Residential',
     '§7 huntsville Residential is untouched');
}

console.log('§8 tenant improvement is decided by source-native evidence, not by the word');
{
  // QUALIFYING: the source's own class states physical build-out.
  eq(gate('Commercial', 'peoria-az-building-permits',
          { B1_PER_SUB_TYPE: 'Commercial Tenant Improvement' }).useType, 'Commercial',
     '§8 physical tenant improvement retained (peoria)');
  eq(gate('Commercial', 'aurora-building-permits', { SubDesc: 'Tenant Improvement' }).useType,
     'Commercial', '§8 physical tenant improvement retained (aurora)');
  // NON-QUALIFYING: the record establishes only tenancy / use / business status.
  eq(gate('Commercial', 'peoria-az-building-permits',
          { B1_PER_SUB_TYPE: 'New Commercial Tenant' }).useType,
     NON_QUALIFYING_COMMERCIAL_USE_TYPE, '§8 tenancy-only record excluded (peoria)');
  eq(gate('Commercial', 'dekalb-county-building-permits',
          { WorkTypeDescription: 'Tenant or Use Change Permit' }).useType,
     NON_QUALIFYING_COMMERCIAL_USE_TYPE, '§8 use-change record excluded (dekalb)');
  eq(gate('Commercial', 'arlington-permit-applications', { SUBDESC: 'New Tenant' }).useType,
     NON_QUALIFYING_COMMERCIAL_USE_TYPE, '§8 "New Tenant" excluded (arlington applications)');
  // The word alone must never decide it — same word, opposite verdicts above.
}

console.log('§9 DeKalb / Memphis work vocabularies');
{
  for (const w of ['Fats Oil Grease', 'Fire Marshal Special Work type', 'Electrical Low Voltage',
                   'General Combined Plumbing', 'Fire Sprinkler System', 'Kitchen Fire Suppression',
                   'Owner Change Only', 'Electrical Inspection Only', 'Repairs to Existing Structure']) {
    eq(gate('Commercial', 'dekalb-county-building-permits', { WorkTypeDescription: w }).useType,
       NON_QUALIFYING_COMMERCIAL_USE_TYPE, `§9 dekalb "${w}" excluded`);
  }
  for (const w of ['New Construction', 'Alteration to Existing Structure',
                   'Additions to Existing Structures', 'Demolition', 'Commercial General Combination']) {
    eq(gate('Commercial', 'dekalb-county-building-permits', { WorkTypeDescription: w }).useType,
       'Commercial', `§9 dekalb "${w}" retained`);
  }
  for (const w of ['NEW', 'ADD', 'ALT']) {
    eq(gate('Commercial', 'memphis-dpd-building-permits', { Construction_Type: w }).useType,
       'Commercial', `§9 memphis ${w} retained`);
  }
  eq(gate('Commercial', 'memphis-dpd-building-permits', { Construction_Type: 'ACC' }).useType,
     NON_QUALIFYING_COMMERCIAL_USE_TYPE, '§9 memphis ACC excluded');
}

console.log('§10 the LIVE page path labels the Type, not the Stage');
{
  // The read-only gate reported "typeLabel receives the Stage word" from a DIRECT
  // HS.resolveMarker() call on the ZIP-mode site shape. That is NOT the page's path:
  // homesignalmap.html calls HS.resolveTrackerMarker, which normalises through
  // HS.trackerSiteItem first (type <- use_type, status <- the bucket). Pinning the real path
  // here so the correction cannot silently regress into the defect that was reported.
  new Function('window', readFileSync(join(root, 'lib/zip-authoritative.js'), 'utf8'))(win);
  HS.n5BucketFromStatus = HS.n5BucketFromStatus || ((v) => String(v || '').toLowerCase() || 'unknown');
  const marker = { project_ref: 'k', marker_seq: 1, lat: 34.74, lng: -92.28, marker_rule: 'POINT_AUTHORITATIVE' };
  const site = HS.zipAuthSiteFromMarker(marker,
    { project_ref: 'k', name: 'BLD 100 E MARKHAM ST', type: 'Commercial', status: 'Operating',
      source_ref: 'https://example/permit', registry_id: 'little-rock-permits' });
  eq(site.type, 'operating', '§10 the raw ZIP site really does carry the Stage in .type');
  eq(site.use_type, 'Commercial', '§10 …and the Type in .use_type');
  const m = HS.resolveTrackerMarker(site, () => '');
  eq(m.typeLabel, 'Commercial', '§10 PAGE PATH: typeLabel is the Type, not the Stage');
  eq(m.shape, 'hexagon', '§10 PAGE PATH: Commercial still draws a hexagon');
  eq(m.statusLabel, 'Operating / built', '§10 PAGE PATH: the Stage has its own label');
  ok(m.popupLabel.indexOf('Commercial') !== -1, '§10 PAGE PATH: popup names the Type');
  // And a downgraded record reads honestly on the same path.
  const d = HS.resolveTrackerMarker(
    HS.zipAuthSiteFromMarker(marker, { project_ref: 'k', name: 'ELE 100 E MARKHAM ST',
      type: NON_QUALIFYING_COMMERCIAL_USE_TYPE, status: 'Operating',
      source_ref: 'https://example/permit', registry_id: 'little-rock-permits' }), () => '');
  eq(d.typeKey, 'other', '§10 PAGE PATH: a downgraded record is an Other project');
  eq(d.shape, HS.CATEGORY_REGISTRY.other.symbol, '§10 PAGE PATH: …and draws the Other-project symbol');
}

console.log('§11 Commercial zero / coverage semantics');
{
  const cc = require_commercialCoverage();
  const map = JSON.parse(readFileSync(join(root, 'lib/generated/county-sources.json'), 'utf8'));

  // COVERED: Pulaski AR keeps little-rock-permits, which can still emit Commercial (BLD).
  eq(cc.status(map, 'Pulaski', 'AR').covered, true, '§11 Pulaski AR is Commercial-covered');
  eq(cc.note(map, 'Pulaski', 'AR', 'Pulaski County'), null, '§11 covered county says nothing');

  // UNCOVERED BECAUSE THE ONLY SOURCE WENT UNRESOLVED — the case this gate creates.
  eq(cc.status(map, 'Madison', 'AL').covered, false, '§11 Madison AL is no longer Commercial-covered');
  const n = cc.note(map, 'Madison', 'AL', 'Madison County');
  ok(!!n, '§11 uncovered county gets a note');
  ok(/not measured/i.test(n), '§11 note says NOT MEASURED');
  ok(/does not imply there are none/i.test(n), '§11 note refuses the measured-zero claim');
  // The bans inherited from lib/coverage-copy.js, self-tested rather than assumed.
  ok(!/\bmile/i.test(n), '§11 BAN: names no distance');
  ok(!/coming soon|we're adding|adding counties|202\d|next (month|quarter)/i.test(n),
     '§11 BAN: no date and no promise');
  ok(!/does not publish|refus|declin/i.test(n), '§11 BAN: never blames the county');
  ok(/we have not identified a source/i.test(n), '§11 the gap is stated as OURS');
  ok(!/no commercial development/i.test(n), '§11 BAN: never asserts an empty world');

  // UNKNOWN IS NOT UNCOVERED — fails closed to silence, in both directions.
  eq(cc.status(null, 'Madison', 'AL').covered, null, '§11 no map ⇒ not established');
  eq(cc.note(null, 'Madison', 'AL', 'x'), null, '§11 no map ⇒ no sentence');
  eq(cc.status(map, null, null).covered, null, '§11 no state ⇒ not established');
  eq(cc.note(map, null, null, null), null, '§11 ambiguous county ⇒ no sentence');

  // An `unresolved` entry must never be counted as coverage — that is the whole point.
  const unresolvedIds = new Set();
  for (const fam of ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft'])
    for (const e of registry[fam] || [])
      if (e && e.commercial_work_evidence && e.commercial_work_evidence.unresolved)
        unresolvedIds.add(e.registry_id);
  ok(unresolvedIds.size >= 14, `§11 the registry carries the unresolved set (${unresolvedIds.size})`);
  let leaked = 0;
  for (const list of Object.values(map.counties))
    for (const s of list) if (s.commercial && unresolvedIds.has(s.id)) leaked++;
  eq(leaked, 0, '§11 no unresolved source is stamped Commercial-capable');
}

console.log(`\ncommercial-work-evidence: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
