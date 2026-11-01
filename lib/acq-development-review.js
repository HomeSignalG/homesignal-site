/* Jody Acquisition Dashboard, tab 18 · Development Dossiers: the reviewer's screen.
   Only a current development reviewer can use it (founder, 2026-10-30: "i am only person in company").
   It reads one answer, public.development_review_queue() (docs/development-review.sql), and writes only through the
   functions of docs/development-dossier.sql: development_project_create, development_project_set and
   development_link_decide. The database decides what is allowed (grades a/b, no private person, one defining record,
   one name); this page shows its refusals in words and never decides a link itself. "Update the site" calls
   development_publish_request(), which starts the ingest publisher; the site build picks the result up within about
   half an hour. Every value is escaped before it reaches markup. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function day(v) {
    var d = v ? new Date(v) : null;
    return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
  }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || '')) ? String(u) : ''; }

  var KIND = {
    source_record: 'Development record', dc_entity: 'Data center record', land_assembly: 'Land assembly',
    parcel: 'Parcel', water_filing: 'Water-rights filing', government_record: 'Government record',
    organization: 'Organization', document: 'Official document', youtube_video: 'YouTube video',
    bluesky_post: 'Bluesky post', news_report: 'News report'
  };
  var PAGE = { draft: 'Draft: not on the site', published: 'Published', withdrawn: 'Withdrawn: not on the site' };
  // Only these grades can be approved (the database refuses c, d and e).
  function approvable(l) { return (l.grade === 'a' || l.grade === 'b') && !l.names_private_person; }

  function friendly(e) {
    var code = e && e.code, m = e && e.message ? String(e.message) : '';
    if (code === '42501') return 'Your account is not a development reviewer.';
    if (code === '55006' || code === '23505' || code === '23514' || code === 'P0002' || code === '28000') return m;
    return m && m.length < 240 ? m : 'That did not work (' + (code || 'error') + ').';
  }

  function linkRow(p, l) {
    var url = safeUrl(l.evidence_url);
    var open = l.link_state === 'candidate', approved = l.link_state === 'approved';
    var why = !approvable(l)
      ? (l.names_private_person ? 'Names a private person: cannot be approved.' : 'Grade ' + l.grade + ': only grades a and b can be approved.')
      : '';
    return '<li class="dr-link" data-link="' + esc(l.link_id) + '" data-project="' + esc(p.project_key) + '">' +
      '<div><b>' + esc(KIND[l.object_kind] || l.object_kind) + '</b> · ' + esc(l.role) + ' · grade ' + esc(l.grade) +
      ' · <span class="dr-state">' + esc(l.link_state) + '</span></div>' +
      '<div class="sub">' + esc(l.object_ref) + '</div>' +
      (l.display_text ? '<div>' + esc(l.display_text) + '</div>' : '') +
      (l.event_date ? '<div class="sub">' + esc(l.event_date_label || 'Date') + ': ' + esc(l.event_date) + '</div>' : '') +
      (l.evidence_quote ? '<blockquote class="sub">“' + esc(l.evidence_quote) + '”</blockquote>' : '') +
      (l.evidence_note ? '<div class="sub">Note: ' + esc(l.evidence_note) + '</div>' : '') +
      (url ? '<div class="sub">Source: <a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
        esc(l.evidence_label || url) + '</a></div>' : '') +
      '<div class="sub">Proposed by ' + esc(l.proposed_by) + (l.decided_at ? ' · decided ' + esc(day(l.decided_at)) : '') +
      (l.decision_reason ? ' · reason: ' + esc(l.decision_reason) : '') + '</div>' +
      (open ? '<p>' + (approvable(l) ? '<button type="button" class="dr-approve yv-primary">Approve</button> '
        : '<span class="sub">' + esc(why) + '</span> ') +
        '<input class="dr-reason" maxlength="500" placeholder="Reason (needed to reject)"> ' +
        '<button type="button" class="dr-reject">Reject</button></p>' : '') +
      (approved ? '<p><input class="dr-reason" maxlength="500" placeholder="Reason (needed to revoke)"> ' +
        '<button type="button" class="dr-revoke">Revoke</button></p>' : '') +
      '</li>';
  }

  function project(p) {
    var links = Array.isArray(p.links) ? p.links : [];
    var cand = links.filter(function (l) { return l.link_state === 'candidate'; });
    var appr = links.filter(function (l) { return l.link_state === 'approved'; });
    var past = links.filter(function (l) { return l.link_state !== 'candidate' && l.link_state !== 'approved'; });
    var name = p.record_name || p.display_name || p.project_key;
    var published = p.page_state === 'published';
    return '<div class="card dr-project" data-project="' + esc(p.project_key) + '" data-name="' + esc(p.display_name || '') + '">' +
      '<h3>' + esc(name) + ' <span class="sub">' + esc(p.state) + ' · ' + esc(p.project_key) + '</span></h3>' +
      '<p><b>' + esc(PAGE[p.page_state] || p.page_state) + '</b>' +
      (published ? ' · page: <a href="' + esc(p.path) + '" target="_blank" rel="noopener">' + esc(p.path) + '</a>' : ' · page will be ' + esc(p.path)) +
      (p.record_name ? '' : (p.display_name ? '' : ' · <span class="sub">No name yet: approve its land assembly or give it a name.</span>')) + '</p>' +
      '<p>' + (published ? '<button type="button" class="dr-withdraw">Withdraw page</button>'
        : '<button type="button" class="dr-publish yv-primary"' + (appr.length ? '' : ' disabled title="Approve at least one link first"') + '>Publish page</button>') +
      '</p>' +
      '<h4>Waiting for your decision (' + cand.length + ')</h4>' +
      (cand.length ? '<ul class="dr-list">' + cand.map(function (l) { return linkRow(p, l); }).join('') + '</ul>' : '<p class="sub">Nothing waiting.</p>') +
      '<h4>Approved (' + appr.length + ')</h4>' +
      (appr.length ? '<ul class="dr-list">' + appr.map(function (l) { return linkRow(p, l); }).join('') + '</ul>' : '<p class="sub">None yet.</p>') +
      (past.length ? '<details><summary>Rejected or revoked (' + past.length + ')</summary><ul class="dr-list">' +
        past.map(function (l) { return linkRow(p, l); }).join('') + '</ul></details>' : '') +
      '</div>';
  }

  function render(q, state) {
    var projects = q && Array.isArray(q.projects) ? q.projects : [];
    var waiting = 0;
    projects.forEach(function (p) { (p.links || []).forEach(function (l) { if (l.link_state === 'candidate') waiting++; }); });
    return '<div class="card"><h3>Development Dossiers</h3>' +
      '<p class="sub">Each development page shows only links you approve here, each beside its official source. ' +
      'Automated research can only propose links. A page goes on the site after you publish it and press “Update the site”; ' +
      'the site build picks it up within about half an hour.</p>' +
      '<p><b>' + projects.length + '</b> project' + (projects.length === 1 ? '' : 's') + ' · <b>' + waiting + '</b> link' +
      (waiting === 1 ? '' : 's') + ' waiting</p>' +
      '<p><button type="button" class="dr-site yv-primary"' + (state.busy ? ' disabled' : '') + '>Update the site</button>' +
      (q && q.last_publish_request ? ' <span class="sub">last requested ' + esc(day(q.last_publish_request)) + '</span>' : '') + '</p>' +
      '<details><summary><b>New project</b></summary>' +
      '<p class="sub">Use a short permanent key in lowercase words joined by hyphens, e.g. <code>stratos-box-elder</code>. It becomes the page address and cannot change.</p>' +
      '<p><label>Key <input class="dr-new-key" maxlength="80" placeholder="stratos-box-elder"></label> ' +
      '<label>State <input class="dr-new-state" maxlength="2" size="3" placeholder="UT"></label> ' +
      '<label>Name (only if no land assembly names it) <input class="dr-new-name" maxlength="200"></label> ' +
      '<button type="button" class="dr-create">Create</button></p></details>' +
      '<p class="dr-msg" role="status" style="font-weight:600;color:' + (state.ok ? '#1d6b45' : '#b42318') + '">' + esc(state.msg || '') + '</p></div>' +
      (state.error ? '<div class="card"><p>' + esc(state.error) + '</p></div>' : projects.map(project).join(''));
  }

  function load(client, host) {
    if (!client || !host) return Promise.resolve(false);
    var state = host._dr || (host._dr = { busy: false, msg: '', ok: false, error: '', q: null });
    function paint() { host.innerHTML = render(state.q, state); }
    function say(msg, ok) { state.msg = msg; state.ok = !!ok; paint(); }
    function refresh() {
      return client.rpc('development_review_queue').then(function (r) {
        if (r.error) { state.error = friendly(r.error); state.q = null; }
        else { state.error = ''; state.q = r.data; }
        paint();
        return !r.error;
      });
    }
    function call(fn, args, done) {
      if (state.busy) return;
      state.busy = true; say('Working…', true);
      client.rpc(fn, args).then(function (r) {
        state.busy = false;
        if (r.error) { say(friendly(r.error), false); return; }
        refresh().then(function () { say(done, true); });
      });
    }
    if (!host._drWired) {
      host._drWired = true;
      host.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || t.tagName !== 'BUTTON') return;
        var li = t.closest('.dr-link'), card = t.closest('.dr-project');
        var reason = li ? (li.querySelector('.dr-reason') || {}).value || '' : '';
        if (t.classList.contains('dr-approve')) {
          call('development_link_decide', { p_link_id: li.getAttribute('data-link'), p_decision: 'approved' }, 'Approved.');
        } else if (t.classList.contains('dr-reject') || t.classList.contains('dr-revoke')) {
          if (!reason.trim()) { say('Write a reason first.', false); return; }
          var dec = t.classList.contains('dr-reject') ? 'rejected' : 'revoked';
          call('development_link_decide', { p_link_id: li.getAttribute('data-link'), p_decision: dec, p_reason: reason.trim() },
            dec === 'rejected' ? 'Rejected.' : 'Revoked. Press “Update the site” to take it off the page.');
        } else if (t.classList.contains('dr-publish') || t.classList.contains('dr-withdraw')) {
          var pub = t.classList.contains('dr-publish');
          // development_project_set writes the name too, so the current name is passed back unchanged.
          call('development_project_set', { p_project_key: card.getAttribute('data-project'),
            p_page_state: pub ? 'published' : 'withdrawn', p_display_name: card.getAttribute('data-name') || null },
            pub ? 'Published. Press “Update the site” to put it on the site.' : 'Withdrawn. Press “Update the site” to take it off.');
        } else if (t.classList.contains('dr-create')) {
          var key = (host.querySelector('.dr-new-key') || {}).value || '';
          var st = (host.querySelector('.dr-new-state') || {}).value || '';
          var nm = (host.querySelector('.dr-new-name') || {}).value || '';
          if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key.trim()) || !/^[A-Za-z]{2}$/.test(st.trim())) {
            say('Give a key in lowercase words joined by hyphens and a two-letter state.', false); return;
          }
          call('development_project_create', { p_project_key: key.trim(), p_state: st.trim().toUpperCase(),
            p_display_name: nm.trim() || null }, 'Project created as a draft.');
        } else if (t.classList.contains('dr-site')) {
          call('development_publish_request', {}, 'The site update has started. Pages change within about half an hour.');
        }
      });
    }
    paint();
    return refresh();
  }

  HS.acqDevelopmentReview = { load: load, render: render, esc: esc };
})();
