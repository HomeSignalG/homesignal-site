// PERMANENT Del Valle (78617) maps golden baseline — the snapshot half of PR #400's golden
// contract (the differential half is scripts/backbone-golden-diff.ts; see the header of
// scripts/delvalle-golden.mjs for why the two are separate and how they divide the work).
//
// WHAT THIS PROTECTS: the semantic output of the maps backbone for the reference ZIP —
// source identity, dedupe identity, category, symbol, colour, lifecycle, evidence, filter key,
// fallback honesty and popup text — over VERBATIM production records.
//
// WHAT IT DELIBERATELY DOES NOT SNAPSHOT: export timestamps, input array order, browser object
// handles, screenshot bytes. The baseline is sorted by dedupe identity and canonicalised, so a
// re-export in a different order is a no-op and only a real semantic change moves it.

import { readFileSync } from 'node:fs';
import { build, serialize, checksum, loadHS, sourceToken, dedupeIdentity, EXPECTED, FIXTURE, NEAREST_FAC_CAP }
  from '../scripts/delvalle-golden.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const golden = build();
const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const R = golden.records;
const byToken = new Map(R.map(r => [r.source_record_token, r]));
const dev = R.filter(r => r.record_kind === 'development');
const fac = R.filter(r => r.record_kind === 'facility');
const tabs = dev.filter(r => r.source_registry_id === null);

// ── 0. THE BASELINE ITSELF — any drift at all fails here, with the field named ────────
{
  const expected = readFileSync(EXPECTED, 'utf8');
  const actual = serialize(golden);
  ok(actual === expected,
     '0: regenerated baseline is byte-identical to the committed expected.json ' +
     `(run \`node scripts/delvalle-golden.mjs --write\` ONLY with an explained semantic delta; sha ${checksum(golden)})`);
  if (actual !== expected) {
    // Name the drifting records rather than dumping 80 KB of JSON.
    const exp = JSON.parse(expected);
    const em = new Map((exp.records || []).map(r => [r.dedupe_identity, r]));
    for (const r of R) {
      const e = em.get(r.dedupe_identity);
      if (!e) { console.error('  NEW record: ' + r.dedupe_identity); continue; }
      for (const k of Object.keys(r))
        if (JSON.stringify(r[k]) !== JSON.stringify(e[k]))
          console.error(`  DRIFT ${r.name} .${k}: ${JSON.stringify(e[k])} -> ${JSON.stringify(r[k])}`);
    }
    const am = new Set(R.map(r => r.dedupe_identity));
    for (const e of exp.records || []) if (!am.has(e.dedupe_identity)) console.error('  DISAPPEARED: ' + e.dedupe_identity);
  }
}

// ── 1. THE CONTRACT — every protected field is present on every record ────────────────
{
  const CONTRACT = ['source_registry_id', 'source_record_token', 'dedupe_identity', 'name', 'record_kind',
    'source_type_raw', 'source_status_raw', 'lifecycle', 'lifecycle_label', 'category', 'symbol', 'color',
    'zip', 'lat', 'lng', 'evidence_url', 'filter_key', 'fallback_reason', 'classification_rule',
    'popup_title', 'popup_category', 'popup_lifecycle', 'popup_evidence_destination', 'is_facility'];
  for (const r of R) for (const k of CONTRACT)
    if (!(k in r)) { fail++; console.error(`FAIL 1: ${r.name} is missing contract field ${k}`); }
  pass++;
  // Nothing may be silently absent: only fallback_reason and source_registry_id are nullable.
  for (const r of R) for (const k of CONTRACT)
    if (r[k] === undefined || (r[k] === null && k !== 'fallback_reason' && k !== 'source_registry_id'))
      { fail++; console.error(`FAIL 1: ${r.name}.${k} is null/undefined and that field is not nullable`); }
  pass++;
  eq(R.length, fx.records.length, '1: every fixture record reaches the baseline — none silently disappears');
  eq(new Set(R.map(r => r.dedupe_identity)).size, R.length, '1: dedupe identities are unique — no collapse');
  eq(new Set(R.map(r => r.source_record_token)).size, R.length, '1: source tokens are unique');
  ok(R.every(r => r.source_record_token), '1: every record carries a publisher-assigned source token');
  ok(R.every(r => /^https:\/\//.test(r.evidence_url)), '1: every record carries an https evidence URL');
  ok(R.every(r => r.popup_evidence_destination === r.evidence_url),
     '1: the popup links to the SAME official record the marker cites');
  ok(R.every(r => r.zip === '78617'), '1: no ZIP drift');
  ok(R.every(r => typeof r.lat === 'number' && typeof r.lng === 'number'), '1: coordinates are real numbers');
}

// ── 2. SOURCE COVERAGE — all four required families are present ───────────────────────
{
  const bySrc = R.reduce((a, r) => { const k = r.source_registry_id || '(null)'; a[k] = (a[k] || 0) + 1; return a; }, {});
  ok(bySrc['austin-site-plan-cases'] > 0, '2: austin-site-plan-cases is covered');
  ok(bySrc['austin-subdivision-cases'] > 0, '2: austin-subdivision-cases is covered');
  eq(tabs.length, 5, '2: ALL FIVE TABS records are covered, not a sample');
  eq(fac.length, 29, '2: all 29 EPA facilities are covered');
  ok(fac.length > NEAREST_FAC_CAP,
     '2: more facilities than the nearest-24 cap, so the restFacs tail is genuinely exercised');
}

// ── 3. SEMANTIC REGISTRY — closed, symbol-unique, aligned ─────────────────────────────
{
  const REQUIRED = { datacenter: 'octagon', industrial: 'triangle', residential: 'pentagon',
    infrastructure: 'diamond', commercial: 'hexagon', civic: 'cross', other: 'capsule', facility: 'square' };
  const reg = golden.semantic_registry;
  eq(Object.keys(reg).sort().join(','), Object.keys(REQUIRED).sort().join(','),
     '3: the category registry is exactly the closed accepted set');
  for (const [k, sym] of Object.entries(REQUIRED)) eq(reg[k].symbol, sym, `3: ${k} -> ${sym}`);
  const symbols = Object.values(reg).map(c => c.symbol);
  eq(new Set(symbols).size, symbols.length, '3: no two categories share a symbol');
  // DATA CENTER: no live Del Valle record exists, so the registry-level assertion above is the
  // whole of its coverage. Fabricating a Del Valle data-center record to fill the cell would be
  // exactly the invention the anti-fabrication rule forbids.
  eq(R.filter(r => r.category === 'datacenter').length, 0,
     '3: no data-center record is INVENTED for Del Valle — the registry assertion stands alone');

  ok(R.every(r => r.symbol === reg[r.category].symbol), '3: every record uses its category\'s canonical symbol');
  ok(fac.every(r => r.symbol === 'square' && r.category === 'facility' && r.color === '#7d148c'),
     '3: every facility is a purple square');
  ok(dev.every(r => r.symbol !== 'square'), '3: NO development record uses the facility square');
  ok(dev.every(r => r.category !== 'facility'), '3: no development record crosses over into the facility category');
  ok(fac.every(r => r.is_facility) && dev.every(r => !r.is_facility), '3: the facility flag matches record_kind');
  // Fallback honesty: an `other` record must SAY why, and a classified record must not.
  ok(R.filter(r => r.category === 'other').every(r => !!r.fallback_reason && r.classification_rule === 'FALLBACK:other'),
     '3: every `other` record retains an explicit fallback reason');
  ok(R.filter(r => r.category !== 'other').every(r => r.fallback_reason === null),
     '3: a classified record carries NO fallback reason');
  ok(R.some(r => /^NAME:/.test(r.classification_rule)), '3: the name rules are exercised');
  ok(R.some(r => /^TYPE_EXACT:/.test(r.classification_rule)), '3: the type rules are exercised');
  // `unknown` is a LIFECYCLE, never a category.
  ok(!('unknown' in reg), '3: `unknown` is not a category');
  ok(golden.lifecycle_chips.some(c => c.key === 'unknown'), '3: `unknown` IS a lifecycle chip');
  eq(golden.lifecycle_chips.map(c => c.key).join(','), 'proposed,approved,operating,unknown,facility',
     '3: the lifecycle chip vocabulary is exactly the accepted contract');
  eq(golden.legend_shapes.length + 1, Object.keys(reg).length,
     '3: the shape legend covers every category except the separately-rendered facility row');
}

// ── 4. LIFECYCLE CONTRACT ─────────────────────────────────────────────────────────────
{
  const VOCAB = ['proposed', 'approved', 'operating', 'unknown'];
  ok(R.every(r => VOCAB.includes(r.lifecycle)), '4: no lifecycle outside the canonical vocabulary');
  ok(R.every(r => VOCAB.concat(['facility']).includes(r.filter_key)), '4: no filter key outside the contract');
  ok(!R.some(r => /onfile|built|on file/i.test(r.lifecycle)), '4: no competing legacy lifecycle vocabulary survives');
  // Raw status normalises deterministically — same raw status, same lifecycle, every time.
  const seen = new Map();
  for (const r of dev) {
    const k = String(r.source_status_raw);
    if (seen.has(k)) eq(r.lifecycle, seen.get(k), `4: raw status "${k}" normalises deterministically`);
    else seen.set(k, r.lifecycle);
  }
  eq(seen.get('Proposed'), 'proposed', '4: "Proposed" -> proposed');
  eq(seen.get('Approved'), 'approved', '4: "Approved" -> approved');
  eq(seen.get('Operating'), 'operating', '4: "Operating" -> operating');
  eq(seen.get('On file'), 'unknown', '4: TABS "On file" -> unknown, never an asserted lifecycle');
  // Facilities render operating but live in the facility filter bucket.
  ok(fac.every(r => r.lifecycle === 'operating'), '4: EPA facilities render operating');
  ok(fac.every(r => r.filter_key === 'facility'), '4: EPA facilities filter as `facility`, not `operating`');
  eq(R.filter(r => r.filter_key === 'operating').length, dev.filter(r => r.lifecycle === 'operating').length,
     '4: turning off `operating` cannot reach a facility');
}

// ── 5. ALL FIVE TABS RECORDS ──────────────────────────────────────────────────────────
{
  const EXPECT = {
    'tdlr-tabs:TABS2023006449': { name: 'River Bottoms Ranch Barn 2', category: 'industrial', symbol: 'triangle' },
    'tdlr-tabs:TABS2023006483': { name: 'Histology Lab', category: 'industrial', symbol: 'triangle' },
    'tdlr-tabs:TABS2024016698': { name: 'Barn 2 ACT Office', category: 'commercial', symbol: 'hexagon' },
    'tdlr-tabs:TABS2024022676': { name: 'ATX1 New Construction', category: 'industrial', symbol: 'triangle' },
    'tdlr-tabs:TABS2026011928': { name: 'ATX1 - Third Floor Tenant Improvement', category: 'commercial', symbol: 'hexagon' },
  };
  eq(tabs.length, Object.keys(EXPECT).length, '5: exactly five TABS records');
  for (const [tok, e] of Object.entries(EXPECT)) {
    const r = byToken.get(tok);
    if (!r) { fail++; console.error('FAIL 5: missing TABS record ' + tok); continue; }
    eq(r.name, e.name, `5: ${tok} name`);
    eq(r.record_kind, 'development', `5: ${tok} is a development record`);
    eq(r.source_registry_id, null, `5: ${tok} registry_id stays NULL — never fabricated`);
    eq(r.lifecycle, 'unknown', `5: ${tok} lifecycle unknown`);
    eq(r.lifecycle_label, 'Lifecycle unknown', `5: ${tok} lifecycle label`);
    eq(r.popup_lifecycle, 'Lifecycle unknown', `5: ${tok} popup lifecycle`);
    eq(r.category, e.category, `5: ${tok} category`);
    eq(r.symbol, e.symbol, `5: ${tok} symbol`);
    eq(r.filter_key, 'unknown', `5: ${tok} filter key`);
    ok(!r.is_facility, `5: ${tok} is NOT a facility`);
    ok(r.lifecycle !== 'operating', `5: ${tok} is not asserted to be operating`);
    eq(r.evidence_url, 'https://www.tdlr.texas.gov/TABS/Projects/' + tok.split(':')[1],
       `5: ${tok} evidence points at its own TABS project`);
  }
  // All five share ONE coordinate, so identity MUST come from the source token.
  eq(new Set(tabs.map(r => r.lat + ',' + r.lng)).size, 1, '5: the five TABS rows share one coordinate (as in production)');
  eq(new Set(tabs.map(r => r.dedupe_identity)).size, 5, '5: they still hold five distinct identities');
}

// ── 6. AUSTIN SOURCE IDENTITY ─────────────────────────────────────────────────────────
{
  const austin = dev.filter(r => r.source_registry_id !== null);
  ok(austin.length > 0, '6: Austin fixtures exist');
  ok(austin.every(r => ['austin-site-plan-cases', 'austin-subdivision-cases'].includes(r.source_registry_id)),
     '6: no Austin row changes source family');
  ok(austin.every(r => r.record_kind === 'development' && !r.is_facility),
     '6: no Austin development row becomes a facility');
  ok(austin.every(r => /^austin:folderrsn:\d+$/.test(r.source_record_token)),
     '6: every Austin row preserves the publisher\'s own record id');
  ok(austin.every(r => r.evidence_url.includes('t_selected_folderrsn=' + r.source_record_token.split(':')[2])),
     '6: the evidence URL and the record id agree');
  ok(austin.every(r => r.zip === '78617'), '6: ZIP preserved');
  // Both registries are represented on BOTH sides of the classification path.
  for (const reg of ['austin-site-plan-cases', 'austin-subdivision-cases']) {
    const g = austin.filter(r => r.source_registry_id === reg);
    ok(g.some(r => /^TYPE_EXACT:/.test(r.classification_rule)), `6: ${reg} exercises the type path`);
    ok(g.some(r => /^NAME:/.test(r.classification_rule)), `6: ${reg} exercises the name path`);
  }
  // Same title, different filing date and different case number -> three distinct records.
  const dvhs = austin.filter(r => r.name === 'Del Valle High School Addition');
  eq(dvhs.length, 3, '6: the three same-title Del Valle High School filings all survive');
  eq(new Set(dvhs.map(r => r.dedupe_identity)).size, 3, '6: they do not collapse into one');
  eq(new Set(dvhs.map(r => r.source_record_token)).size, 3, '6: each keeps its own case id');
  eq(new Set(dvhs.map(r => r.evidence_url)).size, 3, '6: each keeps its own record link');
  // A development record and an EPA facility that share a NAME must stay separate records.
  const dalfenDev = byToken.get('austin:folderrsn:12594668');
  const dalfenFac = byToken.get('epa-frs:110071346495');
  eq(dalfenDev.name.toLowerCase(), dalfenFac.name.toLowerCase(),
     '6: the Dalfen Industrial permit and facility share a name (the sources differ only in case)');
  eq(dalfenDev.record_kind, 'development', '6: ...the permit stays a development record');
  eq(dalfenFac.record_kind, 'facility', '6: ...the facility stays a facility');
  ok(dalfenDev.dedupe_identity !== dalfenFac.dedupe_identity, '6: ...and they never merge');
  // Two EPA facilities sharing a name at different points stay distinct.
  const sandhill = fac.filter(r => r.name === 'SAND HILL ENERGY CENTER');
  eq(sandhill.length, 2, '6: two distinct EPA registrations share the name SAND HILL ENERGY CENTER');
  eq(new Set(sandhill.map(r => r.source_registry_id)).size, 2, '6: ...distinguished by EPA registry id');
}

// ── 7. FACILITY PARTITION (the restFacs tail) ─────────────────────────────────────────
{
  const p = golden.facility_partition;
  eq(p.nearest.length, NEAREST_FAC_CAP, '7: exactly 24 facilities keep individual DOM squares');
  eq(p.rest.length, fac.length - NEAREST_FAC_CAP, '7: the remainder rides the rest layer');
  eq(new Set(p.nearest.concat(p.rest)).size, fac.length, '7: the partition is disjoint and total');
  // Membership is data-dependent (it moves when a coordinate moves) — what must NEVER differ is
  // how the two halves RENDER. A facility in the tail is still a purple square that filters as
  // `facility`; that is what makes the tail safe to cluster.
  for (const tok of p.rest) {
    const r = byToken.get(tok);
    ok(!!r, '7: every rest-layer facility is in the baseline');
    eq(r.symbol, 'square', `7: rest-layer ${tok} renders square`);
    eq(r.category, 'facility', `7: rest-layer ${tok} category`);
    eq(r.lifecycle, 'operating', `7: rest-layer ${tok} lifecycle`);
    eq(r.filter_key, 'facility', `7: rest-layer ${tok} filter key`);
    ok(/^https:\/\/echo\.epa\.gov\//.test(r.evidence_url), `7: rest-layer ${tok} keeps its evidence`);
  }
}

// ── 8. FULL-RUN CENSUS INVARIANTS (accepted Gate 2B, run 30180608068) ─────────────────
// The fixture is a selected subset; these pin the WHOLE 457-record page so a future export
// that has genuinely moved is caught here and explained rather than silently re-baselined.
{
  const ACCEPTED = {
    total: 457, development: 428, facilities: 29,
    austin_with_registry: 423, dev_null_registry: 5,
    'austin-site-plan-cases': 267, 'austin-subdivision-cases': 156,
    distinct_identities: 457, unsourced: 0, coordless: 0,
    content_md5: '649e6ea9e534279502e41511fe4a105a',
  };
  const live = fx._provenance.live_census_at_capture;
  for (const [k, v] of Object.entries(ACCEPTED)) eq(live[k], v, `8: full-run census ${k}`);
  eq(ACCEPTED.development + ACCEPTED.facilities, ACCEPTED.total, '8: development + facilities == total');
  eq(ACCEPTED.austin_with_registry + ACCEPTED.dev_null_registry, ACCEPTED.development,
     '8: every development row is either Austin-identified or a null-registry TABS row');
  eq(ACCEPTED['austin-site-plan-cases'] + ACCEPTED['austin-subdivision-cases'], ACCEPTED.austin_with_registry,
     '8: the two Austin registries account for every identified row');

  // Accepted whole-page category / lifecycle census (from the Gate 2B report).
  const CAT = { industrial: 21, infrastructure: 43, other: 126, commercial: 117, civic: 37, residential: 84, facility: 29 };
  const LIFE = { operating: 93, approved: 323, proposed: 36, unknown: 5 };
  eq(Object.values(CAT).reduce((a, b) => a + b, 0), 457, '8: the accepted category census sums to 457');
  eq(Object.values(LIFE).reduce((a, b) => a + b, 0), 457, '8: the accepted lifecycle census sums to 457');
  eq(CAT.facility, ACCEPTED.facilities, '8: the facility category census equals the facility count');
  eq(LIFE.unknown, ACCEPTED.dev_null_registry, '8: the unknown lifecycle census equals the TABS count');
  eq(LIFE.operating - CAT.facility, 64, '8: 64 DEVELOPMENT rows are operating (93 minus the 29 facilities)');

  // The fixture's own census must be internally consistent the same way.
  const c = golden.census;
  eq(Object.values(c.by_category).reduce((a, b) => a + b, 0), R.length, '8: fixture category census is total');
  eq(Object.values(c.by_symbol).reduce((a, b) => a + b, 0), R.length, '8: fixture symbol census is total');
  eq(Object.values(c.by_lifecycle).reduce((a, b) => a + b, 0), R.length, '8: fixture lifecycle census is total');
  for (const [cat, n] of Object.entries(c.by_category))
    eq(c.by_symbol[golden.semantic_registry[cat].symbol], n,
       `8: the symbol census matches the category census exactly for ${cat}`);
  eq(c.by_lifecycle.operating - c.by_filter_key.facility, c.by_filter_key.operating,
     '8: fixture operating lifecycle minus facilities equals the operating FILTER bucket');
}

// ── 9. THE GENERATOR'S OWN IDENTITY HELPERS ───────────────────────────────────────────
{
  eq(sourceToken({ source_ref: 'https://abc.austintexas.gov/web/permit/public-search-other?t_detail=1&t_selected_folderrsn=999' }),
     'austin:folderrsn:999', '9: Austin token');
  eq(sourceToken({ source_ref: 'https://www.tdlr.texas.gov/TABS/Projects/TABS2024022676' }),
     'tdlr-tabs:TABS2024022676', '9: TABS token');
  eq(sourceToken({ source_ref: 'https://echo.epa.gov/detailed-facility-report?fid=110071346495' }),
     'epa-frs:110071346495', '9: EPA token');
  eq(sourceToken({ source_ref: 'https://example.gov/nothing' }), null,
     '9: an unrecognised URL yields NO token rather than a fabricated one');
  ok(dedupeIdentity({ registry_id: 'r', source_ref: 'u', submitted_at: '2020-01-01', name: 'n' })
     !== dedupeIdentity({ registry_id: 'r', source_ref: 'u', submitted_at: '2021-01-01', name: 'n' }),
     '9: the filing date is part of the dedupe identity — a re-filing is a different record');
  ok(!!loadHS().CATEGORY_REGISTRY, '9: lib/map.js loads standalone');
}

console.log(`maps-delvalle-golden: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
