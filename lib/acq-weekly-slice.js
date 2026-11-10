/* Jody Acquisition Dashboard, Tab 20 · Weekly Report — STAGE 2 PROOF SLICE screens (first topic: Air Quality, "Air").

   TEST-ONLY PHASE: this module is not loaded by any page yet. It is mounted by its browser test against a stub client.
   Wiring it into Tab 20 is a later, separately approved step; the Stage 1 prototype (lib/acq-weekly-report.js) is untouched.

   It reads and writes only through the admin functions in docs/weekly-stage2-slice.sql (client.rpc). It holds no key,
   calls no AI provider and fetches nothing else. Research is a MANUAL step: this screen writes the request, you run it in
   Perplexity on your plan, and you paste the answer back.

   Labels are kept apart on purpose:
     quote match       a machine compared text (exact / normalized / not found / not checked) — not proof the finding is true
     publication date  read from the page (metadata / text) or "not stated" / "unknown" — never filled in
     your decision     pending / approved / rejected — the only thing that approves a finding
   Script checks are mechanical and say so; they do not certify factual accuracy. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});

  var TOPIC = 'Air Quality';
  var WORKING_TITLE = 'Quality-of-Life Weekly Report: Air';
  var WORKING_SUBTITLE = 'Trump’s $45 Billion Pollution Rollback—Who Saves, Who Pays?';
  var ANSWER_FORMAT = 'WEEKLY-ANSWER v1';   // the format homesignal-ingest weekly/slice/parse.py reads
  var QUESTIONS = [
    'What is proposed, and what is already in effect?',
    'What does the $45 billion estimate include: its timeframe, assumptions, who benefits, and which costs or harms it leaves out?',
    'How do independent detection, EPA notification, operator investigation and corrective action work under the Super Emitter Program?',
    'Which obligations would disappear under the proposal, and which would remain?',
    'What are methane’s climate consequences, kept separate from local air pollutants and their health effects?',
    'What is EPA’s rationale, what does industry argue, and what do independent evaluations say?'];
  var RULES = [
    'Explain unfamiliar terms in plain words.', 'Explain the quality-of-life effect.', 'Keep qualifications and uncertainty.',
    'Add no fact that the cited findings do not state.', 'Never read citation markers aloud.',
    'Do not call the $45 billion a cash payment or annual savings.',
    'Do not attribute the entire figure to scrapping the Super Emitter Program.',
    'Do not say companies would have no remaining duty to fix leaks.',
    'Say “company emissions detected by third parties,” not “third-party leaks.”',
    'Attribute forecasts, and distinguish proposed changes from final rules.'];
  var QUOTE = { exact: 'Quote found (exact)', normalized: 'Quote found (spacing or punctuation differs)', not_found: 'Quote not found on the page',
    not_checked: 'Quote not checked (page not read)' };
  var DATE = { page_metadata: 'Date from page metadata', page_text: 'Date from page text', not_stated: 'Publication date not stated',
    unknown: 'Publication date unknown' };
  var DECISION = { pending: 'Your decision: pending', approved: 'Your decision: approved', rejected: 'Your decision: rejected' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || '')) ? String(u) : ''; }

  function requestText() {
    return 'Research for the ' + WORKING_TITLE + ' report: "' + WORKING_SUBTITLE + '".\n' +
      'Subject: the EPA’s October 2026 proposal to revise oil-and-gas emissions rules, including rescinding the Super Emitter Program.\n\n' +
      'Answer these questions:\n' + QUESTIONS.map(function (q, i) { return (i + 1) + '. ' + q; }).join('\n') + '\n\n' +
      'Answer ONLY in this format, one block per finding, starting with the line "' + ANSWER_FORMAT + '":\n' + ANSWER_FORMAT + '\n' +
      'FINDING\nkey: a-short-lowercase-id\nstatement: one sentence\nqualifiers: proposed; estimated (or none)\nuncertainty: what is not known\n' +
      'scope: the place or population it applies to\nsource_url: https://...\npublisher: who published it\n' +
      'published: YYYY-MM-DD or not stated\nquote: the exact words from that source\nEND\n' +
      'Repeat source_url / publisher / published / quote for each extra source. Attribute every forecast to whoever made it, and say ' +
      'whether each change is proposed or final.';
  }

  var S = null;
  function rpc(name, args) {
    return S.client.rpc(name, args).then(function (r) {
      if (r.error) throw new Error(r.error.message || r.error.code || 'request refused');
      return r.data;
    });
  }
  function reload() { return rpc('hs_weekly_overview', { p_topic: TOPIC }).then(function (o) { S.o = o; S.err = ''; render(); }, fail); }
  function fail(e) { S.err = e.message; render(); }
  function act(p) { S.busy = true; render(); return p.then(function () { S.busy = false; return reload(); }, function (e) { S.busy = false; fail(e); }); }

  function viewRequest(o) {
    var last = (o.requests || [])[0];
    return '<div class="card" id="ws-request"><h3>1 · Research request (manual Perplexity step)</h3>' +
      '<p class="sub">Copy this into Perplexity on your plan, then paste the whole answer below. Nothing is sent to Perplexity from here.</p>' +
      '<textarea id="ws-reqtext" rows="12" readonly>' + esc(requestText()) + '</textarea>' +
      '<p><button type="button" data-ws="save-request">Save this request</button></p>' +
      (last ? '<p class="sub">Saved request on file (' + esc(String(last.created_at).slice(0, 16).replace('T', ' ')) + ').</p>' +
        '<label for="ws-answer">Paste Perplexity’s answer</label><textarea id="ws-answer" rows="8" maxlength="200000"></textarea>' +
        '<p><button type="button" data-ws="paste" data-req="' + esc(last.id) + '">Save the answer and check its sources</button></p>' : '') +
      (o.runs || []).map(function (r) { return '<p class="sub ws-run">Run ' + esc(r.kind) + ': ' + esc(r.status) + (r.error ? ' — ' + esc(r.error) : '') + '</p>'; }).join('') +
      '</div>';
  }
  function viewFindings(o) {
    var fs = (o.findings || []).filter(function (f) { return f.is_latest; });
    return '<div class="card" id="ws-findings"><h3>2 · Findings</h3>' +
      '<p class="sub">A quote match is an automated text comparison, not proof. Only your decision approves a finding.</p>' +
      (fs.length ? fs.map(function (f) {
        return '<div class="ws-finding" data-fid="' + esc(f.id) + '"><b>' + esc(f.statement) + '</b> <span class="sub">' + esc(f.finding_key) + ' v' + esc(f.version) + '</span>' +
          (f.qualifiers && f.qualifiers.length ? '<div class="sub">Qualifiers: ' + esc(f.qualifiers.join(', ')) + '</div>' : '') +
          (f.uncertainty ? '<div class="sub">Uncertainty: ' + esc(f.uncertainty) + '</div>' : '') +
          '<ul>' + (f.sources || []).map(function (s) {
            var u = safeUrl(s.url);
            return '<li>' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(s.publisher || u) + '</a>' : esc(s.publisher || 'source')) +
              ' · <span class="ws-label ws-quote">' + esc(QUOTE[s.quote_match] || s.quote_match) + '</span>' +
              ' · <span class="ws-label ws-date">' + esc(DATE[s.date_extraction] || s.date_extraction) + (s.published_date ? ' (' + esc(s.published_date) + ')' : '') + '</span>' +
              (s.fetch_error ? ' · <span class="ws-bad">' + esc(s.fetch_error) + '</span>' : '') + '</li>';
          }).join('') + '</ul>' +
          '<div class="ws-label ws-decision">' + esc(DECISION[f.human_decision] || f.human_decision) + '</div>' +
          '<button type="button" data-ws="decide" data-d="approved" data-id="' + esc(f.id) + '">Approve</button> ' +
          '<button type="button" data-ws="decide" data-d="rejected" data-id="' + esc(f.id) + '">Reject</button></div>';
      }).join('') + '<p><button type="button" data-ws="seal">Save approved findings as a new library version</button></p>' :
        '<p class="ws-empty">No findings yet.</p>') +
      (o.library_versions || []).map(function (v) { return '<p class="sub">Library version ' + esc(v.n) + ': ' + esc(v.findings) + ' findings, ' + (v.sealed ? 'sealed' : 'open') + '</p>'; }).join('') +
      '</div>';
  }
  function viewProfile(o) {
    var ps = o.profiles || [];
    return '<div class="card" id="ws-profile"><h3>3 · Editorial profile</h3>' +
      (ps.length ? ps.map(function (p) {
        return '<p><b>Version ' + esc(p.version) + '</b> — ' + (p.approved ? 'approved' : 'not approved') + '</p><ol>' +
          (p.rules || []).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ol>' +
          (p.approved ? '' : '<button type="button" data-ws="approve-profile" data-id="' + esc(p.id) + '">Approve this profile</button>');
      }).join('') : '<ol>' + RULES.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ol>' +
        '<button type="button" data-ws="create-profile">Save these rules as profile version 1</button>') + '</div>';
  }
  function lessonText(o, id) { var l = (o.lessons || []).filter(function (x) { return x.id === id; })[0]; return l ? l.text : id; }
  function viewScripts(o) {
    var lv = (o.library_versions || []).filter(function (v) { return v.sealed; }).slice(-1)[0];
    var pf = (o.profiles || []).filter(function (p) { return p.approved; }).slice(-1)[0];
    return '<div class="card" id="ws-scripts"><h3>4 · Script drafts</h3><p class="sub">' + esc(WORKING_TITLE) + ' — ' + esc(WORKING_SUBTITLE) + ' (working title)</p>' +
      '<p><button type="button" data-ws="draft"' + (lv && pf ? ' data-lv="' + esc(lv.id) + '" data-pf="' + esc(pf.id) + '"' : ' disabled') + '>Request a draft (Claude, your plan)</button> ' +
      (lv && pf ? '<span class="sub">From library version ' + esc(lv.n) + ' and profile version ' + esc(pf.version) + '.</span>' :
        '<span class="sub">Needs a sealed library version and an approved profile.</span>') + '</p>' +
      (o.scripts || []).map(function (s, i) {
        var c = s.checks || {};
        return '<div class="ws-script" data-sid="' + esc(s.id) + '"><h4>Draft ' + (i + 1) + (s.approved ? ' · approved' : '') + '</h4>' +
          '<p class="ws-checks">' + esc(c.label || 'mechanical checks: not reported') + ' <span class="sub">Automated checks; not a certification of factual accuracy.</span></p>' +
          (s.body && s.body.segments || []).map(function (g, k) {
            return '<div class="ws-seg"><p class="ws-spoken">' + esc(g.text) + '</p><div class="ws-chips">' + (g.claim_ids || []).map(function (id) {
              return '<span class="ws-chip">' + esc(id) + '</span>'; }).join('') + '</div>' +
              '<label>Correction <input class="ws-corr" data-sid="' + esc(s.id) + '" data-k="' + k + '" maxlength="4000"></label> ' +
              '<button type="button" data-ws="correct" data-sid="' + esc(s.id) + '" data-k="' + k + '">Save correction</button></div>';
          }).join('') +
          ((s.lesson_uses || []).length ? '<table class="ws-uses"><tr><th>Lesson</th><th>Retrieved</th><th>Included in prompt</th><th>Automated assessment</th><th>Your review</th></tr>' +
            s.lesson_uses.map(function (u) {
              return '<tr><td>' + esc(lessonText(o, u.lesson_id)) + '</td><td>' + (u.retrieved ? 'yes' : 'no') + '</td><td>' + (u.included ? 'yes' : 'no') + '</td><td>' +
                esc(u.assessed) + ' (' + esc(u.assessed_by) + ')' + (u.assessment_note ? ' — ' + esc(u.assessment_note) : '') + '</td><td>' + esc(u.reviewer_decision) +
                (u.reviewer_decision === 'pending' ? ' <button type="button" data-ws="use" data-d="confirmed" data-id="' + esc(u.id) + '">Confirm</button>' +
                  ' <button type="button" data-ws="use" data-d="corrected" data-id="' + esc(u.id) + '">Correct</button>' : '') + '</td></tr>';
            }).join('') + '</table>' : '') +
          (s.approved ? '' : '<p><button type="button" data-ws="approve-script" data-id="' + esc(s.id) + '">Approve this draft</button></p>') + '</div>';
      }).join('') + '</div>';
  }
  function viewLessons(o) {
    var cs = o.corrections || [];
    return '<div class="card" id="ws-lessons"><h3>5 · Corrections and lessons</h3>' +
      (cs.length ? cs.map(function (c) {
        return '<div class="ws-corrbox"><p class="sub">Before: ' + esc(c.before_text) + '</p><p class="sub">After: ' + esc(c.after_text) + '</p>' +
          '<label>Lesson <input class="ws-ltext" data-cid="' + esc(c.id) + '" maxlength="1000"></label> ' +
          '<label>Phrase to avoid (optional) <input class="ws-lavoid" data-cid="' + esc(c.id) + '" maxlength="200"></label> ' +
          '<button type="button" data-ws="lesson" data-cid="' + esc(c.id) + '">Propose as a lesson</button></div>';
      }).join('') : '<p class="ws-empty">No corrections yet.</p>') +
      (o.lessons || []).map(function (l) {
        return '<p class="ws-lesson"><b>' + esc(l.status) + '</b> ' + esc(l.text) + (l.test ? ' <span class="sub">(test: ' + esc(l.test.type) + ' "' + esc(l.test.value) + '")</span>' : '') +
          (l.status === 'proposed' ? ' <button type="button" data-ws="lesson-decide" data-d="approved" data-id="' + esc(l.id) + '">Approve</button>' : '') + '</p>';
      }).join('') + '</div>';
  }

  function render() {
    var o = S.o || {};
    S.el.innerHTML = '<div class="ws-root"><div class="card"><h3>20 · Weekly Report — Stage 2 proof slice</h3>' +
      '<p class="sub">Topic: ' + esc(TOPIC) + '. Research is pasted from Perplexity by you; drafts run on your Claude plan (no incremental API charge). ' +
      'Nothing here narrates, renders or publishes.</p>' + (S.busy ? '<p class="ws-busy" role="status">Saving…</p>' : '') +
      (S.err ? '<p class="ws-bad" role="alert">' + esc(S.err) + '</p>' : '') + '</div>' +
      viewRequest(o) + viewFindings(o) + viewProfile(o) + viewScripts(o) + viewLessons(o) + '</div>';
  }

  function onClick(e) {
    var b = e.target.closest('button[data-ws]'); if (!b || b.disabled || S.busy) return;
    var a = b.getAttribute('data-ws'), q = function (sel) { return S.el.querySelector(sel); };
    if (a === 'save-request') return act(rpc('hs_weekly_request_research', { p_topic: TOPIC, p_request_text: requestText() }));
    if (a === 'paste') {
      var t = q('#ws-answer').value; if (!t.trim()) return fail(new Error('Paste the answer first.'));
      return act(rpc('hs_weekly_paste_answer', { p_request: b.getAttribute('data-req'), p_raw_text: t }));
    }
    if (a === 'decide') return act(rpc('hs_weekly_finding_decide', { p_finding: b.getAttribute('data-id'), p_decision: b.getAttribute('data-d'), p_note: null }));
    if (a === 'seal') return act(rpc('hs_weekly_library_seal', { p_topic: TOPIC }));
    if (a === 'create-profile') return act(rpc('hs_weekly_profile_create', { p_rules: RULES }));
    if (a === 'approve-profile') return act(rpc('hs_weekly_profile_approve', { p_profile: b.getAttribute('data-id') }));
    if (a === 'draft') return act(rpc('hs_weekly_script_request', { p_library_version: b.getAttribute('data-lv'), p_profile: b.getAttribute('data-pf') }));
    if (a === 'approve-script') return act(rpc('hs_weekly_script_approve', { p_script: b.getAttribute('data-id') }));
    if (a === 'correct') {
      var sid = b.getAttribute('data-sid'), k = b.getAttribute('data-k');
      var v = q('.ws-corr[data-sid="' + sid + '"][data-k="' + k + '"]').value; if (!v.trim()) return fail(new Error('Write the corrected text first.'));
      return act(rpc('hs_weekly_correction_save', { p_script: sid, p_segment: +k, p_after: v, p_note: null }));
    }
    if (a === 'lesson') {
      var cid = b.getAttribute('data-cid'), lt = q('.ws-ltext[data-cid="' + cid + '"]').value, av = q('.ws-lavoid[data-cid="' + cid + '"]').value.trim();
      if (!lt.trim()) return fail(new Error('Write the lesson first.'));
      return act(rpc('hs_weekly_lesson_propose', { p_correction: cid, p_text: lt, p_test: av ? { type: 'avoid_phrase', value: av } : null }));
    }
    if (a === 'lesson-decide') return act(rpc('hs_weekly_lesson_decide', { p_lesson: b.getAttribute('data-id'), p_decision: b.getAttribute('data-d') }));
    if (a === 'use') return act(rpc('hs_weekly_lesson_use_review', { p_use: +b.getAttribute('data-id'), p_decision: b.getAttribute('data-d'), p_note: null }));
  }

  function css() {
    if (document.getElementById('ws-css')) return;
    var st = document.createElement('style'); st.id = 'ws-css';
    st.textContent = '.ws-root{max-width:1100px}.ws-root textarea{width:100%;box-sizing:border-box;font:inherit}.ws-root input{max-width:100%}' +
      '.ws-finding,.ws-script,.ws-corrbox{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:8px 0}' +
      '.ws-label{font-size:12.5px}.ws-decision{font-weight:600;margin:4px 0}.ws-bad{color:#8a2b24}.ws-empty{color:var(--muted);font-style:italic}' +
      '.ws-chip{display:inline-block;border:1px solid var(--line);border-radius:6px;padding:0 6px;margin:2px;font-size:11.5px;color:var(--muted)}' +
      '.ws-uses{border-collapse:collapse;font-size:12.5px;display:block;overflow-x:auto}.ws-uses td,.ws-uses th{border:1px solid var(--line);padding:3px 6px}';
    document.head.appendChild(st);
  }

  function mount(client, el) {
    if (!el || !client) return;
    css();
    S = { client: client, el: el, o: null, err: '', busy: false };
    if (!el.__wsBound) { el.addEventListener('click', onClick); el.__wsBound = true; }
    render();
    return reload();
  }

  HS.acqWeeklySlice = { mount: mount, requestText: requestText, TOPIC: TOPIC, ANSWER_FORMAT: ANSWER_FORMAT, RULES: RULES };
})();
