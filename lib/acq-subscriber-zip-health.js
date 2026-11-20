/* Acquisition Dashboard · Tab 2 "Subscriber ZIP Health" (2026-11-19).
   A version-controlled renderer for ONE gated, read-only answer: public.hs_subscriber_zip_health()
   (docs/subscriber-zip-health.sql). ZIPs with a real subscriber are listed first on Feed Intelligence, each with
   its sources, last read, failures, records missing from Map 1, pending posts and email readiness.
   It decides NO eligibility and sends/publishes NOTHING. The one decision made here is the per-ZIP VERDICT
   (HS.subscriberZipVerdict): the worst applicable state wins, and a missing instrument is UNVERIFIED, never fine.
   Every value goes through esc() before it is placed in markup. */
(function () {
  'use strict';
  var HS = (typeof window !== 'undefined') ? (window.HS = window.HS || {}) : (globalThis.HS = globalThis.HS || {});

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function t(v) { var x = v ? Date.parse(v) : NaN; return isNaN(x) ? null : x; }
  function hoursSince(v, now) { var x = t(v); return x === null ? null : (now - x) / 36e5; }
  function ago(v, now) {
    var h = hoursSince(v, now);
    if (h === null) return 'never recorded';
    if (h < 1) return 'under an hour ago';
    if (h < 48) return Math.round(h) + ' h ago';
    return Math.round(h / 24) + ' days ago';
  }

  var REPORT_STALE_HOURS = 72;       // the coverage-state window for a report still on schedule (53 h sweep + margin)
  var ACTIVITY_DAYS = 30;            // "latest development activity" window

  var VERDICTS = {
    FAILED_INGESTION: { label: 'Failed ingestion', tone: 'bad' },
    MISSING_SOURCE_COVERAGE: { label: 'Missing source coverage', tone: 'bad' },
    RECORDS_MISSING_FROM_MAP1: { label: 'Records missing from Map 1', tone: 'bad' },
    UNVERIFIED: { label: 'Unverified coverage', tone: 'warn' },
    NO_NEW_DEVELOPMENT_ACTIVITY: { label: 'No new development activity', tone: 'ok' },
    ACTIVITY_CAPTURED: { label: 'Recent activity captured', tone: 'ok' }
  };

  /**
   * One ZIP's facts (hs_subscriber_zip_health) -> { key, reasons[] }. Worst applicable wins. Pure.
   * "ok" tones still carry the standing note that official-record reconciliation is not automated.
   */
  HS.subscriberZipVerdict = function (z, nowMs) {
    var now = nowMs == null ? Date.now() : nowMs;
    var reasons = [];
    var sources = (z && z.sources) || [];
    var report = z && z.report;

    var failing = sources.filter(function (s) { return num(s.failures_48h) > 0; })
      .map(function (s) { return s.registry_id; })
      .concat(((z && z.failures_without_records) || []).map(function (f) { return f.registry_id; }));
    var repAge = report ? hoursSince(report.refreshed_at, now) : null;
    if (failing.length) reasons.push('Failed read in the last 48 h: ' + failing.join(', '));
    if (report && repAge !== null && repAge > REPORT_STALE_HOURS) reasons.push('ZIP report last refreshed ' + ago(report.refreshed_at, now));
    if (reasons.length) return { key: 'FAILED_INGESTION', reasons: reasons };

    if (!sources.length) return { key: 'MISSING_SOURCE_COVERAGE', reasons: ['No development source has stored a record for this ZIP'] };

    if (num(z.not_in_serving_generation) > 0) {
      return { key: 'RECORDS_MISSING_FROM_MAP1', reasons: [num(z.not_in_serving_generation) + ' recent live record(s) are in no ZIP’s Map 1 (not in the serving generation)'] };
    }

    if (!report) reasons.push('No cached ZIP report');
    else if (report.facilities_unavailable) reasons.push('EPA facility layer unavailable on the last read');
    sources.forEach(function (s) {
      if (!s.last_seen) reasons.push(s.registry_id + ': no read time recorded');
      if (!s.cadence) reasons.push(s.registry_id + ': expected schedule not recorded in the source registry');
    });
    if (reasons.length) return { key: 'UNVERIFIED', reasons: reasons };

    var newest = sources.map(function (s) { return t(s.newest_filed); }).filter(function (x) { return x !== null; });
    var latest = newest.length ? Math.max.apply(null, newest) : null;
    var recent = latest !== null && (now - latest) / 864e5 <= ACTIVITY_DAYS;
    return { key: recent ? 'ACTIVITY_CAPTURED' : 'NO_NEW_DEVELOPMENT_ACTIVITY', reasons: [] };
  };

  function postsLine(z) {
    var p = z.posts || {};
    var order = ['draft', 'approved', 'published', 'skipped'];
    var bits = order.filter(function (k) { return p[k]; }).map(function (k) { return num(p[k].n) + ' ' + k; });
    return bits.length ? bits.join(' · ') : 'no MAPS posts';
  }

  // Email readiness: states facts only. It never sends and never claims a delivery that is not in email_deliveries.
  function emailLine(z) {
    var e = z.email || {}, subs = num(z.subscribers), pub = num(e.published_posts), dl = num(e.deliveries), dup = num(e.duplicate_deliveries);
    if (dup > 0) return { tone: 'bad', text: dup + ' duplicate delivery row(s) for a published post: investigate before the next send' };
    if (!pub) return { tone: 'warn', text: subs + ' subscriber(s) waiting: no published MAPS post for this ZIP, so no email can go out yet' };
    return { tone: 'ok', text: subs + ' subscriber(s) · ' + pub + ' published post(s) · ' + dl + ' delivery row(s), no duplicates' };
  }

  function sourcesTable(z, now) {
    var rows = (z.sources || []).map(function (s) {
      var bad = num(s.failures_48h) > 0;
      return '<tr><td>' + esc(s.registry_id) + '</td><td>' + esc(num(s.records)) + '</td><td>' + esc(s.newest_filed || '—') +
        '</td><td>' + esc(ago(s.last_seen, now)) + '</td><td>' + esc(s.cadence || 'not recorded') + '</td><td' + (bad ? ' class="szh-bad"' : '') + '>' +
        (bad ? esc(s.failures_48h + ' failed · ' + (s.failure_reason || '')) : 'none') + '</td></tr>';
    }).join('');
    (z.failures_without_records || []).forEach(function (f) {
      rows += '<tr><td>' + esc(f.registry_id) + '</td><td>0</td><td>—</td><td>—</td><td>not recorded</td><td class="szh-bad">' +
        esc(f.failures_48h + ' failed · ' + (f.reason || '')) + '</td></tr>';
    });
    return '<table class="szh-tbl"><thead><tr><th>Development source</th><th>Records</th><th>Newest filed</th><th>Last read</th><th>Expected schedule</th><th>Failures (48 h)</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">No development source has stored a record for this ZIP.</td></tr>') + '</tbody></table>';
  }

  function card(z, now) {
    var v = HS.subscriberZipVerdict(z, now), meta = VERDICTS[v.key];
    var g = z.government || {}, rep = z.report;
    var email = emailLine(z);
    var live = num(z.recent_live_records);
    var map1 = live + ' recent live record(s): ' + num(z.drawn_on_map1) + ' drawn on this ZIP’s Map 1 · ' + num(z.drawn_on_other_zip) +
      ' belong to a neighbouring ZIP’s page · ' + num(z.not_in_serving_generation) + ' in no Map 1 yet';
    return '<div class="szh-card szh-' + meta.tone + '"><div class="szh-head"><strong class="szh-zip">' + esc(z.zip) + '</strong>' +
      '<span class="szh-chip szh-chip-' + meta.tone + '">' + esc(meta.label) + '</span><span class="szh-subs">' + esc(num(z.subscribers)) + ' subscriber(s)</span></div>' +
      (v.reasons.length ? '<ul class="szh-why">' + v.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' : '') +
      sourcesTable(z, now) +
      '<div class="szh-rows">' +
      '<div><b>Map 1</b> ' + esc(map1) + '</div>' +
      '<div><b>ZIP report</b> refreshed ' + esc(rep ? ago(rep.refreshed_at, now) : 'never') + (rep && rep.facilities_unavailable ? ' · EPA layer unavailable' : '') + '</div>' +
      '<div><b>Government feeds</b> ' + esc(num(g.feeds_active)) + ' of ' + esc(num(g.feeds_total)) + ' active on this ZIP’s county chain · newest notice or meeting stored ' + esc(ago(g.newest_item, now)) + '</div>' +
      '<div><b>Bluesky MAPS posts</b> ' + esc(postsLine(z)) + '</div>' +
      '<div><b>Email alert</b> <span class="szh-e-' + email.tone + '">' + esc(email.text) + '</span></div>' +
      '<div class="szh-gap"><b>Not instrumented</b> official-record reconciliation against the city’s own system is a one-time check, not a standing one; this card cannot say a source is complete.</div>' +
      '</div></div>';
  }

  var CSS = '.szh{margin:0 0 18px}.szh h3{margin:0 0 4px}.szh-sub{font-size:13px;opacity:.75;margin:0 0 10px}.szh-card{border:1px solid var(--line,#d6d6d6);border-left-width:5px;border-radius:8px;padding:12px 14px;margin:0 0 12px;background:var(--card,#fff)}' +
    '.szh-bad{border-left-color:#c0392b}.szh-warn{border-left-color:#d68910}.szh-ok{border-left-color:#1e8449}.szh-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.szh-zip{font-size:20px}' +
    '.szh-chip{font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px;color:#fff}.szh-chip-bad{background:#c0392b}.szh-chip-warn{background:#b9770e}.szh-chip-ok{background:#1e8449}' +
    '.szh-why{margin:8px 0 0 18px;padding:0;font-size:13px}.szh-tbl{width:100%;border-collapse:collapse;font-size:12.5px;margin:10px 0}.szh-tbl th,.szh-tbl td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--line,#e6e6e6)}' +
    'td.szh-bad{color:#c0392b;font-weight:600}.szh-rows{font-size:13px;display:grid;gap:4px}.szh-rows b{display:inline-block;min-width:130px}.szh-e-bad{color:#c0392b}.szh-e-warn{color:#b9770e}.szh-gap{opacity:.8}' +
    '@media(max-width:640px){.szh-tbl{display:block;overflow-x:auto}.szh-rows b{display:block;min-width:0}}';

  function shell(inner) {
    return '<style>' + CSS + '</style><h3>Subscriber ZIP Health</h3><p class="szh-sub">ZIPs with a real subscriber, checked end to end. Read-only: nothing here sends an email or publishes a post.</p>' + inner;
  }

  HS.acqSubscriberZipHealth = {
    esc: esc,
    renderZips: function (answer, now) {
      var zips = (answer && answer.zips) || [];
      if (!zips.length) return shell('<div class="szh-card szh-warn">No real-subscriber ZIPs were returned. That is an unverified state, not an all-clear.</div>');
      return shell(zips.map(function (z) { return card(z, now == null ? Date.now() : now); }).join(''));
    },
    // Prepends one host to the Feed Intelligence tab (the snapshot rewrites that tab's innerHTML, so this is called after each render).
    mount: function (client, tabEl) {
      if (!tabEl || !client || typeof client.rpc !== 'function') return;
      var host = tabEl.querySelector('#szh-host');
      if (!host) { host = document.createElement('div'); host.id = 'szh-host'; host.className = 'szh'; tabEl.insertBefore(host, tabEl.firstChild); }
      host.innerHTML = shell('<div class="szh-sub">Loading subscriber ZIP health…</div>');
      client.rpc('hs_subscriber_zip_health').then(function (r) {
        if (r.error) { host.innerHTML = shell('<div class="szh-card szh-bad">Could not read subscriber ZIP health (' + esc(r.error.message || 'error') + '). Treat every ZIP as unverified.</div>'); return; }
        host.innerHTML = HS.acqSubscriberZipHealth.renderZips(r.data, Date.now());
      }, function () { host.innerHTML = shell('<div class="szh-card szh-bad">Could not reach the dashboard service. Treat every ZIP as unverified.</div>'); });
    }
  };
})();
