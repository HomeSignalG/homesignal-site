// Offline pins for the permanent PROVEN expected-geometry adapter and the work
// handoff (docs/geo-proven-expected-geometry.sql, docs/geo-work-handoff.sql).
//
// The behavioural proof runs server-side (no sandbox egress) and is recorded in
// docs/geo-steady-state-path.md. These pins guard the properties an edit could
// quietly remove — above all the two that stop a coordinate being FABRICATED.
import { readFileSync } from 'node:fs';
import { checkCteChain } from './geo-sql-cte-structure.test.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL: ' + m); } };
const section = (s) => console.log('\n-- ' + s);
const before = (h, a, b) => { const i = h.indexOf(a), j = h.indexOf(b); return i >= 0 && j >= 0 && i < j; };

const adapter = readFileSync('docs/geo-proven-expected-geometry.sql', 'utf8');
const handoff = readFileSync('docs/geo-work-handoff.sql', 'utf8');
const decl = adapter.slice(adapter.indexOf('create or replace function geo.proven_expected_geometry('),
                           adapter.indexOf('$fn$;') + 5);
// ⚠️ THE INNER BODY, not the CREATE FUNCTION wrapper. checkCteChain strips
// dollar-quoted blocks, and the body IS one ($fn$...$fn$) - so pointing it at
// `decl` silently strips everything and the pin passes over nothing. That is
// exactly what happened, and only the negative control in §9 exposed it.
const fn = decl.slice(decl.indexOf('$fn$') + 4, decl.lastIndexOf('$fn$'));
// Comment-free view, for the pins that forbid a STRING: the file explains why it
// never reads preservation.* and never emits pt:2, so a pin searching the whole
// text matches its own rationale. Same family as "a pin that names the string it
// forbids cannot also search the whole file for it".
const code = fn.replace(/--.*$/gm, '');

section('1. the adapter reads LIVE evidence, never the frozen snapshot');
ok(/public\.app_projects/.test(fn), 'it reads public.app_projects');
ok(!/preservation\./.test(code), 'it NEVER reads preservation.* — the frozen snapshot is what froze this pipeline');
ok(!/n5_frozen/.test(fn), 'it never reads geo.n5_frozen');
ok(!/z3|zip3|left\(.*,3\)/i.test(code), 'no ZIP3 anywhere in the executable body');
ok(/_keys text\[\]/.test(decl), 'it is bounded by a source-key array');
ok(/\bstable\b/.test(decl), 'it is STABLE — a pure read, so it cannot mutate a plane');

section('2. it performs NO downstream mutation — the reconciler owns convergence');
for (const t of ['n5_geom', 'n5_boundary_membership', 'zip_authoritative_membership', 'zip_authoritative_marker']) {
  ok(!new RegExp(`(insert into|update|delete from)\\s+geo\\.${t}`, 'i').test(fn),
     `the adapter never writes geo.${t}`);
}
ok(/returns table/.test(decl), 'it RETURNS expected geometry rather than applying it');

section('3. the contract is AGREEMENT, not selection — this is what stops fabrication');
ok(/MULTI_COORD_UNRESOLVED/.test(fn), 'disagreeing coordinates are rejected, never resolved');
ok(/distinct_ok > 1/.test(fn), 'the rejection is keyed on MORE THAN ONE distinct coordinate');
ok(!/min\(id\)|order by .*\bid\b.*limit 1|distinct on/i.test(fn),
   'it does NOT pick a row by min(id) / DISTINCT ON — that would publish one of two contradictory points');
ok(before(fn, 'distinct_ok > 1', 'else 1'),
   'the conflict branch is decided BEFORE a geometry can be emitted');
ok(/round\(l\.lat::numeric,6\)/.test(fn), 'coordinates are rounded before DISTINCT so float noise is not a conflict');

section('4. every rejection reason comes from the CLOSED designed domain');
for (const r of ['NO_REGISTRY_VERDICT', 'NULL_COORD', 'NULL_ISLAND', 'INVALID_COORD', 'MULTI_COORD_UNRESOLVED']) {
  ok(fn.includes(r), `reason ${r} is implemented (geo.n5_point_reject's domain)`);
}
ok(/NOT_PROVEN_TREATMENT/.test(fn), 'a non-PROVEN treatment is refused rather than materialised');
ok(/SOURCE_REMOVED/.test(fn), 'an authoritative empty set is expressible');
ok(/free text|invalid_reason/.test(adapter) && /SOURCE_REMOVED is the one reason NOT in/.test(adapter),
   'SOURCE_REMOVED is documented as deliberately OUTSIDE the closed CHECK domain, not smuggled into it');
ok(/OUTSIDE_JURISDICTION is in n5_point_reject/.test(adapter),
   'the one unimplemented reason is stated, not silently omitted');

section('5. the pt:1 contract');
ok(/'pt:1'/.test(fn), "feature_id is the 'pt:1' contract");
ok(!/pt:2/.test(code), "it never emits pt:2, which the geo.n5_geom comment RESERVES as undefined");
ok(/'proven_stored_point'/.test(fn), 'provenance is stated explicitly, never inherited by omission');
ok(/4269/.test(fn), 'SRID 4269 matches the archive CRS — no transform');

section('6. the handoff uses points that ALREADY know the source_key');
ok(/no trigger on public\.app_projects is proposed/i.test(handoff),
   'the design explicitly proposes NO trigger on the hot path');
ok(/48,366,569/.test(handoff), 'the hot-path write volume is cited as the reason, not asserted');
ok(/returning/i.test(handoff), 'the handoff reads the keys the statements already return');
ok(/geocode fence/i.test(handoff), 'the lat/lng-nulling geocode fence is covered — the coordinate change with no insert or delete');
ok(/stale sweep/i.test(handoff), 'the stale sweep is covered');
ok(/Enqueue the key even though the row is gone/.test(handoff),
   'removal still enqueues — otherwise stale geography is left behind');

section('7. the queue records WORK, never completion');
ok(/never records\s*(--)?\s*completion/i.test(handoff), 'the ledger cannot claim done while downstream state is wrong');
ok(/no trigger on geo\.n5_geom/i.test(handoff), 'no trigger on the reconciler OUTPUT — that would be circular');
ok(/periodic/i.test(handoff) && /remote/i.test(handoff),
   'remote RECOVERY change is recorded as a later periodic-refresh requirement');

section('8. CTE structure, the 47b005e class');
ok(checkCteChain(fn).length === 0, 'the adapter CTE chain is well formed');

section('9. NEGATIVE CONTROL — these pins can fail');
ok(checkCteChain(fn.replace(/\), *\ncoords as \(/, ')\ncoords as (')).length > 0,
   'removing a CTE comma from the adapter is detected');
ok(!/MULTI_COORD_UNRESOLVED/.test(fn.replace(/MULTI_COORD_UNRESOLVED/g, 'X')),
   'the conflict-rejection pin is keyed on a string an edit would remove');

console.log(`\nPassed: ${pass}  Failed: ${fail}`);
if (fail) process.exit(1);
