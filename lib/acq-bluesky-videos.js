/* Jody Acquisition Dashboard: Tab 12 (Bluesky Posts) -> VIDEOS.
   The monitor for approved video items (Main Video, Short 1, Short 2). It is NOT an approval surface:
   approval happens once, per item, in Tab 16 (YouTube Videos), and that same transaction creates the item's
   Bluesky job (docs/video-bluesky-queue.sql). This page only shows where each item is, lets the founder
   CANCEL an unpublished one or RETRY a held/failed one, and links the published post.

   Data: public.hs_video_jobs_list() (admin-gated). Actions: hs_video_job_cancel, hs_video_job_retry.
   The MP4 preview is read on request from the PRIVATE jody-videos bucket through the signed-in session, as a blob.
   The page never holds a Bluesky credential and never posts. Every value is escaped before it reaches markup;
   the only hrefs are https:// links built here. No impression/view/click numbers are shown: none exist. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  var BUCKET = 'jody-videos';
  var blobs = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var LABEL = { final: 'Main Video', short1: 'Short 1', short2: 'Short 2' };
  var HOLD = {
    reconcile_required: 'The pilot posts already on Bluesky have not been checked yet (open the project in Tab 16 and confirm).',
    no_caption: 'No Bluesky caption yet.',
    text_too_long: 'The caption with its link and hashtags is over 300 characters.',
    no_alt_text: 'No description (alt text) for the video.',
    missing_youtube_url: 'Waiting for the full YouTube link (enter it in Tab 16).',
    file_missing: 'The MP4 is not in private storage.',
    file_size_mismatch: 'The stored MP4 does not match the size recorded at upload.',
    no_file_hash: 'The MP4 has no recorded checksum.',
    changed_after_approval: 'The copy or file changed after approval. Approve it again in Tab 16.',
    cancel_requested: 'Cancelled.',
    not_approved: 'No longer approved.'
  };

  // One status vocabulary. "Scheduled" and "Published" appear only when the job really is in that state.
  function stateOf(it) {
    var js = it.job_status;
    if (js === 'published') return { key: 'published', label: 'Published', cls: 'real' };
    if (js === 'external') return { key: 'published', label: 'Published manually (on record)', cls: 'real' };
    if (js === 'uploading') return { key: 'uploading', label: 'Uploading', cls: 'pending' };
    if (js === 'processing') return { key: 'processing', label: 'Processing', cls: 'pending' };
    if (js === 'publishing') return { key: 'publishing', label: 'Publishing', cls: 'pending' };
    if (js === 'failed') return { key: 'failed', label: 'Failed', cls: 'persist' };
    if (js === 'held') return { key: 'held', label: 'Held', cls: 'persist' };
    if (js === 'scheduled' && it.scheduled_slot) return { key: 'scheduled', label: 'Scheduled', cls: 'real' };
    if (it.decision === 'rejected') return { key: 'rejected', label: 'Rejected in Tab 16', cls: 'persist' };
    if (it.decision === 'approved') return { key: 'queued', label: 'Approved / queued', cls: 'pending' };
    return { key: 'awaiting', label: 'Awaiting approval in Tab 16', cls: 'pending' };
  }

  function fmtSlot(v, tz) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Denver', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
    } catch (e) { return d.toISOString(); }
  }

  // at://did:plc:x/app.bsky.feed.post/rkey -> https://bsky.app/profile/did:plc:x/post/rkey. Anything else is not linked.
  function postUrl(uri) {
    var m = /^at:\/\/(did:[a-z0-9:]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~-]+)$/.exec(uri || '');
    if (m) return 'https://bsky.app/profile/' + m[1] + '/post/' + m[2];
    return /^https:\/\/bsky\.app\/profile\/[^\s"'<>]+\/post\/[A-Za-z0-9._~-]+$/.test(uri || '') ? uri : '';
  }
  function holdWords(reason) {
    return String(reason || '').split(',').filter(Boolean).map(function (c) { return HOLD[c] || c; }).join(' ');
  }

  function counts(items) {
    var c = { awaiting: 0, scheduled: 0, published: 0, problem: 0, total: 0 };
    (items || []).forEach(function (it) {
      var k = stateOf(it).key;
      if (k === 'awaiting') c.awaiting++;
      else if (k === 'published') c.published++;
      else if (k === 'failed' || k === 'held') c.problem++;
      else if (k === 'scheduled' || k === 'uploading' || k === 'processing' || k === 'publishing' || k === 'queued') c.scheduled++;
      if (k !== 'awaiting' && k !== 'rejected') c.total++;
    });
    return c;
  }

  function tile(label, n, sub) {
    return '<div class="tile"><div class="tile-label">' + esc(label) + '</div><div class="tile-value">' + esc(String(n)) + '</div><div class="tile-note">' + esc(sub) + '</div></div>';
  }
  function metrics(items) {
    var c = counts(items);
    return tile('Videos awaiting approval', c.awaiting, 'approve each in Tab 16') +
      tile('Approved and scheduled', c.scheduled, 'posts by itself at its slot') +
      tile('Published', c.published, 'live on Bluesky') +
      tile('Failed or held', c.problem, 'needs a look');
  }

  function card(it) {
    var st = stateOf(it);
    var url = postUrl(it.bsky_uri) || postUrl(it.external_uri);
    var when = it.job_status === 'scheduled' && it.scheduled_slot ? '<p class="sub"><b>Scheduled:</b> ' + esc(fmtSlot(it.scheduled_slot, it.local_tz)) + '</p>' : '';
    var published = it.published_at && it.job_status === 'published' ? '<p class="sub"><b>Published:</b> ' + esc(fmtSlot(it.published_at, it.local_tz)) + '</p>' : '';
    var link = url ? '<p class="sub"><b>Bluesky post:</b> <a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a></p>' : '';
    var yt = it.youtube_url ? '<p class="sub"><b>YouTube:</b> <a href="' + esc(it.youtube_url) + '" target="_blank" rel="noopener noreferrer">' + esc(it.youtube_url) + '</a></p>'
      : (it.link_youtube ? '<p class="sub"><b>YouTube:</b> link not entered yet</p>' : '');
    var why = it.job_status === 'held' && it.hold_reason ? '<p class="sub"><b>Why held:</b> ' + esc(holdWords(it.hold_reason)) + '</p>' : '';
    var err = it.error ? '<p class="sub"><b>Last error</b> (attempt ' + esc(String(it.attempts || 0)) + '): ' + esc(it.error) + '</p>' : '';
    var note = it.external_note ? '<p class="sub">' + esc(it.external_note) + '</p>' : '';
    var canAct = it.job_id && (it.job_status === 'scheduled' || it.job_status === 'held' || it.job_status === 'failed');
    var buttons = '';
    if (it.job_id && (it.job_status === 'scheduled' || it.job_status === 'held')) buttons += '<button type="button" class="vq-btn" data-vq="cancel">Cancel before it posts</button> ';
    if (it.job_id && (it.job_status === 'held' || it.job_status === 'failed')) buttons += '<button type="button" class="vq-btn" data-vq="retry">Retry</button> ';
    return '<div class="card vq-card" data-vq-job="' + esc(it.job_id || '') + '" data-path="' + esc(it.file_path || '') + '">' +
      '<h3>' + esc(it.title || it.slug) + ' · ' + esc(LABEL[it.file_key] || it.file_key) + ' <span class="tile-tag t-' + st.cls + '">' + esc(st.label) + '</span></h3>' +
      when + published + link + yt + why + err + note +
      '<div class="vq-media"><button type="button" class="vq-play">▶ Load preview (MP4)</button></div>' +
      '<p class="sub"><b>Post text</b> (exactly what posts' + (it.text ? ', ' + esc(String(Array.from(it.text).length)) + ' characters' : '') + '):</p>' +
      (it.text ? '<pre class="vq-pre">' + esc(it.text) + '</pre>' : '<p class="sub">No caption has been written yet.</p>') +
      (it.alt ? '<p class="sub"><b>Video description (alt text):</b> ' + esc(it.alt) + '</p>' : '') +
      (buttons ? '<div class="vq-actions">' + buttons + '<span class="vq-msg sub" role="status"></span></div>' : (canAct ? '' : '')) +
      '</div>';
  }

  var CSS = '<style>.vq-pre{white-space:pre-wrap;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:13px;margin:4px 0}' +
    '.vq-media video{width:100%;max-width:360px;border-radius:8px;background:#000}.vq-btn,.vq-play{padding:6px 10px;cursor:pointer}.vq-actions{margin-top:8px}</style>';

  function render(items) {
    items = Array.isArray(items) ? items : [];
    var order = { failed: 0, held: 1, publishing: 2, processing: 2, uploading: 2, scheduled: 3, queued: 4, awaiting: 5, rejected: 6, published: 7 };
    var sorted = items.slice().sort(function (a, b) { return (order[stateOf(a).key] - order[stateOf(b).key]); });
    return CSS + '<div class="card"><h3>Videos</h3><p class="sub">Approved videos post to Bluesky automatically at their scheduled time, sharing the same 3-a-day limit as every other post. ' +
      'You approve each item once, in Tab 16. Nothing is approved here.</p></div>' +
      (sorted.length ? sorted.map(card).join('') : '<div class="card"><p class="sub">No videos are in the pipeline yet.</p></div>');
  }

  function getBlob(client, path) {
    if (blobs[path]) return Promise.resolve(blobs[path]);
    return client.storage.from(BUCKET).download(path).then(function (r) {
      if (!r || r.error || !r.data) return null;
      blobs[path] = URL.createObjectURL(r.data);
      return blobs[path];
    }, function () { return null; });
  }

  function wire(client, host, reload) {
    if (host.getAttribute('data-vq-wired') === '1') return;
    host.setAttribute('data-vq-wired', '1');
    host.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var cardEl = t.closest('.vq-card');
      if (!cardEl) return;
      if (t.classList.contains('vq-play')) {
        var path = cardEl.getAttribute('data-path');
        if (!path) return;
        t.disabled = true; t.textContent = 'Loading…';
        getBlob(client, path).then(function (u) {
          var stage = cardEl.querySelector('.vq-media');
          if (!u) { t.disabled = false; t.textContent = '▶ Load preview (MP4)'; stage.insertAdjacentHTML('beforeend', '<span class="sub">Could not read the file.</span>'); return; }
          stage.innerHTML = '<video controls playsinline preload="metadata" src="' + esc(u) + '"></video>';
        });
      } else if (t.classList.contains('vq-btn')) {
        var id = cardEl.getAttribute('data-vq-job');
        var act = t.getAttribute('data-vq');
        var msg = cardEl.querySelector('.vq-msg');
        if (!id) return;
        if (act === 'cancel' && !window.confirm('Cancel this video before it posts? It goes back to waiting for approval in Tab 16.')) return;
        if (msg) msg.textContent = 'Working…';
        client.rpc(act === 'cancel' ? 'hs_video_job_cancel' : 'hs_video_job_retry', { p_id: id }).then(function (r) {
          if (r && r.error) { if (msg) msg.textContent = 'Could not do that (' + (r.error.code || 'error') + ').'; return; }
          reload();
        }, function () { if (msg) msg.textContent = 'Could not reach the server.'; });
      }
    });
  }

  HS.acqBlueskyVideos = {
    esc: esc, render: render, card: card, metrics: metrics, counts: counts, stateOf: stateOf, postUrl: postUrl, holdWords: holdWords,
    // Resolves to the item list, or null when the queue is not available (not applied yet / not an admin).
    fetch: function (client) {
      if (!client) return Promise.resolve(null);
      return client.rpc('hs_video_jobs_list').then(function (r) { return r && !r.error && Array.isArray(r.data) ? r.data : null; }, function () { return null; });
    },
    mount: function (client, host, items, reload) {
      host.innerHTML = render(items);
      wire(client, host, reload);
    }
  };
})();
