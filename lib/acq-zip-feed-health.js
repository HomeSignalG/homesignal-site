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
  HS.zipFeedHealthStates = function (r, monitor) {
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
    // The roll-up lists only its top 40 source rows; the monitor's open findings cover every failing source, so prefer them (one count, one unit: sources).
    var openF = ((monitor && monitor.findings) || []).filter(function (f) { return !f.resolved_at; });
    if (monitor) n = openF.filter(function (f) { return f.class === 'SOURCE_READ_FAILURE'; }).length;
    out.push({ key: 'SOURCE_FAILURES', label: 'Sources with failed reads (48 h)', count: n, tone: n > 0 ? 'bad' : 'ok',
      detail: n ? 'Largest: ' + hard.slice(0, 3).map(function (s) { return s.registry_id + ' (' + fmt(s.zips) + ' ZIPs)'; }).join(', ') : 'none in the last 48 h' });

    out.push({ key: 'MAP_PLACEMENT', label: 'Map 1 placement', count: num(z.no_map_area_by_design), tone: 'info',
      detail: fmt(z.map_area_measured) + ' ZIPs have a measured map area; ' + fmt(z.no_map_area_by_design) + ' have none by design (no Census area). Serving generation: ' + (z.serving_generation || 'unknown') });

    var p = (r && r.publishing) || {}, al = (r && r.alarms) || {};
    // Unit: open findings (one per publishing issue). Drafts, posts and checks are different things and are not added together.
    var pubClasses = { MAPS_DRAFTS_WAITING: 1, MAPS_APPROVED_NOT_PUBLISHED: 1, MONITOR_CHECK_FAILING: 1 };
    var pend = monitor ? openF.filter(function (f) { return pubClasses[f.class]; }).length : (num(p.drafts_waiting_over_3d) > 0 ? 1 : 0) + (num(p.approved_not_published) > 0 ? 1 : 0) + (num(al.failing) > 0 ? 1 : 0);
    out.push({ key: 'PUBLISHING', label: 'Downstream publishing (open issues)', count: pend, tone: pend > 0 ? 'warn' : 'ok',
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

  function sourcesTable(r, now, failing) {
    var rows = ((r && r.sources_48h) || []).map(function (s) {
      var cls = HARD_KINDS[s.kind] ? ' class="zfh-bad"' : '';
      return '<tr><td>' + esc(s.registry_id) + '</td><td' + cls + '>' + esc(s.kind) + '</td><td>' + esc(fmt(s.zips)) + '</td><td>' + esc(num(s.subscriber_zips) ? fmt(s.subscriber_zips) : '—') +
        '</td><td>' + esc(ago(s.last_seen, now)) + '</td><td>' + esc(String(s.sample_reason || '').slice(0, 90)) + '</td></tr>';
    }).join('');
    var shown = ((r && r.sources_48h) || []).length;
    var cap = (failing != null && failing > 0) ? ' <span class="zfh-sub">Preview: the top ' + shown + ' source/kind rows by ZIPs. All ' + fmt(failing) + ' failing sources are in Findings above.</span>' : ' <span class="zfh-sub">Preview of the top ' + shown + ' rows only.</span>';
    return '<h4>Source events in the last 48 h</h4>' + cap + '<table class="zfh-tbl"><thead><tr><th>Source</th><th>Kind</th><th>ZIPs</th><th>Subscriber ZIPs</th><th>Latest</th><th>Reason</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">No source events in the last 48 h.</td></tr>') + '</tbody></table>';
  }

  function stalestTable(r, now) {
    var rows = ((r && r.zips && r.zips.stalest) || []).slice(0, 10).map(function (s) {
      return '<tr><td>' + esc(s.zip) + (s.subscriber_zip ? ' <b>(subscriber ZIP)</b>' : '') + '</td><td>' + esc(ago(s.refreshed_at, now)) + '</td><td>' + (s.epa_unavailable ? 'EPA unavailable' : '') + '</td></tr>';
    }).join('');
    return '<h4>Ten stalest ZIP reports (preview; the full list is under Findings → all ZIP pages)</h4><table class="zfh-tbl"><thead><tr><th>ZIP</th><th>Last refreshed</th><th>Layer</th></tr></thead><tbody>' + rows + '</tbody></table>';
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

  var EVID = { STORED_OUTPUT_WITHIN_30D: 'Something stored for the community in the last 30 days (proxy)', STORED_OUTPUT_OLDER_THAN_30D: 'Something stored, but nothing in 30 days (proxy; a quiet feed is not necessarily broken)', NO_STORED_OUTPUT_FOR_COMMUNITY: 'Nothing ever stored for the community (proxy)', INACTIVE: 'Inactive' };
  var KIND = { meetings: 'Meetings feeds', alerts_government: 'Government-notice alert feeds', alerts_news: 'News alert feeds', other: 'Other' };
  function feedBtn(filter, label) { return '<div><button type="button" class="zfh-feeds" data-filter="' + esc(filter) + '" data-off="0">' + esc(label) + '</button><div class="zfh-fout"></div></div>'; }
  var HSTATE = [
    ['READ_OK_ITEMS', 'Successful read, items returned', 'ok'],
    ['READ_OK_ZERO_ITEMS', 'Successful read, zero items (not a failure)', 'ok'],
    ['READ_FAILED', 'Failed read (newest outcome)', 'bad'],
    ['READ_UNCERTAIN', 'Uncertain read (a response the adapter could not classify; neither failed nor confirmed empty)', 'unverified'],
    ['READ_UNKNOWN_OUTCOME', 'Unrecognised outcome value (not counted as a success)', 'unverified'],
    ['STALE_EVIDENCE', 'Stale monitoring evidence (no outcome within the monitoring threshold)', 'unverified'],
    ['NEVER_CHECKED', 'Never checked (no recorded outcome)', 'unverified']];
  // One line per feed: its READ HEALTH (from the per-feed outcome), never the community-output proxy.
  HS.feedReadLine = function (f) {
    var lab = { READ_OK_ITEMS: 'Read OK', READ_OK_ZERO_ITEMS: 'Read OK, zero items', READ_FAILED: 'READ FAILED', READ_UNCERTAIN: 'READ UNCERTAIN', READ_UNKNOWN_OUTCOME: 'Unrecognised outcome', STALE_EVIDENCE: 'Stale monitoring evidence', NEVER_CHECKED: 'Never checked', INACTIVE: 'Inactive' };
    var h = f.health || 'NEVER_CHECKED', t = lab[h] || h;
    if (f.last_attempt_at) t += ' · last read ' + ago(f.last_attempt_at, Date.now());
    if (h === 'READ_OK_ITEMS' && f.items_returned != null) t += ' · ' + f.items_returned + ' items' + (f.newest_item_date ? ', newest item ' + String(f.newest_item_date).slice(0, 10) : '');
    if (h === 'READ_FAILED') t += (f.consecutive_errors > 1 ? ' · ' + f.consecutive_errors + ' failed reads in a row' : '') + (f.last_error ? ' · ' + f.last_error : '');
    if (h === 'READ_UNCERTAIN' && f.last_error) t += ' · ' + f.last_error;
    if (h === 'STALE_EVIDENCE' && f.last_outcome) t += ' (' + f.last_outcome + ')';
    return t;
  };
  HS.feedInventoryHtml = function (sm) {
    if (!sm) return '<h4>Alert and meeting feeds</h4><div class="zfh-tile zfh-unverified"><div class="zfh-l">Feed inventory unavailable</div><div class="zfh-d">Could not read the feed inventory. Treat every feed as unverified.</div></div>';
    var hs = sm.health_states, haveHealth = hs && typeof hs === 'object' && sm.feeds_with_outcome != null, pj = sm.parent_job || {};
    var head, table = '';
    if (!haveHealth) {
      head = '<div class="zfh-tile zfh-unverified"><div class="zfh-l">Per-feed read health unavailable</div><div class="zfh-d">The per-feed outcome counts could not be read, so every active feed is treated as health unknown.</div></div>';
    } else {
      var withOut = num(sm.feeds_with_outcome), act = num(sm.active), failed = num(hs.READ_FAILED);
      var tone = !withOut ? 'unverified' : failed ? 'warn' : 'unverified';
      head = '<div class="zfh-tile zfh-' + tone + '"><div class="zfh-l">Per-feed read health: ' + esc(fmt(withOut)) + ' of ' + esc(fmt(act)) + ' active feeds have a recorded read outcome</div><div class="zfh-d">' +
        (withOut ? 'Newest outcome recorded ' + esc(ago(sm.latest_outcome_at, Date.now())) + '. ' : 'No outcome has been recorded yet: every active feed is "never checked", which is unknown, not healthy. ') +
        'Outcomes come from the read each ingest run already makes. ' + esc(sm.stale_note || '') + ' Parent ingest run last completed ' + esc(ago(pj.last_completed, Date.now())) + ': ' + esc(pj.proves) + '.</div></div>';
      table = '<table class="zfh-tbl"><thead><tr><th>Read health (newest outcome per feed)</th><th>Feeds</th><th></th></tr></thead><tbody>' + HSTATE.map(function (st) {
        var n = num(hs[st[0]]); return '<tr><td>' + esc(st[1]) + '</td><td>' + esc(fmt(n)) + '</td><td>' + (n ? feedBtn('health:' + st[0], 'List feeds') : '') + '</td></tr>'; }).join('') + '</tbody></table>';
    }
    var rows = (sm.by_kind_evidence || []).map(function (r) { return '<tr><td>' + esc(KIND[r.kind] || r.kind) + '</td><td>' + esc(EVID[r.evidence_class] || r.evidence_class) + '</td><td>' + esc(fmt(r.feeds)) + '</td><td>' + feedBtn('evidence:' + r.evidence_class + '|kind:' + r.kind, 'List feeds') + '</td></tr>'; }).join('');
    return '<h4>Alert and meeting feeds (legacy inventory: ' + esc(fmt(sm.feeds_total)) + ' feeds)</h4>' + head + table +
      '<div class="zfh-sub">' + esc(fmt(sm.active)) + ' active (' + esc(fmt(sm.communities)) + ' communities, ' + esc(fmt(sm.distinct_sources)) + ' distinct sources; ' + esc(fmt(sm.active_feeds_sharing_a_source)) + ' feeds share a source with another feed, by design) · ' + esc(fmt(sm.inactive)) + ' inactive. ' + esc(sm.not_in_this_inventory) + '.</div>' +
      '<h4>Feed-to-ZIP mapping (tracked separately from read health)</h4><div class="zfh-sub">' + esc(fmt(sm.active_feeds_reaching_no_zip_page)) + ' active feeds reach no ZIP page · ' + esc(fmt(sm.active_feeds_unknown_community)) + ' have an unknown community.</div>' +
      feedBtn('no_zip_page', 'List active feeds that reach no ZIP page') +
      '<h4>Community output (proxy only, not read health)</h4><div class="zfh-sub">' + esc(sm.proxy_note) + '</div>' +
      '<table class="zfh-tbl"><thead><tr><th>Kind</th><th>Stored output for the community</th><th>Feeds</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      feedBtn('inactive', 'List the ' + fmt(sm.inactive) + ' inactive feeds');
  };

  function allBtn(key, label) { return '<div><button type="button" class="zfh-all" data-key="' + esc(key) + '" data-off="0">' + esc(label) + '</button><div class="zfh-out"></div></div>'; }

  var BUCKET_TEXT = { NO_REPORT: 'No report', STALE_REPORT: 'Report older than 72 h', SOURCE_READ_FAILING: 'A source read is failing (not superseded by a later good read)', NO_CHANGE_EVIDENCE: 'No change-monitor evidence', COVERAGE_NOT_VERIFIED: 'Coverage not verified (legacy scope)', CHANGE_MONITOR_VERIFIED_SOME: 'At least one source pair verified complete' };
  function accountingHtml(a) {
    if (!a) return '<div class="zfh-tile zfh-unverified"><div class="zfh-l">ZIP accounting unavailable</div><div class="zfh-d">Could not read the per-ZIP accounting. Treat ZIP coverage as unverified.</div></div>';
    var b = a.buckets || {}, rows = Object.keys(b).sort(function (x, y) { return b[y] - b[x]; }).map(function (k) {
      return '<tr><td>' + esc(BUCKET_TEXT[k] || k) + '</td><td>' + esc(fmt(b[k])) + '</td><td>' + allBtn('ACCOUNT|' + k, 'List ZIPs') + '</td></tr>'; }).join('');
    return '<h4>Every ZIP page, accounted for (' + esc(fmt(a.registry_zips)) + ' canonical ZIPs)</h4><div class="zfh-tile zfh-' + (a.every_zip_accounted_for ? 'info' : 'bad') + '"><div class="zfh-d">' +
      (a.every_zip_accounted_for ? 'Every ZIP is in exactly one bucket (' + esc(fmt(a.bucket_sum)) + ' of ' + esc(fmt(a.registry_zips)) + ').' : 'MISMATCH: buckets add to ' + esc(fmt(a.bucket_sum)) + ' but there are ' + esc(fmt(a.registry_zips)) + ' ZIPs.') +
      ' No bucket means "verified complete": fresh ingestion does not prove complete coverage.</div></div><table class="zfh-tbl"><thead><tr><th>Status (first match wins)</th><th>ZIPs</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function findingRow(f, now) {
    var d = f.detail || {}, rec = !!f.resolved_at, unc = rec && f.resolution_basis === 'AGED_OUT_UNCONFIRMED', zips = d.zips || [], zc = num(d.zip_count);
    var zl = zips.length ? '<div>Affected ZIPs (' + fmt(zc || zips.length) + (zc > zips.length ? ', first ' + zips.length + ' shown' : '') + '): ' + zips.map(function (z) { return esc(z.zip) + (z.subscriber ? '*' : ''); }).join(', ') + (zips.some(function (z) { return z.subscriber; }) ? ' <i>(* subscriber ZIP)</i>' : '') + '</div>' : '';
    return '<details class="zfh-f zfh-' + esc(unc ? 'unverified' : rec ? 'ok' : f.severity) + '"><summary><b>' + esc(unc ? 'AGED OUT · RECOVERY NOT CONFIRMED' : rec ? 'RECOVERED' : 'ONGOING') + '</b> · ' + esc(f.subject) + ' — ' + esc(d.what || f.class) + (zc ? ' · ' + fmt(zc) + ' ZIPs' : '') + '</summary>' +
      '<div><b>Evidence:</b> ' + esc(d.evidence) + '</div><div><b>Threshold:</b> ' + esc(d.threshold) + '</div><div><b>Action:</b> ' + esc(d.action) + ' <i>(owner: ' + esc(d.owner) + ')</i></div>' +
      '<div><b>First recorded by this monitor:</b> ' + esc(ago(f.first_seen, now)) + ' · <b>Last checked:</b> ' + esc(ago(f.last_seen, now)) + (rec ? ' · <b>' + (unc ? 'Left the current set:' : 'Recovered:') + '</b> ' + esc(ago(f.resolved_at, now)) : '') + '</div>' + (rec ? '<div><b>Why it left:</b> ' + esc(((f.resolution_evidence || {}).proof) || 'no recovery evidence recorded') + (f.resolution_evidence && f.resolution_evidence.failed_zips != null ? ' (' + esc(fmt(f.resolution_evidence.zips_read_again)) + ' of ' + esc(fmt(f.resolution_evidence.failed_zips)) + ' failing ZIPs read again)' : '') + '</div>' : '') + zl + (zc ? allBtn(f.finding_key, 'Show all ' + fmt(zc) + ' affected ZIPs') : '') + (d.feed_filter ? feedBtn(d.feed_filter, 'List the affected feeds') : '') + '</details>';
  }

  function findingsHtml(m, now) {
    var all = (m && m.findings) || [], open = all.filter(function (f) { return !f.resolved_at; }), rec = all.filter(function (f) { return f.resolved_at && f.resolution_basis !== 'AGED_OUT_UNCONFIRMED'; }), unc = all.filter(function (f) { return f.resolved_at && f.resolution_basis === 'AGED_OUT_UNCONFIRMED'; });
    open.sort(function (a, b) { var s = { bad: 0, warn: 1, unverified: 2 }; return (s[a.severity] - s[b.severity]) || (num((b.detail || {}).zip_count) - num((a.detail || {}).zip_count)); });
    return '<h4>Findings now (' + open.length + ')</h4>' + (open.map(function (f) { return findingRow(f, now); }).join('') || '<div class="zfh-sub">No open findings from the checks that run. This does not prove coverage; see the unverified items.</div>') +
      '<h4>Aged out, recovery not confirmed (' + unc.length + ')</h4><div class="zfh-sub">The failure left the 48-hour window but no later successful read has been observed for every failing ZIP. These are NOT counted as recovered. The monitor re-checks them every hour for 7 days and upgrades one only on a later successful read; after that they stay listed here, unconfirmed, until evidence arrives. They are not current failures and not confirmed recoveries.</div>' + (unc.map(function (f) { return findingRow(f, now); }).join('') || '<div class="zfh-sub">None.</div>') +
      '<h4>Recovered with evidence in the last 7 days (' + rec.length + ')</h4>' + (rec.map(function (f) { return findingRow(f, now); }).join('') || '<div class="zfh-sub">None.</div>');
  }

  // Pages through ALL affected ZIPs for a finding or a status bucket (100 per page). The 50 ZIPs stored with a finding are only a preview.
  HS.zipFeedLoadZips = function (client, btn) {
    if (!btn || !btn.classList || !btn.classList.contains('zfh-all') || btn.disabled) return;
    var key = btn.getAttribute('data-key'), off = Number(btn.getAttribute('data-off')) || 0, out = btn.nextSibling;
    btn.disabled = true;
    client.rpc('hs_zip_feed_health_zips', { p_key: key, p_offset: off, p_limit: 100 }).then(function (r) {
      btn.disabled = false;
      if (r.error) { out.insertAdjacentHTML('beforeend', '<div class="zfh-bad">Could not load ZIPs (' + esc(r.error.message || 'error') + ').</div>'); return; }
      var d = r.data || {}, rows = d.rows || [];
      out.insertAdjacentHTML('beforeend', '<div>' + rows.map(function (z) { return esc(z.zip) + (z.subscriber ? '*' : ''); }).join(', ') + '</div>');
      var next = off + rows.length;
      if (next < num(d.total)) { btn.setAttribute('data-off', String(next)); btn.textContent = 'Show next ' + Math.min(100, num(d.total) - next) + ' (' + fmt(next) + ' of ' + fmt(d.total) + ' shown)'; }
      else { btn.style.display = 'none'; out.insertAdjacentHTML('beforeend', '<div class="zfh-sub">All ' + esc(fmt(d.total)) + ' ZIPs shown. * = subscriber ZIP.</div>'); }
    }, function () { btn.disabled = false; });
  };

  // Pages through feeds for a filter (100 per page); each row can load its ZIP pages. Read-only.
  HS.zipFeedLoadFeeds = function (client, btn) {
    if (!btn || !btn.classList || btn.disabled) return;
    if (btn.classList.contains('zfh-feedzips')) {
      var fid = btn.getAttribute('data-feed'), fo = Number(btn.getAttribute('data-off')) || 0, fout = btn.nextSibling; btn.disabled = true;
      client.rpc('hs_feed_zips', { p_feed: fid, p_offset: fo, p_limit: 100 }).then(function (r) {
        btn.disabled = false; var d = r.data || {};
        if (r.error) { fout.insertAdjacentHTML('beforeend', '<span class="zfh-bad">Could not load ZIPs.</span>'); return; }
        fout.insertAdjacentHTML('beforeend', ' ' + (d.zips || []).map(esc).join(', '));
        var nx = fo + (d.zips || []).length;
        if (nx < num(d.total)) { btn.setAttribute('data-off', String(nx)); btn.textContent = 'next ' + Math.min(100, num(d.total) - nx) + ' of ' + fmt(d.total); } else { btn.style.display = 'none'; if (!num(d.total)) fout.insertAdjacentHTML('beforeend', ' no ZIP page reached'); }
      }, function () { btn.disabled = false; });
      return;
    }
    if (!btn.classList.contains('zfh-feeds')) return;
    var filter = btn.getAttribute('data-filter'), off = Number(btn.getAttribute('data-off')) || 0, out = btn.nextSibling; btn.disabled = true;
    client.rpc('hs_feed_inventory_page', { p_filter: filter, p_offset: off, p_limit: 100 }).then(function (r) {
      btn.disabled = false;
      if (r.error) { out.insertAdjacentHTML('beforeend', '<div class="zfh-bad">Could not load feeds (' + esc(r.error.message || 'error') + ').</div>'); return; }
      var d = r.data || {}, rows = d.rows || [];
      out.insertAdjacentHTML('beforeend', '<table class="zfh-tbl"><tbody>' + rows.map(function (f) {
        return '<tr><td>' + esc(f.feed_id) + '</td><td>' + esc(f.community || 'unknown community') + '</td><td>' + esc(KIND[f.kind] || f.kind) + '</td><td>' + esc(fmt(f.zip_pages)) + ' ZIP pages</td><td>' + esc(HS.feedReadLine(f)) + '</td><td><button type="button" class="zfh-feedzips" data-feed="' + esc(f.feed_id) + '" data-off="0">ZIPs</button><span></span></td></tr>';
      }).join('') + '</tbody></table>');
      var next = off + rows.length;
      if (next < num(d.total)) { btn.setAttribute('data-off', String(next)); btn.textContent = 'Show next ' + Math.min(100, num(d.total) - next) + ' (' + fmt(next) + ' of ' + fmt(d.total) + ' shown)'; }
      else { btn.style.display = 'none'; out.insertAdjacentHTML('beforeend', '<div class="zfh-sub">All ' + esc(fmt(d.total)) + ' feeds shown.</div>'); }
    }, function () { btn.disabled = false; });
  };


  // Four separate gaps. None of them is a failed ingestion except the second, and none is a health score.
  function gapsHtml(g) {
    if (!g) return '<div class="zfh-tile zfh-unverified"><div class="zfh-l">Coverage gaps unavailable</div><div class="zfh-d">The coverage-gap reader could not be read, so ZIPs without a feed and ZIPs whose feeds all fail are unverified.</div></div>';
    var ev = g.evidence || {}, um = g.unmapped_zips || {}, af = g.all_failing_zips || {}, orr = g.official_record || {};
    var stamp = 'Computed ' + esc(ev.computed_at || 'unknown') + '; feed reads up to ' + esc(ev.latest_outcome_at || 'unknown') + (ev.latest_outcome_run_id ? ' (run ' + esc(ev.latest_outcome_run_id) + ')' : '') + '.';
    function btn(kind, label) { return '<button type="button" class="zfh-gap" data-kind="' + esc(kind) + '" data-off="0">' + esc(label) + '</button><span class="zfh-out"></span>'; }
    return '<h4>Coverage gaps (four separate questions)</h4><div class="zfh-sub">' + stamp + '</div><div class="zfh-grid">' +
      '<div class="zfh-tile zfh-warn"><div class="zfh-n">' + esc(fmt(um.count)) + '</div><div class="zfh-l">ZIPs with no active feed mapped (of ' + esc(fmt(g.registry_zips)) + ')</div><div class="zfh-d">' + esc(um.meaning || '') + ' Owner: ' + esc(um.owner || '') + '.</div>' + btn('unmapped', 'List these ZIPs') + '</div>' +
      '<div class="zfh-tile zfh-bad"><div class="zfh-n">' + esc(fmt(af.count)) + '</div><div class="zfh-l">Mapped ZIPs whose feeds all failed their latest read</div><div class="zfh-d">' + esc(af.meaning || '') + ' Owner: ' + esc(af.owner || '') + '.</div>' + btn('all_failing', 'List these ZIPs') + '</div>' +
      '<div class="zfh-tile zfh-unverified"><div class="zfh-n">Not measured</div><div class="zfh-l">Official-record completeness</div><div class="zfh-d">' + esc(orr.meaning || '') + ' Owner: ' + esc(orr.owner || '') + '.</div></div>' +
      '</div>';
  }

  HS.zipFeedLoadGap = function (client, btn) {
    if (!btn || !btn.classList || !btn.classList.contains('zfh-gap') || btn.disabled) return;
    var kind = btn.getAttribute('data-kind'), off = Number(btn.getAttribute('data-off')) || 0, out = btn.nextSibling; btn.disabled = true;
    client.rpc('hs_zip_coverage_gap_page', { p_kind: kind, p_offset: off, p_limit: 100 }).then(function (r) {
      btn.disabled = false;
      if (r.error) { out.insertAdjacentHTML('beforeend', '<div class="zfh-bad">Could not load ZIPs (' + esc(r.error.message || 'error') + ').</div>'); return; }
      var d = r.data || {}, z = d.zips || [];
      out.insertAdjacentHTML('beforeend', ' ' + z.map(function (x) { return esc(x.zip) + (kind === 'all_failing' ? ' (' + esc(fmt(x.failing_feeds)) + '/' + esc(fmt(x.active_feeds)) + ' feeds failing)' : ''); }).join(', '));
      var nx = off + z.length;
      if (nx < num(d.total)) { btn.setAttribute('data-off', String(nx)); btn.textContent = 'next ' + Math.min(100, num(d.total) - nx) + ' of ' + fmt(d.total); }
      else { btn.style.display = 'none'; out.insertAdjacentHTML('beforeend', '<div class="zfh-sub">All ' + esc(fmt(d.total)) + ' ZIPs shown, as of ' + esc(d.as_of || 'unknown') + '.</div>'); }
    }, function () { btn.disabled = false; });
  };

  var CSS = '.zfh-all{margin:6px 0;cursor:pointer}.zfh-out{font-size:12px;word-break:break-word}.zfh-f{border:1px solid var(--line,#d6d6d6);border-left-width:5px;border-radius:6px;padding:6px 10px;margin:4px 0;font-size:12.5px}.zfh-f summary{cursor:pointer}.zfh-f>div{margin-top:3px}' +
    '.zfh{margin:0 0 18px}.zfh h3{margin:0 0 4px}.zfh h4{margin:14px 0 4px;font-size:13px}.zfh-sub{font-size:13px;opacity:.75;margin:0 0 10px}.zfh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}' +
    '.zfh-tile{border:1px solid var(--line,#d6d6d6);border-left-width:5px;border-radius:8px;padding:10px 12px;background:var(--card,#fff)}.zfh-bad{border-left-color:#c0392b}.zfh-warn{border-left-color:#d68910}.zfh-ok{border-left-color:#1e8449}.zfh-info{border-left-color:#5d6d7e}.zfh-unverified{border-left-color:#8e44ad;border-style:dashed}' +
    '.zfh-n{font-size:22px;font-weight:700}.zfh-l{font-size:13px;font-weight:600}.zfh-d{font-size:12px;opacity:.8;margin-top:4px}.zfh-tbl{width:100%;border-collapse:collapse;font-size:12.5px}.zfh-tbl th,.zfh-tbl td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--line,#e6e6e6)}' +
    'td.zfh-bad{color:#c0392b;font-weight:600}.zfh-alarms{font-size:12.5px;margin:0 0 0 18px;padding:0}@media(max-width:640px){.zfh-tbl{display:block;overflow-x:auto}}';

  function shell(inner) {
    return '<style>' + CSS + '</style><h3>All ZIP pages and feeds</h3><p class="zfh-sub">Every canonical ZIP page and development source, in counts. Separate from Subscriber ZIP Health above, which judges subscriber ZIPs one by one. Read-only: nothing here sends an email or publishes a post.</p>' + inner;
  }

  HS.acqZipFeedHealth = {
    esc: esc,
    render: function (answer, now, monitor, acc, feeds, gaps) {
      var r = answer && answer.rollup;
      if (!r) return shell('<div class="zfh-tile zfh-bad">No roll-up was returned. Treat every ZIP page and feed as unverified.</div>');
      var n = now == null ? Date.now() : now;
      var ms = monitor === undefined ? null : HS.zipFeedMonitorStatus(monitor, n);
      var mon = ms ? '<div class="zfh-tile zfh-' + esc(ms.tone) + '"><div class="zfh-l">Monitoring status</div><div class="zfh-d">' + esc(ms.text) + '</div></div>' + findingsHtml(monitor, n) + cronTable(monitor, n)
        : '<div class="zfh-tile zfh-unverified"><div class="zfh-l">Monitoring history unavailable</div><div class="zfh-d">The standing monitor could not be read, so recovery tracking and the job check are unverified.</div></div>';
      return shell(mon + accountingHtml(acc) + (gaps === undefined ? '' : gapsHtml(gaps)) + HS.feedInventoryHtml(feeds) + '<h4>Current counts (live)</h4><div class="zfh-grid">' + HS.zipFeedHealthStates(r, monitor || null).map(tile).join('') + '</div>' + sourcesTable(r, n, monitor ? ((monitor.findings || []).filter(function (f) { return !f.resolved_at && f.class === 'SOURCE_READ_FAILURE'; }).length) : null) + stalestTable(r, n) + alarmsList(r) +
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
      var feedP = client.rpc('hs_feed_inventory_summary').then(function (r) { return r.error ? null : r.data; }, function () { return null; });
      var gapP = client.rpc('hs_zip_coverage_gaps').then(function (r) { return r.error ? null : r.data; }, function () { return null; });
      var accP = client.rpc('hs_zip_feed_health_accounting').then(function (r) { return r.error ? null : r.data; }, function () { return null; });
      if (!host._zfhBound) { host._zfhBound = true; host.addEventListener('click', function (e) { HS.zipFeedLoadZips(client, e.target); HS.zipFeedLoadFeeds(client, e.target); HS.zipFeedLoadGap(client, e.target); }); }
      client.rpc('hs_zip_feed_health').then(function (res) {
        if (res.error) { host.innerHTML = shell('<div class="zfh-tile zfh-bad">Could not read ZIP page and feed health (' + esc(res.error.message || 'error') + '). Treat every ZIP page and feed as unverified.</div>'); return; }
        return Promise.all([monP, accP, feedP, gapP]).then(function (x) { host.innerHTML = HS.acqZipFeedHealth.render(res.data, Date.now(), x[0] == null ? undefined : x[0], x[1], x[2], x[3]); });
      }, function () { host.innerHTML = shell('<div class="zfh-tile zfh-bad">Could not reach the dashboard service. Treat every ZIP page and feed as unverified.</div>'); });
    }
  };
})();
