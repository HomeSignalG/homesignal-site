// Offline guard against the SILENT-NOTHING config class — no network, no DB.
//
// THE DEFECT (found at Delaware County PA go-live, 2026-08-03). An entry set
//     "status_const": "proposed"
// and NO `status_to_bucket`. It emitted ZERO records across all 12 probe ZIPs while the source
// itself was healthy — 19026's 3-mile envelope returns 483 rows unfiltered, 168 with the entry's
// own `Year >= 2020`. Cause: `status_const` supplies the RAW status value, which the connector then
// resolves through `status_to_bucket` exactly like a column-read status (sources/arcgis.ts:300-304).
// With no map, the constant is UNMAPPED, so every row is excluded and flagged.
//
// This is the class the Arlington / harris-county-permits notes name: config that looks complete,
// passes every unit test, and silently produces nothing. Nothing errors — the wire just yields 0,
// which is indistinguishable from "the source has no records here" unless someone probes the source
// separately. Registry data is production code (ES-1), so it gets a structural test.
//
// ⚠️ THE RULE IS CONNECTOR-SPECIFIC, AND THAT ASYMMETRY *IS* THE TRAP:
//   • sources/socrata.ts  — `status_const?: "proposed" | "approved" | "operating"`. It **IS** the
//     bucket, applied to any row carrying a file_date. An all-empty status_to_bucket is correct and
//     idiomatic here (east-baton-rouge, marin-county, buffalo, prince-georges all work this way).
//   • sources/arcgis.ts   — `status_const?: string`. It is the **RAW status value**, resolved
//     through status_to_bucket exactly like a column-read status (arcgis.ts:300-304). An all-empty
//     map means the constant is UNMAPPED and every row is excluded.
// Same option name, opposite semantics. Carrying the socrata idiom into an arcgis entry produces a
// silent zero — which is how BOTH `san-antonio-prelim-plan-review` (0 records cache-wide, against a
// same-city control at 167) and the first draft of the Delaware County PA entry were written.
// So this suite checks ARCGIS entries only. The shipped arcgis convention is
// detroit-building-permits / cleveland-issued-building-permits: status_const "Issued" +
// status_to_bucket.approved ["Issued"].
// Run: node scripts/run-unit-tests.mjs   (or: node test/status-const-must-be-mapped.test.mjs)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? '\n     ' + detail : ''}`); }
};

const reg = JSON.parse(readFileSync(
  new URL('../supabase/functions/get-address-report/jurisdiction-registry.json', import.meta.url), 'utf8'));

/** Every entry in the registry, whatever family it sits under. */
function allEntries(o, out = []) {
  if (Array.isArray(o)) { for (const v of o) allEntries(v, out); }
  else if (o && typeof o === 'object') {
    if (o.registry_id) out.push(o);
    for (const v of Object.values(o)) allEntries(v, out);
  }
  return out;
}

/** Flatten status_to_bucket into the set of raw values it can resolve. */
const mappedValues = (e) =>
  Object.values(e.status_to_bucket || {}).flat().map((v) => String(v).trim().toLowerCase());

const entries = allEntries(reg);
// ARCGIS ONLY — see the header. socrata's status_const is the bucket itself and needs no map entry.
const withConst = entries.filter((e) =>
  e.platform === 'arcgis' && e.status_const != null && String(e.status_const).trim() !== '');
const socrataConst = entries.filter((e) => e.platform === 'socrata' && e.status_const != null);

console.log(`1) registry readable (${entries.length} entries; arcgis status_const: ${withConst.length}, socrata: ${socrataConst.length})`);
ok('registry parsed with a plausible entry count', entries.length > 100, `entries=${entries.length}`);
ok('at least one ARCGIS entry uses status_const (or this suite proves nothing)', withConst.length > 0);
// Pin the asymmetry itself, so a future edit that "harmonises" the two connectors has to face it.
ok('socrata status_const entries exist and are NOT required to map it (different semantics)',
  socrataConst.length > 0 && socrataConst.some((e) => {
    const vals = Object.values(e.status_to_bucket || {}).flat();
    return vals.length === 0;                       // an all-empty map is legitimate for socrata
  }), 'no socrata entry relies on the bucket-valued status_const — the asymmetry may have changed');

console.log('\n2) every status_const resolves through its own status_to_bucket');
{
  const broken = withConst.filter((e) => !mappedValues(e).includes(String(e.status_const).trim().toLowerCase()));
  ok('no entry sets a status_const that its status_to_bucket cannot resolve',
    broken.length === 0,
    broken.map((e) => `${e.registry_id}: status_const="${e.status_const}" not in ${JSON.stringify(e.status_to_bucket)}`).join('\n     '));
}

console.log('\n3) a status_const entry must HAVE a status_to_bucket at all');
{
  const missing = withConst.filter((e) => !e.status_to_bucket || Object.keys(e.status_to_bucket).length === 0);
  ok('no entry sets status_const with no map whatsoever', missing.length === 0,
    missing.map((e) => e.registry_id).join(', '));
}

console.log('\n4) INFO (non-failing) — constants that are just a bucket name');
{
  // The founder's rule is that values are self-describing — Approved / Denied / Submitted — never
  // an opaque code and never the pipeline's own bucket vocabulary leaking into the data layer. The
  // shipped convention follows it: detroit-building-permits / cleveland-issued-building-permits set
  // status_const "Issued" + status_to_bucket.approved ["Issued"].
  //
  // WHY THIS ONE DOES NOT FAIL THE BUILD, stated plainly rather than deleted. The entries below are
  // CIRCULAR (status_const "operating", status_to_bucket.operating ["operating"]) but they RESOLVE,
  // so they pass check 2 and emit records normally — this is a naming rule, not the silent-nothing
  // defect this suite exists to catch. The value is also one WE authored, not the publisher's: each
  // of these is an issuance ledger with no status column, which is what status_const is for. Its
  // only surface is each record's `status_raw`, and nothing renders that — lib/map.js:576 derives
  // the displayed lifecycle from `bucket`. So a rename changes no resident-visible text and would
  // cost a re-cache of every page these 14 sources touch.
  // Tracked for a batched cleanup in QUEUE.md rather than blocking unrelated work; if the list ever
  // GROWS, that is a new entry written to the wrong convention and worth fixing at the source.
  const BUCKET_NAMES = new Set(['proposed', 'approved', 'operating', 'exclude', 'built']);
  const opaque = withConst.filter((e) => BUCKET_NAMES.has(String(e.status_const).trim().toLowerCase()));
  console.log(`  i ${opaque.length} entr${opaque.length === 1 ? 'y' : 'ies'} name a bucket instead of describing the record`
    + (opaque.length ? ':\n     ' + opaque.map((e) => `${e.registry_id}: "${e.status_const}"`).join(', ') : ''));
  // What IS pinned: the count cannot grow silently. A new entry written to the wrong convention
  // trips this, while the 14 already on the books do not block the build.
  const KNOWN_BUCKET_NAMED = 14;
  ok(`no NEW bucket-named constant (known: ${KNOWN_BUCKET_NAMED})`, opaque.length <= KNOWN_BUCKET_NAMED,
    `now ${opaque.length}: ${opaque.map((e) => e.registry_id).join(', ')}`);
}

console.log('\n5) SELF-TEST — the detector can fail');
{
  const bad = { registry_id: 'fixture', status_const: 'proposed', status_to_bucket: { approved: ['Issued'] } };
  ok('5a. flags a const absent from its map',
    !mappedValues(bad).includes(String(bad.status_const).toLowerCase()));
  const good = { registry_id: 'fixture', status_const: 'Issued', status_to_bucket: { approved: ['Issued'] } };
  ok('5b. passes a const present in its map',
    mappedValues(good).includes(String(good.status_const).toLowerCase()));
  ok('5c. case-folds like resolveNormalized does',
    mappedValues({ status_to_bucket: { approved: ['ISSUED'] } }).includes('issued'));
  // 5d. the check-4 ratchet: it tolerates the 14 on the books but not a 15th.
  const BUCKET_NAMES = new Set(['proposed', 'approved', 'operating', 'exclude', 'built']);
  ok('5d. the ratchet would flag one MORE bucket-named constant',
    [...withConst, { registry_id: 'fixture', status_const: 'operating' }]
      .filter((e) => BUCKET_NAMES.has(String(e.status_const).trim().toLowerCase())).length > 14);
}

console.log(fail ? `\n${fail} check(s) FAILED` : `\nAll ${pass} status_const checks passed.`);
process.exit(fail ? 1 : 0);
