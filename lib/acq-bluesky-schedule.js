/* Jody Acquisition Dashboard: Tab 12 (Bluesky Posts) -> "Bluesky Publishing Schedule".
   ONE SCHEDULE, TWO QUEUES (founder, 2026-10-27): 2 MAPS posts + 2 video posts a day, America/Los_Angeles, shown in
   America/Chicago too, at most 4 a day, never two within 150 minutes. The database decides everything
   (homesignal-ingest supabase/migrations/20261027170000_bsky_schedule_two_queues.sql): this page only DISPLAYS
   hs_bsky_schedule_overview(), PREVIEWS a settings change with hs_bsky_schedule_preview() (which changes nothing), and
   SAVES it with hs_bsky_schedule_save() only after the founder confirms the exact number of posts that would move.
   It also shows MAPS vs Shorts results from hs_bsky_maps_vs_shorts() (docs/bluesky-maps-vs-shorts.sql), with what is
   NOT measured said in words. No time zone arithmetic decides anything here; formatting only. Every value is escaped. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  var TZ = 'America/Los_Angeles', TZ2 = 'America/Chicago';
  var DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var KIND = { maps: 'MAPS', video: 'VIDEO' };
  var st = { ov: null, an: null, days: 30, editing: false, preview: null, msg: '', form: null };   // form: the founder's unsaved edits

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(v, tz, opts) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    try { return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, opts)).format(d); } catch (e) { return d.toISOString(); }
  }
  // "Tue Oct 28, 1:30 PM PT · 3:30 PM CT"
  function both(v, tz1, tz2) {
    var a = fmt(v, tz1 || TZ, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    var b = fmt(v, tz2 || TZ2, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    return a && b ? a + ' · ' + b : a;
  }
  function timeBoth(v, tz1, tz2) {
    return fmt(v, tz1 || TZ, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) + ' · ' +
      fmt(v, tz2 || TZ2, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }
  function badge(kind) {
    return '<span class="bs-kind bs-' + esc(kind) + '">' + esc(KIND[kind] || kind) + '</span>';
  }

  // ---- the settings payload: the form keeps weekday / weekend; the database accepts that shape ----
  function slotsToForm(slots) {
    var wd = (slots && slots['1']) || {}, we = (slots && slots['0']) || {};
    return { weekday: { maps: (wd.maps || []).slice(), video: (wd.video || []).slice() },
             weekend: { maps: (we.maps || []).slice(), video: (we.video || []).slice() } };
  }
  // True when every weekday shares Monday's times and Saturday shares Sunday's (the form can represent it).
  function formRepresents(slots) {
    if (!slots) return false;
    var same = function (a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); };
    for (var d = 2; d <= 5; d++) if (!same(slots[String(d)], slots['1'])) return false;
    return same(slots['6'], slots['0']);
  }
  function readForm(root) {
    var out = { weekday: { maps: [], video: [] }, weekend: { maps: [], video: [] } };
    Array.prototype.forEach.call(root.querySelectorAll('input[data-bs-slot]'), function (inp) {
      var k = inp.getAttribute('data-bs-slot').split('.');   // weekday.maps.0
      out[k[0]][k[1]][Number(k[2])] = String(inp.value || '').slice(0, 5);
    });
    return out;
  }

  // ---- rendering ----
  function todayCard(ov) {
    var t = ov.today || {}, n = ov.next || {}, b = ov.budget || {};
    function line(kind) {
      var x = t[kind] || {};
      var nx = n[kind];
      return '<div class="tile"><div class="tile-label">' + badge(kind) + ' today</div>' +
        '<div class="tile-value">' + esc(String(x.booked || 0)) + '/' + esc(String(x.cap || 0)) + '</div>' +
        '<div class="tile-note">' + esc(String(x.published || 0)) + ' published · next: ' +
        (nx ? esc(both(nx.slot, ov.tz, ov.display_tz)) : 'none booked') + '</div></div>';
    }
    var gap = b.gap_ok === false && b.wait_until ? '<p class="sub">Next post not before ' + esc(both(b.wait_until, ov.tz, ov.display_tz)) +
      ' (' + esc(String(ov.min_gap_minutes)) + ' minutes after the last one' + (b.video_in_flight ? ', a video is still uploading' : '') + ').</p>' : '';
    var q = ov.queue || {};
    return '<div class="grid" style="margin-bottom:10px">' + line('maps') + line('video') +
      '<div class="tile"><div class="tile-label">Queues</div><div class="tile-value">' + esc(String((q.maps_approved || 0) + (q.video_scheduled || 0))) + '</div>' +
      '<div class="tile-note">' + esc(String(q.maps_approved || 0)) + ' MAPS approved · ' + esc(String(q.video_scheduled || 0)) + ' videos scheduled · ' +
      esc(String(q.video_held || 0)) + ' videos held · ' + esc(String(q.video_in_flight || 0)) + ' uploading</div></div></div>' + gap;
  }
  function calendar(ov) {
    var byDay = {};
    (ov.calendar || []).forEach(function (c) { (byDay[c.day] = byDay[c.day] || []).push(c); });
    var days = Object.keys(byDay).sort();
    var cols = days.map(function (d) {
      var cells = byDay[d].slice().sort(function (a, b) { return new Date(a.slot) - new Date(b.slot); }).map(function (c) {
        var bk = c.booked;
        var what = bk ? esc(bk.label || '') + ' <span class="muted">(' + esc(bk.status) + ')</span>' : '<span class="muted">open</span>';
        return '<div class="bs-cell' + (bk ? ' bs-booked' : '') + '">' + badge(c.kind) + ' <b>' + esc(timeBoth(c.slot, ov.tz, ov.display_tz)) + '</b><br>' + what + '</div>';
      }).join('');
      var head = fmt(byDay[d][0].slot, ov.tz, { weekday: 'short', month: 'short', day: 'numeric' });
      return '<div class="bs-day"><div class="bs-dayhead">' + esc(head) + '</div>' + cells + '</div>';
    }).join('');
    var off = (ov.off_slot || []).length
      ? '<p class="sub"><b>Off-schedule:</b> ' + (ov.off_slot || []).map(function (o) { return badge(o.kind) + ' ' + esc(both(o.slot, ov.tz, ov.display_tz)) + ' (' + esc(o.status) + ')'; }).join(' · ') +
        '. These keep their time; preview a change with "move scheduled posts" to put them on the schedule.</p>' : '';
    return '<div class="sub" style="margin:6px 0">Next 7 days</div><div class="bs-cal">' + cols + '</div>' + off;
  }
  function problems(ov) {
    var p = ov.problems || [];
    if (!p.length) return '';
    return '<div class="sub" style="margin:10px 0 4px">Errors and holds (last 14 days)</div><ul class="bs-list">' + p.slice(0, 12).map(function (x) {
      return '<li>' + badge(x.kind) + ' ' + esc(x.status) + ': ' + esc(String(x.error || '').slice(0, 200)) + ' <span class="muted">' + esc(fmt(x.at, ov.tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</span></li>';
    }).join('') + '</ul>';
  }
  function settings(ov) {
    var f = st.form || slotsToForm(ov.slots);
    var note = formRepresents(ov.slots) ? '' : '<p class="sub"><b>Note:</b> some days currently differ from the weekday / weekend pattern; saving here sets every weekday and both weekend days to the times below.</p>';
    function row(group, label) {
      return '<tr><th>' + esc(label) + '</th>' + ['maps', 'video'].map(function (k) {
        return '<td>' + badge(k) + ' ' + [0, 1].map(function (i) {
          return '<input type="time" step="300" data-bs-slot="' + group + '.' + k + '.' + i + '" value="' + esc((f[group][k] || [])[i] || '') + '" aria-label="' + esc(label + ' ' + KIND[k] + ' ' + (i + 1)) + '">';
        }).join(' ') + '</td>';
      }).join('') + '</tr>';
    }
    var pv = st.preview;
    var pvHtml = '';
    if (pv && !pv.ok) pvHtml = '<div class="bs-warn">' + (pv.problems || []).map(esc).join('<br>') + '</div>';
    else if (pv && pv.ok) {
      var moves = pv.moves || [];
      pvHtml = '<div class="bs-ok"><b>' + (pv.reschedule ? esc(String(pv.moved)) + ' scheduled post(s) would move.' : 'Only future approvals use the new times; no scheduled post moves.') + '</b>' +
        (moves.length ? '<table class="tbl" style="margin-top:6px"><thead><tr><th>Kind</th><th>From</th><th>To</th></tr></thead><tbody>' + moves.slice(0, 60).map(function (m) {
          return '<tr><td>' + badge(m.kind) + '</td><td>' + esc(both(m.old, ov.tz, ov.display_tz)) + '</td><td>' + esc(both(m.new, ov.tz, ov.display_tz)) + '</td></tr>';
        }).join('') + '</tbody></table>' + (moves.length > 60 ? '<p class="sub">… and ' + esc(String(moves.length - 60)) + ' more.</p>' : '') : '') +
        '<p><button type="button" class="bs-btn" data-bs="save">Save these times' + (pv.reschedule ? ' and move ' + esc(String(pv.moved)) + ' post(s)' : '') + '</button></p></div>';
    }
    return '<details class="bs-settings"' + (st.editing ? ' open' : '') + '><summary>Edit posting times</summary>' +
      '<p class="sub">Times are ' + esc(ov.tz) + ' (Pacific). Each kind needs two times a day, and every two times must be at least ' + esc(String(ov.min_gap_minutes)) + ' minutes apart, including across midnight.</p>' + note +
      '<table class="tbl"><thead><tr><th></th><th>MAPS</th><th>VIDEO</th></tr></thead><tbody>' + row('weekday', 'Monday-Friday') + row('weekend', 'Saturday-Sunday') + '</tbody></table>' +
      '<p><label class="sub"><input type="checkbox" id="bs-resched"' + (st.resched ? ' checked' : '') + '> Also move posts already scheduled onto the new times (in their current order)</label></p>' +
      '<p><button type="button" class="bs-btn" data-bs="preview">Preview the change</button> <span class="sub" role="status">' + esc(st.msg) + '</span></p>' + pvHtml +
      (ov.recent_changes && ov.recent_changes.length ? '<p class="sub">Last saved ' + esc(both(ov.recent_changes[0].at, ov.tz, ov.display_tz)) + ' by ' + esc(ov.recent_changes[0].by || '') + (ov.recent_changes[0].rescheduled ? ', ' + esc(String(ov.recent_changes[0].moved)) + ' post(s) moved' : '') + '.</p>' : '') +
      '</details>';
  }
  function num(v) { return v == null ? '—' : esc(String(v)); }
  function analytics(an) {
    if (!an) return '<p class="sub">MAPS vs Shorts results are not available yet (docs/bluesky-maps-vs-shorts.sql not applied, or this session is not a dashboard admin).</p>';
    var s = an.summary || {}, m = s.maps || {}, v = s.shorts || {};
    function r(label, key) { return '<tr><td>' + esc(label) + '</td><td style="text-align:right">' + num(m[key]) + '</td><td style="text-align:right">' + num(v[key]) + '</td></tr>'; }
    var posts = (an.posts || []).slice(0, 40).map(function (p) {
      return '<tr><td>' + badge(p.kind === 'shorts' ? 'video' : 'maps') + '</td><td>' + esc(p.label) + '</td><td>' + esc(fmt(p.published_at, an.timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</td>' +
        '<td style="text-align:right">' + num(p.visitors) + '</td><td style="text-align:right">' + num(p.registrations) + '</td><td style="text-align:right">' + num(p.reports) + '</td></tr>';
    }).join('');
    function opt(n) { return '<option value="' + n + '"' + (st.days === n ? ' selected' : '') + '>Last ' + n + ' days</option>'; }
    return '<div class="sub" style="margin:14px 0 4px">MAPS vs Shorts <select id="bs-days">' + opt(7) + opt(30) + opt(90) + '</select></div>' +
      '<table class="tbl"><thead><tr><th>Measured</th><th style="text-align:right">MAPS</th><th style="text-align:right">Shorts (video)</th></tr></thead><tbody>' +
      r('Posts published', 'posts') + r('Visitors (first visit from that kind)', 'visitors') + r('Visitors per post', 'visitors_per_post') +
      r('Registrations', 'registrations') + r('Registrations per 100 visitors', 'registrations_per_100_visitors') +
      r('Reports created', 'reports') + r('Reports per registration', 'reports_per_registration') + '</tbody></table>' +
      '<p class="sub">Untagged Bluesky visitors (either kind, or the profile): ' + num(an.untagged_bluesky_visitors) + '.</p>' +
      (posts ? '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Kind</th><th>Post</th><th>Published</th><th style="text-align:right">Visitors</th><th style="text-align:right">Registrations</th><th style="text-align:right">Reports</th></tr></thead><tbody>' + posts + '</tbody></table></div>' : '<p class="sub">No posts published in this period.</p>') +
      '<p class="sub"><b>Not measured:</b> ' + (an.unavailable || []).map(esc).join(' ') + '</p>' +
      '<p class="sub muted">' + (an.caveats || []).map(esc).join(' ') + '</p>';
  }
  var CSS = '<style>.bs-kind{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;padding:1px 5px;border-radius:4px;color:#fff}' +
    '.bs-maps{background:#2563eb}.bs-video{background:#c2410c}.bs-cal{display:flex;gap:8px;overflow-x:auto}.bs-day{min-width:150px;flex:1}' +
    '.bs-dayhead{font-weight:600;font-size:12px;margin-bottom:4px}.bs-cell{border:1px solid var(--line,#ddd);border-radius:6px;padding:5px;margin-bottom:4px;font-size:12px}' +
    '.bs-booked{background:var(--panel,#f7f7f7)}.bs-list{margin:0;padding-left:18px;font-size:13px}.bs-warn{border-left:3px solid #b91c1c;padding:6px 10px;margin:6px 0}' +
    '.bs-ok{border-left:3px solid #15803d;padding:6px 10px;margin:6px 0}.bs-btn{padding:6px 10px;cursor:pointer}.bs-settings{margin-top:12px}.bs-settings input[type=time]{width:7.5em}</style>';

  function render() {
    var ov = st.ov;
    if (!ov) return CSS + '<div class="card"><h3>Bluesky Publishing Schedule</h3><p class="sub">The schedule is not available (it has not been set up, or this session is not a dashboard admin).</p>' + analytics(st.an) + '</div>';
    return CSS + '<div class="card" id="bs-card"><h3>Bluesky Publishing Schedule</h3>' +
      '<p class="sub">Two queues: ' + badge('maps') + ' MAPS posts take only MAPS times and ' + badge('video') + ' videos take only video times, so neither delays the other. ' +
      'At most two of each and four in all a day, at least ' + esc(String(ov.min_gap_minutes)) + ' minutes apart. Times shown in Pacific and Central.</p>' +
      todayCard(ov) + calendar(ov) + problems(ov) + settings(ov) + analytics(st.an) + '</div>';
  }

  function load(client) {
    var a = client.rpc('hs_bsky_schedule_overview').then(function (r) { return r && !r.error ? r.data : null; }, function () { return null; });
    var b = client.rpc('hs_bsky_maps_vs_shorts', { p_days: st.days }).then(function (r) { return r && !r.error ? r.data : null; }, function () { return null; });
    return Promise.all([a, b]).then(function (x) { st.ov = x[0]; st.an = x[1]; });
  }

  function wire(client, host, refresh) {
    if (host.getAttribute('data-bs-wired') === '1') return;
    host.setAttribute('data-bs-wired', '1');
    host.addEventListener('toggle', function (e) { if (e.target && e.target.classList && e.target.classList.contains('bs-settings')) st.editing = e.target.open; }, true);
    host.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'bs-days') {
        st.days = Number(e.target.value) || 30;
        client.rpc('hs_bsky_maps_vs_shorts', { p_days: st.days }).then(function (r) { st.an = r && !r.error ? r.data : null; host.innerHTML = render(); });
      } else if (e.target && (e.target.matches('input[data-bs-slot]') || e.target.id === 'bs-resched')) {
        st.form = readForm(host.querySelector('.bs-settings'));
        st.resched = !!(host.querySelector('#bs-resched') || {}).checked;
        st.preview = null; st.msg = 'Changed: preview again before saving.';
        var m = host.querySelector('.bs-settings [role=status]'); if (m) m.textContent = st.msg;
        var ok = host.querySelector('.bs-ok'); if (ok) ok.remove();
      }
    });
    host.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('.bs-btn');
      if (!t) return;
      var root = host.querySelector('.bs-settings');
      var act = t.getAttribute('data-bs');
      if (act === 'preview') {
        var payload = readForm(root);
        st.form = payload;
        var resched = !!(host.querySelector('#bs-resched') || {}).checked;
        st.resched = resched;
        st.msg = 'Checking…'; st.editing = true;
        client.rpc('hs_bsky_schedule_preview', { p_slots: payload, p_reschedule: resched }).then(function (r) {
          if (r && r.error) { st.preview = null; st.msg = 'Could not preview (' + (r.error.message || r.error.code || 'error') + ').'; }
          else { st.preview = Object.assign({}, r.data, { payload: payload }); st.msg = ''; }
          host.innerHTML = render();
        }, function () { st.msg = 'Could not reach the server.'; host.innerHTML = render(); });
      } else if (act === 'save' && st.preview && st.preview.ok) {
        var pv = st.preview;
        var q = pv.reschedule
          ? 'Save the new posting times and move ' + pv.moved + ' scheduled post(s) to the times shown? Published posts are never changed.'
          : 'Save the new posting times? Posts already scheduled keep their times; new approvals use the new times.';
        if (!window.confirm(q)) return;
        st.msg = 'Saving…';
        client.rpc('hs_bsky_schedule_save', { p_slots: pv.payload, p_reschedule: !!pv.reschedule, p_expected_moves: pv.reschedule ? pv.moved : null }).then(function (r) {
          if (r && r.error) { st.msg = 'Not saved: ' + (r.error.message || r.error.code || 'error'); host.innerHTML = render(); return; }
          st.preview = null; st.form = null; st.resched = false; st.editing = false; st.msg = 'Saved' + (r.data && r.data.moved ? ', ' + r.data.moved + ' post(s) moved' : '') + '.';
          load(client).then(function () { host.innerHTML = render(); if (refresh) refresh(); });
        }, function () { st.msg = 'Could not reach the server.'; host.innerHTML = render(); });
      }
    });
  }

  HS.acqBlueskySchedule = {
    esc: esc, both: both, slotsToForm: slotsToForm, formRepresents: formRepresents, readForm: readForm, render: render, _state: st,
    mount: function (client, host, refresh) {
      if (!client || !host) return Promise.resolve();
      wire(client, host, refresh);
      // Keep an open editor and its preview across the page's own refreshes.
      return load(client).then(function () { host.innerHTML = render(); });
    }
  };
})();
