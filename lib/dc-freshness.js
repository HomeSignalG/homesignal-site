// DATA-CENTRE SOURCE FRESHNESS on Map 1 (2026-11-12). The page half of docs/dc-source-freshness.sql.
//
// Three different dates, never blurred:
//   * the PUBLISHER's edition date (what the publisher says its dataset is as of),
//   * OUR last successful read,
//   * OUR most recent read attempt and how it ended.
// All three describe a dataset as a whole. None says a facility was individually checked on that
// day, and the notice says so in words.
//
// This file decides nothing about which records are drawn. It only words the answer of
// public.dc_source_freshness() for the data-centre sources whose records are on the page.
// A missing reader or a failed read renders nothing, never a guessed date.
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // ISO timestamp -> 'November 5, 2026' (UTC calendar day). '' when unreadable.
  function day(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return '';
    var d = new Date(v.length > 10 ? v : v + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '';
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  }
  HS.dcFreshnessDay = day;

  // How an attempt ended, in plain words. Anything we do not recognise is "did not complete":
  // an unknown state is never worded as a success.
  function outcome(state) {
    if (state === 'SUCCESS_COMPLETE') return { ok: true, text: 'completed' };
    if (state === 'IN_FLIGHT') return { ok: false, text: 'still running, or it stopped without recording a result' };
    if (state === 'FETCH_FAILED') return { ok: false, text: "did not complete: the publisher's file could not be downloaded" };
    return { ok: false, text: 'did not complete' };
  }

  // rows: dc_source_freshness() output. names: source_name values of the data-centre records the
  // page shows. Returns display entries for those sources only; pure, so it is tested in Node.
  HS.dcFreshnessEntries = function (rows, names) {
    var want = {};
    (names || []).forEach(function (n) { if (typeof n === 'string' && n) want[n] = 1; });
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && typeof r.source_name === 'string' && want[r.source_name] === 1;
    }).map(function (r) {
      var o = outcome(r.last_attempt_state);
      var attempt = day(r.last_attempt_at);
      return {
        key: String(r.source_key || ''),
        name: r.source_name,
        edition: day(r.publisher_edition_at),
        success: day(r.last_success_at),
        attempt: attempt,
        attemptOk: !!attempt && o.ok,
        attemptText: attempt ? o.text : ''
      };
    }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  };

  // The wording, one function.
  HS.dcFreshnessLines = function (e) {
    var out = [];
    out.push("Publisher's edition date: " + (e.edition || 'not stated by the publisher'));
    out.push('Our last successful read: ' + (e.success || 'none recorded'));
    if (e.attempt) {
      out.push('Our most recent read attempt: ' + e.attempt + ', ' + e.attemptText + '.'
        + (!e.attemptOk && e.success ? ' The records shown are from the ' + e.success + ' read.' : ''));
    } else {
      out.push('Our most recent read attempt: none recorded');
    }
    return out;
  };

  HS.dcFreshnessHTML = function (entries) {
    if (!entries || !entries.length) return '';
    var stale = entries.some(function (e) { return !e.attemptOk; });
    return '<div class="dcfresh" data-dc-freshness="1"' + (stale ? ' data-dc-stale="1"' : '')
      + ' style="margin:14px 0;padding:12px 14px;border:1px solid ' + (stale ? '#e0b252' : 'var(--line,#e3e3e3)')
      + ';border-radius:10px;font-size:12.5px;line-height:1.5' + (stale ? ';background:#fffaf0' : '') + '">'
      + '<div class="dcfresh-hd" style="font-weight:700;font-size:13px;margin-bottom:4px">'
      + (stale ? 'Data-center records here may be out of date' : 'About the data-center records') + '</div>'
      + '<p class="dcfresh-note" style="margin:0 0 8px;color:var(--ink-3,#666)">These dates describe each source’s '
      + 'dataset as a whole. They do not mean that each facility was individually checked on either date. '
      + 'Open a pin for the source’s own record.</p>'
      + entries.map(function (e) {
        return '<div class="dcfresh-row" style="margin-top:8px" data-dc-source="' + esc(e.key) + '"'
          + (e.attemptOk ? '' : ' data-dc-attempt-failed="1"') + '>'
          + '<div class="dcfresh-name"><b>' + esc(e.name) + '</b></div>'
          + HS.dcFreshnessLines(e).map(function (l) {
            return '<div class="dcfresh-line" style="color:var(--ink-2,#444)">' + esc(l) + '</div>';
          }).join('')
          + '</div>';
      }).join('')
      + '</div>';
  };

  // One short sentence for a data-centre pin's popup (it is also what the embedded map shows, where
  // the notice below the map is not drawn). '' when the reader has no row for that source.
  HS.dcFreshnessPopupLine = function (rows, sourceName) {
    var e = HS.dcFreshnessEntries(rows, [sourceName])[0];
    if (!e) return '';
    return 'From this source’s dataset. Publisher’s edition date: ' + (e.edition || 'not stated')
      + '. Our last successful read: ' + (e.success || 'none recorded') + '.'
      + (e.attempt && !e.attemptOk ? ' Our most recent read attempt (' + e.attempt + ') did not complete.' : '')
      + ' This facility was not individually checked on either date.';
  };

  // Fill `el`. opts.names: source_name values on the page. opts.read(): resolves to the reader's
  // rows, or null when it could not be read. Fails closed and silent.
  HS.mountDcFreshness = function (el, opts) {
    if (!el) return Promise.resolve();
    opts = opts || {};
    var token = (el.__dcFreshToken = (el.__dcFreshToken || 0) + 1);
    el.innerHTML = '';
    var names = (opts.names || []).filter(function (n) { return typeof n === 'string' && n; });
    if (!names.length || typeof opts.read !== 'function') return Promise.resolve();
    var p;
    try { p = Promise.resolve(opts.read()); } catch (e) { p = Promise.resolve(null); }
    return p.then(function (rows) { return rows; }, function () { return null; }).then(function (rows) {
      if (token !== el.__dcFreshToken || !Array.isArray(rows)) return;   // a newer mount owns the element
      el.innerHTML = HS.dcFreshnessHTML(HS.dcFreshnessEntries(rows, names));
    });
  };
})();
