/* Acquisition Dashboard Tab 17 — "Engage on Bluesky" (2026-10-28), beside Hot Topics.
 *
 * The strongest original Bluesky posts in the discovered Hot Topics, each scored on ITS OWN replies, reposts, likes and age
 * (the Engagement Opportunity Score, separate from the topic score), with a recommendation (REPLY, QUOTE-POST or SKIP) and a
 * draft within 300 characters. The scoring and the drafts come from homesignal-ingest impact/engage; this page decides
 * nothing and POSTS NOTHING: the founder copies a draft, posts it by hand in Bluesky, then marks it posted.
 *
 * Separate from the Impact Stories video pipeline: it reads and writes only through hs_impact_engagement_overview and
 * hs_impact_engagement_decide (docs/impact-engagement.sql). Every value from the database or Bluesky is escaped; a link is
 * shown only when it is https.
 */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  var TOP = 5, PER_TOPIC_IN_TOP = 2, LIMIT = 300;
  var ACTION = { REPLY: ['REPLY', 'ok'], QUOTE: ['QUOTE-POST', 'emo'], SKIP: ['SKIP', 'bad'] };
  var BASIS = { verified_records: ['States only verified records', 'ok'], questions_only: ['Questions only — makes no claim', 'wait'],
    unverified_topic: ['Topic unverified — a question only', 'bad'] };
  var PARTS = [['conversation', 'Conversation', 30], ['recency', 'Recency', 20], ['velocity', 'Engagement velocity', 20],
    ['relevance', 'Audience relevance', 15], ['contribution', 'What JODY can add', 15]];

  var E = { client: null, el: null, data: null, err: null, msg: null, more: false, edits: {}, preview: {}, posting: {}, score: {}, loading: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safe(u) { return /^https:\/\//i.test(String(u || '')) ? esc(u) : null; }
  function link(u, text) { var h = safe(u); return h ? '<a href="' + h + '" target="_blank" rel="noopener noreferrer">' + esc(text || u) + '</a>' : esc(text || ''); }
  function n(v) { return v == null ? '—' : Number(v).toLocaleString('en-US'); }
  function when(v) {
    var d = new Date(v); if (!v || isNaN(d)) return '';
    return d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT';
  }
  function badge(pair) { return pair ? '<span class="is-badge ' + pair[1] + '">' + esc(pair[0]) + '</span>' : ''; }
  // Bluesky counts graphemes; count them the same way (code points where Intl.Segmenter is missing, never fewer)
  function graphemes(s) {
    s = String(s || '');
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)).length;
    return Array.from(s).length;
  }
  function errText(e) { return (e && (e.message || e.details)) || 'Something went wrong. Nothing was changed.'; }
  function rpc(name, args) { return E.client.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function note(id, kind) { rpc('hs_impact_engagement_decide', { p_id: id, p_action: kind }).catch(function () { /* recording a click is best effort */ }); }

  function load() {
    if (E.loading) return Promise.resolve();
    E.loading = true;
    return rpc('hs_impact_engagement_overview').then(function (d) { E.data = d; E.err = null; }, function (e) { E.err = errText(e); })
      .then(function () { E.loading = false; render(); });
  }

  // The strongest five first, at most two from one topic, so one loud topic does not fill the list. The rest follow.
  function ranked(list) {
    var top = [], rest = [], per = {};
    list.forEach(function (o) {
      var k = o.candidate_id || o.key;
      if (top.length < TOP && o.action !== 'SKIP' && (per[k] || 0) < PER_TOPIC_IN_TOP) { top.push(o); per[k] = (per[k] || 0) + 1; } else rest.push(o);
    });
    return { top: top, rest: rest };
  }

  function text(o) { return E.edits[o.id] != null ? E.edits[o.id] : ((o.draft && o.draft.text) || ''); }

  function breakdown(o) {
    var p = o.score_parts || {};
    return '<table class="is-tab" aria-label="Engagement Opportunity Score">' + PARTS.map(function (x) {
      return '<tr><td>' + esc(x[1]) + '</td><td>' + n(p[x[0]]) + ' / ' + x[2] + '</td></tr>';
    }).join('') + '<tr><td>Velocity</td><td>' + n(p.velocity_per_hour) + ' interactions / hour</td></tr>' +
      '<tr><th>Total</th><th>' + n(o.score) + ' / 100</th></tr></table>';
  }

  function preview(o, t) {
    var who = esc(o.display_name || o.author || 'post');
    var orig = '<div class="ie-orig"><b>' + who + '</b> <span class="is-muted">@' + esc(o.author) + '</span><div>' + esc(o.post_text) + '</div></div>';
    if (o.action === 'QUOTE') return '<div class="ie-prev" aria-label="Preview"><b>JODY TRACKS</b><div class="ie-text">' + esc(t) + '</div>' + orig + '</div>';
    return '<div class="ie-prev" aria-label="Preview">' + orig + '<div class="is-muted" style="margin:6px 0">Replying to @' + esc(o.author) +
      '</div><b>JODY TRACKS</b><div class="ie-text">' + esc(t) + '</div></div>';
  }

  function card(o, idx) {
    var t = text(o), g = graphemes(t), d = o.draft || {}, edited = E.edits[o.id] != null && E.edits[o.id] !== d.text;
    var hasLink = /jodytracks\.com/i.test(t), hasTag = /#JODYTracks/i.test(t);
    var facts = (d.facts_used || []);
    return '<article class="is-card" aria-label="Engagement opportunity ' + (idx + 1) + '">' +
      '<div class="is-head"><div style="min-width:0">' + badge(ACTION[o.action]) + ' <b>' + esc(o.topic_title || 'Hot Topic') + '</b>' +
      (o.topic_place ? ' <span class="is-muted">· ' + esc(o.topic_place) + '</span>' : '') + '</div>' +
      '<div style="text-align:right"><div class="is-score">' + n(o.score) + '</div><div class="is-muted">engagement score</div></div></div>' +
      '<ul class="is-list">' + (o.reasons || []).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
      '<div class="ie-orig"><div><b>' + esc(o.display_name || o.author) + '</b> <span class="is-muted">@' + esc(o.author) + ' · ' + esc(when(o.post_created_at)) + '</span></div>' +
      '<div>' + esc(o.post_text) + '</div>' +
      '<div class="is-muted" aria-label="This post\'s own engagement">This post: ' + n(o.replies) + ' replies · ' + n(o.reposts) + ' reposts · ' + n(o.likes) + ' likes · ' + n(o.quotes) + ' quotes' +
      (o.reply_disabled ? ' · replies off' : '') + (o.embedding_disabled ? ' · quotes off' : '') + '</div>' +
      '<div>' + link(o.target_url, 'Source: ' + o.target_url) + '</div></div>' +
      (o.action === 'SKIP' ? '<p class="is-muted">No draft: this post is not worth a response.</p>' :
        '<label class="is-muted" for="ie-t-' + esc(o.id) + '">Draft (edit before copying)</label>' +
        '<textarea class="is-in ie-draft" id="ie-t-' + esc(o.id) + '" data-ie="edit" data-id="' + esc(o.id) + '" rows="4">' + esc(t) + '</textarea>' +
        '<div class="is-row"><span class="is-badge ' + (g > LIMIT ? 'bad' : 'ok') + '" aria-live="polite">' + g + ' / ' + LIMIT + '</span>' +
        badge(BASIS[d.basis]) + (hasLink ? '<span class="is-badge wait">JodyTracks.com link</span>' : '') +
        (hasTag ? '<span class="is-badge wait">#JODYTracks</span>' : '') + (edited ? '<span class="is-badge wait">edited</span>' : '') + '</div>' +
        (g > LIMIT ? '<div class="is-block" role="alert">Over Bluesky\'s 300-character limit. Shorten it before posting.</div>' : '') +
        (facts.length ? '<p class="is-muted">Facts used: ' + facts.map(function (f) {
          return link(f.url, f.party ? f.party + (f.role ? ' (' + f.role + ')' : '') : (f.source || 'record'));
        }).join(', ') + '</p>' : '')) +
      '<div class="is-row" style="margin-top:8px">' +
      (o.action === 'SKIP' ? '' : '<button class="is-btn" data-ie="preview" data-id="' + esc(o.id) + '" aria-expanded="' + !!E.preview[o.id] + '">Preview</button>' +
        '<button class="is-btn primary" data-ie="copy" data-id="' + esc(o.id) + '"' + (g > LIMIT ? ' disabled' : '') + '>Copy</button>') +
      (safe(o.target_url) ? '<a class="is-btn" data-ie="open" data-id="' + esc(o.id) + '" href="' + safe(o.target_url) + '" target="_blank" rel="noopener noreferrer">Open Original</a>' : '') +
      '<button class="is-btn" data-ie="post-form" data-id="' + esc(o.id) + '" aria-expanded="' + !!E.posting[o.id] + '">Mark Posted</button>' +
      '<button class="is-btn" data-ie="skip" data-id="' + esc(o.id) + '">Skip</button>' +
      '<button class="is-btn" data-ie="score" data-id="' + esc(o.id) + '" aria-expanded="' + !!E.score[o.id] + '">Score</button></div>' +
      (E.posting[o.id] ? '<div class="is-panel" style="margin-top:8px"><label class="is-muted" for="ie-u-' + esc(o.id) + '">Link to your post (optional; found automatically on the next scan if left empty)</label>' +
        '<input class="is-in" id="ie-u-' + esc(o.id) + '" placeholder="https://bsky.app/profile/…/post/…">' +
        '<div class="is-row" style="margin-top:6px"><button class="is-btn primary" data-ie="posted" data-id="' + esc(o.id) + '">Confirm: I posted it</button></div></div>' : '') +
      (E.preview[o.id] && o.action !== 'SKIP' ? preview(o, t) : '') +
      (E.score[o.id] ? '<div class="is-sec">' + breakdown(o) + '</div>' : '') + '</article>';
  }

  function postedRow(o) {
    var r = o.result;
    return '<tr><td>' + badge(ACTION[o.posted_action] || ACTION.REPLY) + ' ' + esc(o.topic_title || '') + '<div class="is-muted">' + esc(o.posted_text || '') + '</div></td>' +
      '<td>' + esc(when(o.posted_at)) + (o.status === 'already_engaged' ? '<div class="is-muted">found on the account</div>' : '') + '</td>' +
      '<td>' + (o.posted_url ? link(o.posted_url, 'Your post') : '<span class="is-muted">' + (o.tracked ? 'tracked' : 'not found yet') + '</span>') + ' · ' + link(o.target_url, 'original') + '</td>' +
      '<td>' + (r ? n(r.replies) + ' replies · ' + n(r.reposts) + ' reposts · ' + n(r.likes) + ' likes' : '<span class="is-muted">not read yet</span>') + '</td>' +
      '<td>' + n(o.visits) + '</td><td>' + n(o.registrations) + '</td></tr>';
  }

  function render() {
    if (!E.el) return;
    var head = '<div class="card"><h3>Engage on Bluesky</h3><p class="sub">The strongest posts to answer in the Hot Topics above, scored on each post\'s own replies, reposts, likes and age. ' +
      'Nothing is posted automatically: copy a draft, post it yourself in Bluesky, then press Mark Posted. Drafts state only verified records; otherwise they ask.</p>';
    if (E.err && !E.data) { E.el.innerHTML = head + '<div class="is-block" role="alert">Engage on Bluesky could not load: ' + esc(E.err) + '</div><button class="is-btn" data-ie="reload">Try again</button></div>'; return; }
    if (!E.data) { E.el.innerHTML = head + '<p class="is-muted">Loading…</p></div>'; return; }
    var d = E.data, run = d.last_run, r = ranked(d.suggested || []), posted = d.posted || [], skipped = d.skipped || [];
    var focus = document.activeElement && E.el.contains(document.activeElement) ? document.activeElement.id : null;
    var caret = focus && document.activeElement.selectionStart;
    E.el.innerHTML = head +
      (run && run.status === 'failed' ? '<div class="is-block" role="alert"><b>The latest scan could not finish this step</b> (' + esc(when(run.at)) + '): ' + esc(run.error) +
        '. The list below is from the last scan that did.</div>' : '') +
      (run && run.status === 'ok' ? '<p class="is-muted">Updated by the scan of ' + esc(when(run.at)) + '.</p>' : (!run ? '<p class="is-muted">No scan has produced engagement suggestions yet.</p>' : '')) +
      (E.msg ? '<div class="' + (E.msg.bad ? 'is-block' : 'is-okbox') + '" role="status">' + esc(E.msg.text) + '</div>' : '') +
      (r.top.length ? '<h4>Strongest ' + r.top.length + '</h4><div class="is-cards">' + r.top.map(card).join('') + '</div>'
        : '<p class="is-muted">No post is worth answering right now.</p>') +
      (r.rest.length ? '<div class="is-row" style="margin:8px 0"><button class="is-btn" data-ie="more" aria-expanded="' + E.more + '">' +
        (E.more ? 'Hide the other ' : 'Show ') + r.rest.length + ' more</button></div>' +
        (E.more ? '<div class="is-cards">' + r.rest.map(function (o, i) { return card(o, TOP + i); }).join('') + '</div>' : '') : '') +
      '<details class="is-sec" id="ie-posted"' + (posted.length ? ' open' : '') + '><summary><b>Posted (' + posted.length + ')</b></summary>' +
      (d.attribution_error ? '<p class="is-muted">' + esc(d.attribution_error) + '</p>' : '') +
      (posted.length ? '<table class="is-tab"><tr><th>Post</th><th>When</th><th>Links</th><th>Result on Bluesky</th><th>Visits</th><th>Registrations</th></tr>' +
        posted.map(postedRow).join('') + '</table><p class="is-muted">Visits and registrations count only people who arrived through that draft\'s own JodyTracks.com link.</p>'
        : '<p class="is-muted">Nothing posted yet.</p>') + '</details>' +
      (skipped.length ? '<details class="is-sec"><summary><b>Skipped (' + skipped.length + ')</b></summary><ul class="is-list">' + skipped.map(function (o) {
        return '<li>' + esc(o.topic_title || '') + ' · @' + esc(o.author) + (o.decision_note ? ' · ' + esc(o.decision_note) : '') +
          ' <button class="is-btn" data-ie="restore" data-id="' + esc(o.id) + '">Restore</button></li>';
      }).join('') + '</ul></details>' : '') + '</div>';
    if (focus) { var f = E.el.querySelector('#' + CSS.escape(focus)); if (f) { f.focus(); try { f.setSelectionRange(caret, caret); } catch (e) { /* not text */ } } }
    E.msg = null;
  }

  function find(id) {
    var d = E.data || {};
    return (d.suggested || []).concat(d.posted || [], d.skipped || []).filter(function (o) { return o.id === id; })[0];
  }

  function copy(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    var ok = document.execCommand && document.execCommand('copy'); document.body.removeChild(ta);
    return ok ? Promise.resolve() : Promise.reject(new Error('Copy is not available in this browser. Select the draft and copy it.'));
  }

  function decide(id, action, extra) {
    return rpc('hs_impact_engagement_decide', Object.assign({ p_id: id, p_action: action }, extra || {}))
      .then(function () { return load(); }, function (e) { E.msg = { bad: true, text: errText(e) }; render(); });
  }

  function onClick(ev) {
    var t = ev.target.closest('[data-ie]'); if (!t || !E.el.contains(t)) return;
    var a = t.getAttribute('data-ie'), id = t.getAttribute('data-id'), o = id ? find(id) : null;
    if (a === 'reload') return load();
    if (a === 'more') { E.more = !E.more; return render(); }
    if (a === 'preview') { E.preview[id] = !E.preview[id]; if (E.preview[id]) note(id, 'previewed'); return render(); }
    if (a === 'score') { E.score[id] = !E.score[id]; return render(); }
    if (a === 'open') { note(id, 'opened'); return; }             // the link itself opens the post
    if (a === 'post-form') { E.posting[id] = !E.posting[id]; return render(); }
    if (!o) return;
    if (a === 'copy') {
      var txt = text(o);
      if (graphemes(txt) > LIMIT) { E.msg = { bad: true, text: 'Over 300 characters. Shorten it first.' }; return render(); }
      return copy(txt).then(function () { note(id, 'copied'); E.msg = { text: 'Copied. Open the original post, paste, and post it yourself. Then press Mark Posted.' }; render(); },
        function (e) { E.msg = { bad: true, text: errText(e) }; render(); });
    }
    if (a === 'posted') {
      var u = (E.el.querySelector('#ie-u-' + CSS.escape(id)) || {}).value || '';
      var posted = text(o);
      if (posted && graphemes(posted) > LIMIT) { E.msg = { bad: true, text: 'The draft is over 300 characters, so it cannot be what you posted. Fix it first.' }; return render(); }
      E.posting[id] = false;
      return decide(id, 'mark_posted', { p_posted_url: u.trim() || null, p_text: posted || null }).then(function () { delete E.edits[id]; });
    }
    if (a === 'skip') {
      var why = window.prompt('Skip this post? Optionally say why (kept with the decision).', '');
      if (why === null) return;
      return decide(id, 'skip', { p_note: why || null });
    }
    if (a === 'restore') return decide(id, 'restore');
  }

  function onInput(ev) {
    var t = ev.target; if (!t || t.getAttribute('data-ie') !== 'edit') return;
    E.edits[t.getAttribute('data-id')] = t.value;
    // update the counter without rebuilding the card (keeps the cursor)
    var card = t.closest('.is-card'), b = card && card.querySelector('[aria-live="polite"]'), g = graphemes(t.value);
    if (b) { b.textContent = g + ' / ' + LIMIT; b.className = 'is-badge ' + (g > LIMIT ? 'bad' : 'ok'); }
    var c = card && card.querySelector('[data-ie="copy"]'); if (c) c.disabled = g > LIMIT;
  }

  HS.acqImpactEngagement = {
    attach: function (client, container) {
      if (!client || !container) return;
      E.client = client; E.el = container;
      container.addEventListener('click', onClick);
      container.addEventListener('input', onInput);
      render();
      return E.data ? Promise.resolve() : load();
    },
    reload: load, _state: E, _render: render, _graphemes: graphemes, _ranked: ranked
  };
})();
