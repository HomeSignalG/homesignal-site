// Offline guard for the CONNECTOR OPTION SURFACE — no network, no DB.
//
// THE CLASS. Registry entries are plain JSON handed to one of five connectors. A key the receiving
// connector does not implement is not an error and not a warning — it is SILENTLY IGNORED. So an
// entry can look complete, pass every other test, and do something entirely different from what its
// author wrote down. This is the same family as the `status_const` defect (see
// test/status-const-must-be-mapped.test.mjs) but broader, and it is LIVE:
//
//   `include_types` is implemented ONLY by sources/csv.ts (`grep -rn include_types sources/` matches
//   csv.ts and nothing else), yet SEVEN entries on arcgis/socrata carry it. In every one it mirrors
//   the entry's own type_map exactly, so the author plainly meant it as a drop-filter. It drops
//   nothing. And an unmapped TYPE does not fail closed the way an unmapped STATUS does —
//   `arcgis.ts:354` is `typeHit?.value || entry.use_type_const || "unclassified"`, so the row is
//   published anyway, labelled "unclassified".
//
//   Measured in the live cache 2026-08-03: columbus-building-permits 40,469 of 42,067 records
//   (96.2%) unclassified; cincinnati 7,856 of 10,842 (72.5%); nashville 3,561 of 9,025 (39.5%);
//   portland 177 of 2,329 (7.6%). Where an `extra_where` happens to duplicate the intent the number
//   collapses (cleveland 0.7%, fairfax x2 0%) — which is the tell that the filter, not the data, is
//   what differs. ~52,000 records published beyond intent.
//
// Fixing those entries changes what residents see, so it is a GATED change and is NOT done here.
// What this suite does is make the class impossible to re-introduce, and pin the known set so it
// cannot silently grow.
//
// THE DANGEROUS CASE IS A TYPO. `recency_day`, `spatial_point_cols`, `max_row` — each would be
// accepted by the JSON, ignored by the connector, and invisible in review. That is why unknown keys
// are rejected by default rather than merely reported.
// Run: node scripts/run-unit-tests.mjs   (or: node test/connector-option-surface.test.mjs)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? '\n     ' + detail : ''}`); }
};

const SRC = new URL('../supabase/functions/get-address-report/sources/', import.meta.url);
const CONNECTORS = ['arcgis', 'socrata', 'carto', 'ckan', 'csv'];

/** The option names a connector's own RegistryEntry interface declares. */
function declaredOptions(name) {
  const src = readFileSync(new URL(`${name}.ts`, SRC), 'utf8');
  const m = src.match(/export interface \w*RegistryEntry[^{]*\{([\s\S]*?)\n\}/);
  if (!m) return null;
  const out = new Set();
  for (const line of m[1].split('\n')) {
    const g = line.match(/^ {2}([a-z_][A-Za-z0-9_]*)\??:/);   // top-level members only
    if (g) out.add(g[1]);
  }
  return out;
}

const OPTS = Object.fromEntries(CONNECTORS.map((c) => [c, declaredOptions(c)]));

const reg = JSON.parse(readFileSync(
  new URL('../supabase/functions/get-address-report/jurisdiction-registry.json', import.meta.url), 'utf8'));
const entries = [];
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === 'object') { if (o.registry_id) entries.push(o); Object.values(o).forEach(walk); }
})(reg);

// Keys that are DOCUMENTATION, read by no connector and intended that way. Listed explicitly so a
// typo'd real option can never hide among them by looking annotation-ish.
const ANNOTATION_KEYS = new Set(['_receipts', '_notes', '_comment', '_zip_mode_note',
  'status_unresolved', 'vocab_terminal']);

// KNOWN, MEASURED, GATED — entries carrying an option their connector ignores. The fix changes what
// residents see, so it needs the founder. This list may only ever SHRINK.
const KNOWN_IGNORED = new Map([
  ['cincinnati-building-permits', ['include_types']],
  ['columbus-building-permits', ['include_types']],
  ['cleveland-issued-building-permits', ['include_types']],
  ['nashville-building-permits-issued', ['include_types']],
  ['portland-building-permits', ['include_types']],
  ['fairfax-active-site-construction', ['include_types']],
  ['fairfax-recent-building-permits', ['include_types']],
]);
// An entry whose `platform` has no connector at all does nothing whatsoever. Known + queued
// (QUEUE.md item 8, SHELBY-429: build the opendatasoft connector).
const KNOWN_NO_CONNECTOR = new Set(['shelby-county-building-permits']);

console.log(`1) every connector's option surface is readable (${CONNECTORS.length} connectors, ${entries.length} entries)`);
for (const c of CONNECTORS) {
  ok(`${c}.ts declares a RegistryEntry interface with options`, OPTS[c] && OPTS[c].size > 5,
    `${c}: ${OPTS[c] ? OPTS[c].size : 'NOT PARSED'}`);
}
ok('the parse found the options this suite reasons about',
  OPTS.csv.has('include_types') && OPTS.arcgis.has('status_const') && OPTS.socrata.has('recency_expr'),
  'interface shape changed — the extractor needs updating, do NOT weaken it');

console.log('\n2) NO ENTRY carries an option its connector silently ignores (beyond the known set)');
{
  const offenders = [];
  for (const e of entries) {
    const known = OPTS[e.platform];
    if (!known) { if (!KNOWN_NO_CONNECTOR.has(e.registry_id)) offenders.push(`${e.registry_id}: platform "${e.platform}" has NO connector`); continue; }
    const allowed = new Set(KNOWN_IGNORED.get(e.registry_id) || []);
    const unknown = Object.keys(e).filter((k) => !ANNOTATION_KEYS.has(k) && !known.has(k) && !allowed.has(k));
    if (unknown.length) offenders.push(`${e.registry_id} [${e.platform}] -> ${unknown.join(', ')}`);
  }
  ok('no NEW silently-ignored option', offenders.length === 0, offenders.join('\n     '));
}

console.log('\n3) the KNOWN list is a ratchet — it may shrink, never grow');
{
  // If an entry is fixed, it must leave the list. If the list still names it, the reader is being
  // told a defect exists that does not — which is its own kind of false record.
  const stale = [...KNOWN_IGNORED].filter(([id, keys]) => {
    const e = entries.find((x) => x.registry_id === id);
    return !e || !keys.some((k) => k in e);
  });
  ok('every KNOWN_IGNORED entry still actually carries the ignored option', stale.length === 0,
    `no longer applicable — remove from the list: ${stale.map(([id]) => id).join(', ')}`);
  const stillNoConnector = [...KNOWN_NO_CONNECTOR].filter((id) => {
    const e = entries.find((x) => x.registry_id === id);
    return e && OPTS[e.platform];
  });
  ok('KNOWN_NO_CONNECTOR entries still have no connector', stillNoConnector.length === 0,
    `connector now exists — remove from the list: ${stillNoConnector.join(', ')}`);
}

console.log('\n4) INFO — cross-connector semantic divergence (not failable, but do not guess from a name)');
{
  // These are recorded because the NAME is identical while the behaviour is not. A wire written from
  // one connector's habit and pasted into another is the whole failure mode.
  const notes = [
    'status_const  arcgis=RAW value resolved through status_to_bucket | socrata=IS the bucket',
    'include_types csv ONLY — ignored by arcgis/socrata/carto/ckan (see header; ~52k live records)',
    'recency_days  arcgis >= DATE literal (breaks on STRING date cols, NO escape hatch) | ' +
      'socrata ISO + recency_expr escape hatch | carto now()-interval | ckan STRING compare ' +
      '(silently wrong on M/D/YYYY) | csv parse-time',
    'spatial_zip_radius_mi arcgis=geometry envelope | socrata=within_circle AND REQUIRES ' +
      'spatial_point_col (else quarantined, emits ZERO) | csv=row coords | carto/ckan NOT IMPLEMENTED',
    'use_type_const arcgis ONLY; mutually exclusive with type_map (guarded at arcgis.ts:245)',
  ];
  for (const n of notes) console.log(`  i ${n}`);
  // Pin the two that are load-bearing, so a "harmonisation" has to face them.
  ok('socrata still has recency_expr and arcgis still does NOT (the asymmetry is real)',
    OPTS.socrata.has('recency_expr') && !OPTS.arcgis.has('recency_expr'));
  ok('include_types is still csv-only', OPTS.csv.has('include_types')
    && !['arcgis', 'socrata', 'carto', 'ckan'].some((c) => OPTS[c].has('include_types')));
}

console.log('\n5) SELF-TEST — the detector can fail');
{
  const known = OPTS.arcgis;
  const typo = { registry_id: 'fixture', platform: 'arcgis', recency_day: 365 };   // note: recency_dayS
  const unknown = Object.keys(typo).filter((k) => !ANNOTATION_KEYS.has(k) && !known.has(k));
  ok('5a. a TYPO\'d option name is caught', unknown.includes('recency_day'), JSON.stringify(unknown));
  const good = { registry_id: 'fixture', platform: 'arcgis', recency_days: 365 };
  ok('5b. the correct spelling passes',
    Object.keys(good).filter((k) => !ANNOTATION_KEYS.has(k) && !known.has(k)).length === 0);
  ok('5c. a csv-only option on an arcgis entry is caught', !OPTS.arcgis.has('include_types'));
}

console.log(fail ? `\n${fail} check(s) FAILED` : `\nAll ${pass} connector-option-surface checks passed.`);
process.exit(fail ? 1 : 0);
