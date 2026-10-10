#!/usr/bin/env python3
"""Prohibited mutations of the side-by-side comparison (Development Activity build step 10): the module, the customer page's use of it, and the
two helpers it reads from the report view. Each MUST make one of the suites listed against it exit non-zero:

    test/da-report-compare.test.mjs                        (behaviour, on the engine's real responses)
    test/da-report-compare-structure.test.mjs              (purity, the closed set of keys, one canonical path, the page adds no function)
    test/da-report-view.test.mjs / -structure.test.mjs     (the view the comparison reads)
    test/lib-cache-keys.test.mjs                           (the content keys on the script tags)
    test/development-activity-reports.test.mjs             (the agent's page, source-level contract)
    test/development-activity-reports.browser.test.mjs     (the agent's page in Chromium, against the real report handler)

It edits one file in place, runs the suites, and ALWAYS restores it, even on error or ^C. An anchor that does not match exactly once is a harness
fault, never a pass. A mutation may be several (old, new) pairs in ONE file; each must match exactly once. A mutation that changes nothing is a
harness fault. Exit 0 if every mutation was killed, 1 if any survived, 2 on a harness fault. The browser suite needs Playwright (as in CI's
browser job). Run it on a COPY of the tree, not the working tree, because it edits files in place. (Manual, like the other mutation loops: CI
runs the tests, not this loop.)

    python3 test/da_report_compare_mutants.py [--browser-only] [name ...]
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CMP = 'lib/da-report-compare.js'
VIEW = 'lib/da-report-view.js'
PAGE = 'development-activity-reports.html'

T = 'test/da-report-compare.test.mjs'
S = 'test/da-report-compare-structure.test.mjs'
VT = 'test/da-report-view.test.mjs'
VS = 'test/da-report-view-structure.test.mjs'
CK = 'test/lib-cache-keys.test.mjs'
PT = 'test/development-activity-reports.test.mjs'
PB = 'test/development-activity-reports.browser.test.mjs'
MOD = [T, S]                    # cheap offline suites
PAGEOFF = [S, PT, CK]           # offline suites that read the page
M = {}


def m(name, old, new, tests, f):
    assert name not in M, name
    M[name] = (f, [(old, new)], list(tests))


def mm(name, pairs, tests, f):
    assert name not in M, name
    M[name] = (f, list(pairs), list(tests))


# ---- what may be compared ---------------------------------------------------------------------------------------------------------------------
m('one_report_is_enough', "var MIN = 2, MAX = 5;", "var MIN = 1, MAX = 5;", MOD, CMP)
m('six_reports_are_allowed', "var MIN = 2, MAX = 5;", "var MIN = 2, MAX = 6;", MOD, CMP)
m('same_report_twice_is_allowed', "      if (seen[e.number]) return refused('duplicate');\n", "", MOD, CMP)
m('different_distances_are_compared', "      if (radius === null) radius = r; else if (r !== radius) return refused('radius');", "      if (radius === null) radius = r;", MOD, CMP)
m('a_report_with_no_distance_is_compared', "      if (typeof r !== 'number' || !isFinite(r) || r <= 0) return refused('radius');\n", "", MOD, CMP)
m('an_unreadable_report_is_skipped', "      if (!m) return refused('unreadable');", "      if (!m) continue;", MOD, CMP)
m('a_malformed_entry_is_accepted', "if (!V.util.isObj(e) || typeof e.number !== 'number' || e.number % 1 !== 0 || e.number < 1) return refused('unreadable');", "if (!V.util.isObj(e)) return refused('unreadable');", MOD, CMP)
m('missing_view_does_not_fail_closed', "    if (!V || typeof V.read !== 'function'", "    if (false && typeof V.read !== 'function'", MOD, CMP)

# ---- a column never reads as a zero when the report cannot say ----------------------------------------------------------------------------------
m('no_data_ingested_shown_as_zero', "    if (col.state === 'no_data') return V.util.esc(V.OUTCOMES.NO_DATA_INGESTED.title);\n    return V.util.esc(NOT_STATED);",
  "    if (col.state === 'no_data') return '0';\n    return V.util.esc(NOT_STATED);", MOD, CMP)
m('empty_report_with_no_outcome_shown_as_zero', "    if (col.state === 'no_data') return V.util.esc(V.OUTCOMES.NO_DATA_INGESTED.title);\n    return V.util.esc(NOT_STATED);",
  "    if (col.state === 'no_data') return V.util.esc(V.OUTCOMES.NO_DATA_INGESTED.title);\n    return '0';", MOD, CMP)
m('measured_zero_not_shown', "if (col.state === 'records' || col.state === 'none') return V.util.esc(String(n));", "if (col.state === 'records') return V.util.esc(String(n));", MOD, CMP)
m('change_history_not_ready_shown_as_zero', "return V.util.esc(n > 0 || col.ready ? String(n) : NOT_MEASURED);", "return V.util.esc(String(n));", MOD, CMP)
m('latest_change_not_ready_says_none', "if (!c.m.changed.length) return textCell(V, c, c.ready ? NONE_IN_REPORT : NOT_MEASURED);", "if (!c.m.changed.length) return textCell(V, c, NONE_IN_REPORT);", MOD, CMP)
m('not_ready_note_dropped', "      if (!c.ready) items.push(", "      if (false) items.push(", MOD, CMP)
m('no_records_note_dropped', "      if (!c.m.some) {\n        var body", "      if (false) {\n        var body", MOD, CMP)
m('legacy_report_permitted_shown_as_zero', "if (k === 'permitted' && c.m.legacy) return V.util.esc(NOT_IN_VERSION);", "if (false) return V.util.esc(NOT_IN_VERSION);", MOD, CMP)  # re-anchored 2026-10-07 (audit fix 10)
m('legacy_report_types_shown_as_counts', "return c.m.legacy ? V.util.esc(NOT_IN_VERSION) : countCell(V, c, n);", "return countCell(V, c, n);", MOD, CMP)

# ---- the numbers are the report's own ---------------------------------------------------------------------------------------------------------
m('stage_cell_reads_the_wrong_list', "return countCell(V, c, k === 'proposed' ? V.util.openProposed(c.m.staged.proposed).length : c.m.staged[k].length);", "return countCell(V, c, c.m.changed.length);", MOD, CMP)  # re-anchored 2026-10-07 (audit fix 10)
m('change_cell_reads_the_wrong_list', "changeCell(V, c, c.m.changed.length)", "changeCell(V, c, c.m.activity.length)", MOD, CMP)
m('event_cell_reads_the_wrong_list', "countCell(V, c, c.m.activity.length)", "countCell(V, c, c.m.changed.length)", MOD, CMP)
m('type_count_is_always_zero', "        perCol[i].forEach(function (t) { if (t.key === k) n = t.n; });", "        perCol[i].forEach(function (t) { if (t.key === k) n = 0; });", MOD, CMP)
m('type_rows_in_any_order', "    V.TYPE_ORDER.forEach(function (k) {", "    V.TYPE_ORDER.slice(0).reverse().forEach(function (k) {", MOD, CMP)
m('most_recent_record_is_the_last', "var d = V.describe(c.m.activity[0]);", "var d = V.describe(c.m.activity[c.m.activity.length - 1]);", MOD, CMP)
m('limitation_text_unescaped', "return lims.length ? '<ul class=\"da-cmp-lims\">' + lims.map(function (t) { return '<li>' + V.util.esc(t) + '</li>'; }).join('')", "return lims.length ? '<ul class=\"da-cmp-lims\">' + lims.map(function (t) { return '<li>' + t + '</li>'; }).join('')", MOD, CMP)
m('as_of_day_not_stated', "return V.util.esc(V.util.day(c.m.report.as_of) || NOT_STATED);", "return V.util.esc(V.util.day(c.m.report.as_of) || '');", MOD, CMP)

# ---- it ranks nothing ---------------------------------------------------------------------------------------------------------------------------
m('columns_sorted_by_number', "    return { ok: true, columns: cols, radius: radius };", "    return { ok: true, columns: cols.slice().sort(function (a, b) { return a.number - b.number; }), radius: radius };", MOD, CMP)
m('a_total_row_is_added', "    out.push(group(V, 'Timeline', span));", "    out.push(tr(V, 'Total records', cols, function (c) { return V.util.esc(String(c.m.current.length)); }));\n    out.push(group(V, 'Timeline', span));", MOD, CMP)
m('best_column_is_marked', "return '<td><span class=\"da-cmp-r\">Report ' + c.number + '</span>", "return '<td data-best=\"1\"><span class=\"da-cmp-r\">Report ' + c.number + '</span>", MOD, CMP)
m('not_a_score_sentence_changed', "var NOT_A_SCORE = 'This sets facts from official records side by side. It is not a score or a recommendation, and HomeSignal does not rank properties.';",
  "var NOT_A_SCORE = 'This sets facts from official records side by side.';", MOD, CMP)
m('disclosure_dropped', "+ '</p><p class=\"da-cmp-p\">' + V.util.esc(V.DISCLOSURE) + '</p></section></article>';", "+ '</p></section></article>';", MOD, CMP)
m('distance_note_dropped', "'<p class=\"da-cmp-p\">' + V.util.esc(UNIT_NOTE) + '</p><p class=\"da-cmp-p\">' + V.util.esc(DISTANCE_NOTE) + '</p>'", "'<p class=\"da-cmp-p\">' + V.util.esc(UNIT_NOTE) + '</p>'", MOD, CMP)
m('a_distance_row_is_added', "    out.push(group(V, 'Coverage and freshness', span));", "    out.push(group(V, 'Coverage and freshness', span));\n    out.push(tr(V, 'Nearest record', cols, function () { return V.util.esc('0.2 mi'); }));", MOD, CMP)

# ---- the address and the label ---------------------------------------------------------------------------------------------------------------------
m('address_in_an_attribute', "return '<li><span class=\"da-cmp-n\">Report ' + c.number", "return '<li title=\"' + V.util.esc(c.address) + '\"><span class=\"da-cmp-n\">Report ' + c.number", MOD, CMP)
m('address_in_the_column_heading', "return '<th scope=\"col\">Report ' + c.number + '</th>';", "return '<th scope=\"col\">Report ' + c.number + ' ' + V.util.esc(c.address) + '</th>';", MOD, CMP)
m('address_unescaped', "V.util.esc(c.address || V.util.NO_ADDRESS)", "(c.address || V.util.NO_ADDRESS)", MOD, CMP)
m('label_unescaped', "(c.label ? ' <span class=\"da-cmp-lab\">' + V.util.esc(c.label) + '</span>' : '')", "(c.label ? ' <span class=\"da-cmp-lab\">' + c.label + '</span>' : '')", MOD, CMP)
m('purged_address_not_said', "V.util.esc(c.address || V.util.NO_ADDRESS)", "V.util.esc(c.address)", MOD, CMP)

# ---- mount -------------------------------------------------------------------------------------------------------------------------------------------
m('refused_comparison_leaves_the_old_one', "    el.innerHTML = b.ok ? html(entries) : '';", "    if (b.ok) el.innerHTML = html(entries);", MOD, CMP)
m('stylesheet_added_every_time', "if (b.ok && doc && doc.head && !doc.getElementById('da-cmp-style')) {", "if (b.ok && doc && doc.head) {", MOD, CMP)

# ---- the view's helpers it reads -------------------------------------------------------------------------------------------------------------------
m('change_history_always_ready', "    return cov.change_ready === true;", "    return true;", MOD + [VT, VS], VIEW)
m('view_does_not_export_read', "    read: read,\n", "", MOD, VIEW)
m('view_does_not_export_change_ready', "    changeReady: changeReady,\n", "", MOD, VIEW)
m('type_counts_keep_unlabelled_types', "return TYPE_CHIP_ORDER.filter(function (k) { return seen[k] && typeLabelFor(k, seen); })", "return TYPE_CHIP_ORDER.filter(function (k) { return true; })", MOD + [VT], VIEW)

# ---- the page's use of it ----------------------------------------------------------------------------------------------------------------------------
m('compare_sends_the_address', "post(REPORT_FN, { action: 'open', report_id: c.report_id })", "post(REPORT_FN, { action: 'open', report_id: c.report_id, address: c.address })", PAGEOFF + [PB], PAGE)
m('compare_makes_a_report_per_column', "post(REPORT_FN, { action: 'open', report_id: c.report_id })", "post(REPORT_FN, { address: c.address, view: 'customer' })", PAGEOFF + [PB], PAGE)
m('compare_goes_in_tick_order', "var ids = chosenIds(), chosen = compareRows.filter(function(r){ return ids.indexOf(r.report_id) >= 0; });",
  "var ids = chosenIds(), chosen = ids.map(function(id){ return compareRows.filter(function(r){ return r.report_id === id; })[0]; });", PAGEOFF + [PB], PAGE)
m('late_answer_is_painted', "    if (!session || !session.user || session.user.id !== forUser) return; // the person changed or signed out while the answers were on their way\n", "", PAGEOFF + [PB], PAGE)
m('a_sixth_report_can_be_ticked', "c.disabled = !c.checked && n >= max;", "c.disabled = false;", PAGEOFF + [PB], PAGE)
m('one_report_can_be_compared', "$('compare-go').disabled = comparing || n < min || n > max;", "$('compare-go').disabled = comparing || n > max;", PAGEOFF + [PB], PAGE)
m('button_free_while_opening', "$('compare-go').disabled = comparing || n < min || n > max;", "$('compare-go').disabled = n < min || n > max;", PAGEOFF + [PB], PAGE)
m('signing_out_keeps_the_comparison', "$('saved').hidden = true; hideCompare(); return; }", "$('saved').hidden = true; return; }", PAGEOFF + [PB], PAGE)
m('changing_the_choice_keeps_the_comparison', "cb.addEventListener('change', function(){ $('compare-result').textContent = ''; compareSay('', false); syncCompare(); });", "cb.addEventListener('change', function(){ syncCompare(); });", PAGEOFF + [PB], PAGE)
m('compare_action_not_live_on_a_reopened_report', "live: canShare ? ['share', 'watch', 'pdf', 'compare'] : ['share', 'pdf']", "live: canShare ? ['share', 'watch', 'pdf'] : ['share', 'pdf']", PAGEOFF + [PB], PAGE)  # re-anchored 2026-10-07 (audit fix 10)
m('compare_action_not_live_on_a_new_report', "live: shareable ? ['share', 'watch', 'pdf', 'compare'] : ['share', 'pdf']", "live: shareable ? ['share', 'watch', 'pdf'] : ['share', 'pdf']", PAGEOFF + [PB], PAGE)  # re-anchored 2026-10-07 (audit fix 10)
m('compare_action_compares_at_once', "else if (act === 'compare' && !$('compare').hidden) chooseForCompare(shareFor);", "else if (act === 'compare' && !$('compare').hidden) runCompare();", PAGEOFF + [PB], PAGE)
m('card_shown_to_everyone', 'id="compare" aria-labelledby="compare-title" role="group" hidden>', 'id="compare" aria-labelledby="compare-title" role="group">', PAGEOFF + [PB], PAGE)
m('unreadable_saved_list_says_nothing', "paintCompare(null); return; }", "return; }", PAGEOFF + [PB], PAGE)
m('a_not_found_report_is_compared_anyway', "if (r.status !== 200 || body.status !== 'OK' || body.reopened !== true || !V.renderable(body)) { compareSay(compareMessage(r.status), true); return; }", "if (r.status !== 200) { compareSay(compareMessage(r.status), true); return; }", PAGEOFF + [PB], PAGE)
m('opening_is_said_to_use_a_free_report', "Opening them did not use a free report.'", "Opening them used one free report each.'", [PB], PAGE)
# the tags, built from the page as it is (the content key changes whenever a lib does)
_tag = re.search(r'<script src="lib/da-report-compare\.js\?v=([0-9a-f]{8})"></script>\n', (ROOT / PAGE).read_text())
_view = re.search(r'<script src="lib/da-report-view\.js\?v=([0-9a-f]{8})"></script>\n', (ROOT / PAGE).read_text())
if _tag and _view:
    m('compare_loads_before_the_view', _view.group(0) + _tag.group(0), _tag.group(0) + _view.group(0), PAGEOFF, PAGE)
    m('compare_tag_has_a_stale_key', _tag.group(0), '<script src="lib/da-report-compare.js?v=00000000"></script>\n', PAGEOFF, PAGE)
    m('compare_tag_has_no_key', _tag.group(0), '<script src="lib/da-report-compare.js"></script>\n', PAGEOFF, PAGE)
# the stylesheet: a phone
m('phone_cells_do_not_name_their_report', ".da-cmp-r{display:inline-block;min-width:5.5em}", ".da-cmp-r{display:none}", MOD + [PB], CMP)
m('phone_table_does_not_stack', ".da-cmp-table,.da-cmp-table tbody,.da-cmp-table tr,.da-cmp-table th,.da-cmp-table td{display:block;width:auto;min-width:0}", ".da-cmp-table{width:100%}", MOD + [PB], CMP)


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
    browser_only = '--browser-only' in sys.argv      # run each page mutation against the Chromium suite ALONE, to show it is load-bearing there too
    only = set(a for a in sys.argv[1:] if not a.startswith('--'))
    if only - set(M):
        print('HARNESS - unknown mutation(s): ' + ', '.join(sorted(only - set(M))))
        return 2
    base = [PB] if browser_only else [T, S, VT, VS, CK, PT, PB]
    passed, which, line = run(base)
    if not passed:
        print('HARNESS - the unmutated tree does not pass %s (%s)' % (which, line))
        return 2
    originals = {f: (ROOT / f).read_text() for f in {v[0] for v in M.values()}}
    survived, harness, ran = [], [], []
    names = [k for k in M if not only or k in only]
    try:
        for name in names:
            f, pairs, tests = M[name]
            if browser_only:
                if PB not in tests:
                    continue
                tests = [PB]
            original = originals[f]
            ran.append(name)
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
            sys.stdout.flush()
    finally:
        for f, original in originals.items():
            (ROOT / f).write_text(original)
    print('\n%d mutation(s): %d killed, %d survived, %d harness fault(s)' % (len(ran), len(ran) - len(survived) - len(harness), len(survived), len(harness)))
    return 2 if harness else (1 if survived else 0)


if __name__ == '__main__':
    sys.exit(main())
