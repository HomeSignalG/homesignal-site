#!/usr/bin/env python3
"""Prohibited mutations of the client share link (Development Activity build step 8) - everything except the SQL, whose own harness is
test/report_share_delivery_pg/mutate.py. Each MUST make one of

    test/share-link-functions.test.mjs                   (both handlers and their data layers, offline, over a stand-in database)
    test/report-share-delivery-structure.test.mjs        (the SQL's shape, the one module that names it, the JWT posture, the wiring)
    test/shared-report-page.test.mjs                     (the client's page, source-level contract)
    test/shared-report-page.browser.test.mjs             (the client's page in Chromium, against the REAL view-shared-report handler)
    test/development-activity-reports.test.mjs           (the agent's page, source-level contract)
    test/development-activity-reports.browser.test.mjs   (the agent's page in Chromium, against the REAL report and share handlers)

exit non-zero. It edits one file in place, runs the suites, and ALWAYS restores it, even on error or ^C. An anchor that does not match
exactly once is a harness fault, never a pass. A mutation may be several (old, new) pairs in ONE file; each must match exactly once.
Exit 0 if every mutation was killed, 1 if any survived, 2 on a harness fault. The browser suites need Playwright (as in CI's browser job).
(Manual, like the other mutation loops: CI runs the tests, not this loop.)

    python3 test/share_delivery_mutants.py [name ...]
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
READS = 'supabase/functions/_shared/share-reads.ts'
VH = 'supabase/functions/view-shared-report/handler.ts'
VD = 'supabase/functions/view-shared-report/data.ts'
MH = 'supabase/functions/manage-shared-report/handler.ts'
CLIENT = 'shared-report.html'
AGENT = 'development-activity-reports.html'
DEPLOY = '.github/workflows/deploy-edge-functions.yml'
CONFIG = 'supabase/config.toml'
ROBOTS = 'robots.txt'
STAGE = 'scripts/stage_site.py'
SQLF = 'docs/report-share-delivery.sql'

FNT = 'test/share-link-functions.test.mjs'
STR = 'test/report-share-delivery-structure.test.mjs'
PGE = 'test/shared-report-page.test.mjs'
BRW = 'test/shared-report-page.browser.test.mjs'
AGS = 'test/development-activity-reports.test.mjs'
AGB = 'test/development-activity-reports.browser.test.mjs'
ALL = [FNT, STR, PGE, AGS, BRW, AGB]   # cheap offline suites first, Chromium last
M = {}


def m(name, old, new, tests, f):
    assert name not in M, name
    M[name] = (f, [(old, new)], list(tests))


def mm(name, pairs, tests, f):
    assert name not in M, name
    M[name] = (f, list(pairs), list(tests))


# ---- the shared module: the secret, the link, and the database's answers -----------------------------------------------------------------------------
m('create_sends_the_token', "p_report_id: reportId, p_token_sha256: await hashShareToken(token) }", "p_report_id: reportId, p_token_sha256: token }", [FNT, STR], READS)
m('open_sends_the_token', "rpc('report_share_open', { p_token_sha256: await hashShareToken(token) })", "rpc('report_share_open', { p_token_sha256: token })", [FNT, STR], READS)
m('open_asks_for_any_string', "if (!isWellFormedToken(token)) return null;\n      const { data, error } = await rpc('report_share_open'", "const { data, error } = await rpc('report_share_open'", [FNT], READS)
m('link_token_in_query', "return SHARE_PAGE + '#share=' + token;", "return SHARE_PAGE + '?share=' + token;", [FNT, STR], READS)
m('link_unchecked', "if (!isWellFormedToken(token)) throw new DataUnavailable('shape');\n  return SHARE_PAGE", "return SHARE_PAGE", [FNT], READS)
m('link_to_another_page', "export const SHARE_PAGE = 'https://homesignal.net/shared-report.html';", "export const SHARE_PAGE = 'https://homesignal.net/development.html';", [FNT, STR], READS)
m('not_found_called_unavailable', "if (error.message === 'NOT_FOUND') throw new ShareNotFound('refused');\n        if (error.message === 'SHARE_LIMIT_REACHED')", "if (error.message === 'SHARE_LIMIT_REACHED')", [FNT], READS)
m('limit_called_unavailable', "        if (error.message === 'SHARE_LIMIT_REACHED') throw new ShareLimitReached('refused');\n", "", [FNT], READS)
m('revoke_not_found_called_unavailable', "        if (error.message === 'NOT_FOUND') throw new ShareNotFound('refused');\n        throw new DataUnavailable('evaluation_report_share_revoke');", "        throw new DataUnavailable('evaluation_report_share_revoke');", [FNT], READS)
m('open_two_rows_accepted', "if (data.length !== 1 || !r || typeof r.report_id", "if (!r || typeof r.report_id", [FNT], READS)
m('open_error_called_dead', "if (error) throw new DataUnavailable('report_share_open');", "if (error) return null;", [FNT], READS)
m('open_empty_shape_called_dead', "if (!Array.isArray(data)) throw new DataUnavailable('shape');\n      if (data.length === 0) return null;", "if (data.length === 0) return null;", [FNT], READS)
m('list_error_called_empty', "if (error) throw new DataUnavailable('evaluation_report_shares_of');", "if (error) return [];", [FNT], READS)
m('list_status_unchecked', "|| typeof x.status !== 'string' || !(STATUSES as readonly string[]).includes(x.status)) {", ") {", [FNT], READS)
m('revoke_answer_unchecked', "if (typeof data !== 'boolean') throw new DataUnavailable('shape');\n      return data;", "return !!data;", [FNT], READS)
m('open_returns_the_label', "brokerage_name: r.brokerage_name };\n    },\n  };", "brokerage_name: r.brokerage_name, label: (r as Record<string, unknown>).label } as SharedReport;\n    },\n  };", [STR], READS)

# ---- the client's function: no gate, no write, one answer ----------------------------------------------------------------------------------------
m('view_accepts_extra_fields', "    if (Object.keys(b).some((k) => k !== 'token')) return reply(req, { error: 'bad_request' }, 400);\n", "", [FNT, STR], VH)
m('view_dead_link_is_gone', "if (!shared) return reply(req, { error: 'not_found' }, 404);", "if (!shared) return reply(req, { error: 'gone' }, 410);", [FNT, STR, PGE], VH)
m('view_malformed_token_is_bad_request', "if (typeof b.token !== 'string') return reply(req, { error: 'not_found' }, 404);", "if (typeof b.token !== 'string') return reply(req, { error: 'bad_request' }, 400);", [FNT, STR], VH)
m('view_returns_the_context_handle', "        report_id: shared.report_id,\n", "        report_id: shared.report_id,\n        private_context_id: shared.private_context_id,\n", [FNT, STR], VH)
m('view_error_echoes_message', "return reply(req, { error: 'internal' }, 500); // never the message: it can carry the address", "return reply(req, { error: 'internal', detail: String((e as Error).message) }, 500);", [FNT, STR], VH)
m('view_data_fault_called_internal', "      if (e instanceof DataUnavailable) return reply(req, { error: 'data_unavailable' }, 502);\n", "", [FNT], VH)
m('view_reads_the_address_with_the_label', "return { openShared: shares.openShared, addressOf: subjects.addressOf };", "return { openShared: shares.openShared, addressOf: (c) => subjects.subjectOf(c, 80).then((s) => s.address) };", [STR], VD)
m('view_no_address', "      const address = await deps.addressOf(shared.private_context_id);\n", "      const address = null;\n", [FNT], VH)
m('view_brokerage_unclean', "brokerage: cleanDisplayName(shared.brokerage_name, BROKERAGE_NAME_MAX),", "brokerage: shared.brokerage_name,", [FNT, STR], VH)

# ---- the agent's function: ownership, not the report function's standing --------------------------------------------------------------------------
m('manage_user_from_the_request', "const made = await deps.createShare(who.userId, id);", "const made = await deps.createShare(String(b.user_id ?? who.userId), id);", [FNT, STR], MH)
m('manage_accepts_extra_fields', "    if (extra.length) return reply(req, { error: 'bad_request', detail: 'unknown field: ' + extra[0] }, 400);\n", "", [FNT, STR], MH)
m('manage_limit_called_internal', "      if (e instanceof ShareLimitReached) return reply(req, { error: 'share_limit_reached' }, 409);\n", "", [FNT, STR], MH)
m('manage_not_found_called_forbidden', "if (e instanceof ShareNotFound) return reply(req, { error: 'not_found' }, 404);", "if (e instanceof ShareNotFound) return reply(req, { error: 'forbidden' }, 403);", [FNT, STR], MH)
m('manage_open_to_anyone', "    const who = await authorizeSignedIn(req, deps);\n    if (who instanceof Response) return who;\n", "    const who = { userId: String((await readBounded(req.clone()) as Record<string, unknown> | null)?.user_id ?? '') };\n", [FNT, STR], MH)
m('manage_list_for_any_report', "return reply(req, { status: 'OK', shares: await deps.listShares(who.userId, id) });", "return reply(req, { status: 'OK', shares: await deps.listShares('', id) });", [FNT], MH)

# ---- the wiring: JWT posture, the page is staged and kept out of search ----------------------------------------------------------------------------
m('deploy_third_function_unverified', 'elif [ "$FN" = "view-shared-report" ]; then', 'elif [ "$FN" = "view-shared-report" ] || [ "$FN" = "manage-shared-report" ]; then', [STR], DEPLOY)
m('config_client_function_verified', "[functions.view-shared-report]\nverify_jwt = false", "[functions.view-shared-report]\nverify_jwt = true", [STR], CONFIG)
m('config_agent_function_unverified', "[functions.manage-shared-report]\nverify_jwt = true", "[functions.manage-shared-report]\nverify_jwt = false", [STR], CONFIG)
m('robots_allows_the_page', "Disallow: /shared-report.html\n", "", [PGE], ROBOTS)
m('page_not_staged', "    'shared-report.html',\n", "", [PGE], STAGE)

# ---- the client's page -----------------------------------------------------------------------------------------------------------------------------
m('page_indexable', '<meta name="robots" content="noindex, nofollow">', '<meta name="robots" content="index, follow">', [PGE], CLIENT)
m('page_sends_a_referrer', "referrerPolicy: 'no-referrer'", "referrerPolicy: 'origin'", [PGE], CLIENT)
m('page_token_stays_in_the_address_bar', "      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}\n", "", [PGE, BRW], CLIENT)
m('page_token_kept_for_good', "sessionStorage.setItem(STASH, v)", "localStorage.setItem(STASH, v)", [PGE], CLIENT)
m('page_token_sent_in_the_url', "res = await fetch(FN, {", "res = await fetch(FN + '?t=' + token, {", [PGE, BRW], CLIENT)
m('page_connects_anywhere', "connect-src 'self' https://qwnnmljucajnexpxdgxr.supabase.co;", "connect-src 'self' https:;", [PGE], CLIENT)
m('page_shows_the_agents_actions', "hide: ['compare', 'watch', 'share', 'pdf']", "hide: []", [PGE, BRW], CLIENT)
m('page_shows_the_label', "subject: typeof body.address === 'string' ? body.address : '',\n", "subject: typeof body.address === 'string' ? body.address : '',\n      label: typeof body.client_label === 'string' ? body.client_label : '',\n", [PGE, BRW], CLIENT)
m('page_dead_link_offers_retry', "Ask the person who sent it to you for a new link.']);", "Ask the person who sent it to you for a new link.'], true);", [PGE, BRW], CLIENT)
m('page_failure_called_dead', "    if (res.status === 404) { dead(); return; }\n    unavailable();", "    dead();", [PGE, BRW], CLIENT)
m('page_pdf_always_shown', '<button type="button" class="go" id="pdf" hidden', '<button type="button" class="go" id="pdf"', [PGE, BRW], CLIENT)
m('page_prints_its_chrome', "header.top,#status,#private,.notice,noscript{display:none!important}", "#status,#private,.notice,noscript{display:none!important}", [PGE, BRW], CLIENT)

# ---- the agent's page ------------------------------------------------------------------------------------------------------------------------------
m('agent_keeps_the_link', "      $('share-link').value = link;\n", "      $('share-link').value = link; try { sessionStorage.setItem('hs-share-link', link); } catch (e) {}\n", [STR], AGENT)
m('agent_shows_any_link', "if (r.status === 200 && body.status === 'OK' && SHARE_LINK.test(link)) {", "if (r.status === 200 && body.status === 'OK' && link) {", [AGB, AGS], AGENT)
m('agent_links_the_client_page', "var SHARE_FN = SB_URL + '/functions/v1/manage-shared-report';", "var SHARE_FN = SB_URL + '/functions/v1/manage-shared-report'; var CLIENT_PAGE = '<a href=\"shared-report.html\">';", [PGE], AGENT)


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
                print('HARNESS  %-40s %s' % (name, fault))
                harness.append(name)
                continue
            (ROOT / f).write_text(mutated)
            passed, which, line = run(tests)
            (ROOT / f).write_text(original)
            if passed is None:
                print('HARNESS  %-40s %s' % (name, line))
                harness.append(name)
            elif passed:
                print('SURVIVED %-40s' % name)
                survived.append(name)
            else:
                print('killed   %-40s by %s: %s' % (name, Path(which).name, line))
    finally:
        for f, original in originals.items():
            (ROOT / f).write_text(original)
    print('\n%d mutation(s): %d killed, %d survived, %d harness fault(s)' % (len(names), len(names) - len(survived) - len(harness), len(survived), len(harness)))
    return 2 if harness else (1 if survived else 0)


if __name__ == '__main__':
    sys.exit(main())
