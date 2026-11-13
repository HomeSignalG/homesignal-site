/* Acquisition Dashboard Tab 17 — the data-center PROJECT CHECK inside each Hot Topics tile (stage 3, 2026-11-13).
 *
 * For a topic in category data_centers it shows what the verification job (scripts/impact-dc-verify.mjs) found: the project,
 * where it is, its status as JODY's map shows it, the check's outcome and gaps, the stable Map 1 project link, an editable
 * reply, and the documents on file for review. It decides nothing itself: every fact, every "ready" and every "stale" comes
 * from public.hs_impact_dc_verification_state (docs/impact-dc-verification.sql).
 *
 * Writes only through four admin functions: Recheck (hs_impact_dc_verification_recheck), saving the founder's own reply wording
 * (hs_impact_dc_reply_save), and document decisions (hs_map1_project_document_decide). Approving a document means it belongs
 * to the project and may be shown on Map 1; it never changes the project's status. Nothing here posts anything: the reply is
 * copied and posted by hand.
 *
 * Mounted by lib/acq-impact-discovery.js: block(c) inside card(c), load(ids) after each overview load, onClick for [data-dcv].
 */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  var S = { client: null, rerender: null, by: {}, docs: {}, drafts: {}, open: {}, msg: {}, busy: {}, missing: false, err: null, focus: null };
  var OUTCOME = {
    verified: ['Verified', 'ok'], needs_review: ['Needs review: which project', 'bad'],
    missing_documentation: ['Missing documentation', 'wait'], missing_website_connection: ['Missing website connection', 'bad'],
    check_failed: ['The check could not finish', 'bad'] };
  var JOB = { queued: 'Waiting to run', running: 'Checking now', done: 'Done', gave_up: 'Stopped after 3 failed attempts', retired: 'No longer checked' };
  var DOC_STATE = { pending: ['Waiting for your review', 'wait'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], revoked: ['Revoked', 'bad'] };
  var REPLY_LIMIT = 300;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function safe(u) { return /^https:\/\//i.test(String(u || '')) ? String(u) : null; }
  function when(v) {
    if (!v) return '—';
    var d = new Date(v); if (isNaN(d)) return '—';
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function day(v) { var d = v && new Date(String(v).length === 10 ? v + 'T12:00:00Z' : v); return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''; }
  function badge(p) { return '<span class="is-badge ' + (p ? p[1] : 'wait') + '">' + esc(p ? p[0] : '') + '</span>'; }
  function graphemes(s) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(String(s))).length;
    return Array.from(String(s)).length;
  }
  function errText(e) { return (e && (e.message || e.details)) || 'Something went wrong. Nothing was changed.'; }
  function notInstalled(e) { return !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message || '')); }
  function rpc(name, args) { return S.client.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function redraw() { if (S.rerender) S.rerender(); }

  function load(ids) {
    if (!S.client || S.missing) return Promise.resolve();
    ids = (ids || []).filter(Boolean);
    if (!ids.length) return Promise.resolve();
    return rpc('hs_impact_dc_verification_state', { p_candidates: ids }).then(function (rows) {
      S.err = null;
      var seen = {};
      (rows || []).forEach(function (r) { S.by[r.candidate_id] = r; seen[r.candidate_id] = 1; });
      ids.forEach(function (id) { if (!seen[id]) S.by[id] = null; });
    }, function (e) { if (notInstalled(e)) S.missing = true; else S.err = errText(e); });
  }

  // The reply the box shows: the founder's saved wording, else what they are typing, else the suggestion.
  function replyText(c, v) {
    if (S.drafts[c.id] != null) return S.drafts[c.id];
    if (v && v.reply_edit && v.reply_edit.text) return v.reply_edit.text;
    return (v && v.result && v.result.reply && v.result.reply.text) || '';
  }

  function block(c) {
    if (!c || c.category !== 'data_centers') return '';
    var head = '<div class="is-sec dcv" id="dcv-' + esc(c.id) + '" aria-label="Project check"><div class="is-row" style="justify-content:space-between"><b>Project check</b>';
    if (S.missing) return head + '</div><p class="is-muted">The project check is not set up yet.</p></div>';
    if (S.err && !(c.id in S.by)) return head + '</div><div class="is-block" role="alert">The project check could not load: ' + esc(S.err) + '</div></div>';
    if (!(c.id in S.by)) return head + '</div><p class="is-muted">Loading…</p></div>';
    var v = S.by[c.id];
    var lead = safe(c.lead_url);
    var leadBtn = lead ? '<a class="is-btn" href="' + esc(lead) + '" target="_blank" rel="noopener noreferrer">Open original post</a>' : '';
    if (!v) return head + '</div><p class="is-muted">This topic has not been checked yet. It is queued when the project check is switched on.</p>' +
      '<div class="is-row">' + leadBtn + '<button class="is-btn" data-dcv="recheck" data-id="' + esc(c.id) + '">Recheck</button></div>' + msg(c) + '</div>';
    var r = v.result || {}, job = v.job || {}, p = r.project || {}, m = r.match || {};
    var fresh = v.freshness === 'current' ? '<span class="is-badge ok">Up to date</span>'
      : v.freshness === 'stale' ? '<span class="is-badge wait">Out of date</span>' : '<span class="is-badge wait">Not checked yet</span>';
    var out = head + '<span class="is-row">' + (r.outcome ? badge(OUTCOME[r.outcome]) : '') + fresh + '</span></div>';
    out += '<div class="is-muted">Verification checked ' + esc(when(v.last_success_at)) + ' · ' + esc(JOB[job.status] || job.status || '') +
      (job.status === 'queued' && job.next_attempt_at ? ' (next try ' + esc(when(job.next_attempt_at)) + ')' : '') + '</div>';
    if (v.freshness === 'stale' && (v.stale_reasons || []).length) {
      out += '<div class="is-warnbox"><b>This result is out of date.</b><ul class="is-list">' + v.stale_reasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }
    if (v.result) {
      out += '<dl class="dcv-facts">' +
        '<dt>Project</dt><dd>' + esc(p.name || (m.state === 'ambiguous' ? 'More than one possible project' : 'Not identified')) + '</dd>' +
        '<dt>Location</dt><dd>' + esc(p.location_text || '—') + (m.zip ? ' · ZIP ' + esc(m.zip) : '') + '</dd>' +
        '<dt>Current status</dt><dd>' + (p.status ? esc(p.status) + ' <span class="is-muted">(as JODY\'s map shows it' + (p.source_name ? ', listed by ' + esc(p.source_name) : '') + ')</span>' : '—') + '</dd>' +
        '<dt>Project check</dt><dd>' + esc((OUTCOME[r.outcome] || ['—'])[0]) + '</dd></dl>';
      if ((r.gaps || []).length) out += '<p style="margin:4px 0"><b>What is missing</b></p><ul class="is-list">' + r.gaps.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>';
      if (m.state === 'ambiguous' && (m.alternatives || []).length) {
        out += '<p class="is-muted">Possible projects: ' + m.alternatives.map(function (a) { return esc((a.name || a.map_key) + (a.zips && a.zips.length ? ' (ZIP ' + a.zips.join(', ') + ')' : '')); }).join('; ') + '</p>';
      }
    }
    var link = v.link_available && r.link && safe(r.link.url);
    out += '<div class="is-row" style="margin-top:6px">' +
      (link ? '<a class="is-btn primary" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Open project on JODY</a>' +
              '<button class="is-btn" data-dcv="copy-link" data-id="' + esc(c.id) + '">Copy project link</button>'
            : '<span class="is-muted">' + (v.freshness === 'stale' && r.link && r.link.available ? 'The project link is shown again after a fresh check.' : 'No project link yet.') + '</span>') +
      leadBtn + '</div>';
    out += replyBox(c, v);
    out += '<div class="is-row" style="margin-top:6px"><button class="is-btn" data-dcv="recheck" data-id="' + esc(c.id) + '"' +
      (job.status === 'running' ? ' disabled' : '') + '>' + (S.busy[c.id] === 'recheck' ? 'Asking…' : 'Recheck') + '</button>' +
      (m.project_key ? '<button class="is-btn" data-dcv="docs" data-id="' + esc(c.id) + '" aria-expanded="' + !!S.open[c.id] + '">Documents on file</button>' : '') + '</div>';
    if (S.open[c.id] && m.project_key) out += docsBox(c, m.project_key);
    return out + msg(c) + '</div>';
  }

  function replyBox(c, v) {
    var r = v.result || {}, e = v.reply_edit, text = replyText(c, v), n = graphemes(text);
    var suggested = r.reply && r.reply.text;
    if (!suggested && !(e && e.text)) return '<p class="is-muted" style="margin-top:6px">No reply is suggested until the project link is confirmed.</p>';
    var flags = [];
    if (e && e.text) {
      flags.push('You edited this reply on ' + when(e.saved_at) + '.');
      if (e.link_changed) flags.push('The project link changed since you edited it.');
      if (e.facts_changed) flags.push('The project\'s details changed since you edited it. Read it again before posting.');
      if (!e.has_current_link && r.link && r.link.url) flags.push('Your reply does not contain the current project link.');
    }
    var copyBlock = !v.reply_ready ? (v.freshness === 'stale' ? 'The reply can be copied again after a fresh check.' : 'Not ready to post: see what is missing above.')
      : (S.drafts[c.id] == null && e && e.text && !e.has_current_link) ? 'Add the current project link to your reply first.'
      : n > REPLY_LIMIT ? 'Too long for Bluesky.' : null;
    var dirty = S.drafts[c.id] != null && S.drafts[c.id] !== ((e && e.text) || suggested || '');
    return '<label class="dcv-reply" style="display:block;margin-top:8px"><b>Reply</b> <span class="is-muted">(copy it and post it yourself; nothing is posted from here)</span>' +
      '<textarea id="dcv-reply-' + esc(c.id) + '" data-dcv-reply="' + esc(c.id) + '" rows="4" class="is-in">' + esc(text) + '</textarea></label>' +
      '<div class="is-muted"><span class="' + (n > REPLY_LIMIT ? 'is-bad' : '') + '">' + n + ' / ' + REPLY_LIMIT + ' characters</span></div>' +
      (flags.length ? '<div class="is-warnbox"><ul class="is-list">' + flags.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="is-row" style="margin-top:4px">' +
      '<button class="is-btn primary" data-dcv="copy-reply" data-id="' + esc(c.id) + '"' + (copyBlock || dirty ? ' disabled' : '') + '>Copy reply</button>' +
      '<button class="is-btn" data-dcv="save-reply" data-id="' + esc(c.id) + '"' + (dirty ? '' : ' disabled') + '>Save my wording</button>' +
      (e && e.text || S.drafts[c.id] != null ? '<button class="is-btn" data-dcv="reset-reply" data-id="' + esc(c.id) + '">Use the suggested reply</button>' : '') +
      '</div>' + (dirty ? '<div class="is-muted">Save your wording before copying it.</div>' : copyBlock ? '<div class="is-muted">' + esc(copyBlock) + '</div>' : '');
  }

  function docsBox(c, key) {
    var d = S.docs[key];
    if (!d) return '<div class="is-sec"><p class="is-muted">Loading documents…</p></div>';
    if (d.err) return '<div class="is-sec"><div class="is-block">' + esc(d.err) + '</div></div>';
    if (!d.list.length) return '<div class="is-sec"><p class="is-muted">No documents are on file for this project yet.</p></div>';
    return '<div class="is-sec"><p class="is-muted">Approving a document means it belongs to this project and may be shown on JODY\'s map. It never changes the project\'s status.</p><ul class="is-list">' +
      d.list.map(function (x) {
        var u = safe(x.url), st = x.state || 'pending';
        var acts = st === 'pending' ? ['approve', 'reject'] : st === 'rejected' ? ['approve'] : st === 'approved' ? ['revoke'] : st === 'revoked' ? ['approve'] : [];
        return '<li>' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(x.title || u) + '</a>' : esc(x.title)) +
          ' ' + badge(DOC_STATE[st]) + '<div class="is-muted">' + esc(x.publisher || '') +
          (x.doc_date && day(x.doc_date) ? ' · ' + esc(x.doc_date_label || 'Document date') + ' ' + esc(day(x.doc_date)) : '') +
          ' · proposed ' + esc(when(x.proposed_at)) + '</div>' +
          (x.supports ? '<div class="is-muted">' + esc(x.supports) + '</div>' : '') +
          '<div class="is-row">' + acts.map(function (a) {
            return '<button class="is-btn' + (a === 'approve' ? '' : ' warn') + '" data-dcv="doc" data-a="' + a + '" data-doc="' + esc(x.document_id) +
              '" data-id="' + esc(c.id) + '">' + (a === 'approve' ? 'Approve' : a === 'reject' ? 'Reject' : 'Revoke') + '</button>';
          }).join('') + '</div></li>';
      }).join('') + '</ul></div>';
  }
  function msg(c) { var m = S.msg[c.id]; return m ? '<div class="' + (m.bad ? 'is-block' : 'is-okbox') + '" role="status">' + esc(m.text) + '</div>' : ''; }

  function loadDocs(key) {
    return rpc('hs_impact_dc_project_documents', { p_project_key: key }).then(function (l) { S.docs[key] = { list: l || [] }; },
      function (e) { S.docs[key] = { err: errText(e) }; });
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, bad) {
      var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      var done = false; try { done = document.execCommand('copy'); } catch (e) { done = false; }
      document.body.removeChild(t); done ? ok() : bad(new Error('Copy did not work; select the text and copy it by hand.'));
    });
  }
  function say(id, text, bad) { S.msg[id] = { text: text, bad: !!bad }; redraw(); }

  function onClick(ev) {
    var t = ev.target.closest('[data-dcv]'); if (!t) return false;
    var a = t.getAttribute('data-dcv'), id = t.getAttribute('data-id'), v = S.by[id];
    var r = (v && v.result) || {};
    ev.preventDefault();
    S.msg[id] = null;
    if (a === 'copy-link') {
      return copy(r.link && r.link.url).then(function () { say(id, 'Project link copied.'); }, function (e) { say(id, errText(e), true); }), true;
    }
    if (a === 'copy-reply') {
      var text = replyText({ id: id }, v);
      if (!v || !v.reply_ready) { say(id, 'This reply is not ready to post.', true); return true; }
      return copy(text).then(function () { say(id, 'Reply copied. Post it from Bluesky yourself.'); }, function (e) { say(id, errText(e), true); }), true;
    }
    if (a === 'save-reply' || a === 'reset-reply') {
      var body = a === 'save-reply' ? (S.drafts[id] || '') : '';
      if (a === 'save-reply' && graphemes(body) > REPLY_LIMIT) { say(id, 'The reply is longer than Bluesky allows.', true); return true; }
      return rpc('hs_impact_dc_reply_save', { p_candidate: id, p_text: body }).then(function () {
        delete S.drafts[id];
        return load([id]).then(function () { say(id, a === 'save-reply' ? 'Your wording is saved. A new check will not replace it.' : 'Back to the suggested reply.'); });
      }, function (e) { say(id, errText(e), true); }), true;
    }
    if (a === 'recheck') {
      S.busy[id] = 'recheck'; redraw();
      return rpc('hs_impact_dc_verification_recheck', { p_candidate: id }).then(function (st) {
        delete S.busy[id];
        return load([id]).then(function () { say(id, st === 'running' ? 'A check is running now; it will run again when it finishes.' : 'Recheck queued. This tile updates when it finishes.'); });
      }, function (e) { delete S.busy[id]; say(id, notInstalled(e) ? 'The project check is not set up yet.' : errText(e), true); }), true;
    }
    if (a === 'docs') {
      S.open[id] = !S.open[id];
      var key = r.match && r.match.project_key;
      if (S.open[id] && key && !S.docs[key]) { redraw(); return loadDocs(key).then(redraw), true; }
      redraw(); return true;
    }
    if (a === 'doc') {
      var act = t.getAttribute('data-a'), doc = t.getAttribute('data-doc'), reason = null;
      var dec = act === 'approve' ? 'approved' : act === 'reject' ? 'rejected' : 'revoked';
      if (dec !== 'approved') {
        reason = window.prompt(act === 'reject' ? 'Why does this document not belong to the project?' : 'Why is this document no longer shown?');
        if (reason == null || !String(reason).trim()) { say(id, 'A reason is needed. Nothing was changed.', true); return true; }
      }
      var pk = r.match && r.match.project_key;
      return rpc('hs_map1_project_document_decide', { p_document_id: doc, p_decision: dec, p_reason: reason }).then(function () {
        return Promise.all([loadDocs(pk), load([id])]).then(function () {
          say(id, dec === 'approved' ? 'Approved. It can now be shown with the project on JODY\'s map; the project is checked again.' : 'Saved. The project is checked again.');
        });
      }, function (e) { say(id, errText(e), true); }), true;
    }
    return true;
  }
  function onInput(ev) {
    var t = ev.target; if (!t || !t.getAttribute || !t.hasAttribute('data-dcv-reply')) return false;
    var id = t.getAttribute('data-dcv-reply');
    S.drafts[id] = t.value;
    S.focus = { id: t.id, start: t.selectionStart, end: t.selectionEnd };
    redraw();
    return true;
  }
  // After the panel is rebuilt, put the cursor back in the reply being typed.
  function afterRender(root) {
    if (!S.focus || !root) return;
    var t = root.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(S.focus.id) : S.focus.id));
    if (t) { t.focus(); try { t.setSelectionRange(S.focus.start, S.focus.end); } catch (e) { /* ignore */ } }
  }

  HS.acqImpactDcCheck = {
    attach: function (client, rerender) {
      S.client = client; S.rerender = rerender;
      if (!document.getElementById('dcv-style')) {
        var st = document.createElement('style'); st.id = 'dcv-style';
        st.textContent = '.dcv{border-top:1px solid var(--line);margin-top:10px;padding-top:8px}' +
          '.dcv-facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:2px 10px;margin:6px 0;font-size:13px}' +
          '.dcv-facts dt{color:var(--muted)}.dcv-facts dd{margin:0;overflow-wrap:anywhere}.dcv .is-bad{color:#b3261e;font-weight:600}';
        document.head.appendChild(st);
      }
    },
    load: load, block: block, onClick: onClick, onInput: onInput, afterRender: afterRender,
    blur: function () { S.focus = null; },
    _state: S
  };
})();
