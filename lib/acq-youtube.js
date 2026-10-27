/* Jody Acquisition Dashboard: Tab 5 (Engagement Tracker), YouTube card (2026-10-27).
   Answers: is the YouTube channel growing, which videos are watched, and does it bring people to the site?
   It DISPLAYS one admin-only reader and decides nothing itself:
     - hs_youtube_engagement(p_days)  channel subscribers / views, per-video views, likes and comments (from the hourly
                                      channel read, homesignal-ingest scripts/youtube_channel_sync.py), and first visits,
                                      registrations and reports whose channel classify_channel decided is 'youtube'
                                      (docs/youtube-engagement.sql).
   Main video vs Short is the reader's `kind` (3 minutes or less = Short). A count never read shows a dash, never 0. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  var TZ = 'America/Los_Angeles';
  var st = { days: 30, r: null, loaded: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function when(v, withTime) {
    var d = new Date(v);
    if (!v || isNaN(d.getTime())) return '';
    var o = withTime ? { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }
      : { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' };
    try { return new Intl.DateTimeFormat('en-US', o).format(d); } catch (e) { return d.toISOString(); }
  }
  function show(v) { return v == null ? '—' : Number(v).toLocaleString('en-US'); }
  function delta(v) { return v == null ? null : (Number(v) >= 0 ? '+' : '') + Number(v).toLocaleString('en-US'); }
  // Only a YouTube watch / short / youtu.be link is ever made clickable.
  function safeUrl(u) {
    return /^https:\/\/(www\.youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[A-Za-z0-9_-]{6,}([&?][A-Za-z0-9_=&-]*)?$/.test(String(u || '')) ? u : null;
  }
  function rate(a, b) { return b > 0 ? (Math.round(1000 * a / b) / 10) + '%' : '—'; }

  // Videos sorted by views in the period (unknown last), then all-time views, then newest.
  function videosFrom(r) {
    return ((r && r.videos) || []).slice().sort(function (a, b) {
      var pa = a.views_in_period == null ? -1 : Number(a.views_in_period), pb = b.views_in_period == null ? -1 : Number(b.views_in_period);
      return (pb - pa) || ((Number(b.views) || 0) - (Number(a.views) || 0)) || String(b.published_at).localeCompare(String(a.published_at));
    });
  }

  var CSS = '<style>.yt-fun{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:10px 0 14px}' +
    '.yt-step{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;background:#fff}' +
    '.yt-step b{display:block;font-size:24px;font-variant-numeric:tabular-nums;line-height:1.1}' +
    '.yt-step span{display:block;font-size:12px;color:#374151;margin-top:2px}.yt-step small{display:block;font-size:11px;color:#6b7280;margin-top:4px}' +
    '.yt-tbl td.n,.yt-tbl th.n{text-align:right;font-variant-numeric:tabular-nums}.yt-kind{font-size:11px;padding:1px 6px;border-radius:6px;background:#fee2e2}' +
    '.yt-kind.yt-short{background:#fef3c7}.yt-note{font-size:12px;color:#6b7280;margin:8px 0 0}' +
    '@media (max-width:900px){.yt-fun{grid-template-columns:repeat(2,minmax(0,1fr))}}</style>';
  function step(val, label, note) {
    return '<div class="yt-step"><b>' + esc(val) + '</b><span>' + esc(label) + '</span>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</div>';
  }

  function render() {
    var head = '<h3>YouTube: channel to people';
    if (!st.loaded) return CSS + '<div class="card">' + head + '</h3><div class="muted">Loading…</div></div>';
    var r = st.r;
    if (!r) return CSS + '<div class="card">' + head + '</h3><p class="sub">Not available (this session is not a dashboard admin, or the reader failed).</p></div>';
    var c = r.channel || null, s = r.summary || {}, vids = videosFrom(r);
    var days = [7, 30, 90].map(function (d) { return '<option value="' + d + '"' + (d === st.days ? ' selected' : '') + '>last ' + d + ' days</option>'; }).join('');
    var subs = !c ? '—' : c.subscribers_hidden ? 'Hidden' : show(c.subscribers);
    var subsNote = !c ? 'not counted yet' : c.subscribers_in_period == null ? 'change: not known for this period yet' : delta(c.subscribers_in_period) + ' in this period';
    var viewsNote = !c ? 'not counted yet' : c.views_in_period == null ? 'change: not known for this period yet' : delta(c.views_in_period) + ' in this period';
    var visitors = Number(s.visitors) || 0, regs = Number(s.registrations) || 0, reps = Number(s.reports) || 0;
    var table = vids.length ? '<div style="overflow-x:auto"><table class="tbl yt-tbl"><thead><tr><th>Published (PT)</th><th>Kind</th><th>Video</th>' +
      '<th class="n">Views</th><th class="n">Views in period</th><th class="n">Likes</th><th class="n">Comments</th><th class="n">Tagged visitors</th></tr></thead><tbody>' +
      vids.map(function (v) {
        var u = safeUrl(v.url), t = esc(v.title || v.video_id);
        var k = v.kind === 'short' ? 'SHORT' : v.kind === 'main' ? 'MAIN' : '—';
        return '<tr><td class="muted">' + esc(when(v.published_at)) + '</td>' +
          '<td><span class="yt-kind yt-' + esc(v.kind || 'none') + '">' + k + '</span></td>' +
          '<td>' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + t + '</a>' : t) + '</td>' +
          '<td class="n">' + show(v.views) + '</td><td class="n">' + show(v.views_in_period) + '</td>' +
          '<td class="n">' + show(v.likes) + '</td><td class="n">' + show(v.comments) + '</td><td class="n">' + show(v.visitors) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="muted">No public videos on the channel yet.</div>';
    var counted = c && c.counted_at ? 'Counts last read ' + when(c.counted_at, true) + (c.counting_since ? '; counting since ' + when(c.counting_since) : '') + '.' :
      'Counts have not been read yet: the channel is read every hour from 2026-10-27.';
    var na = (r.unavailable || []);
    return CSS + '<div class="card" id="yt-card">' + head + ' <span class="tile-tag t-real" style="margin-left:6px">live</span> ' +
      '<select id="yt-days" aria-label="Period" style="margin-left:8px;font-size:12px">' + days + '</select></h3>' +
      '<p class="sub">The JODY Tracks channel: subscribers, what each video has been watched, and who came to the site from YouTube. ' +
      'Visitors are first visits from youtube.com or a link tagged utm_source=youtube. A visit is credited to one video only when ' +
      'its link carries utm_content (the video id or its link); the video descriptions link to jodytracks.com without tags today.</p>' +
      '<div class="yt-fun">' +
        step(subs, 'Subscribers', subsNote) +
        step(c ? show(c.views) : '—', 'Channel views', viewsNote) +
        step(show(s.videos), 'Public videos', (Number(s.mains) || 0) + ' main · ' + (Number(s.shorts) || 0) + ' Shorts' + (s.published_in_period ? ' · ' + s.published_in_period + ' new' : '')) +
        step(show(visitors), 'First visits from YouTube', s.visitors_with_video_tag ? s.visitors_with_video_tag + ' credited to a video' : 'none credited to a video') +
        step(show(regs), 'Registrations', rate(regs, visitors) + ' of visitors') +
        step(show(reps), 'Reports saved', rate(reps, regs) + ' of registrations') +
      '</div>' + table +
      '<p class="yt-note">' + esc(counted) + '</p>' +
      (na.length ? '<p class="yt-note"><b>Not measured:</b> ' + na.map(esc).join(' ') + '</p>' : '') +
      '</div>';
  }

  function load(client) {
    return client.rpc('hs_youtube_engagement', { p_days: st.days }).then(function (x) { return x && !x.error ? x.data : null; }, function () { return null; })
      .then(function (d) { st.r = d; st.loaded = true; });
  }

  // The card sits in its own box under the Bluesky card (#en-live), above the collapsed older snapshot.
  function hostIn(tab) {
    if (!tab) return null;
    var h = tab.querySelector('#yt-live');
    if (h) return h;
    h = document.createElement('div'); h.id = 'yt-live';
    var en = tab.querySelector('#en-live');
    if (en && en.parentNode) en.parentNode.insertBefore(h, en.nextSibling); else tab.insertBefore(h, tab.firstChild);
    return h;
  }

  function mount(client, tab) {
    var host = hostIn(tab);
    if (!host || !client) return;
    host.innerHTML = render();
    if (host.getAttribute('data-yt-wired') !== '1') {
      host.setAttribute('data-yt-wired', '1');
      host.addEventListener('change', function (e) {
        if (e.target && e.target.id === 'yt-days') {
          st.days = Number(e.target.value) || 30;
          load(client).then(function () { host.innerHTML = render(); });
        }
      });
    }
    load(client).then(function () { host.innerHTML = render(); });
  }

  HS.acqYouTube = { mount: mount, videosFrom: videosFrom, safeUrl: safeUrl, esc: esc,
    _render: function (r, days) { st.r = r; st.loaded = true; if (days) st.days = days; return render(); } };
})();
