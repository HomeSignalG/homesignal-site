// app_refresh_zip determinism — regression guards (Phase A / FD-1).
// Every capped select in the materializer must carry a total-order ORDER BY whose
// FINAL term is a stable, immutable unique key (md5(el::text) for deduped JSONB
// site elements; the row uuid id for alerts/meetings; communities.id for the ZIP
// resolution). Business ordering stays the leading key(s) — the tie-breaker only
// decides when they compare equal. These are static-source guards against the
// SQL of record (CI has no DB); the live repeated-run proof is recorded in
// docs/local-news-phase-a-evidence-report.md (idempotency on 84337, identical
// 48-of-77 development selection on 02108 across runs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlOfRecord = readFileSync(join(root, 'docs/app-refresh-zip-gin-containment-migration.sql'), 'utf8');
const snapshot = readFileSync(join(root, 'docs/app-refresh-zip-live-snapshot-2026-07-24.sql'), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};
const count = (s, re) => (s.match(re) || []).length;

// ---- the ordering contract is documented in the function body (FD-1 rule 4) ----
ok(/FD-1 ordering contract/.test(sqlOfRecord),
  'SQL of record documents the FD-1 ordering contract in the function body');

// ---- every capped select ends its ORDER BY in a stable unique key ----
ok(/order by \(level='zip'\) desc, \(level='city'\) desc, id limit 1;/.test(sqlOfRecord),
  'ZIP->community resolution (limit 1) tie-breaks on communities.id');
ok(/end desc nulls last,\n\s+md5\(el::text\)\n\s+limit 48;/.test(sqlOfRecord),
  'development top-48 keeps date-desc business ordering, tie-breaks on md5(el::text)');
ok(/order by el->>'label', md5\(el::text\)\n\s+limit 16;/.test(sqlOfRecord),
  'facilities top-16 keeps label business ordering, tie-breaks on md5(el::text)');
ok(count(sqlOfRecord, /order by md5\(el::text\)\n\s+limit 6;/g) === 2,
  'planning & civic top-6 (previously NO order by) both order by the stable key alone');
ok(/order by m\.meeting_date asc, m\.id limit 8;/.test(sqlOfRecord),
  'meetings top-8 keeps meeting_date-asc, tie-breaks on m.id');
ok(count(sqlOfRecord, /order by a\.created_at desc, a\.id limit 48;/g) === 2,
  'gov notices AND Local News top-48 keep created_at-desc, tie-break on a.id');

// ---- no capped select is left with the old tie-prone ordering ----
// Negatives run against the FUNCTION BODY only (the doc header narrates the old
// shapes). One documented exemption: `order by d desc limit 1` in the ancestor
// walk — depth d is unique in a linear parent chain, so it cannot tie.
const fnBody = sqlOfRecord.slice(sqlOfRecord.indexOf('CREATE OR REPLACE'));
ok(fnBody.length > 1000, 'SQL of record contains the full function body');
ok(!/\(level='city'\) desc limit 1;/.test(fnBody), 'no un-tie-broken limit 1 resolution remains');
ok(!/asc limit 8;/.test(fnBody.replace(/asc, m\.id limit 8;/g, '')),
  'no un-tie-broken meetings ordering remains');
ok(!/created_at desc limit 48;/.test(fnBody), 'no un-tie-broken top-48 ordering remains');
ok(!/<>''\n\s+limit 6;/.test(fnBody), 'no ORDER-BY-less top-6 select remains');
ok(!/'label'\n\s+limit 16;/.test(fnBody), 'no un-tie-broken facilities ordering remains');

// ---- GIN-eligible ZIP lookup (M2): containment predicate, equivalence proven ----
ok(/where zip_codes @> array\[_zip\] order by/.test(fnBody),
  'ZIP resolution uses GIN-eligible zip_codes @> array[_zip]');
ok(!/= any\(zip_codes\)/.test(fnBody),
  'the GIN-bypassing = any(zip_codes) shape is gone from the function body');

// ---- business semantics unchanged: same caps, same windows ----
for (const cap of ['limit 48;', 'limit 16;', 'limit 8;', 'limit 6;', 'limit 1;']) {
  ok(count(sqlOfRecord, new RegExp(cap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
     === count(snapshot, new RegExp(cap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')),
    `cap unchanged vs live snapshot: ${cap}`);
}

// ---- the rollback baseline stays byte-addressable in the repo ----
ok(/1b4dbc18316353ce8efbc3b1ac8d422a/.test(snapshot),
  'live snapshot records its production md5 (rollback target)');
ok(/create or replace function public\.app_refresh_zip/i.test(snapshot),
  'live snapshot contains the full baseline body');

process.exit(fails ? 1 : 0);
