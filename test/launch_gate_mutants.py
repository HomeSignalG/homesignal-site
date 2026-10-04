#!/usr/bin/env python3
"""Prohibited mutations of the product the LAUNCH GATE stands on (Development Activity build step 13). The gate is test/launch_gate_pg/run.sh: one scenario,
invite -> 20 free reports -> the end of the trial -> checkout -> payment -> 100 paid reports -> the 101st refused -> cancellation, through the REAL handlers
and the SHIPPED SQL of every layer. Each mutation breaks ONE rule somewhere on that path (an edge function, a shared module, or the SQL) and the gate MUST fail on
its own - it does not borrow the verdict of the layer suites (test/billing_mutants.py, test/brokerage_billing_pg/mutate.py), which already kill most of these.
A gate that only passes when everything is right and cannot see the breaks is not a gate.

KILLED means the run exited non-zero AND printed a named `FAIL —` line (or the SQL file named in it refused to apply, which is the file's own post-condition catching
the break). A run that only CRASHES - an uncaught exception, no summary - is NOT a kill: it is reported as CRASHED and counts as a survivor, because a crash says
something is wrong but not what the gate checked.

Each mutation is made in a COPY of the files the gate reads (nothing in the working tree is ever edited), against its own disposable database, four at a time. The
UNMUTATED copy runs first as the positive control: it must pass in full, or no verdict below means anything. An anchor that does not match exactly once is a harness
fault, never a pass; a mutation that changes nothing is a harness fault. Exit 0 if every mutation was killed, 1 if any survived or crashed, 2 on a harness fault.

    PGHOST=/tmp/pgc PGPORT=5544 PGUSER=postgres python3 test/launch_gate_mutants.py [name ...]
    (WORKERS=4 by default; DB_PREFIX names the disposable databases it creates, so two loops can run side by side.)
(Manual, like the other mutation loops: CI runs the gate, not this loop. It needs a Postgres the caller can create databases in.)
"""
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FN = 'supabase/functions/'
LB = FN + '_shared/lemon-billing.ts'
BR = FN + '_shared/billing-reads.ts'
MH = FN + 'manage-billing/handler.ts'
WH = FN + 'development-activity-billing-webhook/handler.ts'
RH = FN + 'get-development-activity-report/handler.ts'
RS = FN + '_shared/report-snapshot.ts'
BILL = 'docs/brokerage-billing.sql'
LEDGER = 'docs/payment-event-ledger.sql'
SQLS = ['brokerage-account-spine', 'report-private-context', 'report-snapshot', 'evaluation-entitlement', 'saved-reports', 'report-share', 'report-share-delivery',
        'property-watch', 'payment-event-ledger', 'report-header', 'brokerage-billing', 'report-rate-limit']
M = {}


def m(name, f, old, new):
    assert name not in M, name
    M[name] = [(f, old, new)]


def mm(name, pairs):
    assert name not in M, name
    M[name] = list(pairs)


# ---- the edge: who may start a checkout, and when -----------------------------------------------------------------------------------------------------
m('agent_may_start_a_checkout', MH, "  if (u.role !== 'owner') return 'not_owner';\n", "")
mm('a_paid_brokerage_is_offered_a_second_checkout', [(MH, "  if (u.state === 'paid') return 'already_paid';\n", ""),
                                                      (MH, "u.state !== 'canceled' && u.state !== 'test_only')", "u.state !== 'canceled' && u.state !== 'test_only' && u.state !== 'paid')")])
m('a_test_subscription_blocks_the_real_checkout', MH, "u.state !== 'canceled' && u.state !== 'test_only')", "u.state !== 'canceled')")
m('a_canceled_brokerage_cannot_resubscribe', MH, "u.state !== 'none' && u.state !== 'canceled' && u.state !== 'test_only')", "u.state !== 'none' && u.state !== 'test_only')")
m('checkout_offered_without_the_processor_set_up', MH, "  if (!configured) return 'not_set_up';\n", "")
m('plan_answer_names_the_brokerage', BR, "return { state: u.state, role: u.role,", "return { brokerage_id: u.brokerage_id, state: u.state, role: u.role,")
# ---- the checkout and the webhook: which payment belongs to which brokerage ------------------------------------------------------------------------------
m('checkout_without_its_signature', LB, "checkout_data: { custom: { brokerage_id: brokerageId, bind } },", "checkout_data: { custom: { brokerage_id: brokerageId } },")
m('checkout_marked_test_when_live', LB, "        ...(cfg.testMode ? { test_mode: true } : {}),\n", "        test_mode: true,\n")
m('webhook_signature_not_checked', WH, "    if (!(await verifySignature(deps.secret, raw, req.headers.get(SIGNATURE_HEADER)))) return reply({ error: 'unauthorized' }, 401);\n", "")
m('binding_not_verified', LB, "  if (!(await verifyBinding(cfg.secret, custom.brokerage_id, custom.bind))) return { kind: 'ignore', reason: 'bad_binding' };\n", "")
m('another_product_recorded', LB, "  if (!cfg.variantId || variant !== cfg.variantId) return { kind: 'ignore', reason: 'variant' };\n", "")
m('test_payment_called_live', LB, "    livemode: !testMode,", "    livemode: true,")
m('order_events_recorded', LB, "  if (!SUBSCRIPTION_EVENTS.includes(eventName)) return { kind: 'ignore', reason: 'event_name' };\n", "")
m('a_malformed_event_is_guessed_at', LB, "  if (typeof updated !== 'string' || !ISO_WITH_OFFSET.test(updated) || !Number.isFinite(Date.parse(updated))) return { kind: 'invalid', reason: 'updated_at' };\n", "")
# ---- the report function: the refusals come BEFORE any work ---------------------------------------------------------------------------------------------
m('complete_trial_reaches_the_issue_function', RH, "if (trial && trial.complete && !paid) return reply(", "if (false && trial && trial.complete && !paid) return reply(")
m('spent_month_reaches_the_issue_function', RH, "    if (trial && paid && plan!.credits_remaining <= 0) return reply(req, { error: 'allotment_complete', trial: trialSummary(trial.trial), ...planInfo }, 403);\n", "")
m('a_test_payment_counts_as_paid', RH, "const paid = plan?.state === 'paid';", "const paid = plan?.state === 'paid' || plan?.state === 'test_only';")
m('a_paid_report_is_charged_by_the_free_function', RS, "rpc('brokerage_report_issue', {", "rpc('evaluation_report_issue', {")
# ---- the database: the plan, the cap, the numbering, the binding, the lock-down ----------------------------------------------------------------------------
m('a_test_subscription_is_paid', BILL, "           when not b.livemode then 'test_only'\n", "")
m('cancelled_reads_as_paid', BILL, "           when e.mapped_status = 'canceled' then 'canceled'\n", "           when e.mapped_status = 'canceled' then 'paid'\n")
m('plan_shows_a_month_before_payment', BILL, "case when pl.state = 'paid' then greatest(public.billing_report_limit() - u.n, 0) else 0 end", "greatest(public.billing_report_limit() - u.n, 0)")
m('the_hundred_is_not_enforced_by_the_issue_function', BILL, "  if v_used >= public.billing_report_limit() then\n    raise exception using errcode = 'EV010', message = 'ALLOTMENT_COMPLETE';",
  "  if v_used > public.billing_report_limit() then\n    raise exception using errcode = 'EV010', message = 'ALLOTMENT_COMPLETE';")
m('the_hundred_is_not_a_constraint', BILL, "check (ordinal between 1 and public.billing_report_limit())", "check (ordinal between 1 and 1000)")
m('paid_reports_go_to_the_free_ledger', BILL, "  if not found or pl.state is distinct from 'paid'\n", "  if true or not found or pl.state is distinct from 'paid'\n")
m('paid_reports_are_not_in_the_ownership_view', BILL,
  "    from public.evaluation_credit c\n  union all\n  select e.evaluation_id, p.number, p.idempotency_key, p.report_id, p.issued_at\n    from public.brokerage_paid_credit p\n    join public.evaluation e on e.brokerage_id = p.brokerage_id;",
  "    from public.evaluation_credit c;")
m('a_subscription_can_move_to_another_brokerage', BILL, "  if found and b.brokerage_id <> p_brokerage then\n", "  if false and found and b.brokerage_id <> p_brokerage then\n")
m('an_old_event_displaces_a_newer_one', LEDGER, "   order by e.occurred_at desc, e.event_id desc\n   limit 1\n$$;", "   order by e.event_id desc\n   limit 1\n$$;")
m('billing_open_to_a_resident_role', BILL, "grant execute on function public.billing_usage(uuid)                                  to service_role;", "grant execute on function public.billing_usage(uuid)                                  to service_role, authenticated;")


# ---- the report rate limit (section 15 of the gate): the gate alone must see each of these ------------------------------------------------------------
RDATA = FN + 'get-development-activity-report/data.ts'
RRD = FN + '_shared/rate-reads.ts'
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
m('the_report_function_stops_claiming', RH, CLAIM_BLOCK, "")
m('an_unreadable_limiter_lets_the_request_through', RH, "const verdict = await deps.rateClaim(trial.userId);", "const verdict = await deps.rateClaim(trial.userId).catch(() => ({ allowed: true } as RateVerdict));")
m('a_refusal_keeps_going_to_the_geocoder', RH, "          return limited;\n        }\n      }\n", "        }\n      }\n")
m('the_reader_treats_a_database_error_as_allowed', RRD, "if (error) throw new DataUnavailable('report_rate_claim');", "if (error) return { allowed: true };")
m('the_limiter_counts_a_refused_request', 'docs/report-rate-limit.sql', "    return query select false, v_worst, v_scope, v_win;\n    return;\n", "    return query select false, v_worst, v_scope, v_win;\n")
m('the_limiter_ignores_the_window_rolling_over', 'docs/report-rate-limit.sql', "      set used         = case when w.window_start >= excluded.window_start then w.used + 1 else 1 end,", "      set used         = w.used + 1,")


def run_gate(root, db, env):
    e = dict(env, PGDATABASE=db)
    p = subprocess.run(['bash', str(root / 'test/launch_gate_pg/run.sh')], capture_output=True, text=True, env=e, timeout=900)
    return p.returncode, (p.stdout + '\n' + p.stderr)


def make_copy(dest):
    shutil.copytree(ROOT / 'supabase/functions', dest / 'supabase/functions')
    (dest / 'docs').mkdir(parents=True)
    for s in SQLS:
        shutil.copy(ROOT / 'docs' / (s + '.sql'), dest / 'docs' / (s + '.sql'))
    (dest / 'test/launch_gate_pg').mkdir(parents=True)
    for f in ['run.sh', 'roundtrip.mjs']:
        shutil.copy(ROOT / 'test/launch_gate_pg' / f, dest / 'test/launch_gate_pg' / f)
    (dest / 'test/lib').mkdir(parents=True)
    shutil.copy(ROOT / 'test/lib/launch-test-location.mjs', dest / 'test/lib/launch-test-location.mjs')   # the one test location the round trip imports
    (dest / 'test/evaluation_entitlement_pg').mkdir(parents=True)
    shutil.copy(ROOT / 'test/evaluation_entitlement_pg/fixture.sql', dest / 'test/evaluation_entitlement_pg/fixture.sql')


def apply(dest, pairs):
    for f, old, new in pairs:
        p = dest / f
        text = p.read_text()
        if text.count(old) != 1:
            raise SystemExit('HARNESS FAULT: anchor in %s matched %d times (need exactly 1): %r' % (f, text.count(old), old[:90]))
        if old == new:
            raise SystemExit('HARNESS FAULT: the mutation changes nothing: %r' % old[:90])
        p.write_text(text.replace(old, new))


def verdict(code, out):
    summary = re.search(r'(\d+) passed, (\d+) failed of (\d+)', out)
    named = [l for l in out.splitlines() if l.startswith('FAIL —')]
    checked = [l for l in named if not l.startswith('FAIL — the scenario stopped')]      # the gate's own catch-all for a throw is a crash, not a kill
    if code == 0:
        return 'SURVIVED', ['the gate passed']
    if checked and (summary or 'does not apply' in out):
        return 'KILLED', checked[:3]
    return 'CRASHED', [l for l in out.splitlines() if l.strip()][-3:]


def main():
    env = dict(os.environ)
    for k in ('PGHOST', 'PGPORT', 'PGUSER'):
        if not env.get(k):
            raise SystemExit('set ' + k)
    names = sys.argv[1:] or list(M)
    unknown = [x for x in names if x not in M]
    if unknown:
        raise SystemExit('unknown mutation(s): ' + ', '.join(unknown))
    workers = int(os.environ.get('WORKERS', '4'))
    prefix = os.environ.get('DB_PREFIX', 'lg_disposable_')
    if 'disposable' not in prefix:
        raise SystemExit('DB_PREFIX must name a disposable database')
    dbs = [prefix + str(i) for i in range(workers)]
    for d in dbs:
        subprocess.run(['psql', '-X', '-q', '-d', 'postgres', '-c', 'create database %s' % d], env=env, capture_output=True)
    base = Path(tempfile.mkdtemp(prefix='lg_mut_'))
    pool = queue.Queue()
    for d in dbs:
        pool.put(d)
    try:
        control = base / '_control'
        make_copy(control)
        db = pool.get()
        code, out = run_gate(control, db, env)
        pool.put(db)
        summ = re.search(r'(\d+) passed, (\d+) failed of (\d+)', out)
        if code != 0 or not summ or summ.group(2) != '0':
            print(out[-3000:])
            raise SystemExit('HARNESS FAULT: the UNMUTATED gate does not pass; no verdict below would mean anything')
        print('CONTROL  the unmutated copy passes: %s passed of %s' % (summ.group(1), summ.group(3)))

        def one(name):
            dest = base / name
            make_copy(dest)
            apply(dest, M[name])
            d = pool.get()
            try:
                code, out = run_gate(dest, d, env)
            finally:
                pool.put(d)
            shutil.rmtree(dest, ignore_errors=True)
            return name, verdict(code, out)

        results = []
        with ThreadPoolExecutor(max_workers=workers) as ex:
            for name, (v, lines) in ex.map(one, names):
                results.append((name, v))
                print('%-9s %s' % (v, name))
                if v != 'KILLED':
                    for l in lines:
                        print('            ' + l)
                else:
                    print('            ' + lines[0][:150])
                sys.stdout.flush()
    finally:
        shutil.rmtree(base, ignore_errors=True)
    bad = [n for n, v in results if v != 'KILLED']
    print('\n%d mutations: %d killed, %d not killed' % (len(results), len(results) - len(bad), len(bad)))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
