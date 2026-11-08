// Cleveland's type_map rebucket, and the whitelist invariant it exposed.
//
// WHAT WAS WRONG. All four of this entry's whitelisted `PERMIT_SUBTYPE` values mapped to
// `Development` — the GENERIC member of the closed six-value use_type vocabulary, which
// lib/map.js treats as NON-TERMINAL. So every record fell through to keyword guessing and
// landed on the "Other project" circle: 92,372 stored rows across 39 ZIP pages, ZERO of them
// `unclassified`. That last fact is the trap — this was never a type_map MISS, so any audit
// keyed on `unclassified` would have scored Cleveland perfectly clean.
//
// WHAT THE LIVE RE-ENUMERATION FOUND (2026-08-19, this entry's own scope, controls reconciling
// exactly: in-window 14,618 rows / 4 values / sum 14,618 by three agreeing methods; all-time
// 196,741 / 5 / 196,741):
//   • `Building` was in include_types AND type_map and matches 0 rows ALL-TIME — a config line
//     asserting a value that has never existed.
//   • `Install Permits` (109 rows, current) was being dropped AT SOURCE because the whitelist
//     predated it. It first appeared 2026-03-18 — after this entry was wired.
//   • The publisher is MIGRATING: `Building Permits` did not exist before 2025-08-29 and is now
//     the in-window plurality (57.1%).
//
// WHY `Building Permits` AND `Install Permits` STAY GENERIC. Those labels genuinely do not state
// what is being built. Giving them a specific pin shape would be a fabricated claim about a real
// named project — the opposite of what the generic circle is for. Only `Residential` and
// `Commercial`, which DO state a class, get a specific shape.
//
// Run: node test/cleveland-type-map.test.mjs   (discovered by scripts/run-unit-tests.mjs)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'supabase/functions/get-address-report/sources');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const REG = JSON.parse(readFileSync(join(ROOT, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const ENTRY = REG.arcgis.find((e) => e.registry_id === 'cleveland-issued-building-permits');

let arcgisForZip;
try { ({ arcgisForZip } = await import(join(SRC, 'arcgis.ts'))); }
catch (err) {
  console.log('FAIL — import sources/arcgis.ts (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}
global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/project-type.js');
await import('../lib/map.js');
const HS = global.window.HS;

// ── 1. the shipped config ────────────────────────────────────────────────────────────────
{
  ok(!!ENTRY, '1a the entry is in the registry');
  // ⚠️ FOUR -> FIVE, 2026-09-11, and the ADDITION is the point rather than a loosened pin.
  // The four-value enumeration below was correct when written and was overtaken by a fresher
  // in-scope probe: scripts/source-monitor.mjs measured `Fire Permits` IN-WINDOW on this
  // entry's own scope (extra_where PERMIT_TYPE IN ('Building Permit','Construction Project')
  // AND ISSUE_DATE IS NOT NULL, recency ISSUE_DATE >= 2025-09-11) and gated the run, because
  // include_types is pushed into the query and an unlisted value is NEVER FETCHED. That is
  // the same mechanism that dropped this entry's `Install Permits` for five months.
  // The list stays EXACT — a set, verbatim, asserted whole — so a future value still gates.
  // ⚠️ SUPERSEDED 2026-10-22 (the founder's Columbus "hide repairs" ruling applied to Cleveland):
  // the Type now comes from PERMIT_SUBTYPE + PERMIT_TYPE + PERMIT_CATEGORY, a joined key, and
  // include_types cannot filter a joined key, so the five-value whitelist moved VERBATIM into
  // extra_where. The checks below assert the same facts in their new home. The full re-type is
  // pinned by test/cleveland-retype-2026-10-22.test.mjs.
  ok(!ENTRY.include_types, '1b include_types is gone (it cannot filter the joined type key)');
  ok(/PERMIT_SUBTYPE IN \('Building Permits','Commercial','Install Permits','Residential','Fire Permits'\)/.test(ENTRY.extra_where),
    '1b2 the LIVE in-window vocabulary, all five values verbatim, now filters in extra_where', ENTRY.extra_where);
  ok(!/'Building'[,)]/.test(ENTRY.extra_where) && !Object.keys(ENTRY.type_map).some((k) => k === 'Building'),
    '1c `Building` stays GONE — it matched 0 rows all-time');
  ok(ENTRY.type_map['Fire Permits Construction Project Fire Suppression Systems'] === 'Development'
    && ENTRY.type_map['Install Permits Construction Project Elevator Dumbwaiter'] === 'Development',
    '1d Install and Fire permits state no building class and stay generic');
  ok(ENTRY.type_map['Residential Building Permit New'] === 'Residential'
    && ENTRY.type_map['Commercial Building Permit New'] === 'Commercial',
    '1e the self-describing classes map to their OWN class, not to the generic member');
  ok(ENTRY.type_map['Building Permits Construction Project Residential Building'] === 'Residential'
    && ENTRY.type_map['Building Permits Construction Project Commercial Building'] === 'Commercial',
    '1f `Building Permits` now takes its class from PERMIT_CATEGORY, which states one');
}

// ── 2. THE PAYOFF, through the SHIPPED resolver: the pin shape actually changes ───────────
// Asserting the config alone would prove nothing — `Development` is non-terminal, so the claim
// "these records now get a real shape" is only true if lib/map.js says so.
{
  const shapeOf = (useType, name) => HS.resolveMarker({ use_type: useType, status: 'Approved', name, title: name });
  const res = shapeOf('Residential', '1234 W 25TH ST');
  const com = shapeOf('Commercial', '5000 EUCLID AVE');
  const gen = shapeOf('Development', '900 ROCKWELL AVE');
  ok(res.categoryKey === 'residential',
    '2a a `Residential` record resolves to the residential category', JSON.stringify(res.categoryKey));
  ok(com.categoryKey === 'commercial',
    '2b a `Commercial` record resolves to the commercial category', JSON.stringify(com.categoryKey));
  ok(gen.categoryKey === 'other' && gen.shapeRule === 'FALLBACK:other',
    '2c a `Development` record still falls through to the honest `other` circle, unchanged',
    `${gen.categoryKey} / ${gen.shapeRule}`);
  ok(res.categoryKey !== gen.categoryKey && com.categoryKey !== gen.categoryKey,
    '2d THE POINT: the two rebucketed values no longer share a category with the generic bucket');
  ok(res.shape !== gen.shape && com.shape !== gen.shape,
    '2e …and the SHAPE differs too, so the change is visible on the map, not just in the data',
    `${res.shape} / ${com.shape} / ${gen.shape}`);
  ok(!!gen.fallbackReason && !res.fallbackReason && !com.fallbackReason,
    '2f the generic record still carries a STATED fallbackReason and the classified two carry none',
    JSON.stringify(gen.fallbackReason));
}

// ── 3. driven end-to-end through the shipped connector ───────────────────────────────────
{
  const CLE = [{ state: 'OH', county: 'Cuyahoga' }];
  const row = (sub, type, cat) => ({
    OBJECTID: 1, PERMIT_ID: 'B2026-1', PERMIT_SUBTYPE: sub, PERMIT_CATEGORY: cat, JOB_DESCRIPTION: 'Alteration',
    PERMIT_TYPE: type, ISSUE_DATE: Date.parse('2026-08-01'),
    PRIMARY_ADDRESS: '1234 W 25TH ST', LAT: 41.4842, LON: -81.7029,
    ACCELA_CITIZEN_ACCESS_URL: 'https://aca.clevelandohio.gov/record/B2026-1',
  });
  const drive = async (sub, type, cat) => {
    const fetch = async () => new Response(JSON.stringify({
      objectIdFieldName: 'OBJECTID', geometryType: 'esriGeometryPoint', fields: [],
      features: [{ attributes: row(sub, type, cat), geometry: { x: -81.7029, y: 41.4842 } }],
      exceededTransferLimit: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const { sites } = await arcgisForZip('44113', CLE, [ENTRY], { fetch, zipCentroid: { lat: 41.4842, lng: -81.7029 } });
    return sites[0];
  };
  const r = await drive('Residential', 'Building Permit', 'New');
  ok(r?.use_type === 'Residential', '3a the connector emits use_type Residential', JSON.stringify(r?.use_type));
  ok(r?.type_raw === 'Residential Building Permit New', '3b …and type_raw records the joined publisher key', JSON.stringify(r?.type_raw));
  const i = await drive('Install Permits', 'Construction Project', 'Elevator Dumbwaiter');
  ok(!!i, '3c an `Install Permits` row is EMITTED rather than dropped at source');
  ok(i?.use_type === 'Development', '3d …and lands on the generic member, as ruled', JSON.stringify(i?.use_type));
  ok(i?.type_raw === 'Install Permits Construction Project Elevator Dumbwaiter',
    '3e …with type_raw naming it, so its arrival is auditable rather than invisible');
}

// ── 4. THE FLEET INVARIANT the `Building` bug exposed ─────────────────────────────────────
// A whitelisted value with no type_map line is fetched and then emitted as `unclassified` —
// config that looks complete and quietly produces unclassified pins. Holds today across all
// 10 include_types entries; this keeps it holding.
{
  const entries = Object.values(REG).filter(Array.isArray).flat()
    .filter((e) => e && typeof e === 'object' && Array.isArray(e.include_types));
  ok(entries.length >= 10, `4a found the include_types entries to check (${entries.length})`);
  const gaps = entries.filter((e) => !e.use_type_const
    && e.include_types.some((t) => !((e.type_map || {})[String(t).trim()])));
  ok(gaps.length === 0,
    '4b every whitelisted type value has a type_map line (or a use_type_const) — no value is '
    + 'fetched only to be emitted `unclassified`', gaps.map((e) => e.registry_id).join(', '));
}

console.log(fails ? `\n${fails} cleveland-type-map assertion(s) FAILED.` : '\nAll cleveland-type-map assertions passed.');
process.exit(fails ? 1 : 0);
