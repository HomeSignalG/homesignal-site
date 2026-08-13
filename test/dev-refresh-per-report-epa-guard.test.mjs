// PER-REPORT EPA HEALTH — the guard must ask "did EPA answer for THIS ZIP?", not "is EPA up?"
//
// WHY THIS EXISTS. The 2026-08-09 / 08-11 guards judged a zero by a GLOBAL two-point probe
// (public.epa_frs_probes). That proxy fails in the one way FRS actually fails — density-dependently
// — so "global healthy + this ZIP's read failed" still wrote an authoritative zero with
// facilities_unavailable = FALSE. Measured live 2026-08-13, the two probe targets disagreed twice
// inside one hour (21:30 sheridan peer-reset / atlanta ok; 21:45 atlanta HTTP 429 / sheridan ok),
// which is exactly the state a single global boolean cannot represent.
//
// CI has no database, so the SQL half is pinned against the SQL OF RECORD
// (docs/dev-refresh-per-report-epa-guard.sql); the applied live body was verified separately by
// pg_get_functiondef (2 patched sites, every other guard clause intact). The SEMANTICS half below
// is a truth table over the predicate the SQL implements — mirrored here, with the regex checks
// above proving the SQL still has that shape.
//
// Run: node test/dev-refresh-per-report-epa-guard.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/dev-refresh-per-report-epa-guard.sql'), 'utf8');

let fails = 0;
const ok = (cond, name, detail) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (!cond && detail ? '\n     ' + detail : ''));
  if (!cond) fails++;
};

// ── the SQL of record must read the per-report signal, both places ────────────────────────────
ok(/j->'epa'->>'ok'/.test(sql),
  "the guard reads the report's own EPA status (j->'epa'->>'ok')");

// TWO sites: the flag assignment AND the write-refusal. Patching one leaves the other lying.
const perReportSites = (sql.match(/j->'epa'->>'ok'/g) || []).length;
ok(perReportSites >= 2,
  'BOTH decision sites consume it — the flag AND the last-known-good refusal',
  `found ${perReportSites}`);

// Backward compatibility is load-bearing: a pre-v23 payload has no `epa` key, and defaulting it
// to FALSE would flag every page in the cache as unavailable on the first run after apply.
ok(/coalesce\(\(j->'epa'->>'ok'\)::boolean, true\)/.test(sql),
  'a payload with no epa key defaults to TRUE (pre-v23 reports keep the old behaviour exactly)');

// It must AND with the probe, never replace it. Replacing would drop the global signal that
// catches a total outage before any report is even produced.
ok(/epa_ok and coalesce\(\(j->'epa'->>'ok'\)::boolean, true\)/.test(sql),
  'per-report health is ANDed with the global probe, not substituted for it');

// ── the patch must refuse to apply blind ──────────────────────────────────────────────────────
ok(/pg_get_functiondef/.test(sql),
  'the live definition is READ, not retyped (a retyped body silently drops clauses)');
ok(/hits <> 1 then\s*\n\s*raise exception/.test(sql),
  'each anchor must appear EXACTLY once or the migration raises');
ok(/raise notice 'per-report EPA guard already applied/.test(sql),
  'idempotent — re-applying is a no-op, not a double patch');

// ── the legitimate-zero path must survive ─────────────────────────────────────────────────────
// The opposite failure (flagging every zero as unavailable) would be a new inaccuracy, so the
// doc must state that retrieval-ok + filtered-to-nothing is still a real zero.
ok(/looksIndustrial/.test(sql) && /legitimate 0|legitimate zero/i.test(sql),
  'the SQL of record records that filtered-to-nothing is still a LEGITIMATE zero');

// ══ SEMANTICS: the truth table the SQL implements ═════════════════════════════════════════════
// Mirrors dev_refresh_collect's two clauses:
//   effective  = global_ok AND report_ok
//   flag       = payload_fac > 0 ? false : (!effective)
//   refuse     = (!effective || row_is_fresh) && payload_fac === 0 && cached_fac > 0
const decide = ({ global_ok, report_ok, payload_fac, cached_fac, fresh = true }) => {
  const effective = global_ok && report_ok;
  const refuse = (!effective || fresh) && payload_fac === 0 && cached_fac > 0;
  if (refuse) return { wrote: false, kept: cached_fac, flag: 'unchanged' };
  const flag = payload_fac > 0 ? false : !effective;
  return { wrote: true, kept: payload_fac, flag };
};

// 1. EPA healthy + real facilities → stored, flag cleared.
{
  const r = decide({ global_ok: true, report_ok: true, payload_fac: 12, cached_fac: 0 });
  ok(r.wrote && r.kept === 12 && r.flag === false,
    'T1. healthy + facilities → stored, facilities_unavailable=false');
}
// 2. EPA healthy + genuine zero, nothing cached → AUTHORITATIVE zero.
{
  const r = decide({ global_ok: true, report_ok: true, payload_fac: 0, cached_fac: 0 });
  ok(r.wrote && r.kept === 0 && r.flag === false,
    'T2. healthy + genuine zero → cached as an AUTHORITATIVE 0 (not flagged)');
}
// 3. Per-ZIP EPA failure while the GLOBAL probe reads healthy — THE BUG THIS FIX CLOSES.
{
  const r = decide({ global_ok: true, report_ok: false, payload_fac: 0, cached_fac: 0 });
  ok(r.flag === true,
    'T3. global healthy + THIS ZIP failed → flagged UNAVAILABLE, never an authoritative zero');
}
// 4. Per-ZIP failure on a row that already has facilities → last-known-good preserved.
{
  const r = decide({ global_ok: true, report_ok: false, payload_fac: 0, cached_fac: 23 });
  ok(!r.wrote && r.kept === 23,
    'T4. per-ZIP failure over a good row → write REFUSED, last-known-good 23 survives');
}
// 5. Total outage over a good row → last-known-good preserved.
{
  const r = decide({ global_ok: false, report_ok: false, payload_fac: 0, cached_fac: 23 });
  ok(!r.wrote && r.kept === 23, 'T5. total outage over a good row → last-known-good survives');
}
// 6. Total outage, nothing cached → unknown, NOT zero. (The "no prior good result" case.)
{
  const r = decide({ global_ok: false, report_ok: false, payload_fac: 0, cached_fac: 0 });
  ok(r.flag === true,
    'T6. failure with NO prior good value → unknown/unavailable, not a manufactured zero');
}
// 7. Recovery — a real result replaces the stale flagged state.
{
  const r = decide({ global_ok: true, report_ok: true, payload_fac: 40, cached_fac: 0 });
  ok(r.wrote && r.kept === 40 && r.flag === false,
    'T7. recovery → fresh result stored and the unavailable flag clears itself');
}
// 8. A STALE row (>7d) whose EPA read succeeded and genuinely dropped to zero is still allowed
//    through — the guard must not freeze a page forever.
{
  const r = decide({ global_ok: true, report_ok: true, payload_fac: 0, cached_fac: 5, fresh: false });
  ok(r.wrote && r.flag === false,
    'T8. trustworthy zero on a stale row → allowed through (the guard does not freeze pages)');
}
// 9. THE INVARIANT, stated once: no combination writes flag=false with 0 facilities unless BOTH
//    health signals said ok.
{
  let violations = 0;
  for (const global_ok of [true, false]) {
    for (const report_ok of [true, false]) {
      for (const cached_fac of [0, 23]) {
        for (const fresh of [true, false]) {
          const r = decide({ global_ok, report_ok, payload_fac: 0, cached_fac, fresh });
          if (r.wrote && r.kept === 0 && r.flag === false && !(global_ok && report_ok)) violations++;
        }
      }
    }
  }
  ok(violations === 0,
    'T9. INVARIANT over all 16 combinations: an authoritative zero requires BOTH signals ok',
    `${violations} violation(s)`);
}

console.log(fails ? `\n${fails} check(s) failed` : '\nAll per-report EPA guard checks passed');
process.exit(fails ? 1 : 0);
