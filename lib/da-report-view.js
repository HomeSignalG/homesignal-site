// da-report-view.js — THE DEVELOPMENT ACTIVITY REPORT, AS A CUSTOMER SEES IT (Development Activity plan, Order I, step 1).
//
// WHAT THIS FILE IS. A pure presentation module: the national report engine's own response goes in, escaped HTML comes out, in
// the approved section order, showing only the sections that have data. It is a VIEW. It adds no data, makes no network or
// storage call, and has NO CALLER: no page loads it and nothing links to it (docs/development-activity-report-view-2026-10-02.md).
//
//   response  = what the national Development Activity report engine returns (the edge function named in the design doc):
//               { status, coverage_state, report, render, stored, report_id, storable, storage_blockers }
//   opts      = { subject: "<the address, as the caller wants it displayed>" }   (optional)
//   html()    = the report as a string, every value escaped
//   mount()   = html() into an element, plus this module's own stylesheet, once
//
// WHAT IT DECIDES, AND WHAT IT DOES NOT. It decides only HOW a fact is shown. Every fact already has an owner and the view asks
// that owner's answer, as the engine gave it, and re-decides nothing:
//   which records are in the report, and in which section ... _shared/national-report.ts assemble() (sections, by_lifecycle)
//   a record's Type ............................................ lib/project-type.js, through the engine (type.label)
//   a record's lifecycle ....................................... lib/project-type.js, through the engine (lifecycle.key, .label)
//   whether something changed .................................. the change ledger, through the engine (homesignal_detected_changes)
//   whether a source may appear ................................ the engine's rights gate (a record is simply absent)
//   how far away a record is ................................... the spatial read, through the engine (render.distances_mi)
// So this file contains no Type rule, no lifecycle rule, no change rule, no rights rule, no ranking, and no geography.
//
// WHAT IT NEVER SHOWS (plan lines 685-696, "Internal Information Must Not Render on Client Reports"). It does not read, and so cannot
// render, the keys that carry internal state; test/da-report-view-structure.test.mjs fails if this file starts to read one. A
// publisher date is never called a HomeSignal change. An empty customer view says what the engine says about coverage, and names the
// engine's own outcome for it (founder ruling R5, 2026-10-02): "No data ingested" whenever HomeSignal cannot prove its data is coming
// in, and "No development activity" ONLY when the engine says so. The view never decides which (plan hard rule 66).
//
// THE ADDRESS. The caller supplies the address to display, and it appears as TEXT in one place only. It is never written into an href,
// a data-* attribute, an id, a class or a URL, and this file reads no URL, storage or private-context state.
//
// LOAD ORDER: none. It needs only `window`. When a page first loads it, add lib/da-report-view.js to CONTENT_KEYED in
// test/lib-cache-keys.test.mjs in the same change (the page tag carries ?v=<content hash>).
(function (root) {
  'use strict';
  var HS = root.HS = root.HS || {};

  // ── the words the plan and the rulings give us, quoted ─────────────────────────────────────────────────────────────────
  var EYEBROW = 'HOMESIGNAL DEVELOPMENT ACTIVITY';                       // ruling R6
  var TITLES = {                                                          // 100526 plan, ruling 3 and the visual layout contract
    changed: 'What Changed Around This Property',
    activity: 'Recent Official Activity',
    filters: 'Type and stage',
    review: 'Things to Review With Your Client',
    map: 'Development Activity Map',
    approved: 'Approved / Coming',
    proposed: 'Proposed / Under Review',
    permitted: 'Permitted / Under Construction',
    history: 'Change History',
    evidence: 'Official evidence & coverage',
    actions: 'Report actions'
  };
  // The three stage sections, in the plan's order (ruling 3). The keys are the engine's (`sections.by_stage`).
  var STAGES = ['approved', 'proposed', 'permitted'];
  // The review line for a project, by its stage. Wording from the plan's own examples ("Things to Review"); it is a prompt to look,
  // never a prediction of an effect.
  var REVIEW_PROMPTS = {
    approved: 'Published project details and construction timing.',
    proposed: 'The application and the agency\'s schedule.',
    permitted: 'The published construction timing and project details.'
  };
  // The Type chips, in the plan's order. Only the ORDER is held here; each chip's label is the canonical Type authority's
  // (lib/project-type.js, through HS.projectType when the page loads it, otherwise the label the engine put on a record).
  var TYPE_CHIP_ORDER = ['residential', 'commercial', 'industrial', 'datacenter', 'infrastructure', 'civic', 'other'];
  var ACTIONS = ['Compare property', 'Watch property', 'Share report', 'Download PDF'];
  // plan lines 1763 (disclosure), 1261 and 1265 (scope)
  var DISCLOSURE = 'HomeSignal summarizes selected official public records available to its covered sources. It may not include every project or change and is not a substitute for independent property, municipal, title, zoning, legal, inspection, or other professional due diligence.';
  var SCOPE_LINE = 'Planned, approved, permitted and changing development found in HomeSignal\'s covered official sources.';
  var SCOPE_NOTE = 'This report focuses on development activity and change. It is not an inventory of existing schools, parks, businesses, buildings, or neighborhood amenities.';
  // What a report with no projects says, keyed by the ENGINE's outcome (report.activity.outcome; founder ruling R5, 2026-10-02,
  // docs/development-activity-founder-ruling-r5-2026-10-02.md). The titles are the founder's words. The view never decides the outcome:
  // it shows the engine's, and only when the report really carries no projects.
  var OUTCOMES = {
    NO_DATA_INGESTED: {
      title: 'No data ingested',
      body: 'HomeSignal cannot yet confirm it receives official development records for this address, so this report cannot say whether there is development nearby. It is not a finding that there is no development.'
    },
    NO_DEVELOPMENT_ACTIVITY: {
      title: 'No development activity',
      body: 'HomeSignal\'s official development records for this address are coming in, and they show no development'
    }
  };
  var NO_ADDRESS = 'Address unavailable';                                 // contract §5: a purged report shows the address as unavailable
  var NO_NAME = 'Unnamed record';
  var NOT_STATED = 'not stated';

  // The ledger's own event vocabulary (a CHECK constraint in docs/dev-change-ledger.sql). A value outside it is never shown raw.
  var EVENT_LABELS = {
    first_detected: 'First detected by HomeSignal',
    status_changed: 'Status changed',
    source_record_updated: 'Source record updated'
  };
  var EVENT_UNKNOWN = 'Change detected';
  // The 14 facts the ledger judges a change on (docs/dev-change-ledger.sql dev_change_facts), in plain words.
  var FIELD_LABELS = {
    name: 'Project name', type: 'HomeSignal Type', type_raw: 'Publisher type', status: 'Status', stage: 'Publisher stage',
    date_kind: 'Publisher event', submitted_at: 'Publisher event date', address: 'Address', start_date: 'Start date',
    end_date: 'End date', developer: 'Developer', size: 'Size', investment: 'Investment', source_ref: 'Official source'
  };

  // A lifecycle is shown as TEXT and as a SHAPE, never colour alone (plan lines 586-590). The shapes differ in outline and fill, so
  // they read in greyscale: solid circle, dashed hollow circle, solid square, hollow diamond. They are decoration (aria-hidden); the
  // text beside them is the meaning. The keys are the four the engine can send; anything else is drawn as the last.
  var SVG_OPEN = '<svg class="da-rv-shape" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false">';
  var SHAPES = {
    approved: SVG_OPEN + '<circle cx="7" cy="7" r="5.5" fill="currentColor" stroke="currentColor" stroke-width="1.5"/></svg>',
    proposed: SVG_OPEN + '<circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2.5"/></svg>',
    operating: SVG_OPEN + '<rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" stroke="currentColor" stroke-width="1.5"/></svg>',
    unknown: SVG_OPEN + '<path d="M7 1.5 12.5 7 7 12.5 1.5 7Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
  };

  // A STAGE is drawn with its own shape so the map, the cards and the filters agree, and it reads in greyscale: solid circle approved,
  // dashed hollow circle proposed, solid square permitted / under construction (the landing page's sample uses the same three).
  var STAGE_SHAPES = {
    approved: SVG_OPEN + '<circle cx="7" cy="7" r="5.5" fill="currentColor" stroke="currentColor" stroke-width="1.5"/></svg>',
    proposed: SVG_OPEN + '<circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2.5"/></svg>',
    permitted: SVG_OPEN + '<rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" stroke="currentColor" stroke-width="1.5"/></svg>'
  };

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // http or https, no whitespace, no quote, no angle bracket, no backslash. Anything else is not linked (plan: only an official http(s) link).
  var HTTP_URL = /^https?:\/\/[^\s"'<>`\\]+$/i;

  // ── small pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function txt(v) { return (typeof v === 'string' || typeof v === 'number') ? String(v).trim() : ''; }
  /** '2026-09-25' or '2026-09-25T10:00:00Z' -> 'Sep 25, 2026'. A value that is not a calendar-shaped day gives ''. No clock, no locale. */
  function day(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(typeof v === 'string' ? v : '');
    if (!m) return '';
    var mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return MONTHS[mo - 1] + ' ' + d + ', ' + m[1];
  }
  /** The ONE place a URL is accepted for an href. */
  function safeHref(u) {
    var s = typeof u === 'string' ? u.trim() : '';
    return s.length <= 2000 && HTTP_URL.test(s) ? s : '';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ── reading one project, exactly as the engine gave it ────────────────────────────────────────────────────────────────────
  function titleOf(p) { return txt(p.name) || NO_NAME; }
  function lifeKey(p) { var k = isObj(p.lifecycle) ? p.lifecycle.key : ''; return typeof k === 'string' && has(SHAPES, k) ? k : 'unknown'; }
  function lifeLabel(p) { return (isObj(p.lifecycle) ? txt(p.lifecycle.label) : '') || 'Lifecycle unknown'; }
  function typeLabel(p) { return isObj(p.type) ? txt(p.type.label) : ''; }
  /** The publisher's own event, as the engine labelled it. */
  function publisherEvent(p) {
    var e = p.publisher_event;
    if (!isObj(e) || !txt(e.label)) return null;
    return { label: txt(e.label), date: day(e.date) };
  }
  /** HomeSignal-detected changes, newest first, in the order the engine gave them (the view sorts nothing). */
  function detected(p) { return arr(p.homesignal_detected_changes).filter(isObj); }
  function eventLabel(t) { return typeof t === 'string' && has(EVENT_LABELS, t) ? EVENT_LABELS[t] : EVENT_UNKNOWN; }
  function fieldLabel(f) {
    if (typeof f !== 'string' || !f) return 'Field';
    if (has(FIELD_LABELS, f)) return FIELD_LABELS[f];
    var s = f.replace(/_/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Field';
  }
  function value(v) {
    if (v === null || v === undefined) return NOT_STATED;
    if (typeof v === 'string') return v.trim() ? v : NOT_STATED;
    return (typeof v === 'number' || typeof v === 'boolean') ? String(v) : NOT_STATED;
  }
  /** Distance from the subject: only when THIS response carries it (render is never stored, so a reopened report has none). */
  function distanceOf(response, id) {
    var r = isObj(response.render) ? response.render : null;
    var m = r && isObj(r.distances_mi) ? r.distances_mi : null;
    if (!m || !has(m, id)) return '';
    var n = m[id];
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
    return n < 0.1 ? 'Under 0.1 mi' : n.toFixed(1) + ' mi';
  }

  /** The stage the engine gave a record ('approved' | 'proposed' | 'permitted'), or '' when it is in no stage section. */
  function stageKey(p) { var k = isObj(p.stage) ? p.stage.key : ''; return typeof k === 'string' && has(STAGE_SHAPES, k) ? k : ''; }
  function stageLabelOf(p, k) { return (isObj(p.stage) && p.stage.key === k ? txt(p.stage.label) : '') || TITLES[k] || ''; }
  /** The canonical Type key, used ONLY to match a record to the Type filter it was given; the view decides nothing with it. */
  function typeKeyOf(p) { var k = isObj(p.type) ? p.type.key : ''; return typeof k === 'string' && /^[a-z]+$/.test(k) ? k : 'other'; }
  /** The map's direction for a record, when THIS response carries it (response-only, like distance). */
  function bearingOf(response, id) {
    var r = isObj(response.render) ? response.render : null;
    var m = r && isObj(r.bearings_deg) ? r.bearings_deg : null;
    if (!m || !has(m, id)) return null;
    var n = m[id];
    return typeof n === 'number' && isFinite(n) ? n : null;
  }
  function milesOf(response, id) {
    var r = isObj(response.render) ? response.render : null;
    var m = r && isObj(r.distances_mi) ? r.distances_mi : null;
    var n = m && has(m, id) ? m[id] : null;
    return typeof n === 'number' && isFinite(n) && n >= 0 ? n : null;
  }
  /** When HomeSignal first observed the record (the change ledger's first observation), or ''. */
  function firstDetected(p) { return isObj(p.homesignal_observation) ? day(p.homesignal_observation.first_observed_at) : ''; }

  // ── fragments ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function lifeBadge(p) {
    var k = lifeKey(p);
    return '<span class="da-rv-life da-rv-life--' + k + '" data-lifecycle="' + k + '">' + SHAPES[k]
      + '<span class="da-rv-lifetext">' + esc(lifeLabel(p)) + '</span></span>';
  }
  function stageBadge(p, k) {
    return '<span class="da-rv-stage da-rv-stage--' + k + '" data-stage="' + k + '">' + STAGE_SHAPES[k]
      + '<span class="da-rv-lifetext">' + esc(stageLabelOf(p, k)) + '</span></span>';
  }
  function tagRow(p, response, num, k) {
    var out = k ? stageBadge(p, k) : lifeBadge(p);
    var t = typeLabel(p);
    if (t) out += '<span class="da-rv-tag da-rv-type">' + esc(t) + '</span>';
    var d = distanceOf(response, p.project_id);
    if (d) out += '<span class="da-rv-tag da-rv-dist">' + esc(d) + '</span>';
    if (num) out += '<span class="da-rv-tag da-rv-num">Map ' + num + '</span>';
    return '<div class="da-rv-tags">' + out + '</div>';
  }
  function line(label, text) {
    return '<p class="da-rv-line"><span class="da-rv-k">' + esc(label) + ':</span> ' + esc(text) + '</p>';
  }
  function eventText(label, date) { return date ? label + ' · ' + date : label; }
  function sourceBlock(p) {
    var s = isObj(p.source) ? p.source : {};
    var href = safeHref(s.url), attribution = txt(s.attribution), out = '';
    if (href) {
      out += '<p class="da-rv-src"><a class="da-rv-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">Official source '
        + '<span aria-hidden="true">→</span><span class="da-rv-sr"> for ' + esc(titleOf(p)) + ' (opens in a new tab)</span></a></p>';
    }
    if (attribution) out += '<p class="da-rv-attr">' + esc(attribution) + '</p>';
    return out;
  }
  /** The newest official event and the newest detected change, each under its own label. A publisher date is never filed as a change. */
  function eventLines(p) {
    var out = '', pe = publisherEvent(p), dc = detected(p)[0];
    if (pe) out += line('Official record', eventText(pe.label, pe.date));
    if (dc) out += line('HomeSignal detected', eventText(eventLabel(dc.event_type), day(dc.detected_at)));
    return out;
  }
  /** A summary-row card (hero): the lifecycle, as before. */
  function card(p, response) {
    var status = txt(p.publisher_status);
    return '<article class="da-rv-card"><h3 class="da-rv-title">' + esc(titleOf(p)) + '</h3>' + tagRow(p, response)
      + (status ? line('Publisher status', status) : '') + eventLines(p) + sourceBlock(p) + '</article>';
  }
  /** A stage-section card: the stage first (the customer's presentation state), then the canonical lifecycle and the publisher's own words. */
  function stageCard(p, response, num, k) {
    var status = txt(p.publisher_status), pstage = txt(p.publisher_stage), first = firstDetected(p);
    var ev = isObj(p.stage) && p.stage.key === k ? txt(p.stage.evidence) : '';
    return '<article class="da-rv-card" data-da-type="' + esc(typeKeyOf(p)) + '" data-da-stage="' + k + '">'
      + '<h3 class="da-rv-title">' + esc(titleOf(p)) + '</h3>' + tagRow(p, response, num, k)
      + line('HomeSignal lifecycle', lifeLabel(p))
      + (pstage ? line('Publisher stage', pstage) : '')
      + (status ? line('Publisher status', status) : '')
      + (ev ? line('Why it is in this section', 'The publisher\'s stage says ' + ev.toLowerCase() + '.') : '')
      + (first ? line('First detected by HomeSignal', first) : '')
      + eventLines(p) + sourceBlock(p) + '</article>';
  }
  function metric(n, label) { return '<div class="da-rv-metric"><b>' + n + '</b><span>' + esc(label) + '</span></div>'; }
  function section(key, label, inner, cls) {
    return '<section class="da-rv-sec da-rv-sec--' + key + (cls ? ' ' + cls : '') + '" aria-label="' + esc(label) + '"><h2 class="da-rv-h2">'
      + esc(label) + '</h2>' + inner + '</section>';
  }
  /** "On the record within 0.5 miles: 2 permitted / under construction · 1 approved / coming · 0 proposed / under review." */
  function stageSummary(report, staged) {
    var r = report.radius_mi;
    var where = typeof r === 'number' && isFinite(r) && r > 0 ? ' within ' + r + (r === 1 ? ' mile' : ' miles') : '';
    return '<p class="da-rv-onrecord">' + esc('On the record' + where + ': '
      + staged.permitted.length + ' permitted / under construction · ' + staged.approved.length + ' approved / coming · '
      + staged.proposed.length + ' proposed / under review.') + '</p>';
  }

  // ── sections ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Counts of OFFICIAL RECORDS (a source_key is a source record, not a proven real-world project), grouped in the engine's own order. */
  function tally(list, labelOf) {
    var order = [], n = Object.create(null);
    list.forEach(function (p) {
      var l = labelOf(p);
      if (!(l in n)) { n[l] = 0; order.push(l); }
      n[l]++;
    });
    return order.map(function (l) { return metric(n[l], l); }).join('');
  }
  /** A summary of what the engine put in this section: counts, the most recent record, and a row for any record no stage section carries. */
  function summarySection(key, list, response, inStage, hero, labelOf, recentOf, tail) {
    var first = list[0], recent = recentOf(first);
    var rows = list.filter(function (p) { return !inStage[p.project_id]; }).map(function (p) { return card(p, response); }).join('');
    var inner = '<div class="da-rv-metrics">' + tally(list, labelOf) + '</div><p class="da-rv-unit">Counted as official records.</p>'
      + '<p class="da-rv-recent">' + esc('Most recent: ' + (typeLabel(first) ? typeLabel(first) + ' — ' : '') + titleOf(first)
        + (distanceOf(response, first.project_id) ? ' · ' + distanceOf(response, first.project_id) : '') + (recent ? ' · ' + recent : '')) + '</p>'
      + (tail || '') + (rows ? '<div class="da-rv-cards">' + rows + '</div>' : '');
    return section(key, TITLES[key], inner, hero ? 'da-rv-hero' : '');
  }
  function changedSection(list, response, inStage, tail) {
    return summarySection('changed', list, response, inStage, true,
      function (p) { return eventLabel(detected(p)[0].event_type); },
      function (p) {
        var d = detected(p)[0], pe = publisherEvent(p);
        return eventLabel(d.event_type) + (day(d.detected_at) ? ', detected ' + day(d.detected_at) : '')
          + (pe ? ' · Official record: ' + eventText(pe.label, pe.date) : '');
      }, tail);
  }
  function activitySection(list, response, inStage, hero, tail) {
    return summarySection('activity', list, response, inStage, hero,
      function (p) { return publisherEvent(p).label; },
      function (p) { var pe = publisherEvent(p); return pe.date ? pe.label + ' ' + pe.date : pe.label; }, tail);
  }
  /** The hero when nothing is recent: a measured zero over the records in this report, never a claim about the whole area. */
  function quietHero(report, tail) {
    var days = report.recent_days;
    var span = typeof days === 'number' && isFinite(days) && days > 0 ? 'in the last ' + days + ' days' : 'recently';
    return section('activity', TITLES.activity, '<div class="da-rv-metrics">' + metric(0, 'New official records ' + span) + '</div>'
      + '<p class="da-rv-unit">Among the official records in this report.</p>' + (tail || ''), 'da-rv-hero');
  }
  /** The engine's outcome for an EMPTY report, in fixed words. Null for a report with projects, an unknown outcome, or no outcome
   *  (an older response): the view never infers one from the empty list. */
  function outcomeSection(report) {
    var a = isObj(report.activity) ? report.activity : null;
    var key = a && typeof a.outcome === 'string' && has(OUTCOMES, a.outcome) ? a.outcome : '';
    if (!key || report.projects.length !== 0) return '';
    var o = OUTCOMES[key], body = o.body;
    if (key === 'NO_DEVELOPMENT_ACTIVITY') {
      var r = report.radius_mi;
      body += typeof r === 'number' && isFinite(r) && r > 0 ? ' within ' + r + (r === 1 ? ' mile' : ' miles') + ' of this property.' : ' near this property.';
    }
    return section('outcome', o.title, '<p class="da-rv-p da-rv-outcome-p">' + esc(body) + '</p>', 'da-rv-hero');
  }
  function chip(dim, value, label, count, pressed) {
    return '<button type="button" class="da-rv-chip" data-da-filter="' + dim + '" data-da-value="' + esc(value) + '" aria-pressed="' + (pressed ? 'true' : 'false') + '">'
      + esc(label) + (count === null ? '' : ' <span class="da-rv-chipn">' + count + '</span>') + '</button>';
  }
  /** Type and Stage, two separate controls. They change what is SHOWN, never the report. */
  function filtersSection(current, stageFor) {
    var reg = root.HS && root.HS.projectType && isObj(root.HS.projectType.CATEGORY_REGISTRY) ? root.HS.projectType.CATEGORY_REGISTRY : null;
    var seen = Object.create(null);
    current.forEach(function (p) { var k = typeKeyOf(p); if (!seen[k]) seen[k] = { n: 0, label: typeLabel(p) }; seen[k].n++; });
    var types = chip('type', 'all', 'All', current.length, true) + TYPE_CHIP_ORDER.map(function (k) {
      var label = reg && isObj(reg[k]) && !reg[k].isFacility ? txt(reg[k].label) : (seen[k] ? seen[k].label : '');
      if (!label || (k === 'other' && !seen[k])) return '';
      return chip('type', k, label, seen[k] ? seen[k].n : 0, false);
    }).join('');
    var stages = chip('stage', 'all', 'All', current.length, true) + STAGES.map(function (k) {
      return chip('stage', k, TITLES[k], current.filter(function (p) { return stageFor[p.project_id] === k; }).length, false);
    }).join('');
    return section('filters', TITLES.filters,
      '<div class="da-rv-frow"><span class="da-rv-flab" aria-hidden="true">Type</span><div class="da-rv-chips" role="group" aria-label="Type">' + types + '</div></div>'
      + '<div class="da-rv-frow"><span class="da-rv-flab" aria-hidden="true">Stage</span><div class="da-rv-chips" role="group" aria-label="Stage">' + stages + '</div></div>'
      + '<p class="da-rv-p da-rv-quiet">The filters change what is shown on the map and in the three stage sections. They do not change the report.</p>');
  }
  /** The engine's own list, nearest first (render.review). The view ranks nothing. */
  function reviewSection(list, response, stageFor) {
    var items = list.map(function (p) {
      var k = stageFor[p.project_id];
      var meta = [distanceOf(response, p.project_id), typeLabel(p), stageLabelOf(p, k).toUpperCase()].filter(Boolean).join(' · ');
      var pstage = txt(p.publisher_stage), pe = publisherEvent(p);
      var fact = pstage ? 'Publisher stage: ' + pstage + '.' : (pe ? 'Official record: ' + eventText(pe.label, pe.date) + '.' : '');
      return '<li class="da-rv-rev"><p class="da-rv-revmeta">' + esc(meta) + '</p><h3 class="da-rv-title">' + esc(titleOf(p)) + '</h3>'
        + (fact ? '<p class="da-rv-p">' + esc(fact) + '</p>' : '')
        + '<p class="da-rv-p"><span class="da-rv-k">Review:</span> ' + esc(REVIEW_PROMPTS[k]) + '</p>'
        + sourceBlock(p) + '</li>';
    }).join('');
    return section('review', TITLES.review, '<ol class="da-rv-revlist">' + items + '</ol>'
      + '<p class="da-rv-p da-rv-quiet">"Review" means the official record is worth reading with your client. It is not a prediction of any effect on the property.</p>');
  }
  /** A plain diagram: the property in the centre, the report radius as a ring, each staged project at its distance (to scale) and
   *  direction (approximate for a road or an area). No street map: no basemap is cleared for paid use. */
  function mapSection(numbered, response, report) {
    var R = 150, C = 180, radius = typeof report.radius_mi === 'number' && report.radius_mi > 0 ? report.radius_mi : 0.5;
    var marks = '', drawn = 0, used = [];
    numbered.forEach(function (x) {
      var d = milesOf(response, x.p.project_id), b = bearingOf(response, x.p.project_id);
      if (d === null || b === null) return;
      var rr = Math.min(d / radius, 1) * R, rad = b * Math.PI / 180;
      var px = C + rr * Math.sin(rad), py = C - rr * Math.cos(rad);
      used.forEach(function (u) { if (Math.abs(u[0] - px) < 9 && Math.abs(u[1] - py) < 9) { px += 11; } });
      used.push([px, py]);
      var k = x.k, shape = k === 'permitted'
        ? '<rect x="-8" y="-8" width="16" height="16" rx="3" class="da-rv-mshape"/>'
        : '<circle r="9" class="da-rv-mshape"' + (k === 'proposed' ? ' stroke-dasharray="4 3"' : '') + '/>';
      marks += '<g class="da-rv-mk da-rv-mk--' + k + '" data-da-type="' + esc(typeKeyOf(x.p)) + '" data-da-stage="' + k + '" transform="translate('
        + px.toFixed(1) + ' ' + py.toFixed(1) + ')"><title>' + esc(x.n + ': ' + titleOf(x.p) + ' · ' + stageLabelOf(x.p, k)) + '</title>' + shape
        + '<text class="da-rv-mnum" text-anchor="middle" dy="4">' + x.n + '</text></g>';
      drawn++;
    });
    if (!drawn) return '';
    var ring = function (frac, label) {
      return '<circle cx="' + C + '" cy="' + C + '" r="' + (R * frac) + '" class="da-rv-ring"/><text x="' + (C + 4) + '" y="' + (C - R * frac - 4) + '" class="da-rv-ringlab">' + esc(label) + '</text>';
    };
    var svg = '<svg class="da-rv-plot" viewBox="0 0 360 360" role="img" aria-label="' + esc('Map of development activity within ' + radius + ' miles of the property, ' + drawn + ' marked') + '">'
      + ring(1, radius + ' mi') + ring(0.5, (radius / 2) + ' mi') + '<text x="' + C + '" y="14" text-anchor="middle" class="da-rv-ringlab">N</text>'
      + '<circle cx="' + C + '" cy="' + C + '" r="7" class="da-rv-home"/><text x="' + C + '" y="' + (C + 22) + '" text-anchor="middle" class="da-rv-homelab">Property</text>'
      + marks + '</svg>';
    var legend = '<ul class="da-rv-legend"><li><span class="da-rv-lhome" aria-hidden="true"></span>Property</li>' + STAGES.map(function (k) {
      return '<li class="da-rv-stage--' + k + '">' + STAGE_SHAPES[k] + esc(TITLES[k]) + '</li>';
    }).join('') + '</ul>';
    return section('map', TITLES.map, '<div class="da-rv-mapwrap">' + svg + legend + '</div>'
      + '<p class="da-rv-p da-rv-quiet">Only tracked development activity is shown. Distance is to scale; direction is approximate for roads and areas. The numbers match the project cards below.</p>');
  }
  function stageSection(key, list, response, nums) {
    var cards = list.map(function (p) { return stageCard(p, response, nums[p.project_id], key); }).join('');
    return section(key, TITLES[key],
      '<p class="da-rv-count">' + esc(plural(list.length, 'official record', 'official records')) + '</p>'
      + (list.length ? '<div class="da-rv-cards">' + cards + '</div>' : '<p class="da-rv-p da-rv-quiet">No projects at this stage in this report.</p>')
      + '<p class="da-rv-p da-rv-quiet da-rv-nomatch" hidden>No projects in this section match the filters.</p>');
  }
  /** Two labelled lanes per record, never merged: what the publisher says, and what HomeSignal detected. */
  function historySection(list, report) {
    if (!list.length) {
      var cov = isObj(report.coverage) ? report.coverage : {};
      var days = typeof report.recent_days === 'number' && report.recent_days > 0 ? report.recent_days : null;
      var msg = cov.change_ready === true
        ? 'HomeSignal recorded no status change for the projects in this report' + (days ? ' in the last ' + days + ' days.' : '.')
        : 'Change history begins once HomeSignal has observed these records at least twice.';
      return section('history', TITLES.history, '<p class="da-rv-p">' + esc(msg) + '</p>');
    }
    var items = list.map(function (p) {
      var pe = publisherEvent(p), dc = detected(p), lanes = '';
      if (pe) lanes += '<div class="da-rv-lane"><h4 class="da-rv-h4">Official record</h4><p class="da-rv-p">' + esc(eventText(pe.label, pe.date)) + '</p></div>';
      if (dc.length) {
        lanes += '<div class="da-rv-lane"><h4 class="da-rv-h4">HomeSignal detected</h4><ul class="da-rv-ul">' + dc.map(function (e) {
          var changes = arr(e.changes).filter(isObj).map(function (c) {
            return '<li>' + esc(fieldLabel(c.field) + ': ' + value(c.from) + ' → ' + value(c.to)) + '</li>';
          }).join('');
          return '<li><span class="da-rv-ev">' + esc(eventText(eventLabel(e.event_type), day(e.detected_at) ? 'detected ' + day(e.detected_at) : '')) + '</span>'
            + (changes ? '<ul class="da-rv-ul da-rv-ul--in">' + changes + '</ul>' : '') + '</li>';
        }).join('') + '</ul></div>';
      }
      return '<li class="da-rv-hist"><h3 class="da-rv-title">' + esc(titleOf(p)) + '</h3>' + lifeBadge(p) + lanes + '</li>';
    }).join('');
    return section('history', TITLES.history, '<ol class="da-rv-histlist">' + items + '</ol>');
  }
  /** The engine's own limitation text, verbatim, then the standard scope and disclosure. Never a claim about what is NOT there. */
  function evidenceSection(report) {
    var cov = isObj(report.coverage) ? report.coverage : {};
    var lims = arr(cov.limitations).filter(isObj).map(function (l) { return txt(l.text); }).filter(Boolean);
    var recentDays = report.recent_days, asOf = day(report.as_of);
    var inner = (lims.length ? '<ul class="da-rv-lims">' + lims.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '')
      + (typeof recentDays === 'number' && isFinite(recentDays) && recentDays > 0 && asOf
        ? '<p class="da-rv-p">' + esc('Recent means the last ' + recentDays + ' days before ' + asOf + '.') + '</p>' : '')
      + '<p class="da-rv-p">' + esc(SCOPE_LINE) + '</p><p class="da-rv-p da-rv-quiet">' + esc(SCOPE_NOTE) + '</p>'
      + '<p class="da-rv-p da-rv-quiet">' + esc(DISCLOSURE) + '</p>';
    return section('evidence', TITLES.evidence, inner);
  }
  /** Compare, Watch, Share and PDF: shown in the plan's place, inert until those features exist (build steps 8-10). "Available soon",
   *  not "coming soon": the word "coming" is reserved for the Approved / Coming stage (a proposed item never reads as coming). */
  function actionsBar() {
    return '<nav class="da-rv-actions" aria-label="' + esc(TITLES.actions) + '">' + ACTIONS.map(function (a) {
      return '<button type="button" class="da-rv-act" aria-disabled="true">' + esc(a) + '</button>';
    }).join('') + '<span class="da-rv-soon">Available soon</span></nav>';
  }
  function header(report, opts) {
    var subject = typeof opts.subject === 'string' ? opts.subject.trim() : '';
    var label = typeof opts.label === 'string' ? opts.label.trim() : '';
    var who = [opts.brokerage, opts.agent].map(function (v) { return typeof v === 'string' ? v.trim() : ''; }).filter(Boolean).join(' · ');
    var bits = [];
    if (typeof report.radius_mi === 'number' && isFinite(report.radius_mi) && report.radius_mi > 0) {
      bits.push('Within ' + report.radius_mi + (report.radius_mi === 1 ? ' mile' : ' miles'));
    }
    if (typeof report.zip === 'string' && /^\d{5}$/.test(report.zip)) bits.push('ZIP ' + report.zip);
    if (day(report.as_of)) bits.push('As of ' + day(report.as_of));
    var side = (who ? '<p class="da-rv-who">' + esc(who) + '</p>' : '') + (day(report.as_of) ? '<p class="da-rv-gen">' + esc('Generated ' + day(report.as_of)) + '</p>' : '');
    return '<header class="da-rv-head"><div class="da-rv-headmain"><p class="da-rv-eyebrow">' + esc(EYEBROW) + '</p><p class="da-rv-addr">' + esc(subject || NO_ADDRESS) + '</p>'
      + (label ? '<p class="da-rv-label">' + esc(label) + '</p>' : '')
      + (bits.length ? '<p class="da-rv-meta">' + esc(bits.join(' · ')) + '</p>' : '') + '</div>'
      + (side ? '<div class="da-rv-side">' + side + '</div>' : '') + '</header>';
  }

  // ── the report ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Whether the response carries a report to show. ADDRESS_NOT_RESOLVED and OUTSIDE_COVERAGE carry none: the caller owns those messages. */
  function renderable(response) {
    return isObj(response) && response.status === 'OK' && isObj(response.report)
      && Array.isArray(response.report.projects) && isObj(response.report.sections);
  }

  function html(response, opts) {
    if (!renderable(response)) return '';
    opts = isObj(opts) ? opts : {};
    var report = response.report, sec = report.sections;
    // national-2 responses carry by_stage; an older response has only by_lifecycle, whose approved and proposed lists stand in for the
    // first two stages (it has no Permitted / Under Construction). Either way the record's stage is the list the ENGINE put it in.
    var legacy = !isObj(sec.by_stage), byStage = legacy ? (isObj(sec.by_lifecycle) ? { approved: sec.by_lifecycle.approved, proposed: sec.by_lifecycle.proposed } : {}) : sec.by_stage;
    var byId = Object.create(null);
    report.projects.forEach(function (p) { if (isObj(p) && typeof p.project_id === 'string') byId[p.project_id] = p; });
    /** The projects an engine list names, in the engine's order, once each; an id the report does not carry is skipped. */
    function pick(ids) {
      var seen = Object.create(null), out = [];
      arr(ids).forEach(function (id) { if (typeof id === 'string' && byId[id] && !seen[id]) { seen[id] = true; out.push(byId[id]); } });
      return out;
    }
    var changed = pick(sec.what_changed_recently).filter(function (p) { return detected(p).length > 0; });
    var activity = pick(sec.recent_official_activity).filter(function (p) { return publisherEvent(p) !== null; });
    var staged = {}, stageFor = Object.create(null), numbered = [], nums = Object.create(null), current = [];
    STAGES.forEach(function (k) {
      staged[k] = pick(byStage[k]).filter(function (p) { return !stageFor[p.project_id] && (legacy || stageKey(p) === k); });
      staged[k].forEach(function (p) { stageFor[p.project_id] = k; current.push(p); numbered.push({ n: numbered.length + 1, p: p, k: k }); nums[p.project_id] = numbered.length; });
    });
    var inStage = stageFor;
    var review = pick(isObj(response.render) ? response.render.review : null).filter(function (p) { return !!stageFor[p.project_id]; });
    var history = pick(arr(sec.what_changed_recently).concat(arr(sec.recent_official_activity))).filter(function (p) {
      return detected(p).length > 0 || publisherEvent(p) !== null;
    });
    var some = report.projects.length > 0;
    var tail = current.length ? stageSummary(report, staged) : '';

    var parts = [header(report, opts)];
    if (!some) parts.push(outcomeSection(report));
    if (changed.length) parts.push(changedSection(changed, response, inStage, tail));
    if (activity.length) parts.push(activitySection(activity, response, inStage, !changed.length, changed.length ? '' : tail));
    if (!changed.length && !activity.length && some) parts.push(quietHero(report, tail));
    if (current.length) parts.push(filtersSection(current, stageFor));
    if (review.length) parts.push(reviewSection(review, response, stageFor));
    if (current.length) parts.push(mapSection(numbered, response, report));
    if (some) STAGES.forEach(function (k) { parts.push(stageSection(k, staged[k], response, nums)); });
    if (some) parts.push(historySection(history, report));
    parts.push(evidenceSection(report));
    if (some) parts.push(actionsBar());
    return '<article class="da-rv' + (some ? '' : ' da-rv--empty') + '" aria-label="HomeSignal Development Activity report">' + parts.join('') + '</article>';
  }

  /** The Type and Stage filters: pure presentation. Shows and hides cards and map markers that carry data-da-type / data-da-stage. */
  function enhance(el) {
    if (!el || !el.querySelectorAll) return;
    var state = { type: 'all', stage: 'all' };
    function apply() {
      var items = el.querySelectorAll('[data-da-stage]');
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var on = (state.type === 'all' || it.getAttribute('data-da-type') === state.type) && (state.stage === 'all' || it.getAttribute('data-da-stage') === state.stage);
        if (on) it.removeAttribute('hidden'); else it.setAttribute('hidden', '');
      }
      var secs = el.querySelectorAll('.da-rv-sec--approved, .da-rv-sec--proposed, .da-rv-sec--permitted');
      for (var j = 0; j < secs.length; j++) {
        var cards = secs[j].querySelectorAll('.da-rv-card'), shown = 0;
        for (var c = 0; c < cards.length; c++) if (!cards[c].hasAttribute('hidden')) shown++;
        var note = secs[j].querySelector('.da-rv-nomatch');
        if (note) { if (cards.length && !shown) note.removeAttribute('hidden'); else note.setAttribute('hidden', ''); }
      }
    }
    var chips = el.querySelectorAll('.da-rv-chip');
    for (var k = 0; k < chips.length; k++) {
      chips[k].addEventListener('click', function (ev) {
        var b = ev.currentTarget, dim = b.getAttribute('data-da-filter');
        state[dim] = b.getAttribute('data-da-value');
        var same = el.querySelectorAll('.da-rv-chip[data-da-filter="' + dim + '"]');
        for (var m = 0; m < same.length; m++) same[m].setAttribute('aria-pressed', same[m] === b ? 'true' : 'false');
        apply();
      });
    }
  }

  // ── presentation ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  // Scoped to .da-rv, built from app.css tokens with fallbacks so it also stands alone. Nothing here can touch another page.
  var CSS = [
    '.da-rv{--rv-ink:var(--ink,#16211c);--rv-ink2:var(--ink-2,#4a5a52);--rv-line:var(--line,#e4e8e4);--rv-green:var(--green,#157a49);',
    '--rv-deep:var(--green-deep,#0f5c37);--rv-tint:var(--green-tint,#e9f5ee);--rv-amber:#8a5200;--rv-grey:#4a5a52;',
    'max-width:100%;min-width:0;box-sizing:border-box;background:#fff;border:1px solid var(--rv-line);border-radius:15px;padding:24px 26px;',
    'color:var(--rv-ink);font-family:var(--font,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);',
    'font-size:15px;line-height:1.55;overflow-wrap:anywhere}',
    '.da-rv *,.da-rv *::before,.da-rv *::after{box-sizing:border-box}',
    '.da-rv p,.da-rv h2,.da-rv h3,.da-rv h4,.da-rv ul,.da-rv ol{margin:0}',
    '.da-rv-head{padding-bottom:16px}',
    '.da-rv-eyebrow{font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--rv-deep)}',
    '.da-rv-addr{font-size:19px;font-weight:700;letter-spacing:-.01em;margin:6px 0 2px!important}',
    '.da-rv-meta{font-size:13.5px;color:var(--rv-ink2)}',
    '.da-rv-sec{padding:20px 0;border-top:1px solid var(--rv-line)}',
    '.da-rv-h2{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--rv-ink2);margin:0 0 12px!important}',
    '.da-rv-hero .da-rv-h2{font-size:14px;color:var(--rv-ink)}',
    '.da-rv-metrics{display:flex;flex-wrap:wrap;gap:12px 36px}',
    '.da-rv-metric b{display:block;font-size:30px;letter-spacing:-.02em;line-height:1.1}',
    '.da-rv-metric span{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--rv-ink2)}',
    '.da-rv-unit,.da-rv-count,.da-rv-quiet{font-size:13px;color:var(--rv-ink2)}',
    '.da-rv-unit{margin-top:6px!important}',
    '.da-rv-count{margin-bottom:10px!important}',
    '.da-rv-recent{font-size:14px;margin:12px 0 0!important}',
    '.da-rv-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:12px;margin-top:14px}',
    '.da-rv-count+.da-rv-cards{margin-top:0}',
    '.da-rv-card{min-width:0;border:1px solid var(--rv-line);border-radius:12px;padding:14px 15px}',
    '.da-rv-title{font-size:15px;font-weight:700;letter-spacing:-.01em;margin:0 0 8px!important}',
    '.da-rv-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:0 0 8px}',
    '.da-rv-life{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;border-radius:999px;padding:3px 10px;border:1px solid currentColor}',
    '.da-rv-shape{flex:none}',
    '.da-rv-life--approved{color:var(--rv-deep);background:var(--rv-tint)}',
    '.da-rv-life--proposed{color:var(--rv-amber);background:#fff;border-style:dashed}',
    '.da-rv-life--operating{color:#fff;background:var(--rv-deep);border-color:var(--rv-deep)}',
    '.da-rv-life--unknown{color:var(--rv-grey);background:#f4f6f4}',
    '.da-rv-tag{font-size:12.5px;font-weight:600;border:1px solid var(--rv-line);border-radius:999px;padding:3px 10px;color:var(--rv-ink2)}',
    '.da-rv-line,.da-rv-p{font-size:13.5px;color:var(--rv-ink2);margin:0 0 4px!important}',
    '.da-rv-k{font-weight:700;color:var(--rv-ink)}',
    '.da-rv-src{margin:2px 0 0!important}',
    '.da-rv-attr{font-size:12.5px;color:var(--rv-ink2);margin:4px 0 0!important}',
    '.da-rv-link{display:inline-block;padding:8px 0;color:var(--rv-deep);font-weight:700;text-decoration:underline}',
    '.da-rv a:focus-visible{outline:3px solid var(--rv-green);outline-offset:2px;border-radius:3px}',
    '.da-rv-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '.da-rv-histlist{list-style:none;padding:0;display:grid;gap:14px}',
    '.da-rv-hist{min-width:0;border:1px solid var(--rv-line);border-radius:12px;padding:14px 15px}',
    '.da-rv-lane{margin-top:10px}',
    '.da-rv-h4{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--rv-ink2);margin:0 0 4px!important}',
    '.da-rv-ul{padding-left:18px;font-size:13.5px;color:var(--rv-ink2)}',
    '.da-rv-ul--in{margin-top:2px}',
    '.da-rv-ev{font-weight:600;color:var(--rv-ink)}',
    '.da-rv-lims{padding-left:18px;margin:0 0 12px!important;font-size:15px}',
    '.da-rv--empty .da-rv-lims{font-size:16px;font-weight:600}',
    '.da-rv-outcome-p{font-size:16px;max-width:65ch}',
    '.da-rv [hidden]{display:none!important}',
    '.da-rv-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px 24px}',
    '.da-rv-headmain{min-width:0}',
    '.da-rv-label{font-size:13.5px;color:var(--rv-ink2)}',
    '.da-rv-side{text-align:right;font-size:13px;color:var(--rv-ink2)}',
    '.da-rv-who{font-weight:700;color:var(--rv-ink)}',
    '.da-rv-onrecord{font-size:14px;margin:10px 0 0!important}',
    '.da-rv-frow{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 12px;margin:0 0 10px}',
    '.da-rv-flab{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--rv-ink2);min-width:46px}',
    '.da-rv-chips{display:flex;flex-wrap:wrap;gap:8px}',
    '.da-rv-chip{font:inherit;font-size:13px;font-weight:600;min-height:36px;padding:6px 12px;border-radius:999px;border:1px solid var(--rv-line);background:#fff;color:var(--rv-ink2);cursor:pointer}',
    '.da-rv-chip[aria-pressed="true"]{background:var(--rv-deep);border-color:var(--rv-deep);color:#fff}',
    '.da-rv-chip:focus-visible{outline:3px solid var(--rv-green);outline-offset:2px}',
    '.da-rv-chipn{font-weight:500;opacity:.8}',
    '.da-rv-revlist{list-style:none;padding:0;display:grid;gap:12px}',
    '.da-rv-rev{border:1px solid var(--rv-line);border-left:4px solid var(--rv-deep);border-radius:10px;padding:12px 14px}',
    '.da-rv-revmeta{font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--rv-ink2);margin:0 0 4px!important}',
    '.da-rv-mapwrap{display:flex;flex-wrap:wrap;align-items:flex-start;gap:14px 24px}',
    '.da-rv-plot{width:100%;max-width:360px;height:auto;background:#f6f8f6;border:1px solid var(--rv-line);border-radius:12px}',
    '.da-rv-ring{fill:none;stroke:#c9d3cc;stroke-dasharray:4 4}',
    '.da-rv-ringlab,.da-rv-homelab{font-size:11px;fill:var(--rv-ink2)}',
    '.da-rv-home{fill:#16211c;stroke:#fff;stroke-width:3}',
    '.da-rv-mshape{stroke-width:2}',
    '.da-rv-mk--approved .da-rv-mshape{fill:var(--rv-green);stroke:var(--rv-green)}',
    '.da-rv-mk--proposed .da-rv-mshape{fill:#fff;stroke:var(--rv-amber)}',
    '.da-rv-mk--permitted .da-rv-mshape{fill:var(--rv-deep);stroke:var(--rv-deep)}',
    '.da-rv-mnum{font-size:10px;font-weight:700;fill:#fff}',
    '.da-rv-mk--proposed .da-rv-mnum{fill:var(--rv-amber)}',
    '.da-rv-legend{list-style:none;padding:0;display:grid;gap:8px;font-size:13.5px}',
    '.da-rv-legend li{display:flex;align-items:center;gap:8px}',
    '.da-rv-lhome{display:inline-block;width:12px;height:12px;border-radius:50%;background:#16211c}',
    '.da-rv-stage{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;border-radius:999px;padding:3px 10px;border:1px solid currentColor}',
    '.da-rv-stage--approved{color:var(--rv-green)}',
    '.da-rv-stage.da-rv-stage--approved{background:var(--rv-tint)}',
    '.da-rv-stage--proposed{color:var(--rv-amber)}',
    '.da-rv-stage.da-rv-stage--proposed{background:#fff;border-style:dashed}',
    '.da-rv-stage--permitted{color:var(--rv-deep)}',
    '.da-rv-stage.da-rv-stage--permitted{color:#fff;background:var(--rv-deep);border-color:var(--rv-deep)}',
    '.da-rv-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding-top:20px;border-top:1px solid var(--rv-line)}',
    '.da-rv-act{font:inherit;font-size:13.5px;font-weight:600;min-height:40px;padding:8px 14px;border-radius:10px;border:1px solid var(--rv-line);background:#fff;color:var(--rv-ink2);cursor:not-allowed}',
    '.da-rv-act:focus-visible{outline:3px solid var(--rv-green);outline-offset:2px}',
    '.da-rv-soon{font-size:12.5px;color:var(--rv-ink2)}',
    '@media(max-width:620px){.da-rv{padding:18px 16px;border-radius:12px}.da-rv-addr{font-size:17px}.da-rv-metrics{gap:10px 24px}.da-rv-side{text-align:left}}'
  ].join('');

  /** html() into `el`, with this module's stylesheet added to the document once. Returns whether a report was shown. */
  function mount(el, response, opts) {
    if (!el) return false;
    var doc = el.ownerDocument;
    if (doc && doc.head && !doc.getElementById('da-rv-style')) {
      var st = doc.createElement('style');
      st.id = 'da-rv-style';
      st.textContent = CSS;
      doc.head.appendChild(st);
    }
    el.innerHTML = html(response, opts);
    enhance(el);
    return renderable(response);
  }

  HS.daReportView = {
    html: html,
    mount: mount,
    enhance: enhance,
    renderable: renderable,
    CSS: CSS,
    TITLES: TITLES,
    OUTCOMES: OUTCOMES,
    DISCLOSURE: DISCLOSURE,
    SCOPE_LINE: SCOPE_LINE,
    SCOPE_NOTE: SCOPE_NOTE,
    EYEBROW: EYEBROW
  };
})(typeof window !== 'undefined' ? window : globalThis);
