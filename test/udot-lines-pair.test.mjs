// Offline checks for the UDOT points+lines PAIR.
//
// WHY THIS EXISTS. `udot-active-projects` was wired against layer 0 of All_Projects — the
// POINTS layer — and that single choice is most of why Utah is 201 pages dark despite having
// a live statewide source. Measured 2026-08-23 against the live service:
//
//              layer 0 (Points)   layer 1 (Lines)
//   total             2,148            19,951
//   armed               353             5,255
//
// The reach study across all 35 statewide entries found the relationship is close to
// deterministic: high reach is dense/LINE geometry over corridors (ctdot 288/288, penndot
// 558/560, txdot 663/668 — all ~0% dark), low reach is sparse POINTS in a large state
// (udot 109/310 → 64.8% dark). A polyline intersects many ZIP radii; 353 points cannot.
//
// THE HAZARD THIS FILE GUARDS. Points and lines describe the SAME projects, so wiring both
// naively double-emits every project that has both representations — the Houston-plats class
// (~25,777 duplicated records), which exact-identity dedup CANNOT catch across two different
// source_registry_ids. The fix is the mechanism already proven on the ARDOT pair: the POINTS
// entry declares `yields_to` the LINES entry, and the yields hook drops the point copy when a
// line carries the same case_number. If that declaration is ever lost, Utah silently doubles.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const PTS = REG.arcgis.find((e) => e.registry_id === 'udot-active-projects');
const LIN = REG.arcgis.find((e) => e.registry_id === 'udot-active-projects-lines');

ok(!!PTS && !!LIN, 'both UDOT entries exist');

// ── 1. They are the two layers of ONE service ────────────────────────────────────
const BASE = 'https://services.arcgis.com/pA2nEVnB6tquxgOW/arcgis/rest/services/All_Projects/FeatureServer';
ok(PTS.service_url === `${BASE}/0`, 'points entry is layer 0');
ok(LIN.service_url === `${BASE}/1`, 'lines entry is layer 1');
ok(PTS.coverage.length === 1 && PTS.coverage[0].state === 'UT' && !PTS.coverage[0].county,
  'coverage is statewide UT (no county) — the registry contract allows this for a statewide dataset');
ok(JSON.stringify(LIN.coverage) === JSON.stringify(PTS.coverage), 'both carry the same statewide coverage');

// ── 2. THE DUPLICATE GUARD — the reason this file exists ─────────────────────────
ok(PTS.yields_to === 'udot-active-projects-lines',
  'POINTS yields_to LINES — without this, every project with both a point and a line double-emits');
ok(!Object.hasOwn(LIN, 'yields_to'),
  'LINES yields to nothing — the yield is one-directional, or the pair would cancel out');
ok(PTS.column_map.case_number === 'pin' && LIN.column_map.case_number === 'pin',
  'both key on `pin` — the yield matches on case_number, so a differing key would silently disable it');

// ── 3. Status vocabulary — all 19 live pin_stat_nm values, bucketed exactly once ──
{
  const s2b = LIN.status_to_bucket;
  const all = [...s2b.proposed, ...s2b.approved, ...s2b.operating, ...s2b.exclude];
  ok(all.length === 19 && new Set(all).size === 19,
    `all 19 live pin_stat_nm values bucketed exactly once (got ${all.length}, ${new Set(all).size} distinct)`);
  // The six that were previously UNMAPPED and silently failing closed.
  for (const [v, bucket] of [['Contract Closed Out', 'operating'], ['Contract Complete', 'operating'],
                             ['Concept Scoping', 'proposed'], ['Central Review', 'proposed'],
                             ['Advertised', 'approved'], ['Hold', 'exclude']]) {
    ok(s2b[bucket].includes(v), `${v} → ${bucket} (was unmapped before this pair landed)`);
  }
  // Same rule the Bismarck wire learned from the stalled-status lint.
  ok(s2b.exclude.includes('Hold') && !s2b.proposed.includes('Hold') && !s2b.approved.includes('Hold'),
    'Hold → exclude, never proposed/approved — a stalled value must not claim motion');
  ok(s2b.exclude.includes('Closed') && s2b.exclude.includes('Abandoned'),
    'Closed + Abandoned stay excluded (14,696 of 19,951 rows — the bulk of the layer)');
}

// ── 4. Type vocabulary inside the closed use_type set ────────────────────────────
const USE_TYPES = new Set(['Industrial', 'Development', 'Residential', 'Utility', 'Commercial', 'Civic/Public']);
{
  const bad = Object.entries(LIN.type_map).filter(([, v]) => !USE_TYPES.has(v));
  ok(bad.length === 0, 'every mapped value is one of the six canonical use_types', JSON.stringify(bad));
  for (const t of ['Preservation', 'Rehabilitation', 'Pavement Reconstruction', 'Emergency Repairs',
                   'ITS & Signals', 'Federal Lands Access Program']) {
    ok(Object.hasOwn(LIN.type_map, t), `'${t}' is mapped (live on the lines layer, absent from the points-era map)`);
  }
  // The layer publishes a WHITESPACE-ONLY proj_typ_nm on 5 rows. Mapping it would be
  // inventing a type the source does not state — absent fields stay absent.
  ok(!Object.hasOwn(LIN.type_map, ' ') && !Object.hasOwn(LIN.type_map, ''),
    'the blank/whitespace proj_typ_nm is NOT mapped — never invent a type for a value the source left empty');
}

// ── 5. The pair stays in lockstep except where it must differ ────────────────────
{
  const differ = new Set(['registry_id', 'service_url', 'yields_to']);
  const keys = new Set([...Object.keys(PTS), ...Object.keys(LIN)]);
  const drift = [...keys].filter((k) => !differ.has(k)
    && JSON.stringify(PTS[k]) !== JSON.stringify(LIN[k]));
  ok(drift.length === 0,
    'points and lines are identical apart from registry_id, service_url and yields_to',
    JSON.stringify(drift));
}

console.log();
if (fails) { console.log(`${fails} check(s) FAILED`); process.exit(1); }
console.log('All udot-lines-pair checks passed.');
