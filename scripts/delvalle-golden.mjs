// scripts/delvalle-golden.mjs — the PERMANENT Del Valle (78617) maps golden baseline.
//
// RELATIONSHIP TO scripts/backbone-golden-diff.ts (read this before adding another harness):
// PR #400 owns ONE golden contract with TWO halves, and this is the second half.
//
//   half A — scripts/backbone-golden-diff.ts (DIFFERENTIAL, engine-side)
//     Runs the five registry-driven CONNECTORS on frozen inputs at the BASE commit and at the
//     branch and diffs the two stdouts. It proves the refactor changed no connector output.
//     Two things it structurally cannot do: (1) it dies the moment it merges — once base ==
//     branch it compares a thing to itself; and (2) it stops at the connector, so it never
//     sees a category, a symbol, a lifecycle, a colour or a popup.
//
//   half B — THIS FILE (SNAPSHOT, render-side)
//     A committed expected baseline over production-derived Del Valle records, compared by
//     test/maps-delvalle-golden.test.mjs on every run. It survives the merge and it protects
//     exactly what half A cannot: the semantic contract in lib/map.js.
//
// They are deliberately NOT merged into one script. The semantic repair intentionally CHANGED
// lib/map.js, so feeding it into half A's base-vs-branch diff would make the zero-diff gate red
// for a legitimate reason and destroy the signal half A exists to give. Same contract, same
// canonical-JSON conventions (`canon` below is the same shape as half A's), same PR.
//
// NO NETWORK, NO DATABASE, NO BROWSER. The input is a committed fixture of verbatim production
// rows; the only code under test is lib/map.js, loaded the same way the other maps tests load it.
//
// Usage:  node scripts/delvalle-golden.mjs            # print the baseline
//         node scripts/delvalle-golden.mjs --write     # regenerate the committed expected file

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE = join(ROOT, 'test/fixtures/delvalle-golden/records.json');
export const EXPECTED = join(ROOT, 'test/fixtures/delvalle-golden/expected.json');

/** The page's facility cap — maps.html:351 `facsAllMappable.slice(0, 24)`. */
export const NEAREST_FAC_CAP = 24;

/**
 * Load the real shipped libraries exactly as the browser does: one global `window`, one `HS`
 * namespace. lib/data.js is loaded too — NOT for its network paths (never invoked here) but so
 * `distanceMi`/`fmtMi` come from the ONE implementation the page uses. Re-deriving the haversine
 * locally would let the baseline agree with itself while disagreeing with the page.
 */
export function loadHS() {
  const win = { HS: {}, HS_CONFIG: { DATA_SOURCE: 'seed' } };
  const doc = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
  for (const f of ['lib/map.js', 'lib/data.js'])
    new Function('window', 'document', readFileSync(join(ROOT, f), 'utf8'))(win, doc);
  return win.HS;
}

/** Canonical stringify — key order never affects the diff (same rule as the differential half). */
export function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}

/**
 * The STABLE SOURCE TOKEN — the identifier the publisher itself assigns, lifted out of the
 * evidence URL. This is what makes a fixture selectable without an array index: re-export the
 * table in any order and `austin:folderrsn:12594668` still names the same filing.
 * A row whose URL carries no publisher id returns null rather than a fabricated token.
 */
export function sourceToken(rec) {
  const u = rec.source_ref || '';
  let m;
  if ((m = u.match(/t_selected_folderrsn=(\d+)/))) return 'austin:folderrsn:' + m[1];
  if ((m = u.match(/\/TABS\/Projects\/(TABS\d+)/))) return 'tdlr-tabs:' + m[1];
  if ((m = u.match(/[?&]fid=(\d+)/))) return 'epa-frs:' + m[1];
  return null;
}

/**
 * The DEDUPE IDENTITY. Deliberately includes the filing date and the publisher's own record id:
 * the same title re-filed on a new date is a DIFFERENT real filing (three "Del Valle High School
 * Addition" site plans; two EPA facilities named "SAND HILL ENERGY CENTER"). Collapsing on title
 * alone would delete real public records, so title is only ever one component.
 */
export function dedupeIdentity(rec) {
  return [rec.registry_id || '(null)', rec.source_ref || '', rec.submitted_at || '(no-date)', rec.name || ''].join('|');
}

/** lib/data.js::withDistance — the same haversine, so `dist` in a popup title is real. */
function distanceMi(HS, origin, rec) {
  return HS.distanceMi(origin.lat, origin.lng, rec.lat, rec.lng);
}

/**
 * Build ONE golden record. Every field the contract protects is here and nothing that drifts
 * on its own (no export timestamp, no array index, no browser handle, no screenshot bytes).
 */
export function goldenRecord(HS, origin, rec) {
  const mi = distanceMi(HS, origin, rec);
  // The item shape lib/data.js hands the renderer.
  const item = Object.assign({}, rec, { distance_mi: mi, dist: HS.fmtMi(mi) });
  delete item.why;
  const m = HS.resolveMarker(item);
  return {
    source_registry_id: rec.registry_id === undefined ? null : rec.registry_id,
    source_record_token: sourceToken(rec),
    dedupe_identity: dedupeIdentity(rec),
    name: rec.name,
    record_kind: rec.record_kind,
    source_type_raw: rec.type === undefined ? null : rec.type,
    source_status_raw: rec.status === undefined ? null : rec.status,
    lifecycle: m.lifecycle,
    lifecycle_label: m.lifecycleLabel,
    category: m.categoryKey,
    symbol: m.shape,
    color: m.color,
    zip: rec.zip,
    lat: rec.lat,
    lng: rec.lng,
    evidence_url: rec.source_ref,
    filter_key: m.filterKey,
    fallback_reason: m.fallbackReason,
    classification_rule: m.shapeRule,
    popup_title: m.popupLabel,
    popup_category: m.legendLabel,
    popup_lifecycle: m.statusLabel,
    popup_evidence_destination: rec.source_ref,
    is_facility: m.isFacility,
  };
}

/**
 * The facility partition, by the page's own rule (maps.html:349-352): every MAPPABLE facility
 * sorted by distance from the report origin, nearest 24 keep individual DOM squares, the tail
 * rides the rest layer. Membership is DATA-dependent (it moves if a coordinate moves), so the
 * baseline records it explicitly and the test asserts the CONTRACT (disjoint, union = all,
 * identical rendering on both sides) rather than treating membership as a semantic constant.
 */
export function facilityPartition(HS, origin, facilities) {
  const withDist = facilities
    .map(f => ({ f, mi: distanceMi(HS, origin, f) }))
    .sort((a, b) => (a.mi == null ? 9e9 : a.mi) - (b.mi == null ? 9e9 : b.mi));
  return {
    nearest: withDist.slice(0, NEAREST_FAC_CAP).map(x => sourceToken(x.f)),
    rest: withDist.slice(NEAREST_FAC_CAP).map(x => sourceToken(x.f)),
  };
}

export function build() {
  const HS = loadHS();
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const origin = fx._provenance.origin;
  const recs = fx.records;

  // Deterministic order: by dedupe identity. Never by input position.
  const records = recs.map(r => goldenRecord(HS, origin, r))
    .sort((a, b) => (a.dedupe_identity < b.dedupe_identity ? -1 : a.dedupe_identity > b.dedupe_identity ? 1 : 0));

  const facilities = recs.filter(r => r.record_kind === 'facility');
  const count = (f) => records.reduce((a, r) => { const k = f(r); a[k] = (a[k] || 0) + 1; return a; }, {});

  // The closed semantic registry, read from lib/map.js itself — not restated here, so the
  // baseline cannot drift away from the implementation without the diff showing it.
  const registry = {};
  for (const k of Object.keys(HS.CATEGORY_REGISTRY).sort())
    registry[k] = { symbol: HS.CATEGORY_REGISTRY[k].symbol, label: HS.CATEGORY_REGISTRY[k].label };

  return canon({
    contract_version: 1,
    zip: '78617',
    origin,
    fixture_records: records.length,
    semantic_registry: registry,
    legend_shapes: (HS.SHAPE_LEGEND || []).map(x => ({ shape: x.shape, label: x.label, categoryKey: x.categoryKey })),
    lifecycle_chips: (HS.STATUS_LEGEND_ROWS || []).map(x => ({ key: x.key, label: x.label })),
    census: {
      by_source_registry: count(r => r.source_registry_id || '(null)'),
      by_record_kind: count(r => r.record_kind),
      by_category: count(r => r.category),
      by_symbol: count(r => r.symbol),
      by_lifecycle: count(r => r.lifecycle),
      by_filter_key: count(r => r.filter_key),
      with_fallback_reason: records.filter(r => r.fallback_reason).length,
    },
    facility_partition: facilityPartition(HS, origin, facilities),
    records,
  });
}

export function serialize(golden) { return JSON.stringify(golden, null, 1) + '\n'; }
export function checksum(golden) { return createHash('sha256').update(serialize(golden)).digest('hex'); }

if (process.argv[1] && process.argv[1].endsWith('delvalle-golden.mjs')) {
  const g = build();
  if (process.argv.includes('--write')) {
    writeFileSync(EXPECTED, serialize(g));
    console.log('wrote ' + EXPECTED + '\nsha256 ' + checksum(g));
  } else {
    console.log(serialize(g));
  }
}
