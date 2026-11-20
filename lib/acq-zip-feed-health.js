/* Acquisition Dashboard · Tab 2 "All ZIP pages and feeds" roll-up (2026-11-20).
   A version-controlled renderer for ONE gated, read-only answer: public.hs_zip_feed_health() (docs/zip-feed-health-rollup.sql).
   It sits BELOW Subscriber ZIP Health and is separate from it: that section judges ZIPs with a real subscriber one by one; this one
   counts every canonical ZIP page and every development source. Each failure class is its own state, so one cannot hide inside another,
   and anything not computed is listed as not computed (never shown as zero). It sends and publishes nothing.
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
  function fmt(v) { return num(v).toLocaleString('en-US'); }
  function t(v) { var x = v ? Date.parse(v) : NaN; return isNaN(x) ? null : x; }
  function ago(v, now) {
    var x = t(v); if (x === null) return 'never recorded';
    var h = (now - x) / 36e5;
    if (h < 1) return 'under an hour ago';
    if (h < 48) return Math.round(h) + ' h ago';
    return Math.round(h / 24) + ' days ago';
  }

  var HARD_KINDS = { fetch_failed: 1, fire_failed: 1, fire_http_error: 1 };   // a read that did not complete
  // 'retired' and 'truncated' are reported but never counted as a failed read.

  /**
   * rollup (hs_subscriber... no: hs_zip_feed_health().rollup) -> list of states. Each is one failure class, never merged. Pure.
   * tone: bad (needs action), warn (needs a look), info (context), unverified (an instrument is missing: never fine).
   */
  HS.zipFeedHealthStates = function (r) {
    var z = (r && r.zips) || {}, out = [];
    var reg = num(z.registry_zips), withRep = num(z.with_report);
    var stale = num(z.refreshed_72h_7d) + num(z.refreshed_older_7d);

    out.push({ key: 'ZIP_PAGES_WITHOUT_REPORT', label: 'ZIP pages with no report', count: Math.max(reg - withRep, 0), tone: reg - withRep > 0 ? 'bad' : 'ok',
      detail: fmt(withRep) + ' of ' + fmt(reg) + ' canonical ZIP pages hold a report' });
    out.push({ key: 'STALE_REPORTS', label: 'Stale reports (older than 72 h)', count: stale, tone: stale > 0 ? 'bad' : 'ok',
      detail: fmt(z.refreshed_72h_7d) + ' are 3–7 days old, ' + fmt(z.refreshed_older_7d) + ' are older than 7 days' });
    out.push({ key: 'EPA_LAYER_FAILURES', label: 'EPA facility layer unavailable', count: num(z.epa_layer_unavailable), tone: num(z.epa_layer_unavailable) > 0 ? 'warn' : 'ok',
      detail: fmt(z.epa_clock_older_7d) + ' ZIPs have not had a good EPA read in over 7 days (the count on those pages is unknown, not zero)' });

    var srcs = (r && r.sources_48h) || [];
    var hard = srcs.filter(function (s) { return HARD_KINDS[s.kind]; });
    var hardNames = {}; hard.forEach(function (s) { hardNames[s.registry_id] = 1; });
    var n = Object.keys(hardNames).length;
    out.push({ key: 'SOURCE_FAILURES', label: 'Sources with failed reads (48 h)', count: n, tone: n > 0 ? 'bad' : 'ok',
      detail: n ? 'Largest: ' + hard.slice(0, 3).map(function (s) { return s.registry_id + ' (' + fmt(s.zips) + ' ZIPs)'; }).join(', ') : 'none in the last 48 h' });

    out.push({ key: 'MAP_PLACEMENT', label: 'Map 1 placement', count: num(z.no_map_area_by_design), tone: 'info',
      detail: fmt(z.map_area_measured) + ' ZIPs have a measured map area; ' + fmt(z.no_map_area_by_design) + ' have none by design (no Census area). Serving generation: ' + (z.serving_generation || 'unknown') });

    var p = (r && r.publishing) || {}, al = (r && r.alarms) || {};
    var pend = num(p.drafts_waiting_over_3d) + num(p.approved_not_published) + num(al.failing);
    out.push({ key: 'PUBLISHING', label: 'Downstream publishing', count: pend, tone: pend > 0 ? 'warn' : 'ok',
      detail: fmt(p.drafts_waiting_over_3d) + ' MAPS drafts waiting over 3 days · ' + fmt(p.approved_not_published) + ' approved, not yet published · ' + fmt(al.failing) + ' of ' + fmt(al.total) + ' monitor checks failing' });

    var sr = (r && r.source_registry) || {};
    var nc = (r && r.not_computed) || [];
    out.push({ key: 'UNVERIFIED_COVERAGE', label: 'Coverage not verified', count: nc.length + (num(sr.registered_sources) - num(sr.with_schedule) > 0 ? 1 : 0), tone: 'unverified',
      detail: 'Expected schedule recorded for ' + fmt(sr.with_schedule) + ' of ' + fmt(sr.registered_sources) + ' registered sources. Not computed: ' + nc.join('; ') + '. A ZIP with no new activity is a different fact from a ZIP whose coverage was never verified.' });
    return out;
  };

  function tile(s) {
    return '<div class="zfh-tile zfh-' + esc(s.tone) + '"><div class="zfh-n">' + esc(s.tone === 'unverified' ? '?' : fmt(s.count)) + '</div><div class="zfh-l">' + esc(s.label) + '</div><div class="zfh-d">' + esc(s.detail) + '</div></div>';
  }

  function sourcesTable(r, now) {
    var rows = ((r && r.sources_48h) || []).map(function (s) {
      var cls = HARD_KINDS[s.kind] ? ' class="zfh-bad"' : '';
      return '<tr><td>' + esc(s.registry_id) + '</td><td' + cls + '>' + esc(s.kind) + '</td><td>' + esc(fmt(s.zips)) + '</td><td>' + esc(num(s.subscriber_zips) ? fmt(s.subscriber_zips) : '—') +
        '</td><td>' + esc(ago(s.last_seen, now)) + '</td><td>' + esc(String(s.sample_reason || '').slice(0, 90)) + '</td></tr>';
    }).join('');
    return '<h4>Source events in the last 48 h</h4><table class="zfh-tbl"><thead><tr><th>Source</th><th>Kind</th><th>ZIPs</th><th>Subscriber ZIPs</th><th>Latest</th><th>Reason</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">No source events in the last 48 h.</td></tr>') + '</tbody></table>';
  }

  function stalestTable(r, now) {
    var rows = ((r && r.zips && r.zips.stalest) || []).slice(0, 10).map(function (s) {
      return '<tr><td>' + esc(s.zip) + (s.subscriber_zip ? ' <b>(subscriber ZIP)</b>' : '') + '</td><td>' + esc(ago(s.refreshed_at, now)) + '</td><td>' + (s.epa_unavailable ? 'EPA unavailable' : '') + '</td></tr>';
    }).join('');
    return '<h4>Ten stalest ZIP reports</h4><table class="zfh-tbl"><thead><tr><th>ZIP</th><th>Last refreshed</th><th>Layer</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function alarmsList(r) {
    var a = ((r && r.alarms) || {}).failing_checks || [];
    if (!a.length) return '';
    return '<h4>Monitor checks failing now</h4><ul class="zfh-alarms">' + a.map(function (c) { return '<li><b>' + esc(c.check) + '</b> — ' + esc(c.detail) + '</li>'; }).join('') + '</ul>';
  }

  // ---- Standing monitor (hs_zip_feed_health_monitor): run status, jobs, findings with first seen / last checked / recovered ----
  var STALE_RUN_H = 2;   // the monitor runs hourly; two hours without a good run means the monitor itself is not working
  HS.zipFeedMonitorStatus = function (m, now) {
    if (!m || !m.last_run) return { tone: 'bad', text: 'The standing monitor has never recorded a run. Nothing below has been checked automatically.' };
    var lr = m.last_run, ok = t(m.last_ok_run_at);
    if (!lr.ok) return { tone: 'bad', text: 'The latest monitor run FAILED (' + (lr.error || 'unknown error') + '). Last good run: ' + ago(m.last_ok_run_at, now) + '. Findings below may be out of date.' };
    if (ok === null || (now - ok) / 36e5 > STALE_RUN_H) return { tone: 'bad', text: 'The standing monitor is STALE: last good run ' + ago(m.last_ok_run_at, now) + ' (expected hourly). Findings below are out of date.' };
    return { tone: 'ok', text: 'Standing monitor ran ' + ago(m.last_ok_run_at, now) + ' (hourly). ' + fmt(m.runs_24h) + ' runs in 24 h, ' + fmt(m.failed_runs_24h) + ' failed.' };
  };

  function cronTable(m, now) {
    var rows = ((m && m.cron) || []).map(function (c) {
      var okT = t(c.last_ok), late = okT === null || (now - okT) / 6e4 > num(c.max_age_minutes) || !c.registered;
      return '<tr><td>' + esc(c.job) + '</td><td>' + esc(c.schedule) + '</td><td' + (late ? ' class="zfh-bad"' : '') + '>' + esc(c.registered ? ago(c.last_ok, now) : 'NOT REGISTERED') + '</td><td>' + esc(num(c.max_age_minutes) + ' min') + '</td><td>' + esc(c.owner) + '</td></tr>';
    }).join('');
    return '<h4>Scheduled checks this tab depends on</h4><table class="zfh-tbl"><thead><tr><th>Job</th><th>Schedule</th><th>Last success</th><th>Tolerated gap</th><th>Owner</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="zfh-sub">Only these checks run automatically. Anything not listed (comparison with official city records, per-source expected schedules) is not running; see "Coverage not verified".</p>';
  }

  function findingRow(f, now) {
    var d = f.detail || {}, rec = !!f.resolved_at, zips = d.zips || [], zc = num(d.zip_count);
    var zl = zips.length ? '<div>Affected ZIPs (' + fmt(zc || zips.length) + (zc > zips.length ? ', first ' + zips.length + ' shown' : '') + '): ' + zips.map(function (z) { return esc(z.zip) + (z.subscriber ? '*' : ''); }).join(', ') + (zips.some(function (z) { return z.subscriber; }) ? ' <i>(* subscriber ZIP)</i>' : '') + '</div>' : '';
    return '<details class="zfh-f zfh-' + esc(rec ? 'ok' : f.severity) + '"><summary><b>' + esc(rec ? 'RECOVERED' : 'ONGOING') + '</b> · ' + esc(f.subject) + ' — ' + esc(d.what || f.class) + (zc ? ' · ' + fmt(zc) + ' ZIPs' : '') + '</summary>' +
      '<div><b>Evidence:</b> ' + esc(d.evidence) + '</div><div><b>Threshold:</b> ' + esc(d.threshold) + '</div><div><b>Action:</b> ' + esc(d.action) + ' <i>(owner: ' + esc(d.owner) + ')</i></div>' +
      '<div><b>First seen:</b> ' + esc(ago(f.first_seen, now)) + ' · <b>Last checked:</b> ' + esc(ago(f.last_seen, now)) + (rec ? ' · <b>Recovered:</b> ' + esc(ago(f.resolved_at, now)) : '') + '</div>' + zl + '</details>';
  }

  function findingsHtml(m, now) {
    var all = (m && m.findings) || [], open = all.filter(function (f) { return !f.resolved_at; }), rec = all.filter(function (f) { return f.resolved_at; });
    open.sort(function (a, b) { var s = { bad: 0, warn: 1, unverified: 2 }; return (s[a.severity] - s[b.severity]) || (num((b.detail || {}).zip_count) - num((a.detail || {}).zip_count)); });
    return '<h4>Findings now (' + open.length + ')</h4>' + (open.map(function (f) { return findingRow(f, now); }).join('') || '<div class="zfh-sub">No open findings from the checks that run. This does not prove coverage; see the unverified items.</div>') +
      '<h4>Recovered in the last 7 days (' + rec.length + ')</h4>' + (rec.map(function (f) { return findingRow(f, now); }).join('') || '<div class="zfh-sub">None.</div>');
  }

  var CSS = '.zfh-f{border:1px solid var(--line,#d6d6d6);border-left-width:5px;border-radius:6px;padding:6px 10px;margin:4px 0;font-size:12.5px}.zfh-f summary{cursor:pointer}.zfh-f>div{margin-top:3px}' +
    '.zfh{margin:0 0 18px}.zfh h3{margin:0 0 4px}.zfh h4{margin:14px 0 4px;font-size:13px}.zfh-sub{font-size:13px;opacity:.75;margin:0 0 10px}.zfh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}' +
    '.zfh-tile{border:1px solid var(--line,#d6d6d6);border-left-width:5px;border-radius:8px;padding:10px 12px;background:var(--card,#fff)}.zfh-bad{border-left-color:#c0392b}.zfh-warn{border-left-color:#d68910}.zfh-ok{border-left-color:#1e8449}.zfh-info{border-left-color:#5d6d7e}.zfh-unverified{border-left-color:#8e44ad;border-style:dashed}' +
    '.zfh-n{font-size:22px;font-weight:700}.zfh-l{font-size:13px;font-weight:600}.zfh-d{font-size:12px;opacity:.8;margin-top:4px}.zfh-tbl{width:100%;border-collapse:collapse;font-size:12.5px}.zfh-tbl th,.zfh-tbl td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--line,#e6e6e6)}' +
    'td.zfh-bad{color:#c0392b;font-weight:600}.zfh-alarms{font-size:12.5px;margin:0 0 0 18px;padding:0}@media(max-width:640px){.zfh-tbl{display:block;overflow-x:auto}}';

  function shell(inner) {
    return '<style>' + CSS + '</style><h3>All ZIP pages and feeds</h3><p class="zfh-sub">Every canonical ZIP page and development source, in counts. Separate from Subscriber ZIP Health above, which judges subscriber ZIPs one by one. Read-only: nothing here sends an email or publishes a post.</p>' + inner;
  }

  HS.acqZipFeedHealth = {
    esc: esc,
    render: function (answer, now, monitor) {
      var r = answer && answer.rollup;
      if (!r) return shell('<div class="zfh-tile zfh-bad">No roll-up was returned. Treat every ZIP page and feed as unverified.</div>');
      var n = now == null ? Date.now() : now;
      var ms = monitor === undefined ? null : HS.zipFeedMonitorStatus(monitor, n);
      var mon = ms ? '<div class="zfh-tile zfh-' + esc(ms.tone) + '"><div class="zfh-l">Monitoring status</div><div class="zfh-d">' + esc(ms.text) + '</div></div>' + findingsHtml(monitor, n) + cronTable(monitor, n)
        : '<div class="zfh-tile zfh-unverified"><div class="zfh-l">Monitoring history unavailable</div><div class="zfh-d">The standing monitor could not be read, so recovery tracking and the job check are unverified.</div></div>';
      return shell(mon + '<h4>Current counts (live)</h4><div class="zfh-grid">' + HS.zipFeedHealthStates(r).map(tile).join('') + '</div>' + sourcesTable(r, n) + stalestTable(r, n) + alarmsList(r) +
        '<p class="zfh-sub">As of ' + esc(answer.as_of || 'unknown') + '.</p>');
    },
    // Inserted directly after the subscriber section (or first, if that is absent); called after each snapshot render.
    mount: function (client, tabEl) {
      if (!tabEl || !client || typeof client.rpc !== 'function') return;
      var host = tabEl.querySelector('#zfh-host');
      if (!host) {
        host = document.createElement('div'); host.id = 'zfh-host'; host.className = 'zfh';
        var after = tabEl.querySelector('#szh-host');
        if (after && after.nextSibling) tabEl.insertBefore(host, after.nextSibling);
        else if (after) tabEl.appendChild(host);
        else tabEl.insertBefore(host, tabEl.firstChild);
      }
      host.innerHTML = shell('<div class="zfh-sub">Loading ZIP page and feed health…</div>');
      var monP = client.rpc('hs_zip_feed_health_monitor').then(function (r) { return r.error ? null : r.data; }, function () { return null; });
      client.rpc('hs_zip_feed_health').then(function (res) {
        if (res.error) { host.innerHTML = shell('<div class="zfh-tile zfh-bad">Could not read ZIP page and feed health (' + esc(res.error.message || 'error') + '). Treat every ZIP page and feed as unverified.</div>'); return; }
        return monP.then(function (m) { host.innerHTML = HS.acqZipFeedHealth.render(res.data, Date.now(), m == null ? undefined : m); });
      }, function () { host.innerHTML = shell('<div class="zfh-tile zfh-bad">Could not reach the dashboard service. Treat every ZIP page and feed as unverified.</div>'); });
    }
  };
})();
