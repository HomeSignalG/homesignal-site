/* Jody Acquisition Dashboard: "YouTube Videos" tab.
   Review surface for the finished videos the JODY video pipeline (homesignal-ingest/video) produces.
   It lists each project, plays the main video and both Shorts inside the page, shows the thumbnail,
   the proposed titles, the description and the review ledger, and records the founder's decision
   (approve / reject, with a note) PER FILE through ONE gated RPC: the main video, each Short and the thumbnail
   are judged separately, so a fix to one Short never throws away the approval of the others.

   WHAT IT NEVER DOES: publish. There is no YouTube call, key or upload anywhere in this file. For the main video
   and the two Shorts, "Approve" records the decision AND (in the same database transaction) queues that one item for
   the server-side Bluesky publisher (docs/video-bluesky-queue.sql); this page still posts nothing and holds no
   credential. The founder uploads to YouTube by hand. The Bluesky caption of each item is editable here, and a
   changed caption sends an approved item back to "waiting" so it must be approved again.

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

  var VIDEO_KEYS = ['final', 'short1', 'short2'];
  function nchars(t) { return Array.from(String(t || '')).length; }
  // The Bluesky post of ONE item: the editable caption/tags/alt, the exact composed text (composed by the database,
  // never here) and where the item is in the queue. Hidden until the queue exists (columns absent).
  function bskyBox(slug, key, post, job, hasQueue) {
    if (!hasQueue) return '';
    post = post || {};
    var tags = Array.isArray(post.hashtags) ? post.hashtags.join(' ') : '';
    var text = job && job.text ? job.text : '';
    var BV = window.HS && window.HS.acqBlueskyVideos;
    var st = BV && job ? BV.stateOf(job) : null;
    var why = job && job.job_status === 'held' && job.hold_reason && BV ? BV.holdWords(job.hold_reason) : '';
    return '<div class="yv-bsky" data-slug="' + esc(slug) + '" data-key="' + esc(key) + '">' +
      '<div class="yv-file-t">Bluesky post' + (st ? ' <span class="tile-tag t-' + esc(st.cls) + '">' + esc(st.label) + '</span>' : '') + '</div>' +
      '<textarea class="yv-bcap" maxlength="280" rows="4" placeholder="Bluesky caption for this item">' + esc(post.caption || '') + '</textarea>' +
      '<input type="text" class="yv-btags" value="' + esc(tags) + '" placeholder="Hashtags, no # (e.g. Tacoma Dredging JodyTracks)">' +
      '<textarea class="yv-balt" maxlength="1000" rows="2" placeholder="Describe the video for people who cannot see it (alt text)">' + esc(post.alt || '') + '</textarea>' +
      (post.link_youtube ? '<p class="sub">This post ends with the full YouTube link' + (text.indexOf('https://') >= 0 ? '.' : ' once you enter it below.') + '</p>' : '') +
      (text ? '<p class="sub"><b>Exactly what will post</b> (' + nchars(text) + ' of 300 characters' + (nchars(text) > 300 ? ' — TOO LONG' : '') + '):</p><pre class="yv-pre">' + esc(text) + '</pre>' : '<p class="sub">Nothing to post yet: write a caption.</p>') +
      (why ? '<p class="sub"><b>Held:</b> ' + esc(why) + '</p>' : '') +
      '<button type="button" class="yv-bsave">Save Bluesky copy</button> <span class="yv-bmsg sub" role="status"></span>' +
      '<p class="sub">Saving changed copy on an approved item sends it back to “waiting”: you approve it again. The copy you approve is the copy that posts.</p>' +
      '</div>';
  }

  function fileTile(slug, key, title, f, portrait, dec, bsky) {
    if (!f || !f.path) return '<div class="yv-file"><div class="yv-file-t">' + esc(title) + '</div><p class="sub">Not uploaded.</p></div>';
    return '<div class="yv-file' + (portrait ? ' yv-portrait' : '') + '" data-slug="' + esc(slug) + '" data-key="' + esc(key) + '" data-path="' + esc(f.path) + '">' +
      '<div class="yv-file-t">' + esc(title) + (mb(f.bytes) ? ' <span class="sub">' + esc(mb(f.bytes)) + '</span>' : '') + '</div>' +
      '<div class="yv-stage"><button type="button" class="yv-play">▶ Load and play</button></div>' +
      '<button type="button" class="yv-dl">Download</button>' +
      decisionBox(dec) +
      (bsky || '') +
      '</div>';
  }

  // Per project: the verified full YouTube link (typed by the founder after uploading; never invented) and, for the
  // manually posted pilot, the one confirmation that releases its items.
  function projectControls(p, hasQueue) {
    if (!hasQueue) return '';
    return '<div class="yv-proj" data-slug="' + esc(p.slug) + '">' +
      (p.reconcile_required
        ? '<p class="sub"><b>Check Bluesky first.</b> Some of this project was posted to Bluesky by hand. Nothing here will post until you confirm you have checked. ' +
          '<button type="button" class="yv-recon">I checked Bluesky — allow this project to post</button></p>' : '') +
      '<p class="sub"><b>Full YouTube link</b> (after you upload the main video; Shorts that point to it wait for it): ' +
      '<input type="text" class="yv-yturl" size="42" value="' + esc(p.youtube_url || '') + '" placeholder="https://youtu.be/…"> ' +
      '<button type="button" class="yv-ytsave">Save link</button> <span class="yv-pmsg sub" role="status"></span></p></div>';
  }

  function card(p, jobs, hasQueue) {
    p = p || {};
    var st = STATUS[p.status] || STATUS.pending;
    var files = p.files || {};
    var meta = p.meta || {};
    var titles = Array.isArray(meta.titles) ? meta.titles : [];
    var fd = p.file_decisions && typeof p.file_decisions === 'object' ? p.file_decisions : {};
    jobs = jobs || {};
    hasQueue = !!hasQueue;
    var bp = p.bsky_posts && typeof p.bsky_posts === 'object' ? p.bsky_posts : {};
    var present = FILE_KEYS.filter(function (k) { return files[k] && files[k].path; });
    var nApproved = present.filter(function (k) { return fd[k] && fd[k].status === 'approved'; }).length;
    var nRejected = present.filter(function (k) { return fd[k] && fd[k].status === 'rejected'; }).length;
    return '<div class="card yv-card" data-slug="' + esc(p.slug) + '">' +
      '<h3>' + esc(p.title || p.slug) + ' <span class="tile-tag t-' + st.cls + '">' + esc(st.label) + '</span></h3>' +
      '<p class="sub">Project <code>' + esc(p.slug) + '</code> · built ' + esc(fmtDate(p.created_at)) +
      ' · ' + nApproved + ' of ' + present.length + ' files approved' + (nRejected ? ', ' + nRejected + ' rejected' : '') +
      (p.decided_at ? ' · last decision ' + esc(fmtDate(p.decided_at)) + (p.decided_by ? ' by ' + esc(p.decided_by) : '') : '') + '</p>' +
      '<p class="sub">' + (hasQueue
        ? '<b>Approving the main video or a Short queues it for Bluesky</b> and it posts by itself at its scheduled time (see Bluesky Posts → VIDEOS). Approve or reject each file once. Nothing is ever posted to YouTube: you upload there yourself.'
        : '<b>Nothing here is published.</b> Approve or reject each file below; approving only records your decision. You upload to YouTube yourself.') + '</p>' +
      projectControls(p, hasQueue) +
      '<div class="yv-files">' +
        fileTile(p.slug, 'final', 'Main video', files.final, false, fd.final, bskyBox(p.slug, 'final', bp.final, jobs[p.slug + '|final'], hasQueue)) +
        fileTile(p.slug, 'short1', 'Short 1', files.short1, true, fd.short1, bskyBox(p.slug, 'short1', bp.short1, jobs[p.slug + '|short1'], hasQueue)) +
        fileTile(p.slug, 'short2', 'Short 2', files.short2, true, fd.short2, bskyBox(p.slug, 'short2', bp.short2, jobs[p.slug + '|short2'], hasQueue)) +
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
    '.yv-fdec{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}.yv-fnote-in{flex:1 1 100%;padding:6px}.yv-fnote{flex:1 1 100%;margin:0}.yv-play,.yv-dl,.yv-fapprove,.yv-freject,.yv-fclear,.yv-bsave,.yv-ytsave,.yv-recon{padding:6px 10px;cursor:pointer}' +
    '.yv-bsky{margin-top:10px;border-top:1px solid var(--line);padding-top:8px;display:flex;flex-direction:column;gap:6px}.yv-bcap,.yv-balt,.yv-btags{width:100%;box-sizing:border-box;padding:6px;font:inherit}' +
    '</style>';

  function render(rows, jobs, hasQueue) {
    rows = Array.isArray(rows) ? rows : [];
    return CSS + '<div class="card"><h3>YouTube Videos</h3>' +
      '<p class="sub">Finished videos from the JODY video pipeline, waiting for your approval. Play them here, read the review ledger, then approve or reject. ' +
      'The system never posts to YouTube: you upload an approved video yourself.</p></div>' +
      (rows.length ? rows.map(function (r) { return card(r, jobs, hasQueue); }).join('') : '<div class="card"><p class="sub">No videos have been uploaded for review yet.</p></div>');
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
        var queues = status === 'approved' && VIDEO_KEYS.indexOf(key) >= 0 && !!tile.querySelector('.yv-bsky');
        if (status !== 'pending' && !window.confirm((status === 'approved' ? 'Approve' : 'Reject') + ' this file (' + key + ')? ' +
          (queues ? 'It will be queued for Bluesky and post automatically at its scheduled time. Nothing is posted to YouTube.' : 'This only records your decision. Nothing is posted to YouTube.'))) return;
        msg.textContent = 'Saving…';
        client.rpc('hs_youtube_video_file_decide', { p_slug: slug, p_key: key, p_status: status, p_note: note || null }).then(function (r) {
          if (r && r.error) { msg.textContent = 'Could not save (' + (r.error.code || 'error') + ').'; return; }
          reload();
        }, function () { msg.textContent = 'Could not reach the server. Try again.'; });
      } else if (t.classList.contains('yv-bsave')) {
        var box = t.closest('.yv-bsky');
        var bmsg = box.querySelector('.yv-bmsg');
        var tags = box.querySelector('.yv-btags').value.split(/[\s,#]+/).filter(Boolean);
        bmsg.textContent = 'Saving…';
        client.rpc('hs_video_bluesky_caption_set', {
          p_slug: box.getAttribute('data-slug'), p_key: box.getAttribute('data-key'),
          p_caption: box.querySelector('.yv-bcap').value, p_hashtags: tags, p_alt: box.querySelector('.yv-balt').value
        }).then(function (r) {
          if (r && r.error) { bmsg.textContent = 'Could not save (' + (r.error.message || r.error.code || 'error') + ').'; return; }
          reload();
        }, function () { bmsg.textContent = 'Could not reach the server. Try again.'; });
      } else if (t.classList.contains('yv-ytsave') || t.classList.contains('yv-recon')) {
        var pr = t.closest('.yv-proj');
        var pmsg = pr.querySelector('.yv-pmsg') || t;
        var call = t.classList.contains('yv-recon')
          ? client.rpc('hs_video_reconcile_done', { p_slug: pr.getAttribute('data-slug') })
          : client.rpc('hs_video_youtube_url_set', { p_slug: pr.getAttribute('data-slug'), p_url: pr.querySelector('.yv-yturl').value.trim() || null });
        if (pmsg.textContent !== undefined && pmsg !== t) pmsg.textContent = 'Saving…';
        call.then(function (r) {
          if (r && r.error) { if (pmsg !== t) pmsg.textContent = 'Could not save (' + (r.error.message || r.error.code || 'error') + ').'; return; }
          reload();
        }, function () { if (pmsg !== t) pmsg.textContent = 'Could not reach the server. Try again.'; });
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
      return Promise.all([
        client.rpc('hs_youtube_videos_list'),
        // The Bluesky queue is optional: until docs/video-bluesky-queue.sql is applied this call fails and the tab is unchanged.
        client.rpc('hs_video_jobs_list').then(function (q) { return q && !q.error && Array.isArray(q.data) ? q.data : null; }, function () { return null; })
      ]).then(function (both) {
        var r = both[0], q = both[1];
        if (r && r.error) {
          container.innerHTML = '<div class="card"><h3>Couldn’t load</h3><p class="sub">The video list could not be read (' + esc(r.error.code || 'error') + ').</p></div>';
          return false;
        }
        var jobs = {};
        (q || []).forEach(function (it) { jobs[it.slug + '|' + it.file_key] = it; });
        container.innerHTML = render(r && r.data, jobs, q !== null);
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
