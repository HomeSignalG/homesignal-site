/* HomeSignal Video Producer — Acquisition Dashboard tab (client-only).
   Operator-authored commentary; no automatic truth/misinformation labels. */
(function () {
  "use strict";

  var STORAGE_KEY = "hs_video_projects_v1";
  var WPM = 150;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function uid() { return "vp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function normalizeText(s) {
    return String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
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

  function loadProjects() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
    catch (e) { return []; }
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
      videoDataUrl: state.videoDataUrl || null,
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
      state.storyboard.length || state.youtube || state.speaker || state.videoDataUrl);
    var existsInList = !!(state.id && list.some(function (p) { return p.id === state.id; }));
    if (existsInList || (hasContent && state.id)) persist();
    startNewDraft();
  }

  var state = {
    id: null,
    name: "",
    youtube: "",
    speaker: "",
    transcriptRaw: "",
    parsed: { plain: "", cues: [] },
    videoObjectUrl: null,
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
      persist();
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
    var rec = projectRecordFromState();
    var ix = list.findIndex(function (p) { return p.id === rec.id; });
    if (ix >= 0) list[ix] = rec;
    else list.push(rec);
    saveProjects(list);
    renderProjectChips();
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
    state.videoObjectUrl = null;

    if ($("vp-project-name")) $("vp-project-name").value = state.name;
    if ($("vp-youtube")) $("vp-youtube").value = state.youtube;
    if ($("vp-speaker")) $("vp-speaker").value = state.speaker;
    if ($("vp-transcript-paste")) $("vp-transcript-paste").value = state.transcriptRaw;

    var vid = $("vp-video-preview");
    if (vid && state.videoDataUrl) {
      vid.src = state.videoDataUrl;
      vid.style.display = "block";
    } else if (vid) {
      vid.removeAttribute("src");
      vid.style.display = "none";
    }
    renderTranscript();
    renderStatements();
    renderCommentary();
    renderStoryboard();
    renderProjectChips();
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
    el.querySelectorAll(".vp-project-chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var rec = list.find(function (p) { return p.id === btn.dataset.id; });
        if (rec) loadProject(rec);
      });
    });
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
      var norm = normalizeText(text);
      var nh = normalizeText(highlight);
      var idx = norm.indexOf(nh);
      if (idx >= 0) {
        var pre = esc(text.slice(0, idx));
        var mid = esc(text.slice(idx, idx + highlight.length));
        var post = esc(text.slice(idx + highlight.length));
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

    list.querySelectorAll('input[data-field="start"]').forEach(function (inp) {
      inp.addEventListener("change", function () {
        var si = parseInt(inp.dataset.si, 10);
        var mi = parseInt(inp.dataset.mi, 10);
        var sec = parseTimecode(inp.value);
        if (state.statements[si] && state.statements[si].matches[mi]) {
          state.statements[si].matches[mi].start = sec;
          state.statements[si].matches[mi].end = sec + 4;
          persist();
        }
      });
    });
    list.querySelectorAll(".vp-remove-stmt").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.statements.splice(parseInt(btn.dataset.si, 10), 1);
        persist();
        renderStatements();
        renderCommentary();
      });
    });
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

    list.querySelectorAll("textarea[data-cfield]").forEach(function (ta) {
      ta.addEventListener("input", function () {
        var si = parseInt(ta.dataset.si, 10);
        var field = ta.dataset.cfield;
        if (!state.statements[si].commentary) state.statements[si].commentary = {};
        state.statements[si].commentary[field] = ta.value;
        persist();
      });
    });
    list.querySelectorAll(".vp-evidence-upload").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var si = parseInt(inp.dataset.si, 10);
        Array.from(inp.files || []).forEach(function (file) {
          var reader = new FileReader();
          reader.onload = function () {
            if (!state.statements[si].evidence) state.statements[si].evidence = [];
            state.statements[si].evidence.push({
              name: file.name,
              type: file.type,
              dataUrl: reader.result,
            });
            persist();
            renderCommentary();
          };
          reader.readAsDataURL(file);
        });
      });
    });
    list.querySelectorAll(".vp-ev-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var si = parseInt(btn.dataset.si, 10);
        var ei = parseInt(btn.dataset.ei, 10);
        state.statements[si].evidence.splice(ei, 1);
        persist();
        renderCommentary();
      });
    });
  }

  function blockField(si, field, label, val) {
    return '<div class="vp-comment-block"><h5>' + esc(label) + '</h5>' +
      '<textarea data-si="' + si + '" data-cfield="' + field + '" rows="3" style="width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px">' +
      esc(val) + "</textarea></div>";
  }

  function evidenceHtml(items, si) {
    if (!items.length) return '<div class="vp-evidence"></div>';
    return '<div class="vp-evidence">' + items.map(function (ev, ei) {
      var thumb = ev.type && ev.type.indexOf("image") === 0
        ? '<img src="' + ev.dataUrl + '" alt="">' : "📄 " + esc(ev.name);
      return '<div class="vp-evidence-item">' + thumb +
        '<button type="button" class="vp-btn secondary vp-ev-remove" data-si="' + si + '" data-ei="' + ei + '" style="padding:2px 6px;font-size:10px">Remove</button></div>';
    }).join("") + "</div>";
  }

  function buildStoryboard() {
    var board = [];
    var vidStart = { type: "source_clip", label: "Source clip (intro)", start: 0, duration: 3 };
    board.push(vidStart);
    board.push({ type: "freeze", label: "Freeze frame", duration: 1.5 });

    state.statements.forEach(function (st, i) {
      var t = (st.matches && st.matches[0]) ? st.matches[0].start : i * 8;
      var c = st.commentary || {};
      board.push({ type: "alert", label: "Development Alert", title: "DEVELOPMENT ALERT", subtitle: "HomeSignal Intelligence" });
      board.push({ type: "claim", label: "Claim", text: st.text, time: t });
      board.push({ type: "evidence", label: "Evidence", text: c.evidence || "", files: st.evidence || [] });
      board.push({ type: "commentary", label: "Commentary", text: c.community || "" });
      board.push({ type: "resume", label: "Resume video", start: t, duration: 4 });
      if (i < state.statements.length - 1) {
        board.push({ type: "freeze", label: "Freeze frame", duration: 1 });
      }
    });
    state.storyboard = board;
    persist();
    renderStoryboard();
  }

  function renderStoryboard() {
    var list = $("vp-storyboard-list");
    if (!list) return;
    if (!state.storyboard.length) {
      list.innerHTML = '<p class="muted">Click “Build / refresh storyboard” to generate the sequence.</p>';
      return;
    }
    list.innerHTML = state.storyboard.map(function (item, i) {
      var preview = item.text || item.label || item.type;
      if (item.type === "alert") preview = item.title + " — " + item.subtitle;
      return '<div class="vp-sb-item" draggable="true" data-ix="' + i + '">' +
        '<span class="vp-sb-handle">⠿</span>' +
        '<div><div class="vp-sb-type">' + esc(item.type.replace("_", " ")) + '</div>' +
        '<div class="vp-sb-preview">' + esc(String(preview).slice(0, 120)) + "</div></div>" +
        '<button type="button" class="vp-btn secondary vp-sb-preview-btn" data-ix="' + i + '" style="padding:4px 8px;font-size:11px">Preview</button></div>';
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
        var item = state.storyboard.splice(dragIx, 1)[0];
        state.storyboard.splice(dropIx, 0, item);
        persist();
        renderStoryboard();
      });
    });
    list.querySelectorAll(".vp-sb-preview-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        previewCard(state.storyboard[parseInt(btn.dataset.ix, 10)]);
      });
    });
  }

  function previewCard(item) {
    if (!item) return;
    var claim = $("vp-preview-claim");
    var body = $("vp-preview-body");
    if (!claim || !body) return;
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
    var fps = 30;
    var stream = canvas.captureStream(fps);
    var chunks = [];
    var recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 6000000 });
    } catch (e) {
      try { recorder = new MediaRecorder(stream); } catch (e2) { doneCb(null, "MediaRecorder not supported in this browser."); return; }
    }
    recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = function () {
      var blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      doneCb(blob, null);
    };
    recorder.start();

    var vi = 0;
    function next() {
      if (vi >= total) {
        setTimeout(function () { recorder.stop(); }, 400);
        return;
      }
      var item = items[vi];
      var dur = item.duration || (item.type === "alert" || item.type === "claim" ? 3 : 2.5);
      var frames = Math.ceil(dur * fps);
      var f = 0;
      progressCb((vi + 0.5) / total);

      function drawFrame() {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        if (item.type === "source_clip" || item.type === "resume") {
          var vid = $("vp-video-preview");
          if (vid && vid.src && vid.readyState >= 2) {
            try {
              ctx.drawImage(vid, 0, 0, w, h);
            } catch (e) {
              drawBrandedCard(ctx, w, h, { type: "alert", title: "SOURCE CLIP", subtitle: formatTime(item.start || 0) });
            }
          } else {
            drawBrandedCard(ctx, w, h, { type: "alert", title: "SOURCE VIDEO", subtitle: "Upload a source file in Step 1" });
          }
        } else if (item.type === "freeze") {
          var vid2 = $("vp-video-preview");
          if (vid2 && vid2.src) ctx.drawImage(vid2, 0, 0, w, h);
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
        f++;
        if (f < frames) requestAnimationFrame(drawFrame);
        else { vi++; next(); }
      }
      if ((item.type === "source_clip" || item.type === "resume") && $("vp-video-preview")) {
        var v = $("vp-video-preview");
        v.currentTime = item.start || 0;
        v.play().catch(function () {});
      }
      drawFrame();
    }
    next();
  }

  function wireEvents() {
    if (eventsWired) return;
    eventsWired = true;
    document.querySelectorAll(".vp-step").forEach(function (btn) {
      btn.addEventListener("click", function () { setStep(btn.dataset.vpStep); });
    });

    var analyze = $("vp-analyze-transcript");
    if (analyze) analyze.addEventListener("click", function () {
      syncFromForm();
      state.parsed = parseTranscript(state.transcriptRaw);
      renderTranscript();
      persist();
      setStep("statements");
      document.querySelectorAll(".vp-step").forEach(function (b) {
        if (b.dataset.vpStep === "source") b.classList.add("done");
      });
    });

    var fetchBtn = ensureFetchTranscriptButton();
    if (fetchBtn) fetchBtn.addEventListener("click", fetchYoutubeTranscript);

    var saveBtn = $("vp-save-project");
    if (saveBtn) saveBtn.addEventListener("click", function () { persist(); alert("Project saved locally."); });

    var newBtn = $("vp-new-project");
    if (newBtn) newBtn.addEventListener("click", startNewProject);

    var tFile = $("vp-transcript-file");
    if (tFile) tFile.addEventListener("change", function () {
      var file = tFile.files && tFile.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        if ($("vp-transcript-paste")) $("vp-transcript-paste").value = reader.result;
        state.transcriptRaw = reader.result;
        state.parsed = parseTranscript(state.transcriptRaw);
        renderTranscript();
        persist();
      };
      reader.readAsText(file);
    });

    var vFile = $("vp-source-video");
    if (vFile) vFile.addEventListener("change", function () {
      var file = vFile.files && vFile.files[0];
      if (!file) return;
      if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
      state.videoObjectUrl = URL.createObjectURL(file);
      var vid = $("vp-video-preview");
      if (vid) { vid.src = state.videoObjectUrl; vid.style.display = "block"; }
      var reader = new FileReader();
      reader.onload = function () {
        state.videoDataUrl = reader.result;
        persist();
      };
      reader.readAsDataURL(file);
    });

    var search = $("vp-transcript-search");
    if (search) search.addEventListener("input", function () { renderTranscript(search.value); });

    var locate = $("vp-locate-statements");
    if (locate) locate.addEventListener("click", function () {
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
      persist();
      renderStatements();
      renderCommentary();
      document.querySelectorAll(".vp-step").forEach(function (b) {
        if (b.dataset.vpStep === "statements") b.classList.add("done");
      });
    });

    var addStmt = $("vp-add-statement");
    if (addStmt) addStmt.addEventListener("click", function () {
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
      persist();
      renderStatements();
      renderCommentary();
    });

    var buildSb = $("vp-build-storyboard");
    if (buildSb) buildSb.addEventListener("click", function () {
      buildStoryboard();
      document.querySelectorAll(".vp-step").forEach(function (b) {
        if (b.dataset.vpStep === "storyboard") b.classList.add("done");
      });
    });

    var renderBtn = $("vp-start-render");
    if (renderBtn) renderBtn.addEventListener("click", function () {
      var bar = $("vp-render-bar");
      var status = $("vp-render-status");
      var out = $("vp-render-out");
      if (!state.storyboard.length) buildStoryboard();
      renderBtn.disabled = true;
      if (status) status.textContent = "Rendering…";
      renderVideo(function (p) {
        if (bar) bar.style.width = Math.round(p * 100) + "%";
      }, function (blob, err) {
        renderBtn.disabled = false;
        if (err) { if (status) status.textContent = err; return; }
        if (bar) bar.style.width = "100%";
        if (status) status.textContent = "Render complete. Download or preview below.";
        if (out) {
          var url = URL.createObjectURL(blob);
          out.innerHTML = '<video controls src="' + url + '"></video><p class="vp-hint"><a href="' + url + '" download="homesignal-video.webm">Download WebM</a> — browser preview export (WebM only).</p>';
        }
        document.querySelectorAll(".vp-step").forEach(function (b) {
          if (b.dataset.vpStep === "render") b.classList.add("done");
        });
      });
    });

    var exportBtn = $("vp-export-project");
    if (exportBtn) exportBtn.addEventListener("click", function () {
      syncFromForm();
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (state.name || "homesignal-video-project") + ".json";
      a.click();
    });
  }

  var eventsWired = false;

  function ensureRenderLabel() {
    var renderBtn = $("vp-start-render");
    if (renderBtn) renderBtn.textContent = "Browser Preview Export — WebM";
  }

  function bootVideoProducer() {
    if (!$("video-producer-root")) return;
    ensureRenderLabel();
    var list = loadProjects();
    if (list.length) loadProject(list[0]);
    else startNewDraft();
    wireEvents();
    setStep("source");
  }

  window.HomeSignalVideoProducer = {
    init: function (container, payload) {
      if (!container) return;
      if (container.getAttribute("data-vp-initialized") === "1") return;
      if (!container.querySelector("#video-producer-root")) return;
      container.setAttribute("data-vp-initialized", "1");
      bootVideoProducer();
    }
  };
})();