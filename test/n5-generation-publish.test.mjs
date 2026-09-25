// n5-generation-publish.test.mjs — STRUCTURAL pins for the N5 generation publication path.
//
// The BEHAVIOURAL proof is test/n5_generation_pg/run_suite.py, executed against a real
// PostgreSQL + PostGIS by .github/workflows/n5-generation-publish-suite.yml (58 assertions
// and 10 mutations). This file pins what can be checked offline: that the pieces stay WIRED —
// one writer, one serving switch, retired scripts stay retired, and no Map 1 reader reads a
// base table that holds more than one generation.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const sql   = readFileSync('docs/n5-generation-publish.sql', 'utf8');
const orch  = readFileSync('scripts/n5_orchestrate.py', 'utf8');
const pub   = readFileSync('scripts/n5_publish.py', 'utf8');
const suite = readFileSync('test/n5_generation_pg/run_suite.py', 'utf8');
const wf    = readFileSync('.github/workflows/n5-generation-publish-suite.yml', 'utf8');
const code  = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const fnBody = (name) => {
  const i = code.indexOf(`create or replace function ${name}(`);
  if (i < 0) return '';
  const j = code.indexOf('\n$$;', i) > 0 ? code.indexOf('\n$$;', i) : code.length;
  const k = code.indexOf('$function$;', i);
  return code.slice(i, Math.min(j, k > 0 ? k : code.length));
};

// the instrument proves it loaded something real
ok(sql.length > 20000 && code.length > 10000, 'migration of record loaded');
ok(/-- @@PART_B/.test(sql) && /-- @@PART_C/.test(sql), 'three parts, split by the markers the executable suite reads');

// ── one serving generation, resolved once, and every serving view filters on it ────────
for (const v of ['n5_serving_membership', 'n5_serving_marker', 'n5_serving_status']) {
  const m = code.match(new RegExp(`create or replace view geo\\.${v} as([\\s\\S]*?);`));
  ok(m && /generation_id = \(select g\.generation_id from geo\.n5_generation g\s+where g\.state in \('ACTIVE','ACTIVE_LEGACY'\)\)/.test(m[1]),
    `${v} filters on the single ACTIVE / ACTIVE_LEGACY generation`);
  // a FUNCTION inside a view is permission-checked as the CALLING role (anon)
  ok(m && !/n5_serving_generation_id/.test(m[1]), `${v} inlines the predicate rather than calling a function`);
}

// ── the splice reaches every measured reader and fails closed ────────────────────────
for (const r of ['public.app_zip_projects_markers(text,text,boolean)', 'public.app_authoritative_projects_for_zip(text)',
  'public.app_projects_for_zip(text,text)', 'geo.refresh_maps_zip_export()', 'public.app_zip_geography_state',
  'public.dc_resident_lineage_ledger']) {
  ok(sql.includes(`'${r}'`), `the serving splice names ${r}`);
}
ok(/FINAL SWEEP/.test(sql) && /unlisted reader\(s\) still read a serving base table/.test(code),
  'an unlisted reader of a serving base table aborts PART C');
ok(/reloptions/.test(code) && /lost its options/.test(code), 'the view splice carries security_invoker through');

// ── the write guard covers all four serving-plane tables ─────────────────────────────
for (const t of ['zip_authoritative_membership', 'zip_authoritative_marker', 'maps_zip_geography_status', 'n5_boundary_membership']) {
  ok(new RegExp(`create trigger n5_generation_row_guard before insert or update or delete\\s+on geo\\.${t}`).test(code),
    `geo.${t} rows are writable only while their generation is BUILDING`);
}

// ── the candidate is generation-scoped and bounded by the frozen expected set ────────
const publish = fnBody('geo.n5_gen_publish_prefix');
ok(publish.length > 2000, 'publish function located');
ok(/g\.state <> 'BUILDING'/.test(publish), 'publish refuses any generation that is not BUILDING');
ok(/n5_gen_candidate_geom\(p_generation_id\)/.test(publish), 'boundary resolution reads the generation candidate set');
ok(/not done — geometry is incomplete/.test(publish), 'publish waits for every shard (cross-prefix resolution)');
ok(/have no marker/.test(publish) && /fall outside their ZIP/.test(publish), 'publish proves marker pairing and containment');
ok(!/insert into geo\.zip_authoritative_membership\s*\(\s*zcta5/.test(code), 'no membership insert omits generation_id');

// ── reconciliation counts cross-prefix geography as resolved ─────────────────────────
const recon = code.slice(code.indexOf('create or replace function geo.n5_reconcile_chunk('));
ok(!/m\.zcta5 >= lo and m\.zcta5 <= hi/.test(recon.slice(0, 4000)),
  'RESOLVED is never bounded by the chunk ZIP range (INV-5)');

// ── no catch-all unresolved class ─────────────────────────────────────────────────────
const unres = fnBody('geo.n5_gen_record_unresolved');
ok(unres.length > 1000 && /where c\.reason_code is not null/.test(unres) && !/\belse\s+'/.test(unres),
  'an expected key with no evidence stays UNACCOUNTED — no else-branch reason');

// ── activation: completeness re-checked, predecessor recorded, no rows copied ─────────
const act = fnBody('geo.n5_generation_activate');
ok(/n5_generation_publish_problems/.test(act) && /predecessor_generation_id = coalesce/.test(act),
  'activation re-checks completeness and records its predecessor');
ok(!/insert into|delete from/i.test(act), 'activation copies and deletes nothing — the switch is state alone');

// ── ONE AUTHORITY: the legacy per-ZIP cutover flag no longer chooses Development ──────
ok(/C3: the app_projects_for_zip cutover gate does not appear exactly once/.test(code),
  'C3 removes the app_projects_for_zip cutover gate, fail-closed on drift');
const stateView = (code.match(/create or replace view public\.app_zip_geography_state as([^;]*);/) || [])[1] || '';
ok(stateView.length > 100 && /n5_serving_status/.test(stateView) && !/app_zip_geography_cutover/.test(stateView),
  'app_zip_geography_state is derived from the serving generation, not the cutover table');
ok(/still consult app_zip_geography_cutover/.test(code), 'PART C aborts if any Development reader still consults the cutover table');

// ── publication scope: shards AND every canonical prefix ─────────────────────────────
const scope = fnBody('geo.n5_generation_publish_scope');
ok(/n5_shard/.test(scope) && /canonical_zip_registry/.test(scope), 'publication scope = shard prefixes UNION canonical prefixes');
ok(/n5_generation_publish_scope\(p_generation_id\)/.test(publish), 'publish accepts exactly the scope');
ok((code.match(/n5_generation_publish_scope\(p_generation_id\)/g) || []).length >= 3,
  'publish, unresolved accounting and the completeness check all read the one scope');

// ── the guard serialises with READY, and freezes recorded evidence ────────────────────
ok(/where g\.generation_id = v_gen for share;/.test(code), 'the write guard locks the generation row it reads');
ok(/before insert or update or delete\s+on geo\.n5_generation_unresolved/.test(code), 'unresolved outcomes are guarded');
ok(/perform geo\.n5_reconcile_chunk\(p_generation_id, c_key\)/.test(act), 'activation recomputes reconciliation itself');

// ── capacity: PART A and PART B refuse without an independently verified free-disk figure ──
ok((sql.match(/CAPACITY GATE \(PART [AB]\)/g) || []).length === 2 && /v::bigint < 2048 \+ 950/.test(code),
  'PART A and PART B each refuse unless n5.verified_free_disk_mb >= the 2,048 MB floor + 950 MB peak');
ok(sql.indexOf('CAPACITY GATE (PART A)') < sql.indexOf('A1. Generation lineage'), 'the PART A gate runs before any DDL');

// ── orchestration: one writer, READY through the gate, activation still explicit ──────
ok(/from n5_publish import publish_prefix/.test(orch) && /geo\.n5_gen_publish_prefix/.test(pub),
  'the orchestrator publishes through scripts/n5_publish.py -> geo.n5_gen_publish_prefix');
const ready = (orch.split('def mode_ready(')[1] || '').split('\ndef ')[0];
ok(/n5_generation_mark_ready/.test(ready) && !/update geo\.n5_generation/.test(ready),
  'READY is decided by geo.n5_generation_mark_ready, never a raw UPDATE');
for (const fn of ['mode_work', 'mode_publish', 'publish_pending', 'mode_ready']) {
  const body = (orch.split(`def ${fn}(`)[1] || '').split('\ndef ')[0];
  ok(body && !/n5_generation_activate/.test(body), `${fn} can never activate`);
}

// ── the retired in-place writers stay retired ─────────────────────────────────────────
for (const s of ['scripts/n5_boundary_first.py', 'scripts/n5_unit_a_shadow.py', 'scripts/n5_a3_markers.py']) {
  const t = readFileSync(s, 'utf8');
  const main = (t.split('def main():')[1] || '').slice(0, 300);
  ok(/raise SystemExit\(RETIRED\)/.test(main), `${s} refuses to write`);
}

// ── the executable suite is wired and carries its mutations ───────────────────────────
ok(/run_suite\.py/.test(wf) && /postgis\/postgis/.test(wf), 'the executable suite runs on a disposable PostGIS in CI');
ok((suite.match(/^\s+"M\d+ /gm) || []).length >= 10, 'the executable suite carries at least ten mutations');
ok(/MUTATION DID NOT APPLY/.test(suite), 'a mutation must prove it applied before it can count as a kill');

console.log(`n5-generation-publish: ${n} structural checks passed`);
