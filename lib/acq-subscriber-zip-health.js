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

  // Diagnostic vocabulary (founder, 2026-11-19). Worst applicable wins for the rollup; EVERY applicable finding is kept.
  var VERDICTS = {
    BLOCKED_SOURCE_ACCESS: { label: 'Blocked source access', tone: 'bad' },
    INGESTION_FAILURE: { label: 'Ingestion failure', tone: 'bad' },
    MISSING_COVERAGE: { label: 'Missing coverage', tone: 'bad' },
    PAGE_REFRESH_FAILURE: { label: 'Page refresh failure', tone: 'bad' },
    RECORDS_MISSING_FROM_MAP: { label: 'Records missing from map', tone: 'bad' },
    STALE_DATA: { label: 'Stale data', tone: 'warn' },
    PARTIAL_COVERAGE: { label: 'Partial coverage', tone: 'warn' },
    UNVERIFIED: { label: 'Unverified', tone: 'warn' },
    VERIFIED_NO_NEW_ACTIVITY: { label: 'Verified: no new activity', tone: 'ok' },
    VERIFIED_CURRENT: { label: 'Verified current', tone: 'ok' }
  };
  var ROLLUP_ORDER = ['BLOCKED_SOURCE_ACCESS', 'INGESTION_FAILURE', 'MISSING_COVERAGE', 'PAGE_REFRESH_FAILURE',
    'RECORDS_MISSING_FROM_MAP', 'STALE_DATA', 'PARTIAL_COVERAGE', 'UNVERIFIED', 'VERIFIED_NO_NEW_ACTIVITY', 'VERIFIED_CURRENT'];
  var BLOCKED_RE = /\b(403|401|429|forbidden|access denied|cloudflare|captcha|blocked|challenge)\b/i;
  // HEURISTIC, named as one: a registry id that is a state transport program list is not a local development source.
  var TRANSPORT_ONLY_RE = /(^|-)(stip|tip|wsdot|modot|mdot|adot|capital-projects?|project-delivery-plan)(-|$)/i;

  /**
   * One ZIP's facts (hs_subscriber_zip_health) -> { key, findings:[{key,reason}], reasons[] }. Pure.
   * Findings are SIMULTANEOUS: a working source never hides a blocked one, healthy ingestion never hides a failed page.
   * VERIFIED_* needs z.reconciliation = { at, complete:true, missing:0 } (a current, valid, complete official read compared
   * record by record). Nothing in the database supplies that today, so no ZIP can read VERIFIED from this payload alone.
   */
  HS.subscriberZipFindings = function (z, nowMs) {
    var now = nowMs == null ? Date.now() : nowMs, f = [];
    var add = function (key, reason) { f.push({ key: key, reason: reason }); };
    var sources = (z && z.sources) || [];
    var report = z && z.report;
    var gov = (z && z.government) || {};

    var failing = [];
    sources.forEach(function (s) { if (num(s.failures_48h) > 0) failing.push(s); });
    ((z && z.failures_without_records) || []).forEach(function (x) { failing.push({ registry_id: x.registry_id, failure_reason: x.reason, failures_48h: x.failures_48h }); });
    failing.forEach(function (s) {
      var why = String(s.failure_reason || '');
      add(BLOCKED_RE.test(why) ? 'BLOCKED_SOURCE_ACCESS' : 'INGESTION_FAILURE', s.registry_id + ': failed read in the last 48 h' + (why ? ' (' + why + ')' : ''));
    });

    if (!sources.length) add('MISSING_COVERAGE', 'No development source has stored a record for this ZIP (not evidence that nothing is being built)');
    else if (sources.every(function (s) { return TRANSPORT_ONLY_RE.test(String(s.registry_id)); })) {
      add('PARTIAL_COVERAGE', 'Only state transport-program sources store records here; no local permit or planning source is connected');
    }
    if (num(gov.feeds_total) === 0) add('PARTIAL_COVERAGE', 'No government feed is wired on this ZIP’s county chain');
    else if (num(gov.feeds_active) < num(gov.feeds_total)) add('PARTIAL_COVERAGE', num(gov.feeds_total) - num(gov.feeds_active) + ' of ' + num(gov.feeds_total) + ' government feed(s) on the county chain are inactive');

    if (!report) add('PAGE_REFRESH_FAILURE', 'No cached ZIP report exists for this page');
    else {
      var age = hoursSince(report.refreshed_at, now);
      if (age === null) add('PAGE_REFRESH_FAILURE', 'ZIP report has no refresh time');
      else if (age > REPORT_STALE_HOURS) add('STALE_DATA', 'ZIP report last refreshed ' + ago(report.refreshed_at, now));
      if (report.facilities_unavailable) add('UNVERIFIED', 'EPA facility layer unavailable on the last read');
    }
    if (num(z && z.not_in_serving_generation) > 0) add('RECORDS_MISSING_FROM_MAP', num(z.not_in_serving_generation) + ' recent live record(s) are in no ZIP’s Map 1 (not in the serving generation)');

    sources.forEach(function (s) {
      var seen = hoursSince(s.last_seen, now);
      if (seen === null) add('UNVERIFIED', s.registry_id + ': no read time recorded');
      else if (seen > REPORT_STALE_HOURS) add('STALE_DATA', s.registry_id + ': last read ' + ago(s.last_seen, now));
      if (!s.cadence) add('UNVERIFIED', s.registry_id + ': expected schedule not recorded in the source registry');
    });

    var rec = z && z.reconciliation;
    if (!(rec && rec.complete === true && num(rec.missing) === 0 && hoursSince(rec.at, now) !== null && hoursSince(rec.at, now) <= REPORT_STALE_HOURS)) {
      add('UNVERIFIED', 'No current, complete official-source reconciliation is on record for this ZIP');
    }

    var keys = {}; f.forEach(function (x) { keys[x.key] = true; });
    var key = null;
    for (var i = 0; i < ROLLUP_ORDER.length; i++) { if (keys[ROLLUP_ORDER[i]]) { key = ROLLUP_ORDER[i]; break; } }
    if (!key) {
      var newest = sources.map(function (s) { return t(s.newest_filed); }).filter(function (x) { return x !== null; });
      var latest = newest.length ? Math.max.apply(null, newest) : null;
      key = (latest !== null && (now - latest) / 864e5 <= ACTIVITY_DAYS) ? 'VERIFIED_CURRENT' : 'VERIFIED_NO_NEW_ACTIVITY';
    }
    return { key: key, findings: f, reasons: f.map(function (x) { return x.reason; }) };
  };
  HS.subscriberZipVerdict = HS.subscriberZipFindings; // one decision; the old name is kept only as an alias

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
      (v.findings.length ? '<ul class="szh-why">' + v.findings.map(function (x) { return '<li><b>' + esc((VERDICTS[x.key] || {}).label || x.key) + '</b> · ' + esc(x.reason) + '</li>'; }).join('') + '</ul>' : '') +
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
