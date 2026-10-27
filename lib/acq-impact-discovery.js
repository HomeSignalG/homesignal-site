/* Acquisition Dashboard Tab 17 — "Hot Topics — Automatically Discovered" (Impact Stories auto-discovery, 2026-10-27).
 *
 * Bluesky discussions found by the scheduled scans (homesignal-ingest impact/discovery), ranked by the JODY score.
 * A post is a discovery signal, never evidence: a topic becomes an Impact Story only after a source pack is built from
 * records and checked word for word, and nothing here approves, renders or publishes.
 *
 * Reads and writes only through the admin-gated functions in docs/impact-discovery.sql. Every value from the database
 * or Bluesky is escaped; a link is shown only when it is http(s).
 */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  var POLL_MS = 15000;
  var SLOW_POLL_MS = 60000;
  var PENDING = ['nominated', 'researching', 'preparing'];
  var CAT = { data_centers: 'Data centers', zoning_development: 'Zoning & development', water_groundwater: 'Water & groundwater',
    pollution_health: 'Pollution & health', trees_land: 'Trees, wetlands & open space', industrial_logistics: 'Warehouses & truck yards',
    energy_utilities: 'Power lines, pipelines & utilities', housing_displacement: 'Housing & displacement', tribal_land: 'Tribal land & sovereignty',
    public_accountability: 'Broader public accountability', other: 'Other' };
  var STATUS = { open: ['Candidate', 'wait'], nominated: ['Nominated for research', 'ok'], researching: ['Researching records', 'wait'],
    preparing: ['Preparing the story', 'wait'], ready_for_review: ['Auto-discovered — Ready for Review', 'ok'],
    insufficient: ['Not enough evidence', 'bad'], rejected: ['Rejected', 'bad'], dismissed: ['Dismissed', 'bad'],
    excluded: ['Excluded (and similar topics)', 'bad'], stale: ['No new development', 'wait'] };
  var EVIDENCE = { social_only: ['Social posts only — unverified', 'bad'], leads_found: ['Independent sources linked — not yet checked', 'wait'],
    researching: ['Records being checked', 'wait'], verified: ['Verified source pack', 'ok'], insufficient: ['Insufficient evidence', 'bad'] };
  var PARTS = [['mission', 'Mission', 25], ['verifiable', 'Verifiable', 20], ['engagement', 'Engagement', 15], ['stakes', 'Emotional stakes', 15],
    ['visuals', 'Visuals', 10], ['timeliness', 'Timeliness', 10], ['report_potential', 'Report potential', 5]];
  var SCAN_STATUS = { queued: 'Starting', running: 'Scanning', success: 'Complete', partial: 'Complete with errors', failed: 'Failed' };

  var H = { client: null, el: null, data: null, err: null, showClosed: false, open: {}, msg: null, timer: null, onOpenStory: null, loading: false, loadedAt: 0 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function url(u) { return /^https?:\/\//i.test(String(u || '')) ? esc(u) : null; }
  function link(u, text) { var h = url(u); return h ? '<a href="' + h + '" target="_blank" rel="noopener noreferrer">' + esc(text || u) + '</a>' : esc(text || ''); }
  function when(v) {
    if (!v) return '';
    var d = new Date(v); if (isNaN(d)) return '';
    var pt = d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return pt + ' PT';
  }
  function ago(v) {
    var d = new Date(v); if (!v || isNaN(d)) return '';
    var h = (Date.now() - d.getTime()) / 3600000;
    return h < 1 ? Math.max(1, Math.round(h * 60)) + ' min ago' : h < 48 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' days ago';
  }
  function n(v) { return v == null ? '—' : Number(v).toLocaleString('en-US'); }
  function badge(pair) { return '<span class="is-badge ' + (pair ? pair[1] : 'wait') + '">' + esc(pair ? pair[0] : '') + '</span>'; }
  function errText(e) { return (e && (e.message || e.details)) || 'Something went wrong. Nothing was changed.'; }
  function rpc(name, args) { return H.client.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }

  function load(force) {
    if (H.loading || (!force && H.data && Date.now() - H.loadedAt < 5000)) return Promise.resolve();
    H.loading = true;
    return rpc('hs_impact_discovery_overview', { p_show_closed: H.showClosed }).then(function (d) {
      H.data = d; H.err = null; H.loadedAt = Date.now();
    }, function (e) { H.err = errText(e); }).then(function () { H.loading = false; render(); schedule(); });
  }
  function busy() { var s = H.data && H.data.latest_scan; return !!(s && (s.status === 'queued' || s.status === 'running')); }
  // Keep refreshing while anything is still moving: a scan running (fast), or a topic nominated, being researched or being
  // prepared (slower: research is a separate session that can take an hour), so Ready for Review appears without a reload.
  function schedule() {
    clearTimeout(H.timer);
    var moving = H.data && (H.data.candidates || []).some(function (c) { return PENDING.indexOf(c.status) >= 0; });
    if (!busy() && !moving) return;
    H.timer = setTimeout(function () { if (H.el && document.body.contains(H.el)) load(true); }, busy() ? POLL_MS : SLOW_POLL_MS);
  }

  // ── scan status: never a zero that looks clean when the scan failed ─────────────────────────────────
  function scanBlock(d) {
    var latest = d.latest_scan, ok = d.last_success, next = d.next_scan_at, st = d.settings || {};
    var out = '<div class="is-status" aria-label="Scan status">';
    if (ok) {
      out += '<span><b>Last successful scan:</b> ' + esc(when(ok.finished_at)) + ' (' + esc(ago(ok.finished_at)) + ')</span>' +
        '<span><b>Posts examined:</b> ' + n(ok.posts_examined) + '</span>' +
        '<span><b>Topics qualified:</b> ' + n(ok.candidates_qualified) + '</span>' +
        '<span><b>Nominated:</b> ' + n(ok.candidates_nominated) + '</span>' +
        (ok.status === 'partial' ? '<span class="is-badge bad">' + n((ok.errors || []).length) + ' error(s)</span>' : '');
    } else {
      out += '<span class="is-muted">No scan has completed yet.</span>';
    }
    out += '<span><b>Next scan:</b> ' + (st.scan_enabled === false ? 'scheduled scans are off' : esc(when(next) || '—')) + '</span></div>';
    if (latest && (latest.status === 'queued' || latest.status === 'running')) {
      out += '<div class="is-warnbox" role="status">' + esc(SCAN_STATUS[latest.status]) + '… started ' + esc(when(latest.created_at)) +
        ' (' + esc(latest.trigger === 'manual' ? 'Scan Now' : 'scheduled') + '). Results appear here when it finishes.</div>';
    } else if (latest && latest.status === 'failed') {
      out += '<div class="is-block" role="alert"><b>The latest scan failed</b> (' + esc(when(latest.finished_at || latest.created_at)) + '). ' +
        'Nothing it saw was recorded, so the list below is from the last successful scan.' +
        '<ul class="is-list">' + (latest.errors || []).slice(0, 4).map(function (e) { return '<li>' + esc(e.message || e.kind) + '</li>'; }).join('') + '</ul>' +
        (latest.rate_limited ? '<div>Bluesky rate-limited the scan. It will try again at the next scheduled time.</div>' : '') + '</div>';
    } else if (latest && latest.status === 'partial') {
      out += '<div class="is-warnbox"><b>Some searches failed in the latest scan.</b><ul class="is-list">' +
        (latest.errors || []).slice(0, 4).map(function (e) { return '<li>' + esc(e.message || e.kind) + '</li>'; }).join('') + '</ul></div>';
    }
    return out;
  }

  function scoreBreakdown(c) {
    var p = c.score_parts || {};
    return '<table class="is-tab" aria-label="Score breakdown">' + PARTS.map(function (x) {
      return '<tr><td>' + esc(x[1]) + '</td><td>' + n(p[x[0]]) + ' / ' + x[2] + '</td></tr>';
    }).join('') + (p.learned ? '<tr><td>Learned from past results</td><td>' + (p.learned > 0 ? '+' : '') + n(p.learned) + '</td></tr>' : '') +
      '<tr><th>Total</th><th>' + n(c.score) + ' / 100</th></tr></table>';
  }

  function sources(c) {
    var ev = c.evidence || {}, rel = c.related || [];
    return '<div class="is-sec"><h4>Sources</h4>' +
      '<p class="is-muted">Bluesky posts are where the topic was noticed. They are not evidence.</p>' +
      '<ul class="is-list">' + rel.slice(0, 12).map(function (r) {
        return '<li>' + link(r.url, '@' + (r.author || 'post')) + ' · ' + esc(when(r.created_at)) + ' · ' + n(r.replies) + ' replies, ' +
          n(r.reposts) + ' reposts, ' + n(r.likes) + ' likes' + (r.syndicated ? ' <span class="is-badge wait">copy</span>' : '') + '</li>';
      }).join('') + '</ul>' +
      ((ev.leads || []).length ? '<p style="margin-top:8px"><b>Linked documents and reports to check</b></p><ul class="is-list">' + ev.leads.map(function (l) {
        return '<li>' + link(l.url, l.domain || l.url) + ' <span class="is-muted">(' + esc(l.kind) + ')</span></li>';
      }).join('') + '</ul>' : '<div class="is-warnbox">No official record or news report is linked yet.</div>') +
      ((ev.sources || []).length ? '<p style="margin-top:8px"><b>Verified sources</b></p><ul class="is-list">' + ev.sources.map(function (s) {
        return '<li>' + link(s.url, s.label || s.url) + '</li>';
      }).join('') + '</ul>' : '') +
      ((ev.missing || []).length ? '<p style="margin-top:8px"><b>Missing evidence</b></p><ul class="is-list">' + ev.missing.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' : '') +
      ((ev.unverified || []).length ? '<p class="is-muted" style="margin-top:6px">Unverified: ' + ev.unverified.map(esc).join(' ') + '</p>' : '') + '</div>';
  }

  function concept(c) {
    var k = c.concept || {};
    var tag = k.verified ? '<span class="is-badge ok">From verified records</span>' : '<span class="is-badge bad">Provisional — written from the posts, unverified</span>';
    if (k.neutral) {
      return '<div class="is-sec"><h4>Story concept ' + tag + '</h4><p><b>Question:</b> ' + esc(k.hook) + '</p>' +
        '<p><b>What residents can do:</b> ' + esc(k.motivation) + '</p><p class="is-muted">' + esc(k.note) + '</p>' +
        '<p><b>Opening visual:</b> ' + esc(k.opening_visual) + '</p><p><b>First 3 seconds:</b> “' + esc(k.first3s) + '”</p></div>';
    }
    return '<div class="is-sec"><h4>Story concept ' + tag + '</h4>' +
      '<p><b>Hook:</b> ' + esc(k.hook) + '</p>' +
      '<p><span class="is-thr fear">FEAR</span>' + esc(k.fear) + '</p>' +
      '<p><span class="is-thr anger">ANGER</span>' + esc(k.anger) + '</p>' +
      '<p><span class="is-thr motivation">MOTIVATION</span>' + esc(k.motivation) + '</p>' +
      ((k.affected || []).length ? '<p><b>Who is affected:</b> ' + k.affected.map(esc).join(', ') + '</p>' : '') +
      '<p><b>Opening visual:</b> ' + esc(k.opening_visual) + '</p><p><b>First 3 seconds:</b> “' + esc(k.first3s) + '”</p>' +
      (k.visual_note ? '<p class="is-muted">' + esc(k.visual_note) + '</p>' : '') + '</div>';
  }

  function storyButton(c) {
    if (c.story_id) return '<button class="is-btn primary" data-hot="story" data-id="' + esc(c.id) + '">Open Impact Story</button>';
    if (c.evidence_status === 'verified' && c.source_slug) return '<button class="is-btn primary" data-hot="story" data-id="' + esc(c.id) + '">Create Impact Story</button>';
    return '<button class="is-btn" disabled title="A story is created only after its records are verified">Create Impact Story</button>';
  }

  function card(c) {
    var m = c.metrics || {}, cov = c.coverage || {}, places = cov.places || [];
    var pages = places.reduce(function (a, p) { return a + (p.zip_pages || 0); }, 0);
    var closed = ['rejected', 'dismissed', 'excluded'].indexOf(c.status) >= 0;
    var o = H.open[c.id] || {};
    return '<article class="is-card" aria-label="' + esc(c.title) + '">' +
      '<div class="is-head"><div style="min-width:0"><h4>' + esc(c.title) + '</h4>' +
      '<div class="is-muted">' + esc(c.place || 'Place not identified') + ' · ' + esc(CAT[c.category] || c.category) +
      (c.track === 'experimental' ? ' · <span class="is-badge emo">Experimental: broader public accountability</span>' : '') + '</div></div>' +
      '<div style="text-align:right"><div class="is-score">' + n(c.score) + '</div><div class="is-muted">of 100</div></div></div>' +
      '<div class="is-row" style="margin-top:6px">' + badge(STATUS[c.status]) + badge(EVIDENCE[c.evidence_status]) +
      (c.duplicate_of ? '<span class="is-badge wait">Same event as another topic</span>' : '') + '</div>' +
      '<div class="is-muted" style="margin-top:6px">Lead post ' + link(c.lead_url, '@' + (c.lead_author || 'post')) + ' · posted ' + esc(when(c.lead_created_at)) +
      ' · ' + n(m.replies) + ' replies, ' + n(m.reposts) + ' reposts, ' + n(m.likes) + ' likes across ' + n(m.posts) + ' post(s)</div>' +
      '<div class="is-muted">Discovered ' + esc(when(c.discovered_at)) + ' · last seen ' + esc(ago(c.last_seen_at)) +
      (pages ? ' · JODY covers ' + n(pages) + ' ZIP page(s) here' : ' · no JODY ZIP page matched') + '</div>' +
      (c.status_note ? '<div class="is-warnbox">' + esc(c.status_note) + '</div>' : '') +
      '<ul class="is-list">' + (c.reasons || []).slice(0, 5).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
      '<div class="is-row" style="margin-top:8px">' +
      '<button class="is-btn" data-hot="toggle" data-k="src" data-id="' + esc(c.id) + '" aria-expanded="' + !!o.src + '">Open Sources</button>' +
      '<button class="is-btn" data-hot="toggle" data-k="concept" data-id="' + esc(c.id) + '" aria-expanded="' + !!o.concept + '">View Story Concept</button>' +
      '<button class="is-btn" data-hot="toggle" data-k="score" data-id="' + esc(c.id) + '" aria-expanded="' + !!o.score + '">Score</button>' +
      storyButton(c) +
      (closed ? '<button class="is-btn" data-hot="decide" data-a="restore" data-id="' + esc(c.id) + '">Restore</button>'
        : (c.story_id ? '' : '<button class="is-btn warn" data-hot="decide" data-a="reject" data-id="' + esc(c.id) + '">Reject</button>' +
           '<button class="is-btn" data-hot="decide" data-a="dismiss" data-id="' + esc(c.id) + '">Dismiss Topic</button>' +
           '<button class="is-btn" data-hot="decide" data-a="exclude_similar" data-id="' + esc(c.id) + '">Exclude Similar Topics</button>')) +
      '</div>' +
      (o.src ? sources(c) : '') + (o.concept ? concept(c) : '') + (o.score ? '<div class="is-sec">' + scoreBreakdown(c) + '</div>' : '') +
      '</article>';
  }

  function performance(d) {
    var p = d.performance || [];
    if (p.length && p[0].error) return '<p class="is-muted">' + esc(p[0].error) + '</p>';
    if (!p.length) return '<p class="is-muted">No auto-discovered story has been published yet, so there are no results to learn from.</p>';
    return '<table class="is-tab"><tr><th>Category</th><th>Stories</th><th>Visits</th><th>Registrations</th><th>Reports</th><th>Paid</th><th>YouTube / Shorts / Bluesky</th></tr>' +
      p.map(function (r) {
        return '<tr><td>' + esc(CAT[r.category] || r.category) + (r.track === 'experimental' ? ' (experimental)' : '') + '</td><td>' + n(r.stories) + '</td><td>' +
          n(r.visits) + '</td><td>' + n(r.registrations) + '</td><td>' + n(r.reports) + '</td><td>' + n(r.paid_reports) +
          '</td><td class="is-muted">not collected yet</td></tr>';
      }).join('') + '</table><p class="is-muted">Counted from JODY TRACKS’ own visit and account records for each story’s link. Likes and followers are not counted as results.</p>';
  }

  function settings(d) {
    var st = d.settings || {};
    return '<details class="is-sec"><summary><b>Scan settings</b></summary>' +
      '<div class="is-row" style="margin-top:8px"><label>Scan times (Pacific, HH:MM, comma-separated) <input class="is-in" id="hot-times" value="' + esc((st.scan_times || []).join(', ')) + '"></label></div>' +
      '<div class="is-row"><label><input type="checkbox" id="hot-on"' + (st.scan_enabled ? ' checked' : '') + '> Scheduled scans on</label>' +
      '<label>Window (hours) <input class="is-in" style="width:80px" id="hot-window" type="number" min="6" max="720" value="' + esc(st.window_hours) + '"></label>' +
      '<label>Nominate at score <input class="is-in" style="width:70px" id="hot-score" type="number" min="0" max="100" value="' + esc(st.nominate_score) + '"></label>' +
      '<label>Stories prepared per scan <input class="is-in" style="width:60px" id="hot-max" type="number" min="0" max="5" value="' + esc(st.max_prepare_per_scan) + '"></label></div>' +
      '<div class="is-row"><label>Targets: replies <input class="is-in" style="width:70px" id="hot-tr" type="number" min="0" value="' + esc(st.target_replies) + '"></label>' +
      '<label>likes <input class="is-in" style="width:70px" id="hot-tl" type="number" min="0" value="' + esc(st.target_likes) + '"></label>' +
      '<label>reposts <input class="is-in" style="width:70px" id="hot-tp" type="number" min="0" value="' + esc(st.target_reposts) + '"></label></div>' +
      '<div class="is-row"><label><input type="checkbox" id="hot-exp"' + (st.experimental_enabled ? ' checked' : '') + '> Show the broader public accountability track</label>' +
      '<label><input type="checkbox" id="hot-expauto"' + (st.experimental_auto ? ' checked' : '') + '> Prepare that track automatically</label>' +
      '<label><input type="checkbox" id="hot-learn"' + (st.learning_enabled ? ' checked' : '') + '> Learn from results</label></div>' +
      '<div class="is-row"><button class="is-btn" data-hot="save-settings">Save settings</button></div></details>';
  }

  function render() {
    if (!H.el) return;
    if (H.err && !H.data) {
      H.el.innerHTML = '<div class="card"><h3>Hot Topics — Automatically Discovered</h3><div class="is-block" role="alert">Hot Topics could not load: ' +
        esc(H.err) + '</div><button class="is-btn" data-hot="reload">Try again</button></div>';
      return;
    }
    if (!H.data) { H.el.innerHTML = '<div class="card"><h3>Hot Topics — Automatically Discovered</h3><p class="is-muted">Loading…</p></div>'; return; }
    var d = H.data, list = d.candidates || [];
    H.el.innerHTML = '<div class="card"><div class="is-head"><div><h3>Hot Topics — Automatically Discovered</h3>' +
      '<p class="sub">Bluesky discussions about development, land, water and health near homes, ranked by how well they fit JODY TRACKS. ' +
      'A post is a lead, never evidence: a story is written only after the records are found and checked. Nothing here approves, renders or publishes.</p></div>' +
      '<button class="is-btn primary" data-hot="scan"' + (busy() ? ' disabled' : '') + '>' + (busy() ? 'Scanning…' : 'Scan Now') + '</button></div>' +
      scanBlock(d) +
      (H.msg ? '<div class="' + (H.msg.bad ? 'is-block' : 'is-okbox') + '" role="status">' + esc(H.msg.text) + '</div>' : '') +
      (H.err ? '<div class="is-block">' + esc(H.err) + '</div>' : '') +
      '<div class="is-row" style="margin:8px 0"><label><input type="checkbox" data-hot="closed"' + (H.showClosed ? ' checked' : '') + '> Show rejected, dismissed and stale topics</label></div>' +
      (list.length ? '<div class="is-cards">' + list.map(card).join('') + '</div>'
        : '<p class="is-muted">' + (d.last_success ? 'No topic qualified in the scans so far.' : 'No topics yet: the first scan has not completed.') + '</p>') +
      '<details class="is-sec"><summary><b>What discovered stories have produced</b></summary>' + performance(d) + '</details>' +
      settings(d) + '</div>';
    H.msg = null;
  }

  function act(p) {
    return p.then(function () { return load(true); }, function (e) { H.msg = { bad: true, text: errText(e) }; render(); });
  }

  function onClick(ev) {
    var t = ev.target.closest('[data-hot]'); if (!t || !H.el.contains(t)) return;
    var a = t.getAttribute('data-hot'), id = t.getAttribute('data-id');
    if (a === 'reload') return load(true);
    if (a === 'closed') { H.showClosed = t.checked; return load(true); }
    if (a === 'toggle') { var k = t.getAttribute('data-k'); H.open[id] = H.open[id] || {}; H.open[id][k] = !H.open[id][k]; return render(); }
    if (a === 'scan') {
      t.disabled = true;
      return act(rpc('hs_impact_discovery_scan_now').then(function (r) {
        H.msg = { text: r.existing ? r.message : 'Scan started. This takes a few minutes; this panel updates on its own.' };
      }));
    }
    if (a === 'decide') {
      var what = t.getAttribute('data-a');
      var prompts = { reject: 'Reject this topic? Optionally say why (kept with the decision).', dismiss: 'Dismiss this topic for now? Optionally say why.',
        exclude_similar: 'Exclude this topic and similar ones from future scans? Optionally say why.' };
      var note = null;
      if (prompts[what]) { note = window.prompt(prompts[what], ''); if (note === null) return; }
      return act(rpc('hs_impact_discovery_decide', { p_candidate: id, p_action: what, p_note: note || null }));
    }
    if (a === 'story') {
      t.disabled = true;
      return rpc('hs_impact_discovery_open_story', { p_candidate: id }).then(function (r) {
        if (H.onOpenStory) return H.onOpenStory(r.story_id);
      }, function (e) { H.msg = { bad: true, text: errText(e) }; render(); });
    }
    if (a === 'save-settings') {
      var q = function (s) { return H.el.querySelector(s); };
      var num = function (s) { var v = q(s).value; return v === '' ? null : Number(v); };
      var body = { scan_times: q('#hot-times').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean),
        scan_enabled: q('#hot-on').checked, window_hours: num('#hot-window'), nominate_score: num('#hot-score'),
        max_prepare_per_scan: num('#hot-max'), target_replies: num('#hot-tr'), target_likes: num('#hot-tl'), target_reposts: num('#hot-tp'),
        experimental_enabled: q('#hot-exp').checked, experimental_auto: q('#hot-expauto').checked, learning_enabled: q('#hot-learn').checked };
      return act(rpc('hs_impact_discovery_settings_save', { p_settings: body }).then(function () { H.msg = { text: 'Settings saved.' }; }));
    }
  }

  HS.acqImpactDiscovery = {
    // Mount into a container the library re-creates on each render; the data is kept between mounts.
    attach: function (client, container, onOpenStory) {
      if (!client || !container) return;
      H.client = client; H.el = container; H.onOpenStory = onOpenStory;
      container.addEventListener('click', onClick);
      render();
      return load(false);
    },
    _state: H, _render: render
  };
})();
