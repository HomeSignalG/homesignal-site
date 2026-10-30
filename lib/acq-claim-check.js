/* Jody Acquisition Dashboard, tab 19 · Data Center Claim Check.
   What people say about data centers, against what documented evidence shows.
   It reads public.hs_claim_check_overview() and public.hs_claim_check_claim(id), and writes only through
   hs_claim_check_decide / hs_claim_check_person_save / hs_claim_check_person_status / hs_claim_check_scan_now
   (docs/claim-check.sql). The database decides what is allowed (a verdict needs passed research; False and Misleading need
   contradicting evidence and a verified quote; a Bluesky post takes the next free MAPS or video time); this page shows its
   refusals in words.
   Thumbnails are the platform's own image or a labelled "no thumbnail" box, never a made-up picture. Video plays in the
   publisher's own player (youtube-nocookie embed) only when the source's rights allow embedding. Every value is escaped. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function thumbUrl(u) { return /^https:\/\/(i\.ytimg\.com|cdn\.bsky\.app)\//i.test(String(u || '')) ? String(u) : ''; }
  function embedUrl(u) { return /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{6,20}$/.test(String(u || '')) ? String(u) : ''; }
  function day(v) { var d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : ''; }
  function num(v) { return v == null || v === '' ? '—' : Number(v).toLocaleString(); }
  function graphemes(s) {
    try { return Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(String(s || ''))).length; }
    catch (e) { return Array.from(String(s || '')).length; }
  }

  var VERDICT = { false: 'False', misleading: 'Misleading', accurate: 'Accurate', needs_context: 'Needs Context', unverified: 'Unverified' };
  var STATUS = {
    candidate: 'Not researched', needs_research: 'Research requested', researching: 'Researching', research_ready: 'Ready for review',
    approved: 'Approved', skipped: 'Skipped', rejected: 'Rejected'
  };
  var RIGHTS = {
    reuse_authorized: 'Clip reuse authorized', embed_only: 'Publisher embed only (no copying)', link_only: 'Link only',
    unresolved: 'Reuse rights unresolved: link only', unavailable: 'Footage unavailable'
  };
  var ADAPTER = { operational: 'Operational', degraded: 'Degraded', restricted: 'Restricted', unavailable: 'Unavailable', not_run: 'Not run yet', not_built: 'Not built' };
  var VIEWS = [['trending', 'Trending Now'], ['emerging', 'Emerging'], ['people', 'People to Watch'], ['footage', 'Footage Library'],
    ['review', 'Fact-Check Review'], ['published', 'Published & Analytics']];

  var RESEARCH_DEFAULT_NOTE = 'Research this claim: who said it, their exact words, and what documented records show.';
  var state = { client: null, el: null, view: 'trending', data: null, detail: null, msg: '' };

  function friendly(e) {
    var code = e && e.code, m = e && e.message ? String(e.message) : '';
    if (code === '42501') return 'Your account cannot use the Claim Check tab.';
    return m && m.length < 400 ? m : 'That did not work (' + (code || 'error') + ').';
  }
  function rpc(name, args) {
    return state.client.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  function thumb(s, big) {
    var t = s && thumbUrl(s.thumbnail_url);
    var w = big ? 320 : 120, h = big ? 180 : 68;
    return t ? '<img class="cc-thumb" src="' + esc(t) + '" width="' + w + '" height="' + h + '" loading="lazy" alt="' + esc(s.title || 'Video thumbnail') + '">'
      : '<div class="cc-thumb cc-nothumb" style="width:' + w + 'px;height:' + h + 'px">No thumbnail available</div>';
  }
  function primary(c) { var s = (c.sources || []).filter(function (x) { return x.platform === 'youtube'; })[0]; return s || (c.sources || [])[0] || null; }
  function metrics(m) {
    m = m || {};
    var parts = [];
    [['views', 'views'], ['likes', 'likes'], ['comments', 'comments'], ['replies', 'replies'], ['reposts', 'reposts'], ['quotes', 'quotes']].forEach(function (k) {
      if (m[k[0]] != null) parts.push(num(m[k[0]]) + ' ' + k[1]);
    });
    return parts.length ? parts.join(' · ') : 'no engagement counts reported';
  }

  function row(c) {
    var s = primary(c);
    return '<li class="cc-row" data-claim="' + esc(c.id) + '">' + thumb(s) +
      '<div class="cc-rowbody"><div><b>' + esc(c.speaker_name || c.person_name || 'Speaker not identified') + '</b>' +
      (s ? ' · ' + esc(s.publisher || s.author || s.platform) : '') + (s && s.published_at ? ' · ' + esc(day(s.published_at)) : '') + '</div>' +
      '<div>' + (c.quote ? '“' + esc(c.quote) + '”' : esc(c.topic)) + '</div>' +
      '<div class="sub">' + (c.trend_score != null ? 'Trend score ' + esc(c.trend_score) + (c.score_confidence ? ' (' + esc(c.score_confidence) + ' confidence)' : '') + ' · ' : '') +
      (c.significance != null ? 'Significance ' + esc(c.significance) + ' · ' : '') +
      esc(STATUS[c.status] || c.status) + (c.research_active ? ' (' + esc(c.research_active) + ')' : '') +
      (c.verdict ? ' · proposed verdict: <b>' + esc(VERDICT[c.verdict]) + '</b>' : '') +
      (s ? ' · ' + esc(metrics(s.metrics)) : '') + '</div>' +
      ((c.reasons || []).length ? '<div class="sub">Why ranked: ' + esc((c.reasons || []).join('; ')) + '</div>' : '') +
      '</div><div><button type="button" class="cc-open yv-primary">Open</button></div></li>';
  }
  function list(items, empty) {
    return items && items.length ? '<ul class="cc-list">' + items.map(row).join('') + '</ul>' : '<p class="sub">' + esc(empty) + '</p>';
  }

  function adapters(d) {
    return '<details class="card"><summary><b>What the scanner reads</b> · last scan ' +
      esc(d.last_scan ? day(d.last_scan.created_at) + ' ' + d.last_scan.status : 'never') + '</summary><ul>' +
      (d.adapters || []).map(function (a) {
        return '<li><b>' + esc(a.label) + '</b>: ' + esc(ADAPTER[a.status] || a.status) +
          (a.last_run_at ? ' · last run ' + esc(day(a.last_run_at)) : '') + (a.last_error ? ' · ' + esc(a.last_error) : '') +
          (a.detail ? '<div class="sub">' + esc(a.detail) + '</div>' : '') + '</li>';
      }).join('') + '</ul>' +
      (d.last_scan && (d.last_scan.errors || []).length ? '<p class="sub">Last scan problems: ' + esc((d.last_scan.errors || []).map(function (x) { return x.message || x.kind; }).join('; ')) + '</p>' : '') +
      '</details>';
  }

  function peopleView(d) {
    var ppl = d.people || [];
    return '<div class="card"><h3>Add a person to watch</h3><p class="sub">Priority decides how widely the scanner looks for them, never a verdict.</p>' +
      '<p><input id="cc-p-name" maxlength="120" placeholder="Name"> <input id="cc-p-org" maxlength="120" placeholder="Organization"> ' +
      '<input id="cc-p-role" maxlength="120" placeholder="Role"> <input id="cc-p-aliases" maxlength="300" placeholder="Other names, comma separated"> ' +
      '<select id="cc-p-pri"><option value="1">Priority 1</option><option value="2" selected>Priority 2</option><option value="3">Priority 3</option></select> ' +
      '<button type="button" id="cc-p-add" class="yv-primary">Add</button></p></div>' +
      (ppl.length ? ppl.map(function (p) {
        return '<div class="card cc-person" data-person="' + esc(p.id) + '"><h3>' + esc(p.name) + ' <span class="sub">' + esc([p.organization, p.role].filter(Boolean).join(' · ')) + '</span></h3>' +
          '<p>' + (p.status === 'suggested' ? '<b>Suggested by the scanner</b> (' + esc(p.reason || '') + ') · <button type="button" class="cc-p-accept yv-primary">Watch</button> '
            : 'Watching · priority ' + esc(p.priority) + ' · ') +
          '<button type="button" class="cc-p-remove">Remove</button></p>' +
          '<p class="sub">' + num(p.sources) + ' appearances found · ' + num(p.claims_open) + ' open claims · ' + num(p.claims_published) + ' published fact-checks</p>' +
          ((p.recent || []).length ? '<div class="cc-strip">' + p.recent.map(function (s) {
            var u = safeUrl(s.url);
            return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" title="' + esc(s.title) + '">' + thumb(s) + '</a>';
          }).join('') + '</div>' : '<p class="sub">No appearances found yet.</p>') + '</div>';
      }).join('') : '<p class="sub">Nobody is on the watchlist.</p>');
  }

  function footageView(d) {
    var f = d.footage || [];
    return f.length ? '<ul class="cc-list">' + f.map(function (s) {
      var u = safeUrl(s.url);
      return '<li class="cc-row">' + thumb(s) + '<div class="cc-rowbody"><div><b>' + esc(s.publisher || '') + '</b> · ' + esc(day(s.published_at)) + '</div>' +
        '<div><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title || u) + '</a></div>' +
        '<div class="sub">' + esc(RIGHTS[s.rights] || s.rights) + ' · transcript: ' + esc(s.transcript_status === 'not_read' ? 'not read' : s.transcript_status) +
        ' · ' + esc(metrics(s.metrics)) + ' · ' + num(s.claims) + ' claims</div></div></li>';
    }).join('') + '</ul>' : '<p class="sub">No footage found yet. The library fills after the first scan.</p>';
  }

  function publishedView(d) {
    var a = d.analytics || {}, site = a.site, pub = d.published || [];
    var siteLine = site === 'not_collected' || !site ? 'Site visits: not collected.'
      : 'Site: ' + num(site.visitors) + ' first visits and ' + num(site.registrations) + ' registrations from claim-check links.';
    return '<div class="card"><h3>Production</h3><p>' + num(a.videos_discovered) + ' videos and ' + num(a.posts_discovered) + ' posts discovered · ' +
      num(a.claims_found) + ' claims found · ' + num(a.claims_researched) + ' researched · ' + num(a.published) + ' published · ' +
      num(a.rejected) + ' skipped or rejected · ' + num(a.corrections) + ' corrections' +
      (a.median_hours_found_to_approved != null ? ' · median ' + esc(a.median_hours_found_to_approved) + ' h from found to approved' : '') + '</p>' +
      '<p>Verdicts: ' + esc(Object.keys(a.verdicts || {}).map(function (k) { return (VERDICT[k] || k) + ' ' + a.verdicts[k]; }).join(' · ') || 'none yet') + '</p>' +
      '<p>' + esc(siteLine) + '</p>' +
      '<p class="sub">Not measured: ' + esc((a.unavailable || []).join(' ')) + '</p></div>' +
      (pub.length ? '<ul class="cc-list">' + pub.map(function (c) {
        var bc = (site && site.by_content) || {};
        var visits = bc[c.id] != null || bc[c.slug] != null ? (bc[c.id] || 0) + (bc[c.slug] || 0) : null;
        return '<li class="cc-row" data-claim="' + esc(c.id) + '">' + thumb(primary(c)) + '<div class="cc-rowbody"><div><b>' + esc(c.headline) + '</b></div>' +
          '<div class="sub">' + esc(VERDICT[c.verdict]) + ' · ' + esc(c.public_state) + ' · approved ' + esc(day(c.approved_at)) +
          ' · page <a href="/fact-checks/' + esc(c.slug) + '/" target="_blank" rel="noopener">/fact-checks/' + esc(c.slug) + '/</a>' +
          ' · Bluesky: ' + esc(c.bsky_status) + ' · ' + (visits == null ? 'no tagged visits yet' : num(visits) + ' first visits') + '</div></div>' +
          '<div><button type="button" class="cc-open">Open</button></div></li>';
      }).join('') + '</ul>' : '<p class="sub">Nothing published yet.</p>');
  }

  function evidenceList(items, title) {
    items = Array.isArray(items) ? items : [];
    return '<h4>' + esc(title) + ' (' + items.length + ')</h4>' + (items.length ? '<ul>' + items.map(function (e) {
      var u = safeUrl(e.url) || (/^http:\/\//.test(String(e.url || '')) ? String(e.url) : '');
      return '<li>' + esc(e.finding) + (u ? ' · <a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(e.title || u) + '</a>' : '') +
        (e.quote ? '<blockquote class="sub">“' + esc(e.quote) + '”</blockquote>' : '') + '</li>';
    }).join('') + '</ul>' : '<p class="sub">None found.</p>');
  }

  function clock(ts) { var d = ts ? new Date(ts) : null; return d && !isNaN(d) ? day(ts) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; }
  // What research is doing, read from the saved runs, so it is still shown after leaving and coming back.
  function researchLine(c) {
    var last = (c.runs || [])[0];
    if (c.research_active === 'queued') return '<p class="cc-research"><b>Research queued</b>' + (last ? ' (asked ' + esc(clock(last.created_at)) + ')' : '') + '. It takes a few minutes; this claim updates by itself.</p>';
    if (c.research_active === 'running') return '<p class="cc-research"><b>Research running</b>' + (last ? ' (asked ' + esc(clock(last.created_at)) + ')' : '') + '. It takes a few minutes; this claim updates by itself.</p>';
    if (last && last.status === 'failed' && c.status !== 'research_ready' && c.status !== 'approved')
      return '<p class="cc-research"><b>Last research did not finish</b> (' + esc(clock(last.finished_at || last.created_at)) + '): ' + esc(last.error || 'unknown error') + '</p>';
    return '';
  }

  function detailView(c) {
    var s = primary(c), emb = s && (s.rights === 'embed_only' || s.rights === 'reuse_authorized') ? embedUrl(s.embed_url) : '';
    var t = c.timestamp_s != null ? c.timestamp_s : null;
    var ready = c.status === 'research_ready', approved = c.status === 'approved', open = ['candidate', 'needs_research', 'researching'].indexOf(c.status) >= 0;
    var src = safeUrl(s && s.url);
    var post = c.post_text || '';
    return '<div class="card cc-detail" data-claim="' + esc(c.id) + '" data-version="' + esc(c.research_version) + '">' +
      '<p><button type="button" class="cc-back">← Back</button></p>' +
      '<div class="cc-two"><div>' +
      (emb ? '<iframe class="cc-embed" width="480" height="270" src="' + esc(emb + (t != null ? '?start=' + t : '')) + '" title="' + esc(s.title || 'Video') +
        '" allow="encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>' : thumb(s, true)) +
      (s ? '<p class="sub">' + esc(s.publisher || s.author || '') + (s.program ? ' · ' + esc(s.program) : '') + ' · ' + esc(day(s.published_at)) +
        ' · ' + esc(RIGHTS[s.rights] || s.rights) + (src ? ' · <a href="' + esc(src) + (t != null && s.platform === 'youtube' ? '&t=' + t + 's' : '') +
        '" target="_blank" rel="noopener noreferrer">Original source</a>' : '') + '</p>' : '<p class="sub">No source attached.</p>') +
      ((c.sources || []).length > 1 ? '<p class="sub">Also seen in ' + ((c.sources || []).length - 1) + ' other source(s).</p>' : '') +
      '</div><div>' +
      '<h3>' + esc(c.speaker_name || c.person_name || 'Speaker not identified') + '</h3>' +
      (c.quote ? '<blockquote class="cc-quote">“' + esc(c.quote) + '”</blockquote><p class="sub">' +
        (c.quote_verified ? 'Words found verbatim in <a href="' + esc(safeUrl(c.quote_source_url)) + '" target="_blank" rel="noopener noreferrer">this document</a>'
          : 'Quote NOT verified against a document') + (t != null ? ' · at ' + Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2) : '') + '</p>'
        : '<p>' + esc(c.topic) + '</p><p class="sub">No exact quote yet: research finds the words in a transcript or report.</p>') +
      (c.assertion ? '<p><b>Claim tested:</b> ' + esc(c.assertion) + '</p>' : '') +
      (c.context ? '<p class="sub">Context: ' + esc(c.context) + '</p>' : '') +
      (c.verdict ? '<p class="cc-verdict cc-v-' + esc(c.verdict) + '">Proposed verdict: <b>' + esc(VERDICT[c.verdict]) + '</b></p><p>' + esc(c.verdict_explanation) + '</p>'
        : '<p><b>No verdict.</b> ' + esc(STATUS[c.status] || c.status) + '. Popularity never sets a verdict.</p>') +
      '</div></div>' +
      (c.verdict ? evidenceList(c.evidence && c.evidence.contradicting, 'Evidence contradicting the claim') +
        evidenceList(c.evidence && c.evidence.supporting, 'Evidence supporting the claim') +
        (c.evidence_gaps ? '<p class="sub">Gaps: ' + esc(c.evidence_gaps) + '</p>' : '') : '') +
      (ready || approved ? '<h4>Headline</h4><input id="cc-headline" maxlength="160" style="width:100%" value="' + esc(c.headline || '') + '">' +
        '<h4>Bluesky post <span class="sub" id="cc-count">' + graphemes(post) + ' / 300</span></h4>' +
        '<textarea id="cc-post" rows="4" style="width:100%" maxlength="600">' + esc(post) + '</textarea>' +
        '<h4>Preview</h4><div class="cc-preview"><div><b>JODY Tracks</b> <span class="sub">@homesignal-tracker.bsky.social</span></div>' +
        '<div id="cc-preview-text">' + esc(post) + '</div>' + (s ? thumb(s, true) : '') +
        '<div class="sub">Link: jodytracks.com/fact-checks/' + esc(c.slug || '(set on approval)') + '/</div></div>' +
        '<p class="sub">Public page: /fact-checks/' + esc(c.slug || '(set on approval)') + '/ goes live on the next site build after approval.' +
        '</p>' + bskyLine(c) : '') +
      researchLine(c) +
      (state.msg ? '<p class="cc-msg" role="alert">' + esc(state.msg) + '</p>' : '') +   // beside the buttons, so a refusal is seen
      '<p class="cc-actions">' +
      (ready ? '<button type="button" class="cc-act yv-primary" data-act="approve">Approve</button> ' : '') +
      (ready || approved ? '<button type="button" class="cc-act" data-act="edit">Save edits</button> ' : '') +
      (approved && (c.bsky_status === 'none' || c.bsky_status === 'failed') && c.public_state !== 'retracted' ? '<button type="button" class="cc-act" data-act="schedule">Schedule on Bluesky</button> ' : '') +
      (c.bsky_status === 'scheduled' ? '<button type="button" class="cc-act" data-act="unschedule">Take off the schedule</button> ' : '') +
      (c.public_state === 'none' && c.status !== 'rejected' && !c.research_active ? '<button type="button" class="cc-act" data-act="request_research">Request research</button> ' : '') +
      (c.public_state === 'none' && (open || ready) ? '<button type="button" class="cc-act" data-act="skip">Skip</button> <button type="button" class="cc-act" data-act="reject">Reject</button> ' : '') +
      (c.status === 'skipped' || c.status === 'rejected' ? '<button type="button" class="cc-act" data-act="restore">Restore</button> ' : '') +
      (c.public_state !== 'none' ? '<button type="button" class="cc-act" data-act="correct">Publish correction</button> <button type="button" class="cc-act" data-act="retract">Retract</button> ' : '') +
      '<br><input id="cc-note" maxlength="1000" style="width:100%" placeholder="Note: what to research, why rejected, or the correction readers will see"></p>' +
      ((c.decisions || []).length || (c.runs || []).length ? '<details><summary>History</summary><ul>' +
        (c.runs || []).map(function (r) { return '<li>Research ' + esc(r.status) + ' · ' + esc(day(r.created_at)) + (r.note ? ' · ' + esc(r.note) : '') + (r.error ? ' · ' + esc(r.error) : '') + '</li>'; }).join('') +
        (c.decisions || []).map(function (x) { return '<li>' + esc(x.action) + ' by ' + esc(x.actor) + ' · ' + esc(day(x.created_at)) + (x.note ? ' · ' + esc(x.note) : '') + '</li>'; }).join('') +
        '</ul></details>' : '') +
      '</div>';
  }

  // Claim Check posts share the MAPS and video times (founder, 2026-10-30); the database picks the time.
  function bskyLine(c) {
    var when = c.scheduled_slot ? new Date(c.scheduled_slot) : null;
    var t = when && !isNaN(when.getTime()) ? when.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Pacific' : '';
    var kind = c.bsky_slot_kind === 'maps' ? 'a MAPS time' : c.bsky_slot_kind === 'video' ? 'a video time' : '';
    var uri = /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[a-z0-9]+$/.test(String(c.bsky_uri || '')) ? String(c.bsky_uri) : '';
    var web = uri ? 'https://bsky.app/profile/' + uri.split('/')[2] + '/post/' + uri.split('/').pop() : '';
    if (c.bsky_status === 'scheduled') return '<p><b>Bluesky:</b> scheduled for ' + esc(t) + ' (' + esc(kind) + ').</p>';
    if (c.bsky_status === 'publishing') return '<p><b>Bluesky:</b> posting now.</p>';
    if (c.bsky_status === 'published') return '<p><b>Bluesky:</b> posted ' + esc(day(c.published_at)) + (web ? ' · <a href="' + esc(web) + '" target="_blank" rel="noopener noreferrer">view post</a>' : '') + '</p>';
    if (c.bsky_status === 'failed') return '<p><b>Bluesky:</b> could not post (' + esc(c.bsky_error || 'unknown error') + '). Schedule it again to retry.</p>';
    return '<p class="sub">Bluesky: not scheduled. Scheduling takes the next free MAPS or video time; no time is added.</p>';
  }

  function paint() {
    var d = state.data, el = state.el;
    if (!el) return;
    if (!d) { el.innerHTML = '<p class="sub">' + esc(state.msg || 'Loading…') + '</p>'; return; }
    var counts = d.counts || {};
    var head = '<div class="card"><h3>Data Center Claim Check</h3><p class="sub">What people say about data centers, against what the records show. ' +
      'Discovered nationwide; no region is ranked higher. Nothing is published without your approval.</p>' +
      '<p><button type="button" id="cc-scan" class="yv-primary">Scan now</button> <span class="sub">' + num(counts.research_ready) + ' ready for review · ' +
      num(counts.candidate) + ' not researched · ' + num(counts.approved) + ' approved</span></p>' +
      (state.msg ? '<p class="cc-msg">' + esc(state.msg) + '</p>' : '') + '</div>' + adapters(d) +
      '<nav class="cc-views">' + VIEWS.map(function (v) {
        return '<button type="button" class="cc-view' + (state.view === v[0] ? ' active' : '') + '" data-view="' + v[0] + '">' + esc(v[1]) + '</button>';
      }).join(' ') + '</nav>';
    var body;
    watchResearch();
    if (state.detail) body = detailView(state.detail);
    else if (state.view === 'trending') body = list(d.trending, 'No trending claims yet.');
    else if (state.view === 'emerging') body = list(d.emerging, 'No emerging claims yet.');
    else if (state.view === 'people') body = peopleView(d);
    else if (state.view === 'footage') body = footageView(d);
    else if (state.view === 'review') body = list(d.review, 'Nothing is waiting for review. Request research on a claim to fill this list.');
    else body = publishedView(d);
    el.innerHTML = head + body;
  }

  function refresh(msg) {
    return rpc('hs_claim_check_overview').then(function (d) { state.data = d; state.msg = msg || ''; paint(); })
      .catch(function (e) { state.msg = friendly(e); paint(); });
  }
  function openClaim(id) {
    return rpc('hs_claim_check_claim', { p_claim: id }).then(function (c) { state.detail = c; state.msg = ''; paint(); })
      .catch(function (e) { state.msg = friendly(e); paint(); });
  }
  // While a claim's research is queued or running, read it again every 30 s so the result shows without a reload.
  var POLL_MS = 30000;
  function watchResearch() {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    var c = state.detail;
    if (!c || !c.research_active) return;
    var id = c.id;
    state.timer = setTimeout(function () {
      state.timer = null;
      if (!state.detail || state.detail.id !== id || !state.el || !state.el.isConnected) return;
      var keep = state.msg;
      rpc('hs_claim_check_claim', { p_claim: id }).then(function (n) {
        if (!state.detail || state.detail.id !== id) return;
        state.detail = n; state.msg = n.research_active ? keep : ''; paint();
        if (!n.research_active) refresh();
      }).catch(function () { watchResearch(); });
    }, POLL_MS);
  }

  function onClick(ev) {
    var t = ev.target, el = state.el;
    if (!t || !el.contains(t)) return;
    if (t.classList.contains('cc-view')) { state.view = t.getAttribute('data-view'); state.detail = null; state.msg = ''; paint(); return; }
    if (t.classList.contains('cc-open')) { var li = t.closest('[data-claim]'); if (li) openClaim(li.getAttribute('data-claim')); return; }
    if (t.classList.contains('cc-back')) { state.detail = null; paint(); return; }
    if (t.id === 'cc-scan') {
      t.disabled = true;
      rpc('hs_claim_check_scan_now').then(function (r) {
        var s = r && r.scan;
        refresh(r && r.existing ? 'A scan is already running.' : s && s.status === 'failed' ? 'The scan could not start: ' + ((s.errors || [])[0] || {}).message : 'Scan started. Results appear here in a few minutes.');
      }).catch(function (e) { state.msg = friendly(e); paint(); });
      return;
    }
    if (t.id === 'cc-p-add') {
      var g = function (id) { var x = el.querySelector('#' + id); return x ? x.value : ''; };
      rpc('hs_claim_check_person_save', { p: { name: g('cc-p-name'), organization: g('cc-p-org'), role: g('cc-p-role'), priority: g('cc-p-pri'),
        aliases: g('cc-p-aliases').split(',').map(function (x) { return x.trim(); }).filter(Boolean) } })
        .then(function () { refresh('Added.'); }).catch(function (e) { state.msg = friendly(e); paint(); });
      return;
    }
    var person = t.closest && t.closest('.cc-person');
    if (person && t.classList.contains('cc-p-remove')) {
      rpc('hs_claim_check_person_status', { p_person: person.getAttribute('data-person'), p_status: 'removed' }).then(function () { refresh('Removed.'); })
        .catch(function (e) { state.msg = friendly(e); paint(); });
      return;
    }
    if (person && t.classList.contains('cc-p-accept')) {
      var p = (state.data.people || []).filter(function (x) { return x.id === person.getAttribute('data-person'); })[0];
      rpc('hs_claim_check_person_save', { p: { id: p.id, name: p.name, organization: p.organization, role: p.role, priority: String(p.priority || 2), aliases: p.aliases || [] } })
        .then(function () { refresh('Now watching ' + p.name + '.'); }).catch(function (e) { state.msg = friendly(e); paint(); });
      return;
    }
    if (t.classList.contains('cc-act')) {
      var box = t.closest('.cc-detail'), act = t.getAttribute('data-act');
      var note = (el.querySelector('#cc-note') || {}).value || '';
      // Request research with no note means "research this claim" (the database needs a note; an empty box is not a refusal).
      if (act === 'request_research' && !note.trim()) note = RESEARCH_DEFAULT_NOTE;
      var edits = null;
      if (act === 'edit' || act === 'approve') {
        var h = el.querySelector('#cc-headline'), pt = el.querySelector('#cc-post');
        if (h && pt && (h.value !== (state.detail.headline || '') || pt.value !== (state.detail.post_text || ''))) edits = { headline: h.value, post_text: pt.value };
      }
      var version = Number(box.getAttribute('data-version'));
      var go = function () {
        return rpc('hs_claim_check_decide', { p_claim: box.getAttribute('data-claim'), p_action: act, p_note: note || null, p_edits: null, p_expected_version: version });
      };
      var chain = edits ? rpc('hs_claim_check_decide', { p_claim: box.getAttribute('data-claim'), p_action: 'edit', p_note: null, p_edits: edits, p_expected_version: version }) : Promise.resolve(null);
      t.disabled = true;
      chain.then(function (r) { return act === 'edit' ? r : go(); })
        .then(function (c) { if (c) state.detail = c; return refresh(act === 'approve' ? 'Approved. The public page goes live on the next site build.'
          : act === 'schedule' ? 'Scheduled on the next free MAPS or video time.'
          : act === 'request_research' ? 'Research started. It takes a few minutes; the result appears on this claim.' : 'Saved.'); })
        .catch(function (e) { state.msg = friendly(e); t.disabled = false; paint(); });
    }
  }
  function onInput(ev) {
    if (ev.target && ev.target.id === 'cc-post') {
      var c = state.el.querySelector('#cc-count'), p = state.el.querySelector('#cc-preview-text');
      var n = graphemes(ev.target.value);
      if (c) { c.textContent = n + ' / 300'; c.style.color = n > 300 ? '#b42318' : ''; }
      if (p) p.textContent = ev.target.value;
    }
  }

  function load(client, el) {
    if (!client || !el) return;
    state.client = client;
    if (state.el !== el) {
      state.el = el;
      el.addEventListener('click', onClick);
      el.addEventListener('input', onInput);
      var st = document.createElement('style');
      st.textContent = '.cc-list{list-style:none;padding:0}.cc-row{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line,#e5e7eb)}' +
        '.cc-rowbody{flex:1}.cc-thumb{border-radius:6px;object-fit:cover;flex:none;background:#eef0ee}.cc-nothumb{display:flex;align-items:center;justify-content:center;font-size:11px;color:#667;text-align:center;border:1px dashed #aab}' +
        '.cc-views{margin:10px 0}.cc-view.active{font-weight:700;text-decoration:underline}.cc-two{display:flex;gap:16px;flex-wrap:wrap}.cc-two>div{flex:1;min-width:280px}' +
        '.cc-embed{max-width:100%;border:0;border-radius:8px}.cc-quote{font-size:18px;margin:8px 0;border-left:4px solid #157a49;padding-left:10px}' +
        '.cc-verdict{font-size:16px}.cc-v-false,.cc-v-misleading{color:#b42318}.cc-v-accurate{color:#157a49}.cc-preview{border:1px solid var(--line,#ddd);border-radius:10px;padding:10px;max-width:520px}' +
        '.cc-strip{display:flex;gap:8px;flex-wrap:wrap}.cc-msg{font-weight:600}.cc-research{background:#f3f7f4;border-left:4px solid #157a49;padding:6px 10px}';
      el.parentNode.insertBefore(st, el);
    }
    if (!state.data) paint();
    refresh();
  }

  HS.acqClaimCheck = { load: load, _test: { esc: esc, thumbUrl: thumbUrl, embedUrl: embedUrl, graphemes: graphemes, detailView: detailView, row: row, researchLine: researchLine } };
})();
