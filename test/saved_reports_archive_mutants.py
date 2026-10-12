#!/usr/bin/env python3
"""Prohibited mutations of REMOVE FROM MY LIST, in the TypeScript and page layers (the SQL's own mutations are in test/saved_reports_archive_pg/run.sh).
Each MUST make one of

    test/saved-reports-archive-function.test.mjs   (the report function's archive / restore / list actions and its data layer, offline)
    test/saved-reports-archive-structure.test.mjs  (the shape: one ownership path, one bound, nothing kept in the browser, notice after the server)
    test/saved-reports-archive.browser.test.mjs    (the page in Chromium, against the REAL report function handler)

exit non-zero. It edits one file in place, runs the cheap suites first and the browser last, and ALWAYS restores the file, even on error or ^C. An anchor that does not
match exactly once is a harness fault, never a pass. Exit 0 if every mutation was killed, 1 if any survived, 2 on a harness fault.
(Manual, like the other mutation loops: CI runs the tests, not this loop.)

    python3 test/saved_reports_archive_mutants.py [name ...]
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HAND = 'supabase/functions/get-development-activity-report/handler.ts'
READS = 'supabase/functions/_shared/evaluation-reads.ts'
PAGE = 'development-activity-reports.html'
FNT = 'test/saved-reports-archive-function.test.mjs'
STR = 'test/saved-reports-archive-structure.test.mjs'
BRO = 'test/saved-reports-archive.browser.test.mjs'
M = {}


def m(name, old, new, f):
    assert name not in M, name
    M[name] = (f, old, new)


# ---- the report function ------------------------------------------------------------------------------------------------------------------
m('archive_accepts_a_user_id', "['action', 'report_ids'];", "['action', 'report_ids', 'user_id'];", HAND)
m('direction_flipped', "b.action === 'archive');\n          return reply(req, { status: 'OK', action: b.action", "b.action !== 'archive');\n          return reply(req, { status: 'OK', action: b.action", HAND)
m('bound_removed', "ids.length > ARCHIVE_MAX_IDS || !ids.every", "ids.length > 100000 || !ids.every", HAND)
m('empty_set_allowed', "!Array.isArray(ids) || ids.length < 1 || ids.length > ARCHIVE_MAX_IDS", "!Array.isArray(ids) || ids.length > ARCHIVE_MAX_IDS", HAND)
m('list_ignores_archived', "const archived = b.archived === true;", "const archived = false;", HAND)
m('list_accepts_a_string_flag', "if (b.archived !== undefined && typeof b.archived !== 'boolean') return reply(req, { error: 'invalid_request', detail: 'archived' }, 400);", "", HAND)
m('admin_may_archive', "if (!trial) return reply(req, { error: 'forbidden' }, 403);\n      try {\n        if (b.action === 'archive'", "try {\n        if (b.action === 'archive'", HAND)
m('not_found_becomes_500', "        if (e instanceof SavedReportNotFound) return reply(req, { error: 'not_found' }, 404);\n", "", HAND)
m('archive_reaches_the_geocoder', "          const changed = await deps.archiveReports(", "          await deps.geocode('x');\n          const changed = await deps.archiveReports(", HAND)
m('archive_reads_the_address', "          const changed = await deps.archiveReports(", "          await deps.subjectOf(null);\n          const changed = await deps.archiveReports(", HAND)
m('answer_leaks_the_ids', "requested: new Set((ids as string[]).map((x) => x.toLowerCase())).size, changed,", "requested: new Set((ids as string[]).map((x) => x.toLowerCase())).size, changed, report_ids: ids,", HAND)
# ---- the shared data layer ---------------------------------------------------------------------------------------------------------------
m('ids_not_lowercased', "p_report_ids: reportIds.map((x) => x.toLowerCase())", "p_report_ids: reportIds", READS)
m('changed_count_unchecked', " || data < 0 || data > reportIds.length) throw", ") throw", READS)
m('not_found_called_unavailable', "        if (error.message === 'NOT_FOUND') throw new SavedReportNotFound('refused');\n", "", READS)
m('malformed_id_reaches_the_database', " || !reportIds.every((x) => typeof x === 'string' && UUID.test(x))) {", ") {", READS)
m('list_always_active', "{ p_user_id: userId, p_archived: archived }", "{ p_user_id: userId, p_archived: false }", READS)
m('list_error_called_empty', "      if (error) throw new DataUnavailable('saved_reports_listed');", "      if (error) return [];", READS)
# ---- the page --------------------------------------------------------------------------------------------------------------------------------
m('notice_before_the_server', "    archiveBusy = true; closeMenu(false); updateBulk(); savedSay('', false);", "    archiveBusy = true; closeMenu(false); updateBulk(); savedSay('', false); showToast('Removed from Saved Reports.', true);", PAGE)
m('row_leaves_on_any_answer', "      if (r.status === 200 && r.body && r.body.status === 'OK') {\n        done += chunk.length;", "      if (true) {\n        done += chunk.length;", PAGE)
m('second_request_allowed', "    if (archiveBusy || !session || !session.user || !ids.length) return false;", "    if (!session || !session.user || !ids.length) return false;", PAGE)
m('bulk_counts_hidden_rows', "return c.checked && !c.closest('li').hidden; })", "return c.checked; })", PAGE)
m('select_all_takes_hidden_rows', "c.checked = on && !c.closest('li').hidden;", "c.checked = on;", PAGE)
m('confirmation_misnames_the_count', "$('saved-confirm-text').textContent = 'Remove ' + ids.length + (ids.length === 1", "$('saved-confirm-text').textContent = 'Remove ' + (ids.length + 1) + (ids.length === 1", PAGE)
m('confirm_sends_live_selection', "var ids = confirmIds; hideConfirm(); if (ids && ids.length) changeList(ids, true, 'bulk');", "var ids = manageIds(); hideConfirm(); if (ids && ids.length) changeList(ids, true, 'bulk');", PAGE)
m('page_bound_wrong', "var MAX_PER_CALL = 100;", "var MAX_PER_CALL = 1000;", PAGE)
m('stale_answer_painted', "      if (!session || !session.user || session.user.id !== forUser) { archiveBusy = false; return false; } // another person is signed in now: touch nothing", "", PAGE)
m('normal_list_sends_a_flag', "archivedView ? { action: 'list', archived: true } : { action: 'list' }", "{ action: 'list', archived: archivedView }", PAGE)
m('list_kept_in_the_browser', "  function hideToast(){ if (toastTimer)", "  function hideToast(){ try { localStorage.setItem('hs-saved', 'x'); } catch (e) {} if (toastTimer)", PAGE)
m('compare_reads_every_input', "return Array.prototype.filter.call($('saved-list').querySelectorAll('.sv-pick input'), function(c){ return c.checked; })", "return Array.prototype.filter.call($('saved-list').querySelectorAll('input'), function(c){ return c.checked; })", PAGE)
m('restore_button_archives', "changeList([rep.report_id], false, 'restore');", "changeList([rep.report_id], true, 'restore');", PAGE)
m('undo_archives_again', "if (await changeList(ids, false, 'undo'))", "if (await changeList(ids, true, 'undo'))", PAGE)
m('menu_clipped_by_the_list', ".sv-menu{position:fixed;", ".sv-menu{position:absolute;", PAGE)
m('long_address_pushes_the_button_out', "#saved-list{grid-template-columns:minmax(0,1fr)} ", "", PAGE)
m('small_touch_target', "@media(pointer:coarse){#saved-list .sv-kebab{width:44px;min-width:44px;min-height:44px}", "@media(pointer:coarse){#saved-list .sv-kebab{width:30px;min-width:30px;min-height:30px}", PAGE)
m('escape_loses_focus', "if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }", "if (e.key === 'Escape') { e.preventDefault(); closeMenu(false); }", PAGE)
m('menu_closes_when_focus_lands_on_it', "$('saved-list').addEventListener('scroll', closeMenuIfMoved);", "$('saved-list').addEventListener('scroll', function(){ closeMenu(false); });", PAGE)
m('failure_words_cleared', "if (offered.length) { if (!keepMessage) savedSay('', false); }", "if (offered.length) { savedSay('', false); }", PAGE)
m('manage_checkbox_kept_after_search', "      if (li.hidden) { var mc = li.querySelector('.sv-mpick input'); if (mc) mc.checked = false; }\n", "", PAGE)


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
        print('HARNESS — unknown mutation(s): ' + ', '.join(sorted(only - set(M))))
        return 2
    order = [FNT, STR, BRO]
    passed, which, line = run(order)
    if not passed:
        print('HARNESS — the unmutated tree does not pass %s (%s)' % (which, line))
        return 2
    originals = {f: (ROOT / f).read_text() for f in {v[0] for v in M.values()}}
    survived, harness = [], []
    names = [k for k in M if not only or k in only]
    try:
        for name in names:
            f, old, new = M[name]
            original = originals[f]
            if original.count(old) != 1:
                print('HARNESS  %-40s anchor matched %d times' % (name, original.count(old)))
                harness.append(name)
                continue
            (ROOT / f).write_text(original.replace(old, new))
            passed, which, line = run(order)
            (ROOT / f).write_text(original)
            if passed is None:
                print('HARNESS  %-40s %s' % (name, line))
                harness.append(name)
            elif passed:
                print('SURVIVED %-40s' % name)
                survived.append(name)
            else:
                print('killed   %-40s by %s: %s' % (name, Path(which).name, line))
            sys.stdout.flush()
    finally:
        for f, original in originals.items():
            (ROOT / f).write_text(original)
    print('\n%d mutation(s): %d killed, %d survived, %d harness fault(s)' % (len(names), len(names) - len(survived) - len(harness), len(survived), len(harness)))
    return 2 if harness else (1 if survived else 0)


if __name__ == '__main__':
    sys.exit(main())
