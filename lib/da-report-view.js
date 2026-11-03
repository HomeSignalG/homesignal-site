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
  var BRIEFING_CAUTION = 'This briefing reports what official records say and where they are. It is not a prediction about value, traffic or the character of the neighborhood. Describe the records, not the people who may live or work nearby, and do not use them to steer a client toward or away from an area.';
  var EYEBROW = 'JODY Development Activity';                       // founder 2026-10-14 (audit F4): the new product name; replaces ruling R6's HOMESIGNAL DEVELOPMENT ACTIVITY. The engine's product identifier is unchanged until the next edge-function deploy.
  var TITLES = {                                                          // 100526 plan, ruling 3 and the visual layout contract; layout pass 2026-10-09
    records: 'Nearby Development',
    filters: 'Type and stage',
    map: 'Development Activity Map',
    overview: 'Most significant nearby changes',
    approved: 'Approved',
    proposed: 'Proposed / Under review',
    permitted: 'Permit issued / Under construction',
    occupancy: 'Approved for occupancy',               // national-6 (founder, 2026-11-02): business opening not verified; a temporary authorization says so on its row
    operating: 'Completed (agency record)',
    unstaged: 'Stage not stated',
    history: 'Change History',
    evidence: 'Official evidence & coverage',
    actions: 'Report actions'
  };

  // The three stage sections, in the plan's order (ruling 3). The keys are the engine's (`sections.by_stage`).
  var STAGES = ['approved', 'proposed', 'permitted', 'occupancy'];
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
  var DISCLOSURE = 'Jody summarizes selected official public records available to its covered sources. It may not include every project or change and is not a substitute for independent property, municipal, title, zoning, legal, inspection, or other professional due diligence.';
  var SCOPE_LINE = 'Planned, approved, permitted and changing development found in Jody\'s covered official sources.';
  var SCOPE_NOTE = 'This report focuses on development activity and change. It is not an inventory of existing schools, parks, businesses, buildings, or neighborhood amenities.';
  // What a report with no projects says, keyed by the ENGINE's outcome (report.activity.outcome; founder ruling R5, 2026-10-02,
  // docs/development-activity-founder-ruling-r5-2026-10-02.md). The titles are the founder's words. The view never decides the outcome:
  // it shows the engine's, and only when the report really carries no projects.
  var OUTCOMES = {
    NO_DATA_INGESTED: {
      title: 'No data ingested',
      body: 'Jody cannot yet confirm it receives official development records for this address, so this report cannot say whether there is development nearby. It is not a finding that there is no development.'
    },
    NO_DEVELOPMENT_ACTIVITY: {
      title: 'No development activity',
      body: 'Jody\'s official development records for this address are coming in, and they show no development'
    },
    // activity-outcome-2 (founder, 2026-11-02): records were read and every one was left out. The body is built from the engine's counts.
    NO_SIGNIFICANT_CHANGES: {
      title: 'No significant nearby changes found',
      body: 'None documents a change the neighborhood would notice.'
    }
  };
  /** The sentence about what Jody read, from the engine's own counts (report.activity.records_judged). '' when they are missing or do not add up. */
  /** The engine's counts of the records it read and left out (activity.records_judged), or null. The one reader of that field. */
  function judgedOf(report) {
    var a = isObj(report.activity) ? report.activity : null;
    return a && isObj(a.records_judged) ? a.records_judged : null;
  }
  function judgedText(j, where) {
    var n = function (v) { return typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v ? v : -1; };
    if (!j) return '';
    var t = n(j.total), r = n(j.routine), u = n(j.undescribed), e = n(j.temporary_ended);
    if (t < 1 || r < 0 || u < 0 || e < 0 || r + u + e !== t) return '';
    var out = 'Jody checked ' + t + ' official record' + (t === 1 ? '' : 's') + ' ' + where + '. ';
    if (r === t) return out + (t === 1 ? 'It describes' : 'All of them describe') + ' routine work, such as interior remodels, repairs and office fit-outs.';
    var bits = [];
    if (r) bits.push(r + (r === 1 ? ' describes' : ' describe') + ' routine work, such as interior remodels, repairs and office fit-outs');
    if (u) bits.push(u + (u === 1 ? ' does' : ' do') + ' not say what the work is, or when a temporary activity takes place');
    if (e) bits.push(e + (e === 1 ? ' was a temporary activity that has' : ' were temporary activities that have') + ' ended');
    return out + bits.join('; ') + '.';
  }
  var NO_ADDRESS = 'Address unavailable';
  // The brand line every report carries, on screen and on paper (universal corrections, 2026-11-02: "Include https://jodytracks.com").
  var BRAND_LINE = 'JODY Tracks \u00b7 https://jodytracks.com';                                 // contract §5: a purged report shows the address as unavailable
  var NO_NAME = 'Unnamed record';
  var NOT_STATED = 'not stated';

  // The ledger's own event vocabulary (a CHECK constraint in docs/dev-change-ledger.sql). A value outside it is never shown raw.
  var EVENT_LABELS = {
    first_detected: 'Newly detected record',
    status_changed: 'Agency status change',
    source_record_updated: 'Source record updated'
  };
  var EVENT_UNKNOWN = 'Change detected';
  // The 14 facts the ledger judges a change on (docs/dev-change-ledger.sql dev_change_facts), in plain words.
  var FIELD_LABELS = {
    name: 'Project name', type: 'Jody Type', type_raw: 'Publisher type', status: 'Jody status', stage: 'Publisher stage',
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
    permitted: SVG_OPEN + '<rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" stroke="currentColor" stroke-width="1.5"/></svg>',
    // national-6: occupancy approved is a hollow square (the work reached occupancy approval; it is not drawn as operating)
    occupancy: SVG_OPEN + '<rect x="2" y="2" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
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
  /** A record's title as the engine gave it. When the engine says the source feed shortened it (`title_cut`, national-4), it ends in an
   *  ellipsis so it never reads as the whole description; nothing in it is removed or reworded. */
  function titleOf(p) { var t = txt(p.name).replace(/\s+/g, ' '); return t ? (p.title_cut === true ? cutAtWord(t, t.length) : t) : NO_NAME; }
  /** A text cut back to the last whole word at or before `max` characters, with an ellipsis. A feed-shortened title is never shown ending mid-word. */
  function cutAtWord(t, max) {
    var head = t.slice(0, max), sp = head.lastIndexOf(' ');
    if (t.length > max || /[A-Za-z0-9]$/.test(head)) head = sp > 20 ? head.slice(0, sp) : head;
    return head.replace(/[\s,;:.\-(\[]+$/, '') + '\u2026';
  }
  /** The concise title a row leads with: the record's own description, without a leading copy of the agency's class word (shown on its own line), cut at
   *  a word boundary when it is long. The full description is printed as "Documented scope" in the same row, so nothing is lost. */
  var TITLE_MAX = 90;
  function shortTitle(p) {
    var t = titleOf(p), cls = txt(p.publisher_type);
    if (cls && t.toLowerCase().indexOf(cls.toLowerCase() + ' ') === 0 && t.length > cls.length + 8) t = t.slice(cls.length + 1);
    t = t.charAt(0).toUpperCase() + t.slice(1);
    // the first sentence when it carries the point on its own, without the agency's boilerplate "per plan" tail
    var TAIL = /\s+(occupy\s+)?per plans?\.?$/i;
    var first = t.split(/\.\s/)[0].replace(TAIL, '').replace(/\.$/, '');
    if (first.length >= 25 && first.length < t.length) t = first;
    else t = t.replace(TAIL, '');
    return t.length > TITLE_MAX ? cutAtWord(t.replace(/\u2026$/, ''), TITLE_MAX) : t;
  }
  /** The record's own street address, compared without case or punctuation, so records at one address can be cross-referenced. '' when none. */
  function addrKey(p) { return wordsOf(p.address); }
  /** The agency's own record number, when the engine verified it against the record's official link (national-4). '' otherwise. */
  function recordIdOf(p) { var s = isObj(p.source) ? p.source : {}; return txt(s.record_id); }
  /** Routine work a report saved under national-4 or national-5 still carries (`scope.key === 'minor_work'`). Since national-6 the engine leaves routine
   *  work out of the report entirely; for an older saved report the view leaves it out too, so no customer surface shows it (universal corrections,
   *  2026-11-02: "Remove the Minor Building Work section entirely"). It is never counted, mapped, listed or briefed. */
  function isMinor(p) { return isObj(p.scope) && p.scope.key === 'minor_work'; }
  /** The title as a row shows it: when two records in this report carry the same title, the agency's record number tells them apart. */
  function shownTitle(p, dup) {
    var id = recordIdOf(p);
    return shortTitle(p) + (dup && dup[shortTitle(p)] && id ? ' (record ' + id + ')' : '');
  }
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
    // The engine judges freshness on the record's LATEST OFFICIAL DATE and its stage (national-report.ts `verification`): `verify` is null when nothing needs
    // checking, or { reason: 'old_date' | 'filing_only' }. A report saved before that rule has no `verify`, and then the old flag (the date alone) stands.
    // A `verify` that is neither null nor an object is not trusted: the old flag decides, so a malformed value can never silence a warning.
    var v = e.verify, judged = v === null || isObj(v);
    return { label: txt(e.label), date: day(e.date), old: judged ? isObj(v) : e.older_than_a_year === true,
      filingOnly: isObj(v) && v.reason === 'filing_only' };
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

  /** The stage the engine gave a record ('approved' | 'proposed' | 'permitted' | 'occupancy'), or '' when it is in no stage section. */
  function stageKey(p) { var k = isObj(p.stage) ? p.stage.key : ''; return typeof k === 'string' && has(STAGE_SHAPES, k) ? k : ''; }
  // A "Decided" application was denied or withdrawn (CLAUDE.md 7.05). The engine files it under the Proposed stage on purpose (the shared lifecycle authority,
  // lib/project-type.js, is also Map 1's), so the REPORT says it plainly here: from the publisher's own status, which every response and every saved report carries.
  // The status word on a card is the one HomeSignal's own record carries for the source record (Proposed, Approved, Decided, On file), not the agency's text:
  // the agency's own words are the stage line. The label says whose it is (audit 2026-10-07, finding 4).
  // WHOSE WORD IS WHOSE (measured on production app_projects, 2026-10-11, 29,546 sampled development rows): `stage` holds the SOURCE AGENCY's own word (299 distinct
  // values: 'Under Construction', 'Advertised', 'Denied' ...) and `status` holds only HomeSignal's four lifecycle buckets (Operating, Approved, Proposed, Decided).
  // The engine's `publisher_stage` is therefore the agency's status and `publisher_status` is HomeSignal's lifecycle bucket, whatever their names say. The Stage column is
  // HomeSignal's stage; the agency's word is labelled as the source agency's. The bucket is HomeSignal's own layer under the stage and is NOT printed on the customer
  // card (build-steps 491: the lifecycle line was taken out of the customer view because beside the agency's word it read as a contradiction); the internal view still
  // prints it (opts.showLifecycle) and the response still carries it.
  var AGENCY_LABEL = 'Source agency status';
  /** national-5: the source publishes no status of its own (the engine's `publisher_stage_unpublished`), so none is printed as the agency's. */
  var NO_AGENCY_STATUS = 'The agency publishes no status for this record.';
  /** Words with no case, punctuation or spacing, so 'Under Construction' and 'under-construction' are the same words. */
  function wordsOf(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function sameWords(a, b) { var x = wordsOf(a); return !!x && x === wordsOf(b); }
  /** The stage wording this record's Stage cell prints for HomeSignal: its stage label, its lifecycle label when it is operating, or "Stage not stated". */
  function shownStageText(p, k) {
    return k && k !== 'operating' ? stageLabelOf(p, k) : lifeKey(p) === 'operating' ? TITLES.operating : 'Stage not stated';
  }
  /** A temporary occupancy authorization (the engine's evidence "Temporary occupancy approved", or the agency's own "TCO" / "Temporary C of O" in a report saved
   *  before that evidence existed). It keeps the word temporary wherever the record is named. */
  function isTemporaryOccupancy(p) {
    return /temporary/i.test(isObj(p.stage) ? txt(p.stage.evidence) : '') || /\btco\b|\btemporary\b/i.test(txt(p.publisher_stage));
  }
  /** What the agency's word behind a Permit issued / Under construction record says: 'under_construction' only when it says work is under way. */
  function permitEvidence(p) { return /under construction|construction/i.test(isObj(p.stage) ? txt(p.stage.evidence) : '') ? 'under_construction' : 'permit_issued'; }
  var DECIDED_LABEL = 'Decided (denied or withdrawn)';
  function isDecided(p) { return txt(p.publisher_status).toLowerCase() === 'decided'; }
  /** The stage wording, decided HERE for every report (an older saved report's stored label, e.g. "Approved / Coming", is not reprinted: "coming" predicted
   *  that approved work will happen, and "Permitted / Under Construction" put an issued permit and started work in one label). */
  var STAGE_WORDS = { approved: 'Approved', proposed: 'Proposed / Under review' };
  function stageLabelOf(p, k) {
    if (k === 'proposed' && isDecided(p)) return DECIDED_LABEL;
    if (k === 'permitted') return permitEvidence(p) === 'under_construction' ? 'Under construction' : 'Permit issued';
    if (k === 'occupancy') return (isTemporaryOccupancy(p) ? 'Temporary occupancy approved' : 'Approved for occupancy') + ' \u2014 business opening not verified';
    return STAGE_WORDS[k] || TITLES[k] || '';
  }
  /** One plain sentence under a stage saying what that stage does NOT establish, or the activity dates the agency stated. '' when there is nothing to add. */
  function stageNote(p, k) {
    var w = isObj(p.activity_window) ? p.activity_window : null, notes = [];
    if (w && day(w.end) && w.ended === true) notes.push('The agency lists activity dates ending ' + day(w.end) + '; that date has passed.');
    else if (w && (day(w.start) || day(w.end))) notes.push((w.status === 'upcoming' ? 'Upcoming temporary activity. ' : w.ended === true || !w.status ? '' : 'Temporary activity under way. ')
      + 'Activity dates documented in the record, including any set-up and removal: ' + [day(w.start), day(w.end)].filter(function (d, i, a) { return d && a.indexOf(d) === i; }).join(' to ') + '.');
    else if (basisOf(p) === 'temporary_event') notes.push('Temporary activity. The record states no activity dates, so it may already have taken place.');
    if (k === 'permitted' && permitEvidence(p) === 'permit_issued') notes.push('An issued permit does not confirm that construction has started.');
    if (k === 'approved') notes.push('Approval is not a construction permit or a start of work.');
    if (k === 'occupancy') notes.push((isTemporaryOccupancy(p) ? 'The agency authorized occupancy for a limited time. ' : '') + 'An occupancy approval does not confirm that a business is open or the space is in use.');
    if (k === 'operating') notes.push('The agency\u2019s record is completed or closed. That does not confirm a building is occupied or a business is open.');
    return notes.join(' ');
  }
  /** The engine's relevance basis for a record (national-6), or '' for a report saved before it. */
  function basisOf(p) { var b = isObj(p.relevance) ? p.relevance.basis : ''; return typeof b === 'string' && /^[a-z_]+$/.test(b) ? b : ''; }
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
      + '<span class="da-rv-lifetext">' + esc(k === 'operating' ? TITLES.operating : lifeLabel(p)) + '</span></span>';
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
  /** Whose record it is: the source's credit line when the rights registry gives one, otherwise the publishing agency and its dataset from the
   *  source registry (national-4 `source.agency` / `source.feed_ref`), in the same form. '' only when the engine states neither. */
  function agencyOf(p) {
    var s = isObj(p.source) ? p.source : {}, att = txt(s.attribution), ag = txt(s.agency), ds = txt(s.feed_ref);
    if (att) return att;
    return ag ? ag + (ds ? ' (' + ds + ').' : '.') : '';
  }
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
    var r = report.radius_mi, where = typeof r === 'number' && isFinite(r) && r > 0 ? 'within ' + r + (r === 1 ? ' mile' : ' miles') + ' of this property' : 'near this property';
    if (key === 'NO_DEVELOPMENT_ACTIVITY') body += ' ' + where + '.';
    if (key === 'NO_SIGNIFICANT_CHANGES') {
      var jr = judgedOf(report), j = judgedText(jr, where), lim = isObj(report.coverage) && Array.isArray(report.coverage.limitations) ? report.coverage.limitations : [];
      body = (j ? j + ' ' : 'Jody read the official records ' + where + ' and left every one out. ') + body;
      if (isObj(jr) && typeof jr.undescribed === 'number' && jr.undescribed > 0) body += ' A record that does not describe its work could still matter: check it at its official source.';
      if (lim.length) body += ' Not every source was read in full, so this is not a complete answer; see Official evidence & coverage.';
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
  /** The line under the filters saying what they leave shown. It prints, so a PDF says which filters were on when it was saved.
   *  picked: the labels of the pressed chips other than "All", in order (Type first, then Stage). */
  function fnowText(picked, shown, total) {
    if (!picked.length) return 'Showing all ' + plural(total, 'record', 'records') + '.';
    return 'Showing ' + picked.join(' \u00b7 ') + ': ' + shown + ' of ' + plural(total, 'record', 'records') + '.';
  }
  /** Type and Stage, two separate controls. They change what is SHOWN (on screen and in the PDF), never the saved report. */
  function filtersSection(current, m) {
    var seen = typesSeen(current);
    var types = chip('type', 'all', 'All', current.length, true) + TYPE_CHIP_ORDER.map(function (k) {
      var label = typeLabelFor(k, seen);
      if (!label || (k === 'other' && !seen[k])) return '';
      return chip('type', k, label, seen[k] ? seen[k].n : 0, false);
    }).join('');
    var stages = chip('stage', 'all', 'All', current.length, true) + STAGES.map(function (k) {
      if (k === 'occupancy' && !m.staged[k].length) return '';             // national-6: shown only when the report has one, so other reports are unchanged
      return chip('stage', k, TITLES[k], m.staged[k].length, false);
    }).join('') + (m.operating.length ? chip('stage', 'operating', TITLES.operating, m.operating.length, false) : '');
    return section('filters', TITLES.filters,
      '<div class="da-rv-frow"><span class="da-rv-flab" aria-hidden="true">Type</span><div class="da-rv-chips" role="group" aria-label="Type">' + types + '</div></div>'
      + '<div class="da-rv-frow"><span class="da-rv-flab" aria-hidden="true">Stage</span><div class="da-rv-chips" role="group" aria-label="Stage">' + stages + '</div></div>'
      + '<p class="da-rv-p da-rv-fnow" data-da-fnow>' + esc(fnowText([], current.length, current.length)) + '</p>'
      + '<p class="da-rv-p da-rv-quiet">The filters change what is shown in the table, on the map and in the PDF. They do not change the saved report.</p>');
  }
  /** The map's fixed labels, as boxes a marker must not cover: the two ring labels, the compass letters, the property and its label. */
  function mapObstacles(C, R) {
    return [[C + 2, C - R - 16, C + 40, C - R], [C + 2, C - R / 2 - 16, C + 40, C - R / 2], [C - 8, 2, C + 8, 18], [2 * C - 18, C - 8, 2 * C - 2, C + 8],
      [C - 8, 2 * C - 18, C + 8, 2 * C - 2], [2, C - 8, 18, C + 8], [C - 10, C - 10, C + 10, C + 10], [C - 26, C + 12, C + 26, C + 26]];
  }
  /** Spreads markers whose numbers would overlap, by the least movement needed, so every number is readable. Deterministic (fixed order and
   *  passes), pure, and bounded: a marker never leaves the plot. Each point gets px/py; x0/y0 (its true spot) are kept for the leader line. */
  var MARK_GAP = 20;
  function spreadMarks(pts, boxes) {
    pts.forEach(function (q) { q.px = q.x0; q.py = q.y0; });
    for (var pass = 0; pass < 240; pass++) {
      var moved = false;
      for (var i = 0; i < pts.length; i++) {
        for (var j = i + 1; j < pts.length; j++) {
          var a = pts[i], b = pts[j], dx = b.px - a.px, dy = b.py - a.py, d = Math.sqrt(dx * dx + dy * dy);
          if (d >= MARK_GAP) continue;
          if (d < 0.01) { var ang = (j * 2.39996) % (2 * Math.PI); dx = Math.cos(ang); dy = Math.sin(ang); d = 1; } else { dx /= d; dy /= d; }
          var push = (MARK_GAP - d) / 2 + 0.05;
          a.px -= dx * push; a.py -= dy * push; b.px += dx * push; b.py += dy * push; moved = true;
        }
        var q = pts[i];
        boxes.forEach(function (bx) {
          var nx = Math.max(bx[0], Math.min(q.px, bx[2])), ny = Math.max(bx[1], Math.min(q.py, bx[3])), ex = q.px - nx, ey = q.py - ny, e = Math.sqrt(ex * ex + ey * ey);
          if (e >= 10) return;
          if (e < 0.01) { var cx = (bx[0] + bx[2]) / 2, cy = (bx[1] + bx[3]) / 2; ex = q.px - cx; ey = q.py - cy; e = Math.sqrt(ex * ex + ey * ey) || 1; var out = 10 + Math.max(bx[2] - bx[0], bx[3] - bx[1]) / 2; q.px = cx + ex / e * out; q.py = cy + ey / e * out; }
          else { q.px += ex / e * (10 - e + 0.05); q.py += ey / e * (10 - e + 0.05); }
          moved = true;
        });
        q.px = Math.max(11, Math.min(349, q.px)); q.py = Math.max(11, Math.min(349, q.py));
      }
      if (!moved) break;
    }
    return pts;
  }
  /** A plain diagram: the property in the centre, the report radius as a ring, each staged project at its distance (to scale) and
   *  direction (approximate for a road or an area). No street map: no basemap is cleared for paid use. */
  function mapSection(numbered, response, report, m) {
    var R = 150, C = 180, radius = typeof report.radius_mi === 'number' && report.radius_mi > 0 ? report.radius_mi : 0.5;
    var marks = '', leads = '', pts = [];
    numbered.forEach(function (x) {
      var d = milesOf(response, x.p.project_id), b = bearingOf(response, x.p.project_id);
      if (d === null || b === null) return;
      var rr = Math.min(d / radius, 1) * R, rad = b * Math.PI / 180;
      pts.push({ x: x, x0: C + rr * Math.sin(rad), y0: C - rr * Math.cos(rad) });
    });
    var drawn = pts.length;
    if (!drawn) return '';
    spreadMarks(pts, mapObstacles(C, R));
    pts.forEach(function (q) {
      var x = q.x, k = x.k, dx = q.x0 - q.px, dy = q.y0 - q.py, moved = Math.sqrt(dx * dx + dy * dy) > 1.5;
      var shape = k === 'permitted' || k === 'occupancy'
        ? '<rect x="-8" y="-8" width="16" height="16" rx="3" class="da-rv-mshape"/>'
        : '<circle r="9" class="da-rv-mshape"' + (k === 'proposed' ? ' stroke-dasharray="4 3"' : '') + '/>';
      var dat = ' data-da-type="' + esc(typeKeyOf(x.p)) + '" data-da-stage="' + k + '"';
      // A marker moved off its spot to keep its number readable keeps a thin line to the true spot, so distance and direction stay readable too.
      // The lines are one layer under every marker (and carry the same filter hooks), so no line crosses a number.
      if (moved) leads += '<g class="da-rv-mklead"' + dat + '><line x1="' + q.px.toFixed(1) + '" y1="' + q.py.toFixed(1) + '" x2="' + q.x0.toFixed(1) + '" y2="' + q.y0.toFixed(1)
        + '" class="da-rv-lead"/><circle cx="' + q.x0.toFixed(1) + '" cy="' + q.y0.toFixed(1) + '" r="1.8" class="da-rv-true"/></g>';
      marks += '<g class="da-rv-mk da-rv-mk--' + k + '"' + dat + ' transform="translate('
        + q.px.toFixed(1) + ' ' + q.py.toFixed(1) + ')"><title>' + esc(x.n + ': ' + shortTitle(x.p) + ' · ' + stageLabelOf(x.p, k)) + '</title>' + shape
        + '<text class="da-rv-mnum" text-anchor="middle" dy="4">' + x.n + '</text></g>';
    });
    var ring = function (frac, label) {
      return '<circle cx="' + C + '" cy="' + C + '" r="' + (R * frac) + '" class="da-rv-ring"/><text x="' + (C + 4) + '" y="' + (C - R * frac - 4) + '" class="da-rv-ringlab">' + esc(label) + '</text>';
    };
    var svg = '<svg class="da-rv-plot da-rv-plot--' + (drawn > 6 ? 'lg' : 'sm') + '" viewBox="0 0 360 360" role="img" aria-label="' + esc('Map of development activity within ' + radius + ' miles of the property, ' + drawn + ' marked') + '">'
      + ring(1, radius + ' mi') + ring(0.5, (radius / 2) + ' mi') + '<text x="' + C + '" y="14" text-anchor="middle" class="da-rv-ringlab">N</text>'
      + '<text x="' + (2 * C - 10) + '" y="' + (C + 4) + '" text-anchor="middle" class="da-rv-ringlab">E</text>'
      + '<text x="' + C + '" y="' + (2 * C - 6) + '" text-anchor="middle" class="da-rv-ringlab">S</text>'
      + '<text x="10" y="' + (C + 4) + '" text-anchor="middle" class="da-rv-ringlab">W</text>'
      + '<circle cx="' + C + '" cy="' + C + '" r="7" class="da-rv-home"/><text x="' + C + '" y="' + (C + 22) + '" text-anchor="middle" class="da-rv-homelab">Property</text>'
      + leads + marks + '</svg>';
    // the legend names only the stages actually drawn
    var legend = '<ul class="da-rv-legend"><li><span class="da-rv-lhome" aria-hidden="true"></span>Property</li>' + STAGES.filter(function (k) {
      return numbered.some(function (x) { return x.k === k; });
    }).map(function (k) {
      return '<li class="da-rv-stage--' + k + '">' + STAGE_SHAPES[k] + esc(TITLES[k]) + '</li>';
    }).join('') + '</ul>';
    var off = m ? m.total - drawn : 0;
    var offNote = off > 0 ? ' ' + plural(off, 'record in the table is', 'records in the table are') + ' not drawn; each says why in its row.' : '';
    return section('map', TITLES.map, '<div class="da-rv-mapwrap">' + svg + legend + '</div>'
      + '<p class="da-rv-p da-rv-quiet">Only tracked development activity is shown. Distance is to scale; direction is approximate for roads and areas. The numbers match the Map numbers in the table. Markers that would overlap are set apart; a thin line points to each one\u2019s spot.' + offNote + '</p>');
  }
  // ── QUALITY-OF-LIFE NOTES: what THIS record documents, never a generic warning (universal corrections, 2026-11-02) ──────────────────────────────
  // Each note states what the official record documents (the engine's relevance basis, national-6, read from the record's own words) and, only where that
  // scope supports it, what is POSSIBLE while the work is under way, and what the record does not state. It predicts no value, no character of the area and
  // nothing about the people who may live or work there. A record whose basis is unknown (a report saved before national-6) gets the scope-only sentence:
  // no traffic, noise or view warning is attached to a record that does not document one. Heavy facilities keep the founder's own sentences (2026-11-01),
  // and a data center keeps its sentence because the Type IS the documented use.
  // ⚖️ FOUNDER (2026-11-02): a per-record note may never name FEWER impacts than the Type sentence it replaced. So the Type's own sentence (unchanged from
  // national-6) always follows the record-specific line. A record with no basis (a report saved before national-7) gets the scope-only sentence.
  var QOL_BY_TYPE = {
    infrastructure: 'Potential construction noise and traffic/access disruption. Effects not verified.',
    datacenter: 'Potential cooling noise, backup-generator operation, light pollution, construction traffic and water-demand considerations. Not site-verified; no effect is established.',
    industrial: 'Potential noise, truck traffic, dust or air emissions, and change to the view. Not site-verified; no effect is established.',
    commercial: 'Potential construction and customer traffic, parking and noise, and change to the view. Not site-verified; no effect is established.',
    residential: 'Potential construction noise and traffic, then added neighborhood activity or visual change. Not site-verified; no effect is established.',
    civic: 'Potential construction disruption and possible change to public access or amenities. Not site-verified; no effect is established.'
  };
  var QOL_SCOPE_ONLY = 'The record documents the work it describes. It states no schedule and no effect on nearby properties.';
  var QOL_DECIDED = 'Denied or withdrawn: no development effect is considered unless it is refiled. Confirm the outcome at the official source.';
  var NO_SCHEDULE = ' The record states no schedule and no effect on nearby properties.';
  var QOL_BY_BASIS = {
    new_construction: 'The record documents new construction. Construction activity at the site is possible once work starts.' + NO_SCHEDULE,
    residential_development: 'The record documents new residential development. Construction activity at the site is possible once work starts.' + NO_SCHEDULE,
    demolition: 'The record documents demolition of an existing structure. Demolition noise, dust and truck trips are possible while the work is under way.' + NO_SCHEDULE,
    site_work: 'The record documents shoring, excavation or grading. Heavy equipment and truck trips are possible while the work is under way.' + NO_SCHEDULE,
    addition: 'The record documents an addition to an existing building. Construction activity at the site is possible while the work is under way.' + NO_SCHEDULE,
    substantial_alteration: 'The record documents substantial alterations to an existing building. Construction activity at the site is possible while the work is under way.' + NO_SCHEDULE,
    exterior_building_wide: 'The record documents building-wide exterior work. Scaffolding or exterior work is possible while it is under way.' + NO_SCHEDULE,
    public_access: 'The record documents a change to street or sidewalk access at the site, such as a curb cut or use of the street. It does not say how access changes for neighbors.',
    public_facility: 'The record documents renovation of a public facility. Public access to it may change while the work is under way.' + NO_SCHEDULE,
    infrastructure: 'The record documents road, utility or public-works activity. Lane, access or parking changes are possible while the work is under way. The record states no dates for them.',
    development_record: 'The record is a development filing, such as a site plan or subdivision. It is not a construction permit; whether and when work follows is not stated.',
    datacenter: 'The record documents a data center. Cooling equipment, backup generators, lighting and construction traffic are considerations for this kind of facility; the record states none of them for this site.'
  };
  var QOL_BY_FACILITY = {
    landfill: 'Potential odor, truck traffic, groundwater and soil contamination risk, and birds and pests. Not site-verified; no effect is established.',
    quarry: 'Potential blasting and vibration, dust, truck traffic, and effects on groundwater and wells. Not site-verified; no effect is established.',
    burning: 'Potential air emissions and smoke, odor, ash handling and truck traffic. Not site-verified; no effect is established.',
    transfer: 'Potential odor, truck traffic, noise, litter, and birds and pests. Not site-verified; no effect is established.'
  };
  function facilityKindOf(p) { var k = typeKeyOf(p) === 'industrial' ? p.type.kind : ''; return typeof k === 'string' && has(QOL_BY_FACILITY, k) ? k : ''; }
  function relField(p, f) { return isObj(p.relevance) ? txt(p.relevance[f]) : ''; }
  /** { kind: 'documented' | 'potential' | 'denied_or_withdrawn' | 'unknown', text } for one record. Same input, same answer; no clock, no geography, no network. */
  function recordNote(p) {
    var b = basisOf(p), use = relField(p, 'use').replace(/[^a-z0-9 /&-]/gi, '').trim();
    if (typeKeyOf(p) === 'datacenter' && (!b || b === 'facility_use')) return { kind: 'documented', text: QOL_BY_BASIS.datacenter };
    if (b === 'change_of_use') return { kind: 'documented', text: 'The record documents a change of use' + (use ? ' to ' + use : '') + '. The new use may bring different activity, hours or visitors to the site; the record does not state them.' };
    if (b === 'nightlife_use') return { kind: 'documented', text: 'The record documents tenant improvements for a ' + (use || 'nightlife use') + '. It does not say whether this use is new at this location, and it states no operating hours.' };
    if (b === 'land_use') {
      var pr = relField(p, 'proposes');
      return { kind: 'documented', text: 'The record is a land-use application or decision' + (pr === 'new_construction' ? ' for new construction' : pr === 'demolition' ? ' that includes demolition' : pr === 'site_work' ? ' that includes site work' : '')
        + '. It is not a construction permit; whether and when work follows is not stated.' };
    }
    if (b === 'temporary_event') {
      var w = isObj(p.activity_window) ? p.activity_window : null;
      return { kind: 'documented', text: 'The record documents a temporary installation or event' + (w && day(w.end) ? ', with activity through ' + day(w.end) + ', including removal where the record states it' : '')
        + '. Short-term activity at the site is possible during those dates; the record states no effect on nearby properties.' };
    }
    if (b && has(QOL_BY_BASIS, b)) return { kind: 'documented', text: QOL_BY_BASIS[b] };
    return null;
  }
  function qolImpact(p) {
    if (isDecided(p)) return { kind: 'denied_or_withdrawn', text: QOL_DECIDED };
    var f = facilityKindOf(p);
    if (f) return { kind: 'potential', text: QOL_BY_FACILITY[f] };
    var k = typeKeyOf(p), typeText = has(QOL_BY_TYPE, k) ? QOL_BY_TYPE[k] : '', rec = basisOf(p) ? recordNote(p) : null;
    // a report saved before national-7 carries no basis: the scope-only sentence (founder, 2026-11-02: "this is fine")
    if (!rec) return { kind: 'unknown', text: QOL_SCOPE_ONLY };
    if (!typeText) return rec;
    // the Type sentence carries the "not verified" statement, so the record line drops its own trailing "states no schedule" clause
    return { kind: 'potential', text: rec.text.replace(NO_SCHEDULE, '') + ' ' + typeText };
  }
  // ── THE OVERVIEW: the most significant documented changes first, so a busy reader sees them before the table ─────────────────────────────────────────
  // Ranked by WHAT the record documents (the engine's basis), never by a guess of effect; within one rank the engine's own order stands (the view sorts
  // nothing). A decided (denied or withdrawn) application is not a change and is not listed here.
  var OVERVIEW_LIMIT = 6;
  var OVERVIEW_RANKS = [['new_construction', 'residential_development'], ['land_use'], ['demolition', 'site_work'], ['change_of_use'],
    ['substantial_alteration', 'addition', 'exterior_building_wide'], ['facility_use', 'infrastructure', 'public_facility', 'development_record'],
    ['nightlife_use', 'public_access'], ['temporary_event']];
  var BASIS_WORDS = { new_construction: 'New construction', residential_development: 'New residential development', land_use: 'Land-use application or decision',
    demolition: 'Demolition', site_work: 'Shoring, excavation or grading', change_of_use: 'Change of use', substantial_alteration: 'Substantial alterations',
    addition: 'Addition to a building', exterior_building_wide: 'Building-wide exterior work', facility_use: 'Facility', infrastructure: 'Road, utility or public works',
    public_facility: 'Public facility renovation', development_record: 'Development filing', nightlife_use: 'Nightlife tenant improvements',
    public_access: 'Street or sidewalk access change', temporary_event: 'Temporary installation or event' };
  // founder 2026-11-02 ("rank biggest impact developments first"): up to OVERVIEW_SCALE_SLOTS lines go first to new buildings, largest first by the scale the
  // engine read from the record's own words (units, then stories, then floor area; a building that states none follows those that do, in the engine's
  // order), then to changes of use that state a unit count, largest first. The rest go one per kind as before. Nothing is estimated.
  var OVERVIEW_SCALE_SLOTS = 4;
  /** [units, stories, sqft] from the engine's relevance.scale; 0 where the record states none. */
  function scaleOf(p) {
    var s = isObj(p.relevance) && isObj(p.relevance.scale) ? p.relevance.scale : null;
    return ['units', 'stories', 'sqft'].map(function (k) { var v = s ? s[k] : 0; return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0; });
  }
  function scaleAbove(a, b) { for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; }
  /** The list, largest stated scale first; equal scales keep the engine's order. */
  function largestFirst(list) {
    var left = list.slice(), out = [];
    while (left.length) {
      var at = 0;
      for (var i = 1; i < left.length; i++) if (scaleAbove(scaleOf(left[i]), scaleOf(left[at]))) at = i;
      out.push(left[at]);
      left = left.filter(function (_, j) { return j !== at; });
    }
    return out;
  }
  function overviewSection(m, response) {
    var all = m.current.concat(m.operating, m.unstaged).filter(function (p) { return basisOf(p) && !isDecided(p); }), picked = [];
    // a land-use application for new construction is ranked with new construction; then one record per rank in turn, so the overview covers the kinds
    // of change present before it repeats one
    var rankOf = function (p) {
      var b = basisOf(p) === 'land_use' && relField(p, 'proposes') === 'new_construction' ? 'new_construction' : basisOf(p);
      for (var i = 0; i < OVERVIEW_RANKS.length; i++) if (OVERVIEW_RANKS[i].indexOf(b) >= 0) return i;
      return -1;
    };
    var buildings = all.filter(function (p) { return rankOf(p) === 0; });
    var lead = largestFirst(buildings).concat(largestFirst(all.filter(function (p) { return basisOf(p) === 'change_of_use' && scaleOf(p)[0] > 0; })));
    lead.forEach(function (p) { if (picked.length < OVERVIEW_SCALE_SLOTS) picked.push(p); });
    var groups = OVERVIEW_RANKS.map(function (_, i) { return all.filter(function (p) { return rankOf(p) === i && picked.indexOf(p) < 0; }); });
    for (var pass = 0; picked.length < OVERVIEW_LIMIT && pass < all.length; pass++) {
      groups.forEach(function (g) { if (picked.length < OVERVIEW_LIMIT && g[pass]) picked.push(g[pass]); });
    }
    if (!picked.length) return '';
    var items = picked.map(function (p) {
      var k = m.stageFor[p.project_id] || (lifeKey(p) === 'operating' ? 'operating' : ''), d = distanceOf(response, p.project_id), dir = compassOf(response, p.project_id);
      var what = BASIS_WORDS[basisOf(p)] + (basisOf(p) === 'change_of_use' && relField(p, 'use') ? ' to ' + relField(p, 'use') : '');
      var where = [txt(p.address), d ? d + (dir ? ' ' + dir : '') : ''].filter(Boolean).join(', ');
      var n = m.nums[p.project_id];
      return '<li><span class="da-rv-ovwhat">' + esc(what) + '</span>: ' + esc(shortTitle(p)) + (where ? ' <span class="da-rv-ovwhere">(' + esc(where) + (n ? ', Map ' + n : '') + ')</span>' : '')
        + '. <span class="da-rv-ovstage">Stage: ' + esc(shownStageText(p, k)) + '.</span> ' + esc(unknownOf(p, k)) + '</li>';
    }).join('');
    return section('overview', TITLES.overview, '<ol class="da-rv-ov" data-da-overview>' + items + '</ol>'
      + '<p class="da-rv-p da-rv-quiet">Listed by what each record documents: new buildings first, largest first by the units, stories or floor area the record states. Not by any predicted effect. Every record is in the table below with its official source.</p>');
  }
  /** What the record leaves open, in one short sentence: the schedule, and for an issued permit whether work has started. */
  function unknownOf(p, k) {
    if (k === 'permitted' && permitEvidence(p) === 'permit_issued') return 'Not stated: whether construction has started, or its schedule.';
    if (k === 'operating') return 'Not stated: whether the building is occupied or in use.';
    if (k === 'occupancy') return 'Not stated: whether a business has opened.';
    if (k === 'proposed' || k === 'approved') return 'Not stated: whether or when work will happen.';
    return 'Not stated: the schedule.';
  }
  var TABLE_COLS = [['dev', 'Development'], ['stage', 'Stage'], ['qol', 'Quality-of-Life Impact'], ['evid', 'Supporting Evidence']];
  /** A stage's cell: the engine's stage (the engine's lifecycle label for an operating record, "Stage not stated" for one in neither), the agency's own words when it
   *  stated them, and, only when the record's official date is more than a year old, one short line saying so (the engine's flag, never a guess of the status). */
  function stageCell(p, k) {
    var pstage = txt(p.publisher_stage), rd = recordDateOf(p);
    // Plain text, no shape and no pill: the table reads as a typeset report, not a dashboard. The data-* hooks stay so the filters and tests still find the stage.
    var main = k && k !== 'operating' ? '<span class="da-rv-stage da-rv-stage--' + k + (k === 'proposed' && isDecided(p) ? ' da-rv-decided' : '') + '" data-stage="' + k + '"><span class="da-rv-lifetext">' + esc(stageLabelOf(p, k)) + '</span></span>'
      : lifeKey(p) === 'operating' ? '<span class="da-rv-life da-rv-life--operating" data-lifecycle="operating"><span class="da-rv-lifetext">' + esc(TITLES.operating) + '</span></span>'
      : '<span class="da-rv-stage da-rv-stage--none"><span class="da-rv-lifetext">Stage not stated</span></span>';
    return main + (pstage && !sameWords(pstage, shownStageText(p, k)) ? '<span class="da-rv-sub">' + AGENCY_LABEL + ': ' + esc(pstage) + '</span>'
      : !pstage && p.publisher_stage_unpublished === true ? '<span class="da-rv-sub" data-da-nostatus>' + NO_AGENCY_STATUS + '</span>' : '')
      + (stageNote(p, k || (lifeKey(p) === 'operating' ? 'operating' : '')) ? '<span class="da-rv-sub" data-da-stagenote>' + esc(stageNote(p, k || (lifeKey(p) === 'operating' ? 'operating' : ''))) + '</span>' : '')
      + (rd && rd.old ? '<span class="da-rv-sub da-rv-stale" data-da-stale><b>Verify:</b> ' + esc(rd.label + ' ' + rd.date + (rd.filingOnly ? '. No later official date is on record. Confirm it is still active.' : ', over a year old. Confirm it is still active.')) + '</span>' : '');
  }
  /** What the other three cells do not already say about ONE record: the official event and its date, the newest change HomeSignal detected, the decided outcome,
   *  the agency's attribution and the short official link (the one place a record's link is written). The name, Type, stage, distance and impact are in the same row
   *  and are not repeated. Official-record dates and HomeSignal-detected changes stay two separate lines: a publisher date is never called a change. When the
   *  record states none of it, the cell says so rather than inventing anything. */
  var NO_EVIDENCE = 'No supporting evidence supplied for this record.';
  function evidenceCell(it, showLifecycle) {
    var p = it.p, k = it.k;
    var pe = publisherEvent(p), rd = recordDateOf(p), dc = detected(p)[0], att = agencyOf(p), link = sourceLink(p);
    var scopeText = titleOf(p), desc = txt(p.description);
    var lines = ((scopeText !== shortTitle(p) || desc) && scopeText !== NO_NAME ? line('Documented scope', desc || scopeText) : '')
      + (pe ? line('Official record', eventText(pe.label, pe.date)) : rd ? line('Official record', eventText(rd.label, rd.date)) : '')
      + (dc ? line('Jody detected', eventText(eventLabel(dc.event_type), day(dc.detected_at))) : '')
      + (showLifecycle ? line('Jody lifecycle', lifeLabel(p)) : '')
      + (showLifecycle && ledgerFirstRead(p) ? line('Ledger first read', ledgerFirstRead(p)) : '')
      + (k === 'proposed' && isDecided(p) ? '<p class="da-rv-line da-rv-decidednote"><span class="da-rv-k">Outcome:</span> Decided (denied or withdrawn): it is not open or under review. Confirm the outcome at the official source.</p>' : '')
      + (att ? '<p class="da-rv-attr">' + esc(att) + '</p>' : '')
      + (recordIdOf(p) ? line('Agency record number', recordIdOf(p)) : '')
      + (p.title_cut === true && !desc ? '<p class="da-rv-line da-rv-quiet" data-da-cut>The source feed shortens this description. The full description is in the official record.</p>' : '')
      + (link ? '<p class="da-rv-src">' + link + '</p>' : '');
    return lines || '<p class="da-rv-quiet da-rv-noev">' + NO_EVIDENCE + '</p>';
  }
  /** The records, once each, in four columns: Development (name, Type, distance and direction, map number), Stage, Quality-of-Life Impact, and Supporting Evidence.
   *  `items` is [{ p, k }] in the engine's order (the stages, then operating, then those with no stage); k is the stage key, 'operating', or ''. Each row carries
   *  the data-da-* the filters match on (a record with no stage has none, so the filters never hide it), so a filtered record takes its evidence with it. When the
   *  report's own column is too narrow (CSS, measured on the section, not the screen) the rows stack, with the same four labelled fields in the same order; the ARIA
   *  roles keep the table a table when they do. */
  /** Why a record in the table carries no map number. */
  function offMapReason(p, k) {
    if (k === 'operating') return 'Not on the map: records whose agency record is completed are not drawn.';
    if (!k) return 'Not on the map: no stage is stated.';
    return 'Not on the map: no direction is available for this record.';
  }
  function recordsTable(items, response, nums, showLifecycle, dup, atAddr) {
    if (!items.length) return '';
    var head = TABLE_COLS.map(function (c) { return '<th scope="col" role="columnheader" class="da-rv-th--' + c[0] + '">' + esc(c[1]) + '</th>'; }).join('');
    var body = items.map(function (it) {
      var p = it.p, k = it.k;
      var dist = distanceOf(response, p.project_id), dir = compassOf(response, p.project_id), type = typeLabel(p);
      var n = nums && nums[p.project_id] !== undefined ? nums[p.project_id] : '';
      var where = [dist ? dist + (dir ? ' ' + dir : '') : '', n !== '' ? 'Map ' + n : ''].filter(Boolean).join(' · ');
      var q = qolImpact(p), cls = txt(p.publisher_type), addr = txt(p.address);
      // whose category is whose: the Type is Jody's (lib/project-type.js), the class is the agency's own word
      var typeLine = [type ? 'Jody type: ' + type : '', cls && !sameWords(cls, type) ? 'Agency category: ' + cls : ''].filter(Boolean).join(' \u00b7 ');
      var others = addrKey(p) && atAddr && atAddr[addrKey(p)] ? atAddr[addrKey(p)].filter(function (o) { return o !== p; }) : [];
      var also = others.length ? 'Also at this address in this report: ' + others.map(function (o) { return nums && nums[o.project_id] ? 'Map ' + nums[o.project_id] : (recordIdOf(o) ? 'record ' + recordIdOf(o) : shortTitle(o)); }).join(', ')
        + '. Records at one address may or may not be one development.' : '';
      var dev = '<th scope="row" role="rowheader" class="da-rv-td da-rv-td--dev"><span class="da-rv-lab">Development: </span><span class="da-rv-name">' + esc(shownTitle(p, dup)) + '</span>'
        + (addr ? '<span class="da-rv-sub" data-da-addr>' + esc(addr) + '</span>' : '')
        + (typeLine ? '<span class="da-rv-sub da-rv-sub--type">' + esc(typeLine) + '</span>' : '')
        + (where ? '<span class="da-rv-sub">' + esc(where) + '</span>' : '')
        + (nums && n === '' ? '<span class="da-rv-sub" data-da-offmap>' + esc(offMapReason(p, k)) + '</span>' : '')
        + (also ? '<span class="da-rv-sub" data-da-also>' + esc(also) + '</span>' : '') + '</th>';
      var stage = '<td role="cell" class="da-rv-td da-rv-td--stage"><span class="da-rv-lab">Stage: </span>' + stageCell(p, k) + '</td>';
      var qol = '<td role="cell" class="da-rv-td da-rv-td--qol" data-da-qol="' + q.kind + '"><span class="da-rv-lab">Quality-of-Life Impact: </span>' + esc(q.text) + '</td>';
      var evid = '<td role="cell" class="da-rv-td da-rv-td--evid"><span class="da-rv-lab">Supporting Evidence: </span><div class="da-rv-evbody">' + evidenceCell(it, showLifecycle) + '</div></td>';
      return '<tr role="row" data-da-type="' + esc(typeKeyOf(p)) + '" data-da-stage="' + (k || 'none') + '">' + dev + stage + qol + evid + '</tr>';
    }).join('');
    return '<div class="da-rv-tablewrap"><table class="da-rv-table" role="table" aria-label="' + esc(TITLES.records + ': ' + plural(items.length, 'official record', 'official records')) + '">'
      + '<thead role="rowgroup"><tr role="row">' + head + '</tr></thead><tbody role="rowgroup">' + body + '</tbody></table></div>';
  }
  /** The ONE records section: the table (every record once, its supporting evidence in the row) and a note for records on the same road. */
  function recordsSection(m, response, showLifecycle) {
    var items = [];
    STAGES.forEach(function (k) { m.staged[k].forEach(function (p) { items.push({ p: p, k: k }); }); });
    m.operating.forEach(function (p) { items.push({ p: p, k: 'operating' }); });
    m.unstaged.forEach(function (p) { items.push({ p: p, k: '' }); });
    if (!items.length) return '';
    return section('records', TITLES.records,
      corridorNotes(items.map(function (it) { return it.p; }), response)
      + recordsTable(items, response, m.nums, showLifecycle, m.dup, m.atAddr)
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
  var CHANGE_NOT_READY = 'Change history begins once Jody has observed these records at least twice.';
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
      return 'Jody\u2019s change history for these records starts on ' + b.start + '. Since then it has recorded no status change for the projects in this report.';
    }
    var rest = b.total - b.ready;
    return 'Jody\u2019s change history for ' + b.ready + ' of the ' + b.total + ' records in this report starts on ' + b.start
      + ', and it has recorded no status change for them since. The other ' + rest + (rest === 1 ? ' is' : ' are') + ' not yet comparable.';
  }
  function historySection(list, report, dup) {
    if (!list.length) {
      return section('history', TITLES.history, '<p class="da-rv-p">' + esc(noChangeMessage(report)) + '</p>');
    }
    var items = list.map(function (p) {
      var pe = publisherEvent(p), dc = detected(p), lanes = '';
      if (pe) lanes += '<div class="da-rv-lane"><h4 class="da-rv-h4">' + (/^filed$/i.test(pe.label) ? 'Recent filing' : 'Recent official activity') + '</h4><p class="da-rv-p">' + esc(eventText(pe.label, pe.date)) + '</p></div>';
      if (dc.length) {
        lanes += '<div class="da-rv-lane"><h4 class="da-rv-h4">Jody detected</h4><ul class="da-rv-ul">' + dc.map(function (e) {
          var changes = arr(e.changes).filter(isObj).map(function (c) {
            return '<li>' + esc(fieldLabel(c.field) + ': ' + value(c.from) + ' → ' + value(c.to)) + '</li>';
          }).join('');
          return '<li><span class="da-rv-ev">' + esc(eventText(eventLabel(e.event_type), day(e.detected_at) ? 'detected ' + day(e.detected_at) : '')) + '</span>'
            + (changes ? '<ul class="da-rv-ul da-rv-ul--in">' + changes + '</ul>' : '') + '</li>';
        }).join('') + '</ul></div>';
      }
      // The badge says what the record's card says (its stage, or its lifecycle when it has no stage), so one record never reads two ways.
      var sk = stageKey(p);
      var badge = sk ? stageBadge(p, sk) : lifeKey(p) === 'operating' ? lifeBadge(p)
        : '<span class="da-rv-life da-rv-life--unknown" data-lifecycle="none"><span class="da-rv-lifetext">Stage not stated</span></span>';
      return '<li class="da-rv-hist"><h3 class="da-rv-title">' + esc(shownTitle(p, dup)) + '</h3>' + badge + lanes + '</li>';
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
    return drew + 'Jody does not cover every agency in every area. An agency that is not part of this report was not checked, so a record that is not listed here may still exist.';
  }
  /** How the report was made, in the review's words: the agencies it drew on, the search area, what each stage means, and when to refresh. Every line is
   *  a fact about THIS report or a fixed definition (the engine's own stage rule, national-report.ts); none says what is not there. */
  var COVERAGE_NOTE = 'Jody focuses on documented nearby changes relevant to everyday living. Routine interior remodels, individual-unit repairs, and minor maintenance are excluded unless their documented scope identifies a meaningful neighborhood-facing change.';
  var UNDESCRIBED_NOTE = 'Some official records near this property do not describe their work, or do not state when a temporary activity takes place, so Jody cannot tell whether they are a meaningful current change. They are not listed. A project that is not listed here may still exist.';
  /** When the report was made and, separately, when Jody last read the records in it (the engine's coverage.records_checked, national-6). A retrieval time is
   *  never called a project date, and a new report is never implied to hold newly refreshed data. '' when the report carries neither. */
  function freshnessText(report) {
    var cov = isObj(report.coverage) ? report.coverage : {}, rc = isObj(cov.records_checked) ? cov.records_checked : null;
    var gen = day(report.as_of), a = rc ? day(rc.earliest) : '', b = rc ? day(rc.latest) : '';
    if (!gen && !a) return '';
    return (gen ? 'Report generated ' + gen + '. ' : '') + (a ? 'Jody last read the official records in this report between ' + a + (b && b !== a ? ' and ' + b : '') + '; an agency may have updated a record since.' : 'This report does not state when the official records were last read.');
  }
  function methodNotes(report) {
    var r = report.radius_mi, seen = [];
    arr(report.projects).forEach(function (p) {
      var a = isObj(p) ? agencyOf(p) : '';
      if (a && seen.indexOf(a) < 0) seen.push(a);
    });
    var line2 = function (k, t) { return '<p class="da-rv-p"><span class="da-rv-k">' + esc(k) + ':</span> ' + esc(t) + '</p>'; };
    return '<div class="da-rv-method" data-da-method>'
      + (seen.length ? line2('Official agency data in this report', seen.map(function (a) { return a.replace(/\.+$/, ''); }).join('; ') + '.') : '')
      + (typeof r === 'number' && isFinite(r) && r > 0
        ? line2('Search area', 'Records within ' + r + (r === 1 ? ' mile' : ' miles') + ' of the property. Distance is measured from the property to the near edge of each record\'s mapped shape. The compass direction points to a single display point for the record, so for a long road or an area it is approximate and can differ from where that edge lies.') : '')
      + line2('What is listed', COVERAGE_NOTE)
      + line2('Stages', 'Permit issued: the agency\'s own stage says a permit was issued; that does not confirm construction has started. Under construction: the agency\'s own stage says work is under way. Approved: approved, without either wording; an approval is not a construction permit. Proposed / Under review: filed or under review, not yet approved. Completed (agency record): the agency closed or finaled the record; that does not confirm a building is occupied or a business is open. A record the agency lists as Decided was denied or withdrawn; it is marked Decided (denied or withdrawn) and is not counted as under review. A record whose source publishes no status, and a temporary event, is shown as Stage not stated.')
      + line2('Agency and Jody categories', 'Agency category is the publishing agency\'s own class for the record. Jody type is Jody\'s classification of the record\'s description.')
      + (freshnessText(report) ? line2('Freshness', freshnessText(report)) : '')
      + (isObj(report.coverage) && report.coverage.undescribed_records === true ? line2('Records not described', UNDESCRIBED_NOTE) : '')
      + line2('Coverage', coverageText(report))
      + line2('Record counts', 'Counts are of official records, not of separate developments. Records at the same address are cross-referenced in the table; they may or may not be one development.')
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
    // Routine work (an older saved report's `minor_work` records) is never shown, so it is left out HERE, before any list, count, map number or history is
    // derived: no section can reach it by another path.
    report.projects.forEach(function (p) { if (isObj(p) && typeof p.project_id === 'string' && !isMinor(p)) byId[p.project_id] = p; });
    var shown = report.projects.filter(function (p) { return isObj(p) && typeof p.project_id === 'string' && byId[p.project_id] === p; });
    /** The projects an engine list names, in the engine's order, once each; an id the report does not show is skipped. */
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
      staged[k].forEach(function (p) { stageFor[p.project_id] = k; current.push(p); });
    });
    // the map draws every staged record that has a distance and a direction; the numbers are given AFTER filtering, in table order, so they match
    STAGES.forEach(function (k) {
      staged[k].forEach(function (p) {
        if (milesOf(response, p.project_id) === null || bearingOf(response, p.project_id) === null) return;
        numbered.push({ n: numbered.length + 1, p: p, k: k }); nums[p.project_id] = numbered.length;
      });
    });
    // History: agency status changes first, then newly detected records, then recent filings. A partition (filters), never a sort.
    var hist = pick(arr(sec.what_changed_recently).concat(arr(sec.recent_official_activity))).filter(function (p) {
      return detected(p).length > 0 || publisherEvent(p) !== null;
    });
    var statusChange = function (p) { return detected(p).some(function (e) { return e.event_type === 'status_changed'; }); };
    var newlyDetected = function (p) { return !statusChange(p) && detected(p).length > 0; };
    var history = hist.filter(statusChange).concat(hist.filter(newlyDetected), hist.filter(function (p) { return !detected(p).length; }));
    var some = shown.length > 0;
    // A record the engine kept that no stage section carries: one the engine's lifecycle says is OPERATING (its agency record is completed), and one whose
    // stage the agency did not state. Each is a row of the one records table; neither is forced into a stage.
    var operating = [], unstaged = [];
    shown.forEach(function (p) {
      if (stageFor[p.project_id]) return;
      (lifeKey(p) === 'operating' ? operating : unstaged).push(p);
    });
    // titles shared by two or more shown records: those rows add the agency's record number so they can be told apart
    var tcount = Object.create(null), dup = Object.create(null);
    shown.forEach(function (p) { var t = shortTitle(p); tcount[t] = (tcount[t] || 0) + 1; if (tcount[t] > 1) dup[t] = true; });
    // records at the same street address (the record's own address, as the agency wrote it): cross-referenced, never merged and never called one project
    var atAddr = Object.create(null);
    shown.forEach(function (p) { var a = addrKey(p); if (a) (atAddr[a] = atAddr[a] || []).push(p); });
    var development = current.length + operating.length + unstaged.length;
    return { report: report, legacy: legacy, changed: changed, activity: activity, staged: staged, stageFor: stageFor, numbered: numbered, nums: nums,
      current: current, history: history, some: some, unstaged: unstaged, operating: operating, dup: dup, atAddr: atAddr,
      development: development, total: development, hiddenRoutine: report.projects.length - shown.length };
  }
  /** The client briefing: a SHORT list under the header, from numbers the report already carries and fixed sentences. It reads m (the same read() the
   *  comparison uses), so it cannot disagree with the table below. Counts are RECORD counts: two records can belong to one development. */
  function briefing(report, m, response) {
    var s = m.staged, total = m.total;
    if (!total) return '';
    var r = report.radius_mi, asOf = day(report.as_of);
    var where = typeof r === 'number' && isFinite(r) && r > 0 ? ' within ' + r + (r === 1 ? ' mile' : ' miles') + ' of this property' : ' near this property';
    var stageBits = [];
    var nIssued = s.permitted.filter(function (p) { return permitEvidence(p) !== 'under_construction'; }).length;
    if (s.permitted.length - nIssued) stageBits.push((s.permitted.length - nIssued) + ' under construction');
    if (nIssued) stageBits.push(nIssued + ' with a permit issued');
    if (s.approved.length) stageBits.push(s.approved.length + ' approved');
    if (s.occupancy && s.occupancy.length) stageBits.push(s.occupancy.length + ' approved for occupancy (business opening not verified)');
    if (openProposed(s.proposed).length) stageBits.push(openProposed(s.proposed).length + ' proposed / under review');
    var nDec = s.proposed.length - openProposed(s.proposed).length;
    if (nDec) stageBits.push(nDec + ' decided (denied or withdrawn)');
    if (m.operating.length) stageBits.push(m.operating.length + ' with the agency record completed');
    if (m.unstaged.length) stageBits.push(m.unstaged.length + ' with no stage stated');
    var types = typeCounts(m.current.concat(m.operating, m.unstaged)).map(function (t) { return t.n + ' ' + t.label; });
    var items = [];
    items.push((asOf ? 'As of ' + asOf + ', ' : '') + plural(total, 'official record', 'official records') + where + ' document a nearby change: ' + stageBits.join(' · ') + '.'
      + (types.length ? ' Types: ' + types.join(', ') + '.' : '') + ' These are counts of records, not of separate developments; one development can have several records.');
    if (nIssued) items.push('An issued permit does not confirm that construction has started.');
    // Changes: three different facts, kept apart. A change Jody detected; none detected over a window it can measure; or not yet measurable.
    if (m.changed.length) items.push(plural(m.changed.length, 'record shows', 'records show') + ' a recent change in Jody’s history; see Change History.');
    else if (changeReady(report)) items.push('Recent changes: none recorded for ' + (total === 1 ? 'this record' : 'these records') + ', which remain on file.');
    else items.push('Recent changes: none recorded yet. Jody has not observed these records long enough to say whether they changed.');
    var nOld = m.current.concat(m.operating, m.unstaged).filter(function (p) { var rd = recordDateOf(p); return rd && rd.old; }).length;
    if (nOld) items.push((nOld === 1 ? '1 record carries an official date' : nOld + ' records carry official dates') + ' more than a year old: confirm each is still active.');
    if (!s.approved.length && !openProposed(s.proposed).length) items.push('No approved or proposed / under review records are listed. Jody’s sources do not cover every agency, so that is not a statement that nothing is planned nearby.');
    items.push('Verify the schedule and project details at the official source before a listing, showing or offer.');
    return '<p class="da-rv-brieflab">' + esc(BRIEFING_TITLE) + '</p><ul class="da-rv-brief" data-da-briefing>'
      + items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
      + '<p class="da-rv-p da-rv-quiet" data-da-caution>' + esc(BRIEFING_CAUTION) + '</p>';
  }
  /** What a report whose every nearby record was left out says (an older saved report that held only routine work). Never an outcome the engine did not state. */
  var NONE_RELEVANT = 'The official records near this property in this report describe routine work, such as interior remodels or single-unit repairs, which Jody does not list. No other nearby record is listed.';
  /** An empty report whose nearby records were read and left out says so, so it never reads as "no development nearby". Confirmed routine work and
   *  records that do not describe their work are two different facts and are stated separately; neither is counted. '' when neither applies. */
  function excludedNote(report) {
    var cov = isObj(report.coverage) ? report.coverage : {}, bits = [];
    if (cov.routine_records === true) bits.push('Official records near this property describe routine work, such as interior remodels or single-unit repairs, which Jody does not list.');
    if (cov.undescribed_records === true) bits.push('Other nearby records do not describe their work, or do not state when a temporary activity takes place, so Jody cannot tell whether they are a meaningful change.');
    if (!bits.length) return '';
    return section('excluded', 'Records left out of this report', '<p class="da-rv-p" data-da-excluded>' + esc(bits.join(' ') + ' This is not a finding that there is no development nearby.') + '</p>');
  }
  function html(response, opts) {
    var m = read(response);
    if (!m) return '';
    opts = isObj(opts) ? opts : {};
    var report = m.report, current = m.current, history = m.history, some = m.some;
    // ONE order, once: header, the overview of the most significant changes, the short briefing, the Type and Stage filters with the map right under them, the
    // one table of records (each row carries its own supporting evidence), what changed, the coverage and method, and the actions. Routine work is in none of them.
    var parts = [header(report, opts)];
    if (m.total) parts.push(overviewSection(m, response));
    if (m.total) parts.push(briefing(report, m, response));
    if (!report.projects.length) { parts.push(outcomeSection(report)); if (outcomeKeyOf(report) !== 'NO_SIGNIFICANT_CHANGES') parts.push(excludedNote(report)); }
    else if (!some) parts.push(section('outcome', TITLES.records, '<p class="da-rv-p da-rv-outcome-p">' + esc(NONE_RELEVANT) + '</p>', 'da-rv-hero'));
    if (m.total) parts.push(filtersSection(current.concat(m.operating, m.unstaged), m));
    var showLc = opts.showLifecycle === true;
    if (m.numbered.length) parts.push(mapSection(m.numbered, response, report, m));
    if (m.total) parts.push(recordsSection(m, response, showLc));
    if (some) parts.push(historySection(history, report, m.dup));
    parts.push(evidenceSection(report));
    if (some) parts.push(actionsBar(opts));
    return '<article class="da-rv' + (some ? '' : ' da-rv--empty') + '" aria-label="JODY Development Activity report">' + parts.join('') + '<p class="da-rv-brand" data-da-brand>' + esc(BRAND_LINE) + '</p></article>';
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
      // the evidence is a cell of its own row, so it follows the row; when the filters leave no row the table is not drawn empty, and the section says so
      var sec = el.querySelector('.da-rv-sec--records');
      if (sec) {
        var rows = sec.querySelectorAll('.da-rv-table tbody tr'), shownRows = 0;
        for (var r = 0; r < rows.length; r++) if (!rows[r].hasAttribute('hidden')) shownRows++;
        var wrap = sec.querySelector('.da-rv-tablewrap'), note = sec.querySelector('.da-rv-nomatch');
        var empty = rows.length > 0 && shownRows === 0;
        if (wrap) { if (empty) wrap.setAttribute('hidden', ''); else wrap.removeAttribute('hidden'); }
        if (note) { if (empty) note.removeAttribute('hidden'); else note.setAttribute('hidden', ''); }
        var now = el.querySelector('[data-da-fnow]');
        if (now) {
          var picked = [], on = el.querySelectorAll('.da-rv-chip[aria-pressed="true"]');
          for (var q = 0; q < on.length; q++) if (on[q].getAttribute('data-da-value') !== 'all') picked.push(chipName(on[q]));
          now.textContent = fnowText(picked, shownRows, rows.length);
        }
      }
    }
    // a chip's own words, without its count
    function chipName(b) { var t = ''; for (var c = b.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) t += c.nodeValue; return t.trim(); }
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
  // THE STACKED RECORD. A four-column table needs room, so below STACK_AT px of the REPORT'S OWN width (the records section, measured, not the screen: the agent
  // workspace's sidebar takes room a viewport query cannot see) each row becomes one block with the same four labelled fields in the same order:
  // Development, Stage, Quality-of-Life Impact, Supporting Evidence. The header row stays for screen readers only. The 620px viewport query below carries the
  // same rules for a browser without container queries. Paper is NOT stacked: the print block sets its own four-column layout.
  var STACK_AT = 760;
  var STACK_CSS = [
    '.da-rv-tablewrap{border:0;border-radius:0}',
    '.da-rv-table thead,.da-rv-table thead tr,.da-rv-table thead th{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '.da-rv-table,.da-rv-table tbody,.da-rv-table tr,.da-rv-table td,.da-rv-table th[scope=row]{display:block;width:100%}',
    '.da-rv-table tr{border:1px solid var(--rv-line);border-radius:10px;padding:6px 10px;margin:0 0 10px}',
    '.da-rv-table td,.da-rv-table th[scope=row]{border-bottom:0;padding:5px 0}',
    '.da-rv-table{table-layout:auto}.da-rv-td--dev{font-size:15px}',
    '.da-rv-lab{display:inline;font-weight:700;color:var(--rv-ink)}',
    '.da-rv-td--dev .da-rv-lab{font-weight:600;color:var(--rv-ink2)}',
    '.da-rv-td--evid .da-rv-evbody{display:block;margin-top:2px}'
  ].join('');
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
    '.da-rv-table{table-layout:fixed}.da-rv-th--dev{width:24%}.da-rv-th--stage{width:17%}.da-rv-th--qol{width:27%}.da-rv-th--evid{width:32%}',
    '.da-rv-table thead th.da-rv-th--qol,.da-rv-table thead th.da-rv-th--evid{white-space:normal}',
    '.da-rv-table th,.da-rv-table td{overflow-wrap:break-word;word-break:normal;hyphens:none}',
    '.da-rv-td--dev{font-weight:400;color:var(--rv-ink)}.da-rv-name{display:block;font-weight:700;color:var(--rv-ink)}',
    '.da-rv-sub{display:block;font-size:12.5px;color:var(--rv-ink2);margin-top:2px}.da-rv-sub--src{margin-top:4px}',
    '.da-rv-td--stage .da-rv-stage{display:inline-flex;align-items:center;gap:6px;font-weight:700;color:var(--rv-ink)}.da-rv-td--stage .da-rv-shape{flex:none}',
    '.da-rv-lab{display:none}',
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
    '.da-rv-ov{padding-left:22px;font-size:14.5px;line-height:1.5;color:var(--rv-ink)}.da-rv-ov li{margin:0 0 8px}.da-rv-ovwhat{font-weight:700}.da-rv-ovwhere{color:var(--rv-ink2)}.da-rv-ovstage{font-weight:600}',
    '.da-rv-brand{margin:18px 0 0!important;font-size:12.5px;font-weight:700;letter-spacing:.04em;color:var(--rv-deep)}',
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
    // a pressed chip also carries a tick, so the choice reads on a black-and-white printout too
    '.da-rv-chip[aria-pressed="true"]::before{content:"\\2713\\00a0"}',
    '.da-rv-fnow{font-size:14px;font-weight:600;color:var(--rv-ink);margin:2px 0 6px!important}',
    '.da-rv-mapwrap{display:flex;flex-wrap:wrap;align-items:flex-start;gap:14px 24px}',
    '.da-rv-plot{width:100%;height:auto;background:#f6f8f6;border:1px solid var(--rv-line);border-radius:12px}',
    // the diagram is sized to what it holds: a handful of records get a compact one beside its legend; a larger report gets the full one
    '.da-rv-plot--sm{max-width:300px}.da-rv-plot--lg{max-width:400px}',
    // the Supporting Evidence cell: the record's own official facts, small and quiet, the short link last. min-width:0 lets long publisher text wrap instead of widening the column.
    '.da-rv-evbody{min-width:0}.da-rv-evbody>:last-child{margin-bottom:0!important}.da-rv-td--evid .da-rv-line{font-size:13px}.da-rv-td--evid .da-rv-attr{margin-top:2px!important}.da-rv-noev{margin:0!important}',
    '.da-rv-sec--records{container:da-rv-rec/inline-size}',
    '.da-rv-stale{color:var(--rv-ink);font-size:12px}.da-rv-stale b{color:var(--rv-amber)}',
    // Stage column: plain dark semibold text. Beats the badge rules above and below (higher specificity), so no fill, border, radius or padding survives,
    // in any stage (including Decided) and in print. Long names wrap at spaces; the agency line and Verify sit beneath with clear spacing.
    '.da-rv-td--stage .da-rv-stage,.da-rv-td--stage .da-rv-life,.da-rv-td--stage .da-rv-stage.da-rv-decided,.da-rv-td--stage .da-rv-stage.da-rv-stage--approved,.da-rv-td--stage .da-rv-stage.da-rv-stage--proposed,.da-rv-td--stage .da-rv-stage.da-rv-stage--permitted,.da-rv-td--stage .da-rv-stage.da-rv-stage--occupancy,.da-rv-td--stage .da-rv-life--approved,.da-rv-td--stage .da-rv-life--proposed,.da-rv-td--stage .da-rv-life--operating,.da-rv-td--stage .da-rv-life--unknown{display:block;background:none;border:0;border-radius:0;padding:0;box-shadow:none;font-size:1em;font-weight:600;line-height:1.35;color:var(--rv-ink);text-align:left;overflow-wrap:break-word;margin-top:2px}',
    '.da-rv-td--stage .da-rv-sub{margin-top:5px;line-height:1.4}.da-rv-td--stage .da-rv-sub+.da-rv-sub{margin-top:4px}',
    '.da-rv-ring{fill:none;stroke:#c9d3cc;stroke-dasharray:4 4}',
    '.da-rv-ringlab,.da-rv-homelab{font-size:11px;fill:var(--rv-ink2)}',
    '.da-rv-home{fill:#16211c;stroke:#fff;stroke-width:3}',
    '.da-rv-mshape{stroke-width:2}',
    '.da-rv-mk--approved .da-rv-mshape{fill:var(--rv-green);stroke:var(--rv-green)}',
    '.da-rv-mk--proposed .da-rv-mshape{fill:#fff;stroke:var(--rv-amber)}',
    '.da-rv-mk--permitted .da-rv-mshape{fill:var(--rv-deep);stroke:var(--rv-deep)}',
    '.da-rv-mk--occupancy .da-rv-mshape{fill:#fff;stroke:var(--rv-deep)}.da-rv-mk--occupancy .da-rv-mnum{fill:var(--rv-deep)}',
    '.da-rv-mnum{font-size:10px;font-weight:700;fill:#fff}',
    '.da-rv-lead{stroke:#6b7a72;stroke-width:1}.da-rv-true{fill:#6b7a72}',
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
    '.da-rv-stage--occupancy{color:var(--rv-deep)}',
    '.da-rv-stage.da-rv-stage--occupancy{background:#fff}',
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
    '.da-rv-table th,.da-rv-table td{padding:16px 14px}.da-rv-table tbody tr:last-child>*{border-bottom:0}',
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
    '@media(max-width:620px){.da-rv{padding:20px 16px 24px;border-radius:12px}.da-rv-addr{font-size:22px}.da-rv-h2{font-size:19px}.da-rv-hero{padding:18px 16px 14px}.da-rv-method .da-rv-p{display:block}.da-rv-metrics{gap:10px 24px}.da-rv-side{text-align:left}' + STACK_CSS + '}',
    // the same record stack, decided by the width the report itself has (screen only)
    '@media screen{@container da-rv-rec (max-width:' + (STACK_AT - 0.02) + 'px){' + STACK_CSS + '}}',
    // PRINT (build step 8: "Download PDF" is the browser's print window). The printed report is what the filters show, and the filters
    // print with the pressed ones ticked (founder, 2026-11-01); the action buttons are gone, no section or card is split across pages, the stage and lifecycle colours print,
    // and each official link shows its address so the paper copy still leads to the record.
    '@media print{',
    // the page itself: a real margin (the browser draws its own header and footer in it unless the person turns "Headers and footers" off) and, in browsers that
    // support page margin boxes, HomeSignal's own footer with the page number
    '@page{margin:12mm 12mm 14mm;@bottom-left{content:"JODY Tracks Development Activity report \u00b7 https://jodytracks.com";font:9px sans-serif;color:#555}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:9px sans-serif;color:#555}}',
    'html,body{background:#fff!important}',
    '.da-rv{border:0;border-radius:0;padding:0;background:#fff;color:#000;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '.da-rv-actions{display:none!important}',
    // the filters PRINT, pressed ones filled and ticked, and the PDF lists only what they show (founder, 2026-11-01: "we must know what we clicked")
    // founder 2026-11-02 ("the type and status buttons are not there"): the Type and Stage chips print again, pressed ones filled and ticked;
    // only the on-screen instructions do not print. The "Showing ..." line prints under them.
    '.da-rv-sec--filters{break-inside:avoid;page-break-inside:avoid;padding:2px 0!important}.da-rv-sec--filters .da-rv-quiet{display:none!important}.da-rv-fnow{font-size:11.5px;margin:6px 0 0!important}',
    '.da-rv-chips{gap:5px}.da-rv-chip{min-height:0;font-size:10.5px;padding:2px 8px}.da-rv-frow{margin:0 0 4px}',
    '.da-rv-ov{font-size:11.5px}.da-rv-ov li{margin:0 0 4px;break-inside:avoid}.da-rv-brand{font-size:10px;margin:10px 0 0!important}',
    '.da-rv-hist .da-rv-stage{font-size:10.5px;padding:1px 8px}',
    // pages: no record, history entry or the header is split; a heading is kept with what follows it; the table header repeats; sections flow (no forced blank space)
    '.da-rv-hist,.da-rv-head,.da-rv-brief,.da-rv-sec--map,.da-rv-table tr{break-inside:avoid;page-break-inside:avoid}',
    '.da-rv-brieflab,.da-rv-h2{break-after:avoid;page-break-after:avoid}',
    '.da-rv-table thead{display:table-header-group}',
    '.da-rv-sec{padding:6px 0}.da-rv-table th,.da-rv-table td{padding:5px 6px}',
    // PAPER: the same four columns, set for the page. The Supporting Evidence cell prints with its own record (never in a second list), its short link stays a link
    // (the label, never the raw address), a row is never split across pages, and the header row repeats on every page. Fixed widths and smaller padding keep Letter and A4 readable.
    '.da-rv-table{table-layout:fixed;font-size:11px}.da-rv-th--dev{width:24%}.da-rv-th--stage{width:17%}.da-rv-th--qol{width:27%}.da-rv-th--evid{width:32%}',
    '.da-rv-table thead th{font-size:9.5px;letter-spacing:.03em}',
    '.da-rv-td--evid .da-rv-line,.da-rv-td--evid .da-rv-attr,.da-rv-td--evid .da-rv-link,.da-rv-td--evid .da-rv-noev{font-size:10.5px;margin:0 0 2px!important}.da-rv-td--evid .da-rv-link{padding:1px 0}',
    '.da-rv-histlist{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.da-rv-hist{padding:8px 10px}.da-rv-hist .da-rv-title{font-size:12px;margin:0 0 4px!important}.da-rv-hist .da-rv-life{font-size:10.5px;padding:1px 8px}.da-rv-h4{font-size:10px}.da-rv-lane{margin-top:6px}.da-rv-ul{font-size:11px}',
    '.da-rv-sub{font-size:10.5px}.da-rv-brief{font-size:12px;padding:8px 12px 8px 26px}',
    '.da-rv-method .da-rv-p,.da-rv-lims,.da-rv-quiet,.da-rv-p{font-size:11px}',
    '.da-rv-mapwrap{flex-wrap:nowrap;align-items:center;gap:16px}.da-rv-plot--sm{max-width:2.4in}.da-rv-plot--lg{max-width:3in}.da-rv-legend{font-size:11.5px;gap:6px}.da-rv-legend li{gap:6px}',
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
