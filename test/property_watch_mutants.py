#!/usr/bin/env python3
"""Prohibited mutations of the Watch (Development Activity build step 9) - everything except the SQL, whose own harnesses are
test/property_watch_pg/mutate.py (the watches) and test/property_watch_schedule_pg/mutate.py (the daily wake and its alarm). Each MUST make one
of the suites listed against it exit non-zero:

    test/property-watch-changes.test.mjs                   (the diff: what is new, what was already told, what one email may carry)
    test/property-watch-functions.test.mjs                 (both handlers and their data layers over a stand-in database and mail provider)
    test/property-watch-email.test.mjs                     (the email: what is in it, what is never in it, untrusted publisher text)
    test/property-watch-structure.test.mjs                 (the SQL's shape, the one module that names it, the JWT posture, the wiring)
    test/report-private-context-structure.test.mjs         (who may name the private layer, and which window each user takes)
    test/report-share-delivery-structure.test.mjs          (the one reader's four users)
    test/development-activity-reports.test.mjs            (the agent's page, source-level contract)
    test/development-activity-reports.browser.test.mjs     (the agent's page in Chromium, against the REAL manage-property-watch handler)

It edits one file in place, runs the suites, and ALWAYS restores it, even on error or ^C. An anchor that does not match exactly once is a harness
fault, never a pass. A mutation may be several (old, new) pairs in ONE file; each must match exactly once. A mutation that changes nothing is a
harness fault. Exit 0 if every mutation was killed, 1 if any survived, 2 on a harness fault. The browser suite needs Playwright (as in CI's
browser job). (Manual, like the other mutation loops: CI runs the tests, not this loop.)

    python3 test/property_watch_mutants.py [name ...]
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FN = 'supabase/functions/'
PW = FN + '_shared/property-watch.ts'
WE = FN + '_shared/watch-email.ts'
ES = FN + '_shared/email-send.ts'
WRD = FN + '_shared/watch-reads.ts'
PS = FN + '_shared/private-subject.ts'
RH = FN + 'run-property-watch/handler.ts'
RD = FN + 'run-property-watch/data.ts'
RI = FN + 'run-property-watch/index.ts'
MH = FN + 'manage-property-watch/handler.ts'
MD = FN + 'manage-property-watch/data.ts'
CONFIG = 'supabase/config.toml'
PAGE = 'development-activity-reports.html'

CHG = 'test/property-watch-changes.test.mjs'
FNT = 'test/property-watch-functions.test.mjs'
EML = 'test/property-watch-email.test.mjs'
STR = 'test/property-watch-structure.test.mjs'
PCS = 'test/report-private-context-structure.test.mjs'
RSS = 'test/report-share-delivery-structure.test.mjs'
AGS = 'test/development-activity-reports.test.mjs'
AGB = 'test/development-activity-reports.browser.test.mjs'
EDGE = [CHG, FNT, EML, STR, PCS, RSS]      # cheap offline suites
PAGES = [AGS, AGB]                         # Chromium last
ALL = EDGE + PAGES
M = {}


def m(name, old, new, tests, f):
    assert name not in M, name
    M[name] = (f, [(old, new)], list(tests))


def mm(name, pairs, tests, f):
    assert name not in M, name
    M[name] = (f, list(pairs), list(tests))


# ---- the diff: what is new since the report, and what the agent was already told -----------------------------------------------------------------
m('told_before_is_emailed_again',
  "\n      && !seen.has(seenKey({ project_id: c.project_id, event_type: e.event_type, observed_at: e.detected_at })));", ");", EDGE, PW)
m('told_key_ignores_event_type', "k.project_id + '|' + k.event_type + '|' + Date.parse(k.observed_at)", "k.project_id + '|' + Date.parse(k.observed_at)", EDGE, PW)
m('told_key_compares_text_not_instant', "k.project_id + '|' + k.event_type + '|' + Date.parse(k.observed_at)", "k.project_id + '|' + k.event_type + '|' + k.observed_at", EDGE, PW)
m('unknown_event_types_pass', "(EVENT_TYPES as readonly string[]).includes(e.event_type)\n      && !seen", "!seen", EDGE, PW)
m('partial_never_reported', "partial: core.flags.sourcesNotFullyRead", "partial: false", EDGE, PW)
m('duplicate_nearby_project_accepted', "    if (seenProjects.has(r.project_id)) throw new ReportUnreadable('a nearby project appears twice');\n", "", EDGE, PW)
m('baseline_is_what_the_list_says_now', "homesignal_detected_changes: shownBy.get(x.project_id) ?? [],", "homesignal_detected_changes: (x.homesignal_detected_changes as never) ?? [],", EDGE, PW)
m('baseline_is_now_not_the_report', "issuedAt: original.generated_at", "issuedAt: i.now.toISOString()", EDGE, PW)
m('check_uses_the_internal_view', "now: i.now, view: 'customer', rights: i.rights", "now: i.now, view: 'internal', rights: i.rights", EDGE, PW)
m('lookback_ignores_the_window', "Math.max(reportBoundary, window)", "reportBoundary", EDGE, PW)
m('lookback_ignores_the_report', "Math.max(reportBoundary, window)", "window", EDGE, PW)

# ---- what one email carries, and what is recorded as told ---------------------------------------------------------------------------------------
m('project_cap_lost_changes', "if (listed.length >= MAX_PROJECTS_PER_EMAIL) {", "if (listed.length >= MAX_PROJECTS_PER_EMAIL * 100) {", EDGE, PW)
m('told_includes_what_was_not_listed', "for (const e of shown) told.push(", "for (const e of c.entries) told.push(", EDGE, PW)
m('entry_cap_dropped', "const shown = c.entries.slice(0, MAX_ENTRIES_PER_PROJECT);", "const shown = c.entries;", EDGE, PW)
m('overflow_entries_not_counted', "    remainingEntries += c.entries.length - shown.length;\n", "", EDGE, PW)
m('overflow_projects_not_counted', "{ remainingProjects++; remainingEntries += c.entries.length; continue; }", "{ remainingEntries += c.entries.length; continue; }", EDGE, PW)

# ---- the email: what is in it, and what is never in it ------------------------------------------------------------------------------------------
m('html_angle_brackets_unescaped', ".replace(/</g, '&lt;')", "", EDGE, WE)
m('html_ampersand_unescaped', ".replace(/&/g, '&amp;')", "", EDGE, WE)
m('http_links_printed', "u.protocol === 'https:' &&", "(u.protocol === 'https:' || u.protocol === 'http:') &&", EDGE, WE)
m('links_with_credentials_printed', " && !u.username && !u.password", "", EDGE, WE)
m('bidi_override_not_stripped', "\\u2028-\\u202e", "\\u2028-\\u2029", EDGE, WE)
m('zero_width_not_stripped', "\\u200b-\\u200f", "\\u200b", EDGE, WE)
m('publisher_text_unbounded', "return t.length > VALUE_MAX ? t.slice(0, VALUE_MAX - 1).trimEnd() + '…' : t;", "return t;", EDGE, WE)
m('subject_forgets_the_overflow', "listed.reduce((n, c) => n + c.entries.length, 0) + remaining.entries", "listed.reduce((n, c) => n + c.entries.length, 0)", EDGE, WE)
m('subject_never_singular', "(total === 1 ? '' : 's')", "'s'", EDGE, WE)
m('overflow_line_missing', "const moreLine = remaining.entries > 0 ?", "const moreLine = false ?", EDGE, WE)
m('partial_line_missing_in_text', "...(i.partial ? [partialLine, ''] : []),", "...[],", EDGE, WE)
m('partial_line_missing_in_html', "+ (i.partial ? '<p style=\"margin:14px 0 0;font-size:14px;color:#8a5a00;\">'", "+ (false ? '<p style=\"margin:14px 0 0;font-size:14px;color:#8a5a00;\">'", EDGE, WE)
m('open_link_carries_a_token', "export const WATCH_OPEN_URL = 'https://homesignal.net/development-activity-reports.html';", "export const WATCH_OPEN_URL = 'https://homesignal.net/development-activity-reports.html#share=x';", EDGE, WE)
m('new_record_called_a_change', "e.event_type === 'first_detected' ? 'New official record' : 'Official status changed'", "e.event_type === 'first_detected' ? 'Official status changed' : 'New official record'", EDGE, WE)
m('change_lines_unbounded', "e.changes.slice(0, 6)", "e.changes", EDGE, WE)
m('blank_value_printed_blank', "(clean(v) === '' ? 'not stated' : clean(v))", "(clean(v) === '' ? '' : clean(v))", EDGE, WE)

# ---- the mail adapter ----------------------------------------------------------------------------------------------------------------------------
m('mail_key_not_sorted', ".map((t) => t.project_id + '|' + t.event_type + '|' + Date.parse(t.observed_at)).sort();", ".map((t) => t.project_id + '|' + t.event_type + '|' + Date.parse(t.observed_at));", EDGE, ES)
m('mail_key_ignores_the_watch', "sha256Hex(watchId + '\\n' + lines.join('\\n'))", "sha256Hex(lines.join('\\n'))", EDGE, ES)
m('no_idempotency_header', ", 'Idempotency-Key': idempotencyKey", "", EDGE, ES)
m('any_recipient_accepted', "  if (!isMailable(m.to)) throw new EmailFailed('recipient');\n", "", EDGE, ES)
m('provider_answer_echoed', "if (!r.ok) throw new EmailFailed('http ' + r.status);", "if (!r.ok) throw new EmailFailed('http ' + r.status + ' ' + (await r.text()));", EDGE, ES)
m('provider_refusal_called_sent', "if (!r.ok) throw new EmailFailed('http ' + r.status);", "if (false) throw new EmailFailed('http ' + r.status);", EDGE, ES)
m('network_failure_called_sent', "} catch { throw new EmailFailed('network'); }", "} catch { return; }", EDGE, ES)
m('missing_key_still_sends', "  if (!apiKey) throw new EmailFailed('no key');\n", "", EDGE, ES)

# ---- the daily job: who may call it, and the order that makes an email exactly-once -------------------------------------------------------------
m('no_secret_configured_lets_everyone_in', "    if (!deps.secret) return reply(req, { error: 'not_configured' }, 503);\n", "", EDGE, RH)
m('secret_compared_plainly', "if (!(await sameSecret(given, deps.secret)))", "if (given !== deps.secret)", EDGE, RH)
m('limit_unbounded', "b.limit > MAX_LIMIT", "b.limit > 100000", EDGE, RH)
m('dry_run_claims', "if (b.dry_run === true) {", "if (false) {", EDGE, RH)
mm('recorded_as_told_before_the_email_is_accepted', [
  ("    await deps.send({ from: WATCH_FROM, to, ...email }, await idempotencyKeyFor(w.watch_id, selection.told));",
   "    await deps.recordRun(w.watch_id, 'NOTIFIED', selection.told);\n    await deps.send({ from: WATCH_FROM, to, ...email }, await idempotencyKeyFor(w.watch_id, selection.told));"),
  ("    await deps.recordRun(w.watch_id, 'NOTIFIED', selection.told);\n    return 'notified';", "    return 'notified';"),
], EDGE, RH)
m('recorded_as_told_is_not_what_was_listed',
  "await deps.recordRun(w.watch_id, 'NOTIFIED', selection.told);",
  "await deps.recordRun(w.watch_id, 'NOTIFIED', check.changes.flatMap((c) => c.entries.map((e) => ({ project_id: c.project_id, event_type: e.event_type, observed_at: e.detected_at }))));", EDGE, RH)
m('standing_lost_keeps_watching', "await deps.endWatch(w.watch_id, 'STANDING_LOST'); return 'ended';", "return 'checked';", EDGE, RH)
m('purged_property_keeps_watching', "await deps.endWatch(w.watch_id, 'PROPERTY_NOT_KEPT'); return 'ended';", "return 'checked';", EDGE, RH)
m('failure_not_recorded', "try { await deps.recordFailure(w.watch_id, outcome); }", "try { }", EDGE, RH)
m('failure_outcomes_collapsed', "e instanceof EmailFailed ? 'EMAIL_FAILED' : e instanceof NoRecipient ? 'NO_RECIPIENT' : 'READ_FAILED'", "'READ_FAILED'", EDGE, RH)
m('log_carries_the_exception_message', "stage, outcome, reason: known ? (e as Error).message : (e instanceof Error ? e.name : 'unknown')", "stage, outcome, reason: (e as Error).message", EDGE, RH)
m('run_log_carries_the_exception_message', "stage: 'run', status: known ? 502 : 500, reason: known ? (e as Error).message : (e instanceof Error ? e.name : 'unknown')", "stage: 'run', status: known ? 502 : 500, reason: (e as Error).message", EDGE, RH)
m('partial_check_recorded_as_complete', "check.partial ? 'CHECKED_PARTIAL' : 'CHECKED'", "'CHECKED'", EDGE, RH)
m('no_recipient_not_noticed', "    if (!to) throw new NoRecipient('no address');\n", "", EDGE, RH)
# NOT A MUTATION, ON PURPOSE: removing the handler's own `validateRights(deps.rights)` call is an EQUIVALENT mutant. `assemble` and
# `changesForProjects` each validate the same registry independently, so a malformed one still fails the check (test 6a proves that outcome);
# the handler's call is a second guard, and a mutation that cannot change any outcome cannot be killed.
m('run_budget_ignored', "if (deps.now().getTime() - started > RUN_BUDGET_MS) {", "if (false) {", EDGE, RH)
m('property_radius_not_the_reports', "const radiusMi = parseRadius(stored.radius_mi) ?? REPORT_RADIUS_MI;", "const radiusMi = 3;", EDGE, RH)

# ---- the daily job's reads ---------------------------------------------------------------------------------------------------------------------
m('no_such_user_called_an_outage', "      if (r.status === 404) throw new NoRecipient('no such user');\n", "", EDGE, RD)
m('recipient_not_checked_mailable', "return isMailable(email) ? email : null;", "return email || null;", EDGE, RD)
m('user_id_unchecked_in_the_path', "      if (!UUID.test(userId)) throw new DataUnavailable('user id');\n", "", EDGE, RD)
m('due_count_counts_the_future', "&next_due_at=lte.'", "&next_due_at=gte.'", EDGE, RD)
m('secret_read_under_another_name', "Deno.env.get('SIGNUP_HOOK_SECRET')", "Deno.env.get('SIGNUP_HOOK_SECRET_X')", EDGE, RI)
m('watch_database_calls_unfiltered_by_watch', "property_watch_seen?select=project_id,event_type,observed_at&watch_id=eq.' + encodeURIComponent(watchId)", "property_watch_seen?select=project_id,event_type,observed_at'", EDGE, WRD)
m('claim_size_unbounded', "limit < 1 || limit > 100) throw", "limit < 1 || limit > 100000) throw", EDGE, WRD)
m('start_shape_unchecked', "      if (!Array.isArray(data) || data.length !== 1) throw new DataUnavailable('shape');\n      const r = data[0];\n      if (!r || !isUuid(r.watch_id) || !isTime(r.created_at) || typeof r.started !== 'boolean') throw new DataUnavailable('shape');",
  "      const r = data[0];", EDGE, WRD)
m('refusal_called_outage', "if (error.message === 'WATCH_LIMIT_REACHED') throw new WatchLimitReached('refused');\n", "", EDGE, WRD)

# ---- the private layer's third window -----------------------------------------------------------------------------------------------------------
m('point_returned_after_purge', "if (!c || c.state !== 'active') return null;\n      if (c.latitude === null && c.longitude === null) return null;", "if (!c) return null;\n      if (c.latitude === null && c.longitude === null) return null;", EDGE, PS)
m('half_a_point_called_somewhere', "      if (c.latitude === null && c.longitude === null) return null;\n", "", EDGE, PS)
m('non_finite_point_accepted', "!Number.isFinite(lat) || !Number.isFinite(lng) || ", "", EDGE, PS)
m('point_off_the_globe_accepted', " || Math.abs(lat) > 90 || Math.abs(lng) > 180", "", EDGE, PS)
m('point_window_returns_the_address', "      return { lat, lng };", "      return { lat, lng, address: c.address } as never;", EDGE, PS)

# ---- the agent's function --------------------------------------------------------------------------------------------------------------------------
m('unknown_field_allowed', "    if (extra.length) return reply(req, { error: 'bad_request', detail: 'unknown field: ' + extra[0] }, 400);\n", "", EDGE, MH)
m('id_unchecked', "if (typeof v !== 'string' || !UUID.test(v)) return reply(req, { error: 'bad_request', detail: idField }, 400);", "if (typeof v !== 'string') return reply(req, { error: 'bad_request', detail: idField }, 400);", EDGE, MH)
m('foreign_watch_called_a_server_fault', "      if (e instanceof WatchNotFound) return reply(req, { error: 'not_found' }, 404);\n", "", EDGE, MH)
m('limit_called_a_server_fault', "      if (e instanceof WatchLimitReached) return reply(req, { error: 'watch_limit_reached' }, 409);\n", "", EDGE, MH)
m('list_returns_the_private_handle', "created_at: r.created_at, last_run_at: r.last_run_at,", "private_context_id: r.private_context_id, created_at: r.created_at, last_run_at: r.last_run_at,", EDGE, MH)
m('list_asks_for_the_label', ".then((s) => s.address),", ".then((s) => s as never),", EDGE, MD)
m('list_not_scoped_to_the_caller', "const rows = await deps.watchesOf(who.userId);", "const rows = await deps.watchesOf('00000000-0000-4000-8000-000000000000');", EDGE, MH)

# ---- wiring ---------------------------------------------------------------------------------------------------------------------------------------
m('daily_job_without_jwt_check', "[functions.run-property-watch]\nverify_jwt = true", "[functions.run-property-watch]\nverify_jwt = false", EDGE, CONFIG)
m('agent_function_without_jwt_check', "[functions.manage-property-watch]\nverify_jwt = true", "[functions.manage-property-watch]\nverify_jwt = false", EDGE, CONFIG)

# ---- the agent's page ---------------------------------------------------------------------------------------------------------------------------
m('page_calls_the_wrong_function', "var WATCH_FN = SB_URL + '/functions/v1/manage-property-watch';", "var WATCH_FN = SB_URL + '/functions/v1/manage-shared-report';", PAGES, PAGE)
m('page_sends_the_address', "{ action: 'start', report_id: forReport }", "{ action: 'start', report_id: forReport, address: $('addr').value }", PAGES, PAGE)
m('page_sends_the_label', "{ action: 'start', report_id: forReport }", "{ action: 'start', report_id: forReport, label: $('label').value }", PAGES, PAGE)
m('page_stops_the_wrong_thing', "{ action: 'stop', watch_id: watchId }", "{ action: 'stop', watch_id: watchFor }", PAGES, PAGE)
m('page_shows_another_reports_watch', "w.report_id.toLowerCase() === forReport.toLowerCase() && ", "", PAGES, PAGE)
m('page_start_failure_called_success', "if (r.status === 200 && body.status === 'OK' && typeof body.watch_id === 'string') {", "if (true) {", PAGES, PAGE)
m('page_stop_failure_called_success', "if (r.status === 200 && body.status === 'OK' && body.stopped === true) {", "if (true) {", PAGES, PAGE)
m('page_limit_called_something_else', "if (httpStatus === 409 && body.error === 'watch_limit_reached') return", "if (httpStatus === 409 && body.error === 'x') return", PAGES, PAGE)
m('page_purged_property_unexplained', "if (httpStatus === 409 && body.error === 'property_not_kept') return", "if (httpStatus === 409 && body.error === 'x') return", PAGES, PAGE)
m('page_outcome_unexplained', "    NOTIFIED: 'a change was found and emailed to you.',\n", "", PAGES, PAGE)
m('page_first_check_claimed_after_one', "    else parts.push('The first check runs within a few minutes.');", "    else parts.push('');", PAGES, PAGE)
m('page_claims_not_watching_when_it_does_not_know', "      $('watch-state').textContent = ''; $('watch-start').hidden = false; $('watch-stop').hidden = true; // starting is safe to offer: it does nothing twice",
  "      paintWatch(null); // starting is safe to offer: it does nothing twice", PAGES, PAGE)
m('page_offers_watch_for_an_unsaved_report', "live: shareable ? ['share', 'watch', 'pdf'] : ['pdf'] })", "live: ['share', 'watch', 'pdf'] })", PAGES, PAGE)
m('page_card_printed', '<section class="card" id="watch"', '<section id="watch"', PAGES, PAGE)
m('page_signed_out_keeps_the_watch', "hideShare(); hideWatch();\n      $('report').textContent = ''; $('creditnote').hidden = true; say('', false); // a report on screen", "hideShare();\n      $('report').textContent = ''; $('creditnote').hidden = true; say('', false); // a report on screen", PAGES, PAGE)
m('page_next_person_inherits_the_watch', "hideShare(); hideWatch(); // another person's role", "hideShare(); // another person's role", PAGES, PAGE)
m('page_late_answer_for_another_report_applied', "if (!session || !session.user || session.user.id !== forUser || watchFor !== forReport) return; // the person or the report changed while the answer was on its way", "if (!session || !session.user) return;", PAGES, PAGE)
m('page_buttons_inert', "$('watch-start').addEventListener('click', startWatch);", "", PAGES, PAGE)
m('page_report_button_does_not_go_to_the_card', "else if (act === 'watch' && !$('watch').hidden) {", "else if (act === 'watch' && false) {", PAGES, PAGE)


def run(tests):
    for t in tests:
        r = subprocess.run(['node', '--experimental-strip-types', str(ROOT / t)], cwd=ROOT, capture_output=True, text=True, timeout=900)
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
    passed, which, line = run(ALL)
    if not passed:
        print('HARNESS - the unmutated tree does not pass %s (%s)' % (which, line))
        return 2
    originals = {f: (ROOT / f).read_text() for f in {v[0] for v in M.values()}}
    survived, harness = [], []
    names = [k for k in M if not only or k in only]
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
