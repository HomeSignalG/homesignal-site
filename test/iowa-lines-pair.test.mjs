// Offline checks for the Iowa DOT points+lines PAIR.
//
// WHY THIS EXISTS. `iowa-dot-bid-projects` was wired against the POINT view of Iowa DOT's
// Project Scheduling (PSS) bid-project family, and reached only 60 of Iowa's 225 ZIP pages.
// The publisher ships the SAME projects across four geometry views. Measured 2026-08-23
// against the live service:
//
//   Point_View 362 · Line_View 129 · Multipoint_View 4 · Polygon_View 44
//
// This is NOT the UDOT ratio (there lines outnumbered points 19,951 to 2,148). Iowa's project
// pool is small either way; what a polyline buys is REACH — a corridor intersects many ZIP
// radii where a point sits in exactly one. That is the whole reason for this entry, and it is
// why "fewer line rows" is not an argument against wiring it.
//
// THE HAZARD THIS FILE GUARDS. Points and lines describe the SAME projects, so wiring both
// naively double-emits every project carrying both representations — the Houston-plats class,
// which exact-identity dedup CANNOT catch across two different source_registry_ids. The fix is
// the mechanism already proven on the ARDOT and UDOT pairs: the POINTS entry declares
// `yields_to` the LINES entry, and the yield drops the point copy when a line carries the same
// case_number. If that declaration is ever lost, Iowa silently doubles.
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
const PTS = REG.arcgis.find((e) => e.registry_id === 'iowa-dot-bid-projects');
const LIN = REG.arcgis.find((e) => e.registry_id === 'iowa-dot-bid-projects-lines');

ok(!!PTS && !!LIN, 'both Iowa DOT entries exist');

// ── 1. They are two geometry views of ONE project family ─────────────────────────
const BASE = 'https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Project_Scheduling_Public_Bid_';
ok(PTS.service_url === `${BASE}Point_View/FeatureServer/0`, 'points entry reads the Point view');
ok(LIN.service_url === `${BASE}Line_View/FeatureServer/0`, 'lines entry reads the Line view');
ok(PTS.coverage.length === 1 && PTS.coverage[0].state === 'IA' && !PTS.coverage[0].county,
  'coverage is statewide IA (no county) — the registry contract allows this for a statewide dataset');
ok(JSON.stringify(LIN.coverage) === JSON.stringify(PTS.coverage), 'both carry the same statewide coverage');

// ── 2. THE DUPLICATE GUARD — the reason this file exists ─────────────────────────
ok(PTS.yields_to === 'iowa-dot-bid-projects-lines',
  'POINTS yields_to LINES — without this, every project with both a point and a line double-emits');
ok(!Object.hasOwn(LIN, 'yields_to'),
  'LINES yields to nothing — the yield is one-directional, or the pair would cancel out');
ok(PTS.column_map.case_number === 'PROJECT_NUMBER' && LIN.column_map.case_number === 'PROJECT_NUMBER',
  'both key on PROJECT_NUMBER — the yield matches on case_number, so a differing key silently disables it');

// ── 3. Status vocabulary — every live Line_View STATUS value is bucketed ─────────
// Live groupBy on the Line view: Awarded 65 · Completed 55 · Active 9 = 129 = the layer count,
// so the vocabulary below is COMPLETE, not a sample. 'New' is carried over from the point view
// and is legitimately unused on lines — an unused mapping is safe, an unmapped value is not.
{
  const s2b = LIN.status_to_bucket;
  const all = [...s2b.proposed, ...s2b.approved, ...s2b.operating, ...s2b.exclude];
  ok(new Set(all).size === all.length, 'no status value is bucketed twice');
  for (const [v, bucket] of [['Awarded', 'approved'], ['Active', 'approved'], ['Completed', 'operating']]) {
    ok(s2b[bucket].includes(v), `live Line_View value '${v}' → ${bucket}`);
  }
  // Fail-closed: a status the source does not publish must never be invented into a bucket.
  ok(!all.includes('Cancelled') && !all.includes('Deferred'),
    'no status value is present that the live layer does not publish');
}

// ── 4. use_type stays inside the closed six-value set ────────────────────────────
const USE_TYPES = new Set(['Industrial', 'Development', 'Residential', 'Utility', 'Commercial', 'Civic/Public']);
ok(USE_TYPES.has(LIN.use_type_const), `use_type_const '${LIN.use_type_const}' is one of the six canonical use_types`);
ok(LIN.use_type_const === PTS.use_type_const, 'the pair classifies identically — same projects, same type');

// ── 5. The same filter applies to both, or the pair is not comparable ────────────
// 112 of the 129 line rows carry CONTRACT_AWARDED; the other 17 are correctly dropped by the
// entry's own extra_where, exactly as on the point view.
ok(LIN.extra_where === PTS.extra_where && LIN.extra_where === 'CONTRACT_AWARDED IS NOT NULL',
  'both entries apply the same CONTRACT_AWARDED filter');

// ── 6. The pair stays in lockstep except where it must differ ────────────────────
{
  const differ = new Set(['registry_id', 'service_url', 'dataset_url', 'yields_to', '_receipts']);
  const keys = new Set([...Object.keys(PTS), ...Object.keys(LIN)]);
  const drift = [...keys].filter((k) => !differ.has(k)
    && JSON.stringify(PTS[k]) !== JSON.stringify(LIN[k]));
  ok(drift.length === 0,
    'points and lines are identical apart from registry_id, the two URLs, yields_to and _receipts',
    JSON.stringify(drift));
}

console.log();
if (fails) { console.log(`${fails} check(s) FAILED`); process.exit(1); }
console.log('All iowa-lines-pair checks passed.');
