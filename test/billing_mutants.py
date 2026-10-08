#!/usr/bin/env python3
"""Prohibited mutations of the $79 a month plan (Development Activity build step 11) - everything except the SQL, whose own harness is
test/brokerage_billing_pg/mutate.py. Each MUST make one of the suites listed against it exit non-zero:

    test/lemon-billing.test.mjs                  (the processor module: signature, checkout binding, translation, the checkout request and its answer)
    test/billing-functions.test.mjs              (manage-billing and the webhook, over a stand-in database, processor and clock)
    test/billing-structure.test.mjs              (the SQL's shape, the single modules that name things, the order of the checks, the wiring)
    test/national-report-function.test.mjs       (the report function: the plan read, the two refusals, the credit that is shown)
    test/report-snapshot.test.mjs                (the one way a member's report is stored, and what it will believe about the credit)
    test/development-activity-reports.test.mjs   (the customer page, source-level contract)
    test/development-activity-reports.browser.test.mjs   (the customer page in Chromium, against the REAL manage-billing handler)

It edits one file in place, runs the suites, and ALWAYS restores it, even on error or ^C. An anchor that does not match exactly once is a harness
fault, never a pass. A mutation may be several (old, new) pairs in ONE file; each must match exactly once. A mutation that changes nothing is a
harness fault. Exit 0 if every mutation was killed, 1 if any survived, 2 on a harness fault. The browser suite needs Playwright (as in CI's
browser job). (Manual, like the other mutation loops: CI runs the tests, not this loop.)

    python3 test/billing_mutants.py [name ...]
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FN = 'supabase/functions/'
LB = FN + '_shared/lemon-billing.ts'
BR = FN + '_shared/billing-reads.ts'
RS = FN + '_shared/report-snapshot.ts'
MH = FN + 'manage-billing/handler.ts'
MD = FN + 'manage-billing/data.ts'
MI = FN + 'manage-billing/index.ts'
WH = FN + 'development-activity-billing-webhook/handler.ts'
WI = FN + 'development-activity-billing-webhook/index.ts'
RH = FN + 'get-development-activity-report/handler.ts'
CONFIG = 'supabase/config.toml'
DEPLOY = '.github/workflows/deploy-edge-functions.yml'
PAGE = 'development-activity-reports.html'
LANDING = 'development-activity.html'

LBT = 'test/lemon-billing.test.mjs'
BFT = 'test/billing-functions.test.mjs'
BST = 'test/billing-structure.test.mjs'
NRF = 'test/national-report-function.test.mjs'
RST = 'test/report-snapshot.test.mjs'
AGS = 'test/development-activity-reports.test.mjs'
AGB = 'test/development-activity-reports.browser.test.mjs'
EDGE = [LBT, BFT, BST, NRF, RST]           # cheap offline suites
PAGES = [AGS, AGB]                         # Chromium last
M = {}


def m(name, old, new, tests, f):
    assert name not in M, name
    M[name] = (f, [(old, new)], list(tests))


def mm(name, pairs, tests, f):
    assert name not in M, name
    M[name] = (f, list(pairs), list(tests))


# ---- the processor module: is it really the processor, and which brokerage does it name ---------------------------------------------------------------
m('empty_secret_verifies', "if (typeof secret !== 'string' || !secret || typeof rawBody !== 'string'", "if (typeof secret !== 'string' || typeof rawBody !== 'string'", EDGE, LB)
m('signature_over_a_trimmed_body', "return timingSafeEqual(given, await hmacHex(secret, rawBody));", "return timingSafeEqual(given, await hmacHex(secret, rawBody.trim()));", EDGE, LB)
m('signature_compared_plainly', "return timingSafeEqual(given, await hmacHex(secret, rawBody));", "return given === await hmacHex(secret, rawBody);", EDGE, LB)
# NOT A MUTATION, ON PURPOSE: removing `if (!HEX64.test(given)) return false;` from verifySignature is an EQUIVALENT mutant. A header that is not 64 hex
# characters can never equal the 64-hex HMAC, so timingSafeEqual refuses it anyway (test 1h proves that outcome); the early check only avoids computing an HMAC for it.
m('length_difference_compared_equal', "a.length !== b.length) return false;\n  let diff = 0;", "false) return false;\n  let diff = 0;", EDGE, LB)
m('binding_not_verified', "  if (!(await verifyBinding(cfg.secret, custom.brokerage_id, custom.bind))) return { kind: 'ignore', reason: 'bad_binding' };\n", "", EDGE, LB)
m('binding_signed_without_its_context', "const BINDING_CONTEXT = 'hs-billing-checkout|';", "const BINDING_CONTEXT = '';", EDGE, LB)
m('binding_signed_over_nothing', "return hmacHex(secret, BINDING_CONTEXT + brokerageId);", "return hmacHex(secret, BINDING_CONTEXT);", EDGE, LB)
m('another_product_recorded', "  if (!cfg.variantId || variant !== cfg.variantId) return { kind: 'ignore', reason: 'variant' };\n", "", EDGE, LB)
m('no_variant_configured_matches_all', "if (!cfg.variantId || variant !== cfg.variantId)", "if (cfg.variantId && variant !== cfg.variantId)", EDGE, LB)
m('test_events_called_live', "    livemode: !testMode,", "    livemode: true,", EDGE, LB)
mm('missing_test_flag_means_live', [("attrs.test_mode : null;\n  if (testMode === null) return { kind: 'invalid', reason: 'test_mode' };", "attrs.test_mode : false;")], EDGE, LB)
m('other_events_recorded', "  if (!SUBSCRIPTION_EVENTS.includes(eventName)) return { kind: 'ignore', reason: 'event_name' };\n", "", EDGE, LB)
m('invoices_recorded_as_subscriptions', "  if (data.type !== 'subscriptions') return { kind: 'ignore', reason: 'type' };\n", "", EDGE, LB)
m('event_key_ignores_the_time', "idempotency_key: eventName + ':' + id + ':' + updated,", "idempotency_key: eventName + ':' + id,", EDGE, LB)
m('time_without_an_offset_accepted', "(\\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$/;", "(\\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})?$/;", EDGE, LB)
m('status_not_checked', "  if (typeof status !== 'string' || !STATUS.test(status)) return { kind: 'invalid', reason: 'status' };\n", "", EDGE, LB)
m('event_carries_the_customer', "    variant_ref: variant,\n", "    variant_ref: variant,\n    customer_ref: String(attrs.customer_id),\n", EDGE, LB)
m('checkout_without_the_signature', "checkout_data: { custom: { brokerage_id: brokerageId, bind } },", "checkout_data: { custom: { brokerage_id: brokerageId } },", EDGE, LB)
m('checkout_never_in_test_mode', "...(cfg.testMode ? { test_mode: true } : {}),", "", EDGE, LB)
m('checkout_always_in_test_mode', "...(cfg.testMode ? { test_mode: true } : {}),", "test_mode: true,", EDGE, LB)
m('checkout_unconfigured_still_asked', "  if (!cfg.apiKey || !cfg.storeId || !cfg.variantId || !cfg.secret) throw new Error('lemon-billing: the checkout is not configured');\n", "", EDGE, LB)
m('checkout_url_any_host', "  if (host !== 'lemonsqueezy.com' && !host.endsWith('.lemonsqueezy.com')) return null;\n", "", EDGE, LB)
m('checkout_url_lookalike_host', "!host.endsWith('.lemonsqueezy.com')", "!host.endsWith('lemonsqueezy.com')", EDGE, LB)
m('checkout_url_plain_http', "  if (u.protocol !== 'https:' || u.username || u.password) return null;\n", "  if (u.username || u.password) return null;\n", EDGE, LB)
m('checkout_url_with_credentials', "  if (u.protocol !== 'https:' || u.username || u.password) return null;\n", "  if (u.protocol !== 'https:') return null;\n", EDGE, LB)

# ---- the one reader of the plan --------------------------------------------------------------------------------------------------------------------------
m('plan_state_unchecked', "|| !(PLAN_STATES as readonly string[]).includes(u.state) ||", "||", EDGE, BR)
m('negative_balance_accepted', "|| u.credits_used < 0 || u.credits_remaining < 0", "", EDGE, BR)
m('summary_names_the_brokerage', "return { state: u.state, role: u.role,", "return { brokerage_id: u.brokerage_id, state: u.state, role: u.role,", EDGE, BR)
m('binding_conflict_called_outage', "        if (error.message === 'BINDING_CONFLICT') throw new BindingConflict('refused');\n", "", EDGE, BR)
m('unknown_brokerage_called_outage', "        if (error.message === 'BROKERAGE_UNKNOWN') throw new BrokerageUnknown('refused');\n", "", EDGE, BR)
m('ledger_refusal_called_outage', "        if (/^payment_event:|^billing_event_apply:/.test(error.message)) throw new EventRefused('refused');\n", "", EDGE, BR)
m('malformed_brokerage_sent_to_the_database', "      if (!UUID.test(brokerageId)) throw new BrokerageUnknown('malformed');\n", "", EDGE, BR)
m('applied_shape_unchecked', "      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');\n      const r = data[0];\n      if (!r || (r.outcome", "      const r = data[0];\n      if (!r || (r.outcome", EDGE, BR)

# ---- the Billing function: who may start a checkout, and over what ---------------------------------------------------------------------------------------
m('agent_may_start_a_checkout', "  if (u.role !== 'owner') return 'not_owner';\n", "", EDGE, MH)
m('paid_brokerage_offered_a_second_checkout', "  if (u.state === 'paid') return 'already_paid';\n", "", EDGE, MH)
m('past_due_offered_a_second_checkout', "if (u.state !== 'none' && u.state !== 'canceled' && u.state !== 'test_only') return 'subscription_exists';", "if (u.state !== 'none' && u.state !== 'canceled' && u.state !== 'test_only' && u.state !== 'past_due') return 'subscription_exists';", EDGE, MH)
m('unclear_plan_offered_a_second_checkout', "if (u.state !== 'none' && u.state !== 'canceled' && u.state !== 'test_only') return 'subscription_exists';", "if (u.state !== 'none' && u.state !== 'canceled' && u.state !== 'test_only' && u.state !== 'unknown') return 'subscription_exists';", EDGE, MH)
m('ended_plan_cannot_subscribe_again', "if (u.state !== 'none' && u.state !== 'canceled' && u.state !== 'test_only') return 'subscription_exists';", "if (u.state !== 'none' && u.state !== 'test_only') return 'subscription_exists';", EDGE, MH)
m('unset_processor_still_asked', "  if (!configured) return 'not_set_up';\n", "", EDGE, MH)
m('unknown_field_allowed', "    if (extra.length) return reply(req, { error: 'bad_request', detail: 'unknown field: ' + extra[0] }, 400);\n", "", EDGE, MH)
m('no_brokerage_called_ok', "if (!usage) return reply(req, { error: 'forbidden' }, 403);", "if (!usage) return reply(req, { status: 'OK', plan: planSummary(null), checkout: 'not_owner' });", EDGE, MH)
m('status_names_the_brokerage', "reply(req, { status: 'OK', plan: planSummary(usage), checkout: availability })", "reply(req, { status: 'OK', plan: planSummary(usage), checkout: availability, brokerage_id: usage.brokerage_id })", EDGE, MH)
m('checkout_failure_explained_to_the_browser', "if (e instanceof CheckoutUnavailable) return reply(req, { error: 'checkout_unavailable' }, 502);", "if (e instanceof CheckoutUnavailable) return reply(req, { error: 'checkout_unavailable', detail: e.message }, 502);", EDGE, MH)
m('internal_error_returns_the_message', "return reply(req, { error: 'internal' }, 500);      // never the message: it can carry an id", "return reply(req, { error: 'internal', detail: (e as Error).message }, 500);", EDGE, MH)
m('anyone_signed_in_may_ask_before_the_gate', "    const who = await authorizeSignedIn(req, deps);\n    if (who instanceof Response) return who;\n", "    const who = { userId: '00000000-0000-4000-8000-000000000000' };\n", EDGE, MH)
m('processor_answer_body_repeated', "if (!r.ok) throw new CheckoutUnavailable('http ' + r.status);", "if (!r.ok) throw new CheckoutUnavailable('http ' + r.status + ' ' + await r.text());", EDGE, MD)
m('checkout_returns_to_another_page', "redirectUrl: BILLING_PAGE }", "redirectUrl: 'https://example.com/' }", EDGE, MD)
m('checkout_address_unchecked', "const url = checkoutUrlFrom(await r.json().catch(() => null));", "const url = (await r.json().catch(() => null))?.data?.attributes?.url ?? null;", EDGE, MD)
m('configured_without_a_variant', " && /^[0-9]{1,20}$/.test(b.variantId);", ";", EDGE, MD)
m('configured_without_the_secret', "return !!b.apiKey && !!b.secret &&", "return !!b.apiKey &&", EDGE, MD)
m('variant_read_under_the_wrong_name', "Deno.env.get('LEMONSQUEEZY_BILLING_VARIANT_ID')", "Deno.env.get('LEMONSQUEEZY_VARIANT_ID')", EDGE, MI)
m('test_mode_on_by_default', "(Deno.env.get('LEMONSQUEEZY_TEST_MODE') ?? '') === 'true'", "(Deno.env.get('LEMONSQUEEZY_TEST_MODE') ?? 'true') === 'true'", EDGE, MI)

# ---- the webhook: signed, then parsed, then recorded -----------------------------------------------------------------------------------------------
m('unset_webhook_open', "    if (!configured()) return reply({ error: 'not_set_up' }, 503);\n", "", EDGE, WH)
m('signature_not_checked', "    if (!(await verifySignature(deps.secret, raw, req.headers.get(SIGNATURE_HEADER)))) return reply({ error: 'unauthorized' }, 401);\n", "", EDGE, WH)
mm('signature_checked_after_the_parse', [
  ("    if (!(await verifySignature(deps.secret, raw, req.headers.get(SIGNATURE_HEADER)))) return reply({ error: 'unauthorized' }, 401);\n", ""),
  ("    try { payload = JSON.parse(raw); } catch { return reply({ error: 'invalid', reason: 'json' }, 422); }\n",
   "    try { payload = JSON.parse(raw); } catch { return reply({ error: 'invalid', reason: 'json' }, 422); }\n    if (!(await verifySignature(deps.secret, raw, req.headers.get(SIGNATURE_HEADER)))) return reply({ error: 'unauthorized' }, 401);\n"),
], EDGE, WH)
m('oversize_body_read_whole', "    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return reply({ error: 'too_large' }, 413);\n", "", EDGE, WH)
m('declared_oversize_still_read', "    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply({ error: 'too_large' }, 413);\n", "", EDGE, WH)
m('invalid_body_acknowledged', "      if (t.kind === 'invalid') return reply({ error: 'invalid', reason: t.reason }, 422);\n", "      if (t.kind === 'invalid') return reply({ status: 'IGNORED', reason: t.reason });\n", EDGE, WH)
m('foreign_event_refused', "      if (t.kind === 'ignore') return reply({ status: 'IGNORED', reason: t.reason });\n", "      if (t.kind === 'ignore') return reply({ error: 'invalid', reason: t.reason }, 422);\n", EDGE, WH)
m('conflict_not_loud', "      if (e instanceof BindingConflict) return reply({ error: 'binding_conflict' }, 409);\n", "", EDGE, WH)
m('outage_acknowledged', "      if (e instanceof DataUnavailable) return reply({ error: 'data_unavailable' }, 503);", "      if (e instanceof DataUnavailable) return reply({ status: 'OK' });", EDGE, WH)
m('webhook_grants_cors', "    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });", "    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });", EDGE, WH)
m('webhook_internal_error_returns_the_message', "return reply({ error: 'internal' }, 500);      // never the message: it can carry an id", "return reply({ error: 'internal', detail: (e as Error).message }, 500);", EDGE, WH)
m('webhook_answer_repeats_the_payload', "      return reply({ status: 'OK', outcome: applied.outcome });", "      return reply({ status: 'OK', outcome: applied.outcome, event: t.event });", EDGE, WH)
m('webhook_secret_read_under_another_name', "Deno.env.get('LEMONSQUEEZY_BILLING_WEBHOOK_SECRET')", "Deno.env.get('LEMONSQUEEZY_WEBHOOK_SECRET')", EDGE, WI)

# ---- the report function: the plan changes who may make a report, and what the answer says ----------------------------------------------------------------
m('plan_read_failure_treated_as_unpaid', "try { plan = await deps.planOf(trial.userId); } catch { return reply(req, { error: 'data_unavailable' }, 502); }", "try { plan = await deps.planOf(trial.userId); } catch { plan = null; }", EDGE, RH)
m('complete_trial_refused_even_when_paid', "if (trial && trial.complete && !paid) return reply(", "if (trial && trial.complete) return reply(", EDGE, RH)
m('complete_month_not_refused', "if (trial && paid && plan!.credits_remaining <= 0) return reply(", "if (trial && paid && plan!.credits_remaining < -1) return reply(", EDGE, RH)
m('paid_means_a_balance_exists', "const paid = plan?.state === 'paid';", "const paid = (plan?.credits_remaining ?? 0) > 0;", EDGE, RH)
m('allotment_complete_called_evaluation_complete', "        if (e instanceof AllotmentComplete) return reply(req, { error: 'allotment_complete' }, 403);\n", "", EDGE, RH)
m('evaluation_complete_called_a_server_fault', "        if (e instanceof EvaluationComplete) return reply(req, { error: 'evaluation_complete' }, 403);\n", "", EDGE, RH)
m('paid_report_moves_the_free_count', "const used = c.allotment === 'paid'", "const used = c.allotment === 'never'", EDGE, RH)
m('plan_missing_from_the_answers', "const planInfo = trial ? { plan: planSummary(plan) } : {};", "const planInfo = {};", EDGE, RH)
m('plan_names_the_brokerage', "const planInfo = trial ? { plan: planSummary(plan) } : {};", "const planInfo = trial ? { plan: { ...planSummary(plan), brokerage_id: plan?.brokerage_id } } : {};", EDGE, RH)
m('plan_read_for_an_admin', "    if (trial) {\n      try { plan = await deps.planOf(trial.userId);", "    if (true) {\n      try { plan = await deps.planOf(caller.userId);", EDGE, RH)

# ---- the one way a member's report is stored -------------------------------------------------------------------------------------------------------------
m('credit_month_not_checked', "|| allotment === null || period === undefined || (allotment === 'paid') !== (period !== null)) {", "|| allotment === null || period === undefined) {", EDGE, RS)
m('unknown_allotment_believed', "const allotment = row.allotment === 'trial' || row.allotment === 'paid' ? row.allotment : null;", "const allotment = row.allotment ?? 'trial';", EDGE, RS)
m('month_complete_called_a_fault', "    if (error.message === 'ALLOTMENT_COMPLETE') throw new AllotmentComplete('the month\\'s reports are used up');\n", "", EDGE, RS)
m('not_entitled_called_a_fault', "    if (error.message === 'NOT_ENTITLED') throw new NotEntitled('not an active member');\n", "", EDGE, RS)
m('stored_by_the_trial_function_alone', "await rpc('brokerage_report_issue', {", "await rpc('evaluation_report_issue', {", EDGE, RS)

# ---- wiring ----------------------------------------------------------------------------------------------------------------------------------------------
m('billing_function_without_jwt_check', "[functions.manage-billing]\nverify_jwt = true", "[functions.manage-billing]\nverify_jwt = false", EDGE, CONFIG)
m('webhook_with_jwt_check', "[functions.development-activity-billing-webhook]\nverify_jwt = false", "[functions.development-activity-billing-webhook]\nverify_jwt = true", EDGE, CONFIG)

# ---- the customer page ------------------------------------------------------------------------------------------------------------------------------------
m('page_goes_wherever_the_server_says', "typeof b.url === 'string' && checkoutOk(b.url)) {", "typeof b.url === 'string') {", PAGES, PAGE)
m('page_accepts_any_https_host', "(h === 'lemonsqueezy.com' || /\\.lemonsqueezy\\.com$/.test(h))", "true", PAGES, PAGE)
m('page_accepts_plain_http', "return u.protocol === 'https:' && !u.username", "return !u.username", PAGES, PAGE)
m('page_offers_checkout_to_everyone', "    if (checkoutState === 'available') { buy.textContent", "    if (true) { buy.textContent", PAGES, PAGE)
m('page_checkout_for_an_agent', "if (subscribing || !session || !plan || plan.role !== 'owner' || checkoutState !== 'available') return;", "if (subscribing || !session || !plan) return;", PAGES, PAGE)
m('page_sends_a_brokerage', "var r = await post(BILLING_FN, { action: 'checkout' });", "var r = await post(BILLING_FN, { action: 'checkout', brokerage_id: 'b0b0b0b0-0000-4000-8000-000000000001' });", PAGES, PAGE)
m('page_failed_read_keeps_the_old_plan', "    } else { plan = null; checkoutState = null; }\n  }", "    } else { /* keep whatever was shown */ }\n  }", PAGES, PAGE)
m('page_signed_out_leaves_the_plan_text', "$('billing-plan').textContent = ''; $('billing-sub').textContent = ''; billingSay('', false); }", "billingSay('', false); }", PAGES, PAGE)
m('page_next_person_inherits_the_plan', "role = null; showTeam(false); showSaved(false); showProfile(false); hideBilling(); hideShare(); hideWatch(); // another person's role", "role = null; showTeam(false); showSaved(false); showProfile(false); hideShare(); hideWatch(); // another person's role", PAGES, PAGE)
m('page_counts_the_month_itself', "p.textContent = '$79/month plan: ' + plan.credits_used + ' of '", "p.textContent = '$79/month plan: ' + (plan.credits_used + 1) + ' of '", PAGES, PAGE)
m('page_second_checkout_offered_when_paid', "    if (plan.state === 'paid') {\n      var end = monthEndWords();", "    if (false) {\n      var end = monthEndWords();", PAGES, PAGE)
m('page_unreadable_plan_called_free', "p.className = 'plan out'; p.textContent = 'Your plan could not be read just now';", "p.className = 'plan'; p.textContent = 'Free trial';", PAGES, PAGE)
m('page_reopens_make_report_without_asking', "$('billing-refresh').addEventListener('click', function(){ refreshBilling(false); });", "", PAGES, PAGE)
m('landing_button_goes_live', 'data-cta="join" aria-disabled="true">Join for $79/month', 'data-cta="join" aria-disabled="false">Join for $79/month', [BST], LANDING)


def run(tests):
    for t in tests:
        r = subprocess.run(['node', '--experimental-strip-types', str(ROOT / t)], cwd=ROOT, capture_output=True, text=True, timeout=1200)
        out = r.stdout + r.stderr
        if 'SyntaxError' in out:
            return None, t, 'SyntaxError'
        if r.returncode != 0:
            first = next((ln for ln in out.splitlines() if ln.startswith('FAIL')), 'exit %d' % r.returncode)
            return False, t, first[:150]
    return True, None, None


def main():
    only = set(sys.argv[1:])
    if only - set(M):
        print('HARNESS - unknown mutation(s): ' + ', '.join(sorted(only - set(M))))
        return 2
    names = [k for k in M if not only or k in only]
    needed = {t for k in names for t in M[k][2]}
    passed, which, line = run([t for t in EDGE + PAGES if t in needed])
    if not passed:
        print('HARNESS - the unmutated tree does not pass %s (%s)' % (which, line))
        return 2
    originals = {f: (ROOT / f).read_text() for f in {M[k][0] for k in names}}
    survived, harness = [], []
    try:
        for name in names:
            f, pairs, tests = M[name]
            original = originals[f]
            mutated, fault = original, None
            for old, new in pairs:
                if mutated.count(old) != 1:
                    fault = 'anchor matched %d times: %r' % (mutated.count(old), old[:60])
                    break
                mutated = mutated.replace(old, new)
            if fault is None and mutated == original:
                fault = 'the mutation changes nothing'
            if fault:
                print('HARNESS  %-46s %s' % (name, fault))
                harness.append(name)
                continue
            (ROOT / f).write_text(mutated)
            passed, which, line = run(tests)
            (ROOT / f).write_text(original)
            if passed is None:
                print('HARNESS  %-46s %s' % (name, line))
                harness.append(name)
            elif passed:
                print('SURVIVED %-46s' % name)
                survived.append(name)
            else:
                print('killed   %-46s by %s: %s' % (name, Path(which).name, line))
    finally:
        for f, original in originals.items():
            (ROOT / f).write_text(original)
    print('\n%d mutation(s): %d killed, %d survived, %d harness fault(s)' % (len(names), len(names) - len(survived) - len(harness), len(survived), len(harness)))
    return 2 if harness else (1 if survived else 0)


if __name__ == '__main__':
    sys.exit(main())
