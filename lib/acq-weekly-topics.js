/* Jody Acquisition Dashboard, Tab 20 · Weekly Report — TOPIC QUEUE AND RESEARCH HANDOFF.

   Keeps story leads and public coverage promises from getting lost between a social post and the research for a
   video: capture a topic -> assign it to a report edition -> prepare its research request -> record what happened to
   it in that edition -> record OUR published video.

   Two ways in:
     HS.acqWeeklyTopics.load(client, el)   the QUEUE-ONLY entry point Tab 20 uses (acquisition.html). Research
                                           processing is NOT available there: a research request is prepared and can be
                                           copied, and nothing is submitted, saved as an answer, or queued.
     HS.acqWeeklyTopics.mount(client, el, opts)   used by lib/acq-weekly-slice.js (the editorial workbench, not on any
                                           page yet) with researchProcessing: true, which adds the paste-and-process step.

   It reads and writes only through the admin functions in docs/weekly-2-topic-queue.sql (and, with the workbench,
   hs_weekly_paste_answer and hs_weekly_edition_link_version). It holds no key, fetches nothing, starts no job, keeps
   nothing in the browser, and posts nowhere. Every status is the one the database derived; this file decides none.

   Kept apart on purpose:
     a lead            what someone captured. Not evidence.
     promised publicly true only when the PUBLISHED post's address is recorded. Wording alone is a draft.
                       It records that a promise was made; it does not show the story is true.
     request prepared / research submitted for processing   two different facts. Preparing or copying a request
                       never makes a topic "Researching".
     researched / included / published   three different facts. Published means OUR video's address and date.
   Every value is escaped. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});

  var STATUS = { captured: 'Captured', queued_for_research: 'Queued for research', researching: 'Researching',
    ready_for_editorial_review: 'Ready for editorial review', included: 'Included in report', published: 'Published',
    deferred: 'Deferred', dropped: 'Dropped' };
  var VIEWS = [['inbox', 'Inbox / unassigned'], ['promised', 'Promised publicly'], ['edition', 'Assigned to this edition'],
    ['research', 'Research in progress'], ['deferred', 'Deferred / carry forward'], ['published', 'Published'], ['all', 'All topics']];
  var PREPARED = 'Research request prepared';   // shown instead of "Queued for research" while processing is unavailable
  var UNAVAILABLE = 'Unavailable in this release: research processing is not deployed, so an answer cannot be saved or checked here yet. ' +
    'Nothing has been submitted. Keep Perplexity’s answer yourself until this is switched on.';
  var FIELDS = ['title', 'topic', 'location', 'source_urls', 'social_post_url', 'notes', 'why_it_matters', 'questions',
    'intended_edition_id', 'intended_date', 'commitment_wording', 'commitment_post_url'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) { return /^https?:\/\/[^\s]+$/i.test(String(u || '')) ? String(u) : ''; }
  function link(u) { var s = safeUrl(u); return s ? '<a href="' + esc(s) + '" target="_blank" rel="noopener noreferrer">' + esc(s) + '</a>' : esc(u); }
  function lines(v) { return String(v || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function short(id) { return String(id || '').slice(0, 8); }

  var S = null;
  function q(sel) { return S.el.querySelector(sel); }
  function val(sel) { var n = q(sel); return n ? String(n.value || '').trim() : ''; }

  function rpc(name, args) {
    return S.client.rpc(name, args).then(function (r) {
      if (r && r.error) throw new Error(r.error.message || 'the request failed');
      return r ? r.data : null;
    });
  }
  function reload() {
    return rpc('hs_weekly_topic_queue', { p_edition: S.edition || null }).then(function (o) { S.q = o || {}; render(); },
      function (e) { S.err = e.message; render(); });
  }
  // One action at a time. A failure shows the reason and never a success message; what the screen then shows is
  // re-read from the database, so a failed handoff cannot look transferred.
  function act(p, okMessage) {
    S.busy = true; S.err = ''; S.msg = ''; render();
    return p.then(function (r) { S.busy = false; S.msg = typeof okMessage === 'function' ? okMessage(r) : (okMessage || ''); return reload(); },
      function (e) { S.busy = false; S.msg = ''; S.err = e.message; return reload(); });
  }

  // Research processing (saving a pasted answer and checking its sources) needs the workbench SQL AND the
  // homesignal-ingest workflows. The page that mounts this says whether it is operational; the default is that it is not.
  function processing() { return S.opts.researchProcessing === true; }
  function caps() { return (S.q && S.q.capabilities) || {}; }
  function canLink() { return caps().version_linking === true && typeof S.opts.versions === 'function'; }
  function statusLabel(st) { return !processing() && st === 'queued_for_research' ? PREPARED : (STATUS[st] || st); }
  function leads() { return (S.q && S.q.leads) || []; }
  function editions() { return (S.q && S.q.editions) || []; }
  function editionById(id) { return editions().filter(function (e) { return e.id === id; })[0]; }
  function leadById(id) { return leads().filter(function (l) { return l.id === id; })[0]; }
  function edLabel(e) { return e.edition_key + ' · ' + e.topic + ' · ' + e.period_start + ' to ' + e.period_end + (e.published ? ' · published' : e.closed ? ' · closed' : ''); }
  function inView(v) {
    var views = (S.q && S.q.views) || {};
    if (v === 'all') return leads();
    if (v === 'edition') {
      var ids = (views.edition || []).map(function (x) { return x.lead_id; });
      return leads().filter(function (l) { return ids.indexOf(l.id) >= 0; });
    }
    var list = views[v] || [];
    return leads().filter(function (l) { return list.indexOf(l.id) >= 0; });
  }

  function options(list, selected, emptyLabel) {
    return (emptyLabel == null ? '' : '<option value="">' + esc(emptyLabel) + '</option>') + list.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === selected ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  }
  function editionOptions(selected, openOnly, emptyLabel) {
    return options(editions().filter(function (e) { return !openOnly || !e.closed; }).map(function (e) { return [e.id, edLabel(e)]; }), selected, emptyLabel);
  }
  function categoryOptions(selected, emptyLabel) {
    return options(((S.q && S.q.categories) || []).map(function (c) { return [c, c]; }), selected, emptyLabel);
  }

  function viewCapture() {
    var l = S.editing ? leadById(S.editing) : null, v = l || {}, locked = !!(l && l.promised_publicly);
    return '<div class="card" id="tq-capture"><h3>' + (l ? 'Edit topic' : 'Capture a topic') + '</h3>' +
      '<p class="sub">A title is enough. Everything else can be added later. A topic is a lead, not evidence.</p>' +
      '<p><label>Title <input id="tq-title" maxlength="300" value="' + esc(v.title || '') + '"></label> ' +
      '<button type="button" class="tq-primary" data-tq="save">' + (l ? 'Save changes' : 'Save topic') + '</button>' +
      (l ? ' <button type="button" data-tq="cancel-edit">Cancel</button>' : '') + '</p>' +
      '<details id="tq-more"' + (l ? ' open' : '') + '><summary>More details (optional)</summary>' +
      '<p><label>Report category <select id="tq-topic">' + categoryOptions(v.topic || '', 'Not chosen yet') + '</select></label> ' +
      '<label>Location <input id="tq-location" maxlength="300" value="' + esc(v.location || '') + '"></label></p>' +
      '<p><label>Source addresses, one per line<br><textarea id="tq-sources" rows="3">' + esc((v.source_urls || []).join('\n')) + '</textarea></label></p>' +
      '<p><label>Social post address <input id="tq-social" maxlength="2000" value="' + esc(v.social_post_url || '') + '"></label></p>' +
      '<p><label>Why this matters to residents’ quality of life<br><textarea id="tq-why" rows="2" maxlength="2000">' + esc(v.why_it_matters || '') + '</textarea></label></p>' +
      '<p><label>Questions the research must answer, one per line<br><textarea id="tq-questions" rows="4">' + esc((v.questions || []).join('\n')) + '</textarea></label></p>' +
      '<p><label>Notes<br><textarea id="tq-notes" rows="3" maxlength="6000">' + esc(v.notes || '') + '</textarea></label></p>' +
      '<p><label>Intended edition <select id="tq-intended">' + editionOptions(v.intended_edition_id || '', false, 'None') + '</select></label> ' +
      '<label>or intended date <input type="date" id="tq-intended-date" value="' + esc(v.intended_date || '') + '"></label></p>' +
      '<fieldset class="tq-commit"><legend>Public coverage commitment</legend>' +
      (locked ? '<p class="tq-promised">Promised publicly. This is recorded and cannot be changed.</p><p>“' + esc(v.commitment_wording) + '” — ' + link(v.commitment_post_url) + '</p>'
        : '<p class="sub">Wording alone is a draft. It becomes a public promise only when you add the address of the published post. ' +
          'That records the promise; it does not show the story is true.</p>' +
          '<p><label>Exact wording<br><textarea id="tq-commit-wording" rows="2" maxlength="2000">' + esc(v.commitment_wording || '') + '</textarea></label></p>' +
          '<p><label>Published post address <input id="tq-commit-url" maxlength="2000" value=""></label></p>') +
      '</fieldset></details></div>';
  }

  function viewEditions() {
    var e = editionById(S.edition), body = '';
    if (e) {
      var un = e.unresolved || [];
      body = '<div class="tq-edition" data-edition="' + esc(e.id) + '"><p><b>' + esc(e.series) + '</b> · ' + esc(e.topic) + ' · <code>' + esc(e.edition_key) + '</code> · ' +
        esc(e.period_start) + ' to ' + esc(e.period_end) + '</p>' +
        '<p class="tq-edstate">' + (e.published ? 'Published: ' + link(e.video_url) + ' on ' + esc(e.published_on) : 'Our video is not recorded as published.') +
        (e.closed ? ' Closed' + (e.close_reason ? ': ' + esc(e.close_reason) : '') + '.' : ' Open.') + '</p>' +
        '<p>' + esc(e.assigned) + ' topic(s) assigned. ' + (un.length ? '<b class="tq-bad">' + un.length + (canLink() ? ' still need a decision before this report can be approved: '
          : ' still need a decision before this edition can be closed or recorded as published: ') +
          esc(un.map(function (u) { return u.title; }).join('; ')) + '</b>' : 'Every assigned topic has a decision.') + '</p>' +
        (canLink() ? '<p class="sub">Versions linked to this edition: ' + ((e.linked_versions || []).length ? (e.linked_versions || []).map(function (v) {
          return esc(v.stage) + ' ' + esc(short(v.version_id)); }).join(', ') : 'none. Approval is only held back for versions linked here.') + '</p>' +
        (e.closed ? '' : '<p><label>Link a script or title version <select id="tq-version">' + options(versionChoices(e), '', 'Choose a version') + '</select></label> ' +
          '<button type="button" data-tq="link-version">Link to this edition</button></p>')
          : '<p class="sub tq-nolink">Linking a script to an edition is unavailable in this release: scripts are not written here yet, so no approval is held back.</p>') +
        (e.published ? '' : '<p><label>Our video address <input id="tq-video" maxlength="2000" placeholder="https://"></label> ' +
          '<label>Publication date <input type="date" id="tq-pubdate"></label> ' +
          '<button type="button" data-tq="publish">Record publication</button></p>' +
          '<p class="sub">Needs both. A source story or a social post is not our published video.</p>') +
        (e.closed ? '' : '<p><label>Reason for closing <input id="tq-close-reason" maxlength="1000"></label> ' +
          '<button type="button" data-tq="close-edition">Close this edition</button></p>' +
          '<p class="sub">Closing makes its decisions final. Deferred topics stay in carry forward.</p>') + '</div>';
    }
    return '<div class="card" id="tq-editions"><h3>Report editions</h3>' +
      '<p><label>Edition <select id="tq-edition">' + editionOptions(S.edition || '', false, 'Choose an edition') + '</select></label></p>' + body +
      '<details id="tq-newed"><summary>New edition</summary>' +
      '<p><label>Report category <select id="tq-ed-topic">' + categoryOptions('', 'Choose') + '</select></label> ' +
      '<label>Period start <input type="date" id="tq-ed-start"></label> ' +
      '<label>Period end <input type="date" id="tq-ed-end"></label></p>' +
      '<p class="sub">Leave the end empty for a seven-day period. More than one edition can cover the same week.</p>' +
      '<p><label>Series <input id="tq-ed-series" maxlength="120" placeholder="QUALITY-of-LIFE Weekly Report"></label> ' +
      '<label>Identifier <input id="tq-ed-key" maxlength="80" placeholder="made from the category and start date"></label> ' +
      '<button type="button" data-tq="create-edition">Create edition</button></p></details></div>';
  }
  function versionChoices(e) {
    var vs = (S.opts.versions ? S.opts.versions() : []) || [];
    return vs.filter(function (v) { return !e || !v.topic || v.topic === e.topic; }).map(function (v) {
      return [v.id, v.stage + ' ' + short(v.id) + (v.created_at ? ' · ' + String(v.created_at).slice(0, 10) : '')]; });
  }

  function viewLead(l) {
    var st = l.state || {}, cur = st.current, status = st.status || 'captured';
    var hist = (st.editions || []).map(function (h) {
      return '<li>' + esc(h.edition.edition_key) + (h.current ? ' <b>(current assignment)</b>' : '') + ': ' +
        (h.disposition ? esc(h.disposition) + (h.reason ? ' — ' + esc(h.reason) : '') : 'no decision yet') + '</li>';
    }).join('');
    var research = '';
    if (cur && l.request) {
      research = '<details class="tq-request"><summary>Research request ' + esc(short(l.request.id)) + ' (' + esc(l.request.topic) + ')' +
        (processing() ? '' : ' — prepared, not submitted') + '</summary>' +
        '<p class="sub">Copy this into Perplexity on your plan. Nothing is sent from here.</p>' +
        '<textarea rows="8" readonly class="tq-reqtext">' + esc(l.request.request_text) + '</textarea>' +
        '<p><button type="button" data-tq="copy" data-lead="' + esc(l.id) + '">Copy request</button> <span class="tq-copied sub" role="status"></span></p>' +
        (processing()
          ? (status === 'queued_for_research' ? '<label>Paste Perplexity’s answer<br><textarea rows="5" class="tq-answer" data-req="' + esc(l.request.id) + '" maxlength="200000"></textarea></label>' +
              '<p><button type="button" data-tq="paste" data-req="' + esc(l.request.id) + '">Save the answer and check its sources</button></p>' : '')
          : '<p class="tq-unavailable"><button type="button" disabled aria-disabled="true">Submit an answer for processing</button> <span class="sub">' + esc(UNAVAILABLE) + '</span></p>') +
        (cur.research && cur.research.run_error ? '<p class="tq-bad">Research run failed: ' + esc(cur.research.run_error) + '</p>' : '') + '</details>';
    }
    var actions = '';
    if (!st.assigned) {
      actions = '<p><label>Edition <select class="tq-send-edition" data-lead="' + esc(l.id) + '">' + editionOptions(S.edition && !(editionById(S.edition) || {}).closed ? S.edition : '', true, 'Choose an edition') + '</select></label> ' +
        '<button type="button" class="tq-primary" data-tq="send" data-lead="' + esc(l.id) + '">' + (processing() ? 'Send to research' : 'Prepare research request') + '</button> ' +
        '<button type="button" data-tq="assign" data-lead="' + esc(l.id) + '">Assign without research</button></p>';
    } else if (cur && !cur.edition.closed) {
      actions = (cur.request_id ? '' : '<p><button type="button" class="tq-primary" data-tq="send-current" data-lead="' + esc(l.id) + '" data-edition="' + esc(cur.edition.id) + '">' + (processing() ? 'Send to research' : 'Prepare research request') + '</button></p>') +
        '<p class="tq-decide">Decision for ' + esc(cur.edition.edition_key) + ': ' +
        ['included', 'deferred', 'dropped'].map(function (d) {
          return '<button type="button" data-tq="dispose" data-d="' + d + '" data-lead="' + esc(l.id) + '" data-edition="' + esc(cur.edition.id) + '"' +
            (cur.disposition === d ? ' disabled' : '') + '>' + (d === 'included' ? 'Include' : d === 'deferred' ? 'Defer' : 'Drop') + '</button>';
        }).join(' ') + ' <label>Reason <input class="tq-reason" data-lead="' + esc(l.id) + '" maxlength="1000"' +
        (l.promised_publicly ? ' placeholder="needed to defer or drop a promised topic"' : '') + '></label></p>';
    }
    return '<div class="tq-lead" data-lead="' + esc(l.id) + '" data-status="' + esc(status) + '"><h4>' + esc(l.title) + '</h4>' +
      '<p class="tq-badges"><span class="tq-status tq-st-' + esc(status) + '">' + esc(statusLabel(status)) + '</span>' +
      (l.promised_publicly ? ' <span class="tq-promised">Promised publicly</span>' : (l.commitment_wording ? ' <span class="tq-draft">Draft commitment, not published</span>' : '')) +
      (l.topic ? ' <span class="tq-chip">' + esc(l.topic) + '</span>' : ' <span class="tq-chip">No category yet</span>') +
      (l.location ? ' <span class="tq-chip">' + esc(l.location) + '</span>' : '') +
      (cur ? ' <span class="tq-chip">Edition ' + esc(cur.edition.edition_key) + '</span>' : '') + '</p>' +
      (status === 'included' ? '<p class="sub">Included in the report. Our video is not recorded as published yet.</p>' : '') +
      (status === 'published' && cur ? '<p class="sub">Our video: ' + link(cur.edition.video_url) + ', published ' + esc(cur.edition.published_on) + '.</p>' : '') +
      (st.last_disposition && !st.assigned ? '<p class="tq-last">' + esc(st.last_disposition.disposition === 'deferred' ? 'Deferred' : 'Dropped') + ' in ' +
        esc(st.last_disposition.edition.edition_key) + (st.last_disposition.reason ? ': ' + esc(st.last_disposition.reason) : '') + '</p>' : '') +
      (l.why_it_matters ? '<p><b>Why it matters:</b> ' + esc(l.why_it_matters) + '</p>' : '') +
      ((l.questions || []).length ? '<p><b>Questions for research</b></p><ol class="tq-questions">' + l.questions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' : '') +
      ((l.source_urls || []).length ? '<p><b>Where the lead came from</b> (not evidence)</p><ul>' + l.source_urls.map(function (u) { return '<li>' + link(u) + '</li>'; }).join('') + '</ul>'
        : '<p class="sub">No source address recorded.</p>') +
      (l.social_post_url ? '<p><b>Social post:</b> ' + link(l.social_post_url) + '</p>' : '') +
      (l.commitment_wording ? '<p><b>' + (l.promised_publicly ? 'Public commitment' : 'Draft commitment (not published)') + ':</b> “' + esc(l.commitment_wording) + '”' +
        (l.promised_publicly ? ' — ' + link(l.commitment_post_url) + ' <span class="sub">This records the promise. It is not evidence for the story.</span>' : '') + '</p>' : '') +
      (l.notes ? '<p><b>Notes:</b> ' + esc(l.notes) + '</p>' : '') +
      (hist ? '<p><b>Editions</b></p><ul class="tq-hist">' + hist + '</ul>' : '') + research + actions +
      '<p><button type="button" data-tq="edit" data-lead="' + esc(l.id) + '">Edit</button></p></div>';
  }

  function viewList() {
    var list = inView(S.view), ed = editionById(S.edition);
    var tabs = VIEWS.map(function (v) {
      return '<button type="button" role="tab" data-tq="view" data-v="' + v[0] + '" aria-selected="' + (S.view === v[0]) + '">' + esc(!processing() && v[0] === 'research' ? 'Research requests prepared' : v[1]) +
        ' <span class="tq-count">' + inView(v[0]).length + '</span></button>';
    }).join(' ');
    var empty = S.view === 'edition' && !ed ? 'Choose an edition above to see the topics assigned to it.'
      : S.view === 'inbox' ? 'No unassigned topics.' : 'No topics here.';
    return '<div class="card" id="tq-list"><h3>Topics</h3><div class="tq-tabs" role="tablist">' + tabs + '</div>' +
      (S.view === 'edition' && ed ? '<p class="sub">Every topic ever assigned to ' + esc(ed.edition_key) + ', with its decision there.</p>' : '') +
      (S.view === 'deferred' ? '<p class="sub">Deferred topics stay here, with their reasons, until they are assigned to a later edition.</p>' : '') +
      (list.length ? list.map(viewLead).join('') : '<p class="tq-empty">' + esc(empty) + '</p>') + '</div>';
  }

  function render() {
    var keep = S.el.querySelector('#tq-more'), open = keep ? keep.open : false;
    S.el.innerHTML = '<div class="tq-root"><div class="card"><h3>Topic queue</h3>' +
      '<p class="sub">Story leads and public coverage promises, tied to the report edition and the research they lead to. ' +
      'Nothing here posts, publishes or starts a job.</p>' +
      (S.busy ? '<p class="tq-busy" role="status">Saving…</p>' : '') +
      (S.msg ? '<p class="tq-ok" role="status">' + esc(S.msg) + '</p>' : '') +
      (S.err ? '<p class="tq-bad" role="alert">' + esc(S.err) + '</p>' : '') + '</div>' +
      viewCapture() + viewEditions() + viewList() + '</div>';
    var more = S.el.querySelector('#tq-more'); if (more && open) more.open = true;
  }

  function captureFields() {
    var f = { title: val('#tq-title') };
    // Only what the form holds is sent. A new topic with just a title sends just the title.
    var more = { topic: val('#tq-topic'), location: val('#tq-location'), source_urls: lines(val('#tq-sources')), social_post_url: val('#tq-social'),
      why_it_matters: val('#tq-why'), questions: lines(val('#tq-questions')), notes: val('#tq-notes'),
      intended_edition_id: val('#tq-intended'), intended_date: val('#tq-intended-date') };
    Object.keys(more).forEach(function (k) {
      var v = more[k], has = Array.isArray(v) ? v.length > 0 : v !== '';
      if (has || S.editing) f[k] = v;
    });
    if (q('#tq-commit-wording')) {
      var w = val('#tq-commit-wording'), u = val('#tq-commit-url');
      if (w || S.editing) f.commitment_wording = w;
      if (u) f.commitment_post_url = u;
    }
    return f;
  }

  function onClick(e) {
    var b = e.target.closest('button[data-tq]'); if (!b || b.disabled || S.busy) return;
    var a = b.getAttribute('data-tq'), lead = b.getAttribute('data-lead'), fmt = S.opts.answerFormat ? S.opts.answerFormat() : null;
    if (a === 'view') { S.view = b.getAttribute('data-v'); S.msg = ''; return render(); }
    if (a === 'edit') { S.editing = lead; S.msg = ''; S.err = ''; render(); var c = q('#tq-capture'); if (c && c.scrollIntoView) c.scrollIntoView(); return; }
    if (a === 'cancel-edit') { S.editing = null; return render(); }
    if (a === 'save') {
      var f = captureFields();
      if (!f.title) { S.err = 'A topic needs a title.'; S.msg = ''; return render(); }
      var id = S.editing || null;
      return act(rpc('hs_weekly_lead_save', { p_lead: id, p_fields: f }).then(function (r) { S.editing = null; return r; }), id ? 'Topic saved.' : 'Topic captured.');
    }
    if (a === 'create-edition') {
      if (!val('#tq-ed-topic') || !val('#tq-ed-start')) { S.err = 'An edition needs a report category and a period start.'; S.msg = ''; return render(); }
      return act(rpc('hs_weekly_edition_create', { p_topic: val('#tq-ed-topic'), p_period_start: val('#tq-ed-start'), p_period_end: val('#tq-ed-end') || null,
        p_series: val('#tq-ed-series') || null, p_key: val('#tq-ed-key') || null }).then(function (r) { if (r && r.id) S.edition = r.id; return r; }),
        function (r) { return 'Edition ' + ((r || {}).edition_key || '') + ' created.'; });
    }
    if (a === 'send' || a === 'assign' || a === 'send-current') {
      var sel = S.el.querySelector('.tq-send-edition[data-lead="' + lead + '"]'), ed = a === 'send-current' ? b.getAttribute('data-edition') : (sel ? sel.value : '');
      if (!ed) { S.err = 'Choose a report edition first.'; S.msg = ''; return render(); }
      if (a === 'assign') return act(rpc('hs_weekly_lead_assign', { p_lead: lead, p_edition: ed }), 'Assigned to the edition.');
      return act(rpc('hs_weekly_lead_send_to_research', { p_lead: lead, p_edition: ed, p_answer_format: fmt }), function (r) {
        if (!processing()) {
          return r && r.existing ? 'Already prepared: research request ' + short(r.request_id) + ' is the one on file. No second request was made.'
            : 'Research request prepared: request ' + short((r || {}).request_id) + ' is saved and linked to this topic. Nothing was submitted for processing.';
        }
        return r && r.existing ? 'Already sent: research request ' + short(r.request_id) + ' is the one on file. No second request was made.'
          : 'Sent to research: request ' + short((r || {}).request_id) + ' is saved and linked to this topic.';
      });
    }
    if (a === 'dispose') {
      var rn = S.el.querySelector('.tq-reason[data-lead="' + lead + '"]');
      return act(rpc('hs_weekly_lead_disposition', { p_lead: lead, p_edition: b.getAttribute('data-edition'), p_disposition: b.getAttribute('data-d'),
        p_reason: rn && rn.value.trim() ? rn.value.trim() : null }), 'Decision recorded.');
    }
    if (a === 'copy') {
      // Copying changes nothing: no call, no reload, no status.
      var box = b.closest('.tq-request'), ta = box && box.querySelector('.tq-reqtext'), note = box && box.querySelector('.tq-copied');
      if (!ta) return;
      var done = function (okay) { if (note) note.textContent = okay ? 'Copied. The topic is unchanged: a copied request is not submitted research.' : 'Select the text above and copy it.'; };
      ta.focus(); ta.select();
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(ta.value).then(function () { done(true); }, function () { done(false); });
      return done(false);
    }
    if (a === 'paste') {
      if (!processing()) return;   // not offered, and refused if reached
      var t = S.el.querySelector('.tq-answer[data-req="' + b.getAttribute('data-req') + '"]'), txt = t ? t.value.trim() : '';
      if (!txt) { S.err = 'Paste the answer first.'; S.msg = ''; return render(); }
      return act(rpc('hs_weekly_paste_answer', { p_request: b.getAttribute('data-req'), p_raw_text: txt }), 'Answer saved. Its sources are being checked.');
    }
    if (a === 'link-version') {
      if (!canLink()) return;
      if (!val('#tq-version')) { S.err = 'Choose a version to link.'; S.msg = ''; return render(); }
      return act(rpc('hs_weekly_edition_link_version', { p_edition: S.edition, p_version: val('#tq-version') }), 'Version linked to this edition.');
    }
    if (a === 'close-edition') return act(rpc('hs_weekly_edition_close', { p_edition: S.edition, p_reason: val('#tq-close-reason') || null }), 'Edition closed.');
    if (a === 'publish') {
      return act(rpc('hs_weekly_edition_publish', { p_edition: S.edition, p_video_url: val('#tq-video') || null, p_published_on: val('#tq-pubdate') || null }),
        'Publication recorded.');
    }
  }
  function onChange(e) {
    if (e.target && e.target.id === 'tq-edition') { S.edition = e.target.value || null; S.msg = ''; reload(); }
  }

  function css() {
    if (document.getElementById('tq-css')) return;
    var st = document.createElement('style'); st.id = 'tq-css';
    st.textContent = '.tq-root{max-width:1100px}.tq-root textarea{width:100%;box-sizing:border-box;font:inherit}.tq-root input,.tq-root select{font:inherit;max-width:100%}' +
      '.tq-lead{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:8px 0;min-width:0;overflow-wrap:anywhere}.tq-lead h4{margin:2px 0}' +
      '.tq-status{display:inline-block;border-radius:6px;padding:0 6px;font-size:12px;font-weight:600;background:#eef2f6}' +
      '.tq-st-published{background:#e3f3e9}.tq-st-deferred{background:#fff3d6}.tq-st-dropped{background:#f3e3e1}' +
      '.tq-promised{display:inline-block;border-radius:6px;padding:0 6px;font-size:12px;font-weight:700;background:#8a2b24;color:#fff}' +
      '.tq-draft,.tq-chip{display:inline-block;border:1px solid var(--line);border-radius:6px;padding:0 6px;font-size:11.5px;color:var(--muted)}' +
      '.tq-tabs{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}.tq-tabs button[aria-selected="true"]{font-weight:700;outline:2px solid #2d6a4f}' +
      '.tq-count{font-size:11.5px;color:var(--muted)}.tq-bad{color:#8a2b24}.tq-ok{color:#2d6a4f}.tq-empty{color:var(--muted);font-style:italic}' +
      '.tq-last{background:#fff8dc;padding:4px 6px;border-radius:6px}.tq-commit{border:1px solid var(--line);border-radius:8px;margin:6px 0}' +
      '.tq-unavailable button{opacity:.55;cursor:not-allowed}.tq-primary{font-weight:600}.tq-edition{border-top:1px dashed var(--line);margin-top:6px;padding-top:4px}';
    document.head.appendChild(st);
  }

  function mount(client, el, opts) {
    if (!el || !client) return;
    css();
    S = { client: client, el: el, opts: opts || {}, q: null, view: 'inbox', edition: null, editing: null, err: '', msg: '', busy: false };
    if (!el.__tqBound) { el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.__tqBound = true; }
    render();
    return reload();
  }

  // The queue-only entry point (Tab 20). The answer format comes from the weekly screen's library when it is loaded,
  // so a request prepared now is one the research parser will be able to read later. Nothing else of that screen is used.
  function load(client, el) {
    var slice = HS.acqWeeklySlice;
    return mount(client, el, { researchProcessing: false, answerFormat: slice && slice.answerFormatText ? slice.answerFormatText : null });
  }

  HS.acqWeeklyTopics = { mount: mount, load: load, STATUS: STATUS, VIEWS: VIEWS, FIELDS: FIELDS, PREPARED: PREPARED, UNAVAILABLE: UNAVAILABLE };
})();
