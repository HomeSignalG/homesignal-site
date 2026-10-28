/* Jody Acquisition Dashboard: "17 · Impact Stories".
   An emotion-led, evidence-first story workflow (founder handoff v2.4, 2026-10-25). Separate from Tab 11 (Video
   Producer) and Tab 16 (YouTube Videos): it reads none of their state and changes none of their rows.

   Library -> one story workspace: Intake -> Story Outline -> Script & Shorts -> Media -> Distribution -> Results.
   STORY OUTLINE (founder, 2026-10-26): Fear, Anger and Motivation are not competing choices. Every story shows all
   three sections, each with its own records, counterevidence, evidence status and proposed narration, and an
   integrated eight-act outline that weaves them together. ONE approval, "Integrated narrative", covers the outline,
   the main script, the Quality-of-Life checklist, both Shorts and the packaging.
   Every action is one admin-gated RPC in docs/impact-stories.sql; anything slow (checking sources, AI drafting,
   checks) returns a JOB RECEIPT and this page polls the job; it never claims instant completion.

   MEDIA REVIEW (founder, 2026-10-26 "build"): Render queues ONE render job for the approved narrative; the files land
   in the PRIVATE bucket impact-media and each one (main 16:9, both 9:16 Shorts, thumbnail) is watched here through a
   blob downloaded with the admin's own session and approved or rejected on its own (gate 2), with what to fix and the moment (m:ss).
   WHAT IT NEVER DOES: publish. Every destination says "Not published" (TikTok also "Not connected").
   Every value from the database is escaped before it reaches markup. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  var POLL_MS = 8000;
  var STEPS = [
    { id: 'intake', label: 'Intake' }, { id: 'outline', label: 'Story Outline' }, { id: 'script', label: 'Script & Shorts' },
    { id: 'media', label: 'Media Review' }, { id: 'distribution', label: 'Distribution' }, { id: 'results', label: 'Results' }
  ];
  var ART = { narrative: 'Integrated narrative' };
  var SECTIONS = [
    { id: 'fear', label: 'FEAR', q: 'What could affect residents?' },
    { id: 'anger', label: 'ANGER', q: 'What deserves scrutiny?' },
    { id: 'motivation', label: 'MOTIVATION', q: 'What can residents do?' }
  ];
  var EVIDENCE = { supported: ['Supported', 'ok'], needs_qualification: ['Needs qualification', 'wait'], omitted: ['Omitted', 'bad'] };
  var THREAD = { fear: 'FEAR', anger: 'ANGER', motivation: 'MOTIVATION', context: 'Context' };
  var WPM = 150;   // narration pace used for the running-time estimate
  var STATE_LABEL = { approved: 'Approved', pending: 'Review required', checking: 'Checks running', blocked: 'Blocked',
    rejected: 'Revise requested', revoked: 'Approval revoked' };
  var STATE_CLS = { approved: 'ok', pending: 'wait', checking: 'wait', blocked: 'bad', rejected: 'bad', revoked: 'bad' };
  var LIB_FILTERS = [['all', 'All'], ['draft', 'Draft'], ['needs_review', 'Needs Review'], ['rendering', 'Rendering'],
    ['ready', 'Ready'], ['published', 'Published'], ['archived', 'Archived']];
  var JOB_LABEL = { pack: 'Check sources', analyze: 'Analyze story', generate: 'Generate story', validate: 'Evidence checks', render: 'Render' };
  var BUCKET = 'impact-media';
  var ASSET_LABEL = { main: 'Main video (16:9)', short_a: 'Short A (9:16)', short_b: 'Short B (9:16)', thumbnail: 'Thumbnail' };
  var MEDIA_LABEL = { approved: 'Approved', pending: 'Review required', blocked: 'Checks failed', rejected: 'Fix requested',
    revoked: 'Approval revoked', stale: 'From an earlier narrative' };
  var MEDIA_CLS = { approved: 'ok', pending: 'wait', blocked: 'bad', rejected: 'bad', revoked: 'bad', stale: 'bad' };
  var QOL = ['Traffic', 'Noise', 'Air', 'Water', 'Soil', 'Light'];
  // impact-story/3: the emotional discovery engine (homesignal-ingest impact/storycraft.py)
  var DIM_LABEL = { health: 'Health', wildlife: 'Wildlife & nature', homes: 'Homes & daily life', financial: 'Financial', accountability: 'Accountability' };
  var CLASS_LABEL = { verified_impact: ['Verified impact', 'ok'], documented_potential: ['Documented potential', 'wait'],
    documented_concern: ['Documented concern', 'wait'], investigative_question: ['Investigative question', 'emo'], no_evidence: ['No evidence', 'bad'] };
  var BEAT_LABEL = { attachment: 'A. Attachment', disruption: 'B. Disruption', controversy: 'C. Controversy', evidence: 'D. Evidence',
    turning_point: 'E. Turning point', action: 'F. Motivation and action' };
  var ASSET_TEXT = { registry: 'Licensed photo', illustrative: 'Illustration (labelled)', missing: 'MISSING: needs editorial review',
    record: 'Source record', card: 'Data card', map: 'Map' };

  var S = { client: null, el: null, stories: null, catalog: null, filter: 'all', q: '', open: null, data: null,
    step: null, doc: 'main', draft: null, dirty: false, msg: null, timer: null, approvedBody: {}, drawer: null, urls: {}, shown: {} };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(v) { if (!v) return ''; var d = new Date(v); return isNaN(d) ? '' : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
  function day(v) { return v ? String(v).slice(0, 10) : ''; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function errText(e) { return (e && (e.message || e.details)) || 'Something went wrong. Nothing was changed.'; }
  function rpc(name, args) {
    return S.client.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  // ── URL state: #impact=<story>&step=<step>&doc=<doc> survives reload and back/forward ─────────────────
  function readHash() {
    var h = String(location.hash || '').replace(/^#/, ''), o = {};
    if (h.indexOf('impact') !== 0) return null;
    h.split('&').forEach(function (kv) { var p = kv.split('='); o[p[0]] = decodeURIComponent(p[1] || ''); });
    return o;
  }
  function writeHash(push) {
    var h = '#impact=' + (S.open || '') + (S.open && S.step ? '&step=' + S.step : '') + (S.open && S.step === 'script' ? '&doc=' + S.doc : '');
    if (location.hash === h) return;
    if (push) history.pushState(null, '', h); else history.replaceState(null, '', h);
  }

  function css() {
    if (document.getElementById('is-css')) return;
    var st = document.createElement('style'); st.id = 'is-css';
    st.textContent = [
      '.is-wrap{max-width:1440px}',
      '.is-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.is-btn{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer}',
      '.is-btn:hover{background:var(--panel2)}.is-btn[disabled]{opacity:.5;cursor:not-allowed}',
      '.is-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}',
      '.is-btn.warn{color:#9b2c1f;border-color:#e7c3bd}',
      '.is-btn:focus-visible,.is-chip:focus-visible,.is-step:focus-visible,.is-doc:focus-visible,.is-claim:focus-visible,.is-in:focus-visible{outline:3px solid #0b5fff;outline-offset:2px}',
      '.is-chip{border:1px solid var(--line);background:var(--panel2);border-radius:20px;padding:4px 11px;font-size:12.5px;cursor:pointer;color:var(--muted)}',
      '.is-chip[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}',
      '.is-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-top:12px}',
      '.is-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;box-shadow:var(--shadow-sm)}',
      '.is-card h4{margin:0 0 4px;font-size:15px}.is-muted{color:var(--muted);font-size:12.5px}',
      '.is-badge{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:20px;border:1px solid var(--line);white-space:nowrap}',
      '.is-badge.ok{color:#14653d;border-color:#9fd4b6;background:#eef8f2}.is-badge.wait{color:#5b6660;background:#f3f5f4}',
      '.is-badge.bad{color:#9b2c1f;border-color:#e7c3bd;background:#fbf0ee}.is-badge.emo{color:#3a3f8f;border-color:#c9cbee;background:#f2f3fc}',
      '.is-next{margin-top:8px;font-size:13px}.is-next b{color:var(--accent)}',
      '.is-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start}',
      '.is-steps{display:flex;gap:4px;flex-wrap:wrap;margin:14px 0;padding:0;list-style:none}',
      '.is-step{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:7px 11px;font-size:13px;cursor:pointer;color:var(--muted)}',
      '.is-step[aria-current=step]{border-color:var(--accent);color:var(--ink);font-weight:600;box-shadow:inset 0 -3px 0 var(--accent)}',
      '.is-step .n{display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;background:var(--panel2);margin-right:6px;font-size:11px}',
      '.is-step.done .n{background:var(--real);color:#fff}.is-step.blocked .n{background:#c0392b;color:#fff}',
      '.is-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px}',
      '.is-layout.nodrawer{grid-template-columns:minmax(0,1fr)}',
      '@media(max-width:1000px){.is-layout{grid-template-columns:minmax(0,1fr)}.is-drawer{position:fixed;inset:auto 0 0 0;max-height:60vh;overflow:auto;z-index:20;border-radius:12px 12px 0 0}}',
      '.is-drawer{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;align-self:start;position:sticky;top:64px}',
      '.is-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:var(--shadow-sm)}',
      '.is-panel h3{margin:0 0 6px;font-size:15px}',
      '.is-list{margin:6px 0 0;padding-left:18px}.is-list li{margin:3px 0}',
      '.is-block{background:#fbf0ee;border:1px solid #e7c3bd;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:13px}',
      '.is-warnbox{background:#fff8ec;border:1px solid #f0d7a8;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:13px}',
      '.is-okbox{background:#eef8f2;border:1px solid #9fd4b6;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:13px}',
      '.is-docs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--line);margin-bottom:10px}',
      '.is-doc{border:0;background:none;padding:8px 10px;cursor:pointer;color:var(--muted);font-size:13px;border-bottom:3px solid transparent}',
      '.is-doc[aria-selected=true]{color:var(--ink);font-weight:600;border-bottom-color:var(--accent)}',
      '.is-line{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;margin:6px 0;padding:6px 8px;border-radius:8px;border:1px solid transparent}',
      '.is-line.changed{border-color:#f0d7a8;background:#fffbf3}',
      '.is-in{width:100%;font:inherit;font-size:13.5px;padding:6px 8px;border:1px solid var(--line);border-radius:7px;background:#fff;resize:vertical}',
      '.is-claims{display:flex;gap:4px;flex-wrap:wrap;align-items:center}',
      '.is-claim{font-size:11.5px;border:1px solid #c9cbee;background:#f2f3fc;color:#3a3f8f;border-radius:20px;padding:1px 8px;cursor:pointer}',
      '.is-claim.missing{border-color:#e7c3bd;background:#fbf0ee;color:#9b2c1f}',
      '.is-scene{border-left:3px solid var(--line);padding:4px 0 4px 10px;margin:10px 0}',
      '.is-act{margin:16px 0 4px;font-size:14px}',
      '.is-tab{border-collapse:collapse;width:100%;font-size:13px}.is-tab td,.is-tab th{border-bottom:1px solid var(--line);padding:6px;text-align:left;vertical-align:top}',
      '.is-angle{border:1px solid var(--line);border-radius:12px;padding:12px;margin:10px 0}',
      '.is-sec{border:1px solid var(--line);border-radius:12px;padding:12px;margin:10px 0}',
      '.is-sec.omitted{background:var(--panel2)}',
      '.is-sec h4{margin:0;font-size:14.5px}.is-q{color:var(--muted);font-size:13px;margin-left:6px}',
      '.is-thr{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:20px;margin-right:4px;border:1px solid var(--line)}',
      '.is-thr.fear{color:#7a3d00;border-color:#efcf9f;background:#fff6e8}.is-thr.anger{color:#9b2c1f;border-color:#e7c3bd;background:#fbf0ee}',
      '.is-thr.motivation{color:#14653d;border-color:#9fd4b6;background:#eef8f2}.is-thr.context{color:#5b6660;background:#f3f5f4}',
      '.is-angle.sel{border-color:var(--accent);box-shadow:0 0 0 2px rgba(21,122,73,.15)}.is-angle.rej{opacity:.6}',
      '.is-dec{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:10px 0;padding:10px;border-radius:10px;background:var(--panel2)}',
      '.is-pre{white-space:pre-wrap;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px;font-size:12.5px;margin:6px 0}',
      '.is-status{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel)}',
      '.is-sr{position:absolute;left:-9999px}',
      '.ie-orig{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:8px 0;background:var(--panel2);font-size:13px;overflow-wrap:anywhere}',
      '.ie-prev{border:1px dashed var(--line);border-radius:12px;padding:10px;margin:8px 0;font-size:13.5px}.ie-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}',
      '.ie-draft{min-height:84px}',
      '.is-concepts{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin:10px 0}',
      '.is-concept{border:1px solid var(--line);border-radius:12px;padding:12px}.is-concept.sel{border-color:var(--accent);box-shadow:0 0 0 2px rgba(21,122,73,.15)}',
      '.is-score{font-size:22px;font-weight:700}.is-gate td:last-child{white-space:nowrap}',
      '@media(max-width:600px){.is-steps{flex-wrap:nowrap;overflow-x:auto}.is-step{flex:0 0 auto}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function badge(state) { return '<span class="is-badge ' + (STATE_CLS[state] || 'wait') + '">' + esc(STATE_LABEL[state] || state) + '</span>'; }
  // A story prepared from a Bluesky-discovered topic (docs/impact-discovery.sql). It is "Ready for Review" once its script
  // exists; before that the discovery tick is still running Check Sources, Analyze and Generate.
  function autoLabel(st) {
    return ['script', 'media', 'distribution', 'ready'].indexOf(st && st.stage) >= 0 ? 'Auto-discovered — Ready for Review' : 'Auto-discovered — Preparing';
  }
  function libLabel(st) {
    return { draft: 'Draft', needs_review: 'Needs Review', ready: 'Ready to render', archived: 'Archived', rendering: 'Rendering', published: 'Published' }[st] || st;
  }

  // ── LIBRARY ──────────────────────────────────────────────────────────────────────────────────────────
  function loadLibrary() {
    S.el.innerHTML = '<div class="card is-wrap"><p class="is-muted">Loading Impact Stories…</p></div>';
    return Promise.all([rpc('hs_impact_story_list'), rpc('hs_impact_story_catalog')]).then(function (r) {
      S.stories = r[0] || []; S.catalog = r[1] || [];
      renderLibrary();
    }, function (e) {
      S.el.innerHTML = '<div class="card is-wrap"><h3>Impact Stories could not load</h3><p class="is-muted">' + esc(errText(e)) +
        '</p><button class="is-btn" data-act="reload">Try again</button></div>';
    });
  }

  function renderLibrary() {
    var q = S.q.toLowerCase();
    var list = (S.stories || []).filter(function (s) {
      var lib = s.status && s.status.library;
      if (S.filter === 'all' ? lib === 'archived' : lib !== S.filter) return false;
      return !q || (s.title + ' ' + (s.place || '') + ' ' + s.video_slug).toLowerCase().indexOf(q) >= 0;
    });
    var cards = list.map(function (s) {
      var st = s.status || {};
      var job = st.job && (st.job.status === 'queued' || st.job.status === 'running');
      return '<article class="is-card" aria-label="' + esc(s.title) + '"><h4>' + esc(s.title) + '</h4>' +
        '<div class="is-row"><span class="is-badge ' + (st.library === 'ready' ? 'ok' : 'wait') + '">' + esc(libLabel(st.library)) + '</span>' +
        (s.origin === 'auto_discovery' ? '<span class="is-badge emo">' + esc(autoLabel(st)) + '</span>' : '') +
        (s.primary_emotion ? '<span class="is-badge emo">' + esc(s.primary_emotion) + '</span>' : '') +
        (st.fresh === false && s.verified_at ? '<span class="is-badge bad">Sources out of date</span>' : '') + '</div>' +
        '<div class="is-muted" style="margin-top:6px">' + esc(s.place || s.video_slug) + ' · updated ' + esc(fmt(s.updated_at)) +
        (s.verified_at ? ' · sources checked ' + esc(day(s.verified_at)) : '') + '</div>' +
        '<div class="is-next">Next: <b>' + esc(st.next || '') + '</b>' + (job ? ' <span class="is-badge wait">Running</span>' : '') + '</div>' +
        '<div class="is-row" style="margin-top:10px"><button class="is-btn primary" data-act="open" data-id="' + esc(s.id) + '">Open</button>' +
        '<button class="is-btn" data-act="dup" data-id="' + esc(s.id) + '">Duplicate as new story</button>' +
        (s.archived ? '<button class="is-btn" data-act="restore" data-id="' + esc(s.id) + '">Restore</button>'
                    : '<button class="is-btn warn" data-act="archive" data-id="' + esc(s.id) + '">Archive</button>') + '</div></article>';
    }).join('');
    var opts = (S.catalog || []).map(function (c) { return '<option value="' + esc(c.slug) + '">' + esc(c.title) + '</option>'; }).join('');
    S.el.innerHTML = '<div class="is-wrap">' +
      '<div class="card"><div class="is-head"><div><h3>17 · Impact Stories</h3><p class="sub">Emotion-led investigations written only from verified public records. One main investigation, up to two distinct Shorts, platform copy for YouTube, TikTok and Bluesky. Nothing here publishes.</p></div>' +
      '<button class="is-btn primary" data-act="new">New story</button></div>' +
      '<div id="is-new" hidden><div class="is-panel" style="margin-top:10px"><h3>New story</h3>' +
      '<label class="is-muted" for="is-new-slug">Verified project (its source pack is read; nothing is copied)</label>' +
      '<select id="is-new-slug" class="is-in">' + opts + '</select>' +
      '<label class="is-muted" for="is-new-title" style="display:block;margin-top:8px">Story title (optional)</label>' +
      '<input id="is-new-title" class="is-in" maxlength="200" placeholder="Defaults to the project title">' +
      '<div class="is-row" style="margin-top:10px"><button class="is-btn primary" data-act="create">Create and check sources</button><button class="is-btn" data-act="cancel-new">Cancel</button></div>' +
      (opts ? '' : '<div class="is-warnbox">No verified projects are available yet.</div>') + '</div></div>' +
      (S.msg ? '<div class="' + (S.msg.bad ? 'is-block' : 'is-okbox') + '" role="status">' + esc(S.msg.text) + '</div>' : '') +
      '<div class="is-row" style="margin-top:10px"><label class="is-sr" for="is-q">Search stories</label><input id="is-q" class="is-in" style="max-width:320px" placeholder="Search stories" value="' + esc(S.q) + '">' +
      LIB_FILTERS.map(function (f) { return '<button class="is-chip" data-act="filter" data-f="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + esc(f[1]) + '</button>'; }).join('') +
      '</div></div>' +
      '<div id="is-hot" style="margin-top:12px"></div>' +
      '<div id="is-engage" style="margin-top:12px"></div>' +
      (cards ? '<div class="is-cards">' + cards + '</div>' : '<div class="card"><p class="is-muted">' +
        ((S.stories || []).length ? 'No stories match this filter.' : 'No Impact Stories yet. Press New story and choose a verified project.') + '</p>' +
        (S.filter === 'rendering' || S.filter === 'published' ? '<p class="is-muted">Rendering and publishing for Impact Stories are not built yet, so this list is empty by design.</p>' : '') + '</div>') +
      '</div>';
    S.msg = null;
    var hot = S.el.querySelector('#is-hot');
    if (hot && HS.acqImpactDiscovery) HS.acqImpactDiscovery.attach(S.client, hot, function (id) { return openStory(id, null, true); });
    // Engage on Bluesky: its own section and its own data; it shares a discovered topic with Hot Topics, never a story
    var eng = S.el.querySelector('#is-engage');
    if (eng && HS.acqImpactEngagement) HS.acqImpactEngagement.attach(S.client, eng);
  }

  // ── WORKSPACE ────────────────────────────────────────────────────────────────────────────────────────
  function openStory(id, step, push) {
    if (S.dirty && S.open !== id && !confirm('You have unsaved changes. Leave without saving?')) return;
    S.open = id; S.step = knownStep(step); S.dirty = false; S.draft = null; S.drawer = null; S.approvedBody = {};
    return refresh(true).then(function () { writeHash(push); });
  }

  function refresh(resetDraft) {
    return rpc('hs_impact_story_get', { p_story: S.open }).then(function (d) {
      var prevVer = S.data && S.data.version && S.data.version.version;
      S.data = d;
      var ver = d.version && d.version.version;
      if (resetDraft || !S.dirty) S.draft = clone(d.version && d.version.body) || {};
      else if (ver !== prevVer) S.msg = { bad: true, text: 'A newer version (' + ver + ') was saved or generated while you were editing. Your edits are still here; saving them will be refused until you reload.' };
      if (!S.step) S.step = defaultStep(d.status);
      return loadApproved().then(renderWorkspace);
    }).then(null, function (e) {
      // also catches an error while drawing the workspace, so the tab never stays blank
      S.el.innerHTML = '<div class="card is-wrap"><h3>This story could not load</h3><p class="is-muted">' + esc(errText(e)) +
        '</p><button class="is-btn" data-act="back">Back to library</button></div>';
    }).then(schedulePoll);
  }

  // The approved text of each artifact, for "changed since approved" marks and the diff.
  function loadApproved() {
    var need = {};
    var st = (S.data.status && S.data.status.artifacts) || {};
    Object.keys(st).forEach(function (k) { var ld = st[k].last_decision; if (ld && ld.decision === 'approved') need[ld.version] = 1; });
    var vs = Object.keys(need).filter(function (v) { return !S.approvedBody[v]; });
    return Promise.all(vs.map(function (v) {
      return rpc('hs_impact_story_version', { p_story: S.open, p_version: Number(v) }).then(function (r) { S.approvedBody[v] = r.body; }, function () {});
    }));
  }

  // A step from an old link (the first build's 'angles') or a typo falls back to the story's default step. The first
  // build's Emotional Angles step became Story Outline, so its links open there.
  function knownStep(step) {
    if (step === 'angles') return 'outline';
    return STEPS.some(function (x) { return x.id === step; }) ? step : null;
  }

  function defaultStep(st) {
    return { intake: 'intake', sources_needed: 'intake', outline: 'outline', script: 'script', media: 'media', distribution: 'distribution', archived: 'intake' }[st && st.stage] || 'intake';
  }

  function schedulePoll() {
    clearTimeout(S.timer);
    var j = S.data && S.data.status && S.data.status.job;
    if (S.open && j && (j.status === 'queued' || j.status === 'running') && S.el && document.body.contains(S.el)) {
      S.timer = setTimeout(function () { if (S.open) refresh(false); }, POLL_MS);
    }
  }

  function stepState(id) {
    var st = S.data.status, a = st.artifacts || {};
    if (id === 'intake') return S.data.pack ? (st.stage === 'sources_needed' ? 'blocked' : 'done') : '';
    var n = a.narrative, val = S.data.version && S.data.version.validation;
    if (id === 'outline') {
      if (!(S.draft && S.draft.arc)) return '';
      if (val && val.arc && SECTIONS.some(function (x) { return val.arc[x.id] && val.arc[x.id].ok === false; })) return 'blocked';
      return S.draft.main ? 'done' : '';
    }
    if (id === 'script') return n && n.state === 'approved' ? 'done' : '';
    var m = S.data.media || {};
    if (id === 'media') return m.complete ? 'done' : (m.blocked || (m.files || []).some(function (f) { return f.state === 'blocked' || f.state === 'rejected'; }) ? 'blocked' : '');
    return '';
  }

  function renderWorkspace() {
    var d = S.data, s = d.story, st = d.status, p = d.pack || {};
    var job = st.job;
    var running = job && (job.status === 'queued' || job.status === 'running');
    var header = '<div class="is-head"><div><button class="is-btn" data-act="back">← Library</button>' +
      '<h3 style="margin:10px 0 2px">' + esc(s.title) + '</h3><div class="is-muted">' + esc(s.place || p.title || s.video_slug) +
      ' · ' + (p.verified_at ? 'sources checked ' + esc(day(p.verified_at)) + (st.fresh ? '' : ' <span class="is-badge bad">out of date</span>') : 'sources not checked yet') +
      ' · version ' + esc(s.current_version) + ' · ' + (S.dirty ? '<span class="is-badge bad">Unsaved changes</span>' : '<span class="is-badge ok">Saved</span>') + '</div></div>' +
      '<div class="is-row">' + primaryAction(st, running) + '</div></div>';
    var jobBar = job ? '<div class="is-status" role="status" aria-live="polite"><b>' + esc(JOB_LABEL[job.kind] || job.kind) + ':</b> ' + jobText(job) +
      (job.status === 'failed' || job.stuck ? ' <button class="is-btn" data-act="retry" data-id="' + esc(job.id) + '">Retry</button>' : '') + '</div>' : '';
    var steps = '<ol class="is-steps" aria-label="Story steps">' + STEPS.map(function (x, i) {
      var cls = stepState(x.id);
      return '<li><button class="is-step ' + cls + '" data-act="step" data-step="' + x.id + '"' + (S.step === x.id ? ' aria-current="step"' : '') + '><span class="n">' + (cls === 'done' ? '✓' : (i + 1)) + '</span>' + esc(x.label) + '</button></li>';
    }).join('') + '</ol>';
    var body = { intake: viewIntake, outline: viewOutline, script: viewScript, media: viewMedia, distribution: viewDistribution, results: viewResults }[S.step]();
    var drawer = S.drawer ? viewDrawer() : '';
    S.el.innerHTML = '<div class="is-wrap"><div class="card">' + header + steps + jobBar +
      (S.msg ? '<div class="' + (S.msg.bad ? 'is-block' : 'is-okbox') + '" role="status">' + esc(S.msg.text) + '</div>' : '') + '</div>' +
      '<div class="is-layout' + (drawer ? '' : ' nodrawer') + '"><div>' + body + '</div>' + drawer + '</div>' + viewHistory() + '</div>';
    S.msg = null;
  }

  function jobText(j) {
    var lim = j.kind === 'render' ? '5 hours 45 minutes' : '40 minutes';
    if (j.status === 'queued' && j.not_started) return '<span style="color:#9b2c1f">' + esc(j.error || 'The job did not start.') + '</span>';
    if (j.status === 'queued') return j.stuck ? 'Queued for over ' + lim + '. The worker may not have started.' : 'Queued. The worker starts within a minute or two.';
    if (j.status === 'running') return j.stuck ? 'Running for over ' + lim + '; it may have stopped.' : 'Running since ' + esc(fmt(j.started_at)) + (j.kind === 'render' ? '. A render takes about 1 to 3 hours.' : '.');
    if (j.status === 'failed') return '<span style="color:#9b2c1f">Failed (attempt ' + esc(j.attempts) + '): ' + esc(j.error || 'no reason recorded') + '</span>';
    if (j.status === 'superseded') return 'Finished, but you saved a newer version while it ran, so its result was not applied.';
    return 'Complete ' + esc(fmt(j.completed_at)) + '.';
  }

  function primaryAction(st, running) {
    if (running) return '<button class="is-btn primary" disabled>' + esc(st.next) + '</button>';
    if (S.dirty) return '<button class="is-btn primary" data-act="save">Save changes</button>';
    var s = st.stage;
    if (s === 'archived') return '<button class="is-btn primary" data-act="restore" data-id="' + esc(S.open) + '">Restore</button>';
    if (s === 'intake' || s === 'sources_needed') return '<button class="is-btn primary" data-act="req" data-kind="pack">' + esc(st.next === 'Sources needed' ? 'Re-check sources' : st.next) + '</button>';
    if (s === 'outline' && !S.draft.arc) return '<button class="is-btn primary" data-act="req" data-kind="analyze"' + (S.draft.angles ? ' data-new="1"' : '') + '>' + esc(S.draft.angles ? 'Analyze again' : 'Analyze story') + '</button>';
    if (s === 'outline') return '<button class="is-btn primary" data-act="req" data-kind="generate">Generate story</button>';
    if (s === 'script') return '<button class="is-btn primary" data-act="step" data-step="script">Review and approve the integrated narrative</button>';
    if (s === 'media' && !(S.data.media && S.data.media.current)) return '<button class="is-btn primary" data-act="render">Render the videos</button>';
    if (s === 'media') return '<button class="is-btn primary" data-act="step" data-step="media">Review each video and the thumbnail</button>';
    return '<button class="is-btn primary" data-act="step" data-step="distribution">Ready to export — see Distribution</button>';
  }

  function viewIntake() {
    var p = S.data.pack;
    if (!p) return '<div class="is-panel"><h3>Story intake</h3><p class="is-muted">The source pack for <b>' + esc(S.data.story.video_slug) + '</b> has not been checked yet. Check sources reads the verified Public Records project: its documents, its word-for-word claims, and when it was fetched.</p></div>';
    var claims = p.claims || [];
    var by = {}; claims.forEach(function (c) { by[c.status] = (by[c.status] || 0) + 1; });
    return '<div class="is-panel"><h3>Story intake</h3>' +
      '<p><b>' + esc(p.title) + '</b>' + (p.record_id ? ' · record ' + esc(p.record_id) : '') + '</p>' +
      '<p class="is-muted">Sources fetched ' + esc(fmt(p.verified_at)) + ' (' + esc(p.age_days) + ' days before the last check; limit ' + esc(p.fresh_days) + ').' +
      ' Claims: ' + claims.length + ' (' + Object.keys(by).map(function (k) { return esc(k) + ' ' + by[k]; }).join(', ') + ').</p>' +
      (claims.length ? '' : '<div class="is-block">Sources needed: this pack has no verified claims to write from.</div>') +
      (S.data.status.fresh ? '' : '<div class="is-block">The sources are out of date. Re-check sources before anything can be approved.</div>') +
      '<h3 style="margin-top:14px">Documents</h3><ul class="is-list">' + (p.sources || []).map(function (s) {
        return '<li>' + esc(s.label) + (s.url ? ' — <a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">open record</a>' : ' <span class="is-badge bad">no public link</span>') + '</li>';
      }).join('') + '</ul>' +
      ((p.conflicts || []).length ? '<h3 style="margin-top:14px">Documents that disagree</h3>' + p.conflicts.map(function (c) {
        return '<div class="is-warnbox">' + c.claims.map(claimChip).join(' ') + ' — ' + esc(c.reason) + '</div>'; }).join('') : '') +
      ((p.warnings || []).length ? '<h3 style="margin-top:14px">Missing or unreviewed records</h3><ul class="is-list">' + p.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') +
      ((p.editor_notes || []).length ? '<h3 style="margin-top:14px">Editor notes carried from the record</h3><ul class="is-list">' + p.editor_notes.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="is-row" style="margin-top:12px"><button class="is-btn" data-act="req" data-kind="pack">Re-check sources</button></div></div>';
  }

  function claimChip(id) {
    var c = claimById(id);
    return '<button class="is-claim' + (c ? '' : ' missing') + '" data-act="claim" data-id="' + esc(id) + '" title="' + esc(c ? c.status + ': ' + (c.quote || c.text) : 'Not in the source pack') + '">' + esc(id) + '</button>';
  }
  function claimById(id) { return ((S.data.pack && S.data.pack.claims) || []).filter(function (c) { return c.id === id; })[0]; }
  function chips(ids) { return '<span class="is-claims">' + (ids || []).map(claimChip).join('') + '</span>'; }

  function checks(artifact, extra) {
    var v = S.data.version && S.data.version.validation, r = extra || (v && v[artifact]);
    if (!S.data.version || !S.data.version.checked) return '<div class="is-warnbox">Checks have not run on this version yet' + (S.dirty ? ' (save to run them)' : '') + '.</div>';
    if (!r) return '';
    return (r.blocking || []).map(function (b) { return '<div class="is-block">' + esc(b) + '</div>'; }).join('') +
      (r.warnings || []).map(function (w) { return '<div class="is-warnbox">' + esc(w) + '</div>'; }).join('') +
      (r.ok && !(r.warnings || []).length ? '<div class="is-okbox">All evidence checks pass.</div>' : '');
  }

  function decisionBar(artifact) {
    var a = (S.data.status.artifacts || {})[artifact] || { state: 'pending' };
    var ld = a.last_decision;
    return '<div class="is-dec" aria-label="Decision for ' + esc(ART[artifact]) + '"><b>' + esc(ART[artifact]) + '</b> ' + badge(a.state) +
      '<span class="is-muted">' + esc(a.why || '') + (ld ? ' Last: ' + esc(ld.decision) + ' by ' + esc(ld.actor) + ' ' + esc(fmt(ld.at)) : '') + '</span>' +
      '<span style="flex:1"></span>' +
      (a.state === 'approved'
        ? '<button class="is-btn warn" data-act="decide" data-a="' + artifact + '" data-d="revoked">Revoke approval</button>'
        : '<button class="is-btn primary" data-act="decide" data-a="' + artifact + '" data-d="approved"' + (S.dirty || a.state === 'blocked' || a.state === 'checking' ? ' disabled' : '') + '>Approve</button>' +
          '<button class="is-btn" data-act="decide" data-a="' + artifact + '" data-d="rejected"' + (S.dirty ? ' disabled' : '') + '>Request revision</button>') +
      (ld && ld.decision === 'approved' && a.state !== 'approved' ? '<button class="is-btn" data-act="diff" data-a="' + artifact + '" data-v="' + esc(ld.version) + '">Compare with approved version ' + esc(ld.version) + '</button>' : '') +
      '</div>';
  }

  function words(t) { return String(t || '').split(/\s+/).filter(Boolean).length; }
  function secs(n) { n = Math.round(n); return Math.floor(n / 60) + ':' + ('0' + (n % 60)).slice(-2); }
  function threadBadge(t) { return '<span class="is-thr ' + esc(t) + '">' + esc(THREAD[t] || t) + '</span>'; }
  function revisions(section) {
    return (S.data.events || []).filter(function (e) { return e.kind === 'section_revision' && e.detail && e.detail.section === section; });
  }
  function revisionNotes(section) {
    var r = revisions(section);
    if (!r.length) return '';
    return '<div class="is-warnbox"><b>Your revision notes</b> (a Claude Code session rewrites the draft from these; then press Analyze again):<ul class="is-list">' +
      r.slice(0, 5).map(function (e) { return '<li>' + esc(e.detail.note) + ' <span class="is-muted">on version ' + esc(e.detail.version) + ', ' + esc(fmt(e.at)) + '</span></li>'; }).join('') + '</ul></div>';
  }
  function reviseButton(section, label) {
    return '<button class="is-btn" data-act="revise" data-sec="' + esc(section) + '"' + (S.dirty ? ' disabled' : '') + '>Request revision' + (label ? ' of ' + esc(label) : '') + '</button>';
  }

  // impact-story/3: what residents could lose, the three concepts and their scores, the quality gate
  function line(l) { return l ? esc(l.text) + ' ' + chips(l.claims) : ''; }
  function viewDiscovery(b, v) {
    var d = b.discovery || {}, r = (v && v.v3) || {}, scores = r.scores || {}, sel = (b.selection || {}).concept;
    var finds = (d.findings || []).map(function (f) {
      var c = CLASS_LABEL[f.classification] || [f.classification, 'wait'];
      return '<tr><td>' + esc(DIM_LABEL[f.dimension] || f.dimension) + '</td><td><span class="is-badge ' + c[1] + '">' + esc(c[0]) + '</span></td><td>' + line(f.finding) +
        (f.affected ? '<div class="is-muted">Who: ' + esc(f.affected) + (f.could_lose ? ' · Could lose: ' + esc(f.could_lose) : '') + '</div>' : '') + '</td></tr>';
    }).join('');
    var part = d.participation || {};
    var concepts = (b.concepts || []).map(function (c) {
      var sc = scores[c.id] || {}, parts = sc.parts || {}, on = c.id === sel;
      var arc = c.arc || {};
      return '<div class="is-concept' + (on ? ' sel' : '') + '"><div class="is-row"><b>' + esc(c.title) + '</b><span style="flex:1"></span>' +
        (on ? '<span class="is-badge ok">Selected</span>' : '') + '</div>' +
        '<div class="is-muted">' + esc(c.role) + ' · ' + esc(c.trigger) + ' · confidence ' + esc(c.confidence) + '</div>' +
        '<div class="is-row"><span class="is-score">' + esc(sc.total == null ? '–' : sc.total) + '</span><span class="is-muted">/ 100 · ' +
        Object.keys(parts).map(function (k) { return esc(k) + ' ' + esc(parts[k]); }).join(', ') + '</span></div>' +
        '<p style="margin:6px 0"><b>Opening:</b> ' + line(c.opening) + '</p>' +
        '<p style="margin:6px 0"><b>Stakes:</b> ' + line(c.stakes) + '</p>' +
        '<p style="margin:6px 0"><b>Conflict:</b> ' + line(c.conflict) + '</p>' +
        (c.fallback_reason ? '<div class="is-warnbox">Told as curiosity: ' + esc(c.fallback_reason) + '</div>' : '') +
        '<ol class="is-list">' + Object.keys(BEAT_LABEL).map(function (k) { return arc[k] ? '<li><b>' + esc(BEAT_LABEL[k]) + ':</b> ' + line(arc[k]) + '</li>' : ''; }).join('') + '</ol>' +
        '<div class="is-muted">' + esc(c.fit) + '</div>' +
        (on ? '' : '<div class="is-row" style="margin-top:6px"><button class="is-btn" data-act="concept" data-id="' + esc(c.id) + '"' + (S.dirty ? ' disabled' : '') + '>Lead with this concept instead</button></div>') +
        '</div>';
    }).join('');
    var q = r.quality || {}, crit = q.criteria || {};
    var gate = Object.keys(crit).map(function (k) {
      return '<tr><td>' + esc(k) + '</td><td><span class="is-badge ' + (crit[k] === 2 ? 'ok' : crit[k] === 1 ? 'wait' : 'bad') + '">' + esc(crit[k]) + ' / 2</span></td></tr>';
    }).join('');
    var miss = r.missing_assets || [];
    return '<h3>What residents could lose</h3><p class="is-muted">Emotional discovery across health, wildlife, homes, money and accountability. Each finding says how strong its evidence is; a possible consequence is never told as a fact, and no controversy is invented where the records show none.</p>' +
      '<table class="is-tab"><thead><tr><th>Area</th><th>Evidence</th><th>Finding</th></tr></thead><tbody>' + finds + '</tbody></table>' +
      '<p><b>The conflict:</b> ' + line(d.conflict) + '</p>' +
      '<p><b>Protections on the record:</b></p><ul class="is-list">' + (d.protections || []).map(function (l) { return '<li>' + line(l) + '</li>'; }).join('') + '</ul>' +
      '<p><b>Can residents still take part?</b> <span class="is-badge ' + (part.open ? 'ok' : 'wait') + '">' + (part.open ? 'Open' : 'Closed') + '</span> ' + line(part) + '</p>' +
      (d.approach ? '<p class="is-muted"><b>Approach:</b> ' + esc(d.approach.trigger) + '. ' + esc(d.approach.why) + '</p>' : '') +
      revisionNotes('discovery') + '<div class="is-row">' + reviseButton('discovery', 'the discovery') + '</div>' +
      '<h3 style="margin-top:16px">Three story concepts</h3><p class="is-muted">Concern, accountability and empowerment, each scored on evidence integrity, backing, visual power, conflict clarity, agency and confidence. The selected concept must be the strongest, or say why not.</p>' +
      '<div class="is-concepts">' + concepts + '</div>' +
      (b.selection ? '<p><b>Why this one:</b> ' + esc(b.selection.why) + (b.selection.override ? ' <span class="is-badge wait">Override: ' + esc(b.selection.override) + '</span>' : '') + '</p>' : '') +
      revisionNotes('concepts') +
      '<h3 style="margin-top:16px">Quality gate</h3>' +
      (gate ? '<table class="is-tab is-gate"><tbody>' + gate + '<tr><td><b>Total</b></td><td><b>' + esc(q.total) + ' / ' + esc(q.max) + '</b></td></tr></tbody></table>' : '<p class="is-muted">Runs with the evidence checks.</p>') +
      (q.reject || []).map(function (x) { return '<div class="is-block">Rejected: ' + esc(x) + '</div>'; }).join('') +
      (miss.length ? '<div class="is-warnbox"><b>' + miss.length + ' picture(s) need an editorial decision</b> (no licensed photo yet; shown as a labelled illustration until one is found).</div>' : '');
  }

  function viewOutline() {
    var b = S.draft, v = S.data.version && S.data.version.validation;
    if (!b.arc) {
      return '<div class="is-panel"><h3>Story outline</h3>' +
        (b.angles ? '<div class="is-warnbox">This story was written before the integrated outline, when one angle was chosen. Press Analyze again to get the story outline; the earlier version is kept.</div>' : '') +
        '<p class="is-muted">Analyze story reads the source pack and weighs three questions, separately: <b>FEAR</b> (what could affect residents?), <b>ANGER</b> (what deserves scrutiny?) and <b>MOTIVATION</b> (what can residents do?). Each gets its own records, counterevidence and evidence status. The supportable parts are then woven into one eight-act story. Nothing is invented to fill a section; a weak one is told with its limit, or omitted with the reason.</p>' +
        '<button class="is-btn primary" data-act="req" data-kind="analyze"' + (b.angles ? ' data-new="1"' : '') + (S.data.status.fresh ? '' : ' disabled') + '>' + (b.angles ? 'Analyze again' : 'Analyze story') + '</button></div>';
    }
    var v3 = b.discovery ? viewDiscovery(b, v) : '';
    var cards = SECTIONS.map(function (x) {
      var sec = b.arc[x.id] || {}, r = v && v.arc && v.arc[x.id], ev = EVIDENCE[sec.status] || [sec.status || 'No status', 'bad'];
      var head = '<div class="is-row"><h4>' + esc(x.label) + '</h4><span class="is-q">' + esc(x.q) + '</span><span style="flex:1"></span>' +
        '<span class="is-badge ' + ev[1] + '">' + esc(ev[0]) + '</span>' +
        (r ? (r.ok ? '<span class="is-badge ok">Evidence checks pass</span>' : '<span class="is-badge bad">Fails evidence checks</span>') : '') + '</div>' +
        '<p class="is-muted" style="margin:6px 0">' + esc(sec.reason) + ' ' + chips(sec.reason_claims) + '</p>';
      if (sec.status === 'omitted') {
        return '<section class="is-sec omitted" aria-label="' + esc(x.label) + '">' + head +
          '<p class="is-muted">Left out of the script: the records do not support it. Nothing was written for this section.</p>' +
          (r ? checks(null, r) : '') + revisionNotes(x.id) + '<div class="is-row">' + reviseButton(x.id, x.label) + '</div></section>';
      }
      var narr = sec.narration || [];
      return '<section class="is-sec" aria-label="' + esc(x.label) + '">' + head +
        '<table class="is-tab"><tbody>' +
        '<tr><th>Proposed hook or story beat</th><td>' + esc(sec.beat && sec.beat.text) + ' ' + chips(sec.beat && sec.beat.claims) + '</td></tr>' +
        '<tr><th>Supporting source records</th><td>' + chips(sec.supporting) + '</td></tr>' +
        '<tr><th>Counterevidence and mitigating facts</th><td>' + chips(sec.counter) + '</td></tr>' +
        '<tr><th>What remains unknown</th><td>' + esc((sec.unknowns || []).join('; ') || 'None listed') + '</td></tr>' +
        (sec.qualifier ? '<tr><th>Its limit, spoken out loud</th><td>' + esc(sec.qualifier.text) + ' ' + chips(sec.qualifier.claims) + '</td></tr>' : '') +
        '<tr><th>Proposed narration</th><td><ol class="is-list">' + narr.map(function (n) {
          return '<li><span class="is-muted">Act ' + esc(n.act) + ':</span> ' + esc(n.text) + ' ' + chips(n.claims) + '</li>'; }).join('') +
        '</ol><span class="is-muted">' + narr.length + ' lines · about ' + esc(secs(words(narr.map(function (n) { return n.text; }).join(' ')) / WPM * 60)) + '</span></td></tr>' +
        '</tbody></table>' + (r ? checks(null, r) : '') + revisionNotes(x.id) +
        '<div class="is-row" style="margin-top:8px">' + reviseButton(x.id, x.label) + '</div></section>';
    }).join('');
    // running time per act: from the script once written, else from the sections' proposed narration
    var acts = {}, total = 0;
    ((b.main && b.main.acts) || []).forEach(function (a) {
      acts[a.act] = words((a.scenes || []).map(function (sc) { return (sc.narration || []).map(function (n) { return n.text; }).join(' '); }).join(' '));
    });
    if (!b.main) SECTIONS.forEach(function (x) { ((b.arc[x.id] || {}).narration || []).forEach(function (n) { acts[n.act] = (acts[n.act] || 0) + words(n.text); }); });
    var rows = (b.outline || []).map(function (o) {
      var t = (acts[o.act] || 0) / WPM * 60; total += t;
      return '<tr><td>' + esc(o.act) + ' · ' + esc(o.name) + (o.beat ? '<div class="is-muted">' + esc(BEAT_LABEL[o.beat] || o.beat) + '</div>' : '') + '</td><td>' + (o.threads || []).map(threadBadge).join('') + '</td><td>' + esc(o.summary) + '</td><td>' + esc(secs(t)) + '</td></tr>';
    }).join('');
    var ov = v && v.outline;
    return '<div class="is-panel"><h3>Story outline</h3>' + (b.suitability ? '<p class="is-muted">' + esc(b.suitability) + '</p>' : '') +
      v3 +
      '<h3 style="margin-top:16px">FEAR, ANGER and MOTIVATION</h3><p class="is-muted">All three sections are evaluated on every story. Supported: the records state it. Needs qualification: the records raise it but do not settle it, so it is told with its limit out loud. Omitted: the records do not support it.</p>' +
      cards +
      '<h3 style="margin-top:16px">Integrated outline</h3><p class="is-muted">One story, not three. Each act carries the threads shown; running time is estimated at ' + WPM + ' words a minute' + (b.main ? ' from the script' : ' from the proposed narration') + '.</p>' +
      '<table class="is-tab"><thead><tr><th>Act</th><th>Threads</th><th>What happens</th><th>Time</th></tr></thead><tbody>' + rows +
      '<tr><td colspan="3"><b>Total</b></td><td><b>' + esc(secs(total)) + '</b></td></tr></tbody></table>' +
      (ov ? checks(null, ov) : '') + revisionNotes('outline') +
      '<div class="is-row" style="margin-top:8px">' + reviseButton('outline', 'the outline') +
      (b.main ? '<button class="is-btn" data-act="step" data-step="script">Review the script and approve</button>'
              : '<button class="is-btn primary" data-act="req" data-kind="generate">Generate story</button>') +
      '<button class="is-btn" data-act="req" data-kind="analyze" data-new="1">Analyze again (new version)</button></div></div>';
  }

  // ── script editor ───────────────────────────────────────────────────────────────────────────────────
  function get(o, path) { return path.split('.').reduce(function (x, k) { return x == null ? x : x[k]; }, o); }
  function setPath(o, path, val) {
    var ks = path.split('.'), last = ks.pop();
    var t = ks.reduce(function (x, k) { if (x[k] == null) x[k] = /^\d+$/.test(k) ? [] : {}; return x[k]; }, o);
    t[last] = val;
  }
  function changed(path) {   // one approval covers the whole narrative
    var a = (S.data.status.artifacts || {}).narrative, ld = a && a.last_decision;
    if (!ld || ld.decision !== 'approved') return false;
    var ab = S.approvedBody[ld.version];
    return ab && JSON.stringify(get(ab, path)) !== JSON.stringify(get(S.draft, path));
  }
  function lineEditor(path, artifact, label) {
    var l = get(S.draft, path) || {};
    return '<div class="is-line' + (changed(path) ? ' changed' : '') + '"><label class="is-muted" for="ed-' + esc(path) + '">' + esc(label) + (changed(path) ? ' · changed since approved' : '') + '</label>' +
      '<textarea class="is-in" rows="2" id="ed-' + esc(path) + '" data-ed="' + esc(path) + '.text">' + esc(l.text) + '</textarea>' +
      '<div class="is-claims">' + chips(l.claims) + '<label class="is-sr" for="cl-' + esc(path) + '">Claim ids</label><input class="is-in" style="max-width:260px;font-size:12px" id="cl-' + esc(path) + '" data-cl="' + esc(path) + '.claims" value="' + esc((l.claims || []).join(', ')) + '" aria-label="Claim ids for ' + esc(label) + '"></div></div>';
  }
  function visualNote(v) {
    v = v || {};
    if (v.asset) {   // impact-story/3: the planned picture
      var at = v.asset, src = ASSET_TEXT[at.status] || at.status;
      if (at.status === 'registry') src += ' `' + at.id + '`' + (v.kind === 'representative_image' ? ' (representative, not this site)' : '');
      if (at.status === 'record' && at.claim) src += ' ' + at.claim;
      return '<div class="is-muted">Picture: <b>' + esc(v.subject) + '</b> · ' + esc(src) + ' · ' + esc(v.category) + ' · feeling ' + esc(v.emotion) +
        ' · ' + esc(v.shot) + ', ' + esc(v.camera) + ', ' + esc(v.duration) + 's, ' + esc(v.transition) +
        (v.why ? ' — ' + esc(v.why) : '') + (at.status === 'missing' ? ' <span class="is-badge bad">Missing asset</span>' : '') + '</div>';
    }
    var kind = { actual_image: 'Actual image', geographic_reference: 'Map / geographic reference', illustrative: 'Illustration (labelled as such)', source_document: 'Source document', data_card: 'Data card' }[v.kind] || 'Visual not classified';
    return '<div class="is-muted">Visual: <b>' + esc(kind) + '</b>' + (v.layout ? ' · layout ' + esc(v.layout) : '') + ' — ' + esc(v.desc) + '</div>';
  }

  function viewScript() {
    var b = S.draft;
    if (!b.main) {
      return '<div class="is-panel"><h3>Script & Shorts</h3><p class="is-muted">Generate story writes the one integrated story from the outline: the eight-act main investigation, the six-topic Quality-of-Life Checklist, Short A and Short B (or records an editorial exception if no second truthful question exists), titles, thumbnail line and description — every line citing source claims.</p>' +
        (b.arc ? '<button class="is-btn primary" data-act="req" data-kind="generate">Generate story</button>' : '<div class="is-warnbox">Analyze the story first: the script is written from the story outline.</div>') + '</div>';
    }
    var docs = [['main', 'Main investigation'], ['qol', 'Quality-of-Life'], ['short_a', 'Short A'], ['short_b', 'Short B'], ['packaging', 'Titles & thumbnail'],
      ['visuals', 'Visual plan & assets'], ['ledger', 'Source ledger']];
    if (!b.discovery) docs = docs.filter(function (x) { return x[0] !== 'visuals'; });
    var tabs = '<div class="is-docs" role="tablist">' + docs.map(function (x) {
      return '<button class="is-doc" role="tab" data-act="doc" data-doc="' + x[0] + '" aria-selected="' + (S.doc === x[0]) + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>';
    var inner;
    if (S.doc === 'main') {
      inner = checks('main') + ((b.main && b.main.acts) || []).map(function (a, ai) {
        return '<h4 class="is-act">Act ' + esc(a.act) + ' · ' + esc(a.name) + '</h4>' + (a.scenes || []).map(function (sc, si) {
          var base = 'main.acts.' + ai + '.scenes.' + si;
          return '<div class="is-scene"><div class="is-muted">' + (sc.thread ? threadBadge(sc.thread) : '') + 'Viewer should understand: ' + esc(sc.purpose) + '</div>' + visualNote(sc.visual) +
            (sc.onscreen ? lineEditor(base + '.onscreen', 'main', 'On-screen text') : '') +
            (sc.narration || []).map(function (n, ni) { return lineEditor(base + '.narration.' + ni, 'main', 'Narration ' + (ni + 1)); }).join('') + '</div>';
        }).join('');
      }).join('') + reviseFor(S.doc);
      var first = (((b.main.acts || [])[0] || {}).scenes || []).concat((((b.main.acts || [])[1] || {}).scenes || []));
      inner = '<div class="is-pre"><b>First 30 seconds:</b> ' + esc(first.map(function (sc) { return (sc.narration || []).map(function (n) { return n.text; }).join(' '); }).join(' ')) + '</div>' + inner;
    } else if (S.doc === 'qol') {
      inner = checks('main') + '<p class="is-muted">Every main investigation covers all six topics. "Not addressed" means the reviewed documents do not address it — never that there is no impact.</p>' +
        (b.qol || []).map(function (r, i) {
          return '<div class="is-scene"><b>' + esc(r.topic) + '</b> <span class="is-badge ' + (r.status === 'addressed' ? 'ok' : 'wait') + '">' + esc(r.status === 'addressed' ? 'Addressed in the records' : 'Not addressed in reviewed documents') + '</span>' + lineEditor('qol.' + i + '.summary', 'main', 'Summary') + '</div>';
        }).join('') + (QOL.every(function (t, i) { return b.qol && b.qol[i] && b.qol[i].topic === t; }) ? '' : '<div class="is-block">The checklist must list Traffic, Noise, Air, Water, Soil and Light in that order.</div>') + reviseFor(S.doc);
    } else if (S.doc === 'short_a' || S.doc === 'short_b') {
      var key = S.doc === 'short_a' ? 'a' : 'b', sh = (b.shorts || {})[key];
      if (!sh) {
        inner = checks('short_b') + '<div class="is-warnbox"><b>Editorial exception — second Short unavailable.</b> ' + esc((b.shorts || {}).b_exception || 'No reason recorded.') + '</div>' +
          '<button class="is-btn" data-act="req" data-kind="generate" data-scope="short_b" data-new="1">Try a different second Short</button>' + reviseFor(S.doc);
      } else {
        inner = checks(S.doc) + '<p><b>Question:</b> ' + esc(sh.question) + ' <span class="is-badge emo">' + esc(sh.emotion) + '</span></p>' +
          lineEditor('shorts.' + key + '.description', S.doc, 'Short description') +
          '<div class="is-line"><label class="is-muted" for="ed-t-' + key + '">Title</label><input class="is-in" id="ed-t-' + key + '" data-ed="shorts.' + key + '.title" value="' + esc(sh.title) + '"></div>' +
          (sh.beats || []).map(function (bt, bi) {
            return '<div class="is-scene"><b>' + esc(bt.beat) + '</b>' + visualNote(bt.visual) +
              (bt.narration || []).map(function (n, ni) { return lineEditor('shorts.' + key + '.beats.' + bi + '.narration.' + ni, S.doc, 'Line ' + (ni + 1)); }).join('') + '</div>';
          }).join('') + (key === 'b' ? '<button class="is-btn" data-act="req" data-kind="generate" data-scope="short_b" data-new="1">Regenerate Short B only</button>' : '') + reviseFor(S.doc);
      }
    } else if (S.doc === 'packaging') {
      var pk = b.packaging || {};
      inner = checks('packaging') + (pk.titles || []).map(function (t, i) { return lineEditor('packaging.titles.' + i, 'packaging', 'Title option ' + (i + 1)); }).join('') +
        lineEditor('packaging.thumbnail', 'packaging', 'Thumbnail line (4-8 words)') + lineEditor('packaging.description', 'packaging', 'Description') +
        (pk.bluesky && pk.bluesky.hook ? lineEditor('packaging.bluesky.hook', 'packaging', 'Bluesky hook') : '') +
        '<button class="is-btn" data-act="req" data-kind="generate" data-scope="packaging" data-new="1">Regenerate packaging only</button>' + reviseFor(S.doc);
    } else if (S.doc === 'visuals') {
      inner = viewVisuals(b);
    } else {
      var rows = (S.data.version && S.data.version.derived && S.data.version.derived.ledger) || [];
      inner = '<p class="is-muted">Every cited line, the claim behind it and the record\'s own words. ' + (S.dirty ? 'Save to refresh.' : '') + '</p><table class="is-tab"><thead><tr><th>Where</th><th>Line</th><th>Claim</th><th>Record says</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td>' + esc(r.where) + '</td><td>' + esc(r.line) + '</td><td>' + claimChip(r.claim) + ' ' + esc(r.status || 'missing') + '</td><td>' + esc(r.quote || '') +
            (r.url ? ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.source || 'source') + '</a>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    return '<div class="is-panel"><h3>Script & Shorts</h3>' + decisionBar('narrative') + checks('narrative') + tabs +
      '<div class="is-row" style="margin-bottom:6px"><button class="is-btn' + (S.dirty ? ' primary' : '') + '" data-act="save"' + (S.dirty ? '' : ' disabled') + '>' + (S.dirty ? 'Save changes as a new version' : 'No unsaved changes') + '</button>' +
      (S.dirty ? '<button class="is-btn" data-act="discard">Discard changes</button>' : '') + '<span class="is-muted">Saving creates a new version and re-runs the evidence checks. Approvals stay only on parts you did not change.</span></div>' +
      inner + '</div>';
  }
  function viewVisuals(b) {
    var r = ((S.data.version && S.data.version.validation) || {}).v3 || {};
    var rows = [];
    ((b.main && b.main.acts) || []).forEach(function (a) {
      (a.scenes || []).forEach(function (sc, i) { rows.push(['Act ' + a.act + ' · ' + a.name + (i ? ' (' + (i + 1) + ')' : ''), sc.visual]); });
    });
    ['a', 'b'].forEach(function (k) {
      var sh = (b.shorts || {})[k];
      ((sh && sh.beats) || []).forEach(function (bt) { rows.push(['Short ' + k.toUpperCase() + ' · ' + bt.beat, bt.visual]); });
    });
    var th = (b.packaging || {}).thumbnail;
    if (th && th.visual) rows.push(['Thumbnail', th.visual]);
    var photos = (r.photos || []).map(function (p) {
      return '<tr><td><code>' + esc(p.id) + '</code></td><td>' + esc(p.title || '') + '</td><td>' + esc(p.license || '') + '</td><td>' + esc(p.author || '') +
        '</td><td>' + (p.usable ? '<span class="is-badge ok">Usable</span>' : '<span class="is-badge bad">' + esc((p.problems || []).join('; ')) + '</span>') +
        (p.site_specific ? '' : ' <span class="is-badge wait">Representative, not this site</span>') +
        (p.page_url ? ' <a href="' + esc(p.page_url) + '" target="_blank" rel="noopener noreferrer">file page</a>' : '') + '</td></tr>';
    }).join('');
    var timing = Object.keys(r.short_timing || {}).map(function (k) {
      return '<tr><td>Short ' + esc(k.toUpperCase()) + '</td><td>' + (r.short_timing[k] || []).map(function (x) { return esc(x.beat) + ' ends ' + esc(x.ends) + 's'; }).join(' · ') + '</td></tr>';
    }).join('');
    return '<p class="is-muted">What is on screen in every shot, the feeling it serves, and where the picture comes from. A photo is only an openly licensed file whose license is checked; anything else is a labelled illustration, and a drawing never shows harm or an incident.</p>' +
      '<table class="is-tab"><thead><tr><th>Shot</th><th>Picture</th></tr></thead><tbody>' + rows.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td>' + visualNote(x[1]) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h4 style="margin-top:14px">Photos and their licenses</h4>' + (photos ? '<table class="is-tab"><thead><tr><th>Id</th><th>File</th><th>License</th><th>Author</th><th>Status</th></tr></thead><tbody>' + photos + '</tbody></table>' : '<p class="is-muted">No photos; every picture is a record, map, card or labelled illustration.</p>') +
      '<h4 style="margin-top:14px">Shorts timing</h4><p class="is-muted">Hook by 3 s, care by 8 s, conflict by 16 s, evidence by 25 s, then the action; 20 to 45 seconds in all.</p>' +
      (timing ? '<table class="is-tab"><tbody>' + timing + '</tbody></table>' : '<p class="is-muted">Runs with the evidence checks.</p>') +
      revisionNotes('visuals') + '<div class="is-row" style="margin-top:8px">' + reviseButton('visuals', 'the pictures') + '</div>';
  }
  function reviseFor(doc) {
    var sec = { main: 'script', qol: 'script', short_a: 'short_a', short_b: 'short_b', packaging: 'packaging' }[doc];
    return sec ? revisionNotes(sec) + '<div class="is-row" style="margin-top:8px">' + reviseButton(sec) + '</div>' : '';
  }

  function mediaBadge(st) { return '<span class="is-badge ' + (MEDIA_CLS[st] || 'wait') + '">' + esc(MEDIA_LABEL[st] || st) + '</span>'; }
  function mb(n) { return n ? (n / 1e6).toFixed(1) + ' MB' : ''; }
  function secs(v) { v = Math.round(Number(v) || 0); return Math.floor(v / 60) + ':' + ('0' + (v % 60)).slice(-2); }
  // A private file is downloaded with the admin's own session (the bucket's read policy) and shown from a blob: link,
  // the only media source this page's CSP allows. Nothing is fetched until the founder asks to watch it.
  function signed(path) {
    if (S.urls[path]) return Promise.resolve(S.urls[path]);
    return S.client.storage.from(BUCKET).download(path).then(function (r) {
      if (!r || r.error || !r.data) throw (r && r.error) || new Error('Could not read the file. Try again.');
      S.urls[path] = URL.createObjectURL(r.data); return S.urls[path];
    });
  }
  // The visual quality gate (homesignal-ingest impact/visual_gate.py): the storyboard checked before render and the
  // rendered file checked frame by frame, each against the targets in impact/quality.json. Shown as the engine
  // reported it; this page decides nothing.
  var METRIC_LABEL = {
    real_share: ['Real-world pictures', 'real_min', 'min', true], document_share: ['Documents', 'document_max', 'max', true],
    card_share: ['Cards', 'card_max', 'max', true], nonreal_share: ['Documents, maps, cards, drawings', 'nonreal_max', 'max', true],
    open_real_share: ['Opening on a real picture', 'open_real_min', 'min', true], unmatched_share: ['Pictures not matching the words', 'unmatched_max', 'max', true],
    distinct_photos: ['Different photos', 'min_distinct_photos', 'min', false], photo_reuse_max: ['Most uses of one photo', 'max_photo_reuse', 'max', false],
    max_shot_s: ['Longest shot (s)', 'max_shot_s', 'max', false], longest_hold_s: ['Longest hold on screen (s)', 'max_shot_s', 'max', false],
    quote_px_min: ['Smallest quote text on a phone (px)', 'quote_px_min', 'min', false],
    planned_real_not_visible: ['Planned photos not visible on the file', null, null, true], page_share: ['Document pages on the file', null, null, true]
  };
  function metricRows(m, t) {
    return Object.keys(METRIC_LABEL).filter(function (k) { return m && m[k] != null; }).map(function (k) {
      var d = METRIC_LABEL[k], v = m[k], tv = d[1] && t ? t[d[1]] : null;
      var ok = tv == null ? null : (d[2] === 'min' ? v >= tv : v <= tv);
      var show = function (x) { return d[3] ? Math.round(x * 100) + '%' : String(Math.round(x * 10) / 10); };
      return '<tr><td>' + esc(d[0]) + '</td><td>' + esc(show(v)) + '</td><td>' + (tv == null ? '' : esc((d[2] === 'min' ? 'at least ' : 'at most ') + show(tv))) +
        '</td><td>' + (ok == null ? '' : (ok ? '✓' : '✗')) + '</td></tr>';
    }).join('');
  }
  function failureList(fs) {
    return (fs || []).length ? '<ul class="is-list">' + fs.map(function (x) {
      return '<li><b>' + esc(x.label || x.code) + '</b>' + (x.asset ? ' (' + esc(ASSET_LABEL[x.asset] || x.asset) + ')' : '') + ': ' + esc(x.detail || '') +
        (x.action ? '<br><span class="is-muted">What to do: ' + esc(x.action) + '</span>' : '') + '</li>';
    }).join('') + '</ul>' : '';
  }
  function qualityBlock(f) {
    var q = f.qc && f.qc.quality;
    if (!q) return '<p class="is-muted">No visual quality report: this file was rendered before the quality gates existed.</p>';
    var sb = q.storyboard || {}, fr = q.frames || {};
    return '<details style="margin-top:8px"' + (q.ok ? '' : ' open') + '><summary>Visual quality: ' + (q.ok ? 'passed' : 'FAILED') + '</summary>' +
      failureList(q.failures) +
      (sb.metrics ? '<p class="is-muted" style="margin-bottom:2px">Planned storyboard</p><table class="is-tab"><tbody>' + metricRows(sb.metrics, sb.targets) + '</tbody></table>' : '') +
      (fr.metrics ? '<p class="is-muted" style="margin-bottom:2px">Rendered file, checked frame by frame (' + esc(fr.metrics.frames) + ' frames)</p><table class="is-tab"><tbody>' + metricRows(fr.metrics, fr.targets) + '</tbody></table>' : '') +
      '</details>';
  }
  function currencyBlock(c) {
    if (!c || !c.state) return '';
    var lab = { current: 'Current: no newer decision found', stale: 'OUTDATED: a newer decision is not in the script', unverified: 'Not verified: the records could not be read again' }[c.state] || c.state;
    return '<div class="' + (c.state === 'current' ? 'is-muted' : 'is-warnbox') + '" style="margin-top:8px"><b>Latest development check</b>: ' + esc(lab) +
      (c.checked_at ? ' (checked ' + esc(c.checked_at) + ', records fetched ' + esc(c.pack_fetched_at || 'unknown') + ')' : '') +
      ((c.events || []).length ? '<ul class="is-list">' + c.events.slice(0, 5).map(function (e) { return '<li>' + esc(e.summary || e.title || '') + (e.date ? ' (' + esc(e.date) + ')' : '') + '</li>'; }).join('') + '</ul>' : '') +
      ((c.blocking || []).length ? '<p>' + esc(c.blocking.join(' ')) + '</p>' : '') + '</div>';
  }
  function blockedPanel(m) {
    var b = m.blocked;
    if (!b) return '';
    var chosen = {};
    (m.choices || []).forEach(function (c) { chosen[c.subject_id] = c.candidate_id; });
    var cands = (b.candidates || []).map(function (g) {
      return '<section class="is-angle"><b>' + esc(g.subject || g.subject_id) + '</b> <span class="is-muted">needs a licensed photo' +
        ((g.queries || []).length ? ' · searched: ' + esc(g.queries.join('; ')) : '') + '</span>' +
        ((g.candidates || []).length ? '<ul class="is-list">' + g.candidates.map(function (c) {
          var on = chosen[g.subject_id] === c.id;
          return '<li><a href="' + esc(c.page_url) + '" target="_blank" rel="noopener">' + esc(c.title || c.id) + '</a> · ' + esc(c.license) + ' · ' + esc(c.author || '') +
            (c.near && c.near.length ? ' · names ' + esc(c.near.join(', ')) : '') + ' · <span class="is-muted">shown as REPRESENTATIVE PHOTO, never as the site</span> ' +
            (on ? '<span class="is-badge ok">Chosen</span>' : '<button class="is-btn" data-act="choose" data-job="' + esc(b.job_id) + '" data-subject="' + esc(g.subject_id) + '" data-id="' + esc(c.id) + '">Use this photo</button>') + '</li>';
        }).join('') + '</ul>' : '<p class="is-muted">No licensed photo was found' + ((g.errors || []).length ? ' (' + esc(g.errors.slice(0, 2).join('; ')) + ')' : '') +
          '. Add one to impact/assets/registry.json through the asset probe, or ask Claude to rewrite the story around a subject that can be shown.</p>') + '</section>';
    }).join('');
    return '<div class="is-warnbox" style="margin-top:8px"><b>The last render stopped before rendering anything</b> (' + esc(fmt(b.at)) + ').' +
      failureList(b.failures) + (b.candidates_error ? '<p>' + esc(b.candidates_error) + '</p>' : '') + currencyBlock(b.currency) +
      (cands ? '<p>Choose a photo for each subject below, then press <b>Render the videos</b> again.</p>' + cands : '') + '</div>';
  }

  function fileCard(f, current) {
    var qc = (f.qc && f.qc.checks) || [];
    var isVideo = f.asset !== 'thumbnail', key = 'f' + f.id;
    var url = S.urls[f.path];
    var player = isVideo
      ? (url ? '<video controls preload="metadata" src="' + esc(url) + '" style="width:100%;max-height:' + (f.height > f.width ? '640px' : '420px') + ';background:#000;border-radius:8px"' + '></video>'
             : '<button class="is-btn" data-act="watch" data-path="' + esc(f.path) + '">Watch ' + esc(ASSET_LABEL[f.asset] || f.asset) + '</button>')
      : (url ? '<img alt="Thumbnail" src="' + esc(url) + '" style="max-width:100%;border-radius:8px">'
             : '<button class="is-btn" data-act="watch" data-path="' + esc(f.path) + '">Show thumbnail</button>');
    var stills = S.shown[key] ? '<div class="is-row" style="flex-wrap:wrap;gap:8px;margin-top:8px">' + (f.stills || []).map(function (p, i) {
      var shot = (f.shots || [])[i] || {};
      return S.urls[p] ? '<figure style="margin:0;width:' + (f.height > f.width ? '150px' : '260px') + '"><a href="' + esc(S.urls[p]) + '" target="_blank" rel="noopener"><img alt="Shot ' + esc(shot.id || i + 1) + '" src="' + esc(S.urls[p]) + '" style="width:100%;border-radius:6px"></a>' +
        '<figcaption class="is-muted" style="font-size:12px">' + esc(secs(shot.start_s)) + ' · ' + esc(shot.layout || '') + ' · ' + esc(shot.kind || '') + '</figcaption></figure>' : '';
    }).join('') + '</div>' : '';
    var decide = !current || f.state === 'stale' ? '' :
      '<div class="is-row" style="margin-top:8px">' +
      (f.state !== 'approved' ? '<button class="is-btn primary" data-act="mdecide" data-d="approved" data-id="' + esc(f.id) + '"' + (f.state === 'blocked' ? ' disabled title="' + esc(f.why || 'Blocked') + '"' : '') + '>Approve</button>' : '') +
      '<button class="is-btn" data-act="mdecide" data-d="rejected" data-id="' + esc(f.id) + '">Request a fix</button>' +
      (f.state === 'approved' ? '<button class="is-btn" data-act="mdecide" data-d="revoked" data-id="' + esc(f.id) + '">Revoke approval</button>' : '') + '</div>';
    return '<section class="is-angle"><div class="is-row"><b>' + esc(ASSET_LABEL[f.asset] || f.asset) + '</b> ' + mediaBadge(f.state) +
      '<span class="is-muted">' + esc(f.width + '×' + f.height) + (f.duration_s ? ' · ' + esc(secs(f.duration_s)) : '') + ' · ' + esc(mb(f.bytes)) + ' · ' + esc(f.preset) + '</span></div>' +
      '<p class="is-muted">' + esc(f.why) + '</p>' + player +
      (qc.length ? '<details style="margin-top:8px"><summary>Media checks: ' + (f.qc.ok ? 'all passed' : 'FAILED') + '</summary><ul class="is-list">' +
        qc.map(function (c) { return '<li>' + (c.ok ? '✓ ' : '✗ ') + esc(c.name) + ': ' + esc(c.detail) + '</li>'; }).join('') + '</ul></details>' : '') +
      qualityBlock(f) +
      (isVideo && (f.stills || []).length ? '<button class="is-btn" data-act="stills" data-id="' + esc(f.id) + '">' + (S.shown[key] ? 'Hide' : 'Show') + ' one still per shot (' + f.stills.length + ')</button>' : '') +
      (f.captions_path ? ' <button class="is-btn" data-act="dl" data-path="' + esc(f.captions_path) + '">Download captions (.srt)</button>' : '') +
      ' <button class="is-btn" data-act="dl" data-path="' + esc(f.path) + '">Download file</button>' + stills + decide + '</section>';
  }

  function viewMedia() {
    var st = S.data.status, m = S.data.media || {}, files = m.files || [];
    var approved = st.artifacts && st.artifacts.narrative && st.artifacts.narrative.state === 'approved';
    var job = st.job, rendering = job && job.kind === 'render' && (job.status === 'queued' || job.status === 'running');
    var head = '<div class="is-panel"><h3>Media review</h3>';
    if (!approved) return head + '<p class="is-muted">Render needs the one editorial approval (the integrated narrative: outline, main script, both Shorts, packaging) on the current version.</p></div>';
    var btn = rendering ? '' : (m.current
      ? '<button class="is-btn" data-act="render" data-new="1">Render again</button>'
      : '<button class="is-btn primary" data-act="render">Render the videos</button>');
    return head +
      '<p class="is-muted">Renders the approved narrative with the Impact Stories layouts: a 16:9 main video, two true 9:16 Shorts, a thumbnail and captions. ' +
      'Narration is Kokoro (no cost). Files are private to this dashboard; nothing is published.</p>' +
      (m.render_job && !m.current ? '<div class="is-warnbox">These files were rendered from an earlier narrative (version ' + esc(m.version) + '). Render again for the approved one.</div>' : '') +
      (m.render_job && m.current ? '<p class="is-muted">Rendered ' + esc(fmt(m.rendered_at)) + ' from version ' + esc(m.version) + ' (' + esc(m.renderer) + '). ' +
        (m.complete ? '<span class="is-badge ok">Every file approved</span>' : 'Approve or request a fix for each file.') + '</p>' : '') +
      blockedPanel(m) + (m.render_job && m.current ? currencyBlock(m.currency) : '') +
      '<div class="is-row">' + btn + '</div>' +
      files.map(function (f) { return fileCard(f, m.current); }).join('') + '</div>';
  }

  function viewDistribution() {
    var d = S.data.version && S.data.version.derived, vs = (d && d.variants && d.variants.variants) || [];
    var ready = S.data.status.stage === 'media' || S.data.status.stage === 'distribution';
    var mediaDone = !!(S.data.media && S.data.media.complete);
    if (!vs.length) return '<div class="is-panel"><h3>Distribution</h3><p class="is-muted">Platform copy appears once a story has been generated and checked.</p></div>';
    var dest = { youtube: 'YouTube (full, 16:9)', youtube_shorts: 'YouTube Shorts (9:16)', tiktok: 'TikTok (9:16)', bluesky: 'Bluesky post' };
    return '<div class="is-panel"><h3>Distribution</h3>' +
      (ready ? '' : '<div class="is-warnbox">This copy is a draft until every editorial approval is in place.</div>') +
      '<p class="is-muted">Manual export only. No account is connected and nothing here publishes or schedules. ' +
        (mediaDone ? 'Every video file is approved: download them in Media review.' : 'Video files still need review (Media review).') + '</p>' +
      vs.map(function (v, i) {
        var txt = v.text || [v.title, v.description || v.caption, v.attribution].filter(Boolean).join('\n\n');
        return '<section class="is-angle"><div class="is-row"><b>' + esc(dest[v.destination] || v.destination) + '</b> <span class="is-muted">' + esc(v.asset) + ' · ' + esc(v.format) + '</span>' +
          '<span class="is-badge wait">Not published</span>' + (v.connection === 'not_connected' ? '<span class="is-badge wait">Not connected</span>' : '') +
          '<span class="is-badge wait">Automatic publishing: unavailable</span>' +
          (v.full_video_pending ? '<span class="is-badge bad">Full video URL pending</span>' : '') +
          (v.destination === 'bluesky' && v.fits === false ? '<span class="is-badge bad">Over 300 characters (' + esc(v.chars) + ')</span>' : '') + '</div>' +
          (v.note ? '<p class="is-muted">' + esc(v.note) + '</p>' : '') +
          '<div class="is-pre" id="var-' + i + '">' + esc(txt) + '</div>' +
          '<button class="is-btn" data-act="copy" data-i="' + i + '">Copy text</button></section>';
      }).join('') +
      '<div class="is-row"><button class="is-btn" data-act="export"' + (ready ? '' : ' disabled') + '>Download export package (text, JSON)</button>' +
      (ready ? '' : '<span class="is-muted">Export unlocks when every editorial approval is in place.</span>') + '</div></div>';
  }

  function viewResults() {
    return '<div class="is-panel"><h3>Results</h3><table class="is-tab"><thead><tr><th>Measure</th><th>Value</th></tr></thead><tbody>' +
      ['YouTube views / retention / shares', 'YouTube Shorts views / shares', 'TikTok views / shares', 'Bluesky reposts / likes'].map(function (m) { return '<tr><td>' + m + '</td><td><span class="is-badge wait">Not published</span></td></tr>'; }).join('') +
      ['JODY TRACKS project-page visits', 'Registrations', 'Reports created', 'Project follows'].map(function (m) { return '<tr><td>' + m + '</td><td><span class="is-badge wait">Not published — no campaign link has gone out</span></td></tr>'; }).join('') +
      '</tbody></table><p class="is-muted">Nothing is shown as zero: a number appears only once a story is published and its campaign link (utm_campaign=impact-…) is measured.</p></div>';
  }

  function viewDrawer() {
    var x = S.drawer;
    if (x.kind === 'claim') {
      var c = claimById(x.id);
      return '<aside class="is-drawer" aria-label="Source"><div class="is-head"><b>Claim ' + esc(x.id) + '</b><button class="is-btn" data-act="close-drawer" aria-label="Close source panel">Close</button></div>' +
        (c ? '<p><span class="is-badge ' + (c.status === 'stated' ? 'ok' : 'wait') + '">' + esc({ stated: 'Stated in the record', flagged: 'Flagged as possible', not_in_docs: 'Not in these documents', context: 'Computed context' }[c.status] || c.status) + '</span></p>' +
          '<p class="is-muted">' + esc(c.text) + '</p>' + (c.quote ? '<div class="is-pre">“' + esc(c.quote) + '”</div>' : '') +
          (c.value ? '<div class="is-pre">' + esc(c.value) + '</div>' : '') + (c.terms ? '<div class="is-pre">Searched for: ' + esc(c.terms.join(', ')) + '</div>' : '') +
          '<p>' + esc(c.source_label || '') + (c.page ? ' · page ' + esc(c.page) : '') + '</p>' +
          (c.source_url ? '<a href="' + esc(c.source_url) + '" target="_blank" rel="noopener noreferrer">Open the document</a>' : '')
          : '<div class="is-block">This id is not in the source pack. The line citing it cannot be approved.</div>') + '</aside>';
    }
    return '<aside class="is-drawer" aria-label="Changes"><div class="is-head"><b>' + esc(ART[x.artifact]) + ': version ' + esc(x.version) + ' (approved) vs current</b><button class="is-btn" data-act="close-drawer">Close</button></div>' + x.html + '</aside>';
  }

  function viewHistory() {
    var ev = (S.data.events || []).slice(0, 40), vs = S.data.versions || [];
    return '<details class="card"><summary>History · ' + vs.length + ' versions · audit trail</summary><table class="is-tab"><tbody>' +
      ev.map(function (e) { return '<tr><td>' + esc(fmt(e.at)) + '</td><td>' + esc(e.kind.replace(/_/g, ' ')) + '</td><td>' + esc(e.actor) + '</td><td class="is-muted">' + esc(JSON.stringify(e.detail)) + '</td></tr>'; }).join('') +
      '</tbody></table></details>';
  }

  function lines(body, artifact) {
    var out = [];
    (function walk(o, p) {
      if (o && typeof o === 'object' && typeof o.text === 'string') { out.push([p, o.text]); return; }
      if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { walk(o[k], p ? p + '.' + k : k); });
    })(artifact === 'narrative' ? { arc: body.arc, outline: body.outline, main: body.main, qol: body.qol, shorts: body.shorts, packaging: body.packaging } : {}, '');
    return out;
  }
  function diffHtml(oldB, newB, artifact) {
    var a = {}, b = {}; lines(oldB || {}, artifact).forEach(function (x) { a[x[0]] = x[1]; }); lines(newB || {}, artifact).forEach(function (x) { b[x[0]] = x[1]; });
    var keys = Object.keys(a).concat(Object.keys(b).filter(function (k) { return !(k in a); }));
    var rows = keys.filter(function (k) { return a[k] !== b[k]; }).map(function (k) {
      return '<div class="is-line changed"><div class="is-muted">' + esc(k) + '</div>' + (k in a ? '<div><s>' + esc(a[k]) + '</s></div>' : '') + (k in b ? '<div><b>' + esc(b[k]) + '</b></div>' : '<div class="is-muted">(removed)</div>') + '</div>';
    });
    return (rows.join('') || '<p class="is-muted">The spoken text is unchanged; something else in this part changed (claims, visuals or structure).</p>') +
      '<p class="is-muted">Approving again requires: ' + esc(ART[artifact]) + '.</p>';
  }

  // ── actions ─────────────────────────────────────────────────────────────────────────────────────────
  function act(p) {
    return p.then(function (r) { return r; }, function (e) { S.msg = { bad: true, text: errText(e) }; return S.open ? refresh(false) : renderLibrary(); });
  }
  function onClick(ev) {
    var t = ev.target.closest('[data-act]'); if (!t || !S.el.contains(t)) return;
    var a = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    if (a === 'reload') return loadLibrary();
    if (a === 'new') { var n = S.el.querySelector('#is-new'); n.hidden = false; S.el.querySelector('#is-new-slug').focus(); return; }
    if (a === 'cancel-new') { S.el.querySelector('#is-new').hidden = true; return; }
    if (a === 'filter') { S.filter = t.getAttribute('data-f'); return renderLibrary(); }
    if (a === 'create') {
      t.disabled = true;
      return act(rpc('hs_impact_story_create', { p_video_slug: S.el.querySelector('#is-new-slug').value, p_title: S.el.querySelector('#is-new-title').value || null })
        .then(function (r) { return openStory(r.story_id, 'intake', true); }));
    }
    if (a === 'open') return openStory(id, null, true);
    if (a === 'dup') return act(rpc('hs_impact_story_duplicate', { p_story: id }).then(function (r) { return openStory(r.story_id, 'intake', true); }));
    if (a === 'archive') {
      var w = prompt('Archive this story? It stays in the library under Archived and can be restored. Type ARCHIVE to confirm.');
      if (w == null) return;
      return act(rpc('hs_impact_story_archive', { p_story: id, p_confirm: w }).then(loadLibrary));
    }
    if (a === 'restore') return act(rpc('hs_impact_story_archive', { p_story: id, p_confirm: null, p_restore: true }).then(function () { return S.open ? refresh(true) : loadLibrary(); }));
    if (a === 'back') {
      if (S.dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
      S.open = null; S.data = null; S.dirty = false; clearTimeout(S.timer); writeHash(true); return loadLibrary();
    }
    if (a === 'step') { S.step = t.getAttribute('data-step'); writeHash(true); return renderWorkspace(); }
    if (a === 'doc') { S.doc = t.getAttribute('data-doc'); writeHash(false); return renderWorkspace(); }
    if (a === 'claim') { S.drawer = { kind: 'claim', id: id }; return renderWorkspace(); }
    if (a === 'close-drawer') { S.drawer = null; return renderWorkspace(); }
    if (a === 'req') {
      t.disabled = true;
      var kind = t.getAttribute('data-kind'), scope = t.getAttribute('data-scope') || 'all', isNew = t.getAttribute('data-new') === '1';
      if (isNew && kind !== 'pack' && !confirm('This reads the story Claude wrote for this project again and creates a new version. Your current version is kept. Continue?')) { t.disabled = false; return; }
      return act(rpc('hs_impact_story_request', { p_story: S.open, p_kind: kind, p_scope: scope, p_new: isNew }).then(function (r) {
        S.msg = { text: r.existing ? 'That request already exists (' + r.status + '). Showing it instead of starting another run.' : 'Queued. This page updates on its own.' };
        return refresh(false);
      }));
    }
    if (a === 'render') {
      t.disabled = true;
      if (t.getAttribute('data-new') === '1' && !confirm('Render this narrative again? The current files stay as history; the new files need reviewing again.')) { t.disabled = false; return; }
      return act(rpc('hs_impact_story_render', { p_story: S.open, p_expected_version: S.data.story.current_version, p_new: t.getAttribute('data-new') === '1' }).then(function (r) {
        S.msg = { text: r.existing ? 'That render already exists (' + r.status + '). Showing it instead of starting another.' : 'Render queued. It takes about 1 to 3 hours; this page updates on its own.' };
        S.step = 'media'; writeHash(false); return refresh(false);
      }));
    }
    if (a === 'choose') {
      t.disabled = true;
      return act(rpc('hs_impact_story_choose_asset', { p_story: S.open, p_job: t.getAttribute('data-job'), p_subject: t.getAttribute('data-subject'), p_candidate: id })
        .then(function () { S.msg = { text: 'Photo chosen. Render the videos again to use it.' }; return refresh(false); }));
    }
    if (a === 'watch') {
      t.disabled = true;
      return act(signed(t.getAttribute('data-path')).then(function () { renderWorkspace(); }));
    }
    if (a === 'dl') {
      return act(signed(t.getAttribute('data-path')).then(function (u) {
        var l = document.createElement('a'); l.href = u; l.download = t.getAttribute('data-path').split('/').pop(); document.body.appendChild(l); l.click(); l.remove();
      }));
    }
    if (a === 'stills') {
      var f = (S.data.media.files || []).filter(function (x) { return String(x.id) === id; })[0], k = 'f' + id;
      if (S.shown[k]) { S.shown[k] = false; return renderWorkspace(); }
      return act(Promise.all((f.stills || []).map(signed)).then(function () { S.shown[k] = true; renderWorkspace(); }));
    }
    if (a === 'mdecide') {
      var md = t.getAttribute('data-d'), mnote = null, tc = null;
      if (md === 'rejected') {
        mnote = prompt('What should be fixed? (required, kept with the decision)'); if (!mnote) return;
        tc = prompt('At what moment? m:ss (optional)') || null;
        if (tc && !/^[0-9]{1,2}:[0-5][0-9](:[0-5][0-9])?$/.test(tc)) { alert('Use m:ss, for example 1:05.'); return; }
      }
      if (md === 'revoked') { mnote = prompt('Why revoke this approval?'); if (mnote == null) return; }
      return act(rpc('hs_impact_story_media_decide', { p_story: S.open, p_asset_id: Number(id), p_decision: md, p_note: mnote, p_timecode: tc })
        .then(function () { return refresh(false); }));
    }
    if (a === 'retry') return act(rpc('hs_impact_story_job_retry', { p_job: id }).then(function () { S.msg = { text: 'Retrying.' }; return refresh(false); }));
    if (a === 'concept') {
      var cid = t.getAttribute('data-id'), cs = (S.draft.concepts || []).filter(function (c) { return c.id === cid; })[0] || {};
      var why = prompt('Why lead with "' + (cs.title || cid) + '"? This is kept on the story; a Claude Code session rewrites the draft, then you press Analyze again.');
      if (!why) return;
      var note = 'Lead with concept "' + (cs.title || cid) + '" (' + cid + ') instead of ' + ((S.draft.selection || {}).concept || 'the current one') + '. Reason: ' + why;
      return act(rpc('hs_impact_story_section_revision', { p_story: S.open, p_expected_version: S.data.story.current_version, p_section: 'concepts', p_note: note.slice(0, 1000) })
        .then(function () { S.msg = { text: 'Concept choice saved. Ask Claude, in a Claude Code session, to rewrite the Impact Story around it; then press Analyze again.' }; return refresh(false); }));
    }
    if (a === 'revise') {
      var sec = t.getAttribute('data-sec');
      var rn = prompt('What should change? This note is kept on the story; a Claude Code session rewrites the draft from it, then you press Analyze again.');
      if (!rn) return;
      return act(rpc('hs_impact_story_section_revision', { p_story: S.open, p_expected_version: S.data.story.current_version, p_section: sec, p_note: rn })
        .then(function () { S.msg = { text: 'Revision note saved. Ask Claude, in a Claude Code session, to revise the Impact Story; then press Analyze again.' }; return refresh(false); }));
    }
    if (a === 'decide') {
      var art = t.getAttribute('data-a'), dec = t.getAttribute('data-d'), note = null, target = null;
      if (dec === 'rejected') {
        note = prompt('What should change? (required — this note is kept with the decision)'); if (!note) return;
        target = prompt('Which line, scene or timestamp is it about? (optional)') || null;
      }
      if (dec === 'revoked') { note = prompt('Why revoke? Render, export and publishing stay blocked until you approve again.'); if (note == null) return; }
      return act(rpc('hs_impact_story_decide', { p_story: S.open, p_artifact: art, p_decision: dec, p_expected_version: S.data.story.current_version, p_note: note, p_target: target })
        .then(function () { return refresh(false); }));
    }
    if (a === 'diff') {
      var v = t.getAttribute('data-v'), artifact = t.getAttribute('data-a');
      S.drawer = { kind: 'diff', artifact: artifact, version: v, html: diffHtml(S.approvedBody[v], S.draft, artifact) };
      return renderWorkspace();
    }
    if (a === 'save') {
      t.disabled = true;
      return act(rpc('hs_impact_story_save', { p_story: S.open, p_expected_version: S.data.story.current_version, p_body: S.draft }).then(function (r) {
        S.dirty = false;
        S.msg = { text: r.unchanged ? 'Nothing changed.' : 'Saved as version ' + r.version + '. ' + (r.job && r.job.message ? r.job.message : 'Evidence checks are running.') };
        return refresh(true);
      }));
    }
    if (a === 'discard') { if (confirm('Discard your unsaved changes?')) { S.dirty = false; S.draft = clone(S.data.version && S.data.version.body) || {}; renderWorkspace(); } return; }
    if (a === 'copy') {
      var txt = S.el.querySelector('#var-' + t.getAttribute('data-i')).textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { t.textContent = 'Copied'; }, function () { t.textContent = 'Copy failed: select the text instead'; });
      return;
    }
    if (a === 'export') {
      var d = S.data, pkg = { story: { id: d.story.id, title: d.story.title, version: d.story.current_version, project: d.story.video_slug },
        sources_checked: d.pack && d.pack.verified_at, approvals: d.status.artifacts, script: d.version.body, ledger: d.version.derived.ledger,
        variants: d.version.derived.variants, exported_at: new Date().toISOString(),
        media: (d.media && d.media.files || []).map(function (f) { return { asset: f.asset, path: f.path, sha256: f.sha256, state: f.state, duration_s: f.duration_s }; }),
        note: 'Text export plus the list of rendered files (download them from Media review). Nothing has been published.' };
      var blob = new Blob([JSON.stringify(pkg, null, 1)], { type: 'application/json' }), url = URL.createObjectURL(blob);
      var link = document.createElement('a'); link.href = url; link.download = 'impact-story-' + d.story.id.slice(0, 8) + '-v' + d.story.current_version + '.json';
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }
  }
  function onInput(ev) {
    var t = ev.target;
    if (t.id === 'is-q') { S.q = t.value; var pos = t.selectionStart; renderLibrary(); var q = S.el.querySelector('#is-q'); q.focus(); q.setSelectionRange(pos, pos); return; }
    var p = t.getAttribute('data-ed'), c = t.getAttribute('data-cl');
    if (!p && !c) return;
    if (p) setPath(S.draft, p, t.value);
    if (c) setPath(S.draft, c, t.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean));
    if (!S.dirty) {
      S.dirty = true;
      var hdr = S.el.querySelector('.is-badge.ok'); if (hdr && hdr.textContent === 'Saved') { hdr.textContent = 'Unsaved changes'; hdr.className = 'is-badge bad'; }
      var sv = S.el.querySelector('.is-panel [data-act=save]'); if (sv) { sv.disabled = false; sv.classList.add('primary'); sv.textContent = 'Save changes as a new version'; }
      // a decision always applies to the SAVED version, so none can be made over unsaved text
      S.el.querySelectorAll('[data-act=decide],[data-act=revise]').forEach(function (b) { b.disabled = true; b.title = 'Save or discard your changes first'; });
    }
  }

  HS.acqImpactStories = {
    load: function (client, el) {
      if (!client || !el) return;
      css();
      var first = !S.el;
      S.client = client; S.el = el;
      if (first) {
        el.addEventListener('click', onClick);
        el.addEventListener('input', onInput);
        window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
        window.addEventListener('popstate', function () {
          var h = readHash(); if (!h) return;
          if (h.impact && h.impact !== S.open) openStory(h.impact, h.step, false);
          else if (!h.impact && S.open) { S.open = null; loadLibrary(); }
          else if (knownStep(h.step) && knownStep(h.step) !== S.step) { S.step = knownStep(h.step); S.doc = h.doc || S.doc; renderWorkspace(); }
        });
      }
      var h = readHash();
      if (S.open && S.data) return refresh(false);          // returning to the tab keeps the editor state
      if (h && h.impact) { S.doc = h.doc || 'main'; return openStory(h.impact, h.step, false); }
      return loadLibrary();
    },
    // exposed for tests
    _diffHtml: diffHtml, _setPath: setPath, _state: S
  };
})();
