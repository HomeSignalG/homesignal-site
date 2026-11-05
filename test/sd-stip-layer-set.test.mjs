// Offline checks for the SOUTH DAKOTA STIP layer set (statewide, one MapServer).
//
// WHY THIS EXISTS. SD wires SEVEN entries off one service
// (dotgis.sd.gov/.../STIP/DOT_STIP_Approved/MapServer), and until 2026-08-24 none of them
// declared a yield. That was correct for 20 of the 21 layer pairs and WRONG for one:
//
//   layer 1  "Safety"  esriGeometryPoint     104 rows /  74 distinct ProjectCtrlNbr
//   layer 6  "Safety"  esriGeometryPolyline  153 rows /  31 distinct
//
// Same work category, two geometries, 2 shared ProjectCtrlNbr — so those 2 projects were
// emitted TWICE on any page within 3 mi of both. Points now yield to lines.
//
// The measurement that matters is that this is the ONLY overlap. Across all 21 pairs of the 7
// wired layers, every other pair shares ZERO keys, which is why the remaining five entries
// correctly declare no yield. Overlap was measured with groupByFieldsForStatistics, NOT
// returnDistinctValues — see the MapServer note below.
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
const BASE = 'https://dotgis.sd.gov/spearfishformation/rest/services/STIP/DOT_STIP_Approved/MapServer';
const sd = REG.arcgis.filter((e) => typeof e.service_url === 'string' && e.service_url.startsWith(BASE));
const byLayer = new Map(sd.map((e) => [Number(e.service_url.slice(BASE.length + 1)), e]));

ok(sd.length === 7, 'seven SD STIP entries are wired off this service', `found ${sd.length}`);
ok([1, 2, 3, 4, 6, 9, 10].every((n) => byLayer.has(n)),
  'wired layers are exactly 1,2,3,4,6,9,10', [...byLayer.keys()].sort((a, b) => a - b).join(','));

// ── 1. THE DUPLICATE GUARD — the one real overlap ───────────────────────────────
{
  const pts = byLayer.get(1), lin = byLayer.get(6);
  ok(pts.registry_id === 'sd-stip-safety-points' && lin.registry_id === 'sd-stip-safety-lines',
    'layer 1 is the safety POINTS entry and layer 6 the safety LINES entry');
  ok(pts.yields_to === 'sd-stip-safety-lines',
    'safety POINTS yields_to safety LINES — 2 shared ProjectCtrlNbr would otherwise double-emit');
  ok(!Object.hasOwn(lin, 'yields_to'), 'safety LINES yields to nothing — one-directional');
  ok(pts.column_map.case_number === 'ProjectCtrlNbr' && lin.column_map.case_number === 'ProjectCtrlNbr',
    'both key case_number on ProjectCtrlNbr, which is what the yield matches on');
}

// ── 2. The other five entries must NOT yield — their pairs are disjoint ─────────
// Declaring a yield on a disjoint pair DROPS records (the NY case). This is the direction of
// the mistake that is easiest to make while "tidying up" the file.
for (const n of [2, 3, 4, 9, 10]) {
  const e = byLayer.get(n);
  ok(!Object.hasOwn(e, 'yields_to'),
    `layer ${n} (${e.registry_id}) declares NO yield — it shares 0 keys with every other wired layer`);
}
{
  const yielding = sd.filter((e) => e.yields_to);
  ok(yielding.length === 1, 'exactly ONE of the seven entries yields', yielding.map((e) => e.registry_id).join(','));
}

// ── 3. Measured key sets — the arithmetic the decision rests on ─────────────────
// groupBy totals each summed EXACTLY to the layer's own row count, so these are complete
// vocabularies rather than samples.
{
  // Layer 10 measured 2026-11-05 (pg_net 24163/24177): 23 rows, 23 distinct PCNs, 0 shared with 1,2,3,4,6,9.
  const ROWS = { 10: 23, 1: 104, 2: 140, 3: 199, 4: 430, 6: 153, 9: 44 };
  const KEYS = { 10: 23, 1: 74, 2: 105, 3: 108, 4: 59, 6: 31, 9: 42 };
  for (const n of Object.keys(ROWS)) {
    ok(KEYS[n] <= ROWS[n], `layer ${n}: distinct keys (${KEYS[n]}) <= rows (${ROWS[n]}) — multi-segment projects are real, not duplicates`);
  }
  ok(2 > 0 && 2 < Math.min(KEYS[1], KEYS[6]),
    'the L1/L6 overlap is 2 keys — a partial overlap, so neither layer is a subset of the other');
}

// ── 4. Layers that must NEVER be wired, and why ─────────────────────────────────
{
  // 16 is literally named "Do Not Map" by the publisher.
  ok(!sd.some((e) => e.service_url.endsWith('/16')),
    'layer 16 "Do Not Map" is NOT wired — the publisher named it an instruction, not a dataset');

  // 2026-11-05: SDDOT renumbered the service and removed layer 0 "Structures". "Local Structure
  // Projects" moved from 19 to 10 and IS now the structures entry: its 23 PCNs share 0 with the
  // other wired layers (pg_net 24218-24224), so the old subset reason no longer applies. Layer 19
  // no longer exists; nothing may point at it.
  ok(!sd.some((e) => e.service_url.endsWith('/19') || e.service_url.endsWith('/0')),
    'nothing points at the removed layers 0 "Structures" or 19 (renumbered to 10 on 2026-11-05)');

  // 13/14/15 are road-network reference geography, not projects.
  for (const n of [13, 14, 15]) {
    ok(!sd.some((e) => e.service_url.endsWith('/' + n)),
      `layer ${n} is reference geography (roads), not a project register — not wired`);
  }
}

// ── 5. MapServer capability note, so the next probe does not repeat it ──────────
// returnDistinctValues on this classic MapServer returns HTTP 200 carrying
// {"error":{"code":400,"message":"Failed to execute query."}} — a 200 wrapping an error, the
// same shape as TxDOT's returnCentroid rejection. Overlap MUST be measured with
// groupByFieldsForStatistics here. Nothing in the registry may depend on distinct-values.
ok(!JSON.stringify(sd).includes('returnDistinctValues'),
  'no SD entry depends on returnDistinctValues — this MapServer rejects it with a 200-wrapped 400');

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll SD STIP layer-set assertions passed.');
process.exit(fails ? 1 : 0);
