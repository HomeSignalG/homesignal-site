/* Tab 20 · Weekly Report: VIDEO PRODUCTION (founder, 2026-11-14: "build the video production in tab 20").
 *
 * One card per report edition: "Make video" (public.hs_weekly_video_request, docs/weekly-video.sql) queues a render
 * of the edition's committed video script on homesignal-ingest (impact/weekly/job.py): narration, licensed real photos,
 * and the source documents drawn as pages with the quoted words highlighted, mixed scene by scene as the script calls
 * for. The finished files land in the private bucket impact-media; this card plays each one from a blob (the page's
 * CSP allows blob: media only) and records Approve, or Ask for changes with a note (hs_weekly_video_decide).
 * The card decides nothing; every state shown is what the database recorded. Not installed: the card is hidden.
 */
(function () {
  'use strict';
  var HS = window.HS = window.HS || {};
  var BUCKET = 'impact-media';
  var LABEL = { main: 'Main video', short_a: 'Short 1', short_b: 'Short 2', thumbnail: 'Thumbnail' };
  var V = { client: null, el: null, edition: null, st: null, err: '', msg: '', busy: false, urls: {}, timer: null, notes: {} };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function notInstalled(e) { return /PGRST202|Could not find the function|does not exist/i.test(String(e && e.message || '')); }
  function rpc(fn, args) {
    return V.client.rpc(fn, args).then(function (r) {
      if (r.error) { var e = new Error(r.error.message || 'request failed'); e.code = r.error.code; throw e; }
      return r.data;
    });
  }
  function when(t) {
    if (!t) return '';
    var d = new Date(t);
    return isNaN(d) ? String(t) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function mins(a, b) { var x = (new Date(b || Date.now()) - new Date(a)) / 60000; return isNaN(x) ? null : Math.max(0, Math.round(x)); }

  function load() {
    if (!V.edition) { V.st = null; return Promise.resolve(); }
    return rpc('hs_weekly_video_status', { p_edition: V.edition }).then(function (o) { V.st = o || { jobs: [] }; V.err = ''; },
      function (e) { V.st = notInstalled(e) ? false : null; V.err = notInstalled(e) ? '' : e.message; });
  }
  function active(j) { return j && (j.status === 'queued' || j.status === 'running'); }
  function schedule() {
    clearTimeout(V.timer);
    var j = V.st && V.st.jobs && V.st.jobs[0];
    if (active(j)) V.timer = setTimeout(function () { load().then(render); }, 30000);
  }

  function blobUrl(path) {
    if (V.urls[path]) return Promise.resolve(V.urls[path]);
    return V.client.storage.from(BUCKET).download(path).then(function (r) {
      if (r.error) throw new Error(r.error.message || 'download failed');
      V.urls[path] = URL.createObjectURL(r.data); return V.urls[path];
    });
  }
  function latestDecision(a) { return (a.decisions || [])[0] || null; }

  function viewAsset(a) {
    var d = latestDecision(a), qc = a.qc || {}, q = qc.quality || null;
    var isImg = a.asset === 'thumbnail';
    var mins_ = a.duration_s ? Math.floor(a.duration_s / 60) + ':' + ('0' + Math.round(a.duration_s % 60)).slice(-2) : '';
    var state = d ? (d.decision === 'approved' ? '<span class="wv-ok">Approved</span>' : '<span class="wv-bad">Changes asked: ' + esc(d.note) + '</span>')
      : '<span class="sub">Not reviewed yet</span>';
    var warn = (qc.ok === false ? '<p class="wv-bad">The file checks failed: ' + esc((qc.failed || qc.errors || []).join ? (qc.failed || qc.errors || []).join('; ') : 'see details') + '</p>' : '') +
      (q && q.ok === false ? '<p class="wv-warn">Picture check: ' + esc((q.failures || []).map(function (f) { return f.label || f.code; }).join('; ')) + '</p>' : '');
    return '<div class="wv-asset" data-asset="' + esc(a.id) + '"><h4>' + esc(LABEL[a.asset] || a.asset) +
      ' <span class="sub">' + esc([a.width && a.height ? a.width + '×' + a.height : '', mins_].filter(Boolean).join(' · ')) + '</span></h4>' +
      '<div class="wv-media" data-path="' + esc(a.path) + '" data-kind="' + (isImg ? 'img' : 'video') + '">' +
      '<button type="button" data-wv="play" data-path="' + esc(a.path) + '">' + (isImg ? 'Show' : 'Watch') + '</button></div>' +
      warn + '<p>' + state + '</p>' +
      '<p><button type="button" class="wv-primary" data-wv="approve" data-asset="' + esc(a.id) + '"' + (d && d.decision === 'approved' ? ' disabled' : '') + '>Approve</button> ' +
      '<label class="wv-note">Ask for changes <input type="text" maxlength="4000" data-note="' + esc(a.id) + '" value="' + esc(V.notes[a.id] || '') + '" placeholder="What should change?"></label> ' +
      '<button type="button" data-wv="changes" data-asset="' + esc(a.id) + '">Send</button></p></div>';
  }

  function viewJob(j, ed) {
    if (j.status === 'queued') return '<p class="wv-busy">Waiting for a worker to start the video (queued ' + esc(when(j.requested_at)) + ').</p>';
    if (j.status === 'running') return '<p class="wv-busy">Making the video: narration, photos and document pages. Started ' + esc(when(j.claimed_at)) +
      ' (' + mins(j.claimed_at) + ' min ago). A full report usually takes 30 to 90 minutes. Nothing is needed from you.</p>';
    if (j.status === 'failed') return '<p class="wv-bad">The video could not be made: ' + esc(j.error || 'no reason recorded') + '</p>';
    var as = j.assets || [];
    var approved = as.filter(function (a) { var d = latestDecision(a); return d && d.decision === 'approved'; }).length;
    return '<p class="sub">Made ' + esc(when(j.finished_at)) + '. ' + approved + ' of ' + as.length + ' approved.' +
      (approved === as.length && as.length ? ' Upload the main video to YouTube, then record its address under Report editions above.' : '') + '</p>' +
      as.map(viewAsset).join('');
  }

  function render() {
    if (!V.el) return;
    if (V.st === false || !V.edition) { V.el.innerHTML = ''; return; }
    var jobs = (V.st && V.st.jobs) || [], j = jobs[0], ed = V.edName || 'this edition';
    var head = '<h3>Video</h3><p class="sub">Makes the weekly report video for ' + esc(ed) + ' from its approved script: narration, real photos and the source documents, each where the script calls for it. Nothing is published from here.</p>';
    var btn = active(j) ? '' : '<p><button type="button" class="wv-primary" data-wv="make">' + (j ? 'Make the video again' : 'Make video') + '</button></p>';
    var older = jobs.slice(1).filter(function (x) { return x.status === 'failed' || x.status === 'done'; }).length;
    V.el.innerHTML = '<div class="card" id="wv-card">' + head +
      (V.busy ? '<p class="wv-busy" role="status">Saving…</p>' : '') +
      (V.msg ? '<p class="wv-ok" role="status">' + esc(V.msg) + '</p>' : '') +
      (V.err ? '<p class="wv-bad" role="alert">' + esc(V.err) + '</p>' : '') +
      (j ? viewJob(j, ed) : '<p class="sub">No video made for this edition yet.</p>') + btn +
      (older ? '<p class="sub">' + older + ' earlier attempt(s) are kept in the record.</p>' : '') + '</div>';
    schedule();
  }

  function act(p, ok) {
    V.busy = true; V.err = ''; V.msg = ''; render();
    return p.then(function (r) { V.busy = false; V.msg = typeof ok === 'function' ? ok(r) : ok; return load().then(render); },
      function (e) { V.busy = false; V.err = e.message; return load().then(render); });
  }

  function onClick(ev) {
    var b = ev.target.closest && ev.target.closest('[data-wv]');
    if (!b || !V.el.contains(b)) return;
    var a = b.getAttribute('data-wv');
    if (a === 'make') {
      return act(rpc('hs_weekly_video_request', { p_edition: V.edition }), function (r) {
        return r && r.error ? 'Not started: ' + r.error : r && r.existing ? 'A video is already being made for this edition.' : 'Video started. This card updates by itself.';
      });
    }
    if (a === 'approve') return act(rpc('hs_weekly_video_decide', { p_asset: b.getAttribute('data-asset'), p_decision: 'approved', p_note: null }), 'Approved.');
    if (a === 'changes') {
      var id = b.getAttribute('data-asset'), inp = V.el.querySelector('[data-note="' + id + '"]'), note = inp ? inp.value.trim() : '';
      if (!note) { V.err = 'Say what should change first.'; V.msg = ''; return render(); }
      delete V.notes[id];
      return act(rpc('hs_weekly_video_decide', { p_asset: id, p_decision: 'changes', p_note: note }), 'Changes recorded. Tell Claude to revise the video.');
    }
    if (a === 'play') {
      var box = b.closest('.wv-media'), path = b.getAttribute('data-path'), kind = box.getAttribute('data-kind');
      b.disabled = true; b.textContent = 'Loading…';
      return blobUrl(path).then(function (u) {
        box.innerHTML = kind === 'img' ? '<img class="wv-img" alt="Thumbnail" src="' + esc(u) + '">'
          : '<video class="wv-video" controls preload="metadata" src="' + esc(u) + '"></video>';
      }, function (e) { b.disabled = false; b.textContent = 'Watch'; V.err = 'Could not load the file: ' + e.message; render(); });
    }
  }
  function onInput(ev) { var id = ev.target.getAttribute && ev.target.getAttribute('data-note'); if (id) V.notes[id] = ev.target.value; }

  function css() {
    if (document.getElementById('wv-css')) return;
    var s = document.createElement('style'); s.id = 'wv-css';
    s.textContent = '.wv-asset{border-top:1px solid #e5e7eb;padding:10px 0}.wv-asset h4{margin:4px 0}' +
      '.wv-video{width:100%;max-height:520px;background:#000}.wv-img{max-width:100%}' +
      '.wv-ok{color:#166534;font-weight:600}.wv-bad{color:#b91c1c}.wv-warn{color:#92400e}.wv-busy{color:#1e3a8a}' +
      '.wv-primary{background:#166534;color:#fff;border:0;border-radius:6px;padding:6px 12px;font-weight:600}' +
      '.wv-primary[disabled]{opacity:.5}.wv-note input{min-width:260px}';
    document.head.appendChild(s);
  }

  // mount(client, el): once. show(editionId, editionName): whenever Tab 20's chosen edition changes.
  HS.acqWeeklyVideo = {
    mount: function (client, el) {
      V.client = client; V.el = el; css();
      el.addEventListener('click', onClick); el.addEventListener('input', onInput);
    },
    show: function (edition, name) {
      if (edition === V.edition && V.st !== null) { V.edName = name; return Promise.resolve(); }   // same edition: a playing video is kept
      V.edition = edition || null; V.edName = name; V.st = null; V.err = ''; V.msg = '';
      return load().then(render);
    },
    _state: V
  };
})();
