/* Jody Acquisition Dashboard, Tab 16 (YouTube Videos): "Suggest a video".
   The founder's own requests for a Public Records video (founder, 2026-10-28: Tab 16 and Tab 17 make different
   kinds of video, so each has its own suggestion box). Tab 17's box is in Hot Topics (lib/acq-impact-discovery.js);
   this one feeds the Tab 16 video pipeline (homesignal-ingest video/README.md stage 1 takes these first).

   It only adds and withdraws: hs_youtube_video_suggest, hs_youtube_video_suggestion_withdraw and
   hs_youtube_video_suggestions_list (docs/youtube-video-suggestions.sql). A session updates the status.
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
    waiting: 'Waiting: the next video session takes it first',
    picked: 'Picked: a video is being researched',
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
      (open ? '<button type="button" class="vs-withdraw">Withdraw</button>' : '') + '</li>';
  }

  function render(list, state) {
    list = Array.isArray(list) ? list : [];
    var open = list.filter(function (s) { return s.status === 'waiting' || s.status === 'picked'; }).length;
    return '<div class="card" id="vs-card"><h3>Suggest a video</h3>' +
      '<p class="sub">For this tab’s Public Records videos: one development or permit, told from its own public documents. ' +
      'Name the project and add links to its record. The next video session takes your suggestions first. ' +
      'Links are where to start looking: the video still uses only the record’s own documents, and you still approve it here. ' +
      '(Impact Stories topics are suggested in 17 · Impact Stories → Hot Topics.)</p>' +
      '<details id="vs-form"' + (state.open ? ' open' : '') + '><summary><b>New suggestion</b></summary>' +
      '<p><label>Project or subject<br><input id="vs-title" maxlength="300" style="width:100%" placeholder="e.g. Port of Tacoma Blair Waterway dredging"></label></p>' +
      '<p><label>Place or ZIP (optional)<br><input id="vs-place" maxlength="200" style="width:100%"></label></p>' +
      '<p><label>Links to the record, one per line (optional)<br><textarea id="vs-links" rows="3" style="width:100%"></textarea></label></p>' +
      '<p><label>Why it matters (optional)<br><textarea id="vs-note" rows="3" maxlength="2000" style="width:100%"></textarea></label></p>' +
      '<p><button type="button" class="vs-add yv-primary"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Adding…' : 'Add suggestion') + '</button> ' +
      '<span class="vs-msg sub">' + esc(state.msg || '') + '</span></p></details>' +
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
          var topic = {
            title: (k['vs-title'] || '').trim(), place: (k['vs-place'] || '').trim(), note: (k['vs-note'] || '').trim(),
            links: (k['vs-links'] || '').split(/\s+/).map(function (s) { return s.trim(); }).filter(Boolean)
          };
          if (topic.title.length < 5) { state.msg = 'Give the video a subject of at least 5 characters.'; draw(HS.acqVideoSuggest._last, k); return; }
          state.busy = true; state.msg = ''; draw(HS.acqVideoSuggest._last, k);
          client.rpc('hs_youtube_video_suggest', { p_topic: topic }).then(function (r) {
            state.busy = false;
            if (r && r.error) { state.msg = friendly(r.error); return refresh(k); }
            state.msg = 'Added. The next video session takes it first.'; state.open = false;
            return refresh({});
          }, function () { state.busy = false; state.msg = 'Could not reach the server. Try again.'; return refresh(k); });
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

  HS.acqVideoSuggest = { esc: esc, render: render, item: item, mount: mount, _last: [] };
})();
