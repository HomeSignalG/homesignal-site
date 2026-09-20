// Offline pins for the lifecycle-handoff splice and the geography health
// integration (docs/geo-lifecycle-handoff-install.sql,
// docs/geo-health-integration-install.sql, plus both rollbacks).
//
// The behavioural proof runs on a disposable local PostgreSQL
// (scripts/geo_handoff_fixture.py, 21 checks, 4 load-bearing mutations) and the
// text transformation was verified READ-ONLY against the live production body.
// These pins guard the properties an edit could quietly remove - above all the
// four that would let a splice take the national materializer down or corrupt
// state it does not own.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL: ' + m); } };
const section = (s) => console.log('\n-- ' + s);
const count = (h, n) => h.split(n).length - 1;

const install  = readFileSync('docs/geo-lifecycle-handoff-install.sql', 'utf8');
const rollback = readFileSync('docs/geo-lifecycle-handoff-rollback.sql', 'utf8');
const health   = readFileSync('docs/geo-health-integration-install.sql', 'utf8');
const hrb      = readFileSync('docs/geo-health-integration-rollback.sql', 'utf8');
// Executable view: these files EXPLAIN the strings they forbid, so a pin that
// searches the whole text matches its own rationale. Same family as "a pin that
// names the string it forbids cannot also search the whole file for it".
const exe = (s) => s.replace(/^\s*--.*$/gm, '');

// The replacement halves only - what actually lands in the live body.
const repls = [...install.matchAll(/\$r\$([\s\S]*?)\$r\$/g)].map((m) => m[1]);
const finds = [...install.matchAll(/\$f\$([\s\S]*?)\$f\$/g)].map((m) => m[1]);

section('1. the anchor set is complete and non-degenerate');
ok(finds.length === 6, `expected 6 find anchors, got ${finds.length}`);
ok(repls.length === 6, `expected 6 replacements, got ${repls.length}`);
ok(finds.every((f) => f.length > 0), 'no find anchor may be empty');
ok(finds.every((f, i) => f !== repls[i]), 'no anchor may be a no-op');

section('2. it splices the LIVE body and fails closed');
ok(exe(install).includes("pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure)"),
   'must read the live definition');
ok(/_md5_before <> _expect_before/.test(exe(install)),
   'must abort on a precondition/drift mismatch');
ok(exe(install).includes("'6591d7f79f9a6cd0b476bbcfc2065b9a'"),
   'must pin the captured pre-install fingerprint');
ok(/_n <> 1/.test(exe(install)) && /ANCHOR NOT UNIQUE/.test(install),
   'every anchor must be asserted to occur exactly once');
ok(/EXCISION PROOF FAILED/.test(install) && /md5\(_back\) <> _md5_before/.test(exe(install)),
   'must prove the transformation is exactly reversible before applying');

section('3. exactly four handoffs, and nothing else gains one');
ok(repls.filter((r) => r.includes('geo.enqueue_work')).length === 4,
   'exactly 4 replacement blocks may call geo.enqueue_work');
ok(count(repls.join('\n'), 'geo.enqueue_work') === 4, 'exactly 4 call sites total');
for (const reason of ['project_upsert', 'stale_removed', 'geocode_nulled']) {
  ok(repls.join('\n').includes(`'${reason}'`), `reason ${reason} must be emitted`);
}
ok(count(repls.join('\n'), "'stale_removed'") === 1,
   'SOURCE_REMOVED may be emitted from ONE site only - the retention sweep');
ok(count(repls.join('\n'), "'project_upsert'") === 2,
   'NEW+UPDATE is emitted from the two upserts');

section('4. _stale is preserved, not corrupted by the CTE wrap');
const staleRepl = repls.find((r) => r.includes("'stale_removed'"));
ok(/into _stale, _geo_keys/.test(staleRepl),
   '_stale must be set from the delete\'s own RETURNING set');
ok(!staleRepl.includes('get diagnostics'),
   'the get diagnostics line must be replaced, not left to count the outer statement');
ok(/GET DIAGNOSTICS LINE READS|get diagnostics _stale = row_count;/.test(install),
   'the artifact must state the hazard it is guarding');
ok(/position\('get diagnostics _stale = row_count;' in _out\) <> 0/.test(exe(install)),
   'and assert the line is gone from the spliced text');

section('5. unrelated app_refresh_zip behaviour is preserved');
ok(/THE LINE-30 LEGACY DELETE WAS MODIFIED/.test(install),
   'the legacy source_key-is-null delete must be asserted intact');
ok(!finds.some((f) => f.includes('p.source_key is null')),
   'the line-30 delete must never be an anchor');
ok(exe(install).includes('tgisinternal') && /None is authorised/.test(install),
   'must assert zero triggers land on public.app_projects');
ok(/cron\.job where jobname/.test(exe(install)) && /scheduler must remain OFF/.test(install),
   'must assert no geography cron job exists');

section('6. no historical seeding, no worker, no scheduler');
const all = exe(install) + exe(health);
ok(!/insert\s+into\s+geo\.n5_reconcile_queue[\s\S]{0,400}from\s+public\.app_projects/i.test(all),
   'must not seed the queue from app_projects');
ok(!/cron\.schedule|cron\.alter_job/i.test(all), 'must not schedule anything');
ok(!/select\s+geo\.n5_reconcile\b|perform\s+geo\.n5_reconcile\b/i.test(all),
   'must not execute reconciliation');

section('7. the dependency order is enforced, not merely documented');
ok(/DEPENDENCY MISSING: geo\.n5_reconcile_queue/.test(install),
   'must refuse without the queue');
ok(/DEPENDENCY MISSING: geo\.enqueue_work/.test(install),
   'must refuse without the enqueue function - otherwise every tick raises 42883');
ok(/DEPENDENCY MISSING: geo\.geography_health_probe/.test(health),
   'health integration must refuse without its probe');

section('8. health integration pins the CURRENT body, not the stale baseline');
ok(health.includes("'c51e56b4158453184d966f00ef28cbb2'"),
   'must pin the live pipeline_health_tick fingerprint');
ok(!exe(health).includes('258df595490b81c3dfcc7086cf9f8c39'),
   'must NOT restore the stale dedb7db baseline body');
ok(/_evals_after <> _evals_before \+ 2/.test(exe(health)),
   'must expect TWO new _eval inserts (normal + exception branch), not one');
ok(/SPLICE WOULD DROP EXISTING CHECK\(S\)/.test(health),
   'must assert every pre-existing check survives');
ok(/from public\.pipeline_health_check c\s*\n\s*where position\(c\.check_name in _out\) = 0/.test(exe(health)),
   'and must COMPUTE that list rather than transcribe it');

section('9. health reports NOT_ACTIVATED, never HEALTHY-by-absence');
const hrepl = health.slice(health.indexOf('_repl constant text :='));
ok(hrepl.includes("g.state <> 'NOT_ACTIVATED'"),
   'NOT_ACTIVATED must be NOT alertable');
ok(hrepl.includes("g.state in ('HEALTHY','NOT_ACTIVATED')"),
   'ok must not page while deliberately off');
ok(/UNMEASURED: geography health probe unavailable/.test(hrepl),
   'a missing probe degrades to UNMEASURED, never to a pass');
ok(/exception when others then/.test(hrepl),
   'a failing probe must not abort the whole health tick');

section('10. both rollbacks are exact and fail closed');
ok(rollback.includes("'ba2e6f9d8932d08e4373bfe97ae25ffd'") &&
   rollback.includes("'6591d7f79f9a6cd0b476bbcfc2065b9a'"),
   'handoff rollback pins both fingerprints');
ok(/ROLLBACK DID NOT RECONSTRUCT THE ORIGINAL/.test(rollback),
   'handoff rollback asserts it reconstructed the original');
ok(hrb.includes("'c98aad2d980a595982638a49e2472223'") &&
   hrb.includes("'c51e56b4158453184d966f00ef28cbb2'"),
   'health rollback pins both fingerprints');
ok(/ROLLBACK DID NOT RECONSTRUCT THE ORIGINAL/.test(hrb),
   'health rollback asserts it reconstructed the original');

section('11. negative control - the pins can actually fail');
{
  const neutered = install.replace(/_md5_before <> _expect_before/, 'false');
  ok(!/_md5_before <> _expect_before/.test(exe(neutered)),
     'control: removing the drift guard is detectable by these pins');
}

console.log(`\n${pass + fail} checks, ${fail} failures`);
if (fail) process.exit(1);
