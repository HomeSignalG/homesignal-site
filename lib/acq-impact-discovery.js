/* Acquisition Dashboard Tab 17 — "Hot Topics — Automatically Discovered" (Impact Stories auto-discovery, 2026-10-27).
 *
 * Bluesky discussions found by the scheduled scans (homesignal-ingest impact/discovery), ranked by the JODY score.
 * A post is a discovery signal, never evidence: a topic becomes an Impact Story only after a source pack is built from
 * records and checked word for word, and nothing here approves, renders or publishes.
 *
 * Reads and writes only through the admin-gated functions in docs/impact-discovery.sql. Every value from the database
 * or Bluesky is escaped; a link is shown only when it is http(s).
 *
 * "Suggest a topic" (founder, 2026-10-28): the founder can add a topic by hand (origin 'founder'). It goes straight to the
 * research queue and is shown first, tagged "Your pick". Its links are leads to check, never evidence: it meets the same
 * verified-source-pack rule as a scanned topic before it becomes a story. Tab 16 has its own box for its own video format (lib/acq-video-suggest.js).
 */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  var POLL_MS = 15000;
  var SLOW_POLL_MS = 60000, IDLE_MAX_MS = 30 * 60000;
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

  var FOUNDER_STATUS = { nominated: ['Your pick — waiting for research', 'ok'], ready_for_review: ['Your pick — Ready for Review', 'ok'] };
  var FOUNDER_EVIDENCE = { social_only: ['No sources added yet', 'wait'], leads_found: ['Your links — not yet checked', 'wait'] };
  var SUGGEST_FIELDS = ['hot-sg-title', 'hot-sg-place', 'hot-sg-cat', 'hot-sg-links', 'hot-sg-note'];

  var H = { client: null, el: null, data: null, err: null, showClosed: false, open: {}, msg: null, timer: null, onOpenStory: null, loading: false, loadedAt: 0,
    suggestOpen: false, suggestFocus: false, suggestBusy: false };
  function founder(c) { return c && c.origin === 'founder'; }
  function hasConcept(c) { var k = c.concept || {}; return Object.keys(k).some(function (x) { return x !== 'verified' && k[x]; }); }

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
    var delay = busy() ? POLL_MS : moving ? SLOW_POLL_MS : idleDelay();
    if (delay == null) return;
    H.timer = setTimeout(function () { if (H.el && document.body.contains(H.el)) load(true); }, delay);
  }
  // Idle with scheduled scans on: look again shortly after the next scan is due (at most every IDLE_MAX_MS), so a scheduled
  // scan and the topics it finds appear without a reload. Scheduled scans off: no timer.
  function idleDelay() {
    var st = (H.data && H.data.settings) || {};
    if (!H.data || st.scan_enabled === false) return null;
    var at = Date.parse(H.data.next_scan_at || '');
    var d = isNaN(at) ? IDLE_MAX_MS : at - Date.now() + 2 * 60000;
    return Math.min(IDLE_MAX_MS, Math.max(SLOW_POLL_MS, d));
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
    if (founder(c)) {
      return '<div class="is-sec"><h4>Sources</h4>' +
        ((ev.leads || []).length ? '<p><b>Links you added</b> <span class="is-muted">(leads to check, not yet evidence)</span></p><ul class="is-list">' +
          ev.leads.map(function (l) { return '<li>' + link(l.url, l.url) + '</li>'; }).join('') + '</ul>'
          : '<div class="is-warnbox">You added no links. The research session will look for the records.</div>') +
        ((ev.sources || []).length ? '<p style="margin-top:8px"><b>Verified sources</b></p><ul class="is-list">' + ev.sources.map(function (x) {
          return '<li>' + link(x.url, x.label || x.url) + '</li>'; }).join('') + '</ul>' : '') +
        ((ev.missing || []).length ? '<p style="margin-top:8px"><b>Missing evidence</b></p><ul class="is-list">' + ev.missing.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' : '') +
        '</div>';
    }
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

  function founderCard(c) {
    var closed = ['rejected', 'dismissed', 'excluded'].indexOf(c.status) >= 0;
    var o = H.open[c.id] || {};
    return '<article class="is-card" aria-label="' + esc(c.title) + '">' +
      '<div class="is-head"><div style="min-width:0"><h4>' + esc(c.title) + '</h4>' +
      '<div class="is-muted">' + esc(c.place || 'Place not given') + ' · ' + esc(CAT[c.category] || c.category) + '</div></div>' +
      '<div style="text-align:right"><span class="is-badge emo">Your pick</span></div></div>' +
      '<div class="is-row" style="margin-top:6px">' + badge(FOUNDER_STATUS[c.status] || STATUS[c.status]) +
      badge(FOUNDER_EVIDENCE[c.evidence_status] || EVIDENCE[c.evidence_status]) + '</div>' +
      '<div class="is-muted" style="margin-top:6px">Suggested ' + esc(when(c.discovered_at)) + ' (' + esc(ago(c.discovered_at)) + ')</div>' +
      (c.submitted_note ? '<p style="margin:6px 0"><b>Why it matters:</b> ' + esc(c.submitted_note) + '</p>' : '') +
      (c.status_note ? '<div class="is-warnbox">' + esc(c.status_note) + '</div>' : '') +
      (c.status === 'nominated' ? '<p class="is-muted">The next research session takes your picks first. It finds and checks the records, then writes the story for your review.</p>' : '') +
      '<div class="is-row" style="margin-top:8px">' +
      '<button class="is-btn" data-hot="toggle" data-k="src" data-id="' + esc(c.id) + '" aria-expanded="' + !!o.src + '">Open Sources</button>' +
      (hasConcept(c) ? '<button class="is-btn" data-hot="toggle" data-k="concept" data-id="' + esc(c.id) + '" aria-expanded="' + !!o.concept + '">View Story Concept</button>' : '') +
      storyButton(c) +
      (closed ? '<button class="is-btn" data-hot="decide" data-a="restore" data-id="' + esc(c.id) + '">Restore</button>'
        : (c.story_id ? '' : '<button class="is-btn" data-hot="decide" data-a="dismiss" data-id="' + esc(c.id) + '">Withdraw</button>')) +
      '</div>' + (o.src ? sources(c) : '') + (o.concept ? concept(c) : '') + '</article>';
  }

  function card(c) {
    if (founder(c)) return founderCard(c);
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
    if (!p.length) return '<p class="is-muted">No story from Hot Topics has been published yet, so there are no results to compare.</p>';
    return '<table class="is-tab"><tr><th>Category</th><th>Stories</th><th>Visits</th><th>Registrations</th><th>Reports</th><th>Paid</th><th>YouTube / Shorts / Bluesky</th></tr>' +
      p.map(function (r) {
        return '<tr><td>' + esc(CAT[r.category] || r.category) + (r.track === 'experimental' ? ' (experimental)' : '') +
          (r.origin === 'founder' ? ' · your picks' : r.origin === 'scan' ? ' · from scans' : '') + '</td><td>' + n(r.stories) + '</td><td>' +
          n(r.visits) + '</td><td>' + n(r.registrations) + '</td><td>' + n(r.reports) + '</td><td>' + n(r.paid_reports) +
          '</td><td class="is-muted">not collected yet</td></tr>';
      }).join('') + '</table><p class="is-muted">Counted from JODY TRACKS’ own visit and account records for each story’s link. Likes and followers are not counted as results.</p>';
  }

  function suggestForm() {
    var opts = Object.keys(CAT).filter(function (k) { return k !== 'public_accountability'; }).map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === 'other' ? ' selected' : '') + '>' + esc(CAT[k]) + '</option>';
    }).join('');
    return '<details class="is-sec" id="hot-suggest"' + (H.suggestOpen ? ' open' : '') + '><summary><b>Suggest a topic</b> ' +
      '<span class="is-muted">— a story you want made. It goes to the top of the research queue.</span></summary>' +
      '<div style="display:grid;gap:8px;margin-top:8px;max-width:760px">' +
      '<label>Topic <span class="is-muted">(required)</span><input class="is-in" id="hot-sg-title" maxlength="300" style="width:100%" placeholder="e.g. Van Tramp fill project next to Wildwood Park"></label>' +
      '<div class="is-row"><label>Place or ZIP <input class="is-in" id="hot-sg-place" maxlength="200" placeholder="e.g. Puyallup, WA 98374"></label>' +
      '<label>Category <select class="is-in" id="hot-sg-cat">' + opts + '</select></label></div>' +
      '<label>Links to records, news or posts <span class="is-muted">(one per line, optional)</span>' +
      '<textarea class="is-in" id="hot-sg-links" rows="3" style="width:100%" placeholder="https://…"></textarea></label>' +
      '<label>Why it matters <span class="is-muted">(optional)</span><textarea class="is-in" id="hot-sg-note" rows="3" maxlength="2000" style="width:100%"></textarea></label>' +
      '<p class="is-muted" style="margin:0">Your links are leads to check, not evidence. A story is written only after the records are found and checked word for word, as for every topic.</p>' +
      '<div class="is-row"><button class="is-btn primary" data-hot="suggest"' + (H.suggestBusy ? ' disabled' : '') + '>' +
      (H.suggestBusy ? 'Adding…' : 'Add topic') + '</button></div></div></details>';
  }

  function settings(d) {
    var st = d.settings || {};
    return '<details class="is-sec" id="hot-set"><summary><b>Scan settings</b></summary>' +
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
    var d = H.data, list = d.candidates || [], keep = snapshot();
    H.el.innerHTML = '<div class="card"><div class="is-head"><div><h3>Hot Topics — Automatically Discovered</h3>' +
      '<p class="sub">Bluesky discussions about development, land, water and health near homes, ranked by how well they fit JODY TRACKS. ' +
      'A post is a lead, never evidence: a story is written only after the records are found and checked. Nothing here approves, renders or publishes.</p></div>' +
      '<button class="is-btn primary" data-hot="scan"' + (busy() ? ' disabled' : '') + '>' + (busy() ? 'Scanning…' : 'Scan Now') + '</button></div>' +
      scanBlock(d) + suggestForm() +
      (H.msg ? '<div class="' + (H.msg.bad ? 'is-block' : 'is-okbox') + '" role="status">' + esc(H.msg.text) + '</div>' : '') +
      (H.err ? '<div class="is-block">' + esc(H.err) + '</div>' : '') +
      '<div class="is-row" style="margin:8px 0"><label><input type="checkbox" data-hot="closed"' + (H.showClosed ? ' checked' : '') + '> Show rejected, dismissed and stale topics</label></div>' +
      (list.length ? '<div class="is-cards">' + list.map(card).join('') + '</div>'
        : '<p class="is-muted">' + (d.last_success ? 'No topic qualified in the scans so far.' : 'No topics yet: the first scan has not completed.') +
          ' You can add your own with Suggest a topic.</p>') +
      '<details class="is-sec" id="hot-perf"><summary><b>What discovered stories have produced</b></summary>' + performance(d) + '</details>' +
      settings(d) + '</div>';
    restore(keep);
    H.msg = null;
    H.suggestPinned = false;
    if (H.suggestFocus) {
      H.suggestFocus = false;
      var f = H.el.querySelector('#hot-suggest');
      if (f) { if (f.scrollIntoView) f.scrollIntoView({ block: 'start' }); var ti = H.el.querySelector('#hot-sg-title'); if (ti) ti.focus(); }
    }
  }

  // An automatic refresh rebuilds the panel: keep which sections are open, any settings typed but not yet saved, and the
  // cursor, so a refresh during a scan never throws away an edit.
  var SET_FIELDS = ['hot-times', 'hot-on', 'hot-window', 'hot-score', 'hot-max', 'hot-tr', 'hot-tl', 'hot-tp', 'hot-exp', 'hot-expauto', 'hot-learn'];
  function snapshot() {
    var k = { open: {}, values: null, focus: null };
    ['hot-set', 'hot-perf'].forEach(function (id) { var e = H.el.querySelector('#' + id); if (e) k.open[id] = e.open; });
    var sg = H.el.querySelector('#hot-suggest'); if (sg && !H.suggestPinned) H.suggestOpen = sg.open;
    k.suggest = {};
    SUGGEST_FIELDS.forEach(function (id) { var e = H.el.querySelector('#' + id); if (e) k.suggest[id] = e.value; });
    if (H.setDirty) {
      k.values = {};
      SET_FIELDS.forEach(function (id) { var e = H.el.querySelector('#' + id); if (e) k.values[id] = e.type === 'checkbox' ? e.checked : e.value; });
    }
    var a = document.activeElement;
    if (a && a.id && H.el.contains(a)) k.focus = { id: a.id, start: a.selectionStart, end: a.selectionEnd };
    return k;
  }
  function restore(k) {
    Object.keys(k.open).forEach(function (id) { var e = H.el.querySelector('#' + id); if (e) e.open = k.open[id]; });
    if (k.suggest) Object.keys(k.suggest).forEach(function (id) { var e = H.el.querySelector('#' + id); if (e) e.value = k.suggest[id]; });
    if (k.values) Object.keys(k.values).forEach(function (id) {
      var e = H.el.querySelector('#' + id); if (!e) return;
      if (e.type === 'checkbox') e.checked = k.values[id]; else e.value = k.values[id];
    });
    if (k.focus) {
      var f = H.el.querySelector('#' + k.focus.id);
      if (f) { f.focus(); try { if (k.focus.start != null) f.setSelectionRange(k.focus.start, k.focus.end); } catch (e) { /* not a text field */ } }
    }
  }
  function onEdit(ev) { if (ev.target.closest && ev.target.closest('#hot-set')) H.setDirty = true; }

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
    if (a === 'suggest') {
      var v = function (id) { var e = H.el.querySelector('#' + id); return e ? e.value : ''; };
      var title = v('hot-sg-title').trim();
      if (title.length < 5) { H.msg = { bad: true, text: 'Give the topic a title (at least 5 characters).' }; return render(); }
      var topic = { title: title, place: v('hot-sg-place').trim(), category: v('hot-sg-cat') || 'other', note: v('hot-sg-note').trim(),
        links: v('hot-sg-links').split(/\s+/).map(function (x) { return x.trim(); }).filter(Boolean) };
      H.suggestBusy = true; render();
      return rpc('hs_impact_discovery_suggest', { p_topic: topic }).then(function () {
        H.suggestBusy = false; H.suggestOpen = false; H.suggestPinned = true;
        SUGGEST_FIELDS.forEach(function (id) { var e = H.el.querySelector('#' + id); if (e) e.value = id === 'hot-sg-cat' ? 'other' : ''; });
        H.msg = { text: 'Topic added. It is at the top of the list and the next research session takes it first.' };
        return load(true);
      }, function (e) { H.suggestBusy = false; H.msg = { bad: true, text: errText(e) }; render(); });
    }
    if (a === 'save-settings') {
      var q = function (s) { return H.el.querySelector(s); };
      var num = function (s) { var v = q(s).value; return v === '' ? null : Number(v); };
      var body = { scan_times: q('#hot-times').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean),
        scan_enabled: q('#hot-on').checked, window_hours: num('#hot-window'), nominate_score: num('#hot-score'),
        max_prepare_per_scan: num('#hot-max'), target_replies: num('#hot-tr'), target_likes: num('#hot-tl'), target_reposts: num('#hot-tp'),
        experimental_enabled: q('#hot-exp').checked, experimental_auto: q('#hot-expauto').checked, learning_enabled: q('#hot-learn').checked };
      return act(rpc('hs_impact_discovery_settings_save', { p_settings: body }).then(function () { H.setDirty = false; H.msg = { text: 'Settings saved.' }; }));
    }
  }

  HS.acqImpactDiscovery = {
    // Mount into a container the library re-creates on each render; the data is kept between mounts.
    attach: function (client, container, onOpenStory) {
      if (!client || !container) return;
      H.client = client; H.el = container; H.onOpenStory = onOpenStory;
      container.addEventListener('click', onClick);
      container.addEventListener('input', onEdit);
      container.addEventListener('change', onEdit);
      render();
      return load(false);
    },
    // Tab 16's "Suggest a topic" button: open the form the next time the panel draws (or now, if it is showing).
    suggest: function () {
      H.suggestOpen = true; H.suggestFocus = true; H.suggestPinned = true;
      if (H.el && document.body.contains(H.el)) render();
    },
    _state: H, _render: render
  };
})();
