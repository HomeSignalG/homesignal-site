// Phase 4 — the ZIP3 mutation boundary must never come back.
//
// The live algebra (A/B/C/D/E/F/G/H) was proven against real PostgreSQL temp tables;
// receipts in docs/geo-phase4-mutation-contract.md. THIS file is the structural pin:
// it fails if a prefix-wide DELETE reappears in a path that writes a resident-facing
// geography table, and if the parked primitive stops being source-scoped.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`PASS — ${msg}`); }
                            else { fail++; console.log(`FAIL — ${msg}`); } };

const RAW = readFileSync('docs/geo-source-scoped-reconcile.sql', 'utf8');
// EXECUTABLE statements only. This file's header legitimately QUOTES the prefix-wide
// delete it replaces, and a pin that names the string it forbids cannot also search the
// whole file for it — CLAUDE.md records that exact trap. Strip -- comments first.
const RECONCILE = RAW.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const UNIT_A = readFileSync('scripts/n5_unit_a_shadow.py', 'utf8');
const MARKERS = readFileSync('scripts/n5_a3_markers.py', 'utf8');

// §1 the parked primitive is SOURCE-SCOPED, never prefix-scoped
const resDeletes = [...RECONCILE.matchAll(/delete\s+from\s+geo\.(zip_authoritative_\w+)[\s\S]*?;/gi)]
  .map((m) => m[0]);
ok(resDeletes.length === 2, `primitive deletes from exactly the two resident-facing tables (got ${resDeletes.length})`);
for (const d of resDeletes) {
  const tbl = /zip_authoritative_(\w+)/.exec(d)[1];
  ok(/source_key\s*=\s*any\s*\(:keys\)/i.test(d), `${tbl} DELETE is bounded by the key set`);
  ok(!/left\s*\(\s*zcta5\s*,\s*3\s*\)/i.test(d), `${tbl} DELETE carries NO left(zcta5,3) prefix predicate`);
  ok(/not\s+exists/i.test(d), `${tbl} DELETE removes only rows absent from the EXPECTED set`);
}

// §2 removals are supported — an upsert-only design would leave stale geography behind
ok(resDeletes.length > 0, 'primitive is NOT upsert-only (it can remove stale rows)');

// §3 identical rows are not rewritten, which is what makes a rerun a true no-op
const upserts = [...RECONCILE.matchAll(/on conflict[\s\S]*?do update[\s\S]*?;/gi)].map((m) => m[0]);
ok(upserts.length === 2, `both upserts present (got ${upserts.length})`);
for (const u of upserts) {
  ok(/is distinct from/i.test(u), 'upsert updates only genuinely changed rows (is distinct from guard)');
}

// §4 multi-ZCTA / multi-marker identity is preserved, never collapsed
ok(/on conflict \(zcta5, source_key\)/i.test(RECONCILE),
   'membership identity is (zcta5, source_key) — a key may span many ZCTAs');
ok(/on conflict \(zcta5, source_key, marker_seq\)/i.test(RECONCILE),
   'marker identity is (zcta5, source_key, marker_seq) — a key may have many markers');

// §5 PHASE 5 — the two resident-facing ZIP3 deletes are GONE from the production path.
// Phase 4 tripwired their continued existence; Phase 5 removes them, so the assertion
// inverts. ZIP3 survives ONLY as a work-distribution label (the `scope` CTE).
for (const [name, src] of [['n5_unit_a_shadow.py', UNIT_A], ['n5_a3_markers.py', MARKERS]]) {
  const body = /(?:POPULATE|BUILD) = f"""([\s\S]*?)\n"""/.exec(src);
  ok(!!body, `${name}: production mutation body found`);
  const sql = body[1];
  ok(!/delete from \{(MEMB|MARK)\} where left\(zcta5,3\)/.test(sql),
     `${name}: prefix-wide DELETE on the resident-facing table is GONE`);
  ok(/delete from \{(MEMB|MARK)\}[\s\S]*?source_key in \(select source_key from scope\)/.test(sql),
     `${name}: DELETE is bounded by the processed key set`);
  ok(/on conflict[\s\S]*?do update/.test(sql) && /is distinct from/.test(sql),
     `${name}: upsert updates only genuinely changed rows`);
  ok(/with scope as \([\s\S]*?b\.prefix = \{\{PFX\}\}\)/.test(sql),
     `${name}: ZIP3 survives only as the work-distribution scope selector`);
  // the expected set must span ALL ZCTAs, or a key crossing two prefixes is half-deleted
  ok(/geo\.zcta_boundary/.test(sql),
     `${name}: expected set resolved against the national ZCTA table, not a prefix scratch`);
}

// §6 the primitive must not quietly become a national sweep
ok(!/left\s*\(\s*zcta5\s*,\s*3\s*\)/i.test(RECONCILE),
   'primitive contains NO ZIP3 predicate anywhere');
ok(/:keys/.test(RECONCILE), 'primitive is parameterised on a bounded key set supplied by the caller');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
