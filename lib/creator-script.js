/* Creator-directed Impact Stories (founder brief 2026-11-06): the founder's scene-by-scene script, "creator-script/1".
 *
 * Pure helpers, no DOM and no network, shared by Tab 17's Suggest form and the story's "Your script" panel:
 *   parse(text)      a pasted storyboard -> {script, notes, recognized}. Nothing pasted is discarded: the whole paste is
 *                    kept as script.raw, and every line the parser could not place is listed in notes for the founder to
 *                    place by hand before saving.
 *   problems(script) the contract's refusals in plain words (the same rules as the database's _hs_is_creator_problems and
 *                    homesignal-ingest impact/creator.py problems()).
 *   clean, estimateSeconds, arcSummary, emptyScene, normalize.
 * The words the founder types are stored exactly (outer spaces and CR removed, nothing else). Research fact-checks them
 * and flags problems; it never changes them. */
(function (root) {
  'use strict';
  var FORMAT = 'creator-script/1';
  var STAGES = ['fear', 'anger', 'motivation', 'custom'];
  var STAGE_LABEL = { fear: 'Fear', anger: 'Anger / accountability', motivation: 'Motivation / agency', custom: 'Custom' };
  var LIMITS = { scenes: 60, narration: 5000, total: 60000, headline: 300, direction: 2000, raw: 200000, sources: 10 };
  var WPM = 150;
  var LINK = /^https?:\/\/[^\s\/?#]+\.[^\s\/?#]+(\/\S*)?$/i;

  function clean(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/^[ \t\n\v\f]+|[ \t\n\v\f]+$/g, ''); }
  function words(s) { var m = clean(s).match(/\S+/g); return m ? m.length : 0; }
  function estimateSeconds(s) { return Math.round(words(s) * 60 / WPM); }
  function emptyScene(n, stage) {
    return { n: n, stage: stage || 'fear', stage_label: '', seconds: null, headline: '', narration: '', visual: '', audio: '', sources: [] };
  }

  // A stage word as people write it -> the stage. Anything else becomes a custom stage with that name.
  function stageOf(word) {
    var w = clean(word).toLowerCase().replace(/[^a-z /&-]/g, '').trim();
    if (!w) return null;
    if (/^(fear|concern|worry|threat)\b/.test(w)) return { stage: 'fear', label: '' };
    if (/^(anger|accountability|scrutiny|outrage)\b/.test(w)) return { stage: 'anger', label: '' };
    if (/^(motivation|agency|action|hope|empowerment|call to action)\b/.test(w)) return { stage: 'motivation', label: '' };
    return { stage: 'custom', label: clean(word).slice(0, 60) };
  }
  function secondsOf(s) {
    var m = /(\d+):([0-5]\d)/.exec(s);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    m = /(\d+)\s*(?:s|sec|secs|seconds?)\b/i.exec(s);
    return m ? parseInt(m[1], 10) : null;
  }

  var HEADER = /^\s*(?:#+\s*)?(?:\*\*)?\s*(?:scene|slide)\s*#?\s*(\d+)\b\s*(?:\*\*)?\s*[:.\-–—]?\s*(.*)$/i;
  var FIELD = /^\s*(?:[-*•]\s*)?(?:\*\*)?(slide headline|headline|on[- ]screen(?: text)?|text on screen|title card|title|narration|voice[- ]?over|vo|script|spoken|visuals?|b-roll|footage|imagery|audio|music|sound(?:s)?|sources?|links?|duration|length|stage|emotion|emotional stage)(?:\*\*)?\s*(?:\([^)]*\))?\s*[:\-–—]\s*(?:\*\*)?\s*(.*)$/i;
  var KEY = { 'slide headline': 'headline', headline: 'headline', 'on-screen': 'headline', 'on screen': 'headline',
              'on-screen text': 'headline', 'on screen text': 'headline', 'text on screen': 'headline', 'title card': 'headline',
              title: 'headline', narration: 'narration', 'voice-over': 'narration', 'voiceover': 'narration', 'voice over': 'narration',
              vo: 'narration', script: 'narration', spoken: 'narration', visual: 'visual', visuals: 'visual', 'b-roll': 'visual',
              footage: 'visual', imagery: 'visual', audio: 'audio', music: 'audio', sound: 'audio', sounds: 'audio',
              source: 'sources', sources: 'sources', link: 'sources', links: 'sources', duration: 'seconds', length: 'seconds',
              stage: 'stage', emotion: 'stage', 'emotional stage': 'stage' };

  /* Parse a pasted storyboard. Recognized: "SCENE 3 — ANGER (11s)" or "Slide 3: Fear" headers (markdown #, bold and a
   * leading bullet are fine), then labelled lines (Headline/On-screen, Narration/VO, Visual, Audio/Music, Sources,
   * Duration, Stage); an unlabelled line continues the field above it. Before the first scene, "Target length: 4:30"
   * sets the target duration. */
  function parse(text) {
    var raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var lines = raw.split('\n'), scenes = [], notes = [], cur = null, field = null, target = null, recognized = 0;
    function put(sc, f, v) {
      if (f === 'sources') {
        (v.match(/https?:\/\/\S+/gi) || []).forEach(function (u) { sc.sources.push(u.replace(/[),.;]+$/, '')); });
        var rest = v.replace(/https?:\/\/\S+/gi, '').replace(/[,;\s]+/g, ' ').trim();
        if (rest) notes.push({ scene: sc.n, line: v, why: 'not a web link (kept here; add it as a link if it is one)' });
        return;
      }
      if (f === 'seconds') { var x = secondsOf(v); if (x != null) sc.seconds = x; else notes.push({ scene: sc.n, line: v, why: 'duration not understood' }); return; }
      if (f === 'stage') { var st = stageOf(v); if (st) { sc.stage = st.stage; sc.stage_label = st.label; } return; }
      sc[f] = sc[f] ? sc[f] + '\n' + v : v;
    }
    lines.forEach(function (ln, i) {
      var h = HEADER.exec(ln), m;
      if (h) {
        recognized++;
        cur = emptyScene(scenes.length + 1, 'custom');
        cur._given = parseInt(h[1], 10);
        var rest = h[2].replace(/\*\*/g, '');
        var sec = /\(([^)]*)\)/.exec(rest);
        if (sec && secondsOf(sec[1]) != null) { cur.seconds = secondsOf(sec[1]); rest = rest.replace(sec[0], ''); }
        else if (secondsOf(rest) != null && /\d\s*(s|sec|seconds?)\b|\d:\d\d/i.test(rest)) { cur.seconds = secondsOf(rest); rest = rest.replace(/\(?\d+(:\d\d)?\s*(s|sec|secs|seconds?)?\)?/i, ''); }
        var st = stageOf(rest.replace(/^[\s:.\-–—|]+|[\s:.\-–—|]+$/g, ''));
        if (st) { cur.stage = st.stage; cur.stage_label = st.label; } else { cur.stage = scenes.length ? scenes[scenes.length - 1].stage : 'fear'; cur.stage_label = scenes.length ? scenes[scenes.length - 1].stage_label : ''; }
        scenes.push(cur); field = null; return;
      }
      if (!clean(ln)) { field = null; return; }
      if (!cur) {
        m = /^\s*(?:target(?: length| duration| runtime)?|length|runtime|duration)\s*[:\-–]\s*(.+)$/i.exec(ln);
        var mm = m && /(\d+)\s*m(?:in(?:utes?)?)?\b(?:\s*(\d+)\s*s)?/i.exec(m[1]);
        var t = m ? (mm ? parseInt(mm[1], 10) * 60 + (mm[2] ? parseInt(mm[2], 10) : 0) : secondsOf(m[1])) : null;
        if (t != null) { target = t; recognized++; } else notes.push({ scene: null, line: clean(ln), why: 'before the first scene' });
        return;
      }
      m = FIELD.exec(ln);
      if (m) {
        recognized++;
        field = KEY[m[1].toLowerCase()] || null;
        if (field) put(cur, field, clean(m[2].replace(/\*\*$/, '')));
        if (field === 'stage' || field === 'seconds' || field === 'sources') field = field === 'sources' ? 'sources' : null;
        return;
      }
      if (field) { put(cur, field, clean(ln)); return; }
      notes.push({ scene: cur.n, line: clean(ln), why: 'no label (Headline, Narration, Visual, Audio or Sources)' });
    });
    scenes.forEach(function (sc, i) {
      if (sc._given !== i + 1) notes.push({ scene: i + 1, line: 'Scene ' + sc._given, why: 'renumbered ' + (i + 1) + ' (scenes are numbered in the order pasted)' });
      delete sc._given;
      ['headline', 'narration', 'visual', 'audio'].forEach(function (k) { sc[k] = clean(sc[k]); });
      if (sc.stage === 'custom' && !sc.stage_label) sc.stage_label = 'Custom';
    });
    return { script: { format: FORMAT, target_seconds: target, raw: raw.slice(0, LIMITS.raw), scenes: scenes }, notes: notes,
             recognized: recognized, confident: scenes.length > 0 && scenes.every(function (s) { return s.narration; }) };
  }

  /* The script as it is saved: numbered in order, every text field in its clean form, empty directions as ''. */
  function normalize(script) {
    var sc = (script && script.scenes) || [];
    return {
      format: FORMAT,
      target_seconds: script && script.target_seconds ? parseInt(script.target_seconds, 10) : null,
      raw: clean(script && script.raw).slice(0, LIMITS.raw),
      scenes: sc.map(function (s, i) {
        var stage = STAGES.indexOf(s.stage) >= 0 ? s.stage : 'custom';
        return { n: i + 1, stage: stage, stage_label: stage === 'custom' ? clean(s.stage_label) : '',
                 seconds: s.seconds === '' || s.seconds == null ? null : parseInt(s.seconds, 10),
                 headline: clean(s.headline), narration: clean(s.narration), visual: clean(s.visual), audio: clean(s.audio),
                 sources: (s.sources || []).map(clean).filter(Boolean) };
      })
    };
  }

  function problems(script) {
    var p = [];
    if (!script || typeof script !== 'object') return ['the creator script is not an object'];
    if (script.format !== FORMAT) p.push('the creator script\'s format must be ' + FORMAT);
    var ts = script.target_seconds;
    if (ts != null && (!(ts === parseInt(ts, 10)) || ts < 10 || ts > 3600)) p.push('the target duration must be 10 to 3600 seconds');
    var sc = script.scenes;
    if (!Array.isArray(sc) || !sc.length) return p.concat(['the creator script has no scenes']);
    if (sc.length > LIMITS.scenes) p.push('at most ' + LIMITS.scenes + ' scenes (has ' + sc.length + ')');
    var total = 0;
    sc.forEach(function (s, i) {
      var lab = 'Scene ' + (i + 1);
      if (s.n !== i + 1) p.push(lab + ' is numbered ' + s.n + '; scenes are numbered 1, 2, 3 ... in order');
      if (STAGES.indexOf(s.stage) < 0) p.push(lab + ': the emotional stage must be fear, anger, motivation or custom');
      if (s.stage === 'custom' && !(clean(s.stage_label).length >= 1 && clean(s.stage_label).length <= 60)) p.push(lab + ': name the custom stage (1 to 60 characters)');
      if (s.seconds != null && (!(s.seconds === parseInt(s.seconds, 10)) || s.seconds < 1 || s.seconds > 600)) p.push(lab + ': the duration must be 1 to 600 seconds');
      if (!clean(s.narration)) p.push(lab + ' has no narration');
      if (clean(s.narration).length > LIMITS.narration) p.push(lab + ': the narration is longer than ' + LIMITS.narration + ' characters');
      if (clean(s.headline).length > LIMITS.headline) p.push(lab + ': the headline is longer than ' + LIMITS.headline + ' characters');
      ['visual', 'audio'].forEach(function (k) { if (clean(s[k]).length > LIMITS.direction) p.push(lab + ': the ' + k + ' direction is longer than ' + LIMITS.direction + ' characters'); });
      var src = s.sources || [];
      if (src.length > LIMITS.sources) p.push(lab + ': at most ' + LIMITS.sources + ' source links');
      src.forEach(function (u) { if (!LINK.test(u) || u.length > 1000) p.push(lab + ': ' + String(u).slice(0, 80) + ' is not a web link'); });
      total += clean(s.narration).length;
    });
    if (total > LIMITS.total) p.push('the narration totals ' + total + ' characters (at most ' + LIMITS.total + ')');
    return p;
  }

  function arcSummary(scenes) {
    var out = [];
    (scenes || []).forEach(function (s, i) {
      var lab = s.stage === 'custom' ? (clean(s.stage_label) || 'Custom') : STAGE_LABEL[s.stage] || s.stage;
      var last = out[out.length - 1];
      if (last && last.stage === s.stage && last.label === lab) last.to = i + 1;
      else out.push({ stage: s.stage, label: lab, from: i + 1, to: i + 1 });
    });
    return out;
  }

  /* Where narration cannot fit the asked duration (the video keeps every word and runs longer). */
  function timing(script) {
    return ((script && script.scenes) || []).map(function (s, i) {
      var est = estimateSeconds(s.narration);
      return { n: i + 1, estimated: est, asked: s.seconds || null, over: !!(s.seconds && est > s.seconds) };
    });
  }

  var api = { FORMAT: FORMAT, STAGES: STAGES, STAGE_LABEL: STAGE_LABEL, LIMITS: LIMITS, WPM: WPM, clean: clean, words: words,
              estimateSeconds: estimateSeconds, emptyScene: emptyScene, parse: parse, normalize: normalize, problems: problems,
              arcSummary: arcSummary, timing: timing, stageOf: stageOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HS = root.HS || {};
  root.HS.creatorScript = api;
})(typeof window !== 'undefined' ? window : globalThis);
