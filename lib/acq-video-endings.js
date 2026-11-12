/* Your recorded endings (founder, 2026-11-12: "i will prerecord different endings and i want a button in tab 16, 17 and
 * 20 to be able to upload the recording and have it seamed at end of video"; "video of me and voice of me speaking";
 * "shorts and videos have option of adding it"). One panel, mounted per tab:
 *   HS.acqVideoEndings.mount(client, host, { tab: 'youtube' | 'impact' | 'weekly', targets: [...] (weekly only) })
 * Upload a recording once (private bucket video-endings), then choose per main video / Short which recording ends it.
 * The recording REPLACES the generated closing line. The database decides everything (docs/video-endings.sql); the
 * join is homesignal-ingest video/ending.py. This file only shows the library and sends choices.
 * Two upload buttons (founder, same day: "make the 2 buttons"): a vertical recording ends Shorts, a horizontal one
 * ends main videos, so neither is shown inside blurred bars. Each file's picker lists only recordings of its shape;
 * the database refuses the other kind. */
(function () {
  'use strict';
  var HS = window.HS = window.HS || {};
  var ASSETS = {
    youtube: [['final', 'Main video'], ['short1', 'Short 1'], ['short2', 'Short 2']],
    impact: [['main', 'Main video'], ['short_a', 'Short A'], ['short_b', 'Short B']],
    weekly: [['main', 'Main video'], ['short_a', 'Short A'], ['short_b', 'Short B']]
  };
  var AFTER = {
    youtube: 'Rebuilding that file with your recording at the end. It comes back for review in Tab 16 when it is done.',
    impact: 'Saved. Prepare the visuals again and approve them, then render, so the video ends with your recording.',
    weekly: 'Saved. It is used when the weekly video is made.'
  };
  var MAX_BYTES = 250 * 1024 * 1024;
  var SHAPES = {
    vertical: { button: 'Upload ending for Shorts (vertical)', tag: 'Shorts · vertical', hold: 'phone held upright' },
    horizontal: { button: 'Upload ending for main videos (horizontal)', tag: 'Main videos · horizontal', hold: 'phone held sideways' }
  };
  function shapeFor(key) { return /^short/.test(key) ? 'vertical' : 'horizontal'; }
  function fits(e, key) { return !e.shape || e.shape === shapeFor(key); }
  // The recording's own width and height, read by the browser; null when it cannot tell (the upload still goes ahead).
  function dims(file) {
    return new Promise(function (resolve) {
      var v = document.createElement('video'), url = null, settled = false;
      function end(r) { if (settled) return; settled = true; if (url) URL.revokeObjectURL(url); resolve(r); }
      v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = function () { end(v.videoWidth && v.videoHeight ? { w: v.videoWidth, h: v.videoHeight } : null); };
      v.onerror = function () { end(null); };
      setTimeout(function () { end(null); }, 8000);
      try { url = URL.createObjectURL(file); v.src = url; } catch (e) { end(null); }
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function errText(e) { return (e && (e.message || e.details || e.hint)) || String(e || 'unknown error'); }
  function notSetUp(e) { return /PGRST202|Could not find the function|does not exist/.test(errText(e)); }
  function rpc(client, name, args) {
    return client.rpc(name, args || {}).then(function (r) {
      if (r && r.error) throw r.error;
      return r ? r.data : null;
    });
  }
  function extOf(file) {
    var m = /\.(mp4|mov|webm|m4v)$/i.exec(file.name || '');
    if (m) return m[1].toLowerCase();
    return { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v' }[file.type] || null;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function sha256(file) {
    return file.arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); }).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (x) { return (x + 256).toString(16).slice(1); }).join('');
    });
  }
  function mb(n) { return (n / (1024 * 1024)).toFixed(n < 10485760 ? 1 : 0) + ' MB'; }

  function targetsFor(client, opts) {
    if (opts.tab === 'weekly') return Promise.resolve(opts.targets || []);
    if (opts.tab === 'youtube') {
      return rpc(client, 'hs_youtube_videos_list').then(function (rows) {
        return (rows || []).map(function (v) {
          return { id: v.slug, title: v.title || v.slug, has: function (k) { return !v.files || Object.prototype.hasOwnProperty.call(v.files, k); } };
        });
      });
    }
    return rpc(client, 'hs_impact_story_list').then(function (rows) {
      return (rows || []).filter(function (s) { return !s.archived; }).map(function (s) {
        return { id: String(s.id), title: (s.story_number ? s.story_number + ' ' : '') + (s.title || 'Untitled story'), has: function () { return true; } };
      });
    });
  }

  var CSS = '.ve-card{margin:0 0 14px}.ve-card summary{cursor:pointer}.ve-list{margin:8px 0;padding-left:18px}' +
    '.ve-list li{margin:4px 0}.ve-upload{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}' +
    '.ve-row{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;padding:6px 0;border-top:1px solid var(--line,#ddd)}' +
    '.ve-title{flex:1 1 220px;min-width:0;overflow-wrap:anywhere}.ve-picks{display:flex;flex-wrap:wrap;gap:8px}' +
    '.ve-pick select{max-width:220px}.ve-err{color:#b00020}.ve-msg{color:#1b5e20}';
  function style() {
    if (document.getElementById('ve-style')) return;
    var st = document.createElement('style'); st.id = 've-style'; st.textContent = CSS; document.head.appendChild(st);
  }

  function mount(client, host, opts) {
    opts = opts || {};
    style();
    var tab = opts.tab;
    if (!ASSETS[tab]) throw new Error('acqVideoEndings: unknown tab ' + tab);
    var S = { endings: [], targets: [], choices: {}, open: false, msg: '', err: '', busy: '' };

    function load() {
      return Promise.all([rpc(client, 'hs_video_endings_list'), targetsFor(client, opts)]).then(function (r) {
        S.endings = r[0] || []; S.targets = r[1] || [];
        return Promise.all(S.targets.map(function (t) {
          return rpc(client, 'hs_video_ending_choices', { p_tab: tab, p_target: t.id }).then(function (c) { S.choices[t.id] = c || {}; });
        }));
      }).then(draw, function (e) {
        host.innerHTML = '<div class="card ve-card"><h3>Your recorded endings</h3><p class="is-muted">' +
          esc(notSetUp(e) ? 'Recorded endings are not set up in the database yet.' : 'Could not load: ' + errText(e)) + '</p></div>';
      });
    }

    function picker(t, key, label) {
      var cur = (S.choices[t.id] || {})[key];
      var curId = cur && cur.id;
      var opt = '<option value="">Generated closing line</option>' + S.endings.filter(function (e) { return fits(e, key); }).map(function (e) {
        return '<option value="' + esc(e.id) + '"' + (e.id === curId ? ' selected' : '') + '>' + esc(e.label) + '</option>';
      }).join('');
      if (curId && !S.endings.some(function (e) { return e.id === curId; })) {
        opt += '<option value="' + esc(curId) + '" selected>' + esc(cur.label) + ' (archived)</option>';
      }
      return '<label class="ve-pick">' + esc(label) + ' <select data-target="' + esc(t.id) + '" data-asset="' + esc(key) + '"' +
        (t.has(key) ? '' : ' disabled title="This file has not been made yet"') + (S.busy ? ' disabled' : '') + '>' + opt + '</select></label>';
    }

    function draw() {
      // keep the panel as the founder left it: read it from the page, not from a toggle event that may not have run yet
      var prev = host.querySelector('details.ve-card');
      if (prev) S.open = prev.open;
      var list = S.endings.length ? '<ul class="ve-list">' + S.endings.map(function (e) {
        return '<li><b>' + esc(e.label) + '</b> <span class="is-muted">' + esc((SHAPES[e.shape] ? SHAPES[e.shape].tag + ' · ' : 'Any video · ') + mb(e.bytes || 0)) + '</span> ' +
          '<button type="button" class="is-btn is-btn-ghost" data-archive="' + esc(e.id) + '">Remove from library</button></li>';
      }).join('') + '</ul>' : '<p class="is-muted">No recordings yet. Upload one below.</p>';
      var rows = S.targets.length ? S.targets.map(function (t) {
        return '<div class="ve-row"><div class="ve-title">' + esc(t.title) + '</div><div class="ve-picks">' +
          ASSETS[tab].map(function (a) { return picker(t, a[0], a[1]); }).join('') + '</div></div>';
      }).join('') : '<p class="is-muted">No videos to choose for yet.</p>';
      host.innerHTML = '<details class="card ve-card"' + (S.open ? ' open' : '') + '><summary><b>Your recorded endings</b> ' +
        '<span class="is-muted">(' + S.endings.length + ' in your library)</span></summary>' +
        '<p class="is-muted">Upload a video of you speaking, then pick which recording ends each main video or Short. ' +
        'A file with your recording ends on it instead of the generated closing line. Record Shorts endings with the ' +
        'phone held upright and main-video endings with it held sideways.</p>' + list +
        ['vertical', 'horizontal'].map(function (sh) {
          return '<form class="ve-upload" data-shape="' + sh + '"><label>Recording (' + esc(SHAPES[sh].hold) + ') ' +
            '<input type="file" name="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v" required></label> ' +
            '<label>Name <input type="text" name="label" maxlength="80" placeholder="e.g. Subscribe sign-off" required></label> ' +
            '<button type="submit" class="is-btn"' + (S.busy ? ' disabled' : '') + '>' +
            (S.busy === 'upload-' + sh ? 'Uploading…' : esc(SHAPES[sh].button)) + '</button></form>';
        }).join('') +
        (S.err ? '<p class="ve-err" role="alert">' + esc(S.err) + '</p>' : '') + (S.msg ? '<p class="ve-msg">' + esc(S.msg) + '</p>' : '') +
        '<h4>Which recording ends each video</h4>' + rows + '</details>';
      var d = host.querySelector('details');
      d.addEventListener('toggle', function () { S.open = d.open; });
      Array.prototype.forEach.call(host.querySelectorAll('.ve-upload'), function (f) { f.addEventListener('submit', upload); });
      Array.prototype.forEach.call(host.querySelectorAll('select[data-target]'), function (s) { s.addEventListener('change', choose); });
      Array.prototype.forEach.call(host.querySelectorAll('[data-archive]'), function (b) { b.addEventListener('click', archive); });
    }

    function done(msg, err) { S.busy = ''; S.open = true; S.msg = msg || ''; S.err = err || ''; return load(); }

    function upload(ev) {
      ev.preventDefault();
      var f = ev.target.file.files[0], label = (ev.target.label.value || '').trim();
      var shape = ev.target.getAttribute('data-shape');
      S.msg = ''; S.err = '';
      if (!f || !label) { S.err = 'Choose a recording and give it a name.'; return draw(); }
      var ext = extOf(f);
      if (!ext) { S.err = 'Upload an MP4, MOV, WebM or M4V video.'; return draw(); }
      if (f.size > MAX_BYTES) { S.err = 'That file is ' + mb(f.size) + '; the limit is 250 MB. Export it smaller and try again.'; return draw(); }
      var path = uuid() + '.' + ext;
      return dims(f).then(function (d) {
        if (d && d.w !== d.h && (d.h > d.w ? 'vertical' : 'horizontal') !== shape) {
          S.err = 'That recording is ' + (d.h > d.w ? 'vertical (' : 'horizontal (') + d.w + '×' + d.h + '). Use the "' +
            SHAPES[d.h > d.w ? 'vertical' : 'horizontal'].button + '" button for it.';
          draw(); return null;
        }
        S.busy = 'upload-' + shape; draw();
        return go();
      });
      function go() { return sha256(f).then(function (sum) {
        return client.storage.from('video-endings').upload(path, f, { contentType: f.type || 'video/mp4', upsert: false }).then(function (r) {
          if (r && r.error) throw r.error;
          return rpc(client, 'hs_video_ending_register', { p_path: path, p_label: label, p_sha256: sum, p_shape: shape });
        });
      }).then(function () { return done('Uploaded "' + label + '". Pick it below for any ' + (shape === 'vertical' ? 'Short.' : 'main video.')); },
              function (e) { return done('', 'The upload did not finish: ' + errText(e)); }); }
    }

    function choose(ev) {
      var s = ev.target;
      S.busy = 'choose'; S.msg = ''; S.err = '';
      return rpc(client, 'hs_video_ending_choose', { p_tab: tab, p_target: s.getAttribute('data-target'),
        p_asset: s.getAttribute('data-asset'), p_ending: s.value || null }).then(function (r) {
        return done(r && r.changed === false ? 'No change.' : AFTER[tab]);
      }, function (e) { return done('', errText(e)); });
    }

    function archive(ev) {
      var id = ev.target.getAttribute('data-archive');
      S.busy = 'archive';
      return rpc(client, 'hs_video_ending_archive', { p_id: id }).then(function () {
        return done('Removed from your library. Videos already using it keep it until you pick another.');
      }, function (e) { return done('', errText(e)); });
    }

    host.innerHTML = '<div class="card ve-card"><p class="is-muted">Loading your recorded endings…</p></div>';
    return load();
  }

  HS.acqVideoEndings = { mount: mount, ASSETS: ASSETS, SHAPES: SHAPES, shapeFor: shapeFor };
})();
