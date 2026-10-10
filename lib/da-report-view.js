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
  var BRIEFING_TITLE = 'Client Briefing: Nearby Activity';                 // the realtor value review (2026-10-04): the briefing paragraph's heading
  // Said once, under the briefing: these are official records and where they are. They are not a prediction, and not a reason to steer a client toward or away from an area.
  var BRIEFING_CAUTION = 'This briefing reports what official records say and where they are. It is not a prediction about value, traffic or the character of the neighbourhood. Describe the records, not the people who may live or work nearby, and do not use them to steer a client toward or away from an area.';
  var EYEBROW = 'HOMESIGNAL DEVELOPMENT ACTIVITY';                       // ruling R6
  var TITLES = {                                                          // 100526 plan, ruling 3 and the visual layout contract; layout pass 2026-10-09
    records: 'Nearby Development',
    filters: 'Type and stage',
    map: 'Development Activity Map',
    approved: 'Approved / Coming',
    proposed: 'Proposed / Under Review',
    permitted: 'Permitted / Under Construction',
    operating: 'Operating / Built',
    unstaged: 'Stage not stated',
    history: 'Change History',
    evidence: 'Official evidence & coverage',
    actions: 'Report actions'
  };

  // The three stage sections, in the plan's order (ruling 3). The keys are the engine's (`sections.by_stage`).
  var STAGES = ['approved', 'proposed', 'permitted'];
  // The Type chips, in the plan's order. Only the ORDER is held here; each chip's label is the canonical Type authority's
  // (lib/project-type.js, through HS.projectType when the page loads it, otherwise the label the engine put on a record).
  var TYPE_CHIP_ORDER = ['residential', 'commercial', 'industrial', 'datacenter', 'infrastructure', 'civic', 'other'];
  var ACTIONS = ['Compare property', 'Watch property', 'Share report', 'Download PDF'];
  // The same four, by key. A caller makes some LIVE with opts.live (build steps 8 and 9: 'share', 'watch' and 'pdf') and may HIDE some with opts.hide; every
  // other action stays inert, exactly as before. A live button carries data-da-action and does nothing by itself: the page wires it.
  var ACTION_KEYS = ['compare', 'watch', 'share', 'pdf'];
  // "Download PDF" opens the browser's own print window, where the person chooses "Save as PDF" (build step 8): no PDF is made on a server.
  var PDF_HINT = 'Opens your browser\'s print window. Choose \u201cSave as PDF\u201d there, and turn off \u201cHeaders and footers\u201d for a clean copy (your browser controls that setting).';
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
  /** The official date on a record of ANY age, with what it was, and whether it is more than a year old (engine `record_date`, audit 2026-10-07 finding 2).
   *  A saved report made before the engine carried it has none, and then nothing is said: the view never invents a date. */
  function recordDateOf(p) {
    var e = p.record_date;
    if (!isObj(e) || !txt(e.label) || !day(e.date)) return null;
    return { label: txt(e.label), date: day(e.date), old: e.older_than_a_year === true };
  }
  var OLD_NOTE = 'more than a year old; confirm it is still active';
  function recordDateText(rd) { return eventText(rd.label, rd.date) + (rd.old ? ' \u00b7 ' + OLD_NOTE : ''); }
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
  // A "Decided" application was denied or withdrawn (CLAUDE.md 7.05). The engine files it under the Proposed stage on purpose (the shared lifecycle authority,
  // lib/project-type.js, is also Map 1's), so the REPORT says it plainly here: from the publisher's own status, which every response and every saved report carries.
  // The status word on a card is the one HomeSignal's own record carries for the source record (Proposed, Approved, Decided, On file), not the agency's text:
  // the agency's own words are the stage line. The label says whose it is (audit 2026-10-07, finding 4).
  var STATUS_LABEL = 'Status in HomeSignal\'s record';
  var DECIDED_LABEL = 'Decided (denied or withdrawn)';
  function isDecided(p) { return txt(p.publisher_status).toLowerCase() === 'decided'; }
  function stageLabelOf(p, k) {
    if (k === 'proposed' && isDecided(p)) return DECIDED_LABEL;
    return (isObj(p.stage) && p.stage.key === k ? txt(p.stage.label) : '') || TITLES[k] || '';
  }
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
  var COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  /** The compass word for a record's bearing, only when THIS response carries one (response-only, like distance). Approximate for a road or an area. */
  function compassOf(response, id) {
    var b = bearingOf(response, id);
    return b === null ? '' : COMPASS[Math.round((((b % 360) + 360) % 360) / 45) % 8];
  }
  function cap(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : ''; }
  function milesOf(response, id) {
    var r = isObj(response.render) ? response.render : null;
    var m = r && isObj(r.distances_mi) ? r.distances_mi : null;
    var n = m && has(m, id) ? m[id] : null;
    return typeof n === 'number' && isFinite(n) && n >= 0 ? n : null;
  }
  /** INTERNAL REVIEW PAGE ONLY (opts.showLifecycle): the day of the ledger's first observation, under its own plain name. It is NOT a detection: for a
   *  record read at the national baseline it is a refresh sweep's time before the ledger existed. The customer view never prints it. */
  function ledgerFirstRead(p) { return isObj(p.homesignal_observation) ? day(p.homesignal_observation.first_observed_at) : ''; }
  // The card carries NO "First detected" line read from the ledger's first observation. That instant is the retrieval time of the source row
  // the ledger first received: for the records read at the national baseline (921,285 of 935,165 ledger identities on 2026-10-04) it is a refresh
  // sweep's time before the ledger existed (2026-09-29), so "first detected by HomeSignal" would be untrue of them. A REAL detection (a
  // non-baseline first_detected event) already shows on the card as "HomeSignal detected", dated by the event itself (eventLines).

  // ── fragments ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  function lifeBadge(p) {
    var k = lifeKey(p);
    return '<span class="da-rv-life da-rv-life--' + k + '" data-lifecycle="' + k + '">' + SHAPES[k]
      + '<span class="da-rv-lifetext">' + esc(lifeLabel(p)) + '</span></span>';
  }
  function stageBadge(p, k) {
    return '<span class="da-rv-stage da-rv-stage--' + k + (k === 'proposed' && isDecided(p) ? ' da-rv-decided' : '') + '" data-stage="' + k + '">' + STAGE_SHAPES[k]
      + '<span class="da-rv-lifetext">' + esc(stageLabelOf(p, k)) + '</span></span>';
  }
  function line(label, text) {
    return '<p class="da-rv-line"><span class="da-rv-k">' + esc(label) + ':</span> ' + esc(text) + '</p>';
  }
  function eventText(label, date) { return date ? label + ' · ' + date : label; }
  /** The official-source link for a record, or '' when it has none a person could follow. The ONE place a record's href is written. */
  function sourceLink(p) {
    var s = isObj(p.source) ? p.source : {};
    var href = safeHref(s.url);
    return href ? '<a class="da-rv-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">Official source '
      + '<span aria-hidden="true">→</span><span class="da-rv-sr"> for ' + esc(titleOf(p)) + ' (opens in a new tab)</span></a>' : '';
  }
  /** The agency attribution the engine put on a record's source, as the engine wrote it ('' when it states none). */
  function agencyOf(p) { var s = isObj(p.source) ? p.source : {}; return txt(s.attribution); }
  /** The record's official address as plain text (the same safe URL the link uses), shown ONLY in print, so a paper copy still leads to the record. */
  function section(key, label, inner, cls) {
    return '<section class="da-rv-sec da-rv-sec--' + key + (cls ? ' ' + cls : '') + '" aria-label="' + esc(label) + '"><h2 class="da-rv-h2">'
      + esc(label) + '</h2>' + inner + '</section>';
  }
  /** The Proposed stage minus the decided applications, and the plain tail that counts those on their own. */
  function openProposed(list) { return list.filter(function (p) { return !isDecided(p); }); }
  function decidedTail(list) {
    var n = list.length - openProposed(list).length;
    return n ? ' \u00b7 ' + n + ' decided (denied or withdrawn)' : '';
  }
  /** The engine's own outcome key (one of OUTCOMES), or '' when the report carries none or an unknown one. The view never infers one. */
  function outcomeKeyOf(report) {
    var a = isObj(report.activity) ? report.activity : null;
    return a && typeof a.outcome === 'string' && has(OUTCOMES, a.outcome) ? a.outcome : '';
  }
  /** The engine's outcome for an EMPTY report, in fixed words. Null for a report with projects, an unknown outcome, or no outcome
   *  (an older response): the view never infers one from the empty list. */
  function outcomeSection(report) {
    var o = outcomeText(report);
    if (!o || report.projects.length !== 0) return '';
    return section('outcome', o.title, '<p class="da-rv-p da-rv-outcome-p">' + esc(o.body) + '</p>', 'da-rv-hero');
  }
  /** The engine's outcome in fixed words: { key, title, body }, or null when the report carries none or an unknown one. It does not look at
   *  the records: the caller decides when an outcome applies (the report shows it only when it has no records). */
  function outcomeText(report) {
    var key = outcomeKeyOf(report);
    if (!key) return null;
    var o = OUTCOMES[key], body = o.body;
    if (key === 'NO_DEVELOPMENT_ACTIVITY') {
      var r = report.radius_mi;
      body += typeof r === 'number' && isFinite(r) && r > 0 ? ' within ' + r + (r === 1 ? ' mile' : ' miles') + ' of this property.' : ' near this property.';
    }
    return { key: key, title: o.title, body: body };
  }
  /** One record in plain words, from what the engine gave it: its name, its Type label, its publisher's latest event, and the newest change
   *  HomeSignal detected. Each is '' when the record does not state it. The comparison uses this, so it describes a record as the report does. */
  function describe(p) {
    var pe = publisherEvent(p), d = detected(p)[0];
    return {
      title: titleOf(p), type: typeLabel(p),
      event: pe ? eventText(pe.label, pe.date) : '',
      change: d ? eventLabel(d.event_type) + (day(d.detected_at) ? ', detected ' + day(d.detected_at) : '') : ''
    };
  }
  function chip(dim, value, label, count, pressed) {
    return '<button type="button" class="da-rv-chip" data-da-filter="' + dim + '" data-da-value="' + esc(value) + '" aria-pressed="' + (pressed ? 'true' : 'false') + '">'
      + esc(label) + (count === null ? '' : ' <span class="da-rv-chipn">' + count + '</span>') + '</button>';
  }
  /** How many of these records carry each canonical Type key, with the label the engine put on the first of them. */
  function typesSeen(current) {
    var seen = Object.create(null);
    current.forEach(function (p) { var k = typeKeyOf(p); if (!seen[k]) seen[k] = { n: 0, label: typeLabel(p) }; seen[k].n++; });
    return seen;
  }
  /** A Type chip's label: the canonical Type authority's when the page loads it, otherwise the label the engine put on a record. '' when neither. */
  function typeLabelFor(k, seen) {
    var reg = root.HS && root.HS.projectType && isObj(root.HS.projectType.CATEGORY_REGISTRY) ? root.HS.projectType.CATEGORY_REGISTRY : null;
    return reg && isObj(reg[k]) && !reg[k].isFacility ? txt(reg[k].label) : (seen[k] ? seen[k].label : '');
  }
  /** The Types a set of records carries, in the plan's chip order: [{ key, label, n }]. Only a Type with a record and a label is listed. */
  function typeCounts(current) {
    var seen = typesSeen(current);
    return TYPE_CHIP_ORDER.filter(function (k) { return seen[k] && typeLabelFor(k, seen); })
      .map(function (k) { return { key: k, label: typeLabelFor(k, seen), n: seen[k].n }; });
  }
  /** Type and Stage, two separate controls. They change what is SHOWN, never the report. */
  function filtersSection(current, m) {
    var seen = typesSeen(current);
    var types = chip('type', 'all', 'All', current.length, true) + TYPE_CHIP_ORDER.map(function (k) {
      var label = typeLabelFor(k, seen);
      if (!label || (k === 'other' && !seen[k])) return '';
      return chip('type', k, label, seen[k] ? seen[k].n : 0, false);
    }).join('');
    var stages = chip('stage', 'all', 'All', current.length, true) + STAGES.map(function (k) {
      return chip('stage', k, TITLES[k], m.staged[k].length, false);
    }).join('') + (m.operating.length ? chip('stage', 'operating', TITLES.operating, m.operating.length, false) : '');
    return section('filters', TITLES.filters,
      '<div class="da-rv-frow"><span class="da-rv-flab" aria-hidden="true">Type</span><div class="da-rv-chips" role="group" aria-label="Type">' + types + '</div></div>'
      + '<div class="da-rv-frow"><span class="da-rv-flab" aria-hidden="true">Stage</span><div class="da-rv-chips" role="group" aria-label="Stage">' + stages + '</div></div>'
      + '<p class="da-rv-p da-rv-quiet">The filters change what is shown in the table and on the map. They do not change the report.</p>');
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
    var svg = '<svg class="da-rv-plot da-rv-plot--' + (drawn > 6 ? 'lg' : 'sm') + '" viewBox="0 0 360 360" role="img" aria-label="' + esc('Map of development activity within ' + radius + ' miles of the property, ' + drawn + ' marked') + '">'
      + ring(1, radius + ' mi') + ring(0.5, (radius / 2) + ' mi') + '<text x="' + C + '" y="14" text-anchor="middle" class="da-rv-ringlab">N</text>'
      + '<text x="' + (2 * C - 10) + '" y="' + (C + 4) + '" text-anchor="middle" class="da-rv-ringlab">E</text>'
      + '<text x="' + C + '" y="' + (2 * C - 6) + '" text-anchor="middle" class="da-rv-ringlab">S</text>'
      + '<text x="10" y="' + (C + 4) + '" text-anchor="middle" class="da-rv-ringlab">W</text>'
      + '<circle cx="' + C + '" cy="' + C + '" r="7" class="da-rv-home"/><text x="' + C + '" y="' + (C + 22) + '" text-anchor="middle" class="da-rv-homelab">Property</text>'
      + marks + '</svg>';
    var legend = '<ul class="da-rv-legend"><li><span class="da-rv-lhome" aria-hidden="true"></span>Property</li>' + STAGES.map(function (k) {
      return '<li class="da-rv-stage--' + k + '">' + STAGE_SHAPES[k] + esc(TITLES[k]) + '</li>';
    }).join('') + '</ul>';
    return section('map', TITLES.map, '<div class="da-rv-mapwrap">' + svg + legend + '</div>'
      + '<p class="da-rv-p da-rv-quiet">Only tracked development activity is shown. Distance is to scale; direction is approximate for roads and areas. The numbers match the Map column in the table.</p>');
  }
  // ── QUALITY-OF-LIFE CONSIDERATIONS: the ONE reusable presentation rule (lib is the only place it lives) ─────────────────────────────────
  // Which everyday-living aspects a kind of development COULD touch, in plain words. Pure, deterministic, keyed ONLY by the canonical Type key the
  // engine already gave the record (lib/project-type.js decides the Type; this adds no Type rule). It is a presentation of a general possibility
  // for that kind of project and nothing more: every sentence says it is a potential consideration and that nothing is verified. It reads no
  // measurement, makes no prediction, scores nothing and calls no project harmful. The engine's record carries no site-specific impact evidence,
  // so no "documented" impact can be shown; when one exists it needs its own engine field and its own kind here, never a reworded potential.
  var QOL_UNKNOWN = 'Impact not determined from available records.';
  var QOL_DECIDED = 'Denied or withdrawn: no development effect is considered unless it is refiled. Confirm the outcome at the official source.';
  var QOL_BY_TYPE = {
    infrastructure: 'Potential construction noise and traffic/access disruption. Effects not verified.',
    datacenter: 'Potential cooling noise, backup-generator operation, construction traffic and water-demand considerations. Not site-verified; no effect is established.',
    industrial: 'Potential noise, truck traffic, dust or air emissions, and change to the view. Not site-verified; no effect is established.',
    commercial: 'Potential construction and customer traffic, parking and noise, and change to the view. Not site-verified; no effect is established.',
    residential: 'Potential construction noise and traffic, then added neighborhood activity or visual change. Not site-verified; no effect is established.',
    civic: 'Potential construction disruption and possible change to public access or amenities. Not site-verified; no effect is established.'
  };
  /** { kind: 'potential' | 'denied_or_withdrawn' | 'unknown', text } for one record. Same input, same answer; no clock, no geography, no network. */
  function qolImpact(p) {
    if (isDecided(p)) return { kind: 'denied_or_withdrawn', text: QOL_DECIDED };
    var k = typeKeyOf(p);
    return has(QOL_BY_TYPE, k) ? { kind: 'potential', text: QOL_BY_TYPE[k] } : { kind: 'unknown', text: QOL_UNKNOWN };
  }
  var TABLE_COLS = [['dev', 'Development'], ['stage', 'Stage'], ['qol', 'Quality-of-Life Impact']];
  /** A stage's cell: the engine's stage (the engine's lifecycle label for an operating record, "Stage not stated" for one in neither), the agency's own words when it
   *  stated them, and, only when the record's official date is more than a year old, one short line saying so (the engine's flag, never a guess of the status). */
  function stageCell(p, k) {
    var pstage = txt(p.publisher_stage), rd = recordDateOf(p);
    // Plain text, no shape and no pill: the table reads as a typeset report, not a dashboard. The data-* hooks stay so the filters and tests still find the stage.
    var main = k && k !== 'operating' ? '<span class="da-rv-stage da-rv-stage--' + k + (k === 'proposed' && isDecided(p) ? ' da-rv-decided' : '') + '" data-stage="' + k + '"><span class="da-rv-lifetext">' + esc(stageLabelOf(p, k)) + '</span></span>'
      : lifeKey(p) === 'operating' ? '<span class="da-rv-life da-rv-life--operating" data-lifecycle="operating"><span class="da-rv-lifetext">' + esc(lifeLabel(p)) + '</span></span>'
      : '<span class="da-rv-stage da-rv-stage--none"><span class="da-rv-lifetext">Stage not stated</span></span>';
    return main + (pstage ? '<span class="da-rv-sub">Agency stage: ' + esc(pstage) + '</span>' : '')
      + (rd && rd.old ? '<span class="da-rv-sub da-rv-stale" data-da-stale><b>Verify:</b> ' + esc(rd.label + ' ' + rd.date + ', over a year old. Confirm it is still active.') + '</span>' : '');
  }
  /** The records, once each, in three columns only: Development (name, Type, distance and direction, map number, the short official link), Stage, and
   *  Quality-of-Life Impact. `items` is [{ p, k }] in the engine's order (the stages, then operating, then those with no stage); k is the stage key,
   *  'operating', or ''. Each row carries the data-da-* the filters match on (a record with no stage has none, so the filters never hide it). On a phone the
   *  rows stack (CSS); the ARIA roles keep the table a table when they do. */
  function recordsTable(items, response, nums) {
    if (!items.length) return '';
    var head = TABLE_COLS.map(function (c) { return '<th scope="col" role="columnheader" class="da-rv-th--' + c[0] + '">' + esc(c[1]) + '</th>'; }).join('');
    var body = items.map(function (it) {
      var p = it.p, k = it.k;
      var dist = distanceOf(response, p.project_id), dir = compassOf(response, p.project_id), type = typeLabel(p), link = sourceLink(p);
      var n = nums && nums[p.project_id] !== undefined ? nums[p.project_id] : '';
      var where = [dist ? dist + (dir ? ' ' + dir : '') : '', n !== '' ? 'Map ' + n : ''].filter(Boolean).join(' · ');
      var q = qolImpact(p);
      var dev = '<th scope="row" role="rowheader" class="da-rv-td da-rv-td--dev"><span class="da-rv-name">' + esc(titleOf(p)) + '</span>'
        + (type ? '<span class="da-rv-sub da-rv-sub--type">' + esc(type) + '</span>' : '')
        + (where ? '<span class="da-rv-sub">' + esc(where) + '</span>' : '')
        + (link ? '<span class="da-rv-sub da-rv-sub--src">' + link + '</span>' : '') + '</th>';
      var stage = '<td role="cell" class="da-rv-td da-rv-td--stage"><span class="da-rv-lab">Stage: </span>' + stageCell(p, k) + '</td>';
      var qol = '<td role="cell" class="da-rv-td da-rv-td--qol" data-da-qol="' + q.kind + '"><span class="da-rv-lab">Quality-of-Life Impact: </span>' + esc(q.text) + '</td>';
      return '<tr role="row" data-da-type="' + esc(typeKeyOf(p)) + '" data-da-stage="' + (k || 'none') + '">' + dev + stage + qol + '</tr>';
    }).join('');
    return '<div class="da-rv-tablewrap"><table class="da-rv-table" role="table" aria-label="' + esc(TITLES.records + ': ' + plural(items.length, 'official record', 'official records')) + '">'
      + '<thead role="rowgroup"><tr role="row">' + head + '</tr></thead><tbody role="rowgroup">' + body + '</tbody></table></div>';
  }
  /** What the table does NOT already say about a record, once: the official event and its date, the status in HomeSignal's record, the newest change HomeSignal detected,
   *  the agency's attribution and the source (the address printed only on paper). The name, Type, stage, distance and impact are in the table row and are not repeated. */
  function evidenceRecord(it, response, nums, showLifecycle) {
    var p = it.p, k = it.k, n = nums && nums[p.project_id] !== undefined ? nums[p.project_id] : '';
    var status = txt(p.publisher_status), pe = publisherEvent(p), rd = recordDateOf(p), dc = detected(p)[0], att = agencyOf(p), link = sourceLink(p);
    var lines = (pe ? line('Official record', eventText(pe.label, pe.date)) : rd ? line('Official record', eventText(rd.label, rd.date)) : '')
      + (status ? line(STATUS_LABEL, status) : '')
      + (dc ? line('HomeSignal detected', eventText(eventLabel(dc.event_type), day(dc.detected_at))) : '')
      + (showLifecycle ? line('HomeSignal lifecycle', lifeLabel(p)) : '')
      + (showLifecycle && ledgerFirstRead(p) ? line('Ledger first read', ledgerFirstRead(p)) : '')
      + (k === 'proposed' && isDecided(p) ? '<p class="da-rv-line da-rv-decidednote"><span class="da-rv-k">Outcome:</span> Decided (denied or withdrawn): it is not open or under review. Confirm the outcome at the official source.</p>' : '')
      + (att ? '<p class="da-rv-attr">' + esc(att) + '</p>' : '')
      + (link ? '<p class="da-rv-src">' + link + '</p>' : '');
    return '<li class="da-rv-evrec" data-da-type="' + esc(typeKeyOf(p)) + '" data-da-stage="' + (k || 'none') + '"><h3 class="da-rv-evtitle">'
      + (n !== '' ? '<span class="da-rv-evnum">Map ' + n + '</span> ' : '') + esc(titleOf(p)) + '</h3>' + lines + '</li>';
  }
  /** The ONE records section: the table (every record once), a note for records on the same road, and ONE expandable block of supporting evidence. */
  function recordsSection(m, response, showLifecycle) {
    var items = [];
    STAGES.forEach(function (k) { m.staged[k].forEach(function (p) { items.push({ p: p, k: k }); }); });
    m.operating.forEach(function (p) { items.push({ p: p, k: 'operating' }); });
    m.unstaged.forEach(function (p) { items.push({ p: p, k: '' }); });
    if (!items.length) return '';
    var ev = items.map(function (it) { return evidenceRecord(it, response, m.nums, showLifecycle); }).join('');
    return section('records', TITLES.records,
      corridorNotes(items.map(function (it) { return it.p; }), response)
      + recordsTable(items, response, m.nums)
      + '<details class="da-rv-detail"><summary class="da-rv-sum">Supporting evidence for each record</summary><ol class="da-rv-evlist">' + ev + '</ol></details>'
      + '<p class="da-rv-p da-rv-quiet da-rv-nomatch" hidden>No records match the filters.</p>');
  }
  // A road number the records name in their own titles ("SR-13 (Main St) & 100 North"): the route, as the agency wrote it.
  var ROUTE = /\b((?:SR|US|UT|I|HWY|HIGHWAY)[-\s]?\d{1,3}[A-Z]?)\b/i;
  /** Two or more records of ONE stage, from ONE agency attribution, that name the same road number: a note that they sit on the same road, with the
   *  distance range. It groups nothing and merges nothing (each stays a record of its own below), and it never says they are one project. */
  function corridorNotes(list, response) {
    var groups = Object.create(null), order = [];
    list.forEach(function (p) {
      var m = ROUTE.exec(titleOf(p)), a = agencyOf(p);
      if (!m || !a) return;
      var key = m[1].toUpperCase().replace(/\s+/g, '-') + '|' + a;
      if (!groups[key]) { groups[key] = { route: m[1].toUpperCase().replace(/\s+/g, '-'), ps: [] }; order.push(key); }
      groups[key].ps.push(p);
    });
    return order.map(function (key) {
      var g = groups[key];
      if (g.ps.length < 2) return '';
      var ds = g.ps.map(function (p) { return milesOf(response, p.project_id); }).filter(function (d) { return d !== null; });
      var span = ds.length === g.ps.length ? ' They are ' + (Math.min.apply(null, ds) < 0.1 ? 'under 0.1' : Math.min.apply(null, ds).toFixed(1))
        + (Math.max.apply(null, ds) < 0.1 ? '' : ' to ' + Math.max.apply(null, ds).toFixed(1)) + ' miles from the property.' : '';
      return '<p class="da-rv-p da-rv-corridor" data-da-corridor>' + esc(g.route + ' corridor: ' + plural(g.ps.length, 'official record', 'official records')
        + ' on this road.' + span + ' They are listed separately in the table and may or may not be one program.') + '</p>';
    }).join('');
  }
  /** Two labelled lanes per record, never merged: what the publisher says, and what HomeSignal detected. */
  var CHANGE_NOT_READY = 'Change history begins once HomeSignal has observed these records at least twice.';
  /** Whether HomeSignal has observed this report's records long enough to say it saw NO change: only the engine's own flag says so. Until then a count
   *  of zero changes is "not yet measured", never "nothing changed". */
  function changeReady(report) {
    var cov = isObj(report.coverage) ? report.coverage : {};
    return cov.change_ready === true;
  }
  /** What the ledger can honestly say about "no change": how many of the report's records it can compare (observed at least twice, comparable),
   *  and the day its history for ALL of those begins (the latest first observation among them; stated days sort as text). Null when it cannot say. */
  function changeBasis(report) {
    var ps = arr(report.projects).filter(isObj), ready = 0, startKey = '', start = '';
    ps.forEach(function (p) {
      var o = isObj(p.homesignal_observation) ? p.homesignal_observation : null;
      var label = o && o.change_ready === true ? day(o.first_observed_at) : '';
      if (!label) return;
      ready++;
      var key = o.first_observed_at.slice(0, 10);
      if (key > startKey) { startKey = key; start = label; }
    });
    return ready > 0 ? { total: ps.length, ready: ready, start: start } : null;
  }
  /** "No status change" is a statement about a WINDOW, so it names the window the ledger actually holds: its history for these records starts on a
   *  stated day. It never says "in the last N days" (the ledger's history is shorter than that today and the view owns no window), and it speaks
   *  for every project only when every project is comparable; otherwise it says how many it can compare. */
  function noChangeMessage(report) {
    var b = changeReady(report) ? changeBasis(report) : null;
    if (!b) return CHANGE_NOT_READY;
    if (b.ready === b.total) {
      return 'HomeSignal\u2019s change history for these records starts on ' + b.start + '. Since then it has recorded no status change for the projects in this report.';
    }
    var rest = b.total - b.ready;
    return 'HomeSignal\u2019s change history for ' + b.ready + ' of the ' + b.total + ' records in this report starts on ' + b.start
      + ', and it has recorded no status change for them since. The other ' + rest + (rest === 1 ? ' is' : ' are') + ' not yet comparable.';
  }
  function historySection(list, report) {
    if (!list.length) {
      return section('history', TITLES.history, '<p class="da-rv-p">' + esc(noChangeMessage(report)) + '</p>');
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
  /** The engine's own limitation texts, verbatim and in its order. */
  function limitationsOf(report) {
    var cov = isObj(report.coverage) ? report.coverage : {};
    return arr(cov.limitations).filter(isObj).map(function (l) { return txt(l.text); }).filter(Boolean);
  }
  /** What this report can and cannot say about its sources. The count is the engine's (`coverage.source_feed_count`); a saved report made before the engine
   *  carried it states the limit without a number. It never says an agency has no records: only that an agency outside this report was not checked. */
  function coverageText(report) {
    var cov = isObj(report.coverage) ? report.coverage : {}, n = cov.source_feed_count;
    var drew = typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n
      ? 'This report draws on ' + plural(n, 'official source feed', 'official source feeds') + ' that returned records within the search area. ' : '';
    return drew + 'HomeSignal does not cover every agency in every area. An agency that is not part of this report was not checked, so a record that is not listed here may still exist.';
  }
  /** How the report was made, in the review's words: the agencies it drew on, the search area, what each stage means, and when to refresh. Every line is
   *  a fact about THIS report or a fixed definition (the engine's own stage rule, national-report.ts); none says what is not there. */
  function methodNotes(report) {
    var r = report.radius_mi, seen = [];
    arr(report.projects).forEach(function (p) {
      var a = isObj(p) ? agencyOf(p) : '';
      if (a && seen.indexOf(a) < 0) seen.push(a);
    });
    var line2 = function (k, t) { return '<p class="da-rv-p"><span class="da-rv-k">' + esc(k) + ':</span> ' + esc(t) + '</p>'; };
    return '<div class="da-rv-method" data-da-method>'
      + (seen.length ? line2('Official agency data in this report', seen.join('; ')) : '')
      + (typeof r === 'number' && isFinite(r) && r > 0
        ? line2('Search area', 'Records within ' + r + (r === 1 ? ' mile' : ' miles') + ' of the property. Distance is measured from the property to the near edge of each record\'s mapped shape. The compass direction points to a single display point for the record, so for a long road or an area it is approximate and can differ from where that edge lies.') : '')
      + line2('Stages', 'Permitted / Under Construction: the agency\'s own stage says a permit was issued or construction is under way. Approved / Coming: approved, without that wording. Proposed / Under Review: filed or under review, not yet approved. A record the agency lists as Decided was denied or withdrawn; it is marked Decided (denied or withdrawn) and is not counted as under review.')
      + line2('Coverage', coverageText(report))
      + line2('Before you rely on it', 'Refresh this report before a listing launch, an open house, an offer, an inspection or a closing when nearby construction matters.')
      + '</div>';
  }
  /** The engine's own limitation text, verbatim, then the standard scope and disclosure. Never a claim about what is NOT there. */
  function evidenceSection(report) {
    var cov = isObj(report.coverage) ? report.coverage : {};
    var lims = limitationsOf(report);
    var recentDays = report.recent_days, asOf = day(report.as_of);
    var inner = (lims.length ? '<ul class="da-rv-lims">' + lims.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '')
      + (typeof recentDays === 'number' && isFinite(recentDays) && recentDays > 0 && asOf
        ? '<p class="da-rv-p">' + esc('Recent means the last ' + recentDays + ' days before ' + asOf + '.') + '</p>' : '')
      + methodNotes(report)
      + '<p class="da-rv-p">' + esc(SCOPE_LINE) + '</p><p class="da-rv-p da-rv-quiet">' + esc(SCOPE_NOTE) + '</p>'
      + '<p class="da-rv-p da-rv-quiet">' + esc(DISCLOSURE) + '</p>';
    return section('evidence', TITLES.evidence, inner);
  }
  /** Compare, Watch, Share and PDF, in the plan's place. Compare is inert until that feature exists (build step 10); Watch (build step 9), Share and
   *  PDF (build step 8) are live where the page asks (opts.live) and hidden where it asks (opts.hide). "Available soon", not "coming soon": the word
   *  "coming" is reserved for the Approved / Coming stage (a proposed item never reads as coming). The note shows only while something is inert. */
  function actionsBar(opts) {
    var live = arr(opts.live), hide = arr(opts.hide), soon = false;
    var buttons = ACTIONS.map(function (label, i) {
      var key = ACTION_KEYS[i];
      if (hide.indexOf(key) >= 0) return '';
      if (live.indexOf(key) >= 0) {
        return '<button type="button" class="da-rv-act da-rv-act--live" data-da-action="' + key + '"' + (key === 'pdf' ? ' title="' + esc(PDF_HINT) + '"' : '') + '>' + esc(label) + '</button>';
      }
      soon = true;
      return '<button type="button" class="da-rv-act" aria-disabled="true">' + esc(label) + '</button>';
    }).join('');
    if (!buttons) return '';
    return '<nav class="da-rv-actions" aria-label="' + esc(TITLES.actions) + '">' + buttons + (soon ? '<span class="da-rv-soon">Available soon</span>' : '') + '</nav>';
  }
  // The address is shown as the caller supplied it. Only when it arrives in ONE case (all capitals or all lower case) is it re-cased for DISPLAY, by one fixed rule: words are
  // capitalised, a street direction (N, SE ...) and the two-letter state directly before a ZIP stay capitals, an ordinal (5th) stays lower, a word with a digit is capitals.
  // The stored address is never changed, no word is added or removed, and a mixed-case address is left exactly as written ("McDonald" and "PO Box" survive that way).
  var DIRECTIONS = { n: 1, s: 1, e: 1, w: 1, ne: 1, nw: 1, se: 1, sw: 1 };
  function displayAddress(a) {
    if (a !== a.toUpperCase() && a !== a.toLowerCase()) return a;
    var words = a.toLowerCase().split(/(\s+|,)/);
    return words.map(function (w, i) {
      if (!/[a-z0-9]/.test(w)) return w;
      if (/^\d+(st|nd|rd|th)$/.test(w)) return w;
      if (/\d/.test(w) || has(DIRECTIONS, w.replace(/\./g, ''))) return w.toUpperCase();
      var nxt = ''; for (var j = i + 1; j < words.length; j++) { if (/[a-z0-9]/.test(words[j])) { nxt = words[j]; break; } }
      if (/^[a-z]{2}$/.test(w) && /^\d{5}(-\d{4})?$/.test(nxt)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join('');
  }
  function header(report, opts) {
    var subject = typeof opts.subject === 'string' ? opts.subject.trim() : '';
    var label = typeof opts.label === 'string' ? opts.label.trim() : '';
    var who = [opts.brokerage, opts.agent].map(function (v) { return typeof v === 'string' ? v.trim() : ''; }).filter(Boolean).join(' · ');
    var bits = [];
    if (typeof report.radius_mi === 'number' && isFinite(report.radius_mi) && report.radius_mi > 0) {
      bits.push('Search radius ' + report.radius_mi + (report.radius_mi === 1 ? ' mile' : ' miles'));
    }
    if (typeof report.zip === 'string' && /^\d{5}$/.test(report.zip)) bits.push('ZIP ' + report.zip);
    var side = (who ? '<p class="da-rv-who">' + esc(who) + '</p>' : '') + (day(report.as_of) ? '<p class="da-rv-gen">' + esc('Generated ' + day(report.as_of)) + '</p>' : '');
    return '<header class="da-rv-head"><div class="da-rv-headmain"><p class="da-rv-eyebrow">' + esc(EYEBROW) + '</p><p class="da-rv-addr">' + esc(subject ? displayAddress(subject) : NO_ADDRESS) + '</p>'
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

  /** Everything the view derives from a response, ONCE: the engine's lists, each record placed in the stage the ENGINE gave it. The report is drawn
   *  from this, and so is the side-by-side comparison (build step 10), which therefore cannot arrive at a count the report itself does not show.
   *  Null for a response that carries no report. Pure: it reads the response and decides nothing. */
  function read(response) {
    if (!renderable(response)) return null;
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
    var history = pick(arr(sec.what_changed_recently).concat(arr(sec.recent_official_activity))).filter(function (p) {
      return detected(p).length > 0 || publisherEvent(p) !== null;
    });
    var some = report.projects.length > 0;
    // A record the engine kept in the report that no stage section carries. Each is a row of the one records table (nothing is drawn nowhere): one the engine's lifecycle
    // says is OPERATING, and one whose lifecycle states nothing and whose stage the agency did not state (listed under its own name, never forced into a stage).
    var operating = [], unstaged = [];
    report.projects.forEach(function (p) {
      if (!isObj(p) || typeof p.project_id !== 'string' || stageFor[p.project_id]) return;
      (lifeKey(p) === 'operating' ? operating : unstaged).push(p);
    });
    return { report: report, legacy: legacy, changed: changed, activity: activity, staged: staged, stageFor: stageFor, numbered: numbered, nums: nums,
      current: current, history: history, some: some, unstaged: unstaged, operating: operating,
      total: current.length + operating.length + unstaged.length };
  }
  /** The client briefing: a SHORT list under the header, from numbers the report already carries and fixed sentences. It names no project, no address and no effect;
   *  it reads m (the same read() the comparison uses), so it cannot disagree with the table below. "Nothing future-stage" and "no recent change" are each said
   *  about THIS report's records, never about the area, and a count of zero changes is kept apart from a count of zero records. */
  function briefing(report, m, response) {
    var s = m.staged, total = m.total;
    if (!total) return '';
    var r = report.radius_mi, asOf = day(report.as_of);
    var where = typeof r === 'number' && isFinite(r) && r > 0 ? ' within ' + r + (r === 1 ? ' mile' : ' miles') + ' of this property' : ' near this property';
    var stageBits = [];
    if (s.permitted.length) stageBits.push(s.permitted.length + ' permitted / under construction');
    if (s.approved.length) stageBits.push(s.approved.length + ' approved / coming');
    if (openProposed(s.proposed).length) stageBits.push(openProposed(s.proposed).length + ' proposed / under review');
    var nDec = s.proposed.length - openProposed(s.proposed).length;
    if (nDec) stageBits.push(nDec + ' decided (denied or withdrawn)');
    if (m.operating.length) stageBits.push(m.operating.length + ' operating / built');
    if (m.unstaged.length) stageBits.push(m.unstaged.length + ' with no stage stated');
    var types = typeCounts(m.current.concat(m.operating, m.unstaged)).map(function (t) { return t.n + ' ' + t.label; });
    var items = [];
    items.push((asOf ? 'As of ' + asOf + ', ' : '') + plural(total, 'official record', 'official records') + where + ': ' + stageBits.join(' · ') + '.'
      + (types.length ? ' Types: ' + types.join(', ') + '.' : ''));
    // Changes: three different facts, kept apart. A change HomeSignal detected; none detected over a window it can measure; or not yet measurable.
    if (m.changed.length) items.push(plural(m.changed.length, 'record shows', 'records show') + ' a recent change in HomeSignal’s history; see Change History.');
    else if (changeReady(report)) items.push('Recent changes: none recorded for ' + (total === 1 ? 'this record' : 'these records') + ', which remain on file.');
    else items.push('Recent changes: none recorded yet. HomeSignal has not observed these records long enough to say whether they changed.');
    var nOld = m.current.concat(m.operating, m.unstaged).filter(function (p) { var rd = recordDateOf(p); return rd && rd.old; }).length;
    if (nOld) items.push((nOld === 1 ? '1 record carries an official date' : nOld + ' records carry official dates') + ' more than a year old: confirm each is still active.');
    if (!s.approved.length && !openProposed(s.proposed).length) items.push('No approved / coming or proposed / under review records are listed. HomeSignal’s sources do not cover every agency, so that is not a statement that nothing is planned nearby.');
    items.push('Verify the schedule and project details at the official source before a listing, showing or offer.');
    return '<p class="da-rv-brieflab">' + esc(BRIEFING_TITLE) + '</p><ul class="da-rv-brief" data-da-briefing>'
      + items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
      + '<p class="da-rv-p da-rv-quiet" data-da-caution>' + esc(BRIEFING_CAUTION) + '</p>';
  }
  function html(response, opts) {
    var m = read(response);
    if (!m) return '';
    opts = isObj(opts) ? opts : {};
    var report = m.report, current = m.current, history = m.history, some = m.some;
    // ONE order, once: header, the short briefing, the Type and Stage filters (screen only), the one table of records (with its single block of supporting evidence),
    // the map, what changed, the coverage and method, and the actions. Nothing is shown twice: the table row holds the name, Type, distance, stage and impact, and the
    // evidence block holds only what the row does not.
    var parts = [header(report, opts)];
    if (m.total) parts.push(briefing(report, m, response));
    if (!some) parts.push(outcomeSection(report));
    if (m.total) parts.push(filtersSection(current.concat(m.operating, m.unstaged), m));
    if (m.total) parts.push(recordsSection(m, response, opts.showLifecycle === true));
    if (current.length) parts.push(mapSection(m.numbered, response, report));
    if (some) parts.push(historySection(history, report));
    parts.push(evidenceSection(report));
    if (some) parts.push(actionsBar(opts));
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
      // the table and the evidence follow their rows: when the filters leave none, neither is drawn empty, and the section says so
      var sec = el.querySelector('.da-rv-sec--records');
      if (sec) {
        var rows = sec.querySelectorAll('.da-rv-table tbody tr'), shownRows = 0;
        for (var r = 0; r < rows.length; r++) if (!rows[r].hasAttribute('hidden')) shownRows++;
        var wrap = sec.querySelector('.da-rv-tablewrap'), det = sec.querySelector('.da-rv-detail'), note = sec.querySelector('.da-rv-nomatch');
        var empty = rows.length > 0 && shownRows === 0;
        if (wrap) { if (empty) wrap.setAttribute('hidden', ''); else wrap.removeAttribute('hidden'); }
        if (det) { if (empty) det.setAttribute('hidden', ''); else det.removeAttribute('hidden'); }
        if (note) { if (empty) note.removeAttribute('hidden'); else note.setAttribute('hidden', ''); }
      }
    }
    // Print: the cards sit in a closed detail on screen, and a printed report is the whole report. The stylesheet shows the content of a closed
    // detail in print; this opens every detail around the print dialog as well, for a browser whose CSS cannot, and puts them back afterwards.
    var win = el.ownerDocument && el.ownerDocument.defaultView;
    if (win && win.addEventListener && !el.__daPrintHook) {
      el.__daPrintHook = true;
      var forced = [];
      win.addEventListener('beforeprint', function () {
        forced = [];
        var ds = el.querySelectorAll('.da-rv-detail');
        for (var d = 0; d < ds.length; d++) if (!ds[d].open) { ds[d].open = true; forced.push(ds[d]); }
      });
      win.addEventListener('afterprint', function () {
        for (var f = 0; f < forced.length; f++) forced[f].open = false;
        forced = [];
      });
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
    '.da-rv-tablewrap{margin:0 0 12px}',
    '.da-rv-table{width:100%;border-collapse:collapse;font-size:13.5px;color:var(--rv-ink2)}',
    '.da-rv-table th,.da-rv-table td{text-align:left;vertical-align:top;padding:9px 10px;border-bottom:1px solid var(--rv-line)}',
    '.da-rv-table thead th{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--rv-ink2)}',
    // a column heading is never broken inside a word ("DISTAN / CE"): the page's overflow-wrap:anywhere would otherwise let a narrow table squeeze it
    '.da-rv-table thead th{overflow-wrap:normal;word-break:normal;hyphens:none;white-space:nowrap}',
    // three columns: the impact column gets the most room; words wrap at spaces (never mid-word) because the page's overflow-wrap:anywhere is overridden here
    '.da-rv-table{table-layout:fixed}.da-rv-th--dev{width:31%}.da-rv-th--stage{width:27%}.da-rv-th--qol{width:42%}',
    '.da-rv-table thead th.da-rv-th--qol{white-space:normal}',
    '.da-rv-table th,.da-rv-table td{overflow-wrap:break-word;word-break:normal;hyphens:none}',
    '.da-rv-td--dev{font-weight:400;color:var(--rv-ink)}.da-rv-name{display:block;font-weight:700;color:var(--rv-ink)}',
    '.da-rv-sub{display:block;font-size:12.5px;color:var(--rv-ink2);margin-top:2px}.da-rv-sub--src{margin-top:4px}',
    '.da-rv-td--stage .da-rv-stage{display:inline-flex;align-items:center;gap:6px;font-weight:700;color:var(--rv-ink)}.da-rv-td--stage .da-rv-shape{flex:none}',
    '.da-rv-lab{display:none}',
    '.da-rv-detail{margin-top:6px}',
    '.da-rv-sum{cursor:pointer;font-size:13.5px;font-weight:700;color:var(--rv-deep);min-height:40px;padding:8px 0}',
    '.da-rv-sum:focus-visible{outline:3px solid var(--rv-green);outline-offset:2px;border-radius:3px}',
    '.da-rv-title{font-size:15px;font-weight:700;letter-spacing:-.01em;margin:0 0 8px!important}',
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
    '.da-rv-brieflab{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--rv-deep);margin:0 0 6px!important}',
    '.da-rv-corridor{font-size:13.5px;color:var(--rv-ink2);margin:0 0 10px!important}',
    '.da-rv-method{margin:0 0 6px}.da-rv-method .da-rv-p{margin:0 0 8px!important}',
    '.da-rv-brief{font-size:14.5px;line-height:1.5;color:var(--rv-ink);margin:0 0 6px!important;padding:10px 14px 10px 30px;border-left:4px solid var(--rv-deep);background:var(--rv-tint);border-radius:0 10px 10px 0}',
    '.da-rv-brief li{margin:0 0 4px}.da-rv-brief li:last-child{margin:0}',
    '.da-rv-frow{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 12px;margin:0 0 10px}',
    '.da-rv-flab{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--rv-ink2);min-width:46px}',
    '.da-rv-chips{display:flex;flex-wrap:wrap;gap:8px}',
    '.da-rv-chip{font:inherit;font-size:13px;font-weight:600;min-height:36px;padding:6px 12px;border-radius:999px;border:1px solid var(--rv-line);background:#fff;color:var(--rv-ink2);cursor:pointer}',
    '.da-rv-chip[aria-pressed="true"]{background:var(--rv-deep);border-color:var(--rv-deep);color:#fff}',
    '.da-rv-chip:focus-visible{outline:3px solid var(--rv-green);outline-offset:2px}',
    '.da-rv-chipn{font-weight:500;opacity:.8}',
    '.da-rv-mapwrap{display:flex;flex-wrap:wrap;align-items:flex-start;gap:14px 24px}',
    '.da-rv-plot{width:100%;height:auto;background:#f6f8f6;border:1px solid var(--rv-line);border-radius:12px}',
    // the diagram is sized to what it holds: a handful of records get a compact one beside its legend; a larger report gets the full one
    '.da-rv-plot--sm{max-width:300px}.da-rv-plot--lg{max-width:400px}',
    '.da-rv-evlist{list-style:none;padding:0;margin:0;display:grid;gap:8px}',
    '.da-rv-evrec{min-width:0;border:1px solid var(--rv-line);border-radius:10px;padding:10px 12px}',
    '.da-rv-evtitle{font-size:14px;font-weight:700;margin:0 0 4px!important}.da-rv-evnum{color:var(--rv-deep)}',
    '.da-rv-stale{color:var(--rv-ink);font-size:12px}.da-rv-stale b{color:var(--rv-amber)}',
    // Stage column: plain dark semibold text. Beats the badge rules above and below (higher specificity), so no fill, border, radius or padding survives,
    // in any stage (including Decided) and in print. Long names wrap at spaces; the agency line and Verify sit beneath with clear spacing.
    '.da-rv-td--stage .da-rv-stage,.da-rv-td--stage .da-rv-life,.da-rv-td--stage .da-rv-stage.da-rv-decided,.da-rv-td--stage .da-rv-stage.da-rv-stage--approved,.da-rv-td--stage .da-rv-stage.da-rv-stage--proposed,.da-rv-td--stage .da-rv-stage.da-rv-stage--permitted,.da-rv-td--stage .da-rv-life--approved,.da-rv-td--stage .da-rv-life--proposed,.da-rv-td--stage .da-rv-life--operating,.da-rv-td--stage .da-rv-life--unknown{display:block;background:none;border:0;border-radius:0;padding:0;box-shadow:none;font-size:1em;font-weight:600;line-height:1.35;color:var(--rv-ink);text-align:left;overflow-wrap:break-word;margin-top:2px}',
    '.da-rv-td--stage .da-rv-sub{margin-top:5px;line-height:1.4}.da-rv-td--stage .da-rv-sub+.da-rv-sub{margin-top:4px}',
    '.da-rv-evlist{grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr))}',
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
    '.da-rv-stage.da-rv-decided{color:var(--rv-red,#8a2a1f);border-style:solid;background:#fdf1ef}',
    '.da-rv-decidednote{color:var(--rv-red,#8a2a1f);font-weight:600}',
    '.da-rv-stage--permitted{color:var(--rv-deep)}',
    '.da-rv-stage.da-rv-stage--permitted{color:#fff;background:var(--rv-deep);border-color:var(--rv-deep)}',
    '.da-rv-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding-top:20px;border-top:1px solid var(--rv-line)}',
    '.da-rv-act{font:inherit;font-size:13.5px;font-weight:600;min-height:40px;padding:8px 14px;border-radius:10px;border:1px solid var(--rv-line);background:#fff;color:var(--rv-ink2);cursor:not-allowed}',
    '.da-rv-act:focus-visible{outline:3px solid var(--rv-green);outline-offset:2px}',
    '.da-rv-act--live{color:var(--rv-ink);border-color:var(--rv-deep);cursor:pointer}',
    '.da-rv-act--live:hover{background:var(--rv-tint)}',
    '.da-rv-soon{font-size:12.5px;color:var(--rv-ink2)}',
    // LAYOUT PASS 2026-10-09 (screen only; the print block below owns the paper layout): a wider reading column, headings a reader can find, and
    // section separation. CSS only: no markup, wording or data changes.
    '@media screen{',
    '.da-rv{padding:36px 44px 40px;border-radius:16px;font-size:15.5px;line-height:1.6}',
    '.da-rv-head{padding-bottom:24px;border-bottom:3px solid var(--rv-deep)}',
    '.da-rv-eyebrow{font-size:12.5px;letter-spacing:.08em}',
    '.da-rv-addr{font-size:30px;line-height:1.2;letter-spacing:-.02em;margin:8px 0 6px!important}',
    '.da-rv-meta{font-size:14px;font-weight:600;margin-top:4px!important}',
    '.da-rv-brieflab{margin:22px 0 8px!important}',
    '.da-rv-sec{padding:36px 0 4px;margin-top:8px}',
    '.da-rv-h2{font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-.015em;text-transform:none;color:var(--rv-ink);margin:0 0 16px!important;padding-left:12px;border-left:4px solid var(--rv-green)}',
    '.da-rv-hero{background:#f6f9f7;border:1px solid var(--rv-line);border-radius:14px;padding:26px 28px 22px;margin-top:28px}.da-rv-hero .da-rv-h2{font-size:20px}',
    '.da-rv-metric b{font-size:34px}',
    '.da-rv-tablewrap{margin:0 0 16px;border:1px solid var(--rv-line);border-radius:12px;overflow:hidden}',
    '.da-rv-table{font-size:14px;line-height:1.5}',
    '.da-rv-table th,.da-rv-table td{padding:16px 18px 16px 14px}.da-rv-table tbody tr:last-child>*{border-bottom:0}',
    '.da-rv-table thead th{background:#f6f9f7;border-bottom:2px solid var(--rv-line)}',
    '.da-rv-title{font-size:16.5px;line-height:1.35;font-weight:600;margin:0 0 10px!important}',
    '.da-rv-card,.da-rv-hist{padding:18px 20px}.da-rv-histlist{gap:16px}',
    '.da-rv-mapwrap{gap:20px 32px;margin-bottom:12px}',
    '.da-rv-legend{margin:0;padding:16px 20px;gap:10px;font-size:14px;border:1px solid var(--rv-line);border-radius:12px;background:#fff;min-width:230px}',
    '.da-rv-method{margin:0 0 14px;border-top:1px solid var(--rv-line)}.da-rv-method .da-rv-p{margin:0!important;padding:12px 0;border-bottom:1px solid var(--rv-line);display:grid;grid-template-columns:190px 1fr;gap:4px 20px}',
    '.da-rv-lims{padding-left:20px;margin:0 0 14px!important}.da-rv-sec--evidence{padding-bottom:20px}.da-rv-sec--evidence>.da-rv-p{max-width:78ch}',
    '.da-rv-sec>.da-rv-quiet{margin-top:12px!important}',
    '.da-rv-actions{margin-top:40px;padding-top:24px;border-top:3px solid var(--rv-line)}',
    '}',
    '@media(max-width:620px){.da-rv{padding:20px 16px 24px;border-radius:12px}.da-rv-addr{font-size:22px}.da-rv-h2{font-size:19px}.da-rv-hero{padding:18px 16px 14px}.da-rv-method .da-rv-p{display:block}.da-rv-tablewrap{border:0;border-radius:0}.da-rv-metrics{gap:10px 24px}.da-rv-side{text-align:left}',
    // a table that would shrink unreadably becomes one block per record (plan line 1072); the header row is read by screen readers only
    '.da-rv-table thead,.da-rv-table thead tr,.da-rv-table thead th{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '.da-rv-table,.da-rv-table tbody,.da-rv-table tr,.da-rv-table td,.da-rv-table th[scope=row]{display:block;width:100%}',
    '.da-rv-table tr{border:1px solid var(--rv-line);border-radius:10px;padding:6px 10px;margin:0 0 10px}',
    '.da-rv-table td,.da-rv-table th[scope=row]{border-bottom:0;padding:4px 0}',
    '.da-rv-table{table-layout:auto}.da-rv-td--dev{font-size:15px}',
    '.da-rv-lab{display:inline;font-weight:700;color:var(--rv-ink)}}',
    // PRINT (build step 8: "Download PDF" is the browser's print window). The printed report is the whole report, not the screen's filter state:
    // the buttons and the filters are gone, every card is shown, no section or card is split across pages, the stage and lifecycle colours print,
    // and each official link shows its address so the paper copy still leads to the record.
    '@media print{',
    // the page itself: a real margin (the browser draws its own header and footer in it unless the person turns "Headers and footers" off) and, in browsers that
    // support page margin boxes, HomeSignal's own footer with the page number
    '@page{margin:12mm 12mm 14mm;@bottom-left{content:"HomeSignal Development Activity report";font:9px sans-serif;color:#555}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:9px sans-serif;color:#555}}',
    'html,body{background:#fff!important}',
    '.da-rv{border:0;border-radius:0;padding:0;background:#fff;color:#000;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '.da-rv-actions,.da-rv-sec--filters,.da-rv-nomatch{display:none!important}',
    // what the filters hid on screen prints: a printed report is the whole report
    '.da-rv tr[data-da-stage][hidden]{display:table-row!important}.da-rv li[data-da-stage][hidden]{display:list-item!important}.da-rv .da-rv-tablewrap[hidden],.da-rv .da-rv-detail[hidden]{display:block!important}',
    // pages: no record, history entry or the header is split; a heading is kept with what follows it; the table header repeats; sections flow (no forced blank space)
    '.da-rv-evrec,.da-rv-hist,.da-rv-head,.da-rv-brief,.da-rv-sec--map,.da-rv-table tr{break-inside:avoid;page-break-inside:avoid}',
    '.da-rv-brieflab,.da-rv-h2{break-after:avoid;page-break-after:avoid}',
    '.da-rv-table thead{display:table-header-group}',
    '.da-rv-sec{padding:6px 0}.da-rv-table th,.da-rv-table td{padding:6px 8px}',
    '.da-rv-detail>.da-rv-sum{display:none}.da-rv-detail::details-content{content-visibility:visible;display:block}',
    '.da-rv-evlist{gap:6px;grid-template-columns:repeat(auto-fill,minmax(2.1in,1fr))}.da-rv-evrec{padding:6px 9px;font-size:11px}',
    '.da-rv-sub{font-size:11.5px}.da-rv-table{font-size:12px}.da-rv-brief{font-size:12px;padding:8px 12px 8px 26px}',
    '.da-rv-method .da-rv-p,.da-rv-lims,.da-rv-quiet,.da-rv-p{font-size:11px}',
    '.da-rv-mapwrap{flex-wrap:nowrap;align-items:center;gap:16px}.da-rv-plot--sm{max-width:1.8in}.da-rv-plot--lg{max-width:2.6in}',
    '.da-rv a{text-decoration:underline}',
    '}'
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
    read: read,
    typeCounts: typeCounts,
    TYPE_ORDER: TYPE_CHIP_ORDER,
    outcomeText: outcomeText,
    describe: describe,
    changeReady: changeReady,
    CHANGE_NOT_READY: CHANGE_NOT_READY,
    limitationsOf: limitationsOf,
    outcomeKeyOf: outcomeKeyOf,
    util: { esc: esc, day: day, txt: txt, isObj: isObj, arr: arr, plural: plural, NO_ADDRESS: NO_ADDRESS, openProposed: openProposed, DECIDED_LABEL: DECIDED_LABEL },
    CSS: CSS,
    TITLES: TITLES,
    OUTCOMES: OUTCOMES,
    DISCLOSURE: DISCLOSURE,
    SCOPE_LINE: SCOPE_LINE,
    SCOPE_NOTE: SCOPE_NOTE,
    EYEBROW: EYEBROW,
    ACTION_KEYS: ACTION_KEYS,
    PDF_HINT: PDF_HINT,
    qolImpact: qolImpact,
    displayAddress: displayAddress
  };
})(typeof window !== 'undefined' ? window : globalThis);
