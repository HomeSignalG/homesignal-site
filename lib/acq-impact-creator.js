/* Creator-directed Impact Stories, Tab 17 (founder brief 2026-11-06). Two pieces of page, shared by the Suggest form
 * (lib/acq-impact-discovery.js) and the story workspace (lib/acq-impact-stories.js):
 *
 *   editor(ed, prefix)   the scene-by-scene script editor: paste a storyboard and parse it into scenes, the emotional arc,
 *                        and one card per scene (stage, duration, exact headline, exact narration, visual and audio
 *                        direction, sources) with add / duplicate / move / remove, and a read-through preview with the
 *                        estimated speaking time against each scene's duration. `ed` holds the text, not the form, so a
 *                        panel that redraws itself never loses typing.
 *   review(cs, opts)     a story's script after research: version, flags beside the founder's own words with the
 *                        records, the suggested replacement, Accept / Keep my words / Edit, the waiting revision
 *                        (Send with Fix, Compare, Withdraw), timing conflicts and the revision history.
 *   pipeline(key, bad)   Draft → Researching → Review Required → Script Approved → Rendering → Ready for Review.
 *
 * Nothing here decides anything: the database (docs/impact-stories.sql _hs_is_creator_state) says what may be approved,
 * and the engine (homesignal-ingest impact/creator.py) says what is flagged. The founder's words are shown exactly. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  function C() { return HS.creatorScript; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function secs(n) { n = Math.max(0, Math.round(n || 0)); return Math.floor(n / 60) + ':' + ('0' + (n % 60)).slice(-2); }
  var STAGE_CLS = { fear: 'fear', anger: 'anger', motivation: 'motivation', custom: 'context' };
  var PIPE = [['draft', 'Draft'], ['researching', 'Researching'], ['review', 'Review Required'], ['approved', 'Script Approved'],
              ['rendering', 'Rendering'], ['ready', 'Ready for Review']];

  function css() {
    if (document.getElementById('cs-css')) return;
    var st = document.createElement('style'); st.id = 'cs-css';
    st.textContent = '.cs-pipe{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;padding:0;list-style:none}' +
      '.cs-pipe li{font-size:12px;padding:3px 8px;border-radius:999px;border:1px solid var(--line,#d8ddd6);color:var(--muted,#5b6b5f)}' +
      '.cs-pipe li.done{background:#e3f1e6;color:#1d5a2d;border-color:#b9d9c1}.cs-pipe li.now{background:#1d5a2d;color:#fff;border-color:#1d5a2d;font-weight:600}' +
      '.cs-pipe li.bad{background:#fbe5e1;color:#8a2416;border-color:#efb8ad;font-weight:600}' +
      '.cs-arc{display:flex;gap:2px;margin:6px 0;border-radius:6px;overflow:hidden;min-height:26px}' +
      '.cs-arc span{flex:1;padding:4px 6px;font-size:12px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.cs-arc .fear{background:#7a3e2e}.cs-arc .anger{background:#9b5a12}.cs-arc .motivation{background:#1d6b3a}.cs-arc .context{background:#55606a}' +
      '.cs-scene{border:1px solid var(--line,#d8ddd6);border-radius:8px;padding:10px;margin:8px 0;background:var(--card,#fff)}' +
      '.cs-scene legend{font-weight:600;padding:0 4px}.cs-grid{display:grid;gap:6px}.cs-row{display:flex;flex-wrap:wrap;gap:8px;align-items:end}' +
      '.cs-scene textarea,.cs-scene input[type=text]{width:100%}.cs-over{color:#8a2416;font-weight:600}' +
      '.cs-flag{border-left:4px solid #b06a00;background:#fff7e8;padding:8px;margin:6px 0;border-radius:4px}' +
      '.cs-flag.high{border-left-color:#a42a16;background:#fdeeea}.cs-flag.done{border-left-color:#1d6b3a;background:#eef7f0}' +
      '.cs-text{white-space:pre-wrap;background:var(--soft,#f6f7f4);padding:8px;border-radius:6px}' +
      '.cs-text mark{background:#ffe08a;padding:0 1px}.cs-text mark.high{background:#f6b4a6}' +
      '.cs-diff del{background:#fbe5e1;text-decoration:line-through}.cs-diff ins{background:#e3f1e6;text-decoration:none}' +
      '.cs-lock{font-size:12px;color:#1d5a2d}';
    document.head.appendChild(st);
  }

  // ── pipeline ─────────────────────────────────────────────────────────────────────────────────────────────────
  function pipeline(key, bad) {
    var at = PIPE.map(function (p) { return p[0]; }).indexOf(key);
    return '<ol class="cs-pipe" aria-label="Story status">' + PIPE.map(function (p, i) {
      var cls = i < at ? 'done' : i === at ? (bad ? 'bad' : 'now') : '';
      return '<li class="' + cls + '"' + (i === at ? ' aria-current="step"' : '') + '>' + esc(p[1]) + (i === at && bad ? ' · ' + esc(bad) : '') + '</li>';
    }).join('') + '</ol>';
  }

  function arcBar(scenes) {
    var arc = C().arcSummary(scenes || []);
    if (!arc.length) return '';
    return '<div class="cs-arc" role="img" aria-label="Emotional arc">' + arc.map(function (a) {
      var n = a.to - a.from + 1;
      return '<span class="' + (STAGE_CLS[a.stage] || 'context') + '" style="flex:' + n + '" title="' + esc(a.label) + ', scenes ' + a.from + '–' + a.to + '">' +
        esc(a.label) + ' · ' + (a.from === a.to ? 'scene ' + a.from : 'scenes ' + a.from + '–' + a.to) + '</span>';
    }).join('') + '</div>';
  }

  // ── editor ───────────────────────────────────────────────────────────────────────────────────────────────────
  // ed: {script: creator-script/1 (unsaved), notes: [...], paste: text, showPaste, preview}
  function newEditor(script) {
    var s = script ? JSON.parse(JSON.stringify(script)) : { format: C().FORMAT, target_seconds: null, raw: '', scenes: [C().emptyScene(1, 'fear')] };
    (s.scenes || []).forEach(function (x) { x.sources = x.sources || []; });
    return { script: s, notes: [], paste: '', showPaste: !script, preview: false };
  }
  function stageOptions(sel) {
    return C().STAGES.map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(C().STAGE_LABEL[k]) + '</option>'; }).join('');
  }
  function sceneCard(sc, i, n, prefix) {
    var est = C().estimateSeconds(sc.narration), over = sc.seconds && est > sc.seconds;
    var id = function (k) { return prefix + '-' + k + '-' + i; };
    return '<fieldset class="cs-scene" aria-label="Scene ' + (i + 1) + '"><legend>Scene ' + (i + 1) + '</legend><div class="cs-grid">' +
      '<div class="cs-row"><label>Emotional stage <select class="is-in" id="' + id('stage') + '" data-cs="stage" data-i="' + i + '">' + stageOptions(sc.stage) + '</select></label>' +
      (sc.stage === 'custom' ? '<label>Stage name <input class="is-in" type="text" id="' + id('label') + '" data-cs="stage_label" data-i="' + i + '" maxlength="60" value="' + esc(sc.stage_label) + '"></label>' : '') +
      '<label>Duration (seconds, optional) <input class="is-in" type="number" min="1" max="600" style="width:90px" id="' + id('sec') + '" data-cs="seconds" data-i="' + i + '" value="' + esc(sc.seconds == null ? '' : sc.seconds) + '"></label>' +
      '<span class="is-muted' + (over ? ' cs-over' : '') + '" data-cs-est="' + i + '">' + timingText(est, sc.seconds) + '</span></div>' +
      '<label>Slide headline <span class="is-muted">(the exact words on screen)</span><input class="is-in" type="text" id="' + id('head') + '" data-cs="headline" data-i="' + i + '" maxlength="300" value="' + esc(sc.headline) + '"></label>' +
      '<label>Narration <span class="is-muted">(the exact words spoken; required)</span><textarea class="is-in" rows="4" id="' + id('narr') + '" data-cs="narration" data-i="' + i + '" maxlength="5000">' + esc(sc.narration) + '</textarea></label>' +
      '<label>Visual direction <span class="is-muted">(footage, imagery, camera)</span><textarea class="is-in" rows="2" id="' + id('vis') + '" data-cs="visual" data-i="' + i + '" maxlength="2000">' + esc(sc.visual) + '</textarea></label>' +
      '<label>Audio direction <span class="is-muted">(music, sound, silence)</span><input class="is-in" type="text" id="' + id('aud') + '" data-cs="audio" data-i="' + i + '" maxlength="2000" value="' + esc(sc.audio) + '"></label>' +
      '<label>Supporting sources <span class="is-muted">(links, one per line; leads for research, not evidence)</span><textarea class="is-in" rows="2" id="' + id('src') + '" data-cs="sources" data-i="' + i + '">' + esc((sc.sources || []).join('\n')) + '</textarea></label>' +
      '<div class="cs-row"><span class="is-muted">Verification: Pending (research checks every sentence)</span><span style="flex:1"></span>' +
      '<button class="is-btn" data-cs-act="up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move scene ' + (i + 1) + ' up">↑ Move up</button>' +
      '<button class="is-btn" data-cs-act="down" data-i="' + i + '"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="Move scene ' + (i + 1) + ' down">↓ Move down</button>' +
      '<button class="is-btn" data-cs-act="dup" data-i="' + i + '">Duplicate</button>' +
      '<button class="is-btn warn" data-cs-act="remove" data-i="' + i + '"' + (n === 1 ? ' disabled' : '') + '>Remove</button></div>' +
      '</div></fieldset>';
  }
  function timingText(est, asked) {
    return 'about ' + est + ' s of narration' + (asked ? (est > asked ? ' — longer than the ' + asked + ' s you asked for; the video keeps every word' : ' (fits ' + asked + ' s)') : '');
  }
  function preview(s) {
    var total = 0;
    var rows = (s.scenes || []).map(function (sc, i) {
      var est = C().estimateSeconds(sc.narration), d = Math.max(est, sc.seconds || 0); total += d;
      return '<li><b>Scene ' + (i + 1) + '</b> · ' + esc(sc.stage === 'custom' ? sc.stage_label || 'Custom' : C().STAGE_LABEL[sc.stage]) +
        (sc.headline ? ' · <i>' + esc(sc.headline) + '</i>' : '') + '<div class="cs-text">' + esc(sc.narration) + '</div>' +
        '<span class="is-muted">' + timingText(est, sc.seconds) + '</span></li>';
    }).join('');
    return '<div class="is-panel"><h4 style="margin:0">Read-through</h4><p class="is-muted">About ' + secs(total) + ' in all' +
      (s.target_seconds ? ' (you asked for about ' + secs(s.target_seconds) + ')' : '') + ', at ' + C().WPM + ' words a minute.</p><ol class="is-list">' + rows + '</ol></div>';
  }
  function editor(ed, prefix) {
    css();
    var s = ed.script, sc = s.scenes || [], probs = C().problems(C().normalize(s));
    var chars = sc.reduce(function (n, x) { return n + C().clean(x.narration).length; }, 0);
    return '<div class="cs-editor" data-cs-root="' + esc(prefix) + '">' +
      '<details' + (ed.showPaste ? ' open' : '') + ' data-cs-paste-box><summary><b>Paste a complete storyboard</b> <span class="is-muted">— then Parse into scenes</span></summary>' +
      '<p class="is-muted">Start each scene with a line such as "SCENE 3 — ANGER (11s)", then labelled lines: Headline, Narration, Visual, Audio, Sources. ' +
      'A "Target length: 4:30" line before the first scene sets the target. Nothing pasted is thrown away: lines the parser cannot place are listed for you, and the whole paste is kept with the script.</p>' +
      '<textarea class="is-in" rows="8" style="width:100%" id="' + prefix + '-paste" data-cs-paste>' + esc(ed.paste) + '</textarea>' +
      '<div class="cs-row" style="margin-top:6px"><button class="is-btn" data-cs-act="parse">Parse into scenes</button>' +
      '<span class="is-muted">Parsing replaces the scenes below.</span></div></details>' +
      ((ed.notes || []).length ? '<div class="is-warnbox" role="status"><b>Check these lines from your paste</b> (they were not placed in a scene field; add them by hand where they belong):<ul class="is-list">' +
        ed.notes.slice(0, 40).map(function (n) { return '<li>' + (n.scene ? 'Scene ' + n.scene + ': ' : '') + '“' + esc(n.line) + '” — ' + esc(n.why) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="cs-row" style="margin-top:8px"><label>Target duration (seconds, optional) <input class="is-in" type="number" min="10" max="3600" style="width:100px" id="' + prefix + '-target" data-cs="target_seconds" value="' + esc(s.target_seconds == null ? '' : s.target_seconds) + '"></label>' +
      '<span class="is-muted">' + sc.length + ' scene' + (sc.length === 1 ? '' : 's') + ' · ' + chars.toLocaleString('en-US') + ' characters of narration (up to ' + C().LIMITS.total.toLocaleString('en-US') + ') · about ' + secs(sc.reduce(function (n, x) { return n + Math.max(C().estimateSeconds(x.narration), x.seconds || 0); }, 0)) + '</span></div>' +
      '<h4 style="margin:10px 0 0">Emotional arc</h4>' + (arcBar(sc) || '<p class="is-muted">Add scenes to see the arc.</p>') +
      '<p class="is-muted" style="margin:0">The default arc is Fear → Anger / accountability → Motivation / agency. Set each scene\'s stage; the arc follows your scenes and never changes your words.</p>' +
      sc.map(function (x, i) { return sceneCard(x, i, sc.length, prefix); }).join('') +
      '<div class="cs-row"><button class="is-btn" data-cs-act="add">+ Add scene</button>' +
      '<button class="is-btn" data-cs-act="preview" aria-expanded="' + !!ed.preview + '">' + (ed.preview ? 'Hide the read-through' : 'Preview the narration in order') + '</button></div>' +
      (ed.preview ? preview(s) : '') +
      (probs.length ? '<div class="is-warnbox"><b>Before saving:</b><ul class="is-list">' + probs.slice(0, 8).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>' : '') +
      '</div>';
  }
  /* An input in the editor. Returns true when it was one. Updates only the text it holds (no redraw), so the cursor stays. */
  function onInput(ed, t, root) {
    if (t.hasAttribute('data-cs-paste')) { ed.paste = t.value; return true; }
    var f = t.getAttribute('data-cs'); if (!f) return false;
    if (f === 'target_seconds') { ed.script.target_seconds = t.value === '' ? null : parseInt(t.value, 10); return true; }
    var sc = ed.script.scenes[Number(t.getAttribute('data-i'))]; if (!sc) return true;
    if (f === 'sources') sc.sources = t.value.split(/\s+/).map(function (x) { return x.trim(); }).filter(Boolean);
    else if (f === 'seconds') sc.seconds = t.value === '' ? null : parseInt(t.value, 10);
    else sc[f] = t.value;
    if (f === 'narration' || f === 'seconds') {
      var est = C().estimateSeconds(sc.narration), e = root && root.querySelector('[data-cs-est="' + t.getAttribute('data-i') + '"]');
      if (e) { e.textContent = timingText(est, sc.seconds); e.className = 'is-muted' + (sc.seconds && est > sc.seconds ? ' cs-over' : ''); }
    }
    return f === 'stage' ? 'render' : true;
  }
  /* A button in the editor. Returns 'render' when the editor must be drawn again, a string message for a refusal, or null. */
  function onAction(ed, t) {
    var a = t.getAttribute('data-cs-act'), i = Number(t.getAttribute('data-i')), sc = ed.script.scenes;
    if (a === 'parse') {
      if (!C().clean(ed.paste)) return 'Paste a storyboard first.';
      var r = C().parse(ed.paste);
      if (!r.script.scenes.length) return 'No scenes were found. Start each scene with a line such as "SCENE 1 — FEAR (8s)". Nothing was changed.';
      if (sc.some(function (x) { return C().clean(x.narration); }) && !window.confirm('Replace the ' + sc.length + ' scene(s) below with the ' + r.script.scenes.length + ' parsed from your paste?')) return null;
      ed.script = r.script; ed.notes = r.notes; ed.showPaste = false;
      return 'render';
    }
    if (a === 'add') { sc.push(C().emptyScene(sc.length + 1, sc.length ? sc[sc.length - 1].stage : 'fear')); }
    else if (a === 'dup') { sc.splice(i + 1, 0, JSON.parse(JSON.stringify(sc[i]))); }
    else if (a === 'remove') {
      if (sc.length === 1) return null;
      if (C().clean(sc[i].narration) && !window.confirm('Remove scene ' + (i + 1) + ' and its narration?')) return null;
      sc.splice(i, 1);
    }
    else if (a === 'up' && i > 0) { var u = sc[i - 1]; sc[i - 1] = sc[i]; sc[i] = u; }
    else if (a === 'down' && i < sc.length - 1) { var d = sc[i + 1]; sc[i + 1] = sc[i]; sc[i] = d; }
    else if (a === 'preview') { ed.preview = !ed.preview; }
    else return null;
    sc.forEach(function (x, k) { x.n = k + 1; });
    return 'render';
  }
  /* The script ready to send, or {problems}. */
  function finished(ed) {
    var s = C().normalize(ed.script), p = C().problems(s);
    return p.length ? { problems: p } : { script: s };
  }

  // ── review (a story's script after research) ─────────────────────────────────────────────────────────────────
  function marked(text, flags) {
    var out = esc(text || '');
    (flags || []).forEach(function (f) {
      if (!f.sentence) return;
      var e = esc(f.sentence), at = out.indexOf(e);
      if (at >= 0) out = out.slice(0, at) + '<mark class="' + (f.risk === 'high' ? 'high' : '') + '">' + e + '</mark>' + out.slice(at + e.length);
    });
    return out;
  }
  function wordDiff(a, b) {
    var x = String(a || '').split(/(\s+)/), y = String(b || '').split(/(\s+)/), n = x.length, m = y.length, L = [], i, j;
    if (n * m > 400000) return '<del>' + esc(a) + '</del> <ins>' + esc(b) + '</ins>';
    for (i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = ''; i = 0; j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { out += esc(x[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { out += '<del>' + esc(x[i]) + '</del>'; i++; }
      else { out += '<ins>' + esc(y[j]) + '</ins>'; j++; }
    }
    while (i < n) out += '<del>' + esc(x[i++]) + '</del>';
    while (j < m) out += '<ins>' + esc(y[j++]) + '</ins>';
    return out;
  }
  /* Scene by scene, what a revision changes against the locked script (the original stays in the history). */
  function compare(before, after) {
    var a = (before && before.scenes) || [], b = (after && after.scenes) || [], rows = [];
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var x = a[i] || {}, y = b[i] || {};
      ['stage', 'headline', 'narration', 'seconds', 'visual', 'audio'].forEach(function (k) {
        var p = k === 'stage' ? (x.stage || '') + (x.stage_label ? ': ' + x.stage_label : '') : x[k], q = k === 'stage' ? (y.stage || '') + (y.stage_label ? ': ' + y.stage_label : '') : y[k];
        if (String(p == null ? '' : p) !== String(q == null ? '' : q)) {
          rows.push('<tr><th>Scene ' + (i + 1) + ' ' + esc(k) + '</th><td class="cs-diff">' + (a[i] && b[i] ? wordDiff(String(p == null ? '' : p), String(q == null ? '' : q))
            : a[i] ? '<del>' + esc(p) + '</del> (scene removed)' : '<ins>' + esc(q) + '</ins> (scene added)') + '</td></tr>');
        }
      });
    }
    return rows.length ? '<table class="is-tab">' + rows.join('') + '</table>' : '<p class="is-muted">No differences.</p>';
  }
  var REV_STATUS = { current: ['Current — locked', 'ok'], proposed: ['Proposed — not sent', 'wait'], sending: ['Sent — being applied', 'wait'],
    applying: ['Applied — new version being checked', 'wait'], superseded: ['Earlier version', ''], withdrawn: ['Withdrawn', 'bad'] };
  var VERDICT_CLS = { high: 'high' };
  function flagBox(f, opts) {
    var done = f.decision === 'keep' || f.in_revision;
    var src = (f.sources || []).map(function (s) {
      return '<li>' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.label || s.url) + '</a>' : esc(s.label || s.claim)) +
        (s.quote ? ': “' + esc(String(s.quote).slice(0, 280)) + '”' : '') + '</li>';
    }).join('');
    var buttons = '';
    if (!done && opts.canAct) {
      if (f.suggestion) buttons += '<button class="is-btn primary" data-act="cs-accept" data-key="' + esc(f.key) + '">Accept suggestion</button>';
      if (f.risk === 'low') buttons += '<button class="is-btn" data-act="cs-keep" data-key="' + esc(f.key) + '">Keep my words</button>';
      buttons += '<button class="is-btn" data-act="cs-edit" data-scene="' + esc(f.scene) + '">Edit scene ' + esc(f.scene) + '</button>';
    }
    return '<div class="cs-flag ' + (done ? 'done' : (VERDICT_CLS[f.risk] || '')) + '" role="group" aria-label="Flag on scene ' + esc(f.scene) + '">' +
      '<b>' + esc(f.label || f.verdict) + '</b> · ' + (f.risk === 'high' ? '<span class="is-badge bad">High risk — blocks approval</span>' : '<span class="is-badge wait">Low risk — your decision</span>') +
      (f.field === 'headline' ? ' <span class="is-muted">(headline)</span>' : '') +
      '<p style="margin:4px 0"><b>Your words:</b> “' + esc(f.sentence) + '”</p>' +
      '<p style="margin:4px 0"><b>Concern:</b> ' + esc(f.concern) + '</p>' +
      (src ? '<p style="margin:4px 0"><b>Records:</b></p><ul class="is-list">' + src + '</ul>' : '') +
      (f.suggestion ? '<p style="margin:4px 0"><b>Suggested replacement:</b> “' + esc(f.suggestion) + '”</p>' : '') +
      (f.decision === 'keep' ? '<div class="is-okbox">You kept your words' + (f.decision_note ? ': ' + esc(f.decision_note) : '.') + '</div>' : '') +
      (f.in_revision ? '<div class="is-okbox">Changed in your waiting revision.</div>' : '') +
      (buttons ? '<div class="cs-row">' + buttons + '</div>' : '') + '</div>';
  }
  function review(cs, opts) {
    css();
    opts = opts || {};
    if (!cs || cs.mode !== 'creator') return '';
    var sc = (cs.script && cs.script.scenes) || [], flags = cs.flags || [], pend = cs.pending;
    var by = {}; flags.forEach(function (f) { (by[f.scene] = by[f.scene] || []).push(f); });
    var canAct = !pend || pend.status === 'proposed';
    var head = '<div class="is-panel" id="cs-review"><div class="is-head"><div><h3 style="margin:0">Your script <span class="cs-lock">🔒 your words are locked</span></h3>' +
      '<p class="is-muted" style="margin:2px 0">' + sc.length + ' scenes · version ' + esc(String(cs.current_hash || '').slice(0, 8)) +
      (cs.checked ? ' · fact-checked: ' + esc(cs.items) + ' sentence' + (cs.items === 1 ? '' : 's') : ' · fact-check pending') +
      ' · ' + (cs.high ? '<b>' + cs.high + ' high-risk</b>' : '0 high-risk') + ', ' + (cs.low_open ? '<b>' + cs.low_open + ' to decide</b>' : '0 to decide') + '</p></div></div>' +
      (opts.pipeline || '') + arcBar(sc) +
      '<div class="' + (cs.ok ? 'is-okbox' : 'is-warnbox') + '" role="status">' + esc(cs.why) + '</div>' +
      '<p class="is-muted">Research checks every sentence against the records. It never changes your words: a problem is flagged here with the records and a suggested replacement. ' +
      'Accept it, edit the scene, or keep your words when the risk is low. High-risk problems (wrong, unsupported, outdated or legally unsafe) must be changed before you approve.</p>';
    var pendBox = '';
    if (pend) {
      var st = REV_STATUS[pend.status] || [pend.status, 'wait'];
      pendBox = '<div class="is-panel" aria-label="Your waiting revision"><b>Your revised script</b> <span class="is-badge ' + st[1] + '">' + esc(st[0]) + '</span>' +
        (pend.note ? ' <span class="is-muted">' + esc(pend.note) + '</span>' : '') +
        '<div class="cs-row" style="margin-top:6px">' +
        (pend.status === 'proposed' ? '<button class="is-btn primary" data-act="cs-send">Send it with Fix</button>' +
          '<button class="is-btn warn" data-act="cs-withdraw" data-rev="' + esc(pend.id) + '">Withdraw</button>' : '') +
        '<button class="is-btn" data-act="cs-compare" aria-expanded="' + !!opts.comparing + '">' + (opts.comparing ? 'Hide comparison' : 'Compare with your locked script') + '</button></div>' +
        (pend.batch && pend.batch.next_step && pend.status !== 'proposed' ? '<p class="is-muted">' + esc(pend.batch.next_step) + '</p>' : '') +
        (opts.comparing ? compare(cs.script, pend.script) : '') + '</div>';
    }
    var timing = (cs.timing || []).length ? '<div class="is-warnbox"><b>Timing:</b><ul class="is-list">' + cs.timing.map(function (t) { return '<li>' + esc(t.detail) + '</li>'; }).join('') + '</ul></div>' : '';
    var edit = opts.editor ? '<div class="is-panel" aria-label="Edit your script"><h4 style="margin:0">Edit your script</h4>' +
      '<p class="is-muted">You are editing ' + (pend && pend.status === 'proposed' ? 'your waiting revision' : 'a new revision of your locked script') +
      '. Saving it does not change the locked script: send it with Fix, and research applies it word for word, fact-checks it again and makes a new version for you to approve.</p>' +
      opts.editor + '<label>What changed and why <span class="is-muted">(optional)</span><input class="is-in" type="text" style="width:100%" id="cs-rev-note" maxlength="1000"></label>' +
      '<div class="cs-row" style="margin-top:6px"><button class="is-btn primary" data-act="cs-save-rev">Save revision</button><button class="is-btn" data-act="cs-cancel-edit">Cancel</button></div></div>'
      : (canAct ? '<div class="cs-row"><button class="is-btn" data-act="cs-edit" data-scene="">Edit script</button></div>' : '');
    var cards = sc.map(function (s, i) {
      var fl = by[s.n] || [], open = fl.filter(function (f) { return f.decision !== 'keep' && !f.in_revision; });
      var ver = !cs.checked ? ['wait', 'Pending'] : open.some(function (f) { return f.risk === 'high'; }) ? ['bad', 'Needs change'] : open.length ? ['warn', 'Needs review'] : ['ok', 'Verified'];
      return '<div class="cs-scene" id="cs-scene-' + s.n + '"><div class="cs-row"><b>Scene ' + s.n + '</b>' +
        '<span class="is-thr ' + (STAGE_CLS[s.stage] || 'context') + '">' + esc(s.stage === 'custom' ? s.stage_label : C().STAGE_LABEL[s.stage]) + '</span>' +
        (s.seconds ? '<span class="is-muted">' + s.seconds + ' s asked · about ' + C().estimateSeconds(s.narration) + ' s narration</span>' : '<span class="is-muted">about ' + C().estimateSeconds(s.narration) + ' s</span>') +
        '<span style="flex:1"></span><span class="is-badge ' + ver[0] + '">' + esc(ver[1]) + '</span></div>' +
        (s.headline ? '<p style="margin:6px 0"><b>Headline:</b> <span class="cs-text">' + marked(s.headline, fl.filter(function (f) { return f.field === 'headline'; })) + '</span></p>' : '') +
        '<div class="cs-text">' + marked(s.narration, fl.filter(function (f) { return f.field !== 'headline'; })) + '</div>' +
        (s.visual ? '<p class="is-muted" style="margin:4px 0">Visual: ' + esc(s.visual) + '</p>' : '') +
        (s.audio ? '<p class="is-muted" style="margin:4px 0">Audio: ' + esc(s.audio) + '</p>' : '') +
        fl.map(function (f) { return flagBox(f, { canAct: canAct && opts.canDecide !== false }); }).join('') + '</div>';
    }).join('');
    var hist = (cs.revisions || []).length ? '<details class="is-sec"><summary><b>Script history</b> <span class="is-muted">(' + cs.revisions.length + ' version' + (cs.revisions.length === 1 ? '' : 's') + ')</span></summary><table class="is-tab">' +
      cs.revisions.map(function (r) {
        var st = REV_STATUS[r.status] || [r.status, ''];
        return '<tr><td>' + esc(r.kind === 'original' ? 'Original' : 'Revision ' + r.id) + '</td><td><span class="is-badge ' + st[1] + '">' + esc(st[0]) + '</span></td>' +
          '<td>' + esc({ topic: 'from your topic', edit: 'your edit', accept_suggestion: 'accepted suggestion' }[r.source] || '') + '</td>' +
          '<td>' + esc(String(r.script_hash || '').slice(0, 8)) + '</td><td>' + esc(r.note || '') + '</td><td class="is-muted">' + esc(String(r.at || '').slice(0, 16).replace('T', ' ')) + '</td></tr>';
      }).join('') + '</table></details>' : '';
    return head + pendBox + timing + edit + cards + hist + '</div>';
  }

  /* Where a topic or story stands in the creator pipeline, from what the page already holds. */
  function topicStage(c) {
    var r = c.research || {}, v = c.video || {};
    if (r.status === 'failed' && !c.story_id) return ['researching', 'Failed'];
    if (c.evidence_status === 'insufficient' && !c.story_id) return ['researching', 'Blocked'];
    if (!c.story_id) return [r.status === 'queued' || r.status === 'working' || c.status === 'researching' ? 'researching' : 'draft', null];
    var rj = v.render || {};
    if (rj.current && rj.status === 'complete') return ['ready', null];
    if (rj.current && (rj.status === 'queued' || rj.status === 'running')) return ['rendering', null];
    if (rj.current && rj.status === 'failed') return ['rendering', 'Failed'];
    if (v.narrative === 'approved') return ['approved', null];
    return ['review', v.narrative === 'blocked' ? 'Blocked' : null];
  }
  function storyStage(st, media, vis) {
    var j = st.job || {}, running = j.status === 'queued' || j.status === 'running';
    var narr = ((st.artifacts || {}).narrative || {}).state;
    if (running && j.kind === 'render') return ['rendering', null];
    if (j.status === 'failed' && j.kind === 'render') return ['rendering', 'Failed'];
    if (media && media.current) return ['ready', null];
    if (narr === 'approved') return ['approved', null];
    if (j.status === 'failed') return ['review', 'Failed'];
    return ['review', narr === 'blocked' ? 'Blocked' : null];
  }

  HS.acqImpactCreator = { editor: editor, newEditor: newEditor, onInput: onInput, onAction: onAction, finished: finished,
    review: review, compare: compare, pipeline: pipeline, arcBar: arcBar, topicStage: topicStage, storyStage: storyStage, css: css, _wordDiff: wordDiff };
})();
