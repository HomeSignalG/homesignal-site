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
  var ACTIONS = [['conflict_first', 'Put the conflict first'], ['concrete_stake', 'Make the public stake concrete'],
    ['plain_wording', 'Replace bureaucratic wording'], ['tighten', 'Tighten the explanation'], ['strengthen_contrast', 'Strengthen the contrast'],
    ['cut_repetition', 'Cut repetition'], ['strengthen_closing', 'Strengthen the closing']];
  var REVIEWS = [['approved', 'Approve passage'], ['rejected', 'Reject passage'], ['material_issue', 'Material factual issue'],
    ['quote_not_found_in_sources', 'Quote: not found in the sources reviewed'], ['quote_contradicted', 'Quote: contradicted by evidence']];
  var QSTATUS = { in_packet: 'Quote in this packet', not_in_packet: 'Not in this packet' };
  var DIMS = [['hook_conflict', 'Hook / conflict'], ['human_stakes', 'Human stakes'], ['emotional_force', 'Emotional force'],
    ['argument_coherence', 'Argument coherence'], ['factual_discipline', 'Factual discipline'], ['spoken_clarity', 'Spoken clarity'], ['closing', 'Closing']];
  var HIGH_RISK = ['false_claim', 'knowing_deception', 'improper_influence'];

  function vs(o, stage) { return (o.versions || []).filter(function (v) { return v.stage === stage; }); }
  function byId(o, id) { return (o.versions || []).filter(function (v) { return v.id === id; })[0]; }
  function statusLabel(st) {
    st = st || {};
    if (st.current) return 'Approved (this version)';
    if (st.outdated) return 'Outdated: ' + (st.outdated_reason || 'what it was written from changed') + (st.approved ? ' · its earlier approval is kept in the history' : '');
    if (st.superseded) return 'Superseded by a newer version' + (st.approved ? ' · approved before it was revised' : '');
    return 'Not approved';
  }
  function head(v) { return (vs(S.o || {}, v.stage).filter(function (x) { return !(x.status || {}).superseded && x.depends_on === v.depends_on; })[0]) || v; }
  function checksBox(c) {
    c = c || {};
    return '<p class="ws-checks">' + esc(c.label || 'mechanical checks: not reported') + ' <span class="sub">Automated checks; not a certification of factual accuracy.</span></p>' +
      ((c.problems || []).length ? '<ul class="ws-probs">' + c.problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '');
  }
  function viewAngles(o) {
    var lv = (o.library_versions || []).filter(function (v) { return v.sealed; }).slice(-1)[0];
    var pf = (o.profiles || []).filter(function (p) { return p.approved; }).slice(-1)[0];
    var sets = vs(o, 'angles'), cur = sets.filter(function (v) { return !(v.status || {}).superseded; }).slice(-1)[0];
    var html = '<div class="card" id="ws-angles"><h3>4 · Angle cards</h3><p class="sub">' + esc(WORKING_TITLE) + ' — ' + esc(WORKING_SUBTITLE) + ' (working title)</p>' +
      '<p><button type="button" data-ws="angles"' + (lv && pf ? ' data-lv="' + esc(lv.id) + '" data-pf="' + esc(pf.id) + '"' + (cur ? ' data-parent="' + esc(cur.id) + '"' : '') : ' disabled') + '>' +
      (cur ? 'Ask for a new version of the angle cards' : 'Ask for three angle cards (Claude, your plan)') + '</button> ' +
      (lv && pf ? '' : '<span class="sub">Needs a sealed library version and an approved profile.</span>') + '</p>';
    if (!cur) return html + '<p class="ws-empty">No angle cards yet.</p></div>';
    var sel = ((cur.approvals || []).filter(function (a) { return a.this_version; }).slice(-1)[0] || {}).selected_index;
    html += '<p class="ws-status">' + esc(statusLabel(cur.status)) + '</p>' + checksBox(cur.checks) +
      '<p class="sub">The cards may share evidence. You decide whether they are meaningfully different; the checks can only find duplicates.</p><div class="ws-cards">';
    (cur.body.angles || []).forEach(function (c, i) {
      html += '<label class="ws-card' + (sel === i ? ' ws-picked' : '') + '"><input type="radio" name="ws-angle" value="' + i + '"' + (sel === i ? ' checked' : '') + '> <b>Angle ' + (i + 1) + '</b>' +
        (HIGH_RISK.indexOf(c.category) >= 0 ? ' <span class="ws-risk">High-risk category: needs supporting findings and your acknowledgement</span>' : '') +
        '<dl><dt>Public claim</dt><dd>' + esc(c.claim) + '</dd><dt>Category</dt><dd>' + esc(c.category) + '</dd><dt>Public stakes</dt><dd>' + esc(c.public_stakes) +
        '</dd><dt>Editorial position</dt><dd>' + esc(c.editorial_position) + '</dd><dt>Context and alternative explanation</dt><dd>' + esc(c.context) +
        '</dd><dt>Evidence limits</dt><dd>' + esc(c.evidence_limits) + '</dd><dt>Proposed opening</dt><dd>' + esc(c.opening) +
        '</dd><dt>Why it differs</dt><dd>' + esc(c.why_different) + '</dd></dl><div class="ws-chips">' +
        (c.finding_ids || []).map(function (id) { return '<span class="ws-chip">' + esc(id) + '</span>'; }).join('') + '</div></label>';
    });
    return html + '</div><p><label><input type="checkbox" id="ws-angle-ack"> I confirm the cited findings support a high-risk angle (only needed for one)</label></p>' +
      '<p><button type="button" data-ws="approve-angle" data-id="' + esc(cur.id) + '">Approve the selected angle</button></p></div>';
  }
  function viewOutline(o) {
    var ang = vs(o, 'angles').filter(function (v) { return (v.status || {}).current; }).slice(-1)[0];
    var outs = vs(o, 'outline'), cur = outs.filter(function (v) { return !(v.status || {}).superseded; }).slice(-1)[0];
    var html = '<div class="card" id="ws-outline"><h3>5 · Beat outline</h3><p class="sub">Collision, reveal, mechanism, confrontation, judgment, landing: a guide, not fixed wording.</p>' +
      '<p><button type="button" data-ws="outline"' + (ang ? ' data-id="' + esc(ang.id) + '"' + (cur && cur.depends_on === ang.id ? ' data-parent="' + esc(cur.id) + '"' : '') : ' disabled') + '>' +
      (cur ? 'Ask for a new outline' : 'Ask for an outline') + '</button>' + (ang ? '' : ' <span class="sub">Needs an approved angle.</span>') + '</p>';
    if (!cur) return html + '<p class="ws-empty">No outline yet.</p></div>';
    return html + '<p class="ws-status">' + esc(statusLabel(cur.status)) + '</p>' + checksBox(cur.checks) + '<ol class="ws-beats">' +
      (cur.body.beats || []).map(function (b) { return '<li><b>' + esc(b.beat) + '</b> — ' + esc(b.purpose) + ' ' + (b.finding_ids || []).map(function (id) {
        return '<span class="ws-chip">' + esc(id) + '</span>'; }).join('') + '</li>'; }).join('') + '</ol>' +
      ((cur.status || {}).current || (cur.status || {}).outdated ? '' : '<p><button type="button" data-ws="approve-version" data-id="' + esc(cur.id) + '">Approve this outline</button></p>') +
      '<p><button type="button" data-ws="draft"' + ((cur.status || {}).current ? ' data-id="' + esc(cur.id) + '"' : ' disabled') + '>Request a script from this outline</button></p></div>';
  }
  function viewEditor(o) {
    var scripts = vs(o, 'script');
    var html = '<div class="card" id="ws-scripts"><h3>6 · Script workbench</h3>';
    if (!scripts.length) return html + '<p class="ws-empty">No script yet.</p></div>';
    var s = byId(o, S.sel) || scripts.filter(function (v) { return !(v.status || {}).superseded; }).slice(-1)[0] || scripts.slice(-1)[0];
    var outline = byId(o, s.depends_on) || {}, ang = byId(o, outline.depends_on) || {};
    var card = ((ang.body || {}).angles || [])[s.selected_index] || {};
    var c = s.checks || {}, st = s.status || {}, editable = !st.superseded && !st.outdated;
    var quotes = (c.quotes || []), revs = (o.corrections || []).filter(function (r) { return r.script_id === s.id; });
    var unresolved = (c.material_issues || []).concat(revs.filter(function (r) { return ['material_issue', 'quote_not_found_in_sources', 'quote_contradicted'].indexOf(r.decision) >= 0; })
      .map(function (r) { return 'Passage ' + (r.segment_index + 1) + ': ' + r.reason; }));
    var left = '<div class="ws-left"><h4>Angle</h4><p>' + esc(card.claim || '—') + '</p><p class="sub">' + esc(card.public_stakes || '') + '</p>' +
      '<h4>Evidence</h4><ul class="ws-ev">' + (o.findings || []).filter(function (f) { return f.is_latest; }).map(function (f) {
        return '<li><span class="ws-chip">' + esc(f.finding_key + '@' + f.version) + '</span> ' + esc(f.statement) + '</li>'; }).join('') + '</ul>' +
      '<h4>Quotes</h4>' + (quotes.length ? '<ul>' + quotes.map(function (q) { return '<li>“' + esc(q.text) + '” <span class="ws-label">' + esc(QSTATUS[q.status] || q.status) + '</span></li>'; }).join('') + '</ul>' : '<p class="ws-empty">No quotations.</p>') +
      '<h4>Unresolved questions</h4>' + (unresolved.length || card.evidence_limits ? '<ul>' + unresolved.map(function (u) { return '<li class="ws-bad">' + esc(u) + '</li>'; }).join('') +
        (card.evidence_limits ? '<li>' + esc(card.evidence_limits) + '</li>' : '') + '</ul>' : '<p class="ws-empty">None recorded.</p>') + '</div>';
    var center = '<div class="ws-center"><p class="ws-status">' + esc(statusLabel(st)) + '</p>' + (s.body.segments || []).map(function (g, k) {
      var mine = revs.filter(function (r) { return r.segment_index === k; });
      return '<div class="ws-seg" data-k="' + k + '"><p class="ws-beat">' + esc(g.beat || 'passage') + ' · passage ' + (k + 1) + '</p><p class="ws-spoken">' + esc(g.text) + '</p>' +
        '<div class="ws-chips">' + (g.claim_ids || []).map(function (id) { return '<span class="ws-chip">' + esc(id) + '</span>'; }).join('') + '</div>' +
        mine.map(function (r) { return '<p class="sub ws-rev">' + esc(r.decision) + (r.action ? ' (' + esc(r.action) + ')' : '') + (r.reason ? ': ' + esc(r.reason) : '') + ' · lesson ' + esc(r.lesson_scope) + '</p>'; }).join('') +
        (editable ? '<div class="ws-edit"><select class="ws-action" data-k="' + k + '">' + ACTIONS.map(function (a) { return '<option value="' + a[0] + '">' + esc(a[1]) + '</option>'; }).join('') + '</select> ' +
          '<input class="ws-reason" data-k="' + k + '" placeholder="Reason" maxlength="1000"> <select class="ws-scope" data-k="' + k + '"><option value="local">Lesson: this script only</option><option value="reusable">Lesson: reusable</option></select> ' +
          '<button type="button" data-ws="rewrite" data-k="' + k + '">Ask for this rewrite</button><br>' +
          '<select class="ws-review" data-k="' + k + '">' + REVIEWS.map(function (a) { return '<option value="' + a[0] + '">' + esc(a[1]) + '</option>'; }).join('') + '</select> ' +
          '<input class="ws-fids" data-k="' + k + '" placeholder="Finding ids (comma)" maxlength="400"> ' +
          '<button type="button" data-ws="review" data-k="' + k + '">Save review</button></div>' : '') + '</div>';
    }).join('') + '</div>';
    var wc = c.word_counts || {}, total = 0;
    var right = '<div class="ws-right"><h4>Support checks</h4>' + checksBox(c) +
      '<p>Spoken words: <b class="ws-spokenwords">' + esc(wc.spoken_words) + '</b> · notes and sources: ' + esc(wc.notes_and_source_words) + '</p>' +
      ((c.warnings || []).length ? '<ul class="ws-warn">' + c.warnings.map(function (w) { return '<li>' + esc(w.type) + ': ' + esc(w.detail) + '</li>'; }).join('') + '</ul>' +
        '<p class="sub">Warnings are automated assessments, not factual findings.</p>' : '<p class="sub">No rhythm warnings.</p>') +
      ((c.high_risk || []).length ? '<p class="ws-risk">High-risk wording: ' + c.high_risk.map(function (h) { return esc(h.term) + ' (passage ' + (h.segment + 1) + ')'; }).join(', ') + '</p>' : '') +
      '<h4>Rubric</h4><p class="sub">' + esc((o.rubric || {}).label || 'Provisional internal criteria, not validated performance benchmarks') + '</p>' +
      '<table class="ws-rubric">' + DIMS.map(function (d) { return '<tr><td>' + esc(d[1]) + '</td><td><input type="number" min="0" max="4" step="1" class="ws-dim" data-d="' + d[0] + '"' + (editable ? '' : ' disabled') + '></td></tr>'; }).join('') + '</table>' +
      '<p class="sub">Gates: ' + ((o.rubric || {}).gates || []).map(esc).join(' · ') + '</p>' +
      (editable && !st.current ? '<p><label><input type="checkbox" id="ws-ack"> I confirm the high-risk wording is supported by the cited findings</label></p>' +
        '<p><button type="button" data-ws="approve-script" data-id="' + esc(s.id) + '">Approve this exact version</button></p>' : '') +
      '<h4>Lessons</h4>' + ((s.lesson_uses || []).length ? '<table class="ws-uses"><tr><th>Lesson</th><th>Retrieved</th><th>Included in prompt</th><th>Automated assessment</th><th>Your review</th></tr>' +
        s.lesson_uses.map(function (u) {
          return '<tr><td>' + esc(lessonText(o, u.lesson_id)) + '</td><td>' + (u.retrieved ? 'yes' : 'no') + '</td><td>' + (u.included ? 'yes' : 'no') + '</td><td>' +
            esc(u.assessed) + ' (' + esc(u.assessed_by) + ')' + (u.assessment_note ? ' — ' + esc(u.assessment_note) : '') + '</td><td>' + esc(u.reviewer_decision) +
            (u.reviewer_decision === 'pending' ? ' <button type="button" data-ws="use" data-d="confirmed" data-id="' + esc(u.id) + '">Confirm</button>' +
              ' <button type="button" data-ws="use" data-d="corrected" data-id="' + esc(u.id) + '">Correct</button>' : '') + '</td></tr>';
        }).join('') + '</table>' : '<p class="ws-empty">No lessons retrieved.</p>') + '</div>';
    var rewrites = (o.corrections || []).filter(function (r) { return r.decision === 'rewrite' && (r.script_id === s.id || r.result_script_id === s.id); });
    var bottom = '<div class="ws-bottom"><h4>Before and after</h4>' + (rewrites.length ? rewrites.map(function (r) {
        var lab = (ACTIONS.filter(function (a) { return a[0] === r.action; })[0] || [0, r.action])[1];
        return '<div class="ws-ba"><p><b>' + esc(lab) + '.</b> ' + esc(r.reason || '') + ' <span class="sub">Findings kept: ' + esc((r.finding_ids || []).join(', ')) + ' · lesson ' + esc(r.lesson_scope) + '</span></p>' +
          '<div class="ws-ba-grid"><div><p class="sub">Before</p><p class="ws-before">' + esc(r.before_text) + '</p></div><div><p class="sub">After</p><p class="ws-after">' +
          (r.after_text ? esc(r.after_text) : '<i>waiting for the rewrite</i>') + '</p></div></div></div>'; }).join('') : '<p class="ws-empty">No rewrites on this version.</p>') +
      '<h4>Version history</h4><table class="ws-hist"><tr><th>Version</th><th>Written</th><th>Status</th><th></th></tr>' + scripts.map(function (v, i) {
        return '<tr' + (v.id === s.id ? ' class="ws-here"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(String(v.created_at || '').slice(0, 16).replace('T', ' ')) + '</td><td>' +
          esc(statusLabel(v.status)) + '</td><td>' + (v.id === s.id ? 'open' : '<button type="button" data-ws="open" data-id="' + esc(v.id) + '">Open</button>') + '</td></tr>'; }).join('') + '</table>' +
      '<h4>Review decision</h4>' + ((s.approvals || []).length ? (s.approvals || []).map(function (a) {
        return '<p class="sub">' + (a.this_version ? 'Approved this version' : 'Approved an earlier text') + ' · ' + esc(a.approved_by) + ' · ' + esc(String(a.approved_at).slice(0, 10)) +
          (a.rubric ? ' · rubric ' + Object.keys(a.rubric).reduce(function (t, k) { return t + (+a.rubric[k] || 0); }, 0) + '/28' : '') + (a.note ? ' — ' + esc(a.note) : '') + '</p>'; }).join('') : '<p class="ws-empty">No decision on this version.</p>') +
      viewMeasurement(o) + '</div>';
    return html + '<div class="ws-grid">' + left + center + right + '</div>' + bottom + '</div>';
  }
  function viewMeasurement(o) {
    var m = o.measurement || {}, me = m.mechanical || {}, h = m.human || {}, ed = m.editing || {};
    return '<h4>Measurement (kept apart)</h4><ul class="ws-meas"><li>Mechanical compliance: ' + esc(me.checks_passed) + ' of ' + esc(me.script_versions) + ' script versions passed the checks</li>' +
      '<li>Human editorial acceptance: ' + esc(h.approvals) + ' approval(s)' + ((h.rubric_totals || []).length ? ', rubric totals ' + h.rubric_totals.map(esc).join(', ') : '') + '</li>' +
      '<li>Editing: ' + esc(ed.rewrites) + ' rewrite(s), ' + esc(ed.reviews) + ' review(s). ' + esc(ed.note || '') + '</li>' +
      '<li>Audience outcomes: ' + ((m.audience || {}).status === 'not_collected' ? 'not collected' : esc((m.audience || {}).status)) + '</li></ul>' +
      '<p class="sub">No virality or improvement is claimed from a model\'s self-score or from fixture results.</p>';
  }
  function viewLessons(o) {
    var cs = o.corrections || [];
    cs = cs.filter(function (c) { return c.after_text && c.lesson_scope === 'reusable'; });
    return '<div class="card" id="ws-lessons"><h3>7 · Lessons</h3><p class="sub">Only a review you marked reusable, with a before and an after, can become a lesson. It is used only after you approve it.</p>' +
      (cs.length ? cs.map(function (c) {
        return '<div class="ws-corrbox"><p class="sub">Before: ' + esc(c.before_text) + '</p><p class="sub">After: ' + esc(c.after_text) + '</p>' +
          '<label>Lesson <input class="ws-ltext" data-cid="' + esc(c.id) + '" maxlength="1000"></label> ' +
          '<label>Phrase to avoid (optional) <input class="ws-lavoid" data-cid="' + esc(c.id) + '" maxlength="200"></label> ' +
          '<button type="button" data-ws="lesson" data-cid="' + esc(c.id) + '">Propose as a lesson</button></div>';
      }).join('') : '<p class="ws-empty">No reusable reviews yet.</p>') +
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
      viewRequest(o) + viewFindings(o) + viewProfile(o) + viewAngles(o) + viewOutline(o) + viewEditor(o) + viewLessons(o) + '</div>';
  }

  function currentScript() {
    var o = S.o || {}, scripts = vs(o, 'script');
    return byId(o, S.sel) || scripts.filter(function (v) { return !(v.status || {}).superseded; }).slice(-1)[0] || scripts.slice(-1)[0];
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
    if (a === 'angles') return act(rpc('hs_weekly_angles_request', { p_library_version: b.getAttribute('data-lv'), p_profile: b.getAttribute('data-pf'), p_parent: b.getAttribute('data-parent') || null }));
    if (a === 'approve-angle') {
      var pick = q('input[name="ws-angle"]:checked'); if (!pick) return fail(new Error('Select one angle card first.'));
      return act(rpc('hs_weekly_version_approve', { p_version: b.getAttribute('data-id'), p_selected: +pick.value, p_rubric: null, p_high_risk_ack: !!(q('#ws-angle-ack') || {}).checked, p_note: null }));
    }
    if (a === 'outline') return act(rpc('hs_weekly_outline_request', { p_angles: b.getAttribute('data-id'), p_parent: b.getAttribute('data-parent') || null }));
    if (a === 'approve-version') return act(rpc('hs_weekly_version_approve', { p_version: b.getAttribute('data-id'), p_selected: null, p_rubric: null, p_high_risk_ack: false, p_note: null }));
    if (a === 'draft') return act(rpc('hs_weekly_script_request', { p_outline: b.getAttribute('data-id') }));
    if (a === 'open') { S.sel = b.getAttribute('data-id'); return render(); }
    if (a === 'approve-script') {
      var rub = {}, missing = false;
      Array.prototype.forEach.call(S.el.querySelectorAll('.ws-dim'), function (i) { if (i.value === '') missing = true; rub[i.getAttribute('data-d')] = +i.value; });
      if (missing) return fail(new Error('Score all seven rubric dimensions first.'));
      return act(rpc('hs_weekly_version_approve', { p_version: b.getAttribute('data-id'), p_selected: null, p_rubric: rub, p_high_risk_ack: !!(q('#ws-ack') || {}).checked, p_note: null }));
    }
    if (a === 'rewrite' || a === 'review') {
      var s0 = currentScript(), kk = b.getAttribute('data-k'), reason = q('.ws-reason[data-k="' + kk + '"]').value.trim();
      if (a === 'rewrite') {
        if (!reason) return fail(new Error('Say why the passage needs this rewrite.'));
        var seg = s0.body.segments[+kk] || {};
        return act(rpc('hs_weekly_passage_review', { p_script: s0.id, p_segment: +kk, p_decision: 'rewrite', p_reason: reason,
          p_action: q('.ws-action[data-k="' + kk + '"]').value, p_finding_ids: seg.claim_ids || [], p_lesson_scope: q('.ws-scope[data-k="' + kk + '"]').value, p_after: null }));
      }
      var fids = q('.ws-fids[data-k="' + kk + '"]').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      return act(rpc('hs_weekly_passage_review', { p_script: s0.id, p_segment: +kk, p_decision: q('.ws-review[data-k="' + kk + '"]').value, p_reason: reason || null,
        p_action: null, p_finding_ids: fids, p_lesson_scope: q('.ws-scope[data-k="' + kk + '"]').value, p_after: null }));
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
      '.ws-uses,.ws-hist,.ws-rubric{border-collapse:collapse;font-size:12.5px;display:block;overflow-x:auto}.ws-uses td,.ws-uses th,.ws-hist td,.ws-hist th{border:1px solid var(--line);padding:3px 6px}' +
      '.ws-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px}.ws-card{display:block;border:1px solid var(--line);border-radius:10px;padding:8px;font-size:13px}' +
      '.ws-card dt{font-weight:600;font-size:12px;margin-top:4px}.ws-card dd{margin:0}.ws-picked{outline:2px solid #2d6a4f}.ws-risk{color:#8a2b24;font-size:12.5px}' +
      '.ws-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) minmax(0,1fr);gap:12px}.ws-left,.ws-right,.ws-center{min-width:0}' +
      '.ws-seg{border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin:6px 0}.ws-beat{font-size:11.5px;text-transform:uppercase;color:var(--muted);margin:0}' +
      '.ws-edit select,.ws-edit input{font:inherit;font-size:12.5px;margin:2px 0;max-width:100%}.ws-ba-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      '.ws-before{background:#fbefee;padding:6px;border-radius:6px}.ws-after{background:#eef7f1;padding:6px;border-radius:6px}.ws-here td{font-weight:600}' +
      '.ws-rubric input{width:3.5em}@media (max-width:820px){.ws-grid,.ws-ba-grid{grid-template-columns:minmax(0,1fr)}}';
    document.head.appendChild(st);
  }

  function mount(client, el) {
    if (!el || !client) return;
    css();
    S = { client: client, el: el, o: null, err: '', busy: false, sel: null };
    if (!el.__wsBound) { el.addEventListener('click', onClick); el.__wsBound = true; }
    render();
    return reload();
  }

  HS.acqWeeklySlice = { mount: mount, requestText: requestText, TOPIC: TOPIC, ANSWER_FORMAT: ANSWER_FORMAT, RULES: RULES };
})();
