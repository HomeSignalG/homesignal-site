// THE SIDE-BY-SIDE COMPARISON (Development Activity build step 10; plan "Property Comparison", docs/development-activity-plan-100526.md).
//
// WHAT IT IS. Two to five of an agent's SAVED reports, side by side, so a buyer can set candidate properties next to each other. Each column
// is one saved report, opened by the page through the same `open` call that reopens a saved report (the same standing check, the same
// stored body, no free report used). This file never fetches anything and never makes a report: it is handed the responses.
//
// ONE CANONICAL PATH, NO SECOND ONE. Every count, label and sentence here is read through HS.daReportView.read() / typeCounts() /
// outcomeText() / limitationsOf() / describe(), the SAME functions the report itself is drawn from. So a number in a comparison cannot differ
// from the number on the report it came from, and "same report rules" is true by construction, not by a copy of the rules: this file holds
// no Type rule, no lifecycle rule, no stage rule, no change rule, no rights rule and no geography.
//
// WHAT IT NEVER DOES (plan, "Do not turn the comparison into a subjective neighborhood score").
//   - It ranks nothing and recommends nothing: the columns are in the order the page gives them, no cell is marked better or worse, nothing
//     is totalled across the rows, and nothing is sorted or reordered. A view that sorts is a view that ranks.
//   - It never turns "no data" into a zero. A report whose engine outcome is "No data ingested" says so in every count cell, because that
//     report cannot say whether there is development nearby; only a report the engine calls "No development activity" shows a 0.
//   - It does not compare distances. A saved report does not keep how far each record is from the property (that is measured from the
//     property's location, which lives only in the private layer), so there is nothing stored to compare, and the page says so.
//   - It refuses reports that were not made over the same distance (the plan: "the same radius and evidence rules").
//
// THE ADDRESS. The caller supplies each report's address, and it appears as TEXT in one place only: the "Reports compared" list. It is never
// written into an attribute, an id, a class, a URL or a header cell (the table's column headings are "Report 3", which the list explains).
//
// LOAD ORDER: lib/da-report-view.js first (it is read when a comparison is built, and a missing view fails closed). When a page first loads
// this file, add lib/da-report-compare.js to CONTENT_KEYED in test/lib-cache-keys.test.mjs in the same change.
(function (root) {
  'use strict';
  var HS = root.HS = root.HS || {};

  var MIN = 2, MAX = 5;
  var EYEBROW = 'HOMESIGNAL DEVELOPMENT ACTIVITY';
  var TITLE = 'Compare properties';
  var NOT_STATED = 'Not stated';
  var NONE_IN_REPORT = 'None in this report';
  var NOT_MEASURED = 'Not yet measured';
  var NO_LIMITS = 'None stated. Which agencies are covered is not measured.';
  var NOT_IN_VERSION = 'Not in this report\'s version';
  // why a comparison is refused, in plain words (the page shows one of these and nothing else)
  var REFUSALS = {
    count: 'Choose from 2 to 5 reports to compare.',
    unreadable: 'One of these reports could not be shown, so they cannot be compared.',
    radius: 'These reports were not made over the same distance, so they cannot be compared side by side.',
    duplicate: 'The same report was chosen twice.',
    view: 'The report view did not load, so reports cannot be compared.'
  };
  var DISTANCE_NOTE = 'Distances are not compared. A saved report does not keep how far each record is from the property.';
  var UNIT_NOTE = 'Counted as official records: a record is a source record, not a proven separate project. Each report is shown as it was saved.';
  var NOT_A_SCORE = 'This sets facts from official records side by side. It is not a score or a recommendation, and HomeSignal does not rank properties.';

  function view() { return root.HS && root.HS.daReportView ? root.HS.daReportView : null; }
  function refused(reason) { return { ok: false, reason: reason }; }

  // ── the comparison, as data ───────────────────────────────────────────────────────────────────────
  /** Entries are [{ number, address, label, generated_at, response }], 2 to 5, in the order to show. Returns { ok: true, columns } or { ok: false, reason }. */
  function build(entries) {
    var V = view();
    if (!V || typeof V.read !== 'function' || !V.util || typeof V.typeCounts !== 'function' || typeof V.outcomeText !== 'function' || typeof V.describe !== 'function' || typeof V.changeReady !== 'function') return refused('view');
    if (!Array.isArray(entries) || entries.length < MIN || entries.length > MAX) return refused('count');
    var cols = [], seen = Object.create(null), radius = null;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!V.util.isObj(e) || typeof e.number !== 'number' || e.number % 1 !== 0 || e.number < 1) return refused('unreadable');
      if (seen[e.number]) return refused('duplicate');
      seen[e.number] = true;
      var m = V.read(e.response);
      if (!m) return refused('unreadable');
      var r = m.report.radius_mi;
      if (typeof r !== 'number' || !isFinite(r) || r <= 0) return refused('radius');
      if (radius === null) radius = r; else if (r !== radius) return refused('radius');
      var o = V.outcomeText(m.report), state;
      // what a count means for this report. A report with records has counts. One with none says what the ENGINE says: only
      // "No development activity" is a measured zero; "No data ingested" (or nothing) is never shown as a zero.
      if (m.some) state = 'records';
      else if (o && o.key === 'NO_DEVELOPMENT_ACTIVITY') state = 'none';
      else if (o && o.key === 'NO_DATA_INGESTED') state = 'no_data';
      else state = 'unstated';
      cols.push({
        number: e.number,
        address: typeof e.address === 'string' ? e.address.trim() : '',
        label: typeof e.label === 'string' ? e.label.trim() : '',
        made: V.util.day(e.generated_at),
        m: m, outcome: o, state: state, ready: V.changeReady(m.report)
      });
    }
    return { ok: true, columns: cols, radius: radius };
  }

  // ── the table ─────────────────────────────────────────────────────────────────────────────────────
  /** One cell. `n` is a number to show for a report that has counts; otherwise the report's own state decides the words. */
  function countCell(V, col, n) {
    if (col.state === 'records' || col.state === 'none') return V.util.esc(String(n));
    if (col.state === 'no_data') return V.util.esc(V.OUTCOMES.NO_DATA_INGESTED.title);
    return V.util.esc(NOT_STATED);
  }
  /** A count of what HomeSignal DETECTED. A zero before HomeSignal has observed the records long enough is "not yet measured", never "nothing changed". */
  function changeCell(V, col, n) {
    if (col.state === 'no_data' || col.state === 'unstated') return countCell(V, col, n);
    return V.util.esc(n > 0 || col.ready ? String(n) : NOT_MEASURED);
  }
  function textCell(V, col, text) {
    if (col.state === 'no_data') return V.util.esc(V.OUTCOMES.NO_DATA_INGESTED.title);
    if (col.state === 'unstated') return V.util.esc(NOT_STATED);
    return V.util.esc(text);
  }
  function tr(V, label, cols, cellFor) {
    var cells = cols.map(function (c, i) {
      return '<td><span class="da-cmp-r">Report ' + c.number + '</span><span class="da-cmp-v">' + cellFor(c, i) + '</span></td>';
    }).join('');
    return '<tr><th scope="row" class="da-cmp-rowh">' + V.util.esc(label) + '</th>' + cells + '</tr>';
  }
  function group(V, label, span) {
    return '<tr class="da-cmp-grp"><th scope="colgroup" colspan="' + span + '">' + V.util.esc(label) + '</th></tr>';
  }
  function bodyRows(V, cols) {
    var T = V.TITLES, span = cols.length + 1, out = [];
    out.push(group(V, 'What changed', span));
    out.push(tr(V, 'Records with a change HomeSignal detected', cols, function (c) { return changeCell(V, c, c.m.changed.length); }));
    out.push(tr(V, 'Records with a recent official event', cols, function (c) { return countCell(V, c, c.m.activity.length); }));
    out.push(group(V, 'By stage', span));
    ['permitted', 'approved', 'proposed'].forEach(function (k) {
      out.push(tr(V, T[k], cols, function (c) {
        if (k === 'permitted' && c.m.legacy) return V.util.esc(NOT_IN_VERSION);
        // a Decided application (denied or withdrawn) is not under review: the report counts it on its own line, so the comparison does too
        return countCell(V, c, k === 'proposed' ? V.util.openProposed(c.m.staged.proposed).length : c.m.staged[k].length);
      }));
    });
    if (cols.some(function (c) { return V.util.openProposed(c.m.staged.proposed).length !== c.m.staged.proposed.length; })) {
      out.push(tr(V, V.util.DECIDED_LABEL, cols, function (c) { return countCell(V, c, c.m.staged.proposed.length - V.util.openProposed(c.m.staged.proposed).length); }));
    }
    // the Types any of these reports carries, in the plan's order; a report with none of a Type shows 0 for it
    var perCol = cols.map(function (c) { return V.typeCounts(c.m.current.concat(c.m.operating || [], c.m.unstaged || [])); }), typeRows = [];
    V.TYPE_ORDER.forEach(function (k) {
      var label = '';
      perCol.forEach(function (list) { list.forEach(function (t) { if (t.key === k && !label) label = t.label; }); });
      if (!label) return;
      typeRows.push(tr(V, label, cols, function (c, i) {
        var n = 0;
        perCol[i].forEach(function (t) { if (t.key === k) n = t.n; });
        return c.m.legacy ? V.util.esc(NOT_IN_VERSION) : countCell(V, c, n);
      }));
    });
    if (typeRows.length) { out.push(group(V, 'By type', span)); out = out.concat(typeRows); }
    out.push(group(V, 'Timeline', span));
    out.push(tr(V, 'Most recent change HomeSignal detected', cols, function (c) {
      if (!c.m.changed.length) return textCell(V, c, c.ready ? NONE_IN_REPORT : NOT_MEASURED);
      var d = V.describe(c.m.changed[0]);
      return textCell(V, c, d.title + (d.change ? ' · ' + d.change : ''));
    }));
    out.push(tr(V, 'Most recent official record', cols, function (c) {
      if (!c.m.activity.length) return textCell(V, c, NONE_IN_REPORT);
      var d = V.describe(c.m.activity[0]);
      return textCell(V, c, (d.type ? d.type + ' — ' : '') + d.title + (d.event ? ' · ' + d.event : ''));
    }));
    out.push(group(V, 'Coverage and freshness', span));
    out.push(tr(V, 'Report as of (UTC day)', cols, function (c) { return V.util.esc(V.util.day(c.m.report.as_of) || NOT_STATED); }));
    out.push(tr(V, 'What "recent" means', cols, function (c) {
      var d = c.m.report.recent_days;
      return V.util.esc(typeof d === 'number' && isFinite(d) && d > 0 ? 'The last ' + d + ' days' : NOT_STATED);
    }));
    out.push(tr(V, 'Limits the report states', cols, function (c) {
      var lims = V.limitationsOf(c.m.report);
      return lims.length ? '<ul class="da-cmp-lims">' + lims.map(function (t) { return '<li>' + V.util.esc(t) + '</li>'; }).join('') + '</ul>' : V.util.esc(NO_LIMITS);
    }));
    return out.join('');
  }
  function legend(V, cols) {
    return '<ol class="da-cmp-legend">' + cols.map(function (c) {
      return '<li><span class="da-cmp-n">Report ' + c.number + '</span> <span class="da-cmp-addr">' + V.util.esc(c.address || V.util.NO_ADDRESS) + '</span>'
        + (c.label ? ' <span class="da-cmp-lab">' + V.util.esc(c.label) + '</span>' : '') + (c.made ? ' <span class="da-cmp-made">Made ' + V.util.esc(c.made) + '</span>' : '') + '</li>';
    }).join('') + '</ol>';
  }
  /** What the engine says where a column could be misread, in its own words: a report with no records ("No data ingested" is not a zero), and a report
   *  HomeSignal has not observed long enough to say it saw no change. Nothing is added to a report that has neither. */
  function notes(V, cols) {
    var items = [];
    cols.forEach(function (c) {
      if (!c.m.some) {
        var body = c.outcome ? '<b>' + V.util.esc(c.outcome.title) + '.</b> ' + V.util.esc(c.outcome.body) : 'This report has no records, and it states no reason.';
        items.push('<li><span class="da-cmp-r da-cmp-r--on">Report ' + c.number + '</span> ' + body + '</li>');
      }
      if (!c.ready) items.push('<li><span class="da-cmp-r da-cmp-r--on">Report ' + c.number + '</span> ' + V.util.esc(V.CHANGE_NOT_READY) + '</li>');
    });
    return items.length ? '<section class="da-cmp-sec" aria-label="Notes on these reports"><h3 class="da-cmp-h3">Notes on these reports</h3><ul class="da-cmp-notes">' + items.join('') + '</ul></section>' : '';
  }
  /** The comparison as markup, or '' when it cannot be built (the caller asks build() for the reason). */
  function html(entries) {
    var V = view(), b = build(entries);
    if (!b.ok || !V) return '';
    var cols = b.columns, head = cols.map(function (c) { return '<th scope="col">Report ' + c.number + '</th>'; }).join('');
    return '<article class="da-cmp" aria-label="' + V.util.esc(TITLE) + '">'
      + '<header class="da-cmp-head"><p class="da-cmp-eyebrow">' + V.util.esc(EYEBROW) + '</p><h2 class="da-cmp-title">' + V.util.esc(TITLE) + '</h2>'
      + '<p class="da-cmp-meta">' + V.util.esc('Within ' + b.radius + (b.radius === 1 ? ' mile' : ' miles') + ' of each property') + '</p></header>'
      + '<section class="da-cmp-sec" aria-label="Reports compared"><h3 class="da-cmp-h3">Reports compared</h3>' + legend(V, cols) + '</section>'
      + '<div class="da-cmp-scroll"><table class="da-cmp-table"><caption class="da-cmp-vh">' + V.util.esc(TITLE + ': ' + cols.length + ' reports side by side') + '</caption>'
      + '<thead><tr><th scope="col"><span class="da-cmp-vh">Fact</span></th>' + head + '</tr></thead><tbody>' + bodyRows(V, cols) + '</tbody></table></div>'
      + notes(V, cols)
      + '<section class="da-cmp-sec da-cmp-fine" aria-label="About this comparison">'
      + '<p class="da-cmp-p">' + V.util.esc(UNIT_NOTE) + '</p><p class="da-cmp-p">' + V.util.esc(DISTANCE_NOTE) + '</p>'
      + '<p class="da-cmp-p">' + V.util.esc(NOT_A_SCORE) + '</p><p class="da-cmp-p">' + V.util.esc(V.DISCLOSURE) + '</p></section></article>';
  }

  // ── presentation ──────────────────────────────────────────────────────────────────────────────────
  // Scoped to .da-cmp, built from app.css tokens with fallbacks so it also stands alone. Nothing here can touch another page.
  // On a phone (<= 700px) each row stacks: the fact, then one line per report, each starting with "Report N" (explained by the list above the
  // table), so nothing scrolls sideways and no column heading is needed.
  var CSS = [
    '.da-cmp{--cmp-ink:var(--ink,#16211c);--cmp-ink2:var(--ink-2,#4a5a52);--cmp-line:var(--line,#e4e8e4);--cmp-deep:var(--green-deep,#0f5c37);--cmp-tint:var(--green-tint,#e9f5ee);',
    'max-width:100%;min-width:0;box-sizing:border-box;background:#fff;border:1px solid var(--cmp-line);border-radius:15px;padding:24px 26px;color:var(--cmp-ink);',
    'font-family:var(--font,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);font-size:15px;line-height:1.55;overflow-wrap:anywhere}',
    '.da-cmp *,.da-cmp *::before,.da-cmp *::after{box-sizing:border-box}',
    '.da-cmp p,.da-cmp h2,.da-cmp h3,.da-cmp ul,.da-cmp ol{margin:0}',
    '.da-cmp-eyebrow{font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--cmp-deep)}',
    '.da-cmp-title{font-size:19px;font-weight:700;letter-spacing:-.01em;margin:6px 0 2px!important}',
    '.da-cmp-meta{font-size:13.5px;color:var(--cmp-ink2)}',
    '.da-cmp-sec{padding:18px 0 0}',
    '.da-cmp-h3{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--cmp-ink2);margin:0 0 10px!important}',
    '.da-cmp-legend,.da-cmp-notes{list-style:none;padding:0;display:grid;gap:8px}',
    '.da-cmp-n{font-weight:700}',
    '.da-cmp-lab,.da-cmp-made{color:var(--cmp-ink2);font-size:13.5px}',
    '.da-cmp-scroll{margin-top:18px;max-width:100%;overflow-x:auto}',
    '.da-cmp-table{width:100%;border-collapse:collapse;font-size:14.5px}',
    '.da-cmp-table th,.da-cmp-table td{text-align:left;vertical-align:top;padding:9px 12px 9px 0;border-top:1px solid var(--cmp-line)}',
    '.da-cmp-table thead th{font-size:13px;font-weight:700;color:var(--cmp-ink2);border-top:0;white-space:nowrap}',
    '.da-cmp-rowh{font-weight:600;min-width:11em}',
    '.da-cmp-grp th{padding-top:20px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--cmp-deep);border-top:2px solid var(--cmp-line)}',
    '.da-cmp-r{display:none;font-weight:700;color:var(--cmp-ink2)}',
    '.da-cmp-r--on{display:inline}',
    '.da-cmp-lims{padding-left:1.1em;display:grid;gap:4px}',
    '.da-cmp-fine{color:var(--cmp-ink2);font-size:13px;display:grid;gap:8px}',
    '.da-cmp-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '@media(max-width:700px){.da-cmp{padding:18px 16px;border-radius:12px}',
    '.da-cmp-scroll{overflow-x:visible}',
    '.da-cmp-table,.da-cmp-table tbody,.da-cmp-table tr,.da-cmp-table th,.da-cmp-table td{display:block;width:auto;min-width:0}',
    '.da-cmp-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}',
    '.da-cmp-table th,.da-cmp-table td{border-top:0;padding:2px 0}',
    '.da-cmp-table tr{padding:10px 0;border-top:1px solid var(--cmp-line)}',
    '.da-cmp-grp{border-top:2px solid var(--cmp-line)!important}',
    '.da-cmp-r{display:inline-block;min-width:5.5em}',
    '.da-cmp-v{display:inline}}',
    '@media print{.da-cmp{border:0;padding:0}}'
  ].join('');

  /** The reason a comparison was refused, in plain words. */
  function message(reason) { return Object.prototype.hasOwnProperty.call(REFUSALS, reason) ? REFUSALS[reason] : REFUSALS.unreadable; }

  /** html() into `el`, with this module's stylesheet added to the document once. Returns build()'s answer; a refusal leaves `el` empty. */
  function mount(el, entries) {
    var b = build(entries);
    if (!el) return b.ok ? refused('unreadable') : b;
    var doc = el.ownerDocument;
    if (b.ok && doc && doc.head && !doc.getElementById('da-cmp-style')) {
      var st = doc.createElement('style');
      st.id = 'da-cmp-style';
      st.textContent = CSS;
      doc.head.appendChild(st);
    }
    el.innerHTML = b.ok ? html(entries) : '';
    return b;
  }

  HS.daReportCompare = { build: build, html: html, mount: mount, message: message, MIN: MIN, MAX: MAX, CSS: CSS, REFUSALS: REFUSALS, DISTANCE_NOTE: DISTANCE_NOTE, NOT_A_SCORE: NOT_A_SCORE };
})(typeof window !== 'undefined' ? window : globalThis);
