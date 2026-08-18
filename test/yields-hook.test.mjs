// Offline checks for the yields_to hook (supabase/functions/get-address-report/sources/yields.ts)
// — the same-report cross-entry overlap resolution approved for the ARDOT points/lines pair
// (founder, 2026-08-18). Drives the SHIPPED module; no network.
//
// The four founder-required properties, each pinned below:
//   1. overlap job in both layers → exactly ONE record survives, the Lines one;
//   2. points-only job → survives untouched;
//   3. Lines fetch empty/failed → Points records ALL survive (outage degrades to
//      dual-source absence, never silent point-job loss);
//   4. an entry without yields_to → hook provably inert.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const SRC = join(root, 'supabase/functions/get-address-report/sources/yields.ts');
let applyYields, buildYieldsMap;
try {
  ({ applyYields, buildYieldsMap } = await import(SRC));
} catch (err) {
  console.log('FAIL — import sources/yields.ts (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

const P = 'ar-ardot-job-status-points';
const L = 'ar-ardot-job-status-lines';
const rec = (src, job, extra = {}) => ({ source_registry_id: src, case_number: job, title: `job ${job}`, ...extra });

// ── 0. The map is built FROM the registry — the declaration is config, not code ──
const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const YIELDS = buildYieldsMap(REG);
ok(YIELDS.get(P) === L, 'registry declares points yields_to lines (the ARDOT pair)');
ok(![...YIELDS.keys()].includes(L), 'lines does NOT yield to anything (one-directional)');

// ── 1. Overlap job in both layers → exactly one survives, the Lines one ──────────
{
  const rows = [rec(P, '012274'), rec(L, '012274'), rec(L, '020660')];
  const out = applyYields(rows, YIELDS);
  ok(out.length === 2, `overlap job: 3 rows in, 2 out (got ${out.length})`);
  ok(!out.some((s) => s.source_registry_id === P && s.case_number === '012274'),
    'the POINTS copy of the overlap job dropped');
  ok(out.some((s) => s.source_registry_id === L && s.case_number === '012274'),
    'the LINES copy of the overlap job survived');
}

// ── 2. Points-only job → survives untouched ──────────────────────────────────────
{
  const rows = [rec(P, 'BB0401'), rec(L, '020660')];
  const out = applyYields(rows, YIELDS);
  ok(out.length === 2 && out.some((s) => s.source_registry_id === P && s.case_number === 'BB0401'),
    'a points-only job (no Lines record with that Job_No) survives untouched');
}

// ── 3. Lines fetch empty/failed → Points records ALL survive ─────────────────────
{
  // The Lines connector returned nothing this cycle (outage / empty page) — the assembly
  // simply contains no ar-ardot-job-status-lines rows. Every points record must survive,
  // INCLUDING jobs that would have been dual-represented on a healthy cycle.
  const rows = [rec(P, '012274'), rec(P, 'BB0401'), rec(P, '090520')];
  const out = applyYields(rows, YIELDS);
  ok(out.length === 3, `Lines outage: all ${rows.length} points records survive (got ${out.length}) — dual-source absence, never silent point-job loss`);
}

// ── 4. Entry without yields_to → hook provably inert ─────────────────────────────
{
  // Same case_number across two UNRELATED entries (a real pattern: two cities can reuse
  // permit numbering) — nothing may drop, because neither declares yields_to.
  const rows = [rec('detroit-building-permits', 'X100'), rec('boston-approved-building-permits', 'X100'), rec(L, 'X100')];
  const out = applyYields(rows, YIELDS);
  ok(out.length === 3, 'entries without yields_to are untouched even on a case_number collision');
  const empty = applyYields(rows, new Map());
  ok(empty === rows, 'with ZERO declarations the hook returns the input array itself (structural no-op)');
}

// ── Edge discipline ──────────────────────────────────────────────────────────────
{
  const rows = [rec(P, null), rec(P, ''), rec(L, null)];
  const out = applyYields(rows, YIELDS);
  ok(out.length === 3, 'a record with no case_number never yields (no key to match on — absence stays honest)');
  const padded = applyYields([rec(P, ' 012274 '), rec(L, '012274')], YIELDS);
  ok(padded.length === 1 && padded[0].source_registry_id === L,
    'match key is trimmed string equality (upstream padding cannot defeat the yield)');
}

console.log(fails ? `\n${fails} yields-hook assertion(s) FAILED.` : '\nAll yields-hook assertions passed.');
process.exit(fails ? 1 : 0);
