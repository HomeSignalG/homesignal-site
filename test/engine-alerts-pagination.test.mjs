// The engine's devSites alerts read must never silently drop rows.
//
// THE DEFECT THIS PINS (2026-08-15): index.ts read government-notice alerts with
// `.limit(100)`, so any community chain holding >100 qualifying notices was silently
// truncated — Taos County: 101 stored, 100 rendered; Weber County: 283 stored, 100
// rendered. Same failure class as the PostgREST 1,000-row default cap. The fix is the
// range-windowed full read in sources/pg-pages.ts (the engine-side twin of
// lib/data.js::fetchAllPages), with a TOTAL order (published_at desc + id tiebreak) and
// fail-LOUD windows: a window that fails after one retry throws, so the report request
// fails and the refresh layer keeps the previous cached row — never a silent prefix,
// never the old silent-empty error destructure.
//
// The connector is TypeScript; Node >= 22.18 strips types on import (arcgis-geometry
// precedent), so the SHIPPED readAllRows is driven directly. index.ts itself is not
// Node-importable (Deno/jsr imports), so its call site is pinned statically.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  if (c) console.log(`  ✓ ${name}`);
  else { fails++; console.error(`  ✗ ${name}${detail ? '\n     ' + detail : ''}`); }
};

let readAllRows;
try {
  ({ readAllRows } = await import(join(root, 'supabase/functions/get-address-report/sources/pg-pages.ts')));
} catch (err) {
  console.log('FAIL — import sources/pg-pages.ts (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

// A PostgREST-shaped stub: rows served in windows via .range(), with scriptable failures.
function stubQuery(rows, { failWindows = {} } = {}) {
  const calls = [];
  return {
    calls,
    build: () => ({
      range(from, to) {
        calls.push([from, to]);
        const key = String(from);
        if (failWindows[key] > 0) {
          failWindows[key]--;
          return Promise.resolve({ data: null, error: { message: `stub failure at ${from}` } });
        }
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
    }),
  };
}

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `row-${String(i).padStart(5, '0')}` }));

console.log('1) the >100 case — every row comes back, in order');
{
  // 150 rows through 50-row windows: the exact shape .limit(100) used to truncate.
  const q = stubQuery(mk(150));
  const out = await readAllRows(q.build, 50);
  ok(out.length === 150, '150 rows in -> 150 rows out (was 100 under .limit(100))', `got ${out.length}`);
  ok(out.every((r, i) => r.id === `row-${String(i).padStart(5, '0')}`), 'order preserved across windows');
  // 150 is an exact multiple of 50, so a fourth EMPTY window is the terminator.
  ok(q.calls.length === 4, 'three full 50-row windows + the empty terminator fetched', `got ${q.calls.length}`);
}

console.log('2) window boundaries');
{
  const q = stubQuery(mk(100));
  const out = await readAllRows(q.build, 100);
  ok(out.length === 100 && q.calls.length === 2,
    'exact-multiple row count terminates on the empty follow-up window (no infinite loop)',
    `rows ${out.length}, calls ${q.calls.length}`);
  const q0 = stubQuery(mk(0));
  ok((await readAllRows(q0.build, 100)).length === 0, 'zero rows -> empty array, one window');
}

console.log('3) failure semantics — retry once, then THROW (never a silent prefix)');
{
  const q = stubQuery(mk(120), { failWindows: { '100': 1 } });   // window 2 fails once
  const out = await readAllRows(q.build, 100);
  ok(out.length === 120, 'a transient window failure is retried and the read completes', `got ${out.length}`);

  const q2 = stubQuery(mk(120), { failWindows: { '100': 99 } }); // window 2 always fails
  let threw = false;
  try { await readAllRows(q2.build, 100); } catch { threw = true; }
  ok(threw, 'a persistent window failure THROWS — the caller never sees a 100-row prefix as success');
}

console.log('4) the call site — index.ts is pinned to the paged read');
{
  const src = readFileSync(join(root, 'supabase/functions/get-address-report/index.ts'), 'utf8');
  const alertsRead = src.slice(src.indexOf('pipeline_type", "government_notice'), src.indexOf('pipeline_type", "government_notice') + 400);
  ok(/readAllRows/.test(src.slice(src.indexOf('pipeline_type", "government_notice') - 600, src.indexOf('pipeline_type", "government_notice'))),
    'the government_notice alerts read goes through readAllRows');
  ok(/\.order\("id"\)/.test(alertsRead), 'the read carries the .order("id") tiebreak (total order)');
  ok(!/\.limit\(100\)/.test(alertsRead), 'the .limit(100) truncation is gone');
  ok(/from "\.\/sources\/pg-pages\.ts"/.test(src), 'index.ts imports sources/pg-pages.ts');
}

if (fails) { console.error(`\n${fails} check(s) failed`); process.exit(1); }
console.log('\nengine alerts pagination: full reads, total order, fail-loud windows — the .limit(100) truncation class is pinned out.');
