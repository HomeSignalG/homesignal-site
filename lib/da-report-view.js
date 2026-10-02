// da-report-view.js — THE DEVELOPMENT ACTIVITY REPORT, AS A CUSTOMER SEES IT (Development Activity plan, Order I, step 1).
//
// WHAT THIS FILE IS. A pure presentation module: the national report engine's own response goes in, escaped HTML comes out, in
// the approved section order, showing only the sections that have data. It is a VIEW. It adds no data, makes no network or
// storage call, and has NO CALLER: no page loads it and nothing links to it (docs/development-activity-report-view-2026-10-02.md).
//
//   response  = what supabase/functions/get-development-activity-report returns:
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
// publisher date is never called a HomeSignal change. An empty customer view says what the engine says about coverage and never
// claims there was no activity (plan hard rule 66).
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
  var TITLES = {                                                          // plan lines 2410-2418; the two stage labels are the landing page's
    changed: 'What Changed Recently',
    activity: 'Recent Official Activity',
    approved: 'Approved / Coming',
    proposed: 'Proposed / Under Review',
    history: 'Change History',
    evidence: 'Official evidence & coverage'
  };
  // plan lines 1763 (disclosure), 1261 and 1265 (scope)
  var DISCLOSURE = 'HomeSignal summarizes selected official public records available to its covered sources. It may not include every project or change and is not a substitute for independent property, municipal, title, zoning, legal, inspection, or other professional due diligence.';
  var SCOPE_LINE = 'Planned, approved, permitted and changing development found in HomeSignal\'s covered official sources.';
  var SCOPE_NOTE = 'This report focuses on development activity and change. It is not an inventory of existing schools, parks, businesses, buildings, or neighborhood amenities.';
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

  // ── fragments ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function lifeBadge(p) {
    var k = lifeKey(p);
    return '<span class="da-rv-life da-rv-life--' + k + '" data-lifecycle="' + k + '">' + SHAPES[k]
      + '<span class="da-rv-lifetext">' + esc(lifeLabel(p)) + '</span></span>';
  }
  function tagRow(p, response) {
    var out = lifeBadge(p);
    var t = typeLabel(p);
    if (t) out += '<span class="da-rv-tag da-rv-type">' + esc(t) + '</span>';
    var d = distanceOf(response, p.project_id);
    if (d) out += '<span class="da-rv-tag da-rv-dist">' + esc(d) + '</span>';
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
  function card(p, response) {
    var status = txt(p.publisher_status);
    return '<article class="da-rv-card"><h3 class="da-rv-title">' + esc(titleOf(p)) + '</h3>' + tagRow(p, response)
      + (status ? line('Publisher status', status) : '') + eventLines(p) + sourceBlock(p) + '</article>';
  }
  function metric(n, label) { return '<div class="da-rv-metric"><b>' + n + '</b><span>' + esc(label) + '</span></div>'; }
  function section(key, label, inner, cls) {
    return '<section class="da-rv-sec da-rv-sec--' + key + (cls ? ' ' + cls : '') + '" aria-label="' + esc(label) + '"><h2 class="da-rv-h2">'
      + esc(label) + '</h2>' + inner + '</section>';
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
  function summarySection(key, list, response, staged, hero, labelOf, recentOf) {
    var first = list[0], recent = recentOf(first);
    var rows = list.filter(function (p) { return !staged[p.project_id]; }).map(function (p) { return card(p, response); }).join('');
    var inner = '<div class="da-rv-metrics">' + tally(list, labelOf) + '</div><p class="da-rv-unit">Counted as official records.</p>'
      + '<p class="da-rv-recent">' + esc('Most recent: ' + (typeLabel(first) ? typeLabel(first) + ' — ' : '') + titleOf(first)
        + (distanceOf(response, first.project_id) ? ' · ' + distanceOf(response, first.project_id) : '') + (recent ? ' · ' + recent : '')) + '</p>'
      + (rows ? '<div class="da-rv-cards">' + rows + '</div>' : '');
    return section(key, TITLES[key], inner, hero ? 'da-rv-hero' : '');
  }
  function changedSection(list, response, staged) {
    return summarySection('changed', list, response, staged, true,
      function (p) { return eventLabel(detected(p)[0].event_type); },
      function (p) {
        var d = detected(p)[0], pe = publisherEvent(p);
        return eventLabel(d.event_type) + (day(d.detected_at) ? ', detected ' + day(d.detected_at) : '')
          + (pe ? ' · Official record: ' + eventText(pe.label, pe.date) : '');
      });
  }
  function activitySection(list, response, staged, hero) {
    return summarySection('activity', list, response, staged, hero,
      function (p) { return publisherEvent(p).label; },
      function (p) { var pe = publisherEvent(p); return pe.date ? pe.label + ' ' + pe.date : pe.label; });
  }
  function stageSection(key, list, response) {
    return section(key, TITLES[key],
      '<p class="da-rv-count">' + esc(plural(list.length, 'official record', 'official records')) + '</p><div class="da-rv-cards">'
      + list.map(function (p) { return card(p, response); }).join('') + '</div>');
  }
  /** Two labelled lanes per record, never merged: what the publisher says, and what HomeSignal detected. Hidden when there is neither. */
  function historySection(list) {
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
  function header(report, opts) {
    var subject = typeof opts.subject === 'string' ? opts.subject.trim() : '';
    var bits = [];
    if (typeof report.radius_mi === 'number' && isFinite(report.radius_mi) && report.radius_mi > 0) {
      bits.push('Within ' + report.radius_mi + (report.radius_mi === 1 ? ' mile' : ' miles'));
    }
    if (typeof report.zip === 'string' && /^\d{5}$/.test(report.zip)) bits.push('ZIP ' + report.zip);
    if (day(report.as_of)) bits.push('As of ' + day(report.as_of));
    return '<header class="da-rv-head"><p class="da-rv-eyebrow">' + esc(EYEBROW) + '</p><p class="da-rv-addr">' + esc(subject || NO_ADDRESS) + '</p>'
      + (bits.length ? '<p class="da-rv-meta">' + esc(bits.join(' · ')) + '</p>' : '') + '</header>';
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
    var report = response.report, sec = report.sections, byLife = isObj(sec.by_lifecycle) ? sec.by_lifecycle : {};
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
    var approved = pick(byLife.approved), proposed = pick(byLife.proposed);
    var staged = Object.create(null);
    approved.concat(proposed).forEach(function (p) { staged[p.project_id] = true; });
    var history = pick(arr(sec.what_changed_recently).concat(arr(sec.recent_official_activity))).filter(function (p) {
      return detected(p).length > 0 || publisherEvent(p) !== null;
    });

    var parts = [header(report, opts)];
    if (changed.length) parts.push(changedSection(changed, response, staged));
    if (activity.length) parts.push(activitySection(activity, response, staged, !changed.length));
    if (approved.length) parts.push(stageSection('approved', approved, response));
    if (proposed.length) parts.push(stageSection('proposed', proposed, response));
    if (history.length) parts.push(historySection(history));
    parts.push(evidenceSection(report));
    var empty = report.projects.length === 0;
    return '<article class="da-rv' + (empty ? ' da-rv--empty' : '') + '" aria-label="HomeSignal Development Activity report">' + parts.join('') + '</article>';
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
    '@media(max-width:620px){.da-rv{padding:18px 16px;border-radius:12px}.da-rv-addr{font-size:17px}.da-rv-metrics{gap:10px 24px}}'
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
    return renderable(response);
  }

  HS.daReportView = {
    html: html,
    mount: mount,
    renderable: renderable,
    CSS: CSS,
    TITLES: TITLES,
    DISCLOSURE: DISCLOSURE,
    SCOPE_LINE: SCOPE_LINE,
    SCOPE_NOTE: SCOPE_NOTE,
    EYEBROW: EYEBROW
  };
})(typeof window !== 'undefined' ? window : globalThis);
