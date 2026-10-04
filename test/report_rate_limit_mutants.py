#!/usr/bin/env python3
"""Prohibited mutations of the EDGE half of the report rate limit (docs/report-rate-limit.sql is mutated by test/report_rate_limit_pg/mutate.py). Each mutation
breaks ONE rule the limiter rests on - where the claim is made, for whom, what it answers, how it fails, what is allowed to reach the counters, what the credit path
may know - and the offline tests MUST fail on their own, each by a named `FAIL —` line:
    test/report-rate-limit-function.test.mjs   the handler and the shared reader, driven
    test/report-rate-limit-structure.test.mjs  where and what each piece is
    test/brigham-city-84302-journey.test.mjs   the launch test location through the real data layer
    test/national-report-function.test.mjs     the handler as it was before the limiter (the order of its steps)
    test/evaluation-entitlement-structure.test.mjs   the credit layer's one set of callers
and, for a mutation of the customer page, test/development-activity-reports.browser.test.mjs (Chromium).

KILLED means a run exited non-zero AND printed a `FAIL —` line. A run that only CRASHES (no summary line) is NOT a kill: it counts as a survivor, because a crash says
something is wrong but not what was checked. Each mutation is made in a COPY of the tree (nothing in the working tree is ever edited). The UNMUTATED copy runs first as
the positive control and must pass in full. An anchor that does not match exactly the stated number of times is a harness fault, as is a mutation that changes nothing.
Exit 0 if every mutation was killed, 1 if any survived or crashed, 2 on a harness fault.

    python3 test/report_rate_limit_mutants.py [name ...]
(Manual, like the other mutation loops. It needs only node; the browser test runs for the page mutations only and needs Chromium.)
"""
import os
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FN = 'supabase/functions/'
RH = FN + 'get-development-activity-report/handler.ts'
RD = FN + 'get-development-activity-report/data.ts'
RR = FN + '_shared/rate-reads.ts'
CR = FN + '_shared/credit-rule.ts'
MBH = FN + 'manage-billing/handler.ts'
SQL = 'docs/report-rate-limit.sql'
PAGE = 'development-activity-reports.html'
WF = '.github/workflows/report-snapshot-suite.yml'

OFFLINE = ['report-rate-limit-function', 'report-rate-limit-structure', 'brigham-city-84302-journey', 'national-report-function', 'evaluation-entitlement-structure']
BROWSER = ['development-activity-reports.browser']

M = {}  # name -> (tests, [(file, old, new, count)])


def m(name, f, old, new, count=1, tests=OFFLINE):
    assert name not in M, name
    M[name] = (tests, [(f, old, new, count)])


def mm(name, edits, tests=OFFLINE):
    assert name not in M, name
    M[name] = (tests, list(edits))


CLAIM_BLOCK = ("      if (trial) {\n"
               "        const verdict = await deps.rateClaim(trial.userId);\n"
               "        if (!verdict.allowed) {\n"
               "          const limited = reply(req, {\n"
               "            error: 'rate_limited', retry_after_seconds: verdict.retryAfterSeconds, limited_by: verdict.limitedBy, ...trialInfo,\n"
               "          }, 429);\n"
               "          limited.headers.set('Retry-After', String(verdict.retryAfterSeconds));\n"
               "          return limited;\n"
               "        }\n"
               "      }\n")
GEOCODE_LINE = "      const g = await deps.geocode(address);\n"
ZIP_LINE = "      if (!supported) return reply(req, { status: 'OUTSIDE_COVERAGE', zip: g.zip, report: null, stored: false, credit: creditDecision({ status: 'OUTSIDE_COVERAGE' }), ...trialInfo });\n"
UNKNOWN_LINE = "    const unknown = Object.keys(b).filter((k) => !['address', 'radius_mi', 'view', 'label', 'idempotency_key'].includes(k));\n"

# ---- where the claim is made, and for whom -------------------------------------------------------------------------------------------------------
m('claim_removed', RH, CLAIM_BLOCK, "")
mm('claim_after_the_geocoder', [(RH, CLAIM_BLOCK, "", 1, ), (RH, ZIP_LINE, ZIP_LINE + CLAIM_BLOCK, 1)])
mm('claim_before_validation', [(RH, CLAIM_BLOCK, "", 1), (RH, UNKNOWN_LINE, "    if (trial) { const early = await deps.rateClaim(trial.userId); if (!early.allowed) return reply(req, { error: 'rate_limited' }, 429); }\n" + UNKNOWN_LINE, 1)])
m('claim_for_everyone_admin_included', RH, "      if (trial) {\n        const verdict = await deps.rateClaim(trial.userId);", "      if (true) {\n        const verdict = await deps.rateClaim(trial!.userId);")
m('claim_taken_by_a_read', RH, "      if (!trial) return reply(req, { error: 'forbidden' }, 403);\n      try {", "      if (!trial) return reply(req, { error: 'forbidden' }, 403);\n      await deps.rateClaim(trial.userId);\n      try {")
m('claim_names_the_address', RH, "await deps.rateClaim(trial.userId);", "await deps.rateClaim(address);")
# ---- what a refusal looks like ---------------------------------------------------------------------------------------------------------------------
m('refusal_is_a_403', RH, "          }, 429);\n", "          }, 403);\n")
m('refusal_has_no_retry_after_header', RH, "          limited.headers.set('Retry-After', String(verdict.retryAfterSeconds));\n", "")
m('refusal_keeps_going_to_the_geocoder', RH, "          return limited;\n        }\n      }\n", "        }\n      }\n")
m('refusal_drops_the_wait', RH, "retry_after_seconds: verdict.retryAfterSeconds, limited_by", "retry_after_seconds: 0, limited_by")
m('refusal_echoes_the_address', RH, "error: 'rate_limited', retry_after_seconds", "error: 'rate_limited', address, retry_after_seconds")
# ---- fail closed ------------------------------------------------------------------------------------------------------------------------------------
m('unreadable_claim_lets_the_request_through', RH, "const verdict = await deps.rateClaim(trial.userId);", "const verdict = await deps.rateClaim(trial.userId).catch(() => ({ allowed: true } as RateVerdict));")
m('reader_error_means_allowed', RR, "if (error) throw new DataUnavailable('report_rate_claim');", "if (error) return { allowed: true };")
m('reader_takes_the_first_of_many_rows', RR, "if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');", "if (!Array.isArray(data) || data.length < 1) throw new DataUnavailable('shape');")
m('reader_accepts_any_wait', RR, "if (!Number.isInteger(r.retry_after_seconds) || r.retry_after_seconds < 1 || r.retry_after_seconds > 86400", "if (!Number.isInteger(r.retry_after_seconds)")
m('reader_accepts_an_unknown_limiter', RR, "|| (r.limited_by !== 'user' && r.limited_by !== 'brokerage')", "")
m('reader_accepts_an_unknown_window', RR, "|| !(WINDOW_SECONDS as readonly number[]).includes(r.limited_window_secs)", "")
m('reader_accepts_a_contradictory_allow', RR, "if (r.retry_after_seconds !== 0 || r.limited_by !== null || r.limited_window_secs !== null) throw new DataUnavailable('shape');", "")
m('reader_sends_any_id', RR, "if (!UUID.test(userId)) throw new DataUnavailable('rate claim needs a user id');", "")
m('reader_calls_the_clocked_claim', RR, "rpc('report_rate_claim', { p_user: userId })", "rpc('report_rate_claim_at', { p_user: userId })")
m('data_layer_not_wired', RD, "    rateClaim: rate.claim,\n", "")
# ---- one definition of the numbers; one way in; the credit path does not know ----------------------------------------------------------------
m('a_copy_of_the_numbers_in_the_edge', RR, "export type LimitedBy", "const MAX_REQUESTS = 10;\nexport type LimitedBy")
m('another_function_reaches_the_counters', MBH, "import { DataUnavailable } from '../_shared/service-rest.ts';\n", "import { DataUnavailable } from '../_shared/service-rest.ts';\nconst _counters = 'report_rate_window';\n")
m('the_credit_rule_knows_the_limiter', CR, "export const CREDIT_RULE_VERSION = 'credit-rule-1';", "const _limiter = 'report_rate_claim';\nexport const CREDIT_RULE_VERSION = 'credit-rule-1';")
m('another_function_claims', MBH, "import { DataUnavailable } from '../_shared/service-rest.ts';\n", "import { DataUnavailable } from '../_shared/service-rest.ts';\nconst rateClaim = 1;\n")
# ---- the SQL file's own shape -------------------------------------------------------------------------------------------------------------------------
m('sql_grants_the_claim_to_a_resident_role', SQL, "grant execute on function public.report_rate_claim(uuid)                 to service_role;\n",
  "grant execute on function public.report_rate_claim(uuid)                 to service_role;\ngrant execute on function public.report_rate_claim(uuid) to authenticated;\n")
m('sql_table_keeps_an_email', SQL, "  used          integer     not null,\n", "  used          integer     not null,\n  email         text,\n")
m('sql_no_longer_checks_the_free_number', SQL, "  if public.evaluation_report_limit() <> 20 then raise exception 'report_rate_limit: the free report limit is not 20 (founder-set; this file must not change it)'; end if;\n", "")
m('sql_writes_the_free_ledger', SQL, "-- ROLLBACK (this file only", "update public.evaluation set status = status;\n-- ROLLBACK (this file only")
m('sql_loses_its_rollback_drops', SQL, "-- drop function if exists public.report_rate_check();\n", "")
# ---- the page --------------------------------------------------------------------------------------------------------------------------------------------
m('page_has_no_429_message', PAGE, "if (httpStatus === 429 && body.error === 'rate_limited') {", "if (false) {", tests=['report-rate-limit-structure'] + BROWSER)
m('page_shows_the_code', PAGE, "' Try again in ' + waitWords(body.retry_after_seconds) + '. This did not use ' + oneOf() + '.';", "' Try again in ' + waitWords(body.retry_after_seconds) + '. (429 ' + body.error + ')';", tests=['report-rate-limit-structure'] + BROWSER)
m('page_forgets_to_say_nothing_was_used', PAGE, "' Try again in ' + waitWords(body.retry_after_seconds) + '. This did not use ' + oneOf() + '.';", "' Try again in ' + waitWords(body.retry_after_seconds) + '.';", tests=['report-rate-limit-structure'] + BROWSER)
# ---- the record ------------------------------------------------------------------------------------------------------------------------------------------
m('ci_stops_running_the_suite', WF, "bash test/report_rate_limit_pg/run.sh 2>&1 | grep -v NOTICE | tee /tmp/report-rate-limit.log", "true")
m('ci_stops_watching_the_shared_reader', WF, "      - 'supabase/functions/_shared/rate-reads.ts'\n", "", 2)


def run_test(root, name):
    f = root / 'test' / (name + '.test.mjs')
    p = subprocess.run(['node', str(f)], capture_output=True, text=True, cwd=str(root), timeout=900)
    out = p.stdout + p.stderr
    fails = [l for l in out.splitlines() if l.startswith('FAIL —')]
    summary = [l for l in out.splitlines() if ' passed, ' in l or ' passed' in l.split('failed')[0]]
    return p.returncode, fails, bool(summary), out


def make_copy(dest):
    def ignore(d, names):
        return [x for x in names if x in ('.git', 'node_modules')]
    shutil.copytree(ROOT, dest, ignore=ignore)
    nm = ROOT / 'node_modules'
    if nm.exists():
        os.symlink(nm, dest / 'node_modules')


def apply(root, edits):
    for f, old, new, count in edits:
        p = root / f
        text = p.read_text()
        found = text.count(old)
        if found != count:
            raise SystemExit('HARNESS FAULT: anchor in %s matches %d times, expected %d: %r' % (f, found, count, old[:80]))
        p.write_text(text.replace(old, new))


def trial(name, base):
    tests, edits = M[name]
    dest = base / name
    make_copy(dest)
    before = {f: (dest / f).read_text() for f, *_ in edits}
    apply(dest, edits)
    if all((dest / f).read_text() == before[f] for f in before):
        return name, 'HARNESS', 'changed nothing'
    crashed = []
    for t in tests:
        rc, fails, summary, out = run_test(dest, t)
        if fails and rc != 0:
            shutil.rmtree(dest, ignore_errors=True)
            return name, 'KILLED', t + ': ' + fails[0][:110]
        if not summary:
            crashed.append(t)
    shutil.rmtree(dest, ignore_errors=True)
    if crashed:
        return name, 'CRASHED', ', '.join(crashed) + ' stopped without a summary'
    return name, 'SURVIVED', ''


def main():
    names = sys.argv[1:] or list(M)
    for n in names:
        if n not in M:
            print('unknown mutation', n)
            return 2
    base = Path(tempfile.mkdtemp(prefix='rate-mut-'))
    try:
        # the positive control: the unmutated copy passes in full
        ctl = base / 'control'
        make_copy(ctl)
        tests = OFFLINE + (BROWSER if any(set(M[n][0]) & set(BROWSER) for n in names) else [])
        for t in tests:
            rc, fails, summary, out = run_test(ctl, t)
            if rc != 0 or fails or not summary:
                print('CONTROL FAILED — %s must pass unmutated: %s' % (t, (fails or out.splitlines()[-3:])))
                return 2
        print('control: the unmutated copy passes %d suites' % len(tests))
        shutil.rmtree(ctl, ignore_errors=True)
        results = []
        with ThreadPoolExecutor(max_workers=int(os.environ.get('WORKERS', '4'))) as ex:
            for r in ex.map(lambda n: trial(n, base), names):
                print('%-9s — %s %s' % (r[1], r[0], r[2]))
                results.append(r)
        k = sum(1 for r in results if r[1] == 'KILLED')
        s = sum(1 for r in results if r[1] == 'SURVIVED')
        c = sum(1 for r in results if r[1] in ('CRASHED', 'HARNESS'))
        print('mutations: %d · killed %d · survived %d · crashed/harness %d' % (len(results), k, s, c))
        return 0 if (s == 0 and c == 0) else 1
    finally:
        shutil.rmtree(base, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
