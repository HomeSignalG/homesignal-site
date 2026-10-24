/* Jody Acquisition Dashboard: "YouTube Videos" tab.
   Review surface for the finished videos the JODY video pipeline (homesignal-ingest/video) produces.
   It lists each project, plays the main video and both Shorts inside the page, shows the thumbnail,
   the proposed titles, the description and the review ledger, and records the founder's decision
   (approve / reject, with a note) PER FILE through ONE gated RPC: the main video, each Short and the thumbnail
   are judged separately, so a fix to one Short never throws away the approval of the others.

   WHAT IT NEVER DOES: publish. There is no YouTube call, key or upload anywhere in this file;
   "Approve" only records a decision. The founder uploads by hand.

   Data: public.hs_youtube_videos_list() (docs/youtube-video-review.sql) returns one row per project,
   including the title/description/ledger text. The big files (MP4s, thumbnail) live in the PRIVATE
   `jody-videos` bucket and are read only on request, through the signed-in session, as blobs
   (the page's CSP allows media from blob:). Every value is escaped before it reaches markup. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  var BUCKET = 'jody-videos';
  var blobs = {}; // storage path -> object URL, so a video is downloaded once per visit

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
  function mb(v) { var n = Number(v); return isFinite(n) && n > 0 ? (n / 1048576).toFixed(1) + ' MB' : ''; }

  var STATUS = {
    pending: { label: 'Waiting for your review', cls: 'pending' },
    approved: { label: 'Approved by you', cls: 'real' },
    rejected: { label: 'Rejected', cls: 'persist' }
  };

  var FILE_KEYS = ['final', 'short1', 'short2', 'thumbnail'];
  var ACTIVE = { queued: 1, running: 1, validating: 1 };
  var POLL_MS = 10000;

  // Everything the page needs to know about ONE file: the founder's decision, the version it is on, and the
  // newest revision job. The labels below are the seven states the founder named; there is no other state.
  function fileCtx(p, key) {
    var fd = (p.file_decisions && p.file_decisions[key]) || null;
    var f = (p.files && p.files[key]) || {};
    var ver = Number(f.version) || 1;
    var revs = (Array.isArray(p.revisions) ? p.revisions : []).filter(function (r) { return r.file_key === key; });
    var last = revs.length ? revs[revs.length - 1] : null;
    var vers = (Array.isArray(p.versions) ? p.versions : []).filter(function (v) { return v.file_key === key; });
    var dec = fd && Number(fd.version || 1) === ver ? fd : null; // a decision of an older version never counts for this one
    var state;
    if (last && ACTIVE[last.status]) state = last.status === 'validating' ? 'validating' : 'generating';
    else if (dec && dec.status === 'approved') state = 'approved';
    else if (dec && dec.status === 'rejected') {
      state = last && last.parent_version === ver && last.status === 'failed' ? 'failed' : 'rejected';
    } else if (ver > 1) state = 'revised';
    else state = 'pending';
    return { dec: dec, ver: ver, revs: revs, last: last, vers: vers, state: state };
  }

  var STATE = {
    pending: ['Awaiting Review', 'pending'],
    approved: ['Approved', 'real'],
    rejected: ['Rejected — Revision Needed', 'persist'],
    generating: ['Generating Revision', 'pending'],
    validating: ['Validating Revision', 'pending'],
    revised: ['Revised — Awaiting Review', 'pending'],
    failed: ['Generation Failed', 'persist']
  };

  function checksHtml(r) {
    var v = r && r.result && r.result.validation;
    if (!v || !Array.isArray(v.checks)) return '';
    return '<details class="yv-checks"><summary>Checks run on this version</summary><ul>' + v.checks.map(function (c) {
      var mark = !c.verified ? '👂 needs you' : c.ok ? '✓' : '✗';
      return '<li>' + mark + ' <b>' + esc(c.name) + '</b>: ' + esc(c.detail) + '</li>';
    }).join('') + '</ul></details>';
  }

  // One file's decision: its state, the saved note, the revision controls, and Approve / Reject / Undo.
  function decisionBox(ctx, key) {
    var d = ctx.dec || {}, st = ctx.state, last = ctx.last;
    var label = STATE[st][0];
    var isThumb = key === 'thumbnail';
    var gen = isThumb ? 'Generate Revised Thumbnail' : 'Generate Revised Video';
    var busy = st === 'generating' || st === 'validating';
    var h = '<div class="yv-fdec" data-state="' + st + '">' +
      '<span class="tile-tag t-' + STATE[st][1] + ' yv-fstate">' + esc(label) + '</span>';
    if (busy) {
      h += '<p class="sub yv-fprog">' + (st === 'validating' ? 'Checking the corrected version…' : 'Building a corrected version from your note. You can leave this page; it keeps going and will be here when you return.') + '</p>' +
        '<p class="sub yv-fnote">Your note: ' + esc(last.instruction) + '</p>' +
        '<button type="button" class="yv-rcancel" data-rev="' + esc(last.id) + '">Cancel</button>';
    } else {
      if (st === 'revised' && ctx.last && ctx.last.status === 'succeeded') {
        h += '<p class="sub yv-fnote">Corrected from your note: ' + esc(ctx.last.instruction) + '</p>' +
          (ctx.last.result && ctx.last.result.summary ? '<p class="sub">What changed: ' + esc(ctx.last.result.summary) + '</p>' : '') +
          (ctx.last.result && ctx.last.result.validation && ctx.last.result.validation.human_listening_required ? '<p class="sub"><b>Please listen:</b> a machine cannot confirm a pronunciation. Play it and decide.</p>' : '') +
          checksHtml(ctx.last);
      }
      if (st === 'failed') {
        h += '<p class="yv-ferr">' + esc(last.error || 'Generation failed. Your original video is safe.') + '</p>' +
          (last.attempts >= 3 ? '<p class="sub">Three attempts used. Change the note, then generate again.</p>' : '<button type="button" class="yv-rretry" data-rev="' + esc(last.id) + '">Retry Generation</button>');
      }
      if (last && last.status === 'unsupported' && st === 'rejected' && last.parent_version === ctx.ver) {
        h += '<p class="yv-ferr">' + esc(last.error || 'This note cannot be applied automatically.') + '</p>' +
          unsupportedHtml(last);
      }
      if (st === 'rejected' || st === 'failed') {
        h += '<input type="text" class="yv-fnote-in" maxlength="500" placeholder="What is wrong (plain English)" value="' + esc(d.note || '') + '">' +
          '<button type="button" class="yv-fsavenote">Save note</button> ' +
          (st === 'rejected' && d.note ? '<button type="button" class="yv-revise yv-primary">' + gen + '</button> ' : '') +
          '<button type="button" class="yv-fclear">Undo</button>';
      } else {
        h += '<input type="text" class="yv-fnote-in" maxlength="500" placeholder="Note (what to change, or why)" value="">' +
          '<button type="button" class="yv-fapprove">Approve</button> <button type="button" class="yv-freject">Reject</button>' +
          (st === 'approved' ? ' <button type="button" class="yv-fclear">Undo</button>' : '');
      }
    }
    h += '<span class="yv-fmsg sub" role="status"></span>' + historyHtml(ctx, key) + '</div>';
    return h;
  }

  function unsupportedHtml(r) {
    var u = r.plan && Array.isArray(r.plan.unsupported) ? r.plan.unsupported : (r.result && Array.isArray(r.result.unsupported) ? r.result.unsupported : []);
    if (!u.length) return '';
    return '<ul class="sub">' + u.map(function (x) { return '<li>' + esc(x.reason) + (x.suggestion ? ' <i>' + esc(x.suggestion) + '</i>' : '') + '</li>'; }).join('') + '</ul>';
  }

  // Every version stays playable; the earlier ones show what you decided about them.
  function historyHtml(ctx, key) {
    if (ctx.vers.length < 2) return '';
    return '<details class="yv-hist"><summary>Version history (' + ctx.vers.length + ')</summary><ul>' + ctx.vers.map(function (v) {
      var d = v.decision;
      var cur = v.version === ctx.ver;
      return '<li data-path="' + esc(v.path) + '" data-key="' + esc(key) + '"><b>Version ' + esc(v.version) + '</b>' + (cur ? ' (current)' : '') + ' · ' + esc(fmtDate(v.created_at)) +
        (d ? ' · you ' + esc(d.status) + (d.note ? ': “' + esc(d.note) + '”' : '') : (cur ? '' : ' · no decision')) +
        ' <button type="button" class="yv-vplay">▶ Play this version</button></li>';
    }).join('') + '</ul></details>';
  }

  // "3 Approved · 1 Needs Revision": one line over the whole package.
  function summaryLine(p) {
    var n = { approved: 0, rev: 0, gen: 0, wait: 0 };
    FILE_KEYS.forEach(function (k) {
      if (!(p.files && p.files[k] && p.files[k].path)) return;
      var st = fileCtx(p, k).state;
      if (st === 'approved') n.approved++;
      else if (st === 'rejected' || st === 'failed') n.rev++;
      else if (st === 'generating' || st === 'validating') n.gen++;
      else n.wait++;
    });
    var parts = [];
    if (n.approved) parts.push(n.approved + ' Approved');
    if (n.rev) parts.push(n.rev + ' Needs Revision');
    if (n.gen) parts.push(n.gen + ' Generating');
    if (n.wait) parts.push(n.wait + ' Awaiting Review');
    return parts.join(' · ') || 'Nothing uploaded';
  }

  function fileTile(slug, key, title, f, portrait, ctx) {
    if (!f || !f.path) return '<div class="yv-file"><div class="yv-file-t">' + esc(title) + '</div><p class="sub">Not uploaded.</p></div>';
    return '<div class="yv-file' + (portrait ? ' yv-portrait' : '') + '" data-slug="' + esc(slug) + '" data-key="' + esc(key) + '" data-path="' + esc(f.path) + '">' +
      '<div class="yv-file-t">' + esc(title) + (mb(f.bytes) ? ' <span class="sub">' + esc(mb(f.bytes)) + '</span>' : '') + '</div>' +
      '<div class="yv-stage"><button type="button" class="yv-play">▶ Load and play</button></div>' +
      '<button type="button" class="yv-dl">Download</button>' +
      decisionBox(ctx, key) +
      '</div>';
  }

  function card(p) {
    p = p || {};
    var st = STATUS[p.status] || STATUS.pending;
    var files = p.files || {};
    var meta = p.meta || {};
    var titles = Array.isArray(meta.titles) ? meta.titles : [];
    var fd = p.file_decisions && typeof p.file_decisions === 'object' ? p.file_decisions : {};
    var present = FILE_KEYS.filter(function (k) { return files[k] && files[k].path; });
    var ctx = {}; FILE_KEYS.forEach(function (k) { ctx[k] = fileCtx(p, k); });
    return '<div class="card yv-card" data-slug="' + esc(p.slug) + '">' +
      '<h3>' + esc(p.title || p.slug) + ' <span class="tile-tag t-' + st.cls + '">' + esc(st.label) + '</span></h3>' +
      '<p class="sub">Project <code>' + esc(p.slug) + '</code> · built ' + esc(fmtDate(p.created_at)) +
      ' · <b class="yv-summary">' + esc(summaryLine(p)) + '</b>' +
      (p.decided_at ? ' · last decision ' + esc(fmtDate(p.decided_at)) + (p.decided_by ? ' by ' + esc(p.decided_by) : '') : '') + '</p>' +
      '<p class="sub"><b>Nothing here is published.</b> Approve or reject each file below; approving only records your decision. You upload to YouTube yourself.</p>' +
      '<div class="yv-files">' +
        fileTile(p.slug, 'final', 'Main video', files.final, false, ctx.final) +
        fileTile(p.slug, 'short1', 'Short 1', files.short1, true, ctx.short1) +
        fileTile(p.slug, 'short2', 'Short 2', files.short2, true, ctx.short2) +
        '<div class="yv-file yv-thumbwrap"' + (files.thumbnail && files.thumbnail.path ? ' data-slug="' + esc(p.slug) + '" data-key="thumbnail" data-path="' + esc(files.thumbnail.path) + '"' : '') + '>' +
          '<div class="yv-file-t">Thumbnail</div><div class="yv-stage yv-thumb">' + (files.thumbnail && files.thumbnail.path ? '<span class="sub">Loading…</span>' : '<span class="sub">Not uploaded.</span>') + '</div>' +
          (files.thumbnail && files.thumbnail.path ? decisionBox(ctx.thumbnail, 'thumbnail') : '') + '</div>' +
      '</div>' +
      '<details open><summary><b>Title options</b></summary>' +
        (titles.length ? '<ol>' + titles.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>' : '<p class="sub">None.</p>') + '</details>' +
      '<details><summary><b>Description (with source links)</b></summary><pre class="yv-pre">' + esc(meta.description || '') + '</pre>' +
        (meta.tags ? '<p class="sub">Tags: ' + esc(meta.tags) + '</p>' : '') + '</details>' +
      '<details><summary><b>Review ledger</b> (every spoken sentence beside the record words behind it)</summary><pre class="yv-pre">' + esc(meta.ledger || '') + '</pre></details>' +
      (p.note && !present.some(function (k) { return fd[k]; }) ? '<p class="sub">Earlier note on the whole package: ' + esc(p.note) + '</p>' : '') +
    '</div>';
  }

  var CSS = '<style>.yv-files{display:flex;flex-wrap:wrap;gap:14px;margin:10px 0}.yv-file{flex:1 1 320px;max-width:560px}' +
    '.yv-file.yv-portrait{flex:0 1 220px}.yv-file-t{font-weight:600;margin-bottom:4px}.yv-stage{background:#000;border-radius:8px;min-height:90px;display:flex;align-items:center;justify-content:center}' +
    '.yv-stage video,.yv-stage img{width:100%;border-radius:8px;display:block}.yv-pre{white-space:pre-wrap;max-height:340px;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px}' +
    '.yv-fdec{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}.yv-fnote-in{flex:1 1 100%;padding:6px}.yv-fnote{flex:1 1 100%;margin:0}' +
    '.yv-play,.yv-dl,.yv-fapprove,.yv-freject,.yv-fclear,.yv-fsavenote,.yv-revise,.yv-rretry,.yv-rcancel,.yv-vplay{padding:6px 10px;cursor:pointer}' +
    '.yv-primary{font-weight:700}.yv-ferr{flex:1 1 100%;margin:0;color:#8a2b24}.yv-fprog{flex:1 1 100%;margin:0}.yv-hist,.yv-checks{flex:1 1 100%}' +
    '.yv-vvideo{display:block;max-width:100%;max-height:300px;margin-top:6px}' +
    '</style>';

  function render(rows) {
    rows = Array.isArray(rows) ? rows : [];
    return CSS + '<div class="card"><h3>YouTube Videos</h3>' +
      '<p class="sub">Finished videos from the JODY video pipeline, waiting for your approval. Play them here, read the review ledger, then approve or reject. ' +
      'The system never posts to YouTube: you upload an approved video yourself.</p></div>' +
      (rows.length ? rows.map(card).join('') : '<div class="card"><p class="sub">No videos have been uploaded for review yet.</p></div>');
  }

  function getBlob(client, path) {
    if (blobs[path]) return Promise.resolve(blobs[path]);
    return client.storage.from(BUCKET).download(path).then(function (r) {
      if (!r || r.error || !r.data) return null;
      blobs[path] = URL.createObjectURL(r.data);
      return blobs[path];
    }, function () { return null; });
  }

  // Server refusals are written for the founder; show them, not an error code.
  function friendlyRpc(e) {
    var m = e && e.message ? String(e.message) : '';
    if (e && e.code === '42501') return 'You are not signed in as an admin.';
    return m && m.length < 220 ? m : 'Could not complete that (' + ((e && e.code) || 'error') + ').';
  }

  function wire(client, root, reload) {
    root.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var tile = t.closest('.yv-file');
      var cardEl = t.closest('.yv-card');
      if (t.classList.contains('yv-play') && tile) {
        t.disabled = true; t.textContent = 'Loading…';
        getBlob(client, tile.getAttribute('data-path')).then(function (u) {
          var stage = tile.querySelector('.yv-stage');
          if (!u) { t.disabled = false; t.textContent = '▶ Load and play'; stage.insertAdjacentHTML('beforeend', '<span class="sub">Could not read the file. Try again.</span>'); return; }
          stage.innerHTML = '<video controls playsinline preload="metadata" src="' + esc(u) + '"></video>';
        });
      } else if (t.classList.contains('yv-dl') && tile) {
        var path = tile.getAttribute('data-path');
        t.disabled = true;
        getBlob(client, path).then(function (u) {
          t.disabled = false;
          if (!u) return;
          var a = document.createElement('a');
          a.href = u; a.download = tile.getAttribute('data-slug') + '-' + tile.getAttribute('data-key') + path.slice(path.lastIndexOf('.'));
          document.body.appendChild(a); a.click(); a.remove();
        });
      } else if (t.classList.contains('yv-vplay')) {
        var li = t.closest('li');
        t.disabled = true; t.textContent = 'Loading…';
        getBlob(client, li.getAttribute('data-path')).then(function (u) {
          t.disabled = false; t.textContent = '▶ Play this version';
          if (!u) { t.insertAdjacentHTML('afterend', ' <span class="sub">Could not read this version.</span>'); return; }
          var old = li.querySelector('video'); if (old) old.remove();
          li.insertAdjacentHTML('beforeend', '<video controls playsinline preload="metadata" class="yv-vvideo" src="' + esc(u) + '"></video>');
        });
      } else if (t.classList.contains('yv-revise') && tile) {
        // THE BUTTON: validates the rejection and the saved note on the server, creates a durable job, returns at once.
        var rmsg = tile.querySelector('.yv-fmsg');
        t.disabled = true; rmsg.textContent = 'Starting…';
        client.rpc('hs_youtube_video_revise', { p_slug: tile.getAttribute('data-slug'), p_key: tile.getAttribute('data-key') }).then(function (r) {
          if (r && r.error) { t.disabled = false; rmsg.textContent = friendlyRpc(r.error); return; }
          reload();
        }, function () { t.disabled = false; rmsg.textContent = 'Could not reach the server. Nothing was started. Try again.'; });
      } else if (t.classList.contains('yv-rretry') || t.classList.contains('yv-rcancel')) {
        var which = t.classList.contains('yv-rretry') ? 'hs_youtube_video_revision_retry' : 'hs_youtube_video_revision_cancel';
        var m2 = t.closest('.yv-fdec').querySelector('.yv-fmsg');
        t.disabled = true; m2.textContent = 'Working…';
        client.rpc(which, { p_revision_id: t.getAttribute('data-rev') }).then(function (r) {
          if (r && r.error) { t.disabled = false; m2.textContent = friendlyRpc(r.error); return; }
          reload();
        }, function () { t.disabled = false; m2.textContent = 'Could not reach the server. Try again.'; });
      } else if (t.classList.contains('yv-fsavenote') && tile) {
        var m3 = tile.querySelector('.yv-fmsg');
        var nv = tile.querySelector('.yv-fnote-in').value;
        if (!nv.trim()) { m3.textContent = 'Write what is wrong first.'; return; }
        m3.textContent = 'Saving…';
        client.rpc('hs_youtube_video_file_decide', { p_slug: tile.getAttribute('data-slug'), p_key: tile.getAttribute('data-key'), p_status: 'rejected', p_note: nv }).then(function (r) {
          if (r && r.error) { m3.textContent = friendlyRpc(r.error); return; }
          reload();
        }, function () { m3.textContent = 'Could not reach the server. Try again.'; });
      } else if ((t.classList.contains('yv-fapprove') || t.classList.contains('yv-freject') || t.classList.contains('yv-fclear')) && tile) {
        var status = t.classList.contains('yv-fapprove') ? 'approved' : t.classList.contains('yv-freject') ? 'rejected' : 'pending';
        var key = tile.getAttribute('data-key');
        var slug = tile.getAttribute('data-slug');
        var msg = tile.querySelector('.yv-fmsg');
        var noteIn = tile.querySelector('.yv-fnote-in');
        var note = noteIn ? noteIn.value : '';
        if (status !== 'pending' && !window.confirm((status === 'approved' ? 'Approve' : 'Reject') + ' this file (' + key + ')? This only records your decision. Nothing is posted to YouTube.')) return;
        msg.textContent = 'Saving…';
        client.rpc('hs_youtube_video_file_decide', { p_slug: slug, p_key: key, p_status: status, p_note: note || null }).then(function (r) {
          if (r && r.error) { msg.textContent = friendlyRpc(r.error); return; }
          reload();
        }, function () { msg.textContent = 'Could not reach the server. Try again.'; });
      }
    });
  }

  function loadThumbs(client, root) {
    var els = root.querySelectorAll('.yv-thumbwrap[data-path]');
    Array.prototype.forEach.call(els, function (el) {
      getBlob(client, el.getAttribute('data-path')).then(function (u) {
        var st = el.querySelector('.yv-stage');
        st.innerHTML = u ? '<img alt="Proposed thumbnail" src="' + esc(u) + '">' : '<span class="sub">Could not read the thumbnail.</span>';
      });
    });
  }

  // While a revision is being generated the page asks again every few seconds, so the founder can leave and come
  // back to the result. It never reloads under a video that is playing.
  var pollTimer = null;
  function anyActive(rows) {
    return (rows || []).some(function (p) { return (p.revisions || []).some(function (r) { return ACTIVE[r.status]; }); });
  }
  function schedulePoll(container, rows, reload) {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (!anyActive(rows)) return;
    pollTimer = setTimeout(function () {
      pollTimer = null;
      if (!document.body.contains(container)) return;
      var playing = Array.prototype.some.call(container.querySelectorAll('video'), function (v) { return !v.paused && !v.ended; });
      if (playing) { schedulePoll(container, rows, reload); return; }
      reload();
    }, POLL_MS);
  }

  HS.acqYoutubeVideos = {
    esc: esc, render: render, card: card, fileCtx: fileCtx, summaryLine: summaryLine,
    load: function (client, container) {
      if (!client || !container) return Promise.resolve(false);
      var wired = container.getAttribute('data-yv-wired') === '1';
      container.innerHTML = '<div class="gate-loading">Loading videos…</div>';
      function reload() { return HS.acqYoutubeVideos.load(client, container); }
      return client.rpc('hs_youtube_videos_list').then(function (r) {
        if (r && r.error) {
          container.innerHTML = '<div class="card"><h3>Couldn’t load</h3><p class="sub">The video list could not be read (' + esc(r.error.code || 'error') + ').</p></div>';
          return false;
        }
        container.innerHTML = render(r && r.data);
        if (!wired) { wire(client, container, reload); container.setAttribute('data-yv-wired', '1'); }
        loadThumbs(client, container);
        schedulePoll(container, (r && r.data) || [], reload);
        return true;
      }, function () {
        container.innerHTML = '<div class="card"><h3>Couldn’t load</h3><p class="sub">The video list could not be reached. Try again.</p></div>';
        return false;
      });
    }
  };
})();
