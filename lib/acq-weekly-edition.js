/* Jody Acquisition Dashboard, Tab 20 · Weekly Report — THE EDITION'S VIDEO SEQUENCE (one video, several topics).

   TEST-ONLY PHASE: no page loads this module. Its local harness (test/weekly-workbench-harness.browser.mjs) mounts it
   against a disposable database. Mounting it in Tab 20 is a later step, coordinated with the topic-queue session.

   It reads and writes only through the admin functions of docs/weekly-8-edition-sequence.sql (and 9, when installed):
     hs_weekly_edition_video           the saved sequence, its problems, digest and approval, the display derived from it
                                       (topics once in order of first appearance; a section card at every topic change),
                                       and the approved content that belongs to the edition (candidates)
     hs_weekly_edition_sequence_set    saves a new sequence (the database refuses one with problems)
     hs_weekly_edition_sequence_approve approves the saved sequence; it sends the digest shown on this screen, so an
                                       approval can only name what the person saw
     hs_weekly_edition_topics          the topics the edition covers (file 9; optional)
   It holds no approval of its own: "approved" on this screen is always the database's answer, read back after every action.
   An order changed here and not yet saved is shown as unsaved and cannot be approved. Nothing here narrates or renders. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  var S = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function short(id) { return String(id || '').slice(0, 8); }
  function rpc(name, args) {
    return S.client.rpc(name, args).then(function (r) {
      if (r && r.error) { var e = new Error(r.error.message || 'request failed'); e.code = r.error.code; throw e; }
      return r ? r.data : null;
    });
  }
  function css() {
    if (document.getElementById('we-css')) return;
    var st = document.createElement('style'); st.id = 'we-css';
    st.textContent = '.we{border:1px solid #d9e2dc;border-radius:10px;padding:14px 16px;margin:12px 0;background:#fff}' +
      '.we h3{margin:0 0 6px}.we .sub{color:#4a5a52;font-size:13px}.we table{border-collapse:collapse;width:100%;margin:8px 0}' +
      '.we td,.we th{border-top:1px solid #eef2ef;padding:6px;vertical-align:top;text-align:left;font-size:14px}' +
      '.we .card{display:inline-block;background:#157a49;color:#fff;border-radius:6px;padding:1px 8px;font-size:12px;font-weight:700}' +
      '.we .ok{color:#157a49;font-weight:700}.we .bad{color:#b91c1c;font-weight:700}.we .unsaved{background:#fffbeb;border:1px solid #f0c674;padding:6px 10px;border-radius:6px}' +
      '.we code{font:12px ui-monospace,monospace}.we .seg{color:#4a5a52;font-size:13px}.we button{margin:2px}';
    document.head.appendChild(st);
  }

  function saved() { return (S.v && S.v.sequence && S.v.sequence.entries) || []; }
  function working() { return S.draft || saved(); }
  function cand(id) { return ((S.v && S.v.candidates) || []).filter(function (c) { return c.version_id === id; })[0]; }
  function segText(e) {
    var c = cand(e.version_id); if (!c) return '(this version is not among the edition\'s approved content)';
    return c.segments.slice(e.from, e.to + 1).map(function (g) { return g.text; }).join(' ');
  }
  function used() {
    var u = {}; working().forEach(function (e) { for (var g = e.from; g <= e.to; g++) u[e.version_id + ':' + g] = true; }); return u;
  }

  function viewStatus() {
    var v = S.v || {};
    if (S.draft) return '<p class="unsaved" id="we-status"><b>Unsaved changes.</b> Save the sequence to check it; only a saved sequence can be approved.</p>';
    if (!v.sequence) return '<p id="we-status">No sequence yet. Choose approved content below and save it.</p>';
    var probs = (v.problems || []);
    return '<div id="we-status">' + (v.approved
      ? '<p class="ok">Approved: this exact sequence and content (digest <code>' + esc(short(v.digest)) + '</code>) by ' + esc(v.approval.approved_by) + '.</p>'
      : '<p class="bad">Not approved: ' + esc(v.why_not) + '.</p>') +
      (probs.length ? '<ul class="bad">' + probs.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
      (!v.approved && !probs.length ? '<p>Reviewing digest <code id="we-digest">' + esc(v.digest) + '</code> ' +
        '<button type="button" data-we="approve">Approve this exact sequence</button></p>' : '') + '</div>';
  }

  function viewOrder() {
    var v = S.v || {}, rows = working(), items = S.draft ? null : (v.items || []);
    if (!rows.length) return '<p class="sub">Nothing in the video yet.</p>';
    return '<table id="we-order"><tr><th>#</th><th>Topic</th><th>Content</th><th></th></tr>' + rows.map(function (e, i) {
      var c = cand(e.version_id) || {}, it = items && items[i];
      return '<tr data-row="' + i + '"><td>' + (i + 1) + '</td><td>' + (it && it.section_card ? '<span class="card">Section card</span> ' : '') + esc(c.topic || (it && it.topic) || '?') + '</td>' +
        '<td><code>' + esc(short(e.version_id)) + '</code> segment' + (e.from === e.to ? ' ' + (e.from + 1) : 's ' + (e.from + 1) + '–' + (e.to + 1)) +
        '<div class="seg">' + esc(segText(e)) + '</div></td>' +
        '<td><button type="button" data-we="up" data-i="' + i + '"' + (i ? '' : ' disabled') + '>Move up</button>' +
        '<button type="button" data-we="down" data-i="' + i + '"' + (i < rows.length - 1 ? '' : ' disabled') + '>Move down</button>' +
        '<button type="button" data-we="remove" data-i="' + i + '">Remove</button></td></tr>';
    }).join('') + '</table>' + (S.draft ? '' : '<p class="sub" id="we-topics">Opening and thumbnail list each topic once: <b>' + esc((v.topics || []).join(', ')) + '</b>. ' +
      'A section card is shown wherever the topic changes.</p>');
  }

  function viewCandidates() {
    var cs = (S.v && S.v.candidates) || [], u = used();
    if (!cs.length) return '<p class="sub">No approved script version belongs to this edition yet. Link approved versions to it in the topic queue.</p>';
    return cs.map(function (c) {
      return '<div class="we-cand" data-version="' + esc(c.version_id) + '"><p><b>' + esc(c.topic) + '</b> · approved version <code>' + esc(short(c.version_id)) + '</code></p>' +
        c.segments.map(function (g) {
          var taken = u[c.version_id + ':' + g.n];
          return '<label class="seg"><input type="checkbox" class="we-pick" data-version="' + esc(c.version_id) + '" data-n="' + g.n + '"' + (taken ? ' disabled' : '') + '> ' +
            'Segment ' + (g.n + 1) + (g.document_cue ? ' (document visual)' : '') + (taken ? ' — already in the video' : '') + ': ' + esc(g.text) + '</label><br>';
        }).join('') + '</div>';
    }).join('');
  }

  function render() {
    var v = S.v || {};
    S.el.setAttribute('data-busy', S.busy ? '1' : '0');
    S.el.innerHTML = '<div class="we"><h3>Edition video: ' + esc(v.edition_key || '') + '</h3>' +
      '<p class="sub">' + esc(v.series || '') + ' · ' + esc(v.period_start || '') + ' to ' + esc(v.period_end || '') +
      (S.covered ? ' · covers ' + esc(S.covered.join(', ')) : '') + '. The video follows the order below exactly; nothing is regrouped.</p>' +
      (S.err ? '<p class="bad" role="alert" id="we-err">' + esc(S.err) + '</p>' : '') +
      (S.msg ? '<p class="ok" role="status" id="we-msg">' + esc(S.msg) + '</p>' : '') +
      viewStatus() + '<h4>Video order</h4>' + viewOrder() +
      '<p><button type="button" data-we="save"' + (S.draft ? '' : ' disabled') + '>Save sequence</button>' +
      (S.draft ? ' <button type="button" data-we="discard">Discard changes</button>' : '') + '</p>' +
      '<h4>Approved content for this edition</h4>' + viewCandidates() +
      '<p><button type="button" data-we="add">Add the chosen segments to the end</button></p>' +
      '<p class="sub">Nothing here narrates, renders or publishes.</p></div>';
  }

  function reload() {
    return rpc('hs_weekly_edition_video', { p_edition: S.edition }).then(function (v) {
      S.v = v; S.draft = null;
      return rpc('hs_weekly_edition_topics', { p_edition: S.edition }).then(function (t) { S.covered = t && t.topics; }, function () { S.covered = null; });
    }).then(render, function (e) { S.err = e.message; render(); });
  }
  // After any action, success or refusal, the screen is read back from the database, so it never shows a state the
  // database does not hold (a refused approval shows what changed).
  function act(p, msg) {
    S.err = ''; S.msg = ''; S.busy = true; render();
    return p.then(function () { return reload().then(function () { S.msg = msg; }); },
                  function (e) {
                    var m = e.code === '40001' ? 'The sequence or its content changed since you reviewed it; review it again.' : e.message;
                    return reload().then(function () { S.err = m; });
                  }).then(function () { S.busy = false; render(); });
  }
  function edit(fn) { var d = working().map(function (e) { return { version_id: e.version_id, from: e.from, to: e.to }; }); fn(d); S.draft = d; S.err = ''; S.msg = ''; render(); }

  function onClick(ev) {
    var b = ev.target.closest('[data-we]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-we'), i = +b.getAttribute('data-i');
    if (a === 'up') return edit(function (d) { var x = d[i]; d[i] = d[i - 1]; d[i - 1] = x; });
    if (a === 'down') return edit(function (d) { var x = d[i]; d[i] = d[i + 1]; d[i + 1] = x; });
    if (a === 'remove') return edit(function (d) { d.splice(i, 1); });
    if (a === 'discard') { S.draft = null; return render(); }
    if (a === 'add') {
      var picks = Array.prototype.slice.call(S.el.querySelectorAll('.we-pick:checked')).map(function (x) { return { v: x.getAttribute('data-version'), n: +x.getAttribute('data-n') }; });
      if (!picks.length) { S.err = 'Choose at least one segment.'; return render(); }
      return edit(function (d) {   // each run of consecutive segments of one version becomes one entry, in the order chosen
        picks.forEach(function (p) {
          var last = d[d.length - 1];
          if (last && last.version_id === p.v && last.to === p.n - 1) last.to = p.n; else d.push({ version_id: p.v, from: p.n, to: p.n });
        });
      });
    }
    if (a === 'save') return act(rpc('hs_weekly_edition_sequence_set', { p_edition: S.edition, p_entries: S.draft }), 'Sequence saved. It is not approved until you approve it.');
    if (a === 'approve') return act(rpc('hs_weekly_edition_sequence_approve', { p_edition: S.edition, p_digest: S.v.digest }), 'Approved.');
  }

  function mount(client, el, opts) {
    if (!el || !client || !opts || !opts.edition) return null;
    css();
    S = { client: client, el: el, edition: opts.edition, v: null, draft: null, err: '', msg: '', covered: null, busy: false };
    el.addEventListener('click', onClick);
    return reload();
  }
  HS.acqWeeklyEdition = { mount: mount };
})();
