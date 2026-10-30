/* Jody Acquisition Dashboard, Tab 16 (YouTube Videos): "Suggest a video".
   The founder's own requests for a Public Records video (founder, 2026-10-28: Tab 16 and Tab 17 make different
   kinds of video, so each has its own suggestion box). Tab 17's box is in Hot Topics (lib/acq-impact-discovery.js);
   this one feeds the Tab 16 video pipeline (homesignal-ingest video/README.md stage 1 takes these first).

   It adds, withdraws and starts videos: hs_youtube_video_suggest, hs_youtube_video_suggestion_withdraw,
   hs_youtube_video_suggestion_make and hs_youtube_video_suggestions_list (docs/youtube-video-suggestions.sql).
   Make video (founder, 2026-10-30) starts homesignal-ingest video-suggestion-run.yml: Claude finds and fetches the record,
   writes the project, and the run checks, builds and uploads it to the list above for review. The run sets the status.
   Links are where to start looking, never evidence. It lives in its own box beside the video list, so the list's
   automatic refresh never wipes what is being typed. Every value is escaped before it reaches markup. */
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

  var STATUS = {
    waiting: 'Waiting',
    picked: 'Picked: a video is being made',
    made: 'Made',
    declined: 'Not made',
    withdrawn: 'Withdrawn'
  };

  function item(s) {
    var open = s.status === 'waiting' || s.status === 'picked';
    var links = Array.isArray(s.links) ? s.links : [];
    return '<li class="vs-item" data-id="' + esc(s.id) + '"><b>' + esc(s.title) + '</b>' +
      (s.place ? ' <span class="sub">· ' + esc(s.place) + '</span>' : '') +
      '<div class="sub">' + esc(STATUS[s.status] || s.status) +
      (s.status === 'made' && s.project_slug ? ': ' + esc(s.project_slug) : '') +
      (s.status_note ? ' — ' + esc(s.status_note) : '') + ' · added ' + esc(day(s.created_at)) + '</div>' +
      (s.note ? '<div class="sub">' + esc(s.note) + '</div>' : '') +
      (links.length ? '<div class="sub">' + links.map(function (u) {
        var safe = /^https?:\/\//i.test(String(u)) ? String(u) : '';
        return safe ? '<a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">' + esc(safe) + '</a>' : '';
      }).join(' · ') + '</div>' : '') +
      runLine(s.run) +
      (open ? (runActive(s.run) ? '' : '<button type="button" class="vs-make yv-primary">' +
        (s.run && (s.run.status === 'failed' || s.run.status === 'stalled') ? 'Try again' : 'Make video') + '</button> ') +
        '<button type="button" class="vs-withdraw">Withdraw</button>' : '') + '</li>';
  }

  var RUN = {
    queued: 'Starting the video run…',
    working: 'Making the video: Claude is reading the record, then it is built and sent to the list above for you to review. This takes about 1 to 3 hours.',
    stalled: 'The video run stopped without finishing.',
    made: 'Video made. It is waiting for your review in the list above.',
    declined: 'The video could not be made from the record.',
    failed: 'The video run failed.'
  };
  function runActive(r) { return !!r && (r.status === 'queued' || r.status === 'working'); }
  function runLine(r) {
    if (!r || !r.status) return '';
    return '<div class="sub vs-run" data-run="' + esc(r.status) + '"><b>' + esc(RUN[r.status] || r.status) + '</b>' +
      (r.summary ? ' ' + esc(r.summary) : '') + (r.next_step && !runActive(r) ? ' Next: ' + esc(r.next_step) : '') + '</div>';
  }

  function render(list, state) {
    list = Array.isArray(list) ? list : [];
    var open = list.filter(function (s) { return s.status === 'waiting' || s.status === 'picked'; }).length;
    return '<div class="card" id="vs-card"><h3>Suggest a video</h3>' +
      '<p class="sub">For this tab’s Public Records videos: one development or permit, told from its own public documents. ' +
      'Name the project and add links to its record, then press Make video: Claude finds the record, writes the video and sends it to the list above. ' +
      'Links are where to start looking: the video still uses only the record’s own documents, and you still approve it here. ' +
      '(Impact Stories topics are suggested in 17 · Impact Stories → Hot Topics.)</p>' +
      '<details id="vs-form"' + (state.open ? ' open' : '') + '><summary><b>New suggestion</b></summary>' +
      '<p><label>Project or subject<br><input id="vs-title" maxlength="300" style="width:100%" placeholder="e.g. Port of Tacoma Blair Waterway dredging"></label></p>' +
      '<p><label>Place or ZIP (optional)<br><input id="vs-place" maxlength="200" style="width:100%"></label></p>' +
      '<p><label>Links to the record, one per line (optional; anything that is not a web address is kept as a note)<br><textarea id="vs-links" rows="3" style="width:100%"></textarea></label></p>' +
      '<p><label>Why it matters (optional)<br><textarea id="vs-note" rows="3" maxlength="2000" style="width:100%"></textarea></label></p>' +
      '<p><button type="button" class="vs-add yv-primary"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Adding…' : 'Add suggestion') + '</button> ' +
      '<span class="vs-msg" role="status" style="margin-left:8px;font-weight:600;color:' + (state.ok ? '#1d6b45' : '#b42318') + '">' + esc(state.msg || '') + '</span></p></details>' +
      (state.error ? '<p class="sub">Your suggestions could not be read (' + esc(state.error) + ').</p>'
        : (list.length ? '<p class="sub">' + open + ' open</p><ul class="vs-list">' + list.map(item).join('') + '</ul>'
          : '<p class="sub">No suggestions yet.</p>')) + '</div>';
  }

  function friendly(e) {
    if (e && e.code === '42501') return 'You are not signed in as an admin.';
    var m = e && e.message ? String(e.message) : '';
    return m && m.length < 220 ? m : 'Could not add that (' + ((e && e.code) || 'error') + ').';
  }

  var FIELDS = ['vs-title', 'vs-place', 'vs-links', 'vs-note'];

  function mount(client, host) {
    if (!client || !host) return Promise.resolve(false);
    var state = host._vs || (host._vs = { open: false, busy: false, msg: '', error: '' });
    function keep() {
      var k = {};
      FIELDS.forEach(function (id) { var el = host.querySelector('#' + id); if (el) k[id] = el.value; });
      var f = host.querySelector('#vs-form'); if (f) state.open = f.open;
      return k;
    }
    function restore(k) { Object.keys(k || {}).forEach(function (id) { var el = host.querySelector('#' + id); if (el) el.value = k[id]; }); }
    function draw(list, k) { host.innerHTML = render(list, state); restore(k); }
    function refresh(k) {
      return client.rpc('hs_youtube_video_suggestions_list').then(function (r) {
        state.error = r && r.error ? (r.error.code || 'error') : '';
        HS.acqVideoSuggest._last = r && !r.error && Array.isArray(r.data) ? r.data : [];
        draw(HS.acqVideoSuggest._last, k);
        return !state.error;
      }, function () { state.error = 'unreachable'; HS.acqVideoSuggest._last = []; draw([], k); return false; });
    }
    if (!host._vsWired) {
      host._vsWired = true;
      host.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        if (t.classList.contains('vs-add')) {
          var k = keep();
          var split = HS.acqVideoSuggest.splitLinks(k['vs-links'] || '');
          var note = (k['vs-note'] || '').trim();
          if (split.words) note = note ? note + '\n' + split.words : split.words;
          var topic = { title: (k['vs-title'] || '').trim(), place: (k['vs-place'] || '').trim(), note: note, links: split.links };
          if (topic.title.length < 5) { state.msg = 'Give the video a subject of at least 5 characters.'; draw(HS.acqVideoSuggest._last, k); return; }
          state.busy = true; state.msg = ''; state.ok = false; draw(HS.acqVideoSuggest._last, k);
          client.rpc('hs_youtube_video_suggest', { p_topic: topic }).then(function (r) {
            state.busy = false;
            if (r && r.error) { state.msg = friendly(r.error); return refresh(k); }
            state.msg = 'Added. Press Make video to start it.'; state.ok = true; state.open = false;
            return refresh({});
          }, function () { state.busy = false; state.msg = 'Could not reach the server. Try again.'; return refresh(k); });
          return;
        }
        if (t.classList.contains('vs-make')) {
          var li0 = t.closest('.vs-item');
          if (!li0) return;
          t.disabled = true; t.textContent = 'Starting…';
          var k0 = keep();
          client.rpc('hs_youtube_video_suggestion_make', { p_id: li0.getAttribute('data-id') }).then(function (r) {
            if (r && r.error) { state.msg = friendly(r.error); state.ok = false; }
            else { state.msg = 'Started. The video arrives in the list above when it is built.'; state.ok = true; }
            return refresh(k0);
          }, function () { state.msg = 'Could not reach the server. Try again.'; state.ok = false; return refresh(k0); });
          return;
        }
        if (t.classList.contains('vs-withdraw')) {
          var li = t.closest('.vs-item');
          if (!li) return;
          t.disabled = true;
          var k2 = keep();
          client.rpc('hs_youtube_video_suggestion_withdraw', { p_id: li.getAttribute('data-id') }).then(function (r) {
            if (r && r.error) state.msg = friendly(r.error);
            return refresh(k2);
          }, function () { state.msg = 'Could not reach the server. Try again.'; return refresh(k2); });
        }
      });
    }
    return refresh(keep());
  }

  // The Links box takes web addresses; anything else typed there ("Apollo Global Management") is kept as a note
  // instead of making the whole suggestion fail. "www.x.gov/..." and "x.gov/..." get https:// in front.
  function splitLinks(text) {
    var links = [], words = [];
    String(text || '').split(/\s+/).forEach(function (t) {
      var u = t.replace(/[),.;]+$/, '');
      if (/^https?:\/\/\S+$/i.test(u)) links.push(u);
      else if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?$/i.test(u)) links.push('https://' + u);
      else if (t) words.push(t);
    });
    return { links: links, words: words.join(' ') };
  }

  HS.acqVideoSuggest = { esc: esc, render: render, item: item, mount: mount, splitLinks: splitLinks, runLine: runLine, _last: [] };
})();
