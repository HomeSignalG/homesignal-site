/* Jody Acquisition Dashboard: Tab 5 (Engagement Tracker), live card (2026-10-27).
   Answers one question: is Bluesky bringing people in? It DISPLAYS two admin-only readers and decides nothing itself:
     - hs_bsky_maps_vs_shorts(p_days)  posts per kind, first-visit visitors, registrations and reports, per kind and per post
                                       (docs/bluesky-maps-vs-shorts.sql; the channel is decided by classify_channel there)
     - hs_bsky_post_engagement()        the latest likes / reposts / replies / quotes per post (docs/bluesky-post-engagement.sql,
                                       written by homesignal-ingest scripts/collect-social-metrics.js)
   The two are joined by post id only. A post never measured shows a dash, never 0. What cannot be measured is said in words.
   The old snapshot HTML (built by the ingest dashboard script) stays on the tab, collapsed and labelled as not live. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  var TZ = 'America/Los_Angeles';
  var st = { days: 30, an: null, eng: null, loaded: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function when(v) {
    var d = new Date(v);
    if (!v || isNaN(d.getTime())) return '';
    try { return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d); }
    catch (e) { return d.toISOString(); }
  }
  function num(v) { return v == null ? null : Number(v); }
  function show(v) { return v == null ? '—' : String(v); }
  // at://did:plc:x/app.bsky.feed.post/rkey -> https://bsky.app/profile/did:plc:x/post/rkey (null for anything else)
  function webUrl(uri) {
    var m = /^at:\/\/(did:[a-z0-9]+:[A-Za-z0-9._:-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9]+)$/.exec(String(uri || ''));
    return m ? 'https://bsky.app/profile/' + m[1] + '/post/' + m[2] : null;
  }

  // One row per post in the period, from the posts hs_bsky_maps_vs_shorts lists; engagement joined by id.
  function rowsFrom(an, eng) {
    var metrics = (eng && eng.posts) || {};
    return ((an && an.posts) || []).map(function (p) {
      var m = metrics[p.post_id] || null;
      var e = m ? [m.likes, m.reposts, m.replies, m.quotes].reduce(function (a, v) { return v == null ? a : a + Number(v); }, 0) : null;
      return {
        post_id: p.post_id, kind: p.kind, label: p.label || '', published_at: p.published_at,
        measured: !!m, likes: m ? num(m.likes) : null, reposts: m ? num(m.reposts) : null,
        replies: m ? num(m.replies) : null, engagement: e, url: m ? webUrl(m.bsky_uri) : null,
        visitors: num(p.visitors) || 0, registrations: num(p.registrations) || 0, reports: num(p.reports) || 0
      };
    }).sort(function (a, b) {
      return (b.visitors - a.visitors) || ((b.engagement || 0) - (a.engagement || 0)) || String(b.published_at).localeCompare(String(a.published_at));
    });
  }

  // The funnel. Totals for visitors, registrations and reports come from the reader's own summary (never re-added here).
  function funnel(an, rows) {
    var s = (an && an.summary) || {};
    var k = function (f) { return ['maps', 'shorts'].reduce(function (a, x) { return a + (Number((s[x] || {})[f]) || 0); }, 0); };
    var measured = rows.filter(function (r) { return r.measured; });
    var eng = measured.reduce(function (a, r) { return a + (r.engagement || 0); }, 0);
    return {
      posts: k('posts'), measured: measured.length, engagement: measured.length ? eng : null,
      visitors: k('visitors'), registrations: k('registrations'), reports: k('reports')
    };
  }
  function rate(a, b) { return b > 0 ? (Math.round(1000 * a / b) / 10) + '%' : '—'; }

  var CSS = '<style>.en-fun{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:10px 0 14px}' +
    '.en-step{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;background:#fff}' +
    '.en-step b{display:block;font-size:24px;font-variant-numeric:tabular-nums;line-height:1.1}' +
    '.en-step span{display:block;font-size:12px;color:#374151;margin-top:2px}.en-step small{display:block;font-size:11px;color:#6b7280;margin-top:4px}' +
    '.en-step.en-na{background:#f9fafb}.en-step.en-na b{font-size:15px;color:#6b7280}' +
    '.en-tbl td.n,.en-tbl th.n{text-align:right;font-variant-numeric:tabular-nums}.en-kind{font-size:11px;padding:1px 6px;border-radius:6px;background:#eef2ff}' +
    '.en-kind.en-shorts{background:#fef3c7}.en-note{font-size:12px;color:#6b7280;margin:8px 0 0}.en-snap summary{cursor:pointer;font-size:13px;color:#4b5563}' +
    '@media (max-width:900px){.en-fun{grid-template-columns:repeat(2,minmax(0,1fr))}}</style>';

  function step(val, label, note, na) {
    return '<div class="en-step' + (na ? ' en-na' : '') + '"><b>' + esc(val) + '</b><span>' + esc(label) + '</span>' +
      (note ? '<small>' + esc(note) + '</small>' : '') + '</div>';
  }

  function render() {
    if (!st.loaded) return CSS + '<div class="card"><h3>Bluesky: posts to people</h3><div class="muted">Loading…</div></div>';
    var an = st.an, eng = st.eng;
    if (!an) return CSS + '<div class="card"><h3>Bluesky: posts to people</h3><p class="sub">Not available (this session is not a dashboard admin, or the reader failed).</p></div>';
    var rows = rowsFrom(an, eng), f = funnel(an, rows);
    var days = [7, 30, 90].map(function (d) { return '<option value="' + d + '"' + (d === st.days ? ' selected' : '') + '>last ' + d + ' days</option>'; }).join('');
    var collected = eng && eng.collected_at ? 'Likes last collected ' + when(eng.collected_at) + '.' :
      'Likes have not been collected yet: the collector runs after each ingest (every 4 hours) from 2026-10-27.';
    var table = rows.length ? '<div style="overflow-x:auto"><table class="tbl en-tbl"><thead><tr><th>Published (PT)</th><th>Kind</th><th>Post</th>' +
      '<th class="n">Likes</th><th class="n">Reposts</th><th class="n">Replies</th><th class="n">Visitors</th><th class="n">Registrations</th><th class="n">Reports</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var lab = esc(r.label || r.post_id);
        return '<tr><td class="muted">' + esc(when(r.published_at)) + '</td>' +
          '<td><span class="en-kind en-' + esc(r.kind) + '">' + (r.kind === 'shorts' ? 'VIDEO' : 'MAPS') + '</span></td>' +
          '<td>' + (r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + lab + '</a>' : lab) + '</td>' +
          '<td class="n">' + show(r.likes) + '</td><td class="n">' + show(r.reposts) + '</td><td class="n">' + show(r.replies) + '</td>' +
          '<td class="n">' + r.visitors + '</td><td class="n">' + r.registrations + '</td><td class="n">' + r.reports + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="muted">No posts published in this period.</div>';
    var na = [].concat((eng && eng.unavailable) || [], (an.unavailable) || []);
    var untagged = Number(an.untagged_bluesky_visitors) || 0;
    return CSS + '<div class="card" id="en-card"><h3>Bluesky: posts to people <span class="tile-tag t-real" style="margin-left:6px">live</span> ' +
      '<select id="en-days" aria-label="Period" style="margin-left:8px;font-size:12px">' + days + '</select></h3>' +
      '<p class="sub">Every published MAPS and video post, what people did on Bluesky, and who came to the site from it. ' +
      'Visitors are first visits only; registrations and reports are credited to the account\'s first visit.</p>' +
      '<div class="en-fun">' +
        step(f.posts, 'Posts published', f.posts ? f.measured + ' measured on Bluesky' : '') +
        step('Not available', 'Impressions', 'Bluesky has no views API', true) +
        step(f.engagement == null ? '—' : f.engagement, 'Likes, reposts, replies', f.measured ? (Math.round(10 * f.engagement / f.measured) / 10) + ' per measured post' : 'not measured yet') +
        step(f.visitors, 'First visits to the site', f.posts ? (Math.round(100 * f.visitors / f.posts) / 100) + ' per post' : '') +
        step(f.registrations, 'Registrations', rate(f.registrations, f.visitors) + ' of visitors') +
        step(f.reports, 'Reports saved', rate(f.reports, f.registrations) + ' of registrations') +
      '</div>' + table +
      '<p class="en-note">' + esc(collected) + (untagged ? ' ' + esc(untagged + ' more visitors came from Bluesky without a post tag (the profile link or an untagged link); they belong to no post.') : '') + '</p>' +
      (na.length ? '<p class="en-note"><b>Not measured:</b> ' + na.map(esc).join(' ') + '</p>' : '') +
      '</div>';
  }

  function load(client) {
    var a = client.rpc('hs_bsky_maps_vs_shorts', { p_days: st.days }).then(function (r) { return r && !r.error ? r.data : null; }, function () { return null; });
    var b = client.rpc('hs_bsky_post_engagement').then(function (r) { return r && !r.error ? r.data : null; }, function () { return null; });
    return Promise.all([a, b]).then(function (x) { st.an = x[0]; st.eng = x[1]; st.loaded = true; });
  }

  // The tab's snapshot HTML (from the ingest build) goes into a collapsed section below the live card.
  function wrapSnapshot(tab, snapshotLabel) {
    if (!tab || tab.querySelector('#en-live')) return tab && tab.querySelector('#en-live');
    var old = tab.innerHTML;
    tab.innerHTML = '<div id="en-live"></div>' +
      (old.trim() ? '<details class="card en-snap"><summary>Older snapshot' + (snapshotLabel ? ' (' + esc(snapshotLabel) + ')' : '') +
        ': built by the ingest dashboard script, not live. Its page-visit and campaign-drip figures have not been re-verified.</summary>' + old + '</details>' : '');
    return tab.querySelector('#en-live');
  }

  function mount(client, tab, snapshotLabel) {
    var host = wrapSnapshot(tab, snapshotLabel);
    if (!host || !client) return;
    host.innerHTML = render();
    if (host.getAttribute('data-en-wired') !== '1') {
      host.setAttribute('data-en-wired', '1');
      host.addEventListener('change', function (e) {
        if (e.target && e.target.id === 'en-days') {
          st.days = Number(e.target.value) || 30;
          client.rpc('hs_bsky_maps_vs_shorts', { p_days: st.days }).then(function (r) { st.an = r && !r.error ? r.data : null; host.innerHTML = render(); });
        }
      });
    }
    load(client).then(function () { host.innerHTML = render(); });
  }

  HS.acqEngagement = { mount: mount, rowsFrom: rowsFrom, funnel: funnel, webUrl: webUrl, esc: esc, wrapSnapshot: wrapSnapshot,
    _render: function (an, eng) { st.an = an; st.eng = eng; st.loaded = true; return render(); } };
})();
