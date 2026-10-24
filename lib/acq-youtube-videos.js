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
  // One file's decision: its state, the note, and Approve / Reject / Clear. Recorded by hs_youtube_video_file_decide.
  function decisionBox(d) {
    d = d || {};
    var st = d.status === 'approved' || d.status === 'rejected' ? d.status : 'pending';
    var label = st === 'approved' ? 'Approved' : st === 'rejected' ? 'Rejected' : 'Waiting for your review';
    return '<div class="yv-fdec">' +
      '<span class="tile-tag t-' + STATUS[st].cls + ' yv-fstate">' + esc(label) + '</span>' +
      (d.note ? '<p class="sub yv-fnote">Your note: ' + esc(d.note) + '</p>' : '') +
      '<input type="text" class="yv-fnote-in" maxlength="500" placeholder="Note (what to change, or why)" value="">' +
      '<button type="button" class="yv-fapprove">Approve</button> <button type="button" class="yv-freject">Reject</button>' +
      (st === 'pending' ? '' : ' <button type="button" class="yv-fclear">Undo</button>') +
      '<span class="yv-fmsg sub" role="status"></span></div>';
  }

  function fileTile(slug, key, title, f, portrait, dec) {
    if (!f || !f.path) return '<div class="yv-file"><div class="yv-file-t">' + esc(title) + '</div><p class="sub">Not uploaded.</p></div>';
    return '<div class="yv-file' + (portrait ? ' yv-portrait' : '') + '" data-slug="' + esc(slug) + '" data-key="' + esc(key) + '" data-path="' + esc(f.path) + '">' +
      '<div class="yv-file-t">' + esc(title) + (mb(f.bytes) ? ' <span class="sub">' + esc(mb(f.bytes)) + '</span>' : '') + '</div>' +
      '<div class="yv-stage"><button type="button" class="yv-play">▶ Load and play</button></div>' +
      '<button type="button" class="yv-dl">Download</button>' +
      decisionBox(dec) +
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
    var nApproved = present.filter(function (k) { return fd[k] && fd[k].status === 'approved'; }).length;
    var nRejected = present.filter(function (k) { return fd[k] && fd[k].status === 'rejected'; }).length;
    return '<div class="card yv-card" data-slug="' + esc(p.slug) + '">' +
      '<h3>' + esc(p.title || p.slug) + ' <span class="tile-tag t-' + st.cls + '">' + esc(st.label) + '</span></h3>' +
      '<p class="sub">Project <code>' + esc(p.slug) + '</code> · built ' + esc(fmtDate(p.created_at)) +
      ' · ' + nApproved + ' of ' + present.length + ' files approved' + (nRejected ? ', ' + nRejected + ' rejected' : '') +
      (p.decided_at ? ' · last decision ' + esc(fmtDate(p.decided_at)) + (p.decided_by ? ' by ' + esc(p.decided_by) : '') : '') + '</p>' +
      '<p class="sub"><b>Nothing here is published.</b> Approve or reject each file below; approving only records your decision. You upload to YouTube yourself.</p>' +
      '<div class="yv-files">' +
        fileTile(p.slug, 'final', 'Main video', files.final, false, fd.final) +
        fileTile(p.slug, 'short1', 'Short 1', files.short1, true, fd.short1) +
        fileTile(p.slug, 'short2', 'Short 2', files.short2, true, fd.short2) +
        '<div class="yv-file yv-thumbwrap"' + (files.thumbnail && files.thumbnail.path ? ' data-slug="' + esc(p.slug) + '" data-key="thumbnail" data-path="' + esc(files.thumbnail.path) + '"' : '') + '>' +
          '<div class="yv-file-t">Thumbnail</div><div class="yv-stage yv-thumb">' + (files.thumbnail && files.thumbnail.path ? '<span class="sub">Loading…</span>' : '<span class="sub">Not uploaded.</span>') + '</div>' +
          (files.thumbnail && files.thumbnail.path ? decisionBox(fd.thumbnail) : '') + '</div>' +
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
    '.yv-fdec{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}.yv-fnote-in{flex:1 1 100%;padding:6px}.yv-fnote{flex:1 1 100%;margin:0}.yv-play,.yv-dl,.yv-fapprove,.yv-freject,.yv-fclear{padding:6px 10px;cursor:pointer}' +
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
          if (r && r.error) { msg.textContent = 'Could not save (' + (r.error.code || 'error') + ').'; return; }
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

  HS.acqYoutubeVideos = {
    esc: esc, render: render, card: card,
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
        return true;
      }, function () {
        container.innerHTML = '<div class="card"><h3>Couldn’t load</h3><p class="sub">The video list could not be reached. Try again.</p></div>';
        return false;
      });
    }
  };
})();
