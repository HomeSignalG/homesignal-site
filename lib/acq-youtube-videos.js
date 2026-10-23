/* Jody Acquisition Dashboard: "YouTube Videos" tab.
   Review surface for the finished videos the JODY video pipeline (homesignal-ingest/video) produces.
   It lists each project, plays the main video and both Shorts inside the page, shows the thumbnail,
   the proposed titles, the description and the review ledger, and records the founder's decision
   (approve / reject) through ONE gated RPC.

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

  function fileTile(slug, key, title, f, portrait) {
    if (!f || !f.path) return '<div class="yv-file"><div class="yv-file-t">' + esc(title) + '</div><p class="sub">Not uploaded.</p></div>';
    return '<div class="yv-file' + (portrait ? ' yv-portrait' : '') + '" data-slug="' + esc(slug) + '" data-key="' + esc(key) + '" data-path="' + esc(f.path) + '">' +
      '<div class="yv-file-t">' + esc(title) + (mb(f.bytes) ? ' <span class="sub">' + esc(mb(f.bytes)) + '</span>' : '') + '</div>' +
      '<div class="yv-stage"><button type="button" class="yv-play">▶ Load and play</button></div>' +
      '<button type="button" class="yv-dl">Download</button>' +
      '</div>';
  }

  function card(p) {
    p = p || {};
    var st = STATUS[p.status] || STATUS.pending;
    var files = p.files || {};
    var meta = p.meta || {};
    var titles = Array.isArray(meta.titles) ? meta.titles : [];
    var decided = p.status === 'approved' || p.status === 'rejected';
    return '<div class="card yv-card" data-slug="' + esc(p.slug) + '">' +
      '<h3>' + esc(p.title || p.slug) + ' <span class="tile-tag t-' + st.cls + '">' + esc(st.label) + '</span></h3>' +
      '<p class="sub">Project <code>' + esc(p.slug) + '</code> · built ' + esc(fmtDate(p.created_at)) +
      (decided ? ' · decided ' + esc(fmtDate(p.decided_at)) + (p.decided_by ? ' by ' + esc(p.decided_by) : '') : '') + '</p>' +
      '<p class="sub"><b>Nothing here is published.</b> Approving only records your decision. You upload to YouTube yourself.</p>' +
      '<div class="yv-files">' +
        fileTile(p.slug, 'final', 'Main video', files.final, false) +
        fileTile(p.slug, 'short1', 'Short 1', files.short1, true) +
        fileTile(p.slug, 'short2', 'Short 2', files.short2, true) +
        '<div class="yv-file yv-thumbwrap"' + (files.thumbnail && files.thumbnail.path ? ' data-slug="' + esc(p.slug) + '" data-key="thumbnail" data-path="' + esc(files.thumbnail.path) + '"' : '') + '>' +
          '<div class="yv-file-t">Thumbnail</div><div class="yv-stage yv-thumb">' + (files.thumbnail && files.thumbnail.path ? '<span class="sub">Loading…</span>' : '<span class="sub">Not uploaded.</span>') + '</div></div>' +
      '</div>' +
      '<details open><summary><b>Title options</b></summary>' +
        (titles.length ? '<ol>' + titles.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>' : '<p class="sub">None.</p>') + '</details>' +
      '<details><summary><b>Description (with source links)</b></summary><pre class="yv-pre">' + esc(meta.description || '') + '</pre>' +
        (meta.tags ? '<p class="sub">Tags: ' + esc(meta.tags) + '</p>' : '') + '</details>' +
      '<details><summary><b>Review ledger</b> (every spoken sentence beside the record words behind it)</summary><pre class="yv-pre">' + esc(meta.ledger || '') + '</pre></details>' +
      (p.note ? '<p class="sub">Your note: ' + esc(p.note) + '</p>' : '') +
      '<div class="yv-decide">' +
        '<input type="text" class="yv-note" maxlength="500" placeholder="Optional note (what to change, or why rejected)" value="">' +
        '<button type="button" class="yv-approve">Approve</button> ' +
        '<button type="button" class="yv-reject">Reject</button>' +
        '<span class="yv-msg sub" role="status"></span>' +
      '</div>' +
    '</div>';
  }

  var CSS = '<style>.yv-files{display:flex;flex-wrap:wrap;gap:14px;margin:10px 0}.yv-file{flex:1 1 320px;max-width:560px}' +
    '.yv-file.yv-portrait{flex:0 1 220px}.yv-file-t{font-weight:600;margin-bottom:4px}.yv-stage{background:#000;border-radius:8px;min-height:90px;display:flex;align-items:center;justify-content:center}' +
    '.yv-stage video,.yv-stage img{width:100%;border-radius:8px;display:block}.yv-pre{white-space:pre-wrap;max-height:340px;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px}' +
    '.yv-decide{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.yv-note{flex:1 1 260px;padding:7px}.yv-play,.yv-dl,.yv-approve,.yv-reject{padding:7px 12px;cursor:pointer}' +
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
      } else if ((t.classList.contains('yv-approve') || t.classList.contains('yv-reject')) && cardEl) {
        var approve = t.classList.contains('yv-approve');
        var slug = cardEl.getAttribute('data-slug');
        var msg = cardEl.querySelector('.yv-msg');
        if (!window.confirm((approve ? 'Approve' : 'Reject') + ' this video? This only records your decision. Nothing is posted to YouTube.')) return;
        var note = cardEl.querySelector('.yv-note').value;
        msg.textContent = 'Saving…';
        client.rpc('hs_youtube_video_decide', { p_slug: slug, p_status: approve ? 'approved' : 'rejected', p_note: note || null }).then(function (r) {
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
