/* HomeSignal Video Producer — Acquisition Dashboard tab (client-only).
   Operator-authored commentary; no automatic truth/misinformation labels. */
(function () {
  "use strict";

  var STORAGE_KEY = "hs_video_projects_v1";
  var WPM = 150;
  var vpContainer = null;
  var vpRoot = null;

  function $(id) {
    if (vpRoot) {
      var scoped = vpRoot.querySelector("#" + id);
      if (scoped) return scoped;
    }
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function uid() { return "vp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function normalizeText(s) {
    return String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Locate `needle` inside the RAW transcript and return its real character
  // span, so callers never have to map a normalized-text index back onto raw
  // text (which silently shifts by however much punctuation was collapsed).
  // Falls back to a punctuation-tolerant token match. Tokens come from
  // normalizeText, so they are word characters only — safe to put in a regex.
  function findRawSpan(text, needle) {
    var raw = String(needle || "").trim();
    if (!raw) return null;

    var idx = String(text).toLowerCase().indexOf(raw.toLowerCase());
    if (idx >= 0) return { start: idx, end: idx + raw.length };

    var words = normalizeText(raw).split(" ").filter(Boolean);
    if (!words.length) return null;
    var m = new RegExp(words.map(escapeRegExp).join("[\\W_]+"), "i").exec(text);
    if (!m) return null;
    return { start: m.index, end: m.index + m[0].length };
  }

  function parseTimecode(tc) {
    var p = tc.trim().replace(",", ".").split(":");
    if (p.length === 3) return parseFloat(p[0]) * 3600 + parseFloat(p[1]) * 60 + parseFloat(p[2]);
    if (p.length === 2) return parseFloat(p[0]) * 60 + parseFloat(p[1]);
    return parseFloat(p[0]) || 0;
  }

  function formatTime(sec) {
    sec = Math.max(0, sec || 0);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60);
    if (h) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }

  function parseTranscript(raw) {
    raw = String(raw || "").trim();
    if (!raw) return { plain: "", cues: [] };

    var cues = [];
    // WebVTT / SRT
    var blocks = raw.split(/\n\s*\n/);
    blocks.forEach(function (block) {
      var lines = block.trim().split("\n");
      if (lines.length < 2) return;
      var timeLine = lines.find(function (l) { return /-->|-->/.test(l); });
      if (!timeLine) return;
      var parts = timeLine.split(/-->|-->/);
      var start = parseTimecode(parts[0]);
      var end = parseTimecode(parts[1] || parts[0]);
      var textStart = lines.indexOf(timeLine) + 1;
      var text = lines.slice(textStart).join(" ").trim();
      if (text) cues.push({ start: start, end: end, text: text });
    });

    if (cues.length) {
      return { plain: cues.map(function (c) { return c.text; }).join("\n"), cues: cues };
    }
    return { plain: raw, cues: [] };
  }

  function estimateTimeFromOffset(offset, totalChars) {
    var words = offset / 5;
    return (words / WPM) * 60;
  }

  function findMatches(statement, parsed) {
    var normStmt = normalizeText(statement);
    if (!normStmt) return [];
    var plain = parsed.plain;
    var normPlain = normalizeText(plain);
    var matches = [];

    function addMatch(idx, len, conf, startSec, endSec) {
      matches.push({
        index: idx,
        text: plain.slice(idx, idx + len),
        confidence: conf,
        start: startSec,
        end: endSec,
      });
    }

    if (parsed.cues.length) {
      parsed.cues.forEach(function (cue) {
        var nc = normalizeText(cue.text);
        var pos = nc.indexOf(normStmt);
        if (pos >= 0) {
          addMatch(0, cue.text.length, pos === 0 ? 0.95 : 0.82, cue.start, cue.end);
          return;
        }
        var words = normStmt.split(" ");
        var hits = words.filter(function (w) { return w.length > 2 && nc.indexOf(w) >= 0; }).length;
        if (hits >= Math.ceil(words.length * 0.6)) {
          addMatch(0, cue.text.length, 0.55 + 0.3 * (hits / words.length), cue.start, cue.end);
        }
      });
      return matches;
    }

    var searchFrom = 0;
    while (searchFrom < normPlain.length) {
      var idx = normPlain.indexOf(normStmt, searchFrom);
      if (idx < 0) break;
      var startSec = estimateTimeFromOffset(idx, normPlain.length);
      var endSec = estimateTimeFromOffset(idx + normStmt.length, normPlain.length);
      addMatch(idx, normStmt.length, 0.92, startSec, endSec);
      searchFrom = idx + normStmt.length;
    }

    if (!matches.length) {
      var fuzzy = fuzzyFind(normStmt, normPlain);
      if (fuzzy) {
        var ratio = fuzzy.score;
        addMatch(fuzzy.index, fuzzy.len, ratio, estimateTimeFromOffset(fuzzy.index, normPlain.length),
          estimateTimeFromOffset(fuzzy.index + fuzzy.len, normPlain.length));
      }
    }
    return matches;
  }

  function fuzzyFind(needle, hay) {
    var words = needle.split(" ").filter(Boolean);
    if (!words.length) return null;
    var best = null;
    var win = needle.length + 40;
    for (var i = 0; i < hay.length; i++) {
      var slice = hay.slice(i, i + win);
      var hit = 0;
      words.forEach(function (w) { if (slice.indexOf(w) >= 0) hit++; });
      var score = hit / words.length;
      if (score >= 0.55 && (!best || score > best.score)) {
        best = { index: i, len: Math.min(win, hay.length - i), score: 0.45 + score * 0.45 };
      }
    }
    return best;
  }

  function confClass(c) {
    if (c >= 0.85) return "high";
    if (c >= 0.65) return "med";
    return "low";
  }

  /* ----------------------------------------------------------------------
     SOURCE MEDIA — three roles, kept strictly separate:

       1. YOUTUBE REFERENCE  (state.youtube)     — viewable, NEVER renderable.
          A YouTube URL cannot become export footage without downloading
          protected media, which we do not do. It is a reference and a
          transcript source only, and the UI says so.
       2. TRANSCRIPT SOURCE  (fetch-youtube-transcript edge function).
       3. LOCAL RENDERABLE MEDIA (state.videoObjectUrl + state.sourceMeta) —
          an operator-supplied MP4/WebM. This is the ONLY thing clips can be
          cut from and the ONLY thing the renderer can draw.

     The bytes are never persisted. sourceMeta is a small identity record, so
     a reopened project knows WHICH file it needs and can relink clips when
     the operator reselects that same file.
     ---------------------------------------------------------------------- */

  var YT_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/;

  function youtubeVideoId(url) {
    var m = YT_ID_RE.exec(String(url || ""));
    return m ? m[1] : null;
  }

  // Identity of a local file: stable across reselecting the SAME file, and
  // different for a different file — that is what stops one project silently
  // adopting another project's footage.
  function sourceIdFor(file) {
    if (!file) return null;
    return "vps_" + String(file.name).replace(/[^\w.-]+/g, "_") +
      "_" + (file.size || 0) + "_" + (file.lastModified || 0);
  }

  function sanitizeSourceMeta(meta) {
    if (!meta || typeof meta !== "object" || !meta.id) return null;
    var d = Number(meta.duration);
    return {
      id: String(meta.id),
      name: String(meta.name || ""),
      size: Number(meta.size) || 0,
      type: String(meta.type || ""),
      lastModified: Number(meta.lastModified) || 0,
      // Non-finite is legitimate: MediaRecorder-produced WebM files report
      // Infinity until fully buffered. Store null rather than a fake number.
      duration: isFinite(d) && d > 0 ? d : null,
    };
  }

  // Is renderable footage actually loaded in THIS session?
  function sourceReady() {
    return !!(state.videoObjectUrl && state.sourceMeta && state.sourceMeta.id);
  }

  // A project that has clips or a remembered file, but no loaded media now.
  function sourceNeedsReselect() {
    return !!(state.sourceMeta && state.sourceMeta.id) && !state.videoObjectUrl;
  }

  function clipsInStoryboard() {
    return (state.storyboard || []).filter(function (i) { return i && i.type === "clip"; });
  }

  function sanitizeClip(item) {
    var start = Number(item.start);
    var end = Number(item.end);
    if (!isFinite(start) || start < 0) start = 0;
    if (!isFinite(end) || end <= start) end = start + 1;
    return {
      id: item.id || ("vpc_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      type: "clip",
      sourceId: item.sourceId || null,
      start: start,
      end: end,
      duration: end - start,
      label: item.label || "Source clip",
    };
  }

  // Legacy projects carry auto-generated {type:'source_clip'|'resume', start,
  // duration} placeholders that referenced no real media and could not be
  // trimmed. Migrate them to real clip items so sequence position and the one
  // timestamp they had survive, with sourceId null = "not linked to a file".
  function migrateLegacySourceItems(board) {
    if (!Array.isArray(board)) return [];
    return board.map(function (item) {
      if (!item || (item.type !== "source_clip" && item.type !== "resume")) return item;
      var start = Number(item.start) || 0;
      var dur = Number(item.duration) || 3;
      return sanitizeClip({
        sourceId: null,
        start: start,
        end: start + dur,
        label: item.label || "Source clip (imported)",
      });
    });
  }

  function loadProjects() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY) || "[]";
      var list = JSON.parse(raw);
      return sanitizeProjectList(list);
    }
    catch (e) { return []; }
  }

  // Evidence blobs (base64 dataUrl) are SESSION-ONLY, exactly like the source
  // video: keeping them would blow the localStorage quota. Only the file
  // identity (name/type) is persisted, so a reopened project still lists what
  // was attached. Stripping happens on the WRITE path too — otherwise a build
  // of the storyboard smuggles the same blobs back into storage inside
  // storyboard[].files, and saving one project rewrites (and damages) every
  // other project's evidence on the way through loadProjects().
  function sanitizeEvidenceList(items) {
    if (!Array.isArray(items)) return [];
    return items.map(function (ev) {
      return { name: (ev && ev.name) || "", type: (ev && ev.type) || "" };
    });
  }

  function sanitizeStatements(stmts) {
    if (!Array.isArray(stmts)) return [];
    return stmts.map(function (st) {
      st = st || {};
      return {
        id: st.id,
        text: st.text || "",
        matches: Array.isArray(st.matches) ? st.matches : [],
        commentary: st.commentary || {},
        evidence: sanitizeEvidenceList(st.evidence),
      };
    });
  }

  // Storyboard items are operator-shaped data; keep every field EXCEPT the
  // evidence blobs carried on `files` (see sanitizeEvidenceList).
  function sanitizeStoryboard(board) {
    if (!Array.isArray(board)) return [];
    return migrateLegacySourceItems(board).map(function (item) {
      if (!item || typeof item !== "object") return { type: "unknown", label: "Unknown item" };
      // Clips carry timing that must round-trip exactly; normalize them so a
      // hand-edited or truncated record can never yield end <= start.
      if (item.type === "clip") return sanitizeClip(item);
      var out = {};
      Object.keys(item).forEach(function (k) { if (k !== "files") out[k] = item[k]; });
      if (Array.isArray(item.files)) out.files = sanitizeEvidenceList(item.files);
      return out;
    });
  }

  function sanitizeProjectRecord(rec) {
    if (!rec || typeof rec !== "object") return null;
    var clean = {
      id: rec.id || uid(),
      name: rec.name || "",
      youtube: rec.youtube || "",
      speaker: rec.speaker || "",
      transcriptRaw: rec.transcriptRaw || "",
      parsed: rec.parsed || parseTranscript(rec.transcriptRaw || ""),
      hasSourceVideo: !!(rec.hasSourceVideo || rec.videoDataUrl || rec.sourceMeta),
      // Identity of the local file this project's clips were cut from — never
      // the bytes. Lets a reopened project ask for the RIGHT file back.
      sourceMeta: sanitizeSourceMeta(rec.sourceMeta),
      statements: sanitizeStatements(rec.statements),
      storyboard: sanitizeStoryboard(rec.storyboard),
      updatedAt: rec.updatedAt || new Date().toISOString(),
    };
    return clean;
  }

  function sanitizeProjectList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(sanitizeProjectRecord).filter(Boolean);
  }

  // Result of the last compaction, surfaced to the operator by bootVideoProducer.
  // Never swallowed: unreadable or unwritable storage has to be visible.
  var lastStorageProblem = null;

  function readStoredProjectsRaw() {
    // Returns {list} on success or {parseError} — the caller must NOT retry the
    // identical parse, which is what made malformed JSON unrepairable before.
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === "") return { list: [] };
    try {
      return { list: sanitizeProjectList(JSON.parse(raw)) };
    } catch (e) {
      return { parseError: e, raw: raw };
    }
  }

  function compactStoredProjects() {
    // One-shot latch, deliberately NOT cleared here: init() compacts and then
    // bootVideoProducer() compacts again, and by the second pass the damage has
    // already been repaired — clearing here would erase the message before the
    // operator ever sees it. bootVideoProducer consumes and clears it.
    var read = readStoredProjectsRaw();

    if (read.parseError) {
      // Unparseable JSON can never be repaired by parsing it again. Move the
      // damaged blob aside (so nothing is destroyed without a copy) and start
      // from a clean list, then tell the operator.
      console.error("Video Producer: stored projects are not valid JSON", read.parseError);
      try {
        localStorage.setItem(STORAGE_KEY + "_corrupt_backup", read.raw);
      } catch (backupErr) {
        console.error("Video Producer: could not back up corrupt storage", backupErr);
      }
      try {
        localStorage.removeItem(STORAGE_KEY);
        saveProjects([]);
        lastStorageProblem = "Saved projects were unreadable and could not be recovered. " +
          "Storage has been reset; the damaged copy is kept under " +
          STORAGE_KEY + "_corrupt_backup.";
      } catch (resetErr) {
        console.error("Video Producer: storage reset failed", resetErr);
        lastStorageProblem = "Saved projects are unreadable and browser storage cannot be written. " +
          "Projects will not save in this browser.";
      }
      return false;
    }

    try {
      saveProjects(read.list);
      return true;
    } catch (e) {
      // Parsed fine but will not write — quota. Retry with transcripts trimmed.
      console.error("Video Producer: could not compact stored projects", e);
      try {
        var minimal = read.list.map(function (p) {
          return {
            id: p.id,
            name: p.name,
            youtube: p.youtube,
            speaker: p.speaker,
            transcriptRaw: (p.transcriptRaw || "").slice(0, 50000),
            parsed: p.parsed,
            hasSourceVideo: !!p.hasSourceVideo,
            statements: sanitizeStatements(p.statements),
            storyboard: sanitizeStoryboard(p.storyboard),
            updatedAt: p.updatedAt || new Date().toISOString(),
          };
        });
        localStorage.removeItem(STORAGE_KEY);
        saveProjects(minimal);
        lastStorageProblem = "Browser storage was full — long transcripts were trimmed to free space.";
        return true;
      } catch (e2) {
        console.error("Video Producer: storage repair failed", e2);
        lastStorageProblem = "Browser storage is full and could not be repaired. " +
          "Export projects to JSON, then clear old ones.";
        return false;
      }
    }
  }

  function saveProjects(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error("Video Producer: could not save projects to localStorage", e);
      throw e;
    }
  }

  function resetFileInputs() {
    ["vp-transcript-file", "vp-source-video"].forEach(function (id) {
      var el = $(id);
      if (el) el.value = "";
    });
  }

  function projectRecordFromState() {
    return {
      id: state.id,
      name: state.name,
      youtube: state.youtube,
      speaker: state.speaker,
      transcriptRaw: state.transcriptRaw,
      parsed: state.parsed,
      // Source video bytes are session-only (object URL). Persisting base64
      // video blows the localStorage quota; only its identity is stored.
      hasSourceVideo: !!(state.videoObjectUrl || state.videoDataUrl || state.sourceMeta),
      sourceMeta: state.sourceMeta || null,
      statements: state.statements,
      storyboard: state.storyboard,
      updatedAt: new Date().toISOString(),
    };
  }

  function startNewDraft() {
    var list = loadProjects();
    var freshId = uid();
    while (list.some(function (p) { return p.id === freshId; })) freshId = uid();
    var fresh = blankProject();
    fresh.id = freshId;
    loadProject(fresh);
    resetFileInputs();
    setStep("source");
    renderProjectChips();
  }

  function startNewProject() {
    syncFromForm();
    var list = loadProjects();
    var hasContent = !!(state.name || state.transcriptRaw || state.statements.length ||
      state.storyboard.length || state.youtube || state.speaker || state.videoObjectUrl || state.videoDataUrl);
    var existsInList = !!(state.id && list.some(function (p) { return p.id === state.id; }));
    if (existsInList || (hasContent && state.id)) safePersist();
    startNewDraft();
  }

  var state = {
    id: null,
    name: "",
    youtube: "",
    speaker: "",
    transcriptRaw: "",
    parsed: { plain: "", cues: [] },
    videoObjectUrl: null,   // session-only blob URL for the loaded local file
    sourceMeta: null,       // persisted identity of that file
    statements: [],
    storyboard: [],
  };

  function blankProject() {
    return {
      id: uid(),
      name: "",
      youtube: "",
      speaker: "",
      transcriptRaw: "",
      parsed: { plain: "", cues: [] },
      videoDataUrl: null,
      sourceMeta: null,
      statements: [],
      storyboard: [],
      updatedAt: new Date().toISOString(),
    };
  }

  function syncFromForm() {
    state.name = ($("vp-project-name") && $("vp-project-name").value) || "";
    state.youtube = ($("vp-youtube") && $("vp-youtube").value) || "";
    state.speaker = ($("vp-speaker") && $("vp-speaker").value) || "";
    state.transcriptRaw = ($("vp-transcript-paste") && $("vp-transcript-paste").value) || "";
  }

  function ensureFetchTranscriptButton() {
    if ($("vp-fetch-transcript")) return $("vp-fetch-transcript");
    var analyze = $("vp-analyze-transcript");
    if (!analyze || !analyze.parentElement) return null;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vp-btn secondary";
    btn.id = "vp-fetch-transcript";
    btn.textContent = "Fetch transcript from YouTube";
    analyze.parentElement.insertBefore(btn, analyze);
    return btn;
  }

  function invokeErrorMessage(err) {
    if (!err) return Promise.resolve("fetch failed");
    if (err.context && typeof err.context.json === "function") {
      return err.context.json().then(function (body) {
        if (body && body.error) return body.error;
        return err.message || "fetch failed";
      }).catch(function () {
        return err.message || "fetch failed";
      });
    }
    return Promise.resolve(err.message || "fetch failed");
  }

  function fetchYoutubeTranscript() {
    syncFromForm();
    var url = state.youtube || "";
    if (!url.trim()) {
      alert("Enter a YouTube URL first.");
      return;
    }
    if (!window.hsClient || typeof window.hsClient.functions.invoke !== "function") {
      alert("Transcript fetch is unavailable on this page.");
      return;
    }
    var btn = $("vp-fetch-transcript");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Fetching…";
    }
    window.hsClient.functions.invoke("fetch-youtube-transcript", {
      body: { video_url: url.trim() }
    }).then(function (r) {
      return invokeErrorMessage(r.error).then(function (msg) {
        if (r.error) throw new Error(msg);
        return r;
      });
    }).then(function (r) {
      var data = r.data || {};
      if (data.error) throw new Error(data.error);
      state.youtube = url.trim();
      state.transcriptRaw = data.transcript_raw || "";
      state.parsed = parseTranscript(state.transcriptRaw);
      if ($("vp-youtube")) $("vp-youtube").value = state.youtube;
      if ($("vp-transcript-paste")) $("vp-transcript-paste").value = state.transcriptRaw;
      if (data.title && !state.name && $("vp-project-name")) {
        $("vp-project-name").value = data.title;
        state.name = data.title;
      }
      renderTranscript();
      renderSourceStudio();
      safePersist();
      setStep("statements");
      document.querySelectorAll(".vp-step").forEach(function (b) {
        if (b.dataset.vpStep === "source") b.classList.add("done");
      });
      alert("Transcript fetched from YouTube.");
    }).catch(function (e) {
      alert("Could not fetch transcript: " + (e && e.message ? e.message : e));
    }).finally(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Fetch transcript from YouTube";
      }
    });
  }

  function persist() {
    syncFromForm();
    if (!state.id) state.id = uid();
    var list = loadProjects();
    // Sanitize on the way OUT as well as the way in: state keeps evidence blobs
    // for this session, storage never receives them.
    var rec = sanitizeProjectRecord(projectRecordFromState());
    var ix = list.findIndex(function (p) { return p.id === rec.id; });
    if (ix >= 0) list[ix] = rec;
    else list.push(rec);
    saveProjects(list);
    renderProjectChips();
  }

  function syncStateToForm() {
    if ($("vp-project-name")) $("vp-project-name").value = state.name;
    if ($("vp-youtube")) $("vp-youtube").value = state.youtube;
    if ($("vp-speaker")) $("vp-speaker").value = state.speaker;
    if ($("vp-transcript-paste")) $("vp-transcript-paste").value = state.transcriptRaw;
    var vid = $("vp-video-preview");
    if (vid && (state.videoObjectUrl || state.videoDataUrl)) {
      vid.src = state.videoObjectUrl || state.videoDataUrl;
      vid.style.display = "block";
    } else if (vid) {
      vid.removeAttribute("src");
      vid.style.display = "none";
    }
    renderSourceStudio();
  }

  /* ----------------------------------------------------------------------
     SOURCE STUDIO UI.

     Everything here is created programmatically. The Video Producer's markup
     is served from the gated dashboard snapshot (acquisition.html does
     `el.innerHTML = tabs[id]`), NOT from this repo, so new controls cannot be
     added as HTML — they have to be built by this asset, the same way
     ensureFetchTranscriptButton already does.
     ---------------------------------------------------------------------- */

  var INPUT_STYLE = "background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:4px 6px;width:96px";

  function mk(tag, props, style) {
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) { el[k] = props[k]; });
    if (style) el.setAttribute("style", style);
    return el;
  }

  function panelEl(step) {
    return $("vp-panel-" + step);
  }

  // One honest status line per step, so the operator always knows what media
  // the project actually has — requirement: show source status in every step.
  function ensureSourceStatusStrips() {
    ["source", "statements", "commentary", "storyboard", "render"].forEach(function (step) {
      var panel = panelEl(step);
      if (!panel) return;
      if (panel.querySelector(".vp-source-status")) return;
      var strip = mk("p", { className: "vp-hint vp-source-status" },
        "margin:0 0 10px 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px");
      strip.setAttribute("role", "status");
      strip.setAttribute("aria-live", "polite");
      var card = panel.querySelector(".card") || panel;
      card.insertBefore(strip, card.firstChild);
    });
  }

  function sourceStatus() {
    var ytId = youtubeVideoId(state.youtube);
    if (sourceReady()) {
      var d = state.sourceMeta.duration;
      return {
        text: "Renderable source loaded: " + state.sourceMeta.name +
          (d ? " (" + formatTime(d) + ")" : "") + ". Clips can be created and exported.",
        level: "ok",
      };
    }
    if (sourceNeedsReselect()) {
      return {
        text: "Source file “" + state.sourceMeta.name + "” must be reselected — browsers cannot " +
          "restore a local file automatically. Clip timings and order are preserved; reselect the " +
          "same file in Step 1 to make them renderable again.",
        level: "warn",
      };
    }
    if (ytId) {
      return {
        text: "YouTube reference loaded. Upload an authorized MP4 or WebM copy to create renderable clips.",
        level: "warn",
      };
    }
    return { text: "No source video loaded. Upload an authorized MP4 or WebM in Step 1 to create clips.", level: "warn" };
  }

  // The YouTube reference player. Viewable when page policy permits; it is
  // NEVER a render source and the label says so unconditionally.
  function ensureYoutubeReference() {
    var panel = panelEl("source");
    if (!panel) return;
    var host = $("vp-yt-reference");
    if (!host) {
      var anchor = $("vp-video-preview");
      if (!anchor || !anchor.parentElement) return;
      host = mk("div", { id: "vp-yt-reference" }, "margin:10px 0");
      anchor.parentElement.insertBefore(host, anchor);
    }
    var id = youtubeVideoId(state.youtube);
    if (host.getAttribute("data-yt") === (id || "")) return;  // no needless reloads
    host.setAttribute("data-yt", id || "");
    host.textContent = "";
    if (!id) { host.style.display = "none"; return; }
    host.style.display = "block";

    var frame = mk("iframe", {
      id: "vp-yt-frame",
      src: "https://www.youtube-nocookie.com/embed/" + id,
      title: "YouTube reference video (not renderable)",
      allow: "encrypted-media; picture-in-picture",
    }, "width:100%;max-width:560px;aspect-ratio:16/9;border:1px solid var(--line);border-radius:8px");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.setAttribute("allowfullscreen", "");
    host.appendChild(frame);

    var note = mk("p", { className: "vp-hint", id: "vp-yt-note" }, "margin:6px 0 0 0");
    note.textContent = "Reference only — this YouTube video CANNOT be used in the final render. " +
      "It is here to watch and to pull the transcript from. To export footage, upload an " +
      "authorized MP4 or WebM copy below.";
    host.appendChild(note);

    var link = mk("a", { href: "https://www.youtube.com/watch?v=" + id, target: "_blank", rel: "noopener noreferrer" });
    link.className = "vp-hint";
    link.textContent = "Open on YouTube ↗";
    host.appendChild(link);
  }

  // Step 4 clip editor: player + in/out marking. Only usable with real media.
  function ensureClipEditor() {
    var panel = panelEl("storyboard");
    if (!panel) return;
    if ($("vp-clip-editor")) return;
    var list = $("vp-storyboard-list");
    if (!list || !list.parentElement) return;

    var box = mk("div", { id: "vp-clip-editor" },
      "margin:10px 0;padding:10px;border:1px solid var(--line);border-radius:8px");

    box.appendChild(mk("h4", { textContent: "Source clips" }, "margin:0 0 8px 0"));

    var player = mk("video", { id: "vp-clip-player", controls: true, preload: "metadata", muted: true },
      "width:100%;max-width:560px;display:none;border-radius:8px");
    player.setAttribute("playsinline", "");
    box.appendChild(player);

    var row = mk("div", { className: "vp-toolbar" }, "margin-top:8px;flex-wrap:wrap;gap:6px");

    var inLabel = mk("label", { htmlFor: "vp-clip-in", textContent: "In " }, "font-size:12px");
    var inInput = mk("input", { id: "vp-clip-in", type: "text", value: "0:00" }, INPUT_STYLE);
    inLabel.appendChild(inInput);

    var outLabel = mk("label", { htmlFor: "vp-clip-out", textContent: "Out " }, "font-size:12px");
    var outInput = mk("input", { id: "vp-clip-out", type: "text", value: "0:05" }, INPUT_STYLE);
    outLabel.appendChild(outInput);

    row.appendChild(inLabel);
    row.appendChild(outLabel);
    row.appendChild(mk("button", { id: "vp-clip-set-in", type: "button", className: "vp-btn secondary", textContent: "Set In from playhead" }));
    row.appendChild(mk("button", { id: "vp-clip-set-out", type: "button", className: "vp-btn secondary", textContent: "Set Out from playhead" }));
    row.appendChild(mk("button", { id: "vp-clip-add", type: "button", className: "vp-btn", textContent: "Add clip to sequence" }));
    box.appendChild(row);

    var msg = mk("p", { className: "vp-hint", id: "vp-clip-msg" }, "margin:6px 0 0 0");
    msg.setAttribute("role", "status");
    msg.setAttribute("aria-live", "polite");
    box.appendChild(msg);

    list.parentElement.insertBefore(box, list);
  }

  function ensureSourceStudio() {
    ensureSourceStatusStrips();
    ensureYoutubeReference();
    ensureClipEditor();
  }

  function setClipMessage(msg, isError) {
    var el = $("vp-clip-msg");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "var(--persist)" : "var(--muted)";
    if (el.getAttribute("aria-live") !== (isError ? "assertive" : "polite")) {
      el.setAttribute("aria-live", isError ? "assertive" : "polite");
    }
  }

  // Push current source state into every piece of UI that depends on it.
  function renderSourceStudio() {
    ensureSourceStudio();
    ensureYoutubeReference();

    var st = sourceStatus();
    var root = vpRoot || document;
    Array.prototype.forEach.call(root.querySelectorAll(".vp-source-status"), function (el) {
      el.textContent = st.text;
      el.style.color = st.level === "ok" ? "var(--muted)" : "var(--persist)";
    });

    var player = $("vp-clip-player");
    if (player) {
      if (state.videoObjectUrl) {
        if (player.getAttribute("src") !== state.videoObjectUrl) player.src = state.videoObjectUrl;
        player.style.display = "block";
      } else {
        player.removeAttribute("src");
        player.style.display = "none";
      }
    }

    // Clip creation is impossible without renderable media — disable rather
    // than let the operator mark in/out points against nothing.
    var ready = sourceReady();
    ["vp-clip-add", "vp-clip-set-in", "vp-clip-set-out"].forEach(function (id) {
      var b = $(id);
      if (!b) return;
      b.disabled = !ready;
      b.title = ready ? "" : "Upload an authorized MP4 or WebM source file first.";
    });
    ["vp-clip-in", "vp-clip-out"].forEach(function (id) {
      var i = $(id);
      if (i) i.disabled = !ready;
    });
    if (!ready) setClipMessage(st.text, st.level !== "ok");
    else if (!clipsInStoryboard().length) setClipMessage("Mark In and Out, then add the clip to the sequence.", false);

    updateRenderAvailability();
  }

  // The renderer can only draw clips whose media is loaded. If the sequence
  // needs footage it does not have, say so and block the export rather than
  // silently producing a video with placeholder cards where footage belongs.
  function unrenderableClips() {
    if (sourceReady()) {
      return clipsInStoryboard().filter(function (c) {
        return c.sourceId && state.sourceMeta && c.sourceId !== state.sourceMeta.id;
      });
    }
    return clipsInStoryboard();
  }

  function updateRenderAvailability() {
    var btn = $("vp-start-render");
    if (!btn) return;
    var blocked = unrenderableClips();
    var status = $("vp-render-status");
    if (blocked.length) {
      btn.disabled = true;
      btn.title = "Load the source file these clips were cut from.";
      if (status && !/Rendering|complete/i.test(status.textContent || "")) {
        status.textContent = blocked.length + " clip(s) in the sequence have no loaded source media. " +
          "Reselect the source file in Step 1 to enable export.";
        status.style.color = "var(--persist)";
      }
    } else {
      btn.disabled = false;
      btn.title = "";
      if (status && status.style.color === "var(--persist)") {
        status.textContent = "Ready.";
        status.style.color = "";
      }
    }
  }

  function loadProject(rec) {
    if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
    state.id = rec.id;
    state.name = rec.name || "";
    state.youtube = rec.youtube || "";
    state.speaker = rec.speaker || "";
    state.transcriptRaw = rec.transcriptRaw || "";
    state.parsed = rec.parsed || parseTranscript(state.transcriptRaw);
    state.statements = rec.statements || [];
    state.storyboard = rec.storyboard || [];
    state.videoDataUrl = rec.videoDataUrl || null;
    // A blob URL belongs to the file the operator picked in THIS session and
    // to one project only. Dropping it on every load is what guarantees
    // project B can never inherit project A's footage.
    state.videoObjectUrl = null;
    state.sourceMeta = sanitizeSourceMeta(rec.sourceMeta);

    clearRenderOutput();
    resetRenderPanel();
    resetFileInputs();

    // Each section renders independently: a failure in one must not abort the
    // rest, and must never take renderProjectChips() with it — the chips are
    // the only way to switch away from a project that will not render.
    [syncStateToForm, renderTranscript, renderStatements, renderCommentary,
      renderStoryboard, renderProjectChips].forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        console.error("Video Producer: " + fn.name + " failed while loading a project", e);
      }
    });
  }

  // The render output belongs to ONE project. Clear it on load so project A's
  // finished video is never shown under project B's name.
  function resetRenderPanel() {
    var out = $("vp-render-out");
    if (out) out.textContent = "";
    var status = $("vp-render-status");
    if (status) status.textContent = "Ready.";
    var bar = $("vp-render-bar");
    if (bar) bar.style.width = "0%";
  }

  function renderProjectChips() {
    var el = $("vp-projects");
    if (!el) return;
    var list = loadProjects().sort(function (a, b) { return (b.updatedAt || "").localeCompare(a.updatedAt || ""); });
    if (!list.length) { el.innerHTML = '<span class="muted">No saved projects yet.</span>'; return; }
    el.innerHTML = list.map(function (p) {
      var active = p.id === state.id ? " active" : "";
      return '<button type="button" class="vp-project-chip' + active + '" data-id="' + esc(p.id) + '">' + esc(p.name || "Untitled") + "</button>";
    }).join("");
  }

  function setStep(name) {
    document.querySelectorAll(".vp-step").forEach(function (b) {
      b.classList.toggle("active", b.dataset.vpStep === name);
    });
    document.querySelectorAll(".vp-panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "vp-panel-" + name);
    });
  }

  function renderTranscript(highlight) {
    var view = $("vp-transcript-view");
    if (!view) return;
    var text = state.parsed.plain || "No transcript yet.";
    if (highlight) {
      // Match against the RAW text. The old code took an index from the
      // NORMALIZED text (punctuation collapsed to spaces, whitespace squashed)
      // and sliced the raw text with it, so the <mark> landed off by however
      // many characters normalization had removed.
      var span = findRawSpan(text, highlight);
      if (span) {
        var pre = esc(text.slice(0, span.start));
        var mid = esc(text.slice(span.start, span.end));
        var post = esc(text.slice(span.end));
        view.innerHTML = pre + "<mark>" + mid + "</mark>" + post;
        return;
      }
    }
    view.textContent = text;
  }

  function renderStatements() {
    var list = $("vp-statements-list");
    if (!list) return;
    if (!state.statements.length) {
      list.innerHTML = '<p class="muted">Statements appear here after you locate them.</p>';
      return;
    }
    list.innerHTML = state.statements.map(function (st, si) {
      var matchesHtml = (st.matches || []).map(function (m, mi) {
        return '<div class="vp-match">' +
          '<input type="text" data-si="' + si + '" data-mi="' + mi + '" data-field="start" value="' + formatTime(m.start) + '" style="width:88px;background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:4px 6px">' +
          '<div>' + esc(m.text || st.text) + '</div>' +
          '<span class="vp-conf ' + confClass(m.confidence) + '">' + Math.round((m.confidence || 0) * 100) + '%</span></div>';
      }).join("");
      return '<div class="vp-stmt" data-si="' + si + '"><h4>' + esc(st.text) + '</h4>' + matchesHtml +
        '<div class="vp-toolbar" style="margin-top:8px"><button type="button" class="vp-btn secondary vp-remove-stmt" data-si="' + si + '">Remove</button></div></div>';
    }).join("");
  }

  function renderCommentary() {
    var list = $("vp-commentary-list");
    if (!list) return;
    if (!state.statements.length) {
      list.innerHTML = '<p class="muted">Add statements in Step 2 first.</p>';
      return;
    }
    list.innerHTML = state.statements.map(function (st, si) {
      var c = st.commentary || {};
      return '<div class="vp-stmt" data-si="' + si + '"><h4>' + esc(st.text) + '</h4>' +
        blockField(si, "said", "What was said", c.said || st.text) +
        blockField(si, "evidence", "What the evidence shows", c.evidence || "") +
        blockField(si, "community", "What this means for your community", c.community || "") +
        '<div class="vp-field"><label>Evidence files (PDF, image, map, chart, screenshot)</label>' +
        '<input type="file" multiple accept="image/*,.pdf" data-si="' + si + '" class="vp-evidence-upload">' +
        evidenceHtml(st.evidence || [], si) + "</div></div>";
    }).join("");
  }

  function blockField(si, field, label, val) {
    return '<div class="vp-comment-block"><h5>' + esc(label) + '</h5>' +
      '<textarea data-si="' + si + '" data-cfield="' + field + '" rows="3" style="width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px">' +
      esc(val) + "</textarea></div>";
  }

  function evidenceHtml(items, si) {
    if (!items.length) return '<div class="vp-evidence"></div>';
    return '<div class="vp-evidence">' + items.map(function (ev, ei) {
      // A thumbnail is only shown when the blob is still in memory this
      // session. Evidence blobs are never persisted (see sanitizeEvidenceList),
      // so a reopened project shows the file name plus an honest note instead
      // of a broken <img src="undefined">.
      var hasBlob = typeof ev.dataUrl === "string" && ev.dataUrl.indexOf("data:") === 0;
      var isImage = ev.type && ev.type.indexOf("image") === 0;
      var thumb;
      if (hasBlob && isImage) {
        thumb = '<img src="' + esc(ev.dataUrl) + '" alt="' + esc(ev.name) + '">';
      } else if (hasBlob) {
        thumb = "📄 " + esc(ev.name);
      } else {
        thumb = '<span class="vp-evidence-meta" title="Preview is not stored between sessions">'
          + (isImage ? "🖼️ " : "📄 ") + esc(ev.name)
          + ' <em>(preview not stored — re-attach to see it)</em></span>';
      }
      return '<div class="vp-evidence-item">' + thumb +
        '<button type="button" class="vp-btn secondary vp-ev-remove" data-si="' + si + '" data-ei="' + ei + '" style="padding:2px 6px;font-size:10px">Remove</button></div>';
    }).join("") + "</div>";
  }

  // Files produced by MediaRecorder (and some streamed MP4s) report
  // duration === Infinity until the browser has scanned to the end. Seeking
  // far past the end forces that scan; without this the "clip cannot exceed
  // the media duration" rule silently never fires.
  function probeMediaDuration(el, cb) {
    if (!el) { cb(null); return; }
    function settle() {
      var d = el.duration;
      cb(isFinite(d) && d > 0 ? d : null);
    }
    function afterMeta() {
      if (isFinite(el.duration) && el.duration > 0) { settle(); return; }
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        el.removeEventListener("durationchange", finish);
        try { el.currentTime = 0; } catch (e) { /* best effort */ }
        settle();
      };
      el.addEventListener("durationchange", finish);
      try { el.currentTime = 1e101; } catch (e) { finish(); return; }
      setTimeout(finish, 3000);   // never hang the UI on a stubborn file
    }
    if (el.readyState >= 1) afterMeta();
    else el.addEventListener("loadedmetadata", function onMeta() {
      el.removeEventListener("loadedmetadata", onMeta);
      afterMeta();
    });
  }

  // Longest trustworthy media duration we know: the live element wins, then
  // the stored metadata. Non-finite (MediaRecorder WebM) means "unknown".
  function sourceDuration() {
    var player = $("vp-clip-player");
    if (player && isFinite(player.duration) && player.duration > 0) return player.duration;
    var prev = $("vp-video-preview");
    if (prev && isFinite(prev.duration) && prev.duration > 0) return prev.duration;
    if (state.sourceMeta && state.sourceMeta.duration) return state.sourceMeta.duration;
    return null;
  }

  // Returns {ok:true, clip} or {ok:false, error} — validation is visible,
  // never a silent clamp.
  function validateClipRange(startRaw, endRaw) {
    var start = parseTimecode(String(startRaw || ""));
    var end = parseTimecode(String(endRaw || ""));
    if (!isFinite(start) || start < 0) return { ok: false, error: "In point is not a valid time." };
    if (!isFinite(end)) return { ok: false, error: "Out point is not a valid time." };
    if (end <= start) {
      return { ok: false, error: "Out point (" + formatTime(end) + ") must be later than In point (" + formatTime(start) + ")." };
    }
    var dur = sourceDuration();
    if (dur && end > dur + 0.05) {
      return { ok: false, error: "Out point (" + formatTime(end) + ") is past the end of the source video (" + formatTime(dur) + ")." };
    }
    return { ok: true, start: start, end: end };
  }

  function addClipFromEditor() {
    if (!sourceReady()) {
      setClipMessage("Upload an authorized MP4 or WebM source file before creating clips.", true);
      return null;
    }
    var v = validateClipRange(($("vp-clip-in") || {}).value, ($("vp-clip-out") || {}).value);
    if (!v.ok) { setClipMessage(v.error, true); return null; }

    var clip = sanitizeClip({
      sourceId: state.sourceMeta.id,
      start: v.start,
      end: v.end,
      label: "Clip " + formatTime(v.start) + "–" + formatTime(v.end),
    });
    state.storyboard.push(clip);
    if (safePersist()) {
      setClipMessage("Clip added — " + formatTime(clip.start) + " to " + formatTime(clip.end) +
        " (" + clip.duration.toFixed(1) + "s). Position " + state.storyboard.length + " in the sequence.", false);
    } else {
      setClipMessage("Clip added but COULD NOT BE SAVED — browser storage is full.", true);
    }
    renderStoryboard();
    previewCard(clip);
    updateRenderAvailability();
    return clip;
  }

  // Play exactly the clip's range in the editor player, then stop.
  function previewClipRange(clip) {
    var player = $("vp-clip-player");
    if (!clip || !player || !state.videoObjectUrl) return false;
    if (player._vpStop) { player.removeEventListener("timeupdate", player._vpStop); }
    try { player.currentTime = clip.start; } catch (e) { return false; }
    var stop = function () {
      if (player.currentTime >= clip.end) {
        player.pause();
        player.removeEventListener("timeupdate", stop);
        player._vpStop = null;
      }
    };
    player._vpStop = stop;
    player.addEventListener("timeupdate", stop);
    var p = player.play();
    if (p && typeof p.catch === "function") p.catch(function () {});
    return true;
  }

  // Take a picked file as this project's renderable source.
  //
  // If the project already has clips cut from a DIFFERENT file, that is not a
  // silent relink: existing clip timings would point into footage they were
  // never measured against. The operator is asked first, and declining leaves
  // the project exactly as it was.
  function adoptSourceFile(file) {
    var newId = sourceIdFor(file);
    var existing = clipsInStoryboard().filter(function (c) { return c.sourceId; });
    var priorId = state.sourceMeta && state.sourceMeta.id;
    var mismatch = existing.length && priorId && priorId !== newId;

    if (mismatch) {
      var okToSwap = window.confirm(
        "This project's " + existing.length + " clip(s) were cut from “" + state.sourceMeta.name + "”.\n\n" +
        "You picked “" + file.name + "”, which is a different file. Clip timings were measured " +
        "against the original and may not line up.\n\nUse this file anyway and relink the clips?");
      if (!okToSwap) {
        resetFileInputs();
        setClipMessage("Kept the existing source. Reselect “" + state.sourceMeta.name + "” to restore renderable clips.", true);
        renderSourceStudio();
        return false;
      }
    }

    if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
    state.videoObjectUrl = URL.createObjectURL(file);
    state.videoDataUrl = null;
    state.sourceMeta = sanitizeSourceMeta({
      id: newId, name: file.name, size: file.size,
      type: file.type, lastModified: file.lastModified, duration: null,
    });

    var vid = $("vp-video-preview");
    if (vid) { vid.src = state.videoObjectUrl; vid.style.display = "block"; }

    if (mismatch) {
      // Relink so the sequence stays renderable, and say so plainly.
      clipsInStoryboard().forEach(function (c) { c.sourceId = newId; });
    }

    // Learn the real duration so clip bounds can be validated against it.
    probeMediaDuration($("vp-clip-player") || vid, function (d) {
      if (state.sourceMeta && d) {
        state.sourceMeta.duration = d;
        safePersist();
        renderSourceStudio();
      }
    });

    safePersist();
    renderSourceStudio();
    renderStoryboard();
    setClipMessage(mismatch
      ? "Source replaced with “" + file.name + "” and " + existing.length + " clip(s) relinked. Check each clip's range."
      : "Source loaded: " + file.name + ". Mark In and Out, then add the clip to the sequence.", false);
    return true;
  }

  function markStepDone(step) {
    document.querySelectorAll(".vp-step").forEach(function (b) {
      if (b.dataset.vpStep === step) b.classList.add("done");
    });
  }

  function invalidateStoryboard() {
    if (!state.storyboard.length) return;
    state.storyboard = [];
    renderStoryboard();
  }

  function safePersist() {
    try {
      persist();
      return true;
    } catch (e) {
      console.error("Video Producer: could not save project to localStorage", e);
      return false;
    }
  }

  function setStoryboardStatus(msg, isError) {
    var el = $("vp-storyboard-status");
    if (!el) {
      var list = $("vp-storyboard-list");
      if (!list || !list.parentElement) return;
      el = document.createElement("p");
      el.id = "vp-storyboard-status";
      el.className = "vp-hint";
      list.parentElement.insertBefore(el, list);
    }
    // Announce build results to screen readers; assertive for real failures.
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", isError ? "assertive" : "polite");
    el.textContent = msg || "";
    el.style.color = isError ? "var(--persist)" : "var(--muted)";
  }

  function buildStoryboard() {
    try {
    // Operator-created clips are REAL content and are never regenerated or
    // thrown away by a rebuild — only the commentary cards are rebuilt from
    // the statements. The old code instead fabricated {source_clip}/{resume}
    // placeholders on every build, with invented timings and no source, and
    // reported success even when no media existed at all.
    var keptClips = clipsInStoryboard().map(function (c) { return c; });
    var board = [];

    if (keptClips.length) board.push(keptClips[0]);

    state.statements.forEach(function (st, i) {
      var t = (st.matches && st.matches[0]) ? st.matches[0].start : i * 8;
      var c = st.commentary || {};
      board.push({ type: "alert", label: "Development Alert", title: "DEVELOPMENT ALERT", subtitle: "HomeSignal Intelligence" });
      board.push({ type: "claim", label: "Claim", text: st.text, time: t });
      board.push({ type: "evidence", label: "Evidence", text: c.evidence || "", files: st.evidence || [] });
      board.push({ type: "commentary", label: "Commentary", text: c.community || "" });
      // CLIP → COMMENTARY → CLIP → COMMENTARY: drop the next operator clip
      // between commentary blocks so the sequence alternates as intended.
      if (keptClips[i + 1]) board.push(keptClips[i + 1]);
      if (i < state.statements.length - 1) {
        board.push({ type: "freeze", label: "Freeze frame", duration: 1 });
      }
    });
    // Any clips beyond the number of statements still belong to the operator.
    keptClips.slice(Math.max(1, state.statements.length + 1)).forEach(function (c) { board.push(c); });

    state.storyboard = board;
    var saved = safePersist();
    renderStoryboard();
    var first = state.storyboard.find(function (item) {
      return item.type === "alert" || item.type === "claim" || item.type === "clip";
    });
    if (first) previewCard(first);
    var list = $("vp-storyboard-list");
    if (list) list.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // The status must describe what was ACTUALLY assembled, including the
    // absence of source footage — never a bare "Storyboard built".
    var clipCount = clipsInStoryboard().length;
    var srcNote;
    if (clipCount) {
      srcNote = " " + clipCount + " source clip(s) included.";
      var blocked = unrenderableClips().length;
      if (blocked) srcNote += " " + blocked + " of them have no loaded media and will not render until the source file is reselected.";
    } else if (sourceReady()) {
      srcNote = " No source-video clips included — mark In/Out above and add clips to the sequence.";
    } else if (youtubeVideoId(state.youtube)) {
      srcNote = " No source-video clips included: a YouTube URL is a reference only. " +
        "Upload an authorized MP4 or WebM copy to create renderable clips.";
    } else {
      srcNote = " No source-video clips included: no renderable media has been uploaded.";
    }

    if (saved) {
      setStoryboardStatus("Storyboard built — " + state.storyboard.length + " items." + srcNote, clipCount === 0);
    } else {
      setStoryboardStatus("Storyboard built (" + state.storyboard.length + " items) but COULD NOT BE SAVED — " +
        "browser storage is full. Export the project to JSON or remove old projects, then build again.", true);
    }
    updateRenderAvailability();
    } catch (err) {
      console.error("Video Producer: buildStoryboard failed", err);
      setStoryboardStatus("Could not build storyboard: " + (err && err.message ? err.message : err), true);
    }
  }

  function renderStoryboard() {
    var list = $("vp-storyboard-list");
    if (!list) return;
    if (!state.storyboard.length) {
      list.removeAttribute("role");
      list.innerHTML = '<p class="muted">Click “Build / refresh storyboard” to generate the sequence.</p>';
      return;
    }
    list.setAttribute("role", "list");
    list.innerHTML = state.storyboard.map(function (item, i) {
      // Defensive: a hand-edited or truncated storage record can carry an item
      // with no `type`. Reading .replace off undefined used to throw out of
      // renderStoryboard and abort loadProject before renderProjectChips ran —
      // which removed the project switcher and left the tab unusable.
      item = item && typeof item === "object" ? item : {};
      var type = typeof item.type === "string" && item.type ? item.type : "unknown";
      var preview = item.text || item.label || type;
      if (type === "alert") preview = (item.title || "") + " — " + (item.subtitle || "");
      var extra = "";
      if (type === "clip") {
        // Show the real range and duration, plus an explicit warning when the
        // clip's media is not loaded, so the list never implies it will render.
        preview = formatTime(item.start) + " → " + formatTime(item.end) +
          "  (" + (Number(item.duration) || 0).toFixed(1) + "s)";
        var linked = sourceReady() && state.sourceMeta &&
          (!item.sourceId || item.sourceId === state.sourceMeta.id);
        extra = linked
          ? '<span class="vp-conf high">source loaded</span>'
          : '<span class="vp-conf low">source not loaded</span>';
      }
      return '<div class="vp-sb-item" draggable="true" data-ix="' + i + '"' +
        ' tabindex="0" role="listitem"' +
        ' aria-label="' + esc(type.replace("_", " ")) + " " + (i + 1) + " of " + state.storyboard.length +
        (type === "clip" ? ", " + esc(preview) : "") +
        '. Hold Alt and press arrow up or down to reorder."' +
        '>' +
        '<span class="vp-sb-handle" aria-hidden="true">⠿</span>' +
        '<div><div class="vp-sb-type">' + esc(type.replace("_", " ")) + '</div>' +
        '<div class="vp-sb-preview">' + esc(String(preview).slice(0, 120)) + "</div></div>" + extra +
        '<button type="button" class="vp-btn secondary vp-sb-preview-btn" data-ix="' + i + '" style="padding:4px 8px;font-size:11px">Preview</button>' +
        '<button type="button" class="vp-btn secondary vp-sb-remove-btn" data-ix="' + i + '" style="padding:4px 8px;font-size:11px">Remove</button></div>';
    }).join("");

    var dragIx = null;
    list.querySelectorAll(".vp-sb-item").forEach(function (row) {
      row.addEventListener("dragstart", function (e) {
        dragIx = parseInt(row.dataset.ix, 10);
        e.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragover", function (e) {
        e.preventDefault();
        row.classList.add("drag-over");
      });
      row.addEventListener("dragleave", function () { row.classList.remove("drag-over"); });
      row.addEventListener("drop", function (e) {
        e.preventDefault();
        row.classList.remove("drag-over");
        var dropIx = parseInt(row.dataset.ix, 10);
        if (dragIx === null || dragIx === dropIx) return;
        moveStoryboardItem(dragIx, dropIx);
      });

      // Keyboard equivalent of the drag handle — dragging was the ONLY way to
      // reorder, which left the sequence unusable without a mouse.
      row.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        if (!e.altKey && !e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        var from = parseInt(row.dataset.ix, 10);
        var to = e.key === "ArrowUp" ? from - 1 : from + 1;
        if (to < 0 || to >= state.storyboard.length) return;
        moveStoryboardItem(from, to);
        var moved = list.querySelector('.vp-sb-item[data-ix="' + to + '"]');
        if (moved) moved.focus();
      });
    });
  }

  function moveStoryboardItem(from, to) {
    if (from === null || isNaN(from) || isNaN(to) || from === to) return;
    var item = state.storyboard.splice(from, 1)[0];
    state.storyboard.splice(to, 0, item);
    if (safePersist()) {
      setStoryboardStatus("Moved “" + (item.label || item.type || "item") + "” to position " +
        (to + 1) + " of " + state.storyboard.length + ". Order saved.", false);
    } else {
      setStoryboardStatus("New order COULD NOT BE SAVED — browser storage is full.", true);
    }
    renderStoryboard();
    previewCard(state.storyboard[0]);
  }

  function previewCard(item) {
    if (!item) return;
    var claim = $("vp-preview-claim");
    var body = $("vp-preview-body");
    if (!claim || !body) return;
    if (item.type === "clip") {
      claim.textContent = "SOURCE CLIP";
      var played = previewClipRange(item);
      body.textContent = formatTime(item.start) + " → " + formatTime(item.end) +
        " (" + (Number(item.duration) || 0).toFixed(1) + "s)" +
        (played ? " — playing this range" : " — source media not loaded; reselect the file in Step 1");
      return;
    }
    if (item.type === "alert") {
      claim.textContent = item.title || "DEVELOPMENT ALERT";
      body.textContent = item.subtitle || "HomeSignal Intelligence";
    } else if (item.type === "claim") {
      claim.textContent = "WHAT WAS SAID";
      body.textContent = item.text || "";
    } else if (item.type === "evidence") {
      claim.textContent = "WHAT THE EVIDENCE SHOWS";
      body.textContent = item.text || "";
    } else if (item.type === "commentary") {
      claim.textContent = "WHAT THIS MEANS FOR YOUR COMMUNITY";
      body.textContent = item.text || "";
    } else {
      claim.textContent = item.label || item.type;
      body.textContent = item.text ? item.text : (item.start != null ? "@" + formatTime(item.start) : "");
    }
  }

  function drawBrandedCard(ctx, w, h, item) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#0d1a30");
    g.addColorStop(1, "#0a1220");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#22304d";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    var title = "";
    var body = "";
    var accent = "#ff6b4a";
    if (item.type === "alert") {
      title = "DEVELOPMENT ALERT";
      body = "HomeSignal Intelligence";
      accent = "#ff6b4a";
    } else if (item.type === "claim") {
      title = "WHAT WAS SAID";
      body = item.text || "";
      accent = "#4f9cff";
    } else if (item.type === "evidence") {
      title = "WHAT THE EVIDENCE SHOWS";
      body = item.text || "";
      accent = "#e0a423";
    } else if (item.type === "commentary") {
      title = "WHAT THIS MEANS FOR YOUR COMMUNITY";
      body = item.text || "";
      accent = "#2fbf71";
    } else {
      title = (item.label || item.type || "").toUpperCase();
      body = item.text || "";
    }

    ctx.fillStyle = accent;
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(title.slice(0, 40), 48, 72);
    ctx.fillStyle = "#8ea3c2";
    ctx.font = "16px sans-serif";
    if (item.type === "alert") ctx.fillText(body, 48, 102);
    ctx.fillStyle = "#e8eef7";
    ctx.font = "28px sans-serif";
    wrapText(ctx, body, 48, item.type === "alert" ? 150 : 120, w - 96, 34);
  }

  function wrapText(ctx, text, x, y, maxW, lineH) {
    var words = String(text || "").split(/\s+/);
    var line = "";
  words.forEach(function (word, i) {
      var test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y);
        line = word;
        y += lineH;
      } else line = test;
      if (i === words.length - 1) ctx.fillText(line, x, y);
    });
  }

  function pickRecorderMimeType() {
    var types = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];
    for (var i = 0; i < types.length; i++) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return "";
  }

  function pumpCanvasFrame(stream) {
    var track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    if (track && typeof track.requestFrame === "function") track.requestFrame();
  }

  function seekVideo(v, time) {
    return new Promise(function (resolve) {
      if (!v || !v.src) { resolve(); return; }
      var target = Math.max(0, time || 0);
      var onSeeked = function () {
        v.removeEventListener("seeked", onSeeked);
        resolve();
      };
      v.addEventListener("seeked", onSeeked);
      v.pause();
      try {
        v.currentTime = target;
      } catch (e) {
        v.removeEventListener("seeked", onSeeked);
        resolve();
        return;
      }
      if (Math.abs(v.currentTime - target) < 0.05) {
        v.removeEventListener("seeked", onSeeked);
        resolve();
      }
    });
  }

  function renderVideo(progressCb, doneCb) {
    var aspect = ($("vp-aspect") && $("vp-aspect").value) || "landscape";
    var w = aspect === "vertical" ? 1080 : 1920;
    var h = aspect === "vertical" ? 1920 : 1080;
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    var items = state.storyboard.length ? state.storyboard : [{ type: "alert", title: "DEVELOPMENT ALERT", subtitle: "HomeSignal Intelligence" }];
    var total = items.length;
    // Render off a dedicated element so exporting does not hijack the player
    // the operator is scrubbing, and so seeking mid-render is never visible.
    var renderSourceEl = null;
    if (state.videoObjectUrl) {
      renderSourceEl = document.createElement("video");
      renderSourceEl.src = state.videoObjectUrl;
      renderSourceEl.muted = true;
      renderSourceEl.playsInline = true;
      renderSourceEl.setAttribute("playsinline", "");
      renderSourceEl.preload = "auto";
    }
    var fps = 24;
    var stream = canvas.captureStream(fps);
    var chunks = [];
    var recorder;
    var mimeType = pickRecorderMimeType();
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType: mimeType, videoBitsPerSecond: 4500000 })
        : new MediaRecorder(stream);
    } catch (e) {
      try { recorder = new MediaRecorder(stream); } catch (e2) { doneCb(null, "MediaRecorder not supported in this browser."); return; }
    }
    recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = function () {
      var blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" });
      doneCb(blob.size ? blob : null, blob.size ? null : "Render produced an empty file. Try again in Chrome or Brave.");
    };
    recorder.start(250);

    var vi = 0;
    function next() {
      if (vi >= total) {
        setTimeout(function () {
          if (typeof recorder.requestData === "function") recorder.requestData();
          recorder.stop();
        }, 800);
        return;
      }
      var item = items[vi];
      var dur = item.duration || (item.type === "alert" || item.type === "claim" ? 3 : 2.5);
      var frames = Math.ceil(dur * fps);
      var f = 0;
      progressCb((vi + 0.5) / total);

      // A clip must export as MOVING footage trimmed to [start, end). The old
      // code paused the element and redrew the same frame for the whole item,
      // so source footage always exported as a still and no end time existed.
      if (item.type === "clip") {
        renderClipItem(item, function () { vi++; next(); });
        return;
      }

      function drawFrame() {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        if (item.type === "freeze") {
          var vid2 = renderSourceEl;
          if (vid2 && vid2.src && vid2.readyState >= 2) {
            try { ctx.drawImage(vid2, 0, 0, w, h); } catch (e) { /* keep the black field */ }
          }
          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.fillRect(0, 0, w, h);
        } else {
          drawBrandedCard(ctx, w, h, item);
        }
        if ($("vp-captions") && $("vp-captions").checked && item.text) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(0, h - 100, w, 100);
          ctx.fillStyle = "#fff";
          ctx.font = "24px sans-serif";
          wrapText(ctx, item.text, 40, h - 72, w - 80, 28);
        }
        pumpCanvasFrame(stream);
        f++;
        if (f < frames) setTimeout(drawFrame, 1000 / fps);
        else { vi++; next(); }
      }
      drawFrame();
    }

    // Play [start, end) and capture real frames. Falls back to a labelled card
    // only when the media genuinely is not loaded — and buildStoryboard /
    // updateRenderAvailability already stop the operator reaching here in that
    // state, so this is a backstop, not a silent substitution.
    function renderClipItem(item, doneItem) {
      var v = renderSourceEl;
      var usable = v && v.src && isFinite(item.start) && isFinite(item.end) && item.end > item.start;
      if (!usable) {
        var frames2 = Math.ceil((Number(item.duration) || 2) * fps);
        var f2 = 0;
        (function placeholder() {
          ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
          drawBrandedCard(ctx, w, h, {
            type: "alert", title: "SOURCE CLIP UNAVAILABLE",
            subtitle: formatTime(item.start) + "–" + formatTime(item.end) + " — source file not loaded",
          });
          pumpCanvasFrame(stream);
          f2++;
          if (f2 < frames2) setTimeout(placeholder, 1000 / fps); else doneItem();
        })();
        return;
      }

      seekVideo(v, item.start).then(function () {
        var playing = v.play();
        if (playing && typeof playing.catch === "function") playing.catch(function () {});
        (function pump() {
          // currentTime is the authority, so the clip stops at its OUT point
          // regardless of decode jitter — this is the trim.
          if (v.currentTime >= item.end || v.ended) {
            v.pause();
            doneItem();
            return;
          }
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, w, h);
          try { ctx.drawImage(v, 0, 0, w, h); } catch (e) { /* keep the black field */ }
          if ($("vp-captions") && $("vp-captions").checked && item.text) {
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.fillRect(0, h - 100, w, 100);
            ctx.fillStyle = "#fff";
            ctx.font = "24px sans-serif";
            wrapText(ctx, item.text, 40, h - 72, w - 80, 28);
          }
          pumpCanvasFrame(stream);
          setTimeout(pump, 1000 / fps);
        })();
      });
    }

    next();
  }

  function clearRenderOutput() {
    if (state.renderObjectUrl) {
      URL.revokeObjectURL(state.renderObjectUrl);
      state.renderObjectUrl = null;
    }
  }

  function showRenderOutput(blob) {
    var out = $("vp-render-out");
    if (!out) return;
    clearRenderOutput();
    if (!blob || !blob.size) {
      out.innerHTML = '<p class="vp-hint">Render produced an empty file. Try again in Chrome or Brave.</p>';
      return;
    }
    state.renderObjectUrl = URL.createObjectURL(blob);
    state.renderBlob = blob;
    var url = state.renderObjectUrl;
    var mime = blob.type || "video/webm";
    out.textContent = "";
    var video = document.createElement("video");
    video.controls = true;
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    var source = document.createElement("source");
    source.src = url;
    source.type = mime;
    video.appendChild(source);
    video.load();
    var meta = document.createElement("p");
    meta.className = "vp-hint";
    meta.textContent = "Preview ready (" + Math.round(blob.size / 1024) + " KB). Press play if it does not start automatically.";
    video.addEventListener("loadeddata", function () {
      video.play().catch(function () {});
    });
    video.addEventListener("error", function () {
      meta.textContent = "Preview could not play in this browser. Use Download WebM and open the file in VLC or QuickTime.";
    });
    out.appendChild(video);
    out.appendChild(meta);
    var hint = document.createElement("p");
    hint.className = "vp-hint";
    var dl = document.createElement("button");
    dl.type = "button";
    dl.className = "vp-btn secondary";
    dl.textContent = "Download WebM";
    dl.addEventListener("click", function () {
      var a = document.createElement("a");
      a.href = url;
      a.download = (state.name || "homesignal-video").replace(/[^\w.-]+/g, "-") + ".webm";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    hint.appendChild(dl);
    hint.appendChild(document.createTextNode(" — browser preview export (WebM only)."));
    out.appendChild(hint);
  }

  function bindVpDom(container) {
    vpContainer = container || document.getElementById("tab-videoproducer");
    vpRoot = vpContainer ? vpContainer.querySelector("#video-producer-root") : null;
  }

  function wireButton(id, handler) {
    var btn = $(id);
    if (!btn) return;
    var marker = "data-vp-btn-" + id;
    if (btn.getAttribute(marker) === "1") return;
    btn.setAttribute(marker, "1");
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      handler(e);
    });
  }

  function ensureActionButtons() {
    wireButton("vp-analyze-transcript", function () {
      syncFromForm();
      if (!state.transcriptRaw.trim()) {
        alert("Paste or fetch a transcript first.");
        return;
      }
      state.parsed = parseTranscript(state.transcriptRaw);
      renderTranscript();
      safePersist();
      setStep("statements");
      markStepDone("source");
    });
    wireButton("vp-fetch-transcript", fetchYoutubeTranscript);
    wireButton("vp-save-project", function () {
      if (safePersist()) alert("Project saved locally.");
      else alert("Could not save project. Browser storage may be full — export JSON or remove old projects.");
    });
    wireButton("vp-new-project", startNewProject);
    wireButton("vp-locate-statements", function () {
      syncFromForm();
      state.parsed = parseTranscript(state.transcriptRaw);
      var lines = ($("vp-statement-input") && $("vp-statement-input").value || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      lines.forEach(function (line) {
        var matches = findMatches(line, state.parsed);
        state.statements.push({
          id: uid(),
          text: line,
          matches: matches.length ? matches : [{ text: line, start: 0, end: 4, confidence: 0.3 }],
          commentary: { said: line, evidence: "", community: "" },
          evidence: [],
        });
      });
      if ($("vp-statement-input")) $("vp-statement-input").value = "";
      invalidateStoryboard();
      safePersist();
      renderStatements();
      renderCommentary();
      markStepDone("statements");
    });
    wireButton("vp-add-statement", function () {
      var line = prompt("Statement to locate:");
      if (!line) return;
      syncFromForm();
      state.parsed = parseTranscript(state.transcriptRaw);
      var matches = findMatches(line, state.parsed);
      state.statements.push({
        id: uid(),
        text: line,
        matches: matches.length ? matches : [{ text: line, start: 0, end: 4, confidence: 0.3 }],
        commentary: { said: line, evidence: "", community: "" },
        evidence: [],
      });
      // Invalidate BEFORE persisting, or storage keeps a storyboard that no
      // longer matches the statements and a reload restores the stale one.
      invalidateStoryboard();
      safePersist();
      renderStatements();
      renderCommentary();
    });
    wireButton("vp-build-storyboard", function () {
      buildStoryboard();
      markStepDone("storyboard");
    });
    wireButton("vp-clip-add", function () { addClipFromEditor(); });
    wireButton("vp-clip-set-in", function () {
      var p = $("vp-clip-player");
      if (p && $("vp-clip-in")) {
        $("vp-clip-in").value = formatTime(p.currentTime);
        setClipMessage("In point set to " + formatTime(p.currentTime) + ".", false);
      }
    });
    wireButton("vp-clip-set-out", function () {
      var p = $("vp-clip-player");
      if (p && $("vp-clip-out")) {
        $("vp-clip-out").value = formatTime(p.currentTime);
        setClipMessage("Out point set to " + formatTime(p.currentTime) + ".", false);
      }
    });
    wireButton("vp-start-render", function (e) {
      var el = e.currentTarget;
      var bar = $("vp-render-bar");
      var status = $("vp-render-status");
      if (!state.storyboard.length) buildStoryboard();
      if (bar) bar.style.width = "0%";
      el.disabled = true;
      if (status) status.textContent = "Rendering…";
      // renderVideo can throw synchronously (canvas.captureStream or
      // MediaRecorder unavailable). Without this the button stayed disabled
      // and the status stuck on "Rendering…" until a full page reload.
      try {
        renderVideo(function (p) {
          if (bar) bar.style.width = Math.round(p * 100) + "%";
        }, function (blob, err) {
          el.disabled = false;
          if (err) { if (status) status.textContent = err; return; }
          if (bar) bar.style.width = "100%";
          if (status) status.textContent = "Render complete. Download or preview below.";
          showRenderOutput(blob);
          markStepDone("render");
        });
      } catch (renderErr) {
        console.error("Video Producer: render failed to start", renderErr);
        el.disabled = false;
        if (bar) bar.style.width = "0%";
        if (status) {
          status.textContent = "Could not start the render: " +
            (renderErr && renderErr.message ? renderErr.message : renderErr) +
            " — try Chrome or Brave.";
        }
      }
    });
    wireButton("vp-export-project", function () {
      syncFromForm();
      var blob = new Blob([JSON.stringify(projectRecordFromState(), null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      var url = URL.createObjectURL(blob);
      a.href = url;
      a.download = (state.name || "homesignal-video-project") + ".json";
      a.click();
      // Release the blob; without this every export leaked one object URL.
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    });
  }

  function wireEvents(container) {
    if (!container || container.getAttribute("data-vp-delegate-wired") === "1") return;
    container.setAttribute("data-vp-delegate-wired", "1");

    container.addEventListener("click", function (e) {
      var stepBtn = e.target.closest && e.target.closest(".vp-step");
      if (stepBtn && container.contains(stepBtn)) {
        setStep(stepBtn.dataset.vpStep);
        return;
      }

      var chip = e.target.closest && e.target.closest(".vp-project-chip");
      if (chip && container.contains(chip)) {
        var rec = loadProjects().find(function (p) { return p.id === chip.dataset.id; });
        if (rec) loadProject(rec);
        return;
      }

      var previewBtn = e.target.closest && e.target.closest(".vp-sb-preview-btn");
      if (previewBtn && container.contains(previewBtn)) {
        previewCard(state.storyboard[parseInt(previewBtn.dataset.ix, 10)]);
        return;
      }

      // Removing a clip removes ONE sequence item. It never touches the
      // underlying source file, its identity, or any other clip.
      var sbRemove = e.target.closest && e.target.closest(".vp-sb-remove-btn");
      if (sbRemove && container.contains(sbRemove)) {
        var rix = parseInt(sbRemove.dataset.ix, 10);
        var removed = state.storyboard[rix];
        if (!removed) return;
        state.storyboard.splice(rix, 1);
        if (safePersist()) {
          setStoryboardStatus("Removed “" + (removed.label || removed.type || "item") + "”. " +
            state.storyboard.length + " items remain; the source video is untouched.", false);
        } else {
          setStoryboardStatus("Item removed but COULD NOT BE SAVED — browser storage is full.", true);
        }
        renderStoryboard();
        renderSourceStudio();
        return;
      }

      var evRemove = e.target.closest && e.target.closest(".vp-ev-remove");
      if (evRemove && container.contains(evRemove)) {
        var si = parseInt(evRemove.dataset.si, 10);
        var ei = parseInt(evRemove.dataset.ei, 10);
        if (state.statements[si] && state.statements[si].evidence) {
          state.statements[si].evidence.splice(ei, 1);
          safePersist();
          renderCommentary();
        }
        return;
      }

      var rmStmt = e.target.closest && e.target.closest(".vp-remove-stmt");
      if (rmStmt && container.contains(rmStmt)) {
        state.statements.splice(parseInt(rmStmt.dataset.si, 10), 1);
        invalidateStoryboard();
        safePersist();
        renderStatements();
        renderCommentary();
        return;
      }
    });

    container.addEventListener("change", function (e) {
      var el = e.target;
      if (!el || !container.contains(el)) return;

      if (el.id === "vp-transcript-file") {
        var file = el.files && el.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          if ($("vp-transcript-paste")) $("vp-transcript-paste").value = reader.result;
          state.transcriptRaw = reader.result;
          state.parsed = parseTranscript(state.transcriptRaw);
          renderTranscript();
          safePersist();
        };
        reader.readAsText(file);
        return;
      }
      if (el.id === "vp-source-video") {
        var vfile = el.files && el.files[0];
        if (!vfile) return;
        adoptSourceFile(vfile);
        return;
      }
      if (el.matches && el.matches('input[data-field="start"]')) {
        var si = parseInt(el.dataset.si, 10);
        var mi = parseInt(el.dataset.mi, 10);
        var sec = parseTimecode(el.value);
        if (state.statements[si] && state.statements[si].matches[mi]) {
          state.statements[si].matches[mi].start = sec;
          state.statements[si].matches[mi].end = sec + 4;
          safePersist();
        }
        return;
      }
      if (el.classList && el.classList.contains("vp-evidence-upload")) {
        var evSi = parseInt(el.dataset.si, 10);
        Array.from(el.files || []).forEach(function (file) {
          var evReader = new FileReader();
          evReader.onload = function () {
            if (!state.statements[evSi].evidence) state.statements[evSi].evidence = [];
            state.statements[evSi].evidence.push({
              name: file.name,
              type: file.type,
              dataUrl: evReader.result,
            });
            safePersist();
            renderCommentary();
          };
          evReader.readAsDataURL(file);
        });
      }
    });

    container.addEventListener("input", function (e) {
      var el = e.target;
      if (!el || !container.contains(el)) return;
      if (el.id === "vp-transcript-search") {
        renderTranscript(el.value);
        return;
      }
      // The YouTube reference player has to appear as soon as a URL is typed.
      // state.youtube was previously only synced on a button click, so the
      // reference frame and the source-status strips stayed blank until the
      // operator happened to press something.
      if (el.id === "vp-youtube") {
        state.youtube = el.value || "";
        renderSourceStudio();
        return;
      }
      if (el.matches && el.matches("textarea[data-cfield]")) {
        var si = parseInt(el.dataset.si, 10);
        var field = el.dataset.cfield;
        if (!state.statements[si].commentary) state.statements[si].commentary = {};
        state.statements[si].commentary[field] = el.value;
        safePersist();
      }
    });
  }

  function ensureRenderLabel() {
    var renderBtn = $("vp-start-render");
    if (renderBtn) renderBtn.textContent = "Browser Preview Export — WebM";
  }

  function bootVideoProducer(container) {
    bindVpDom(container);
    if (!vpRoot) return;
    compactStoredProjects();
    ensureRenderLabel();
    ensureFetchTranscriptButton();
    ensureSourceStudio();
    var activeStep = "source";
    var activeBtn = document.querySelector(".vp-step.active");
    if (activeBtn && activeBtn.dataset.vpStep) activeStep = activeBtn.dataset.vpStep;
    var list = loadProjects();
    var current = state.id && list.find(function (p) { return p.id === state.id; });
    if (current) loadProject(current);
    else if (list.length) loadProject(list[0]);
    else startNewDraft();
    if (container) wireEvents(container);
    ensureActionButtons();
    renderSourceStudio();
    setStep(activeStep);
    // A storage failure detected during compaction is reported, not swallowed.
    if (lastStorageProblem) {
      setStoryboardStatus(lastStorageProblem, true);
      lastStorageProblem = null;
    }
  }

  function refreshVideoProducer() {
    bindVpDom(vpContainer);
    if (!vpRoot) return;
    ensureRenderLabel();
    ensureFetchTranscriptButton();
    ensureSourceStudio();
    ensureActionButtons();
    syncStateToForm();
    renderProjectChips();
    renderTranscript();
    renderStatements();
    renderCommentary();
    renderStoryboard();
    renderSourceStudio();
  }

  function rebootVideoProducer(container) {
    bootVideoProducer(container);
  }

  window.HomeSignalVideoProducer = {
    init: function (container, payload) {
      if (!container) return;
      bindVpDom(container);
      if (!vpRoot) return;
      compactStoredProjects();
      ensureRenderLabel();
      ensureFetchTranscriptButton();
      ensureSourceStudio();
      wireEvents(container);
      ensureActionButtons();
      if (container.getAttribute("data-vp-initialized") === "1") {
        refreshVideoProducer();
        return;
      }
      container.setAttribute("data-vp-initialized", "1");
      bootVideoProducer(container);
    },
    refresh: function (container) {
      if (!container || !container.querySelector("#video-producer-root")) return;
      refreshVideoProducer();
    },
    reboot: function (container) {
      if (!container || !container.querySelector("#video-producer-root")) return;
      rebootVideoProducer(container);
    }
  };
})();