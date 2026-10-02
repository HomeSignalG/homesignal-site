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
m('change_hero_from_publisher_date',
  "var changed = pick(sec.what_changed_recently).filter(function (p) { return detected(p).length > 0; });",
  "var changed = pick(sec.what_changed_recently).filter(function (p) { return detected(p).length > 0 || publisherEvent(p) !== null; });")
m('change_hero_from_section_list_alone',
  "var changed = pick(sec.what_changed_recently).filter(function (p) { return detected(p).length > 0; });",
  "var changed = pick(sec.what_changed_recently);")
m('hero_unit_is_projects', "Counted as official records.", "Counted as projects.")
m('hero_unit_note_dropped', '<p class="da-rv-unit">Counted as official records.</p>', '')
m('hero_counts_oldest_event', "return eventLabel(detected(p)[0].event_type);", "return eventLabel(detected(p)[detected(p).length - 1].event_type);")
m('most_recent_is_last', "var first = list[0], recent = recentOf(first);", "var first = list[list.length - 1], recent = recentOf(first);")
m('publisher_event_filed_as_change', "line('Official record', eventText(pe.label, pe.date))", "line('HomeSignal detected', eventText(pe.label, pe.date))")
m('detected_date_is_publisher_date', "line('HomeSignal detected', eventText(eventLabel(dc.event_type), day(dc.detected_at)))",
  "line('HomeSignal detected', eventText(eventLabel(dc.event_type), day(dc.publisher_event && dc.publisher_event.date)))")
m('card_shows_oldest_change', "dc = detected(p)[0];\n    if (pe) out +=", "dc = detected(p)[detected(p).length - 1];\n    if (pe) out +=")
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
m('type_chip_dropped', "if (t) out += '<span class=\"da-rv-tag da-rv-type\">'", "if (false) out += '<span class=\"da-rv-tag da-rv-type\">'")
m('type_shown_as_key', "return isObj(p.type) ? txt(p.type.label) : ''; }", "return isObj(p.type) ? txt(p.type.key) : ''; }")
# ---- nothing internal reaches the page ------------------------------------------------------------------------------------------------------
m('render_source_family', "+ (status ? line('Publisher status', status) : '') + eventLines(p)", "+ (status ? line('Publisher status', status) : '') + line('Source', p.source_family) + eventLines(p)")
m('render_storage_blockers', "parts.join('') + '</article>'", "parts.join('') + esc(JSON.stringify(response.storage_blockers)) + '</article>'")
m('render_limitation_code', "return txt(l.text); }", "return txt(l.code) + ' ' + txt(l.text); }")
m('attribution_falls_back_to_family', "attribution = txt(s.attribution), out = '';", "attribution = txt(s.attribution) || txt(p.source_family), out = '';")
m('record_id_in_markup', "'<article class=\"da-rv-card\">", "'<article class=\"da-rv-card\" data-id=\"' + esc(p.project_id) + '\">")
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
m('title_not_escaped', "<h3 class=\"da-rv-title\">' + esc(titleOf(p)) + '</h3>' + tagRow(p, response)", "<h3 class=\"da-rv-title\">' + titleOf(p) + '</h3>' + tagRow(p, response)", [BEHAVIOUR, STRUCTURE, BROWSER])
m('line_value_not_escaped', "':</span> ' + esc(text) + '</p>'", "':</span> ' + text + '</p>'")
m('address_not_escaped', "esc(subject || NO_ADDRESS)", "(subject || NO_ADDRESS)")
m('limitation_not_escaped', "return '<li>' + esc(t) + '</li>'; }", "return '<li>' + t + '</li>'; }")
m('attribution_not_escaped', "'<p class=\"da-rv-attr\">' + esc(attribution) + '</p>'", "'<p class=\"da-rv-attr\">' + attribution + '</p>'")
m('change_values_not_escaped', "esc(fieldLabel(c.field) + ': ' + value(c.from) + ' → ' + value(c.to))", "(fieldLabel(c.field) + ': ' + value(c.from) + ' → ' + value(c.to))")
m('type_label_not_escaped', "out += '<span class=\"da-rv-tag da-rv-type\">' + esc(t) + '</span>';", "out += '<span class=\"da-rv-tag da-rv-type\">' + t + '</span>';")
# ---- links ------------------------------------------------------------------------------------------------------------------------------------------------
m('javascript_url_accepted', "return s.length <= 2000 && HTTP_URL.test(s) ? s : '';", "return s.length <= 2000 && /^[a-z]+:/i.test(s) ? s : '';")
m('ftp_url_accepted', "var HTTP_URL = /^https?:\\/\\/", "var HTTP_URL = /^(https?|ftp):\\/\\/")
m('url_whitespace_allowed', "[^\\s\"'<>`\\\\]+$/i;", "[^\"'<>`\\\\]+$/i;")
m('url_quote_allowed', "[^\\s\"'<>`\\\\]+$/i;", "[^\\s<>`\\\\]+$/i;")
m('link_without_noopener', "target=\"_blank\" rel=\"noopener noreferrer\">Official source ", "target=\"_blank\">Official source ")
m('link_url_unvalidated', "var href = safeHref(s.url),", "var href = txt(s.url),")
m('link_name_loses_record', " for ' + esc(titleOf(p)) + ' (opens in a new tab)</span>", " (opens in a new tab)</span>")
# ---- the address ------------------------------------------------------------------------------------------------------------------------------------------
m('address_in_href', "esc(EYEBROW) + '</p><p class=\"da-rv-addr\">'", "esc(EYEBROW) + '</p><a href=\"https://example.gov/?q=' + encodeURIComponent(subject) + '\">x</a><p class=\"da-rv-addr\">'")
m('address_in_data_attribute', "'<header class=\"da-rv-head\">", "'<header class=\"da-rv-head\" data-subject=\"' + esc(subject) + '\">")
m('address_in_aria_label', "'<header class=\"da-rv-head\">", "'<header class=\"da-rv-head\" aria-label=\"' + esc(subject) + '\">")
m('address_placeholder_dropped', "esc(subject || NO_ADDRESS)", "esc(subject)")
# ---- purity: no network, storage, location, clock, ranking, dynamic code -----------------------------------------------------------------------------
m('adds_a_fetch', "    if (!renderable(response)) return '';\n    opts = isObj(opts)", "    if (typeof fetch === 'function') { try { fetch('/x'); } catch (e) { void e; } }\n    if (!renderable(response)) return '';\n    opts = isObj(opts)")
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
m('css_card_min_width_fixed', "minmax(min(100%,260px),1fr)", "minmax(420px,1fr)", [BROWSER])
m('css_link_not_tappable', ".da-rv-link{display:inline-block;padding:8px 0;", ".da-rv-link{", [BROWSER])
m('css_low_contrast_proposed', "--rv-amber:#8a5200;", "--rv-amber:#e0a050;", [BROWSER])
m('css_screen_reader_text_visible', ".da-rv-sr{position:absolute;", ".da-rv-sr{position:static;", [BROWSER])
m('css_empty_report_not_prominent', "'.da-rv--empty .da-rv-lims{font-size:16px;font-weight:600}',", "'.da-rv--empty .da-rv-lims{}',", [BROWSER])


# ---- the 100526 layout (build step 3): section order, the three stages, and what each section may claim -----------------------------------
m('swap_two_sections', "var STAGES = ['approved', 'proposed', 'permitted'];", "var STAGES = ['proposed', 'approved', 'permitted'];")
m('permitted_stage_dropped', "var STAGES = ['approved', 'proposed', 'permitted'];", "var STAGES = ['approved', 'proposed'];")
m('hero_after_activity',
  "    if (changed.length) parts.push(changedSection(changed, response, inStage, tail));\n    if (activity.length) parts.push(activitySection(activity, response, inStage, !changed.length, changed.length ? '' : tail));",
  "    if (activity.length) parts.push(activitySection(activity, response, inStage, !changed.length, changed.length ? '' : tail));\n    if (changed.length) parts.push(changedSection(changed, response, inStage, tail));")
m('activity_never_hero', "activitySection(activity, response, inStage, !changed.length, changed.length ? '' : tail)", "activitySection(activity, response, inStage, false, changed.length ? '' : tail)")
m('history_before_stages',
  "    if (some) STAGES.forEach(function (k) { parts.push(stageSection(k, staged[k], response, nums)); });\n    if (some) parts.push(historySection(history, report));",
  "    if (some) parts.push(historySection(history, report));\n    if (some) STAGES.forEach(function (k) { parts.push(stageSection(k, staged[k], response, nums)); });")
m('map_after_stages',
  "    if (current.length) parts.push(mapSection(numbered, response, report));\n    if (some) STAGES.forEach(",
  "    if (some) STAGES.forEach(function (k) { parts.push(stageSection(k, staged[k], response, nums)); });\n    if (current.length) parts.push(mapSection(numbered, response, report));\n    if (false) STAGES.forEach(")
m('review_after_map',
  "    if (review.length) parts.push(reviewSection(review, response, stageFor));\n    if (current.length) parts.push(mapSection(numbered, response, report));",
  "    if (current.length) parts.push(mapSection(numbered, response, report));\n    if (review.length) parts.push(reviewSection(review, response, stageFor));")
m('filters_after_review',
  "    if (current.length) parts.push(filtersSection(current, stageFor));\n    if (review.length) parts.push(reviewSection(review, response, stageFor));",
  "    if (review.length) parts.push(reviewSection(review, response, stageFor));\n    if (current.length) parts.push(filtersSection(current, stageFor));")
m('actions_before_evidence', "    parts.push(evidenceSection(report));\n    if (some) parts.push(actionsBar());", "    if (some) parts.push(actionsBar());\n    parts.push(evidenceSection(report));")
m('history_shown_when_empty', "    if (some) parts.push(historySection(history, report));", "    parts.push(historySection(history, report));")
m('stages_on_empty_report', "    if (some) STAGES.forEach(function (k) {", "    STAGES.forEach(function (k) {")
m('actions_on_empty_report', "    if (some) parts.push(actionsBar());", "    parts.push(actionsBar());")
m('empty_stage_hidden', "parts.push(stageSection(k, staged[k], response, nums)); });", "if (staged[k].length) parts.push(stageSection(k, staged[k], response, nums)); });")
m('empty_stage_note_dropped', ": '<p class=\"da-rv-p da-rv-quiet\">No projects at this stage in this report.</p>')", ": '')")
m('absence_claim_added', "    parts.push(evidenceSection(report));\n    if (some) parts.push(actionsBar());",
  "    if (!some) parts.push('<p>No development activity found near this address.</p>');\n    parts.push(evidenceSection(report));\n    if (some) parts.push(actionsBar());")
m('empty_report_unmarked', "(some ? '' : ' da-rv--empty')", "''")
m('permitted_title_changed', "permitted: 'Permitted / Under Construction',", "permitted: 'Under Construction',")
# ---- the stage is the ENGINE's; the view never re-derives it ----------------------------------------------------------------------------
m('stage_rederived_from_lifecycle', "function stageKey(p) { var k = isObj(p.stage) ? p.stage.key : '';", "function stageKey(p) { var k = lifeKey(p);")
m('stage_key_not_cross_checked', "return !stageFor[p.project_id] && (legacy || stageKey(p) === k); });", "return !stageFor[p.project_id]; });")
m('operating_listed_in_stage_section',
  "staged[k] = pick(byStage[k]).filter(function (p) { return !stageFor[p.project_id] && (legacy || stageKey(p) === k); });",
  "staged[k] = pick(k === 'approved' && isObj(sec.by_lifecycle) ? arr(byStage[k]).concat(arr(sec.by_lifecycle.operating)) : byStage[k]).filter(function (p) { return !stageFor[p.project_id]; });")
m('project_in_two_stages', "return !stageFor[p.project_id] && (legacy", "return (legacy")
m('sorts_stage_cards', "      staged[k] = pick(byStage[k]).filter(", "      staged[k] = pick(byStage[k]).sort(function (a, b) { return titleOf(a) < titleOf(b) ? -1 : 1; }).filter(")
m('stage_label_from_lifecycle', "function stageLabelOf(p, k) { return (isObj(p.stage) && p.stage.key === k ? txt(p.stage.label) : '') || TITLES[k] || ''; }",
  "function stageLabelOf(p, k) { return lifeLabel(p); }")
m('stage_badge_replaced_by_lifecycle', "var out = k ? stageBadge(p, k) : lifeBadge(p);", "var out = lifeBadge(p);")
m('proposed_shape_equals_approved',
  "  var SHAPES = {\n    approved: SVG_OPEN + '<circle cx=\"7\" cy=\"7\" r=\"5.5\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"1.5\"/></svg>',\n    proposed: SVG_OPEN + '<circle cx=\"7\" cy=\"7\" r=\"5.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-dasharray=\"3 2.5\"/></svg>',",
  "  var SHAPES = {\n    approved: SVG_OPEN + '<circle cx=\"7\" cy=\"7\" r=\"5.5\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"1.5\"/></svg>',\n    proposed: SVG_OPEN + '<circle cx=\"7\" cy=\"7\" r=\"5.5\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"1.5\"/></svg>',")
m('proposed_stage_shape_equals_approved',
  "  var STAGE_SHAPES = {\n    approved: SVG_OPEN + '<circle cx=\"7\" cy=\"7\" r=\"5.5\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"1.5\"/></svg>',\n    proposed: SVG_OPEN + '<circle cx=\"7\" cy=\"7\" r=\"5.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-dasharray=\"3 2.5\"/></svg>',",
  "  var STAGE_SHAPES = {\n    approved: SVG_OPEN + '<circle cx=\"7\" cy=\"7\" r=\"5.5\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"1.5\"/></svg>',\n    proposed: SVG_OPEN + '<circle cx=\"7\" cy=\"7\" r=\"5.5\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"1.5\"/></svg>',")
# ---- a stage card shows the stage, the lifecycle and the publisher's own words, each labelled ------------------------------------------------
m('publisher_status_dropped', "+ (status ? line('Publisher status', status) : '') + eventLines(p)", "+ eventLines(p)")
m('stage_card_status_dropped', "      + (status ? line('Publisher status', status) : '')\n      + (ev", "      + (ev")
m('publisher_status_replaced_by_lifecycle', "      + (status ? line('Publisher status', status) : '')\n      + (ev", "      + (status ? line('Publisher status', lifeLabel(p)) : '')\n      + (ev")
m('stage_card_lifecycle_dropped', "      + line('HomeSignal lifecycle', lifeLabel(p))\n", "")
m('publisher_stage_dropped', "      + (pstage ? line('Publisher stage', pstage) : '')\n", "")
m('why_line_dropped', "(ev ? line('Why it is in this section',", "(false ? line('Why it is in this section',")
m('why_line_without_evidence', "var ev = isObj(p.stage) && p.stage.key === k ? txt(p.stage.evidence) : '';", "var ev = 'Permit issued';")
m('first_detected_is_publisher_date', "function firstDetected(p) { return isObj(p.homesignal_observation) ? day(p.homesignal_observation.first_observed_at) : ''; }",
  "function firstDetected(p) { var pe = publisherEvent(p); return pe ? pe.date : ''; }")
m('render_hold', "      + eventLines(p) + sourceBlock(p) + '</article>';", "      + eventLines(p) + (p.rights ? line('Rights', p.rights) : '') + sourceBlock(p) + '</article>';")
m('render_observation_counts', "      + eventLines(p) + sourceBlock(p) + '</article>';",
  "      + eventLines(p) + (p.homesignal_observation ? line('Observed', p.homesignal_observation.observation_count) : '') + sourceBlock(p) + '</article>';")
m('stage_card_type_attr_from_label', "'<article class=\"da-rv-card\" data-da-type=\"' + esc(typeKeyOf(p))", "'<article class=\"da-rv-card\" data-da-type=\"' + esc(typeLabel(p))")
# ---- Things to Review: the engine's list, a neutral prompt, never a prediction ----------------------------------------------------------------
m('review_from_view_not_engine', "var review = pick(isObj(response.render) ? response.render.review : null)", "var review = current.slice(0, 3)")
m('review_reversed', ".filter(function (p) { return !!stageFor[p.project_id]; });\n    var history", ".filter(function (p) { return !!stageFor[p.project_id]; }).reverse();\n    var history")
m('review_includes_unstaged', "var review = pick(isObj(response.render) ? response.render.review : null).filter(function (p) { return !!stageFor[p.project_id]; });",
  "var review = pick(isObj(response.render) ? response.render.review : null);")
m('review_prompt_predicts', "permitted: 'The published construction timing and project details.'", "permitted: 'Expect construction noise and traffic near the property.'")
m('review_disclaimer_dropped', "+ '<p class=\"da-rv-p da-rv-quiet\">\"Review\" means the official record is worth reading with your client. It is not a prediction of any effect on the property.</p>');", "+ '');")
m('review_without_source', "+ sourceBlock(p) + '</li>';\n    }).join('');\n    return section('review'", "+ '</li>';\n    }).join('');\n    return section('review'")
# ---- the map: response-only positions, to scale, numbered like the cards, no basemap -----------------------------------------------------------------
m('distance_without_render', "  function distanceOf(response, id) {\n    var r = isObj(response.render) ? response.render : null;",
  "  function distanceOf(response, id) {\n    var r = isObj(response.render) ? response.render : { distances_mi: { 'k-approved': 0.2 } };")
m('map_invents_positions', "if (d === null || b === null) return;", "if (d === null) d = 0.25; if (b === null) b = 0;")
m('map_drawn_with_nothing', "    if (!drawn) return '';\n", "")
m('map_not_to_scale', "var rr = Math.min(d / radius, 1) * R,", "var rr = R * 0.6,")
m('map_north_flipped', "py = C - rr * Math.cos(rad);", "py = C + rr * Math.cos(rad);")
m('map_number_off_by_one', "'<text class=\"da-rv-mnum\" text-anchor=\"middle\" dy=\"4\">' + x.n + '</text></g>'", "'<text class=\"da-rv-mnum\" text-anchor=\"middle\" dy=\"4\">' + (x.n + 1) + '</text></g>'")
m('card_map_number_dropped', "if (num) out += '<span class=\"da-rv-tag da-rv-num\">Map ' + num + '</span>';", "")
m('map_permitted_drawn_as_circle', "var k = x.k, shape = k === 'permitted'", "var k = x.k, shape = k === 'never'")
m('map_basemap_added', "var svg = '<svg class=\"da-rv-plot\" viewBox=\"0 0 360 360\" role=\"img\"", "var svg = '<img src=\"https://tile.openstreetmap.org/15/0/0.png\" alt=\"\"><svg class=\"da-rv-plot\" viewBox=\"0 0 360 360\" role=\"img\"")
m('map_bearing_defaulted', "if (!m || !has(m, id)) return null;", "if (!m || !has(m, id)) return 0;")
m('map_caption_dropped', "+ '<p class=\"da-rv-p da-rv-quiet\">Only tracked development activity is shown. Distance is to scale; direction is approximate for roads and areas. The numbers match the project cards below.</p>');", "+ '');")
# ---- filters: two dimensions, presentation only --------------------------------------------------------------------------------------------------------
m('type_chip_label_is_key', "var label = reg && isObj(reg[k]) && !reg[k].isFacility ? txt(reg[k].label) : (seen[k] ? seen[k].label : '');", "var label = k;")
m('type_chip_count_wrong', "return chip('type', k, label, seen[k] ? seen[k].n : 0, false);", "return chip('type', k, label, current.length, false);")
m('stage_chip_count_wrong', "current.filter(function (p) { return stageFor[p.project_id] === k; }).length, false);", "current.length, false);")
m('all_chip_not_pressed', "var types = chip('type', 'all', 'All', current.length, true)", "var types = chip('type', 'all', 'All', current.length, false)")
m('filter_note_dropped', "+ '<p class=\"da-rv-p da-rv-quiet\">The filters change what is shown on the map and in the three stage sections. They do not change the report.</p>');", "+ '');")
m('filter_ignores_type', "(state.type === 'all' || it.getAttribute('data-da-type') === state.type)", "true", [BROWSER])
m('filter_ignores_stage', "(state.stage === 'all' || it.getAttribute('data-da-stage') === state.stage)", "true", [BROWSER])
m('filter_deletes_cards', "if (on) it.removeAttribute('hidden'); else it.setAttribute('hidden', '');", "if (!on && it.parentNode) it.parentNode.removeChild(it);", [BROWSER])
m('filter_aria_pressed_stale', "for (var m = 0; m < same.length; m++) same[m].setAttribute('aria-pressed', same[m] === b ? 'true' : 'false');", "", [BROWSER])
m('filter_nomatch_never_shown', "if (cards.length && !shown) note.removeAttribute('hidden');", "if (false) note.removeAttribute('hidden');", [BROWSER])
m('mount_does_not_enhance', "    el.innerHTML = html(response, opts);\n    enhance(el);", "    el.innerHTML = html(response, opts);", [BROWSER])
m('css_hidden_not_enforced', "    '.da-rv [hidden]{display:none!important}',\n", "", [BROWSER])
# ---- header, hero and history wording ----------------------------------------------------------------------------------------------------------------------
m('brokerage_dropped', "var who = [opts.brokerage, opts.agent]", "var who = [opts.agent]")
m('generated_date_dropped', "(day(report.as_of) ? '<p class=\"da-rv-gen\">' + esc('Generated ' + day(report.as_of)) + '</p>' : '')", "''")
m('quiet_hero_claims_area', "'<p class=\"da-rv-unit\">Among the official records in this report.</p>'", "'<p class=\"da-rv-unit\">No development activity in this area.</p>'")
m('stage_summary_wrong_count', "+ staged.permitted.length + ' permitted / under construction", "+ staged.approved.length + ' permitted / under construction")
m('history_claims_no_change_before_ready', "var msg = cov.change_ready === true", "var msg = true")
# ---- actions: in place, inert, never promising "coming" ------------------------------------------------------------------------------------------------------
m('actions_made_live', "'<button type=\"button\" class=\"da-rv-act\" aria-disabled=\"true\">'", "'<button type=\"button\" class=\"da-rv-act\">'")
m('actions_say_coming_soon', "'<span class=\"da-rv-soon\">Available soon</span></nav>'", "'<span class=\"da-rv-soon\">Coming soon</span></nav>'")
m('action_dropped', "var ACTIONS = ['Compare property', 'Watch property', 'Share report', 'Download PDF'];", "var ACTIONS = ['Compare property', 'Watch property', 'Share report'];")


def first_failure(out):
    for ln in out.splitlines():
        if ln.startswith('FAIL'):
            return ln[:150]
    return None


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
