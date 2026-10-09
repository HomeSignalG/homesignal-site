#!/usr/bin/env python3
"""Prohibited mutations of the Development Activity report view (Order I, step 1; the 100526 layout, build step 3). Each MUST make at least one suite exit non-zero:

    test/da-report-view.test.mjs            (behaviour: the view over the real engine's output)
    test/da-report-view-structure.test.mjs  (structural pins)
    test/da-report-view.browser.test.mjs    (a real browser; run only for the presentation mutations, which a string cannot show)

Run:  python3 test/da_report_view_mutants.py   [name ...]

It edits lib/da-report-view.js in place, runs the suites, and ALWAYS restores the original (even on error or ^C). Every mutation is
verified to APPLY: its anchor must match exactly once and the file must change, otherwise it is a harness fault, never a pass (a
mutation that does not apply is indistinguishable from one that survives). A mutation that only makes the module fail to parse is also a
harness fault: a SyntaxError is not a kill. Each kill prints the FIRST failing check, so a kill is attributed to a named check.
Exit 0 if every mutation was killed, 1 if any survived, 2 on a harness fault.
(Manual, like test/national_report_mutants.py: CI runs the node tests, not this loop.)
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOD = 'lib/da-report-view.js'
BEHAVIOUR = 'test/da-report-view.test.mjs'
STRUCTURE = 'test/da-report-view-structure.test.mjs'
BROWSER = 'test/da-report-view.browser.test.mjs'
NODE_TESTS = [BEHAVIOUR, STRUCTURE]

# name -> (old, new, tests)
M = {}


def m(name, old, new, tests=None):
    assert name not in M, name
    M[name] = (old, new, tests or NODE_TESTS)


# ---- section order, and only sections that have data ----------------------------------------------------------------------------------
m('evidence_moved_to_top', "    parts.push(evidenceSection(report));", "    parts.splice(1, 0, evidenceSection(report));")
m('stage_label_changed', "approved: 'Approved / Coming',", "approved: 'Approved / Coming Soon',")
m('things_to_review_invented',
  "    parts.push(evidenceSection(report));",
  "    parts.push('<section class=\"da-rv-sec da-rv-sec--review\" aria-label=\"Things to Review\"><h2 class=\"da-rv-h2\">Things to Review With Your Client</h2></section>');\n    parts.push(evidenceSection(report));")
# ---- the hero is a change claim only where the ledger proved one ------------------------------------------------------------------------
m('publisher_event_filed_as_change', "line('Official record', eventText(pe.label, pe.date))", "line('HomeSignal detected', eventText(pe.label, pe.date))")
m('detected_date_is_publisher_date', "line('HomeSignal detected', eventText(eventLabel(dc.event_type), day(dc.detected_at)))",
  "line('HomeSignal detected', eventText(eventLabel(dc.event_type), day(dc.publisher_event && dc.publisher_event.date)))")
# ---- lifecycle: text AND shape, the engine's own key and label ---------------------------------------------------------------------------
m('proposed_labelled_coming',
  "function lifeLabel(p) { return (isObj(p.lifecycle) ? txt(p.lifecycle.label) : '') || 'Lifecycle unknown'; }",
  "function lifeLabel(p) { return lifeKey(p) === 'proposed' ? 'Approved / Coming' : (isObj(p.lifecycle) ? txt(p.lifecycle.label) : '') || 'Lifecycle unknown'; }")
m('lifecycle_text_dropped', "'<span class=\"da-rv-lifetext\">' + esc(lifeLabel(p)) + '</span></span>';", "'<span class=\"da-rv-lifetext\"></span></span>';")
m('lifecycle_shape_dropped', "data-lifecycle=\"' + k + '\">' + SHAPES[k]", "data-lifecycle=\"' + k + '\">'")
m('lifecycle_rederived_from_publisher_status',
  "function lifeKey(p) { var k = isObj(p.lifecycle) ? p.lifecycle.key : '';",
  "function lifeKey(p) { var k = String(p.publisher_status).toLowerCase() === 'approved' ? 'approved' : (isObj(p.lifecycle) ? p.lifecycle.key : '');")
m('lifecycle_key_unvalidated', "return typeof k === 'string' && has(SHAPES, k) ? k : 'unknown'; }", "return k; }")
m('type_shown_as_key', "return isObj(p.type) ? txt(p.type.label) : ''; }", "return isObj(p.type) ? txt(p.type.key) : ''; }")
# ---- nothing internal reaches the page ------------------------------------------------------------------------------------------------------
m('render_storage_blockers', "parts.join('') + '</article>'", "parts.join('') + esc(JSON.stringify(response.storage_blockers)) + '</article>'")
m('render_limitation_code', "return txt(l.text); }", "return txt(l.code) + ' ' + txt(l.text); }")
m('coverage_state_printed', "+ '\" aria-label=\"HomeSignal Development Activity report\">'", "+ '\" aria-label=\"HomeSignal Development Activity report\" data-state=\"' + esc(response.coverage_state) + '\">'")
# ---- coverage: the engine's words, never "no activity" -----------------------------------------------------------------------------------------
m('limitation_text_dropped',
  "(lims.length ? '<ul class=\"da-rv-lims\">' + lims.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '')", "''")
m('disclosure_dropped', "      + '<p class=\"da-rv-p da-rv-quiet\">' + esc(DISCLOSURE) + '</p>';", "      + '';")
m('scope_lines_dropped', "'<p class=\"da-rv-p\">' + esc(SCOPE_LINE) + '</p><p class=\"da-rv-p da-rv-quiet\">' + esc(SCOPE_NOTE) + '</p>'", "''")
m('disclosure_text_altered', "It may not include every project or change and is not a substitute", "It includes every project and change and is not a substitute")
# ---- distances: only from this response ---------------------------------------------------------------------------------------------------------
m('negative_distance_shown', "if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';", "if (typeof n !== 'number' || !isFinite(n)) return '';")
m('distance_wrong_precision', "n.toFixed(1) + ' mi'", "n.toFixed(3) + ' mi'")
m('tiny_distance_shown_as_zero', "return n < 0.1 ? 'Under 0.1 mi' : n.toFixed(1) + ' mi';", "return n.toFixed(1) + ' mi';")
# ---- escaping ---------------------------------------------------------------------------------------------------------------------------------------
m('escaping_removed', "\n      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');", ";", [BEHAVIOUR, STRUCTURE, BROWSER])
m('escape_quote_dropped', ".replace(/\"/g, '&quot;')", "")
m('escape_ampersand_dropped', ".replace(/&/g, '&amp;')", "")
m('escape_angle_dropped', ".replace(/</g, '&lt;').replace(/>/g, '&gt;')", "")
m('line_value_not_escaped', "':</span> ' + esc(text) + '</p>'", "':</span> ' + text + '</p>'")
m('change_values_not_escaped', "esc(fieldLabel(c.field) + ': ' + value(c.from) + ' → ' + value(c.to))", "(fieldLabel(c.field) + ': ' + value(c.from) + ' → ' + value(c.to))")
# ---- links ------------------------------------------------------------------------------------------------------------------------------------------------
m('javascript_url_accepted', "return s.length <= 2000 && HTTP_URL.test(s) ? s : '';", "return s.length <= 2000 && /^[a-z]+:/i.test(s) ? s : '';")
m('ftp_url_accepted', "var HTTP_URL = /^https?:\\/\\/", "var HTTP_URL = /^(https?|ftp):\\/\\/")
m('url_whitespace_allowed', "[^\\s\"'<>`\\\\]+$/i;", "[^\"'<>`\\\\]+$/i;")
m('url_quote_allowed', "[^\\s\"'<>`\\\\]+$/i;", "[^\\s<>`\\\\]+$/i;")
m('link_without_noopener', "target=\"_blank\" rel=\"noopener noreferrer\">Official source ", "target=\"_blank\">Official source ")
m('link_url_unvalidated', 'var href = safeHref(s.url);', 'var href = txt(s.url);')  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('link_name_loses_record', " for ' + esc(titleOf(p)) + ' (opens in a new tab)</span>", " (opens in a new tab)</span>")
# ---- the address ------------------------------------------------------------------------------------------------------------------------------------------
m('address_in_href', "esc(EYEBROW) + '</p><p class=\"da-rv-addr\">'", "esc(EYEBROW) + '</p><a href=\"https://example.gov/?q=' + encodeURIComponent(subject) + '\">x</a><p class=\"da-rv-addr\">'")
m('address_in_data_attribute', "'<header class=\"da-rv-head\">", "'<header class=\"da-rv-head\" data-subject=\"' + esc(subject) + '\">")
m('address_in_aria_label', "'<header class=\"da-rv-head\">", "'<header class=\"da-rv-head\" aria-label=\"' + esc(subject) + '\">")
# ---- purity: no network, storage, location, clock, ranking, dynamic code -----------------------------------------------------------------------------
m('adds_a_fetch', '    if (!renderable(response)) return null;\n    var report = response.report', "    if (typeof fetch === 'function') { try { fetch('/x'); } catch (e) { void e; } }\n    if (!renderable(response)) return null;\n    var report = response.report")  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('reads_local_storage', "var HS = root.HS = root.HS || {};", "var HS = root.HS = root.HS || {}; var _stored = root.localStorage;")
m('reads_location', "var HS = root.HS = root.HS || {};", "var HS = root.HS = root.HS || {}; var _here = root.location;")
m('reads_the_clock', "var HS = root.HS = root.HS || {};", "var HS = root.HS = root.HS || {}; var _now = new Date();")
m('imports_the_authority', "var HS = root.HS = root.HS || {};", "var HS = root.HS = root.HS || {}; var _auth = HS.canonicalLifecycle;")
m('reads_a_second_response_key', "function distanceOf(response, id) {", "function distanceOf(response, id) {\n    void response.coverage_state;")
# ---- mount, and the presentation a string cannot show --------------------------------------------------------------------------------------------------
m('mount_adds_style_twice', "if (doc && doc.head && !doc.getElementById('da-rv-style')) {", "if (doc && doc.head) {", [BROWSER])
m('mount_reports_true_always', "return renderable(response);\n  }\n\n  HS.daReportView", "return true;\n  }\n\n  HS.daReportView", [BROWSER])
m('mount_keeps_the_old_report', "el.innerHTML = html(response, opts);", "if (renderable(response)) el.innerHTML = html(response, opts);", [BROWSER, STRUCTURE])
m('css_no_wrap', "font-size:15px;line-height:1.55;overflow-wrap:anywhere}", "font-size:15px;line-height:1.55}", [BROWSER])
m('css_no_focus_ring', "'.da-rv a:focus-visible{outline:3px solid var(--rv-green);outline-offset:2px;border-radius:3px}',", "'.da-rv a:focus-visible{outline:none}',", [BROWSER])
m('css_link_not_tappable', ".da-rv-link{display:inline-block;padding:8px 0;", ".da-rv-link{", [BROWSER])
m('css_low_contrast_proposed', "--rv-amber:#8a5200;", "--rv-amber:#e0a050;", [BROWSER])
m('css_screen_reader_text_visible', ".da-rv-sr{position:absolute;", ".da-rv-sr{position:static;", [BROWSER])
m('css_empty_report_not_prominent', "'.da-rv--empty .da-rv-lims{font-size:16px;font-weight:600}',", "'.da-rv--empty .da-rv-lims{}',", [BROWSER])


# ---- the 100526 layout (build step 3): section order, the three stages, and what each section may claim -----------------------------------
m('swap_two_sections', "var STAGES = ['approved', 'proposed', 'permitted'];", "var STAGES = ['proposed', 'approved', 'permitted'];")
m('permitted_stage_dropped', "var STAGES = ['approved', 'proposed', 'permitted'];", "var STAGES = ['approved', 'proposed'];")
m('actions_before_evidence', '    parts.push(evidenceSection(report));\n    if (some) parts.push(actionsBar(opts));', '    if (some) parts.push(actionsBar(opts));\n    parts.push(evidenceSection(report));')  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('history_shown_when_empty', "    if (some) parts.push(historySection(history, report));", "    parts.push(historySection(history, report));")
m('actions_on_empty_report', '    if (some) parts.push(actionsBar(opts));', '    parts.push(actionsBar(opts));')  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('absence_claim_added', '    parts.push(evidenceSection(report));\n    if (some) parts.push(actionsBar(opts));', "    if (!some) parts.push('<p>No development activity found near this address.</p>');\n    parts.push(evidenceSection(report));\n    if (some) parts.push(actionsBar(opts));")  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('empty_report_unmarked', "(some ? '' : ' da-rv--empty')", "''")
m('permitted_title_changed', "permitted: 'Permitted / Under Construction',", "permitted: 'Under Construction',")
# ---- the stage is the ENGINE's; the view never re-derives it ----------------------------------------------------------------------------
m('operating_listed_in_stage_section',
  "staged[k] = pick(byStage[k]).filter(function (p) { return !stageFor[p.project_id] && (legacy || stageKey(p) === k); });",
  "staged[k] = pick(k === 'approved' && isObj(sec.by_lifecycle) ? arr(byStage[k]).concat(arr(sec.by_lifecycle.operating)) : byStage[k]).filter(function (p) { return !stageFor[p.project_id]; });")
m('sorts_stage_cards', "      staged[k] = pick(byStage[k]).filter(", "      staged[k] = pick(byStage[k]).sort(function (a, b) { return titleOf(a) < titleOf(b) ? -1 : 1; }).filter(")
m('stage_label_from_lifecycle', "    return (isObj(p.stage) && p.stage.key === k ? txt(p.stage.label) : '') ||", '    return lifeLabel(p) ||')  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('proposed_shape_equals_approved',
  "  var SHAPES = {\n    approved: SVG_OPEN + '<circle cx=\"7\" cy=\"7\" r=\"5.5\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"1.5\"/></svg>',\n    proposed: SVG_OPEN + '<circle cx=\"7\" cy=\"7\" r=\"5.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-dasharray=\"3 2.5\"/></svg>',",
  "  var SHAPES = {\n    approved: SVG_OPEN + '<circle cx=\"7\" cy=\"7\" r=\"5.5\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"1.5\"/></svg>',\n    proposed: SVG_OPEN + '<circle cx=\"7\" cy=\"7\" r=\"5.5\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"1.5\"/></svg>',")
# ---- a stage card shows the stage, the lifecycle and the publisher's own words, each labelled ------------------------------------------------
m('stage_card_lifecycle_dropped', "      + (showLifecycle ? line('HomeSignal lifecycle', lifeLabel(p)) : '')\n", '')  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('first_detected_is_publisher_date', "function ledgerFirstRead(p) { return isObj(p.homesignal_observation) ? day(p.homesignal_observation.first_observed_at) : ''; }", "function ledgerFirstRead(p) { var pe = publisherEvent(p); return pe ? pe.date : ''; }")  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
# ---- Things to Review: the engine's list, a neutral prompt, never a prediction ----------------------------------------------------------------
# ---- the map: response-only positions, to scale, numbered like the cards, no basemap -----------------------------------------------------------------
m('distance_without_render', "  function distanceOf(response, id) {\n    var r = isObj(response.render) ? response.render : null;",
  "  function distanceOf(response, id) {\n    var r = isObj(response.render) ? response.render : { distances_mi: { 'k-approved': 0.2 } };")
m('map_invents_positions', "if (d === null || b === null) return;", "if (d === null) d = 0.25; if (b === null) b = 0;")
m('map_drawn_with_nothing', "    if (!drawn) return '';\n", "")
m('map_not_to_scale', "var rr = Math.min(d / radius, 1) * R,", "var rr = R * 0.6,")
m('map_north_flipped', "py = C - rr * Math.cos(rad);", "py = C + rr * Math.cos(rad);")
m('map_number_off_by_one', "'<text class=\"da-rv-mnum\" text-anchor=\"middle\" dy=\"4\">' + x.n + '</text></g>'", "'<text class=\"da-rv-mnum\" text-anchor=\"middle\" dy=\"4\">' + (x.n + 1) + '</text></g>'")
m('map_permitted_drawn_as_circle', "var k = x.k, shape = k === 'permitted'", "var k = x.k, shape = k === 'never'")
m('map_bearing_defaulted', "if (!m || !has(m, id)) return null;", "if (!m || !has(m, id)) return 0;")
# ---- filters: two dimensions, presentation only --------------------------------------------------------------------------------------------------------
m('type_chip_label_is_key', "return reg && isObj(reg[k]) && !reg[k].isFacility ? txt(reg[k].label) : (seen[k] ? seen[k].label : '');", 'return k;')  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('type_chip_count_wrong', "return chip('type', k, label, seen[k] ? seen[k].n : 0, false);", "return chip('type', k, label, current.length, false);")
m('all_chip_not_pressed', "var types = chip('type', 'all', 'All', current.length, true)", "var types = chip('type', 'all', 'All', current.length, false)")
m('filter_ignores_type', "(state.type === 'all' || it.getAttribute('data-da-type') === state.type)", "true", [BROWSER])
m('filter_ignores_stage', "(state.stage === 'all' || it.getAttribute('data-da-stage') === state.stage)", "true", [BROWSER])
m('filter_deletes_cards', "if (on) it.removeAttribute('hidden'); else it.setAttribute('hidden', '');", "if (!on && it.parentNode) it.parentNode.removeChild(it);", [BROWSER])
m('filter_aria_pressed_stale', "for (var m = 0; m < same.length; m++) same[m].setAttribute('aria-pressed', same[m] === b ? 'true' : 'false');", "", [BROWSER])
m('mount_does_not_enhance', "    el.innerHTML = html(response, opts);\n    enhance(el);", "    el.innerHTML = html(response, opts);", [BROWSER])
m('css_hidden_not_enforced', "    '.da-rv [hidden]{display:none!important}',\n", "", [BROWSER])
# ---- header, hero and history wording ----------------------------------------------------------------------------------------------------------------------
m('brokerage_dropped', "var who = [opts.brokerage, opts.agent]", "var who = [opts.agent]")
m('generated_date_dropped', "(day(report.as_of) ? '<p class=\"da-rv-gen\">' + esc('Generated ' + day(report.as_of)) + '</p>' : '')", "''")
m('history_claims_no_change_before_ready', 'return cov.change_ready === true;', 'return true;')  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
# ---- actions: in place, inert, never promising "coming" ------------------------------------------------------------------------------------------------------
m('actions_made_live', "'<button type=\"button\" class=\"da-rv-act\" aria-disabled=\"true\">'", "'<button type=\"button\" class=\"da-rv-act\">'")
m('actions_say_coming_soon', '(soon ? \'<span class="da-rv-soon">Available soon</span>\' : \'\')', '(soon ? \'<span class="da-rv-soon">Coming soon</span>\' : \'\')')  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('action_dropped', "var ACTIONS = ['Compare property', 'Watch property', 'Share report', 'Download PDF'];", "var ACTIONS = ['Compare property', 'Watch property', 'Share report'];")


# ---- the final layout (2026-10-09): header, briefing, ONE three-column table, one evidence block, the map, history, evidence, actions -----------------------
m('row_name_not_escaped', '<span class="da-rv-name">\' + esc(titleOf(p)) + \'</span>', '<span class="da-rv-name">\' + titleOf(p) + \'</span>')
m('address_not_escaped', "esc(subject ? displayAddress(subject) : NO_ADDRESS)", "(subject ? displayAddress(subject) : NO_ADDRESS)")
m('address_placeholder_dropped', "esc(subject ? displayAddress(subject) : NO_ADDRESS)", "esc(displayAddress(subject))")
m('limitation_not_escaped', "lims.map(function (t) { return '<li>' + esc(t) + '</li>'; })", "lims.map(function (t) { return '<li>' + t + '</li>'; })")
m('attribution_not_escaped', "'<p class=\"da-rv-attr\">' + esc(att) + '</p>'", "'<p class=\"da-rv-attr\">' + att + '</p>'")
m('type_label_not_escaped', "'<span class=\"da-rv-sub da-rv-sub--type\">' + esc(type) + '</span>'", "'<span class=\"da-rv-sub da-rv-sub--type\">' + type + '</span>'")
m('row_type_dropped', "(type ? '<span class=\"da-rv-sub da-rv-sub--type\">'", "(false ? '<span class=\"da-rv-sub da-rv-sub--type\">'")
m('row_map_number_dropped', "n !== '' ? 'Map ' + n : ''].filter(Boolean)", "''].filter(Boolean)")
m('row_distance_dropped', "var where = [dist ? dist + (dir ? ' ' + dir : '') : '',", "var where = ['',")
m('row_agency_stage_dropped', "(pstage ? '<span class=\"da-rv-sub\">Agency stage: '", "(false ? '<span class=\"da-rv-sub\">Agency stage: '")
m('stale_warning_dropped', "(rd && rd.old ? '<span class=\"da-rv-sub da-rv-stale\"", "(false && rd.old ? '<span class=\"da-rv-sub da-rv-stale\"")
m('stale_warning_on_every_row', "(rd && rd.old ? '<span class=\"da-rv-sub da-rv-stale\"", "(rd ? '<span class=\"da-rv-sub da-rv-stale\"")
m('decided_impact_dropped', "if (isDecided(p)) return { kind: 'denied_or_withdrawn', text: QOL_DECIDED };", "")
m('impact_ignores_type', "var k = typeKeyOf(p);\n    return has(QOL_BY_TYPE, k)", "var k = 'civic';\n    return has(QOL_BY_TYPE, k)")
m('source_link_shows_address', "'\" target=\"_blank\" rel=\"noopener noreferrer\">Official source '", "'\" target=\"_blank\" rel=\"noopener noreferrer\">' + esc(href) + ' '")
m('evidence_repeats_impact', "      + (att ? '<p class=\"da-rv-attr\">'", "      + line('Impact', qolImpact(p).text)\n      + (att ? '<p class=\"da-rv-attr\">'")
m('evidence_status_dropped', "      + (status ? line(STATUS_LABEL, status) : '')\n      + (dc ?", "      + (dc ?")
m('unstaged_row_not_filterable', "'<tr role=\"row\" data-da-type=\"' + esc(typeKeyOf(p)) + '\" data-da-stage=\"' + (k || 'none') + '\">'", "'<tr role=\"row\"' + (k ? ' data-da-type=\"' + esc(typeKeyOf(p)) + '\" data-da-stage=\"' + k + '\"' : '') + '>'", [BROWSER])
m('two_tables', "var items = [];\n    STAGES.forEach(function (k) { m.staged[k].forEach(function (p) { items.push({ p: p, k: k }); }); });", "var items = [];\n    STAGES.forEach(function (k) { m.staged[k].forEach(function (p) { items.push({ p: p, k: k }); items.push({ p: p, k: k }); }); });")
m('records_before_briefing', "    if (m.total) parts.push(briefing(report, m, response));\n    if (!some) parts.push(outcomeSection(report));\n    if (m.total) parts.push(filtersSection(current.concat(m.operating, m.unstaged), m));\n    if (m.total) parts.push(recordsSection(m, response, opts.showLifecycle === true));", "    if (m.total) parts.push(recordsSection(m, response, opts.showLifecycle === true));\n    if (m.total) parts.push(briefing(report, m, response));\n    if (!some) parts.push(outcomeSection(report));\n    if (m.total) parts.push(filtersSection(current.concat(m.operating, m.unstaged), m));")
m('history_before_map', "    if (current.length) parts.push(mapSection(m.numbered, response, report));\n    if (some) parts.push(historySection(history, report));", "    if (some) parts.push(historySection(history, report));\n    if (current.length) parts.push(mapSection(m.numbered, response, report));")
m('briefing_claims_change_without_history', "if (m.changed.length) items.push(", "if (true) items.push(")
m('briefing_none_recorded_without_ledger', "else if (changeReady(report)) items.push(", "else if (true) items.push(")
m('briefing_stale_count_dropped', "if (nOld) items.push(", "if (false) items.push(")
m('briefing_caution_dropped', "+ '<p class=\"da-rv-p da-rv-quiet\" data-da-caution>' + esc(BRIEFING_CAUTION) + '</p>';", "+ '';")
m('address_recased_when_mixed', "if (a !== a.toUpperCase() && a !== a.toLowerCase()) return a;", "")
m('brokerage_agent_invented', "var who = [opts.brokerage, opts.agent].map(", "var who = [opts.brokerage || 'HomeSignal Realty', opts.agent].map(")
m('print_white_background_dropped', "    'html,body{background:#fff!important}',\n", "", [BROWSER])
m('print_page_number_dropped', "@bottom-right{content:\"Page \" counter(page) \" of \" counter(pages);", "@bottom-right{content:\"\";", [BROWSER])
m('print_row_split_allowed', ".da-rv-sec--map,.da-rv-table tr{break-inside:avoid;page-break-inside:avoid}", ".da-rv-sec--map{break-inside:avoid;page-break-inside:avoid}", [BROWSER])
m('print_header_not_repeated', "'.da-rv-table thead{display:table-header-group}',", "'.da-rv-table thead{display:table-row-group}',", [BROWSER])
m('print_url_hidden', "'.da-rv-url{display:block;font-size:10px;", "'.da-rv-url{display:none;font-size:10px;", [BROWSER])
m('print_evidence_collapsed', "'.da-rv-detail>.da-rv-sum{display:none}.da-rv-detail::details-content{content-visibility:visible;display:block}',", "", [BROWSER])


def first_failure(out):
    for ln in out.splitlines():
        if ln.startswith('FAIL'):
            return ln[:150]
    return None


# ---- the report's outcome (founder ruling R5, 2026-10-02): "No development activity" vs "No data ingested" ---------------------------------------
m('outcome_from_the_label_text', "return a && typeof a.outcome === 'string' && has(OUTCOMES, a.outcome) ? a.outcome : '';", "return a && typeof a.label === 'string' ? (a.label === 'No development activity' ? 'NO_DEVELOPMENT_ACTIVITY' : 'NO_DATA_INGESTED') : '';")  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('outcome_shown_over_projects', "    if (!o || report.projects.length !== 0) return '';", "    if (!o) return '';")  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('outcome_inferred_from_an_empty_list', "return a && typeof a.outcome === 'string' && has(OUTCOMES, a.outcome) ? a.outcome : '';", "return a && typeof a.outcome === 'string' && has(OUTCOMES, a.outcome) ? a.outcome : 'NO_DATA_INGESTED';")  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('empty_report_claims_no_activity', "    var o = OUTCOMES[key], body = o.body;", "    key = 'NO_DEVELOPMENT_ACTIVITY'; var o = OUTCOMES[key], body = o.body;")
m('outcome_titles_swapped', "      title: 'No data ingested',", "      title: 'No development activity',")
m('no_data_ingested_explanation_dropped', 'return section(\'outcome\', o.title, \'<p class="da-rv-p da-rv-outcome-p">\' + esc(o.body) + \'</p>\', \'da-rv-hero\');', "return section('outcome', o.title, '', 'da-rv-hero');")  # re-anchored 2026-10-07 (audit fix 10): the anchor no longer matched the shipped code
m('outcome_block_not_rendered', "    if (!some) parts.push(outcomeSection(report));\n", "")
m('outcome_radius_invented', "' within ' + r + (r === 1 ? ' mile' : ' miles') + ' of this property.' : ' near this property.';", "' within ' + r + (r === 1 ? ' mile' : ' miles') + ' of this property.' : ' within 0.5 miles of this property.';")
m('outcome_text_not_readable', "    '.da-rv-outcome-p{font-size:16px;max-width:65ch}',", "    '.da-rv-outcome-p{font-size:11px;max-width:65ch}',", [BROWSER])

def run_tests(tests):
    """-> (passed, which, first failing line). Stops at the first failing suite."""
    for t in tests:
        r = subprocess.run(['node', str(ROOT / t)], cwd=ROOT, capture_output=True, text=True, timeout=600)
        out = r.stdout + r.stderr
        if 'SyntaxError' in out:
            return None, t, 'SyntaxError: ' + next((ln for ln in out.splitlines() if 'SyntaxError' in ln), '')[:120]
        if r.returncode != 0:
            return False, t, first_failure(out) or ('exit %d: %s' % (r.returncode, (r.stderr.strip().splitlines() or ['no output'])[-1][:120]))
    return True, None, None


def main():
    only = set(sys.argv[1:])
    unknown = only - set(M)
    if unknown:
        print('HARNESS — unknown mutation(s): ' + ', '.join(sorted(unknown)))
        return 2
    p = ROOT / MOD
    original = p.read_text()
    ok, which, line = run_tests(NODE_TESTS + [BROWSER])
    if not ok:
        print('HARNESS — the unmutated tree does not pass %s (%s)' % (which, line))
        return 2
    survived, harness = [], []
    names = [k for k in M if not only or k in only]
    try:
        for name in names:
            old, new, tests = M[name]
            text = original
            if old == new or text.count(old) != 1:
                print('HARNESS  %-40s anchor matched %d times' % (name, text.count(old)))
                harness.append(name)
                continue
            mutated = text.replace(old, new)
            if mutated == text:
                print('HARNESS  %-40s did not change the file' % name)
                harness.append(name)
                continue
            p.write_text(mutated)
            passed, which, line = run_tests(tests)
            p.write_text(original)
            if passed is None:
                print('HARNESS  %-40s %s' % (name, line))
                harness.append(name)
            elif passed:
                print('SURVIVED %-40s (ran %s)' % (name, ', '.join(Path(t).name for t in tests)))
                survived.append(name)
            else:
                print('killed   %-40s by %s: %s' % (name, Path(which).name, line))
    finally:
        p.write_text(original)
    print('\n%d mutation(s): %d killed, %d survived, %d harness fault(s)' % (len(names), len(names) - len(survived) - len(harness), len(survived), len(harness)))
    if (ROOT / MOD).read_text() != original:
        print('HARNESS — the module was not restored')
        return 2
    return 2 if harness else (1 if survived else 0)


if __name__ == '__main__':
    sys.exit(main())
