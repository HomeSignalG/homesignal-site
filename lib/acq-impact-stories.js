/* Jody Acquisition Dashboard: "17 · Impact Stories".
   An emotion-led, evidence-first story workflow (founder handoff v2.4, 2026-10-25). Separate from Tab 11 (Video
   Producer) and Tab 16 (YouTube Videos): it reads none of their state and changes none of their rows.

   Library -> one story workspace: Intake -> Story Outline -> Script & Shorts -> Visuals -> Media -> Distribution -> Results.
   VISUALS (2026-10-29, homesignal-ingest docs/impact-visuals/PLAN-v3-2026-10-29.md P2): Prepare queues a visuals job that
   renders ONE still per shot with the video's own compositor; the contact sheet shows them (blocked and flagged shots
   first), offers other licensed photos, and ONE "Approve all visuals" approves the set. Render needs that approval, and
   the engine refuses to render anything that does not hash to the approved set.
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
    { id: 'visuals', label: 'Visuals' }, { id: 'media', label: 'Media Review' }, { id: 'distribution', label: 'Distribution' },
    { id: 'results', label: 'Results' }
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
  var JOB_LABEL = { pack: 'Check sources', analyze: 'Analyze story', generate: 'Generate story', validate: 'Evidence checks', render: 'Render',
    visuals: 'Prepare visuals' };
  // VISUALS (2026-10-29, homesignal-ingest docs/impact-visuals/PLAN-v3-2026-10-29.md P2): one still per shot, made by
  // the same compositor as the video, shown as a contact sheet; the founder approves the whole set with ONE action.
  var VIS_LABEL = { none: 'Not prepared', preparing: 'Preparing', blocked: 'Stopped: no photo found', failed: 'Failed',
    stale: 'Out of date', needs_fixes: 'Needs fixes', ready: 'Ready to approve', approved: 'Approved' };
  var VIS_CLS = { none: 'wait', preparing: 'wait', blocked: 'bad', failed: 'bad', stale: 'bad', needs_fixes: 'bad', ready: 'warn', approved: 'ok' };
  var SHOT_LABEL = { clear: ['Clear', 'ok'], flagged: ['Look at this', 'warn'], blocked: ['Blocked', 'bad'] };
  var BUCKET = 'impact-media';
  var ASSET_LABEL = { main: 'Main video (16:9)', short_a: 'Short A (9:16)', short_b: 'Short B (9:16)', thumbnail: 'Thumbnail' };
  var MEDIA_LABEL = { approved: 'Approved', pending: 'Review required', blocked: 'Checks failed', rejected: 'Fix requested',
    revoked: 'Approval revoked', stale: 'Out of date' };
  var MEDIA_CLS = { approved: 'ok', pending: 'wait', blocked: 'bad', rejected: 'bad', revoked: 'bad', stale: 'bad' };
  var QOL = ['Traffic', 'Noise', 'Air', 'Water', 'Soil', 'Light'];
  // impact-story/3: the emotional discovery engine (homesignal-ingest impact/storycraft.py)
  var DIM_LABEL = { health: 'Health', wildlife: 'Wildlife & nature', homes: 'Homes & daily life', financial: 'Financial', accountability: 'Accountability' };
  var CLASS_LABEL = { verified_impact: ['Verified impact', 'ok'], documented_potential: ['Documented potential', 'wait'],
    documented_concern: ['Documented concern', 'wait'], investigative_question: ['Investigative question', 'emo'], no_evidence: ['No evidence', 'bad'] };
  var BEAT_LABEL = { attachment: 'A. Attachment', disruption: 'B. Disruption', controversy: 'C. Controversy', accountability: 'C. Accountability',
    evidence: 'D. Evidence', turning_point: 'E. Turning point', consequences: 'E. Consequences', action: 'F. Motivation and action' };
  // who did what (homesignal-ingest impact/accountability.py): the responsibility map, shown for review
  var RESEARCH_LABEL = { owner: 'Property owner', developer_operator: 'Developer or operator', parent: 'Parent or affiliated company',
    applicant: 'Applicant', representative: 'Consultants and representatives', contractor: 'Contractor', agency: 'Issuing agency',
    decision_maker: 'Decision-makers', enforcement: 'Party named in an enforcement action', response: "The organization's response" };
  var ROLE_LABEL = { owner: 'Owner', developer: 'Developer', operator: 'Operator', parent: 'Parent company', applicant: 'Applicant',
    representative: 'Representative', consultant: 'Consultant', contractor: 'Contractor', agency: 'Agency', decision_maker: 'Decision-maker',
    respondent: 'Respondent', officer: 'Officer', related: 'Named in the records' };
  var ATTR_STATUS = { established: ['Established', 'ok'], alleged: ['Alleged · not a finding', 'wait'], disputed: ['Disputed', 'wait'],
    unknown: ['Unverified', 'bad'] };
  var REVERSED = { overturned: 1, vacated: 1, dismissed: 1, withdrawn: 1, acquitted: 1 };
  var ASSET_TEXT = { registry: 'Licensed photo', illustrative: 'Needs a photo (no drawings)', missing: 'MISSING: needs editorial review',
    record: 'Source record', card: 'Data card', map: 'Map' };

  var S = { client: null, el: null, stories: null, catalog: null, filter: 'all', q: '', open: null, data: null,
    step: null, doc: 'board', sbSel: null, sbFull: false, sbIssues: false, draft: null, dirty: false, msg: null, timer: null, approvedBody: {}, drawer: null, urls: {}, prevFail: {}, shown: {}, fixForm: {}, lnForm: {}, lnText: {}, lnResearch: {},
    vtab: 'main', loadingPrev: false, another: false, av: {},
    csEd: null, csCompare: false };   // creator-directed stories: the revision being written, and whether the comparison is open
  // One verified research pack, several videos (founder, 2026-11-06). What each video is FOR is its story type (PTYPE below).
  function typeLabel(t) { return PTYPE[t || 'investigative'] || t; }
  function daysTo(d) { return d ? Math.round((Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') - Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 864e5) : null; }
  // the deadline the participation draft states from a record (the database reads it from discovery.action.deadline)
  function deadlineBadge(d) {
    var n = daysTo(d);
    if (n == null || isNaN(n)) return '';
    return '<span class="is-badge ' + (n >= 0 && n <= 21 ? 'bad' : 'wait') + '">' + (n < 0 ? 'Deadline passed ' : 'Deadline ') + esc(String(d).slice(0, 10)) +
      (n >= 0 ? ' (' + (n === 0 ? 'today' : n + ' day' + (n === 1 ? '' : 's')) + ')' : '') + '</span>';
  }
  function CR() { return HS.acqImpactCreator; }
  function isCreator() { return !!(S.data && S.data.creator && S.data.creator.mode === 'creator' && CR()); }
  // the founder's own words in a creator-directed story: shown, never edited in place (they change as a versioned revision)
  function lockedPath(path) { return isCreator() && /^main\.(.*\.)?(narration|onscreen)(\.|$)/.test(path); }

  function numTag(s) { return s && s.story_number ? "#" + s.story_number : ""; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Times in the viewer's own time zone, named (founder audit 2026-10-28: UTC read as the wrong time).
  function fmt(v) {
    if (!v) return ''; var d = new Date(v); if (isNaN(d)) return '';
    try { return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); }
    catch (e) { return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
  }
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
      '.is-sb{display:grid;grid-template-columns:minmax(220px,1fr) minmax(0,2.4fr) minmax(240px,1.2fr);gap:12px;align-items:start}',
      '@media (max-width:1100px){.is-sb{grid-template-columns:1fr}}',
      '.is-sbnav{max-height:78vh;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:6px;background:var(--panel)}',
      '.is-sbact{font-size:12px;font-weight:700;margin:8px 4px 4px}',
      '.is-sbitem{display:flex;gap:8px;width:100%;text-align:left;border:1px solid transparent;background:none;border-radius:8px;padding:6px;cursor:pointer;color:var(--ink);font-size:12.5px}',
      '.is-sbitem:hover{background:var(--panel2)}.is-sbitem.on{border-color:var(--accent);background:var(--panel2)}',
      '.is-sbitem img,.is-sbph{width:72px;height:40px;object-fit:cover;border-radius:4px;flex:none;background:var(--panel2);border:1px solid var(--line)}',
      '.is-sbdots i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;background:#c8cdc9}',
      '.is-sbdots i.ok{background:#2f9e5e}.is-sbdots i.warn{background:#d9a21b}.is-sbdots i.bad{background:#c0392b}',
      '.is-sbmain{border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--panel)}',
      '.is-sbpics{display:grid;gap:8px;margin-top:8px}.is-sbbig{width:100%;border-radius:8px;border:1px solid var(--line)}',
      '.is-sbempty{aspect-ratio:16/9;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:12px;border:1px dashed var(--line);border-radius:8px;color:var(--muted);margin-top:8px}',
      '.is-sbside{border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--panel);max-height:78vh;overflow:auto;font-size:13px}',
      '.is-sbside h5{margin:10px 0 4px;font-size:12.5px}.is-sbside li.bad{color:#9b2c1f}.is-quote{font-style:italic;color:var(--muted);margin:2px 0}',
      '.is-full{position:fixed;inset:0;z-index:300;overflow:auto;margin:0;border-radius:0;max-width:none;background:var(--bg,#fff);padding:18px}',
      '.is-full .is-sbnav,.is-full .is-sbside{max-height:none}',
      '.is-read{max-width:760px;font-size:17px;line-height:1.6}.is-read h4{margin:18px 0 4px;font-size:14px;color:var(--muted)}.is-onscr{font-size:13px;color:var(--muted);margin:0}',
      '.is-gates{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:6px;margin:8px 0}',
      '.is-gate{border:1px solid var(--line);border-radius:8px;padding:6px 8px;display:flex;flex-direction:column;gap:2px;font-size:12.5px}',
      '.is-gate.ok{border-color:#9fd4b6;background:#eef8f2}.is-gate.bad{border-color:#e7c3bd;background:#fbf0ee}',
      '.is-review{margin:8px 0}.is-review>summary{cursor:pointer;padding:6px 0}',
      '.is-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px;margin:8px 0}',
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
      '.is-badge.warn{color:#7a4d00;border-color:#ecd29a;background:#fdf6e6}.is-badge.bad{color:#9b2c1f;border-color:#e7c3bd;background:#fbf0ee}.is-badge.emo{color:#3a3f8f;border-color:#c9cbee;background:#f2f3fc}',
      '.is-next{margin-top:8px;font-size:13px}.is-next b{color:var(--accent)}',
      '.is-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start}',
      '.is-steps{display:flex;gap:4px;flex-wrap:wrap;margin:14px 0;padding:0;list-style:none}',
      '.is-step{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:7px 11px;font-size:13px;cursor:pointer;color:var(--muted)}',
      '.is-step[aria-current=step]{border-color:var(--accent);color:var(--ink);font-weight:600;box-shadow:inset 0 -3px 0 var(--accent)}',
      '.is-step .n{display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;background:var(--panel2);margin-right:6px;font-size:11px}',
      '.is-media-now{margin:8px 0;color:var(--muted)}.is-step.done .n{background:var(--real);color:#fff}.is-step.blocked .n{background:#c0392b;color:#fff}',
      '.is-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px}',
      '.is-layout.nodrawer{grid-template-columns:minmax(0,1fr)}',
      '@media(max-width:1000px){.is-layout{grid-template-columns:minmax(0,1fr)}.is-drawer{position:fixed;inset:auto 0 0 0;max-height:60vh;overflow:auto;z-index:20;border-radius:12px 12px 0 0}}',
      '.is-drawer{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;align-self:start;position:sticky;top:64px}',
      '.is-panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:var(--shadow-sm)}',
      '.is-panel h3{margin:0 0 6px;font-size:15px}',
      '.is-list{margin:6px 0 0;padding-left:18px}.is-list li{margin:3px 0}',
      '.is-block{background:#fbf0ee;border:1px solid #e7c3bd;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:13px}',
      '.is-warnbox{background:#fff8ec;border:1px solid #f0d7a8;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:13px}',
      '.is-vdock{position:sticky;bottom:0;z-index:15;margin:16px -14px -14px;padding:10px 14px;background:var(--panel);border-top:2px solid #2f6f4f;box-shadow:0 -4px 12px rgba(0,0,0,.08);display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;font-size:14px}',
      '.is-vdock .is-vdock-text{flex:1 1 260px}.is-vdock .is-vdock-bar{height:6px;background:var(--line);border-radius:3px;margin-top:6px;overflow:hidden}.is-vdock .is-vdock-bar>i{display:block;height:100%;background:#2f6f4f}',
      '.is-spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:is-spin .8s linear infinite;vertical-align:-1px;margin-right:6px}@keyframes is-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.is-spin{animation:none}}',
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
      '.is-next-box{display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:12px 0 4px;padding:14px 16px;border-radius:12px;border:2px solid var(--accent);background:var(--panel)}',
      '.is-next-box.working{border-color:var(--line);background:var(--panel2)}.is-next-box.done{border-color:var(--real)}',
      // A stopped job is red, never the green of "your next step" (founder, 2026-11-07: an error shown in a green tile).
      '.is-next-box.failed{border-color:#c0392b;background:#fbf0ee}.is-next-box.failed .is-next-head{color:#9b2c1f}',
      '.is-next-head{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--accent)}',
      '.is-next-box.working .is-next-head{color:var(--muted)}.is-next-body{font-size:16px;margin-top:4px}',
      '.is-next-title{font-size:20px;font-weight:700;margin:2px 0 4px}.is-next-why{color:var(--muted);font-size:14px;margin:0 0 10px}',
      '.is-path{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:6px}.is-path li{display:flex;gap:10px;align-items:center;font-size:15px;color:var(--muted)}',
      '.is-path .n{flex:none;width:24px;height:24px;border-radius:50%;border:1.5px solid var(--line);display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}',
      '.is-path li.now{color:var(--ink);font-weight:700}.is-path li.now .n{background:var(--accent);border-color:var(--accent);color:#fff}.is-path li.now .tag{font-size:12px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.04em}',
      '.is-linkbtn{background:none;border:0;padding:6px 4px;color:var(--accent);text-decoration:underline;cursor:pointer;font:inherit;font-size:14px}',
      '.is-libgroup{margin:16px 0 8px;font-size:15px}',
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
  // Whose turn it is (docs/impact-stories.sql _hs_is_status 'owner'); worked out here only for an older server.
  function ownerOf(st) {
    st = st || {};
    if (st.owner) return st.owner;
    var j = st.job; if (j && (j.status === 'queued' || j.status === 'running') && !j.not_started) return 'working';
    return st.stage === 'archived' ? 'archived' : st.stage === 'distribution' ? 'done' : 'you';
  }
  var OWNER = { you: ['Needs you', 'warn'], working: ['Working on it', 'wait'], done: ['Done', 'ok'], archived: ['Archived', 'wait'] };
  function ownerBadge(st) { var o = OWNER[ownerOf(st)] || OWNER.you; return '<span class="is-badge ' + o[1] + '">' + esc(o[0]) + '</span>'; }
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
    var opts = (S.catalog || []).map(function (c) { return '<option value="' + esc(c.slug) + '">' + esc(c.title) + '</option>'; }).join('');
    S.el.innerHTML = '<div class="is-wrap">' + libraryHead(opts) +
      '<div id="is-libcards-host">' + libraryCards() + '</div>' +
      '<div id="is-hot" style="margin-top:12px"></div>' +
      '<div id="is-engage" style="margin-top:12px"></div>' +
      '</div>';
    S.msg = null;
    var hot = S.el.querySelector('#is-hot');
    if (hot && HS.acqImpactDiscovery) HS.acqImpactDiscovery.attach(S.client, hot, function (id) { return openStory(id, null, true); });
    // Engage on Bluesky: its own section and its own data; it shares a discovered topic with Hot Topics, never a story
    var eng = S.el.querySelector('#is-engage');
    if (eng && HS.acqImpactEngagement) HS.acqImpactEngagement.attach(S.client, eng);
    scheduleLibraryPoll();
  }

  // The library updates by itself while any story is being worked on (founder, 2026-11-07: "the update in needs you
  // needs to be automatic once i review and complete an action"). Only the story cards are redrawn, so the search box,
  // the New story form, Hot Topics and Engage keep what is typed in them.
  function scheduleLibraryPoll() {
    clearTimeout(S.libTimer);
    var busy = (S.stories || []).some(function (s) { return ownerOf(s.status) === 'working'; });
    if (!busy || S.open) return;
    S.libTimer = setTimeout(function () {
      if (S.open || !S.el || !document.body.contains(S.el)) return;
      rpc('hs_impact_story_list').then(function (r) {
        var host = S.el.querySelector('#is-libcards-host');
        if (S.open || !host) return;
        S.stories = r || []; host.innerHTML = libraryCards(); scheduleLibraryPoll();
      }, function () { scheduleLibraryPoll(); });
    }, POLL_MS);
  }

  function libraryCards() {
    var q = S.q.toLowerCase();
    var list = (S.stories || []).filter(function (s) {
      var lib = s.status && s.status.library;
      if (S.filter === 'all' ? lib === 'archived' : lib !== S.filter) return false;
      return !q || (numTag(s) + ' ' + s.title + ' ' + (s.place || '') + ' ' + s.video_slug).toLowerCase().indexOf(q) >= 0;
    });
    function card(s) {
      var st = s.status || {}, own = ownerOf(st);
      return '<article class="is-card" aria-label="' + esc(numTag(s) + ' ' + s.title) + '"><h4>' + (s.story_number ? '<span class="is-muted">' + esc(numTag(s)) + '</span> ' : '') + esc(s.title) + '</h4>' +
        '<div class="is-row">' + ownerBadge(st) +
        (st.fresh === false && s.verified_at ? '<span class="is-badge bad">Sources out of date</span>' : '') +
        (s.story_type && s.story_type !== 'investigative' ? '<span class="is-badge emo">' + esc(typeLabel(s.story_type)) + '</span>' : '') +
        (s.archived ? '' : deadlineBadge(s.deadline)) + '</div>' +
        (s.research_title ? '<div class="is-muted" style="margin-top:6px">Shares verified research with “' + esc(s.research_title) + '”</div>' : '') +
        '<div class="is-muted" style="margin-top:6px">' + esc(s.place || s.video_slug) + ' · updated ' + esc(fmt(s.updated_at)) +
        (s.origin === 'auto_discovery' ? ' · found automatically' : '') + '</div>' +
        '<div class="is-next">' + (own === 'working' ? 'Now: ' : own === 'done' ? '' : 'Your next step: ') + '<b>' + esc(st.next || '') + '</b></div>' +
        '<div class="is-row" style="margin-top:10px"><button class="is-btn primary" data-act="open" data-id="' + esc(s.id) + '">Open</button>' +
        '<button class="is-btn" data-act="dup" data-id="' + esc(s.id) + '">Duplicate as new story</button>' +
        (s.archived ? '<button class="is-btn" data-act="restore" data-id="' + esc(s.id) + '">Restore</button>'
                    : '<button class="is-btn warn" data-act="archive" data-id="' + esc(s.id) + '">Archive</button>') + '</div></article>';
    }
    // On "All", the stories are grouped by whose turn it is (UI audit 2026-11-03): what needs you comes first.
    var cards = '';
    if (S.filter === 'all') {
      [['you', 'Needs you'], ['working', 'Working on it — nothing needed from you'], ['done', 'Done']].forEach(function (g) {
        var inG = list.filter(function (s) { return ownerOf(s.status) === g[0]; });
        if (inG.length) cards += '<h3 class="is-libgroup">' + esc(g[1]) + ' <span class="is-muted">(' + inG.length + ')</span></h3><div class="is-cards">' + inG.map(card).join('') + '</div>';
      });
    } else if (list.length) cards = '<div class="is-cards">' + list.map(card).join('') + '</div>';
    return cards ? '<div class="is-libcards">' + cards + '</div>' : '<div class="card"><p class="is-muted">' +
        ((S.stories || []).length ? 'No stories match this filter.' : 'No Impact Stories yet. Press New story and choose a verified project.') + '</p>' +
        (S.filter === 'published' ? '<p class="is-muted">Publishing for Impact Stories is not built yet, so this list is empty by design.</p>' : '') + '</div>';
  }

  function libraryHead(opts) {
    return       '<div class="card"><div class="is-head"><div><h3>17 · Impact Stories</h3><p class="sub">Emotion-led investigations written only from verified public records. One main investigation, up to two distinct Shorts, platform copy for YouTube, TikTok and Bluesky. Nothing here publishes.</p></div>' +
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
      '</div></div>';
  }

  // ── WORKSPACE ────────────────────────────────────────────────────────────────────────────────────────
  function openStory(id, step, push) {
    if (S.dirty && S.open !== id && !confirm('You have unsaved changes. Leave without saving?')) return;
    S.open = id; S.step = knownStep(step); S.dirty = false; S.draft = null; S.drawer = null; S.approvedBody = {}; S.vask = null; S.vbusy = null; S.vlast = null;
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
    return { intake: 'intake', sources_needed: 'intake', outline: 'outline', script: 'script', visuals: 'visuals', media: 'media', distribution: 'distribution', archived: 'intake' }[st && st.stage] || 'intake';
  }

  function schedulePoll() {
    clearTimeout(S.timer);
    var j = S.data && S.data.status && S.data.status.job;
    var fb = S.data && S.data.media && S.data.media.fix_batch;
    var fixing = fb && FIX_ACTIVE[fb.status];   // the Fix job starts within a minute (plan run, then work run)
    if (S.open && ((j && (j.status === 'queued' || j.status === 'running')) || fixing) && S.el && document.body.contains(S.el)) {
      // while the founder is writing a script revision, the page waits (a redraw would move the cursor)
      S.timer = setTimeout(function () { if (S.open && !S.csEd) refresh(false); else if (S.open) schedulePoll(); }, POLL_MS);
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
    if (id === 'visuals') {
      var vs = (S.data.visuals || {}).state;
      return vs === 'approved' ? 'done' : (vs === 'needs_fixes' || vs === 'blocked' || vs === 'failed' ? 'blocked' : '');
    }
    var m = S.data.media || {};
    if (id === 'media') return m.complete ? 'done' : m.blocked ? 'blocked' : !m.current ? '' : ((m.files || []).some(function (f) { return f.state === 'blocked' || f.state === 'rejected'; }) ? 'blocked' : '');
    return '';
  }

  function renderWorkspace() {
    var d = S.data, s = d.story, st = d.status, p = d.pack || {};
    var job = st.job;
    var running = job && (job.status === 'queued' || job.status === 'running');
    var header = '<div class="is-head"><div><button class="is-btn" data-act="back">← Library</button>' +
      '<h3 style="margin:10px 0 2px">' + (s.story_number ? '<span class="is-muted">' + esc(numTag(s)) + '</span> ' : '') + esc(s.title) + '</h3><div class="is-muted">' + esc(s.place || p.title || s.video_slug) +
      ' · ' + (p.verified_at ? 'sources checked ' + esc(day(p.verified_at)) + (st.fresh ? '' : ' <span class="is-badge bad">out of date</span>') : 'sources not checked yet') +
      ' · version ' + esc(s.current_version) + ' · ' + (S.dirty ? '<span class="is-badge bad">Unsaved changes</span>' : '<span class="is-badge ok">Saved</span>') + '</div></div>' +
      '</div>';
    var jobBar = researchPanel() + nextBox(st, job, running);
    var steps = '<ol class="is-steps" aria-label="Story steps">' + STEPS.map(function (x, i) {
      var cls = stepState(x.id);
      return '<li><button class="is-step ' + cls + '" data-act="step" data-step="' + x.id + '"' + (S.step === x.id ? ' aria-current="step"' : '') + '><span class="n">' + (cls === 'done' ? '✓' : (i + 1)) + '</span>' + esc(x.label) + '</button></li>';
    }).join('') + '</ol>';
    var body = { intake: viewIntake, outline: viewOutline, script: viewScript, visuals: viewPreviews, media: viewMedia, distribution: viewDistribution, results: viewResults }[S.step]();
    var drawer = S.drawer ? viewDrawer() : '';
    S.el.innerHTML = '<div class="is-wrap"><div class="card">' + header + steps + jobBar +
      (S.msg ? '<div class="' + (S.msg.bad ? 'is-block' : 'is-okbox') + '" role="status">' + esc(S.msg.text) + '</div>' : '') + '</div>' +
      '<div class="is-layout' + (drawer ? '' : ' nodrawer') + '"><div>' + body + '</div>' + drawer + '</div>' + viewHistory() + '</div>';
    S.msg = null;
    lockChoose(!!S.choosing);
    if (S.step === 'visuals') loadPreviews();
    if (S.step === 'script' && S.doc === 'board') loadBoardPreviews();
  }

  // ONE box that always answers "what do I do now?" (UI audit 2026-11-03): your next step with one button, or what is
  // running and that nothing is needed, or what failed with Retry. A finished job is not news and is not shown.
  // "Videos from this research" + "Create another video from this research" (founder, 2026-11-06). Each video is its own
  // story with its own script, approvals, render and publication; a new one reuses this research's verified claims
  // (re-checked by the engine on every build) and never changes this story. The database refuses a second video of the
  // same story type from one research.
  function researchPanel() {
    var d = S.data, s = d.story, vids = d.research_videos || [], used = {};
    vids.forEach(function (v) { if (!v.archived) used[v.story_type || 'investigative'] = v.title; });
    var me = vids.filter(function (v) { return v.current; })[0] || {};
    var list = vids.length > 1 ? '<ul class="is-list" style="margin:6px 0 0">' + vids.map(function (v) {
      return '<li>' + (v.current ? '<b>' + esc(v.title) + '</b> <span class="is-muted">(this video)</span>'
                                 : '<button class="is-btn" data-act="open" data-id="' + esc(v.id) + '">' + esc(v.title) + '</button>') +
        ' <span class="is-badge emo">' + esc(typeLabel(v.story_type)) + '</span>' + (v.original ? ' <span class="is-muted">original research</span>' : '') +
        (v.archived ? ' <span class="is-muted">archived</span>' : ' ' + deadlineBadge(v.deadline)) +
        (v.next && !v.current ? ' <span class="is-muted">— ' + esc(v.next) + '</span>' : '') + '</li>';
    }).join('') + '</ul>' : '';
    var free = Object.keys(PTYPE).filter(function (k) { return !used[k]; });
    var form = '';
    if (S.another && !s.archived_at) {
      var av = S.av, sel = av.story_type || free[0] || '';
      form = '<div class="is-panel" style="margin-top:8px"><h3>Create another video from this research</h3>' +
        '<p class="is-muted">The new video reuses the verified records of this research, adds and checks what it needs (for example the agency’s registration page), and gets its own script, Shorts, approvals, render and publication. This story is not changed.</p>' +
        (free.length ? '<label>Story type of the new video <select class="is-in" id="is-av-type" data-av="story_type">' + free.map(function (k) {
          return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(typeLabel(k)) + '</option>'; }).join('') + '</select></label>' +
        '<label style="display:block;margin-top:8px">Title <input class="is-in" id="is-av-title" data-av="title" maxlength="300" style="width:100%" value="' + esc(av.title || '') + '" placeholder="e.g. How to register to speak at the public hearing"></label>' +
        '<label style="display:block;margin-top:8px">What this video should do for residents <span class="is-muted">(optional brief)</span><textarea class="is-in" id="is-av-note" data-av="note" rows="3" maxlength="12000" style="width:100%">' + esc(av.note || '') + '</textarea></label>' +
        '<label style="display:block;margin-top:8px">Links to the agency’s pages <span class="is-muted">(one per line, optional; leads to check, not evidence)</span><textarea class="is-in" id="is-av-links" data-av="links" rows="2" style="width:100%">' + esc(av.links || '') + '</textarea></label>' +
        '<p class="is-muted">A deadline is taken from the agency’s own record by research, never typed here.</p>' +
        '<div class="is-row" style="margin-top:10px"><button class="is-btn primary" data-act="anothersend"' + (S.anotherBusy ? ' disabled' : '') + '>' + (S.anotherBusy ? 'Starting…' : 'Start research for the new video') + '</button><button class="is-btn" data-act="anothercancel">Cancel</button></div>'
          : '<div class="is-warnbox">A video of every story type already exists for this research.</div><button class="is-btn" data-act="anothercancel">Close</button>') + '</div>';
    }
    return '<div class="is-sec" style="margin:8px 0"><div class="is-row"><b>' + (vids.length > 1 ? 'Videos from this research (' + vids.length + ')' : esc(typeLabel(me.story_type))) + '</b>' +
      deadlineBadge(me.deadline) +
      (!s.archived_at && !S.another ? '<button class="is-btn" data-act="another">Create another video from this research</button>' : '') + '</div>' + list + form + '</div>';
  }

  // Why "Prepare the visuals" stopped, read from the engine's failure codes (homesignal-ingest render/build.py stops on
  // missing_essential_image, outdated_status and needs_more_photos). Every stop used to read "no photo found": on
  // 2026-11-07 the House Speaker story stopped on an Outdated status (a news page's headline) and the page told the
  // founder the photo search needed fixing.
  // Newer events the latest-development check named with a key (homesignal-ingest impact/currency.py event_key). The
  // founder can set them aside ("Not about this story"); the next check then lists them as dismissed instead of stopping.
  // A check run before keys existed names none, and then the page offers only Prepare again.
  function hostOf(u) { var m = /^https?:\/\/([^\/]+)/.exec(u || ''); return m ? m[1].replace(/^www\./, '') : 'our notices'; }
  function dismissKeys(vb) {
    var evs = (vb && vb.currency && vb.currency.events) || [], seen = {};
    return evs.map(function (e) { return e && e.key; }).filter(function (k) { return /^[0-9a-f]{16}$/.test(k || '') && !seen[k] && (seen[k] = true); });
  }
  // then: 'prepare' (a stopped Prepare, the Visuals step) or 'render' (a stopped render, Media review: the pictures are
  // already approved, so it renders again rather than preparing new pictures that would need approving).
  function dismissBtn(vb, then) {
    var keys = dismissKeys(vb), render = then === 'render';
    return keys.length ? '<button class="is-btn primary" data-act="cdismiss" data-then="' + (render ? 'render' : 'prepare') + '" data-keys="' + esc(keys.join(',')) + '">' +
      (render ? 'Not about this story — render again' : 'Not about this story — continue preparing') + '</button>' : '';
  }
  // "Update the story with this news" (founder, 2026-11-07: "there are no buttons to give me options to do something"):
  // the other answer to the same stop. One research note naming the news, then Fix (plan, you confirm, work).
  function updateBtn(vb) {
    var keys = dismissKeys(vb);
    return keys.length ? '<button class="is-btn" data-act="curupdate" data-keys="' + esc(keys.join(',')) + '">Update the story with this news</button> ' : '';
  }
  function visualsStop(vb) {
    var fs = (vb && vb.failures) || [], codes = {};
    fs.forEach(function (f) { (codes[f.code] = codes[f.code] || []).push(f); });
    var parts = [], head;
    if (codes.missing_essential_image) {
      var need = codes.missing_essential_image.map(function (f) { return String(f.detail || '').split(':')[0]; }).filter(Boolean);
      // The engine searches and uses licensed photos itself (founder, 2026-11-04: "i never upload. the code is
      // responsible for finding pics"), so this stop means its search found nothing usable: the code's to fix.
      parts.push('the photo search found no usable licensed photo of ' + (need.length ? need.join(' or ') : 'a subject') +
        '. Nothing is needed from you for this; the photo search needs fixing. Ask Claude in a Claude Code session to fix the photo search for this story.');
      head = 'Stopped: no photo found';
    }
    if (codes.outdated_status) {
      var seen = {}, what = codes.outdated_status.map(function (f) { return String(f.detail || '').slice(0, 160); })
        .filter(function (d) { return d && !seen[d] && (seen[d] = true); });
      parts.push('a source read again today shows something newer than the script says' + (what.length ? ': "' + what.join('"; "') + '"' : '') +
        '. ' + (dismissKeys(vb).length ? 'If it is about this story, click Update the story with this news: Claude reads the newest record and shows you a plan to confirm. '
          : 'If that is an update about this story, ask Claude in a Claude Code session to update the script from the newest record, then approve it again. ') +
        (dismissKeys(vb).length ? 'If it is not about this story, click Not about this story — continue preparing: the check sets it aside and the visuals are prepared again.'
          : 'If it is not about this story, click Prepare the visuals again. If it stops on the same thing again, a Not about this story button appears so you can set it aside and continue.'));
      head = head ? 'Stopped: no photo found, and a source changed' : 'Stopped: a source shows something newer';
    }
    if (codes.needs_more_photos) {
      parts.push('more photos are wanted. Choose a licensed photo for each subject listed below, or prepare the visuals again without choosing.');
      head = head || 'Stopped: more photos wanted';
    }
    if (!parts.length) {
      parts.push((vb && vb.error) || 'the engine gave no reason. Click Prepare the visuals again.');
      head = 'Preparing stopped';
    }
    return { head: head, body: 'Preparing the visuals stopped: ' + parts.join(' Also, ') + ' Nothing was rendered.' };
  }

  function nextBox(st, job, running) {
    var pfb = (S.data.media || {}).fix_batch;
    if (pfb && pfb.status === 'planned') return planBox(pfb);
    var own = ownerOf(st), retry = job && (job.status === 'failed' || job.stuck)
      ? ' <button class="is-btn" data-act="retry" data-id="' + esc(job.id) + '">Retry</button>' : '';
    var head, body, btn = '';
    var vb = (S.data.visuals || {}).blocked, mb = (S.data.media || {}).blocked;
    if (job && job.status === 'failed' && job.kind === 'visuals' && vb && vb.blocked && vb.job_id === job.id) {
      // Preparing stopped on purpose (an essential photo is missing): nothing crashed, and Retry would stop again the
      // same way (Menomonie, 2026-11-04).
      var why = visualsStop(vb);
      head = why.head; body = esc(why.body);
      btn = updateBtn(vb) + dismissBtn(vb) + (S.step === 'visuals' ? '' : '<button class="is-btn" data-act="step" data-step="visuals">Open Visuals</button>');
    } else if (job && job.status === 'failed' && job.kind === 'render' && mb && mb.job_id === job.id && dismissKeys(mb).length) {
      // The render stopped on purpose: a source read again shows something newer than the script says. Retry would stop
      // the same way, so the two real answers are offered instead (EPA methane story, 2026-11-07).
      var rseen = {}, rwhat = ((mb.currency || {}).events || []).filter(function (e) { return e && /^[0-9a-f]{16}$/.test(e.key || '') && !rseen[e.key] && (rseen[e.key] = true); })
        .map(function (e) { return '"' + String(e.summary || '').slice(0, 220) + '" (' + hostOf(e.source) + ')'; });
      head = 'Stopped: a source shows something newer';
      body = esc('Nothing was rendered. A source read again today shows something the script does not tell yet: ' + rwhat.join('; ') +
        '. If it is about this story, click Update the story with this news: Claude reads the newest record and shows you a plan to confirm. ' +
        'If it is not about this story, click Not about this story: the check sets it aside and the videos are rendered again.');
      btn = updateBtn(mb) + dismissBtn(mb, 'render');
    } else if (pictureDrift(job)) {
      return pictureDriftBox(ownerOf(st));
    } else if (job && job.status === 'failed') {
      own = 'failed'; head = 'Something went wrong'; body = (JOB_LABEL[job.kind] || job.kind) + ': ' + jobText(job); btn = retry + primaryAction(st, false);
    } else if (running && !job.not_started) {
      head = 'Working on it'; btn = retry;
      body = '<span class="is-spin" aria-hidden="true"></span>' + esc(st.next) + ' Started ' + esc(fmt(job.started_at || job.created_at)) + '. ' +
        (job.stuck ? jobText(job) : 'Nothing is needed from you; you can leave this page and it updates on its own.');
    } else if (own === 'done') {
      head = 'Done'; body = esc(st.next); btn = primaryAction(st, false);
    } else {
      var mbs = st.stage === 'media' ? mediaStep() : null;
      if (mbs && mbs.working) {
        return '<div class="is-next-box working" id="is-next-box" role="status" aria-live="polite"><div><div class="is-next-head">Working on it</div>' +
          '<div class="is-next-body"><span class="is-spin" aria-hidden="true"></span>' + esc(mbs.text) + '</div></div></div>';
      }
      head = 'Your next step'; body = esc(mbs ? mbs.text : st.next) + (job && job.not_started ? ' ' + jobText(job) : ''); btn = (job && job.not_started ? retry : '') + primaryAction(st, false);
    }
    return '<div class="is-next-box ' + esc(own) + '" id="is-next-box" role="status" aria-live="polite"><div><div class="is-next-head">' + esc(head) +
      '</div><div class="is-next-body">' + body + '</div></div><div class="is-row">' + btn + '</div></div>';
  }

  // A render refused because the planned pictures no longer match the approved set (the engine's VisualsChanged; founder,
  // 2026-11-06: "i have no idea if it is fixing requests or i am supposed to press retry"). Retry can only fail the same
  // way, so it is never offered: the step is to prepare the pictures again, or, when fix requests are waiting, to send
  // those first, because a fix changes the script and the pictures would need approving again anyway.
  function pictureDrift(job) {
    return !!(job && job.kind === 'render' && job.status === 'failed' &&
      (job.visuals_changed === true || /pictures changed since you approved/i.test(job.error || '')));
  }
  function unsentFixes() {
    var m = S.data.media || {};
    return (m.fix_requests || []).filter(function (x) { return /^Not sent|press Fix/.test(fixState(x)[1]); }).length;
  }
  // The one box for a refused render (design audit 2026-11-06, founder: "that is unclear make the design better"):
  // one sentence that says what to do, one line why, the numbered path to finished videos with "you are here", one
  // green button, the alternative as a plain link, and "Why not Retry?" folded away.
  function pictureDriftStep() {
    var fb = (S.data.media || {}).fix_batch, n = unsentFixes(), req = n + ' fix request' + (n === 1 ? '' : 's');
    var why = 'The last render stopped before making anything, and nothing was lost. The video code was updated after you approved the pictures, so they need approving again.';
    var tail = ['Approve the updated story', 'Prepare the pictures and approve them', 'Render the videos'];
    var prep = function (primary) {
      return primary ? '<button class="is-btn primary" data-act="vprep" data-new="1">Prepare the pictures again</button>'
                     : '<button class="is-linkbtn" data-act="vprep" data-new="1">Skip the fixes and prepare the pictures now</button>';
    };
    if (fb && fb.status === 'planned') {
      return { owner: 'you', title: 'Read Claude’s plan and confirm it', why: why, now: 1,
        steps: ['Send your fix requests to Claude', 'Read Claude’s plan and confirm it'].concat(tail),
        btn: '<button class="is-btn primary" data-act="step" data-step="media">Read the plan</button>' };
    }
    if (fb && FIX_ACTIVE[fb.status]) {
      var planning = fb.status === 'plan_queued' || fb.status === 'planning';
      return { owner: 'working', title: planning ? 'Claude is writing its plan' : 'Claude is making your fixes', why: 'Nothing is needed from you now. This page updates on its own.',
        now: planning ? 1 : 2, steps: ['Send your fix requests to Claude', planning ? 'Claude writes a plan; you confirm it' : 'Read Claude’s plan and confirm it',
          'Claude makes the changes'].concat(tail), btn: '' };
    }
    if (n) {
      return { owner: 'you', title: 'Send your ' + req + ' to Claude', why: why, now: 0,
        steps: ['Send your ' + req + ' to Claude', 'Read Claude’s plan and confirm it'].concat(tail),
        btn: '<button class="is-btn primary" data-act="fixstart">Send ' + req + '</button>' + prep(false),
        note: 'Send the fixes first: they change the script and pictures, so preparing the pictures now would mean doing it twice.' };
    }
    return { owner: 'you', title: 'Prepare the pictures again', why: why, now: 0,
      steps: ['Prepare the pictures (about 10 to 20 minutes)', 'Approve the pictures', 'Render the videos'], btn: prep(true) };
  }
  function pictureDriftBox() {
    var d = pictureDriftStep();
    var path = '<ol class="is-path" aria-label="Steps to finished videos">' + d.steps.map(function (t, i) {
      var cls = i < d.now ? 'done' : i === d.now ? 'now' : '';
      return '<li class="' + cls + '"' + (i === d.now ? ' aria-current="step"' : '') + '><span class="n">' + (i < d.now ? '✓' : i + 1) + '</span>' +
        '<span>' + esc(t) + '</span>' + (i === d.now ? ' <span class="tag">' + (d.owner === 'working' ? 'in progress' : 'you are here') + '</span>' : '') + '</li>';
    }).join('') + '</ol>';
    return '<div class="is-next-box ' + esc(d.owner) + '" id="is-next-box" role="status" aria-live="polite" style="display:block">' +
      '<div class="is-next-head">' + (d.owner === 'working' ? 'Working on it' : 'Your next step') + '</div>' +
      '<div class="is-next-title">' + (d.owner === 'working' ? '<span class="is-spin" aria-hidden="true"></span>' : '') + esc(d.title) + '</div>' +
      '<p class="is-next-why">' + esc(d.why) + '</p>' + path +
      (d.btn ? '<div class="is-row">' + d.btn + '</div>' : '') +
      (d.note ? '<p class="is-muted" style="margin:8px 0 0">' + esc(d.note) + '</p>' : '') +
      '<details style="margin-top:8px"><summary class="is-muted">Why not Retry?</summary><p class="is-muted">Retry would start the same render, which would stop the same way, ' +
      'because the pictures it plans no longer match the ones you approved.</p></details></div>';
  }

  // A plan waiting for you is shown IN the top box, under a PLAN heading, with Confirm and Cancel right there (founder,
  // 2026-11-07: "where is the fucking plan to read", "nothing has header PLAN"). It was a button that pointed at a copy
  // buried at the bottom of Fix requests.
  function planBox(fb) {
    return '<div class="is-next-box you" id="is-next-box" role="status" aria-live="polite" style="display:block">' +
      '<div class="is-next-head">Your next step</div>' +
      '<div class="is-next-title">PLAN: read what Claude will change, then confirm</div>' +
      '<p class="is-next-why">Claude read your fix requests and wrote this plan. Nothing has changed yet. Confirm to make exactly these changes, or cancel.</p>' +
      fixPlan(fb, (S.data.media || {}).fix_requests || []) + '</div>';
  }

  // While a photo choice saves, every "Add to your photos" / "Remove" button on screen is disabled, including buttons drawn by a redraw
  // during the save (e.g. switching video tabs).
  function lockChoose(on) {
    if (!S.el) return;
    Array.prototype.forEach.call(S.el.querySelectorAll('[data-act="choose"],[data-act="unchoose"]'), function (b) { b.disabled = on; });
  }

  function jobText(j) {
    var lim = j.kind === 'render' || j.kind === 'visuals' ? '5 hours 45 minutes' : '40 minutes';
    if (j.status === 'queued' && j.not_started) return '<span style="color:#9b2c1f">' + esc(j.error || 'The job did not start.') + '</span>';
    if (j.status === 'queued') return j.stuck ? 'Queued for over ' + lim + '. The worker may not have started.' : 'Queued. The worker starts within a minute or two.';
    if (j.status === 'running') return j.stuck ? 'Running for over ' + lim + '; it may have stopped.' : 'Running since ' + esc(fmt(j.started_at)) + (j.kind === 'render' ? '. A render takes about 1 to 3 hours.' : '.');
    if (j.status === 'failed') return '<span style="color:#9b2c1f">Failed (attempt ' + esc(j.attempts) + '): ' + esc(j.error || 'no reason recorded') + '</span>';
    if (j.status === 'superseded') return 'Finished, but you saved a newer version while it ran, so its result was not applied.';
    return 'Complete ' + esc(fmt(j.completed_at)) + '.';
  }

  // The database says the script did not pass its checks, so Approve is off: the step is fixing it, not approving it.
  function narrativeBlocked(st) { return (((st || {}).artifacts || {}).narrative || {}).state === 'blocked'; }

  // Videos that failed the automatic picture checks can never be approved, so "Review each video" would repeat forever
  // (founder, 2026-11-06: "i keep getting the same your next step over an over"). The step is then the one thing that
  // changes the videos: send the waiting fix requests, render again when only the renderer missed, or save a fix
  // request for each blocked video, filled in with what failed.
  function blockedVideos() {
    var m = S.data.media || {};
    if (!m.current) return [];
    return (m.files || []).filter(function (f) { return f.state === 'blocked' && f.asset !== 'thumbnail'; });
  }
  // Videos that failed the checks are fixed before you are asked to watch anything (founder, 2026-11-07: "if you have to
  // fix things, than you should fix before i have to watch"). The database starts this by itself when a render finishes
  // (_hs_is_auto_fix): it renders again when only the renderer missed, otherwise it sends the failed checks to Claude,
  // which fixes them without waiting for a confirm. Only the fixed version is shown for review.
  function autoFixing() { var fb = (S.data.media || {}).fix_batch; return !!(fb && fb.auto && FIX_ACTIVE[fb.status]); }
  function autoFixText() {
    var n = blockedVideos().length;
    return (n ? n + ' video' + (n === 1 ? '' : 's') + ' did not pass the automatic checks, so ' + (n === 1 ? 'it is' : 'they are') + ' not shown. ' : '') +
      'Claude is fixing ' + (n === 1 ? 'it' : 'them') + ' now. Nothing is needed from you; you review only the fixed version.';
  }
  // What the top box says on Media review when it is your turn. A fix plan waiting for you comes first, whatever else
  // is on the page.
  function mediaStep() {
    var fb = (S.data.media || {}).fix_batch;
    if (fb && fb.status === 'planned') return { text: 'Claude read your fix requests and wrote what it will change. Nothing has changed yet. Read the plan below, then press Confirm (or Cancel).',
      btn: '<button class="is-btn primary" data-act="readplan">Read Claude’s plan</button>' };
    if (fb && fb.auto && FIX_ACTIVE[fb.status]) return { working: true, text: autoFixText() };
    if (fb && FIX_ACTIVE[fb.status]) return { working: true, text: (fb.status === 'plan_queued' || fb.status === 'planning'
      ? 'Claude is reading your fix requests and writing a plan (a few minutes). Nothing changes until you confirm it.'
      : 'Claude is making the fixes you confirmed.') + ' Nothing is needed from you now; this page updates on its own.' };
    return mediaBlockedStep();
  }
  function mediaBlockedStep() {
    var bl = blockedVideos(), m = S.data.media || {}, fb = m.fix_batch;
    if (!bl.length) return null;
    var n = unsentFixes(), names = bl.map(function (f) { return ASSET_LABEL[f.asset] || f.asset; }).join(', ');
    var why = names + ' did not pass the picture checks, so ' + (bl.length === 1 ? 'it' : 'they') + ' cannot be approved. ';
    if (n) return { text: why + 'Send your ' + n + ' fix request' + (n === 1 ? '' : 's') + ' to Claude. It writes a plan first and changes nothing until you confirm.',
      btn: '<button class="is-btn primary" data-act="fixstart">Send ' + n + ' fix request' + (n === 1 ? '' : 's') + '</button>' };
    if (bl.every(renderAgainHelps)) return { text: why + 'The renderer did not draw what was planned, so rendering again can fix it (about 1 to 3 hours).',
      btn: '<button class="is-btn primary" data-act="render" data-new="1">Render the videos again</button>' };
    return { text: why + 'Rendering again would make the same videos. Save a fix request for each one (filled in with what failed), then send them to Claude.',
      btn: '<button class="is-btn primary" data-act="fixblocked">Save fix requests for ' + bl.length + ' blocked video' + (bl.length === 1 ? '' : 's') + '</button>' };
  }

  function topBoxSendsFixes() {
    var st = S.data.status || {}, j = st.job;
    if (st.stage !== 'media' || ownerOf(st) !== 'you' || (j && (j.status === 'failed' || ((j.status === 'queued' || j.status === 'running') && !j.not_started)))) return false;
    var mb = mediaStep();
    return !!(mb && mb.btn && mb.btn.indexOf('data-act="fixstart"') >= 0);
  }

  function primaryAction(st, running) {
    if (running) return '<button class="is-btn primary" disabled>' + esc(st.next) + '</button>';
    if (S.dirty) return '<button class="is-btn primary" data-act="save">Save changes</button>';
    var s = st.stage;
    if (s === 'archived') return '<button class="is-btn primary" data-act="restore" data-id="' + esc(S.open) + '">Restore</button>';
    if (s === 'intake' || s === 'sources_needed') return '<button class="is-btn primary" data-act="req" data-kind="pack">' + esc(st.next === 'Sources needed' ? 'Re-check sources' : st.next) + '</button>';
    if (s === 'outline' && !S.draft.arc) return '<button class="is-btn primary" data-act="req" data-kind="analyze"' + (S.draft.angles ? ' data-new="1"' : '') + '>' + esc(S.draft.angles ? 'Analyze again' : 'Analyze story') + '</button>';
    if (s === 'outline') return '<button class="is-btn primary" data-act="req" data-kind="generate">Generate story</button>';
    if (s === 'script') return '<button class="is-btn primary" data-act="step" data-step="script">' +
      (narrativeBlocked(st) ? 'See what needs fixing' : 'Review and approve the integrated narrative') + '</button>';
    if (s === 'visuals') {
      var vs = (S.data.visuals || {}).state;
      // on the Visuals step the header names the same next step as the status bar: approve the set only when every part
      // is approved, otherwise go to the next part still waiting (founder asked for approval per act)
      if (vs === 'ready' && S.step === 'visuals') return visAllDone(S.data.visuals) ? '<button class="is-btn primary" data-act="vapprove">Approve the visuals</button>'
        : nextGroup(S.data.visuals) ? '<button class="is-btn primary" data-act="vnext">Show the next part to approve</button>' : '';
      if (vs === 'ready' || vs === 'needs_fixes' || vs === 'blocked') return '<button class="is-btn primary" data-act="step" data-step="visuals">' + esc(st.next) + '</button>';
      return '<button class="is-btn primary" data-act="vprep"' + ((S.data.visuals || {}).manifest_id ? ' data-new="1"' : '') + '>Prepare the visuals</button>';
    }
    if (s === 'media' && !(S.data.media && S.data.media.current)) return '<button class="is-btn primary" data-act="render">Render the videos</button>';
    if (s === 'media') { var mb = mediaStep(); if (mb) return mb.btn || ''; }
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
    return '<button class="is-claim' + (c ? '' : ' missing') + '" data-act="claim" data-id="' + esc(id) + '" title="' + esc(c ? c.status + ': ' + (c.quote || c.text) : 'Not in the source pack') + '">' + esc(chipText(c, id)) + '</button>';
  }
  // A chip reads as the first words of what the record says (UI audit 2026-11-03: ids like "dns_concl" meant nothing).
  function chipText(c, id) {
    var w = String((c && (c.text || c.quote)) || '').replace(/\s+/g, ' ').trim().split(' ');
    if (!c || w.length < 2 || w.join(' ') === id) return id;
    return w.slice(0, 5).join(' ') + (w.length > 5 ? '…' : '');
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
        : '<button class="is-btn primary" data-act="decide" data-a="' + artifact + '" data-d="approved"' + (S.dirty || a.state === 'blocked' || a.state === 'checking' ? ' disabled' + (a.state === 'blocked' ? ' title="Fix the problems listed below first"' : '') : '') + '>' + (isCreator() ? 'Approve &amp; Lock Script' : 'Approve') + '</button>' +
          '<button class="is-btn" data-act="decide" data-a="' + artifact + '" data-d="rejected"' + (S.dirty ? ' disabled' : '') + '>Request revision</button>') +
      (ld && ld.decision === 'approved' && a.state !== 'approved' ? '<button class="is-btn" data-act="diff" data-a="' + artifact + '" data-v="' + esc(ld.version) + '">Compare with approved version ' + esc(ld.version) + '</button>' : '') +
      '</div>' +
      (a.state === 'blocked' ? '<p class="is-muted" id="is-dec-blocked-' + artifact + '">Approve is off because the checks found problems, listed below. ' +
        'Write what to change with \u201cFix this line\u201d under each line, then press Fix. Approve turns on once the script passes.</p>' : '');
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
    return '<div class="is-warnbox"><b>Your revision notes</b> (Claude rewrites the draft from these notes; when it is done, the story comes back here for you to review):<ul class="is-list">' +
      r.slice(0, 5).map(function (e) { return '<li>' + esc(e.detail.note) + ' <span class="is-muted">on version ' + esc(e.detail.version) + ', ' + esc(fmt(e.at)) + '</span></li>'; }).join('') + '</ul></div>';
  }
  function reviseButton(section, label) {
    return '<button class="is-btn" data-act="revise" data-sec="' + esc(section) + '"' + (S.dirty ? ' disabled' : '') + '>Request revision' + (label ? ' of ' + esc(label) : '') + '</button>';
  }

  // impact-story/3: what residents could lose, the three concepts and their scores, the quality gate
  function line(l) { return l ? esc(l.text) + ' ' + chips(l.claims) : ''; }
  // Who did what, before approval: the owner, developer or operator, the party named in any violation, the
  // government's findings, the penalties and corrections, the organization's response, what is disputed or unknown,
  // and the sources. Missing attribution is flagged; the founder can ask for deeper research or a correction.
  function viewAccountability(m, r) {
    r = r || {};
    var head = '<h3 style="margin-top:16px">Accountability research</h3><p class="is-muted">Who did what, from the records only. Each party is named as a record names it, each role and action cites the record that states it, an allegation is kept apart from a finding, and owning the land is never treated as blame.</p>';
    var buttons = '<div class="is-row"><button class="is-btn" data-act="research"' + (S.dirty ? ' disabled' : '') + '>Request deeper research</button>' +
      reviseButton('accountability', 'who did what') + '</div>';
    if (!m) {
      return head + '<div class="is-block">Not researched yet: this draft has no responsibility map. Ask for deeper research before approving.</div>' +
        revisionNotes('accountability') + buttons;
    }
    var parties = {};
    (m.parties || []).forEach(function (p) { parties[p.id] = p; });
    var who = function (id) { var p = parties[id] || {}; return p.name || p.label || id; };
    var research = Object.keys(RESEARCH_LABEL).map(function (k) {
      var x = (m.researched || {})[k] || {};
      var badge = x.result === 'found' ? '<span class="is-badge ok">Found</span>' : x.result === 'not_applicable' ? '<span class="is-badge wait">Not applicable</span>'
        : x.result === 'not_found' ? '<span class="is-badge bad">Not found</span>' : '<span class="is-badge bad">Not researched</span>';
      return '<tr><td>' + esc(RESEARCH_LABEL[k]) + '</td><td>' + badge + '</td><td>' + (x.result === 'found' ? chips(x.claims) : esc(x.looked_in || '')) + '</td></tr>';
    }).join('');
    var ptab = (m.parties || []).map(function (p) {
      var roles = (p.roles || []).map(function (x) { return ROLE_LABEL[x] || x; }).join(', ');
      return '<tr><td><b>' + esc(p.name || p.label) + '</b>' + (p.name ? '' : ' <span class="is-badge wait">Name not in the records</span>') +
        '<div class="is-muted">' + esc(p.type) + '</div></td><td>' + esc(roles) + '</td><td>' +
        (p.parent ? 'Parent: ' + esc(p.parent.name) + ' ' + chips(p.parent.claims) + '<br>' : '') + chips(p.claims) +
        ((p.identity_questions || []).length ? '<div class="is-muted">Open: ' + (p.identity_questions || []).map(esc).join(' · ') + '</div>' : '') + '</td></tr>';
    }).join('');
    var atab = (m.attributions || []).map(function (a) {
      var st = ATTR_STATUS[a.status] || [a.status || 'No status', 'bad'], e = a.enforcement || {};
      var enf = e.type && e.type !== 'none' ? esc(e.type) + (e.state && e.state !== 'none' ? ', ' + esc(e.state) : '') + ' ' + chips(e.claims) : '';
      return '<tr><td><b>' + esc(who(a.party)) + '</b></td><td>' + line(a.action) + (a.date ? '<div class="is-muted">' + esc(a.date) + '</div>' : '') + '</td><td>' +
        '<span class="is-badge ' + st[1] + '">' + esc(st[0]) + '</span>' + (REVERSED[e.state] ? ' <span class="is-badge bad">Later ' + esc(e.state) + '</span>' : '') +
        '<div class="is-muted">' + esc(a.basis) + ' · confidence ' + esc(a.confidence) + '</div></td><td>' + (enf || '<span class="is-muted">None</span>') +
        (a.later_rulings ? '<div class="is-muted">Later rulings checked: ' + esc(a.later_rulings) + '</div>' : '') + '</td><td>' +
        (a.response ? line(a.response) : '<span class="is-muted">' + esc(a.response_none || 'Not given') + '</span>') +
        ((a.mitigating || []).length ? '<div>Mitigating: ' + chips(a.mitigating) + '</div>' : '') + '</td></tr>';
    }).join('');
    var opp = m.opportunity || {};
    var missing = r.missing || [];
    var leads = (r.leads && r.leads.names) || [];
    var known = (m.parties || []).map(function (p) { return (p.name || '').toLowerCase(); });
    var unmapped = leads.filter(function (n) { return known.indexOf(String(n.name || '').toLowerCase()) < 0; });
    return head +
      (r.verified === false ? '<div class="is-block">The responsibility check is failing; see the blocking findings below.</div>' : r.verified ? '<div class="is-row"><span class="is-badge ok">Responsibility check passes</span></div>' : '') +
      '<p><b>Accountability story:</b> <span class="is-badge ' + (opp.type && opp.type !== 'none' ? 'emo' : 'wait') + '">' + esc(opp.type === 'none' ? 'None in the records' : opp.type) + '</span> ' + esc(opp.why) + '</p>' +
      '<p><b>Who did what</b></p><table class="is-tab"><thead><tr><th>Party</th><th>Action, from the record</th><th>Status</th><th>Government finding or penalty</th><th>Response</th></tr></thead><tbody>' +
      (atab || '<tr><td colspan="5" class="is-muted">No action is attributed to anyone.</td></tr>') + '</tbody></table>' +
      '<p><b>Parties</b></p><table class="is-tab"><thead><tr><th>Name</th><th>Role</th><th>Records</th></tr></thead><tbody>' + ptab + '</tbody></table>' +
      '<details><summary>Research checklist</summary><table class="is-tab"><tbody>' + research + '</tbody></table></details>' +
      (missing.length ? '<div class="is-warnbox"><b>Missing attribution:</b> ' + missing.map(esc).join(' · ') + '</div>' : '') +
      (unmapped.length ? '<div class="is-warnbox"><b>Names in the records not in the map</b> (check each): ' + unmapped.slice(0, 12).map(function (n) { return esc(n.name); }).join(' · ') + '</div>' : '') +
      revisionNotes('accountability') + buttons;
  }
  // Public Participation / How-To (2026-11-06; engine homesignal-ingest impact/participation.py): what the viewer is asked to
  // do, the official link and the deadline, each with the records that state it, and the engine's verdict. This page decides
  // nothing: the status, the deadline state and the unresolved list come from the version's checks (validation.participation).
  var PSTATUS = { ready: ['Ready for Review', 'ok'], needs_evidence: ['Needs Evidence', 'wait'], expired: ['Expired', 'bad'], blocked: ['Blocked', 'bad'] };
  var PTYPE = { investigative: 'Investigative', public_policy: 'Public Policy', participation: 'Public Participation / How-To' };
  var PACTION = { register_to_speak: 'Register to speak', testify: 'Testify', submit_comment: 'Submit a comment', attend: 'Attend',
    sign_petition: 'Sign a petition', contact_officials: 'Contact officials', other: 'Take part' };
  var PDL = { open: 'open', closes_today: 'closes today', expired: 'passed', unknown: 'not stated' };
  function extLink(u) {   // only an https link becomes a link; anything else is shown as text
    return /^https:\/\//i.test(u || '') ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u) + '</a>' : esc(u || '');
  }
  function viewParticipation(b, v) {
    var a = (b.discovery || {}).action, r = (v && v.participation) || null, t = (b.discovery || {}).story_type || (r && r.story_type);
    if (t !== 'participation') return '';
    var st = r ? (PSTATUS[r.status] || [r.status, 'wait']) : ['Not checked yet', 'wait'];
    var head = '<h3>Public participation</h3><p class="is-muted">This story helps viewers take one verified action. The official page is its evidence for dates and steps; claims about consequences are checked like any other claim. The deadline is checked again before every render.</p>' +
      '<table class="is-tab is-part"><tbody><tr><th>Story classification</th><td>' + esc(PTYPE[t] || t) + '</td></tr>' +
      '<tr><th>Status</th><td><span class="is-badge ' + st[1] + '" data-part-status="' + esc(r ? r.status : 'unchecked') + '">' + esc(st[0]) + '</span></td></tr>';
    if (!a) return '<div class="is-sec">' + head + '</tbody></table><div class="is-block">The draft has no action yet (discovery.action). Ask Claude to research the official opportunity.</div>' +
      (r ? checks(null, r) : '') + revisionNotes('participation') + '<div class="is-row">' + reviseButton('participation', 'the action') + '</div></div>';
    var dl = a.deadline || {}, rd = (r && r.deadline) || {}, ev = a.event;
    var days = rd.days_left == null ? '' : rd.days_left > 0 ? ' · ' + rd.days_left + ' day' + (rd.days_left === 1 ? '' : 's') + ' left' : '';
    var opt = function (label, o) { return o && o.text ? '<tr><th>' + esc(label) + '</th><td>' + line(o) + '</td></tr>' : ''; };
    var steps = (a.steps || []).map(function (x) { return '<li>' + line(x) + '</li>'; }).join('');
    var alts = (a.alternatives || []).map(function (x, i) {
      var ra = ((r && r.alternatives) || [])[i] || {};
      return '<li><b>' + esc(PACTION[x.action_type] || x.action_type) + '</b>' + ((x.deadline || {}).date ? ' by ' + esc(x.deadline.date) : '') +
        (ra.state ? ' <span class="is-badge ' + (ra.state === 'open' ? 'ok' : 'bad') + '">' + esc(ra.state === 'open' ? 'Open' : 'Closed') + '</span>' : '') +
        ': ' + line(x) + (x.url ? ' ' + extLink(x.url) : '') + '</li>';
    }).join('');
    var linkNote = r ? (r.url_official ? (r.url_linked_from ? 'Verified: the agency page ' + esc(r.url_linked_from) + ' links it' : 'Verified: on the agency\'s own site')
      : 'Not verified as the agency\'s page') : '';
    return '<div class="is-sec">' + head +
      '<tr><th>Official agency</th><td>' + line(a.agency) + '</td></tr>' +
      '<tr><th>Primary action</th><td>' + esc(PACTION[a.action_type] || a.action_type) + (a.lead === 'alternative' ? ' <span class="is-badge wait">The story leads with the alternative</span>' : '') + '</td></tr>' +
      '<tr><th>Deadline</th><td>' + esc(dl.date || 'Not stated') + (dl.time ? ' ' + esc(dl.time) : '') + (dl.tz ? ' (' + esc(dl.tz) + ')' : '') +
        ' <span class="is-badge ' + (rd.state === 'expired' ? 'bad' : rd.state === 'open' || rd.state === 'closes_today' ? 'ok' : 'wait') + '" data-part-deadline="' + esc(rd.state || '') + '">' +
        esc(PDL[rd.state] || 'not checked') + days + '</span> ' + chips(dl.claims) + '</td></tr>' +
      (ev ? '<tr><th>Event</th><td>' + esc(ev.start || '') + (ev.end && ev.end !== ev.start ? ' to ' + esc(ev.end) : '') + (ev.time ? ' ' + esc(ev.time) : '') +
        (ev.tz ? ' (' + esc(ev.tz) + ')' : '') + (ev.format ? ' · ' + esc(ev.format) : '') + ' ' + chips(ev.claims) +
        '<div class="is-muted">The event is not the registration deadline.</div></td></tr>' : '') +
      '<tr><th>Action link</th><td>' + (a.url ? extLink(a.url) : 'Missing') + ' ' + chips(a.url_claims) + (linkNote ? '<div class="is-muted">' + linkNote + '</div>' : '') + '</td></tr>' +
      opt('Who may take part', a.eligibility) + opt('Speaking or only attending', a.attend_vs_speak) + opt('Speaking limit', a.speaking_limit) +
      opt('Confirmation', a.confirmation) + opt('What taking part does', a.outcome) +
      '<tr><th>Steps</th><td><ol class="is-list">' + (steps || '<li>None yet</li>') + '</ol></td></tr>' +
      '<tr><th>Alternatives</th><td>' + (alts ? '<ul class="is-list">' + alts + '</ul>' : 'None listed') + '</td></tr>' +
      '<tr><th>Visual plan</th><td>The How-To Short opens on what is at stake, says the deadline, then walks through these steps on a card labelled "Steps from the official page · illustrative, not a screenshot", and ends on the official link and the deadline. A real screenshot of the page is not used until it can be captured and reviewed for personal details.</td></tr>' +
      '<tr><th>Last verified</th><td>' + esc(a.verified_at || 'Not stated') + '</td></tr>' +
      '</tbody></table>' +
      (r ? checks(null, r) : '') + revisionNotes('participation') + '<div class="is-row">' + reviseButton('participation', 'the action') + '</div></div>';
  }

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
      viewAccountability(d.accountability, r.accountability) +
      '<h3 style="margin-top:16px">Three story concepts</h3><p class="is-muted">Concern, accountability and empowerment, each scored on evidence integrity, backing, visual power, conflict clarity, agency and confidence. The selected concept must be the strongest, or say why not.</p>' +
      '<div class="is-concepts">' + concepts + '</div>' +
      (b.selection ? '<p><b>Why this one:</b> ' + esc(b.selection.why) + (b.selection.override ? ' <span class="is-badge wait">Override: ' + esc(b.selection.override) + '</span>' : '') + '</p>' : '') +
      revisionNotes('concepts') +
      '<h3 style="margin-top:16px">Quality gate</h3>' +
      (gate ? '<table class="is-tab is-gate"><tbody>' + gate + '<tr><td><b>Total</b></td><td><b>' + esc(q.total) + ' / ' + esc(q.max) + '</b></td></tr></tbody></table>' : '<p class="is-muted">Runs with the evidence checks.</p>') +
      (q.reject || []).map(function (x) { return '<div class="is-block">Rejected: ' + esc(x) + '</div>'; }).join('') +
      (miss.length ? '<div class="is-warnbox"><b>' + miss.length + ' picture(s) need an editorial decision</b> (no licensed photo yet; the record is shown until one is chosen. Drawings are never used).</div>' : '');
  }

  function viewOutline() {
    var b = S.draft, v = S.data.version && S.data.version.validation;
    if (!b.arc) {
      return '<div class="is-panel"><h3>Story outline</h3>' +
        (b.angles ? '<div class="is-warnbox">This story was written before the integrated outline, when one angle was chosen. Press Analyze again to get the story outline; the earlier version is kept.</div>' : '') +
        '<p class="is-muted">Analyze story reads the source pack and weighs three questions, separately: <b>FEAR</b> (what could affect residents?), <b>ANGER</b> (what deserves scrutiny?) and <b>MOTIVATION</b> (what can residents do?). Each gets its own records, counterevidence and evidence status. The supportable parts are then woven into one eight-act story. Nothing is invented to fill a section; a weak one is told with its limit, or omitted with the reason.</p>' +
        '<button class="is-btn primary" data-act="req" data-kind="analyze"' + (b.angles ? ' data-new="1"' : '') + (S.data.status.fresh ? '' : ' disabled') + '>' + (b.angles ? 'Analyze again' : 'Analyze story') + '</button></div>';
    }
    var v3 = (b.discovery ? viewParticipation(b, v) : '') + (b.discovery ? viewDiscovery(b, v) : '');
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
    if (lockedPath(path)) {
      return '<div class="is-line"><span class="is-muted">' + esc(label) + ' · <span class="cs-lock">🔒 your words</span></span><div class="is-pre">' + esc(l.text) + '</div>' +
        '<div class="is-claims">' + chips(l.claims) + '</div><span class="is-muted">Change it under Your script (Edit scene), so the change is fact-checked and versioned.</span></div>';
    }
    return '<div class="is-line' + (changed(path) ? ' changed' : '') + '"><label class="is-muted" for="ed-' + esc(path) + '">' + esc(label) + (changed(path) ? ' · changed since approved' : '') + '</label>' +
      '<textarea class="is-in" rows="2" id="ed-' + esc(path) + '" data-ed="' + esc(path) + '.text">' + esc(l.text) + '</textarea>' +
      '<div class="is-claims">' + chips(l.claims) + '<label class="is-sr" for="cl-' + esc(path) + '">Claim ids</label><input class="is-in" style="max-width:260px;font-size:12px" id="cl-' + esc(path) + '" data-cl="' + esc(path) + '.claims" value="' + esc((l.claims || []).join(', ')) + '" aria-label="Claim ids for ' + esc(label) + '"></div>' +
      lineNotes(path, label) + '</div>';
  }
  // A fix note on ONE line (founder, 2026-11-05). "Look this up first" asks the fixer to find the official documents (a
  // law, a rule, an order, an agency policy), add them to the story's sources with exact quotes, then change the line.
  // Notes are sent with the Fix button; the fixer says per note what it did. Nothing changes the line until then.
  var LINE_STATE = { open: ['wait', 'Not sent yet'], sending: ['wait', 'With the fixer'], fixed: ['ok', 'Fixed'],
    not_changed: ['warn', 'Not changed'], needs_you: ['warn', 'Needs you'], withdrawn: ['wait', 'Withdrawn'] };
  function lineNotesFor(path) {
    return ((S.data && S.data.line_notes) || []).filter(function (n) { return n.path === path && n.status !== 'withdrawn'; });
  }
  function lineNotes(path, label) {
    var notes = lineNotesFor(path), id = 'ln-' + path;
    var list = notes.map(function (n) {
      var st = LINE_STATE[n.status] || ['wait', n.status];
      return '<li><span class="is-badge ' + st[0] + '">' + esc(st[1]) + '</span> ' + (n.research ? '<span class="is-badge emo">Look up first</span> ' : '') +
        esc(n.note) + (n.answer ? '<div class="is-muted">Fixer: ' + esc(n.answer) + '</div>' : '') +
        (n.status === 'open' ? ' <button class="is-btn" data-act="lnwithdraw" data-id="' + esc(n.id) + '">Take back</button>' : '') + '</li>';
    }).join('');
    var form = !S.lnForm[path] ? '<button class="is-btn" data-act="lnform" data-path="' + esc(path) + '">Fix this line</button>' :
      '<div class="is-panel" style="margin-top:6px"><label for="' + esc(id) + '">What should change in ' + esc(label.toLowerCase()) + '? You can ask a question, for example "Look up EPA\u2019s legal duty to weigh health studies and whether this rule meets it".</label>' +
      '<textarea class="is-in" rows="3" maxlength="1000" id="' + esc(id) + '" data-lnt="' + esc(path) + '">' + esc(S.lnText[path] || '') + '</textarea>' +
      '<label style="display:block;margin-top:4px"><input type="checkbox" data-lnr="' + esc(path) + '"' + (S.lnResearch[path] ? ' checked' : '') + '> Look this up first in official records (laws, rules, orders, agency policy), then change the line</label>' +
      '<div class="is-row" style="margin-top:6px"><button class="is-btn primary" data-act="lnsend" data-path="' + esc(path) + '">Save note</button>' +
      '<button class="is-btn" data-act="lncancel" data-path="' + esc(path) + '">Cancel</button></div></div>';
    return '<div class="is-lnotes" style="margin-top:4px">' + (list ? '<ul class="is-list" style="margin:4px 0">' + list + '</ul>' : '') + form + '</div>';
  }
  // The list of line notes at the top of Script & Shorts, with the one Fix button.
  function lineFixPanel() {
    var notes = ((S.data && S.data.line_notes) || []).filter(function (n) { return n.status !== 'withdrawn'; });
    if (!notes.length) return '';
    var open = notes.filter(function (n) { return n.status === 'open'; }).length;
    var fb = S.data.media && S.data.media.fix_batch, active = fb && (fb.status === 'queued' || fb.status === 'working');
    var bs = active ? (BATCH_STATUS[fb.status] || ['wait', fb.status]) : null;
    return '<div class="' + (open ? 'is-warnbox' : 'is-panel') + '" style="margin:8px 0"><b>Line notes: ' + notes.length + '</b>' +
      (open ? ' · ' + open + ' not sent yet' : '') + (bs ? ' <span class="is-badge ' + bs[0] + '">' + esc(bs[1]) + '</span>' : '') +
      '<p class="is-muted">Each note stays under its line. <b>Fix</b> sends every open note (and any video fix requests) to the fixer. ' +
      'A "look up first" note makes it find the official documents and add them to the story\u2019s sources before it changes the line; ' +
      'it never states something the documents do not say. When it finishes, the sources are checked again and a new version is written for you to approve.</p>' +
      (open && !active ? '<div class="is-row"><button class="is-btn primary" data-act="fixstart">Fix (' + open + ')</button></div>' : '') + '</div>';
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
    var kind = { actual_image: 'Actual image', geographic_reference: 'Map / geographic reference', illustrative: 'Needs a photo (no drawings)', source_document: 'Source document', data_card: 'Data card' }[v.kind] || 'Visual not classified';
    return '<div class="is-muted">Visual: <b>' + esc(kind) + '</b>' + (v.layout ? ' · layout ' + esc(v.layout) : '') + ' — ' + esc(v.desc) + '</div>';
  }

  // ── STORYBOARD WORKSPACE (founder brief 2026-11-05, "Story Editor UX and Narrative Quality") ───────────────
  // Three panels: the scene navigator, the selected scene (picture, narration, on-screen text, sources, timing) and
  // production intelligence (the records it cites, its pictures and their rights, what still needs fixing, and the
  // audit's suggested change). Everything shown is read from the version, its validation (homesignal-ingest
  // rules.validate + impact/audit.py) and the prepared visuals; nothing here decides a fact.
  var COVER_LABEL = { covered: ['Covered', 'ok'], shortened: ['Covered briefly', 'warn'], left_out: ['Left out', 'bad'], unsupported: ['Not in the records', 'bad'] };
  function profileOf() {
    var a = (((S.data || {}).version || {}).validation || {}).audit;
    return (a && a.profile) || ((S.draft && S.draft.discovery) || {}).profile || 'development';
  }
  function sceneList(b) {
    var out = [];
    (((b || {}).main || {}).acts || []).forEach(function (a, ai) {
      (a.scenes || []).forEach(function (sc, si) {
        out.push({ key: 'a' + a.act + '-s' + (si + 1), act: a.act, n: si + 1, name: a.name, beat: a.beat, sc: sc, path: 'main.acts.' + ai + '.scenes.' + si });
      });
    });
    return out;
  }
  function sceneSecs(sc) {
    var w = (sc.narration || []).reduce(function (n, l) { return n + words(l.text); }, 0);
    return Math.max(Math.round(w * 60 / WPM), Number((sc.visual || {}).duration) || 0);
  }
  function validationMsgs() {
    var v = ((S.data || {}).version || {}).validation || {}, n = v.narrative || {};
    return { blocking: n.blocking || [], warnings: n.warnings || [] };
  }
  function sceneIssues(x) {
    var re = new RegExp('Act ' + x.act + ' scene ' + x.n + '(?![0-9])'), m = validationMsgs();
    return { blocking: m.blocking.filter(function (t) { return re.test(t); }), warnings: m.warnings.filter(function (t) { return re.test(t); }) };
  }
  function sceneShots(x) {
    var mf = (S.data.visuals || {}).manifest;
    return shotsOf(mf, 'main').filter(function (sh) { return sh.id === x.key || String(sh.id).indexOf(x.key + '-') === 0 || String(sh.id).indexOf(x.key + '.') === 0; });
  }
  function sceneStatus(x) {
    var iss = sceneIssues(x), shots = sceneShots(x), mf = (S.data.visuals || {}).manifest;
    var claims = (x.sc.narration || []).reduce(function (a, l) { return a.concat(l.claims || []); }, []);
    var ev = iss.blocking.length ? ['bad', 'Needs a fix'] : !claims.length ? ['bad', 'No record cited'] : iss.warnings.length ? ['warn', 'Check'] : ['ok', 'Verified'];
    var asset = !mf ? ['wait', 'Not prepared'] : !shots.length ? ['wait', 'No shot'] :
      shots.some(function (s) { return s.status === 'blocked'; }) ? ['bad', 'Blocked'] :
      shots.some(function (s) { return s.photo_needed || s.illustration; }) ? ['warn', 'No photo yet'] : ['ok', 'Picture ready'];
    var prod = !shots.length ? ['wait', 'Not reviewed'] : shots.every(function (s) { return shotApproved('main', s); }) ? ['ok', 'Approved'] : ['wait', 'To review'];
    return { evidence: ev, asset: asset, production: prod, issues: iss };
  }
  function boardSelected(list) {
    var sel = list.filter(function (x) { return x.key === S.sbSel; })[0];
    return sel || list[0];
  }
  function boardPreviewPaths() {
    var list = sceneList(S.draft), x = boardSelected(list), out = [];
    if (!x) return out;
    sceneShots(x).forEach(function (sh) { if (sh.preview && sh.preview.path) out.push(sh.preview.path); });
    list.forEach(function (y) { var s = sceneShots(y)[0]; if (s && s.preview && s.preview.path) out.push(s.preview.path); });   // navigator thumbnails
    return out.filter(function (p) { return !S.urls[p] && !S.prevFail[p]; });
  }
  function loadBoardPreviews() {
    if (S.loadingPrev) return;
    var need = boardPreviewPaths();
    if (!need.length) return;
    S.loadingPrev = true;
    Promise.all(need.map(function (p) { return signed(p).then(null, function () { S.prevFail[p] = true; return null; }); })).then(function () {
      S.loadingPrev = false;
      if (S.step === 'script' && S.doc === 'board' && S.open) renderWorkspace();
    });
  }
  function dot(st, label) { return '<span class="is-badge ' + st[0] + '" title="' + esc(label + ': ' + st[1]) + '">' + esc(label) + ' · ' + esc(st[1]) + '</span>'; }
  function viewBoard() {
    var list = sceneList(S.draft);
    if (!list.length) return '<p class="is-muted">The main script has no scenes yet.</p>';
    var x = boardSelected(list), stats = {};
    list.forEach(function (y) { stats[y.key] = sceneStatus(y); });
    var shown = S.sbIssues ? list.filter(function (y) { var s = stats[y.key]; return s.evidence[0] !== 'ok' || s.asset[0] === 'bad' || s.asset[0] === 'warn'; }) : list;
    if (S.sbIssues && shown.length && !shown.some(function (y) { return y.key === x.key; })) x = shown[0];
    var total = list.reduce(function (n, y) { return n + sceneSecs(y.sc); }, 0), t0 = 0, starts = {};
    list.forEach(function (y) { starts[y.key] = t0; t0 += sceneSecs(y.sc); });
    var nav = '<nav class="is-sbnav" aria-label="Scenes">' + (shown.length ? '' : '<p class="is-muted">No scene has an open issue.</p>') + shown.map(function (y, i) {
      var s = stats[y.key], th = sceneShots(y)[0], u = th && th.preview && S.urls[th.preview.path];
      var head = (i === 0 || shown[i - 1].act !== y.act) ? '<div class="is-sbact">Act ' + esc(y.act) + ' · ' + esc(y.name) + (y.beat && BEAT_LABEL[y.beat] ? ' <span class="is-muted">' + esc(BEAT_LABEL[y.beat]) + '</span>' : '') + '</div>' : '';
      return head + '<button class="is-sbitem' + (y.key === x.key ? ' on' : '') + '" data-act="sbsel" data-key="' + esc(y.key) + '"' + (y.key === x.key ? ' aria-current="true"' : '') + '>' +
        (u ? '<img alt="" src="' + esc(u) + '">' : '<span class="is-sbph" aria-hidden="true"></span>') +
        '<span class="is-sbtxt"><b>Scene ' + esc(y.n) + '</b> <span class="is-muted">' + esc(secs(starts[y.key])) + ' · ' + esc(sceneSecs(y.sc)) + ' s</span><br>' +
        '<span class="is-muted">' + esc((y.sc.purpose || (y.sc.narration[0] || {}).text || '').slice(0, 90)) + '</span><br>' +
        '<span class="is-sbdots"><i class="' + s.evidence[0] + '" title="Evidence: ' + esc(s.evidence[1]) + '"></i><i class="' + s.asset[0] + '" title="Picture: ' + esc(s.asset[1]) + '"></i><i class="' + s.production[0] + '" title="Production: ' + esc(s.production[1]) + '"></i></span></span></button>';
    }).join('') + '</nav>';
    var s = stats[x.key], shots = sceneShots(x), v = x.sc.visual || {};
    var big = shots.map(function (sh) {
      var u = sh.preview && S.urls[sh.preview.path];
      return u ? '<img class="is-sbbig" alt="' + esc('Act ' + x.act + ' scene ' + x.n + ', shot ' + sh.id) + '" src="' + esc(u) + '">' : '';
    }).filter(Boolean);
    var center = '<section class="is-sbmain" aria-label="Selected scene"><div class="is-row" style="justify-content:space-between"><h4 style="margin:0">Act ' + esc(x.act) + ' · ' + esc(x.name) + ' · scene ' + esc(x.n) + '</h4>' +
      '<span class="is-muted">' + esc(secs(starts[x.key])) + ' – ' + esc(secs(starts[x.key] + sceneSecs(x.sc))) + ' · ' + esc(v.transition || 'cut') + '</span></div>' +
      (big.length ? '<div class="is-sbpics">' + big.join('') + '</div>'
        : '<div class="is-sbempty">' + ((S.data.visuals || {}).manifest ? (shots.length ? 'Loading the preview…' : 'No prepared shot for this scene.') : 'Previews appear here after <b>Prepare the visuals</b> (Visuals step).') + '<br>' + esc(v.subject || v.desc || '') + '</div>') +
      '<div class="is-row" style="margin:8px 0">' + dot(s.evidence, 'Evidence') + dot(s.asset, 'Picture') + dot(s.production, 'Production') + (x.sc.thread ? threadBadge(x.sc.thread) : '') + '</div>' +
      '<p class="is-muted" style="margin:4px 0">Viewer should understand: ' + esc(x.sc.purpose || '—') + '</p>' + visualNote(v) +
      (x.sc.onscreen ? lineEditor(x.path + '.onscreen', 'main', 'On-screen text') : '') +
      (x.sc.narration || []).map(function (n, ni) { return lineEditor(x.path + '.narration.' + ni, 'main', 'Narration ' + (ni + 1)); }).join('') + '</section>';
    var claims = {};
    (x.sc.narration || []).concat(x.sc.onscreen ? [x.sc.onscreen] : []).forEach(function (l) { (l.claims || []).forEach(function (c) { claims[c] = 1; }); });
    var ev = Object.keys(claims).map(function (id) {
      var c = claimById(id) || {};
      return '<li>' + claimChip(id) + ' ' + esc(c.text || 'Not in the source pack') + (c.quote ? '<div class="is-quote">“' + esc(c.quote) + '”</div>' : '') +
        (c.source_url ? '<a href="' + esc(c.source_url) + '" target="_blank" rel="noopener noreferrer">' + esc(c.source_label || 'source') + '</a>' : '') + '</li>';
    }).join('');
    var pics = shots.map(function (sh) {
      var ph = sh.photo, rec = (ph && ph.record) || {};
      return '<li><b>' + esc(sh.id) + '</b> ' + (SHOT_LABEL[sh.status] ? '<span class="is-badge ' + SHOT_LABEL[sh.status][1] + '">' + esc(SHOT_LABEL[sh.status][0]) + '</span> ' : '') +
        (ph ? esc(ph.credit || rec.title || ph.id) + (rec.license ? ' · ' + esc(rec.license) : '') + (rec.page_url ? ' · <a href="' + esc(rec.page_url) + '" target="_blank" rel="noopener noreferrer">file page</a>' : '') +
          (sh.site_relation === 'representative' || ph.site_relation === 'representative' ? ' · representative, not this site' : '')
          : sh.photo_needed ? 'No photo found yet; the record is shown' : 'From the record') +
        ((sh.reasons || []).length ? '<div class="is-muted">' + esc(sh.reasons.join('; ')) + '</div>' : '') + '</li>';
    }).join('');
    var au = ((((S.data || {}).version || {}).validation || {}).audit || {}).checks || [];
    var fixes = s.issues.blocking.map(function (t) { return '<li class="bad">' + esc(t) + '</li>'; }).concat(s.issues.warnings.map(function (t) { return '<li>' + esc(t) + '</li>'; })).join('');
    var right = '<aside class="is-sbside" aria-label="Production intelligence">' +
      '<h5>Records this scene cites</h5>' + (ev ? '<ul class="is-list">' + ev + '</ul>' : '<p class="is-muted">No record cited.</p>') +
      '<h5>Pictures and rights</h5>' + (pics ? '<ul class="is-list">' + pics + '</ul>' : '<p class="is-muted">No prepared picture yet.</p>') +
      (v.subject_ref ? '<button class="is-btn" data-act="step" data-step="visuals">Choose or replace photos in Visuals</button>' : '') +
      '<h5>Open issues</h5>' + (fixes ? '<ul class="is-list">' + fixes + '</ul>' : '<p class="is-muted">None for this scene.</p>') +
      (au.filter(function (c) { return !c.ok; }).length ? '<h5>Suggested changes for the whole story</h5><ul class="is-list">' + au.filter(function (c) { return !c.ok; }).map(function (c) {
        return '<li><b>' + esc(c.label) + '</b>: ' + esc(c.action) + '</li>'; }).join('') + '</ul>' : '') +
      lineNotes(x.path + '.narration.0', 'Narration 1') + '</aside>';
    return '<div class="is-row" style="margin:4px 0 8px"><span class="is-muted">' + list.length + ' scenes · about ' + esc(secs(total)) + '</span>' +
      '<label><input type="checkbox" data-act="sbissues"' + (S.sbIssues ? ' checked' : '') + '> Unresolved issues only</label>' +
      '<button class="is-btn" data-act="sbfull">' + (S.sbFull ? 'Exit full screen' : 'Full screen') + '</button></div>' +
      '<div class="is-sb">' + nav + center + right + '</div>';
  }
  function viewRead() {
    var acts = ((S.draft.main || {}).acts) || [], q = (S.draft.main || {}).question;
    return '<div class="is-row" style="margin:4px 0 8px"><button class="is-btn" data-act="sbfull">' + (S.sbFull ? 'Exit full screen' : 'Full screen') + '</button>' +
      '<span class="is-muted">Read it aloud: about ' + esc(secs(sceneList(S.draft).reduce(function (n, y) { return n + sceneSecs(y.sc); }, 0))) + '.</span></div>' +
      '<article class="is-read">' + (q ? '<p class="is-muted">The question: <b>' + esc(q) + '</b></p>' : '') + acts.map(function (a) {
        return '<h4>Act ' + esc(a.act) + ' · ' + esc(a.name) + '</h4>' + (a.scenes || []).map(function (sc) {
          return (sc.onscreen && sc.onscreen.text ? '<p class="is-onscr">On screen: ' + esc(sc.onscreen.text) + '</p>' : '') +
            '<p>' + (sc.narration || []).map(function (n) { return esc(n.text); }).join(' ') + '</p>';
        }).join('');
      }).join('') + '</article>';
  }
  // The five gates (founder brief §6). None is a new decision: each reads the state the database and the engine
  // already hold, and "Production ready" is never shown while an earlier gate is open.
  function readinessGates() {
    var d = S.data || {}, v = (d.version || {}).validation || {}, vis = d.visuals || {}, mf = vis.manifest;
    var nb = (v.narrative || {}).blocking || [];
    var factual = nb.filter(function (t) { return t.indexOf('Production audit:') !== 0; });
    var narr = ((d.status || {}).artifacts || {}).narrative || {};
    var shots = []; vkeys(mf).forEach(function (k) { shots = shots.concat(shotsOf(mf, k)); });
    var blockedShots = shots.filter(function (s) { return s.status === 'blocked'; }).length;
    var audit = v.audit;
    var g = [
      ['Evidence verified', !v.pack ? null : v.pack.ok !== false && !factual.length, !v.pack ? 'Runs with the evidence checks.' : factual.length ? factual.length + ' problem(s) in the evidence checks.' : 'Every line cites a checked record.'],
      ['Script editorial review', narr.state === 'approved', narr.state === 'approved' ? 'The narrative is approved.' : 'Read the script and approve the narrative.'],
      ['Visual rights cleared', !mf ? null : !blockedShots, !mf ? 'Prepare the visuals first.' : blockedShots ? blockedShots + ' shot(s) are blocked (license, file or checksum).' : 'Every photo has a checked license.'],
      ['Required assets acquired', !mf ? null : vis.state !== 'blocked', !mf ? 'Prepare the visuals first.' : vis.state === 'blocked' ? 'An essential subject has no usable photo.' : 'Every essential subject has a picture.'],
      ['Production audit', !audit ? null : !!audit.ok, !audit ? 'Runs with the next evidence check (save or generate).' : audit.ok ? 'All ' + audit.checks.length + ' checks pass.' : audit.checks.filter(function (c) { return !c.ok; }).length + ' check(s) to fix.']
    ];
    var ready = g.every(function (x) { return x[1] === true; }) && vis.state === 'approved';
    g.push(['Production ready', ready, ready ? 'Ready to render.' : 'Opens when every gate above is passed and the visuals are approved.']);
    return g;
  }
  function viewGates() {
    return '<div class="is-gates" role="list" aria-label="Readiness">' + readinessGates().map(function (x) {
      var cls = x[1] === true ? 'ok' : x[1] === false ? 'bad' : 'wait';
      return '<div class="is-gate ' + cls + '" role="listitem"><b>' + (x[1] === true ? '✓ ' : x[1] === false ? '✕ ' : '… ') + esc(x[0]) + '</b><span class="is-muted">' + esc(x[2]) + '</span></div>';
    }).join('') + '</div>';
  }
  function viewAudit() {
    var a = (((S.data || {}).version || {}).validation || {}).audit;
    if (!a) return '<div class="is-panel"><h4>Production audit</h4><p class="is-muted">Runs with the next evidence check: save a change or generate the story again.</p></div>';
    return '<div class="is-panel"><h4>Production audit' + (a.legacy ? ' <span class="is-badge wait">Written before the audit: warnings only</span>' : '') + '</h4><ul class="is-list">' + a.checks.map(function (c) {
      return '<li><span class="is-badge ' + (c.ok ? 'ok' : 'bad') + '">' + (c.ok ? 'Pass' : 'Fix') + '</span> <b>' + esc(c.label) + '</b> <span class="is-muted">' + esc(c.detail) + '</span>' +
        (c.ok ? '' : '<div>Next: ' + esc(c.action) + '</div>') + '</li>';
    }).join('') + '</ul></div>';
  }
  function viewCoverage() {
    var a = (((S.data || {}).version || {}).validation || {}).audit || {};
    var cov = a.coverage || ((S.draft || {}).discovery || {}).brief_coverage, brief = ((S.data || {}).pack || {}).brief;
    if (!(cov && cov.length) && !brief) return '';   // no brief given: nothing to answer
    return '<div class="is-panel"><h4>Your brief, topic by topic</h4>' + (cov && cov.length ? '<ul class="is-list">' + cov.map(function (t) {
      var l = COVER_LABEL[t.status] || ['Not checked', 'wait'];
      return '<li><span class="is-badge ' + l[1] + '">' + esc(t.new ? 'New: ' + l[0] : l[0]) + '</span> <b>' + esc(t.topic) + '</b>' +
        ((t.acts || []).length ? ' <span class="is-muted">Act ' + (t.acts || []).map(esc).join(', ') + '</span>' : '') + (t.reason ? '<div class="is-muted">' + esc(t.reason) + '</div>' : '') + '</li>';
    }).join('') + '</ul>' : '<div class="is-block">The draft does not answer your brief yet. Ask for a revision: every topic needs the act that covers it, or why it is left out.</div>') +
      (brief ? '<details><summary>Read your brief</summary><pre class="is-pre" style="white-space:pre-wrap">' + esc(brief) + '</pre></details>' : '') + '</div>';
  }

  // A creator-directed story's script: flags beside the founder's words, the waiting revision, and Approve & Lock.
  function viewCreator() {
    var cs = S.data.creator, st = CR().storyStage(S.data.status, S.data.media, S.data.visuals);
    return CR().review(cs, { pipeline: CR().pipeline(st[0], st[1]), comparing: S.csCompare, canDecide: !S.dirty,
      editor: S.csEd ? CR().editor(S.csEd, 'is-cs') : null });
  }
  function viewScript() {
    var b = S.draft;
    if (!b.main) {
      return '<div class="is-panel"><h3>Script & Shorts</h3><p class="is-muted">Generate story writes the one integrated story from the outline: the eight-act main investigation, the six-topic Quality-of-Life Checklist, Short A and Short B (or records an editorial exception if no second truthful question exists), titles, thumbnail line and description — every line citing source claims.</p>' +
        (b.arc ? '<button class="is-btn primary" data-act="req" data-kind="generate">Generate story</button>' : '<div class="is-warnbox">Analyze the story first: the script is written from the story outline.</div>') + '</div>';
    }
    var docs = [['creator', 'Your script'], ['board', 'Storyboard'], ['read', 'Read full script'], ['main', 'Edit main script'], ['qol', 'Quality-of-Life'], ['short_a', 'Short A'], ['short_b', 'Short B'], ['packaging', 'Titles & thumbnail'],
      ['visuals', 'Visual plan & assets'], ['ledger', 'Source ledger']];
    if (!b.discovery) docs = docs.filter(function (x) { return x[0] !== 'visuals'; });
    if (!isCreator()) docs = docs.filter(function (x) { return x[0] !== 'creator'; });
    else { docs[3][1] = 'Main script (your words locked)'; if (S.creatorFirst !== S.open) { S.creatorFirst = S.open; S.doc = 'creator'; } }
    // a public-affairs story has no Quality-of-Life chart (homesignal-ingest rules.story_profile)
    if (profileOf() === 'public_affairs' && !(b.qol && b.qol.length)) docs = docs.filter(function (x) { return x[0] !== 'qol'; });
    if (!docs.some(function (x) { return x[0] === S.doc; })) S.doc = 'board';
    var tabs = lineFixPanel() + '<div class="is-docs" role="tablist">' + docs.map(function (x) {
      return '<button class="is-doc" role="tab" data-act="doc" data-doc="' + x[0] + '" aria-selected="' + (S.doc === x[0]) + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>';
    var inner;
    if (S.doc === 'creator') {
      inner = viewCreator();
    } else if (S.doc === 'board') {
      inner = viewBoard();
    } else if (S.doc === 'read') {
      inner = viewRead();
    } else if (S.doc === 'main') {
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
        lineEditor('packaging.thumbnail', 'packaging', 'Thumbnail line (4-8 words)') +
        lineEditor('packaging.thumbnail.subline', 'packaging', 'Thumbnail sentence (one sentence under the headline: what is happening and why it matters)') +
        lineEditor('packaging.description', 'packaging', 'Description') +
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
    var full = S.sbFull && (S.doc === 'board' || S.doc === 'read');
    var au = (((S.data || {}).version || {}).validation || {}).audit, cov = au && au.coverage;
    var bad = au ? au.checks.filter(function (c) { return !c.ok; }).length : 0;
    var sum = (au ? 'Production audit: ' + (au.checks.length - bad) + ' of ' + au.checks.length + ' pass' : 'Production audit: not run yet') +
      (cov && cov.length ? ' · Your brief: ' + cov.filter(function (t) { return t.status === 'covered' || t.status === 'shortened'; }).length + ' of ' + cov.length + ' covered' : '');
    // folded into one line when everything passes, open when something needs fixing
    var review = S.doc === 'board' || S.doc === 'read' ? '<details class="is-review"' + (bad && !(au && au.legacy) ? ' open' : '') + '><summary><b>' + esc(sum) + '</b></summary><div class="is-two">' + viewAudit() + viewCoverage() + '</div></details>' : '';
    return '<div class="is-panel' + (full ? ' is-full' : '') + '"><h3>Script & Shorts</h3>' + viewGates() + decisionBar('narrative') + checks('narrative') + tabs + review +
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
    return '<p class="is-muted">What is on screen in every shot, the feeling it serves, and where the picture comes from. A photo is only an openly licensed file whose license is checked, or one you uploaded. Drawings are never used: a shot with no photo shows its record until a photo is chosen.</p>' +
      '<table class="is-tab"><thead><tr><th>Shot</th><th>Picture</th></tr></thead><tbody>' + rows.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td>' + visualNote(x[1]) + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h4 style="margin-top:14px">Photos and their licenses</h4>' + (photos ? '<table class="is-tab"><thead><tr><th>Id</th><th>File</th><th>License</th><th>Author</th><th>Status</th></tr></thead><tbody>' + photos + '</tbody></table>' : '<p class="is-muted">No photos yet; every shot is a record, map or card until photos are chosen.</p>') +
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
    (m.choices || []).forEach(function (c) { chosen[c.subject_id + '|' + c.candidate_id] = true; });
    var cands = (b.candidates || []).map(function (g) {
      return '<section class="is-angle"><b>' + esc(g.subject || g.subject_id) + '</b> <span class="is-muted">needs a licensed photo' +
        ((g.queries || []).length ? ' · searched: ' + esc(g.queries.join('; ')) : '') + '</span>' +
        ((g.candidates || []).length ? '<ul class="is-list">' + g.candidates.map(function (c) {
          var on = !!chosen[g.subject_id + '|' + c.id];
          return '<li><a href="' + esc(c.page_url) + '" target="_blank" rel="noopener">' + esc(c.title || c.id) + '</a> · ' + esc(c.license) + ' · ' + esc(c.author || '') +
            (c.near && c.near.length ? ' · names ' + esc(c.near.join(', ')) : '') + ' · <span class="is-muted">shown as REPRESENTATIVE PHOTO, never as the site</span> ' +
            (on ? '<span class="is-badge ok">✓ In your photos</span> <button class="is-btn" data-act="unchoose" data-subject="' + esc(g.subject_id) + '" data-id="' + esc(c.id) + '">Remove</button>'
                : '<button class="is-btn" data-act="choose" data-job="' + esc(b.job_id) + '" data-subject="' + esc(g.subject_id) + '" data-id="' + esc(c.id) + '">Add to your photos</button>') + '</li>';
        }).join('') + '</ul>' : '<p class="is-muted">No licensed photo was found' + ((g.errors || []).length ? ' (' + esc(g.errors.slice(0, 2).join('; ')) + ')' : '') +
          '. Add one to impact/assets/registry.json through the asset probe, or ask Claude to rewrite the story around a subject that can be shown.</p>') + '</section>';
    }).join('');
    return '<div class="is-warnbox" style="margin-top:8px"><b>The last render stopped before rendering anything</b> (' + esc(fmt(b.at)) + ').' +
      failureList(b.failures) + (b.candidates_error ? '<p>' + esc(b.candidates_error) + '</p>' : '') + currencyBlock(b.currency) +
      (cands ? '<p>Add the photos you are happy with for each subject below, then press <b>Render the videos</b> again.</p>' + cands : '') + '</div>';
  }

  // Every fix request ever made, newest first, and the Fix batch. File cards show only the latest decision per file,
  // so this list keeps earlier requests visible. Fix sends every open request to the Fix job, which starts at once:
  // Claude Code on the founder's plan (no paid API, homesignal-ingest impact-fix-run.yml) changes the story or the
  // renderer, checks it, and records per request what it did. Approving and rendering stay with the founder.
  // Plan first (founder, 2026-11-05): Fix starts a PLAN run (Claude writes what it will change, edits nothing); the
  // founder reads the plan here and confirms it; only then does the work run change the story.
  var FIX_ACTIVE = { plan_queued: 1, planning: 1, queued: 1, working: 1 };
  var BATCH_STATUS = {
    plan_queued: ['wait', 'Starting: Claude begins reading your notes within a minute'],
    planning: ['wait', 'Claude is reading your notes and writing its plan'],
    planned: ['warn', 'Plan ready: read it and confirm'], cancelled: ['wait', 'Plan cancelled: nothing was changed'],
    queued: ['wait', 'Confirmed: the fixer begins within a minute'], working: ['wait', 'In progress: the fixer is making the confirmed changes'],
    stalled: ['bad', 'Stalled: the fixer stopped mid-way. Press Fix again'],
    done: ['ok', 'Fixes done'], needs_you: ['warn', 'Needs you'], failed: ['bad', 'Could not finish']
  };
  var OUTCOME = { fixed: ['ok', 'Fixed'], needs_you: ['warn', 'Needs you'], not_changed: ['warn', 'Not changed'] };
  // One status per request: what happened to it most recently. A render or an approval after the fixer finished wins.
  function fixState(x) {
    var b = x.batch;
    if (x.status === 'closed') return ['ok', 'Closed: that file was approved later'];
    // The background hum was removed from every video on Oct 30 (homesignal-ingest "NEVER HUM"); a request about it
    // needs no fixer and is done for every new render.
    if (/\bhum(ming)?\b/i.test(x.note || '')) return ['ok', 'Done for every new video: the hum was removed on Oct 30'];
    if (x.status === 'rendering') return ['wait', 'A new render is running'];
    if (x.status === 'rerendered' && (!b || !b.completed_at || x.rerendered_at > b.completed_at))
      return x.narrative_changed ? ['ok', 'Re-rendered from the changed story: check it'] : ['warn', 'Re-rendered, but nothing in the story changed'];
    if (b && (FIX_ACTIVE[b.status] || b.status === 'planned')) return BATCH_STATUS[b.status];
    if (b && b.status === 'cancelled') return ['wait', 'Not sent yet: press Fix'];
    if (b && b.outcome) return OUTCOME[b.outcome] || ['wait', b.outcome];
    if (b && b.status === 'failed') return ['bad', 'The fixer could not finish: press Fix again'];
    return ['wait', 'Not sent yet: press Fix'];
  }
  function fixRequests(m) {
    var fx = m.fix_requests || [], fb = m.fix_batch;
    if (!fx.length) return '';
    var waiting = fx.filter(function (x) { var t = fixState(x)[1]; return /^Not sent|press Fix/.test(t); }).length;
    var active = fb && (FIX_ACTIVE[fb.status] || fb.status === 'planned');
    var bs = fb ? (BATCH_STATUS[fb.status] || ['wait', fb.status]) : null;
    // A fix run that finished before a later render was started is history, not the next step (UI audit 2026-11-04:
    // "Could not finish … Press Fix again" stood beside "A new render is running" and an "out of date" banner).
    var job = (S.data.status || {}).job, rj = S.data.status && job && job.kind === 'render' ? job : null;
    var later = fb && fb.completed_at && ((rj && rj.created_at > fb.completed_at) || (m.blocked && m.blocked.at > fb.completed_at) ||
      (m.rendered_at && m.rendered_at > fb.completed_at));
    if (later && !active) {
      var past = fb.requests + ' request' + (fb.requests === 1 ? '' : 's') + ' sent ' + fmt(fb.requested_at) + ': ' + (BATCH_STATUS[fb.status] || ['', fb.status])[1];
      fb = { _past: past };
    }
    var batch = !fb ? '' : fb._past ? '<p class="is-muted">Earlier fix run: ' + esc(fb._past) + '. A render was started after it.</p>' :
      '<div class="' + (fb.status === 'done' || fb.status === 'cancelled' || FIX_ACTIVE[fb.status] ? 'is-muted' : 'is-warnbox') + '" style="margin:6px 0">' +
      '<span class="is-badge ' + bs[0] + '">' + esc(bs[1]) + '</span> ' +
      esc(fb.requests + ' request' + (fb.requests === 1 ? '' : 's') + ' sent ' + fmt(fb.requested_at)) +
      (fb.claimed_at ? esc(' · started ' + fmt(fb.claimed_at)) : '') + (fb.completed_at ? esc(' · finished ' + fmt(fb.completed_at)) : '') +
      (fb.summary ? '<p>' + esc(fb.summary) + '</p>' : '') +
      (fb.next_step ? '<p><b>Next: ' + esc(fb.next_step) + '</b></p>' : '') +
      (fb.pr_url ? '<p><a href="' + esc(fb.pr_url) + '" target="_blank" rel="noopener">The change</a></p>' : '') + '</div>' +
      (fb.status === 'planned' ? '<p><b>The plan is in the green box at the top of this page.</b></p>' : '');
    var btn = active ? '' : fb && !fb._past && fb.status === 'stalled'
      ? '<button class="is-btn primary" data-act="fixstart">Fix again</button>'
      : (waiting ? '<button class="is-btn primary" data-act="fixstart">Fix (' + waiting + ')</button>' : '');
    // when the box at the top already carries Fix, it is the only Fix button on screen (design audit 2026-11-06)
    var topHasFix = (pictureDrift(job) || topBoxSendsFixes()) && waiting && !active;
    if (topHasFix) btn = '';
    // one status said once, not on every row, when every request shares it
    var same = fx.length > 1 && fx.every(function (x) { return fixState(x)[1] === fixState(fx[0])[1] && !(x.batch && x.batch.note); });
    // Folded away unless something here needs you (an open request to send, or a fix run in progress).
    return '<details class="is-panel" style="margin-top:8px"' + (btn || active || topHasFix ? ' open' : '') + '><summary><b>Fix requests (' + fx.length + ')</b>' +
      (btn || topHasFix ? ' · ' + waiting + ' not sent yet' : fb && fb.status === 'planned' ? ' · <b>the plan is waiting for you</b>' : active ? ' · the fixer is working' : ' · nothing needed from you') + '</summary>' +
      '<p class="is-muted">Every request stays here. <b>Fix</b> sends the open ones to Claude, which first writes in plain words what it will change ' +
        '(it changes nothing yet). You read that plan and confirm it; then it makes exactly those changes, checks them and says per request what it did. ' +
        'Then you approve the story and render again.</p>' +
      batch + (btn ? '<div class="is-row">' + btn + '</div>' : topHasFix ? '<p class="is-muted">Send them with <b>Fix</b> in the box at the top.</p>' : '') +
      (same ? '<p><span class="is-badge ' + fixState(fx[0])[0] + '">' + esc(fixState(fx[0])[1]) + '</span> <span class="is-muted">(all ' + fx.length + ')</span></p>' : '') +
      '<ul class="is-list">' + fx.map(function (x) {
        var st = fixState(x);
        return '<li><b>' + esc(ASSET_LABEL[x.asset] || x.asset) + '</b>' + (x.timecode ? ' at ' + esc(x.timecode) : '') + ': ' + esc(x.note || '') +
          (same ? '' : ' <span class="is-badge ' + st[0] + '">' + esc(st[1]) + '</span>') +
          (x.batch && x.batch.note ? ' <span class="is-muted">' + esc(x.batch.note) + '</span>' : '') +
          ' <span class="is-muted">requested ' + esc(fmt(x.at)) + '</span></li>';
      }).join('') + '</ul></details>';
  }

  // The fix box starts filled in with what the checks found, so the founder never has to work out
  // what to write (founder, 2026-11-05: "i pressed request fix, but i do not know what fix is").
  // One line per failed check, grouped by check, each with its measured detail and the action.
  function fixDraft(f) {
    var q = (f.qc && f.qc.quality) || {}, by = {}, order = [];
    (q.failures || []).forEach(function (x) {
      var k = x.code || x.label;
      if (!by[k]) { by[k] = { label: x.label || k, action: x.action || '', details: [] }; order.push(k); }
      if (x.detail && by[k].details.indexOf(x.detail) < 0) by[k].details.push(x.detail);
    });
    var lines = order.map(function (k) {
      var g = by[k];
      return '- ' + g.label + ' (' + g.details.join('; ') + '). ' + g.action;
    });
    ((f.qc && f.qc.checks) || []).forEach(function (c) { if (!c.ok) lines.push('- ' + c.name + ': ' + c.detail); });
    if (!lines.length) return '';
    var head = (ASSET_LABEL[f.asset] || f.asset) + ' failed these checks. Fix them:\n';
    var out = head, i;
    for (i = 0; i < lines.length; i++) {
      if ((out + lines[i] + '\n').length > 1000) break;
      out += lines[i] + '\n';
    }
    return out.replace(/\n$/, '');
  }
  // Rendering again only helps when the one problem is the renderer not drawing what was planned.
  function renderAgainHelps(f) {
    var fl = (f.qc && f.qc.quality && f.qc.quality.failures) || [];
    return fl.length > 0 && fl.every(function (x) { return x.code === 'render_mismatch'; });
  }

  // The plan the fixer wrote, per request: your note, what it understood, the changes, and what it will not do. Confirm
  // sends back the md5 of exactly this plan; a plan that changed since the page loaded is refused.
  function fixPlan(fb, fx) {
    var plan = fb.plan || {}, byId = {};
    fx.forEach(function (x) { byId[String(x.id)] = x; });
    return '<div class="is-panel" id="is-fix-plan" style="margin:8px 0;border:2px solid #1f7a4d">' +
      '<h4 style="margin:0 0 4px">PLAN · Here is what Claude will change</h4>' +
      '<p>' + esc(plan.summary || '') + '</p>' +
      (plan.items || []).map(function (it) {
        var x = byId[String(it.decision_id)] || {};
        return '<div style="margin:10px 0;padding-top:8px;border-top:1px solid rgba(0,0,0,.08)">' +
          '<p class="is-muted" style="margin:0">Your note' + (x.asset ? ' on ' + esc(ASSET_LABEL[x.asset] || x.asset) : '') + (x.timecode ? ' at ' + esc(x.timecode) : '') +
            ': “' + esc(x.note || '') + '”</p>' +
          '<p style="margin:4px 0"><b>Understood:</b> ' + esc(it.understood || '') + '</p>' +
          ((it.changes || []).length ? '<ul class="is-list">' + it.changes.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') +
          (it.will_not ? '<p class="is-warnbox" style="margin:4px 0"><b>Will not do:</b> ' + esc(it.will_not) + '</p>' : '') + '</div>';
      }).join('') +
      '<div class="is-row" style="margin-top:8px"><button class="is-btn primary" data-act="fixconfirm" data-id="' + esc(fb.id) + '" data-md5="' + esc(fb.plan_md5 || '') + '">Confirm and make these changes</button>' +
      '<button class="is-btn" data-act="fixplancancel" data-id="' + esc(fb.id) + '">Cancel: nothing will change</button></div>' +
      '<p class="is-muted">Not right? Cancel, add or rewrite a fix request under the video, then press Fix again for a new plan.</p></div>';
  }

  function fileCard(f, current) {
    var qc = (f.qc && f.qc.checks) || [];
    var isVideo = f.asset !== 'thumbnail', key = 'f' + f.id;
    var url = S.urls[f.path], failed = f.state === 'blocked';
    // A video that failed the checks is not played on the page: it cannot be approved, so watching it wastes your time
    // (founder, 2026-11-07). "Watch it anyway" sits under Details.
    var player = failed ? '' : isVideo
      ? (url ? '<video controls preload="metadata" src="' + esc(url) + '" style="width:100%;max-height:' + (f.height > f.width ? '640px' : '420px') + ';background:#000;border-radius:8px"' + '></video>'
             : '<button class="is-btn" data-act="watch" data-path="' + esc(f.path) + '">Watch ' + esc(ASSET_LABEL[f.asset] || f.asset) + '</button>')
      : (url ? '<img alt="Thumbnail" src="' + esc(url) + '" style="max-width:100%;border-radius:8px">'
             : '<button class="is-btn" data-act="watch" data-path="' + esc(f.path) + '">Show thumbnail</button>');
    var stills = S.shown[key] ? '<div class="is-row" style="flex-wrap:wrap;gap:8px;margin-top:8px">' + (f.stills || []).map(function (p, i) {
      var shot = (f.shots || [])[i] || {};
      return S.urls[p] ? '<figure style="margin:0;width:' + (f.height > f.width ? '150px' : '260px') + '"><a href="' + esc(S.urls[p]) + '" target="_blank" rel="noopener"><img alt="Shot ' + esc(shot.id || i + 1) + '" src="' + esc(S.urls[p]) + '" style="width:100%;border-radius:6px"></a>' +
        '<figcaption class="is-muted" style="font-size:12px">' + esc(secs(shot.start_s)) + ' · ' + esc(shot.layout || '') + ' · ' + esc(shot.kind || '') + '</figcaption></figure>' : '';
    }).join('') + '</div>' : '';
    var decide = !current || f.state === 'stale' || (failed && autoFixing()) ? '' : failed ?
      '<div class="is-row" style="margin-top:8px"><button class="is-btn" data-act="fixform" data-id="' + esc(f.id) + '">Request a fix</button></div>' +
      (S.fixForm[f.id] ? fixFormHtml(f) : '') :
      '<div class="is-row" style="margin-top:8px">' +
      (f.state !== 'approved' ? '<button class="is-btn primary" data-act="mdecide" data-d="approved" data-id="' + esc(f.id) + '"' + (f.state === 'blocked' ? ' disabled title="' + esc(f.why || 'Blocked') + '"' : '') + '>Approve</button>' : '') +
      (f.state === 'blocked' ? '<span class="is-muted">Can\u2019t approve: it did not pass the checks.</span>' : '') +
      '<button class="is-btn" data-act="fixform" data-id="' + esc(f.id) + '">Request a fix</button>' +
      (f.state === 'approved' ? '<button class="is-btn" data-act="mdecide" data-d="revoked" data-id="' + esc(f.id) + '">Revoke approval</button>' : '') + '</div>' +
      // the fix form sits under the video it is about, so the note can be written while watching (no pop-up)
      (S.fixForm[f.id] ? fixFormHtml(f) : '');
    function fixFormHtml(f) { return '<div class="is-panel" style="margin-top:8px"><label>What should be fixed?<br><textarea id="fx-note-' + esc(f.id) + '" rows="' + (fixDraft(f) ? 8 : 3) + '" maxlength="1000" style="width:100%">' + esc(fixDraft(f)) + '</textarea></label>' +
        (fixDraft(f) ? '<p class="is-muted" style="margin:4px 0">Filled in with what the checks found. You can save it as it is, or add to it.</p>' : '<p class="is-muted" style="margin:4px 0">Write it the way you would say it, feelings included: “too much paperwork”, “it should feel more urgent”, “end on the people”.</p>') +
        '<p class="is-muted" style="margin:4px 0">When you press Fix, Claude turns your notes into exact changes and shows you that plan before changing anything.</p>' +
        '<label>At what moment (m:ss, optional) <input id="fx-tc-' + esc(f.id) + '" size="6" placeholder="1:05"></label>' +
        '<div class="is-row" style="margin-top:6px"><button class="is-btn primary" data-act="fixsend" data-id="' + esc(f.id) + '">Save fix request</button>' +
        '<button class="is-btn" data-act="fixcancel" data-id="' + esc(f.id) + '">Cancel</button></div></div>'; }
    // One plain sentence, the picture, the decision. Everything technical folds under Details (UI audit 2026-11-03).
    var plain = failed && autoFixing() ? 'This video did not pass the automatic checks, so it is not shown. Claude is fixing it now; you will review only the fixed version.'
      : failed
      ? (f.qc && f.qc.ok === false ? 'This file failed its technical checks, so it cannot be approved. Render the videos again; if it fails again, request a fix.'
                                   : renderAgainHelps(f) ? 'This video did not pass the picture checks, so it cannot be approved. The renderer did not draw what was planned: render the videos again.'
                                   : 'This video did not pass the picture checks, so it cannot be approved. Rendering again will not change it. Press Request a fix: the box is already filled in with what failed. Save it, then press Fix.')
      : f.state === 'pending' ? (isVideo ? 'Watch it, then approve it or request a fix.' : 'Look at it, then approve it or request a fix.')
      : f.state === 'stale' && pictureDrift((S.data.status || {}).job) ? 'Out of date. It will be replaced when you finish the steps at the top.'
      : f.why;
    return '<section class="is-angle"><div class="is-row"><b>' + esc(ASSET_LABEL[f.asset] || f.asset) + '</b> ' + mediaBadge(f.state) +
      (f.hum ? '<span class="is-badge bad">Has the old background hum</span>' : '') + '</div>' +
      '<p>' + esc(plain) + '</p>' + player + decide +
      '<details style="margin-top:8px"><summary class="is-muted">Details</summary>' +
      '<p class="is-muted">' + esc(f.width + '×' + f.height) + (f.duration_s ? ' · ' + esc(secs(f.duration_s)) : '') + ' · ' + esc(mb(f.bytes)) + ' · ' + esc(f.preset) +
        (f.state === 'blocked' ? '<br>' + esc(f.why) : '') + '</p>' +
      (qc.length ? '<details style="margin-top:8px"><summary>Media checks: ' + (f.qc.ok ? 'all passed' : 'FAILED') + '</summary><ul class="is-list">' +
        qc.map(function (c) { return '<li>' + (c.ok ? '✓ ' : '✗ ') + esc(c.name) + ': ' + esc(c.detail) + '</li>'; }).join('') + '</ul></details>' : '') +
      qualityBlock(f) +
      (failed && isVideo ? (url ? '<video controls preload="metadata" src="' + esc(url) + '" style="width:100%;max-height:' + (f.height > f.width ? '640px' : '420px') + ';background:#000;border-radius:8px"></video>'
                                : '<button class="is-btn" data-act="watch" data-path="' + esc(f.path) + '">Watch it anyway</button> ') : '') +
      (isVideo && (f.stills || []).length ? '<button class="is-btn" data-act="stills" data-id="' + esc(f.id) + '">' + (S.shown[key] ? 'Hide' : 'Show') + ' one still per shot (' + f.stills.length + ')</button>' : '') +
      (f.captions_path ? ' <button class="is-btn" data-act="dl" data-path="' + esc(f.captions_path) + '">Download captions (.srt)</button>' : '') +
      ' <button class="is-btn" data-act="dl" data-path="' + esc(f.path) + '">Download file</button>' + stills + '</details></section>';
  }

  function viewMedia() {
    var st = S.data.status, m = S.data.media || {}, files = m.files || [];
    var approved = st.artifacts && st.artifacts.narrative && st.artifacts.narrative.state === 'approved';
    var job = st.job, rendering = job && job.kind === 'render' && (job.status === 'queued' || job.status === 'running');
    var head = '<div class="is-panel"><h3>Media review</h3>' + viewGates();
    if (!approved) return head + '<p class="is-muted">Render needs the one editorial approval (the integrated narrative: outline, main script, both Shorts, packaging) on the current version.</p></div>';
    var visOk = (S.data.visuals || {}).state === 'approved';
    // Render is the main button whenever the videos on file are out of date or still carry the old hum; otherwise it is a
    // quiet "Render again" (UI audit 2026-11-03: the button that was needed sat grey beside a green one pointing elsewhere).
    var redo = m.render_job && (!m.current || m.hum);
    var btn = rendering || pictureDrift(job) ? '' : !visOk
      ? '<button class="is-btn primary" data-act="step" data-step="visuals">Approve the visuals first</button>'
      : !m.render_job ? '<button class="is-btn primary" data-act="render">Render the videos</button>'
      : '<button class="is-btn' + (redo ? ' primary' : '') + '" data-act="render" data-new="1">' + (redo ? 'Render the videos again' : 'Render again') + '</button>';
    var stale = m.render_job && !m.current;
    var why = !stale ? '' : m.stale_reason === 'pictures'
      ? 'These videos were made on ' + esc(fmt(m.rendered_at)) + ', before you approved the current pictures, so they are out of date.'
      : 'These videos were made on ' + esc(fmt(m.rendered_at)) + ' from an earlier script, so they are out of date.';
    var cards = files.map(function (f) { return fileCard(f, m.current); }).join('');
    var now = mediaNow(m, job, rendering, stale, visOk);
    return head + now +
      (rendering || (m.blocked && !m.current) ? '' : stale ? '<div class="is-warnbox"><b>' + why + '</b> ' + (visOk ? 'Render the videos again (about 1 to 3 hours), then review the new ones.' : 'Approve the visuals, then render the videos again.') +
        (m.hum ? ' They also still have the old background hum.' : '') + '</div>' : '') +
      (!stale && m.hum && !rendering ? '<div class="is-warnbox"><b>These videos still have the old background hum.</b> They were made before it was removed on Oct 30. Render them again to get versions without it.</div>' : '') +
      (m.render_job && m.current && !m.hum && !pictureDrift(job) ? '<p class="is-muted">Made ' + esc(fmt(m.rendered_at)) + '. ' +
        (m.complete ? '<span class="is-badge ok">Every file approved</span>' : 'Watch each one, then approve it or request a fix.') + '</p>' : '') +
      (!m.render_job ? '<p class="is-muted">Makes a main video, two Shorts, a thumbnail and captions from the approved script and pictures. Files are private to this dashboard; nothing is published.</p>' : '') +
      blockedPanel(m) + (m.render_job && m.current ? currencyBlock(m.currency) : '') + fixRequests(m) +
      '<div class="is-row">' + (m.blocked && !m.current && !rendering ? updateBtn(m.blocked) + dismissBtn(m.blocked, 'render') : '') + btn + '</div>' +
      (stale ? '<details style="margin-top:10px"><summary>The old videos (' + files.length + ', out of date)</summary>' + cards + '</details>' : cards) + '</div>';
  }

  // ONE answer at the top of Media review to "is it rendering, did it stop, what do I do" (founder, 2026-11-04: "is it
  // rendering or has it stopped i have no idea what the latest status is"). Order: a render running > a render that
  // stopped (newer than the videos on file) > videos out of date > videos current. Notes further down are details.
  function mediaNow(m, job, rendering, stale, visOk) {
    // A plain status line, never a second green box: the box at the top of the story is the one place that says what to
    // do (founder, 2026-11-06: "why is there 2 different green tiles of things to do").
    var box = function (cls, headTxt, body) {
      return '<p class="is-media-now ' + cls + '" id="is-media-now" role="status" aria-live="polite"><b>' + esc(headTxt) + ':</b> ' + body + '</p>';
    };
    if (rendering) {
      return box('working', 'Rendering now', '<span class="is-spin" aria-hidden="true"></span>' +
        (job.status === 'queued' ? 'Waiting for the worker to start (requested ' + esc(fmt(job.created_at)) + '). ' :
          'Started ' + esc(fmt(job.started_at || job.created_at)) + '. ') +
        (job.stuck ? jobText(job) : 'A render takes about 1 to 3 hours. Nothing is needed from you; this page updates on its own.'));
    }
    var fb = m.fix_batch;
    if (autoFixing()) return box('working', 'Fixing the videos that failed the checks', '<span class="is-spin" aria-hidden="true"></span>' + esc(autoFixText()));
    if (fb && fb.status === 'planned') {
      return box('you', 'Claude\u2019s plan is ready', 'Claude read your fix requests and wrote what it will change. Nothing has changed yet. ' +
        'The plan is in the green box at the top of this page; confirm it or cancel it there.');
    }
    if (fb && (fb.status === 'plan_queued' || fb.status === 'planning')) {
      return box('working', 'Claude is writing its plan', '<span class="is-spin" aria-hidden="true"></span>Claude is reading your fix requests and what the checks found. ' +
        'In a few minutes this page shows what it will change. Nothing changes until you confirm.');
    }
    var b = m.blocked;
    if (b && !m.current) {
      var fs = b.failures || [], first = fs.filter(function (x) { return !x.fixable; })[0] || fs[0] || {};
      return box('you', 'The last render stopped', 'The render that finished at ' + esc(fmt(b.at)) + ' stopped before making any video. ' +
        'Reason: <b>' + esc(first.label || b.error || 'see below') + '</b>' + (first.detail ? ' (' + esc(first.detail) + ')' : '') + '. ' +
        (first.action ? 'Next: ' + esc(first.action) : 'Next: see the details below.') +
        (fs.length > 1 ? ' <span class="is-muted">' + (fs.length - 1) + ' more item' + (fs.length > 2 ? 's' : '') + ' below.</span>' : ''));
    }
    if (!m.render_job) return '';
    // The top box already says what to do; here only say which videos these are (no second, contradicting next step).
    if (pictureDrift(job)) return '<p class="is-muted" id="is-media-now">The videos below are from ' + esc(fmt(m.rendered_at)) +
      '. The newest render did not run, so these stay on file until a new render finishes. The steps are in the box at the top.</p>';
    if (stale) return box('you', 'The videos are out of date', visOk ? 'Next: press <b>Render the videos again</b> below.' : 'Next: approve the visuals, then render again.');
    if (m.hum) return box('you', 'The videos still have the old hum', 'Next: press <b>Render the videos again</b> below.');
    return box(m.complete ? 'done' : 'you', m.complete ? 'Done' : 'Ready for your review',
      m.complete ? 'Every file is approved.' : 'Watch each video below, then approve it or request a fix.');
  }

  // ── VISUALS: the contact sheet ─────────────────────────────────────────────────────────────────────
  function shotsOf(m, k) { return (((m || {}).assets || {})[k] || {}).shots || []; }
  function vkeys(m) { return ['main', 'short_a', 'short_b', 'thumbnail'].filter(function (k) { return shotsOf(m, k).length; }); }
  // The parts the founder approves one at a time (founder, 2026-10-30: "approve under each act"): each act of the main
  // video, each beat of a Short, the thumbnail.
  function visGroups(m, k) {
    var gs = [], cg = null;
    shotsOf(m, k).forEach(function (sh) {
      var g = k === 'main' ? ('Act ' + (sh.act || '') + (sh.act_name ? ' · ' + sh.act_name : '')) : k === 'thumbnail' ? 'Thumbnail' : (sh.beat || sh.act_name || 'Beat');
      if (!cg || cg.name !== g) { cg = { name: g, shots: [] }; gs.push(cg); }
      cg.shots.push(sh);
    });
    return gs;
  }
  function shotApproved(k, sh) { var d = shotDecision(k, sh.id); return !!(d && d.decision === 'approved'); }
  function groupApproved(k, g) { return g.shots.every(function (sh) { return shotApproved(k, sh); }); }
  function visProgress(m) {
    var all = 0, done = 0;
    vkeys(m).forEach(function (k) { visGroups(m, k).forEach(function (g) { all++; if (groupApproved(k, g)) done++; }); });
    return { all: all, done: done };
  }
  function visShotProgress(m) {
    var all = 0, done = 0;
    vkeys(m).forEach(function (k) { shotsOf(m, k).forEach(function (sh) { all++; if (shotApproved(k, sh)) done++; }); });
    return { all: all, done: done };
  }
  function groupName(k, gi) {
    var g = visGroups((S.data.visuals || {}).manifest, k)[gi];
    return g ? (k === 'main' ? '' : ASSET_LABEL[k] + ', ') + g.name : '';
  }
  // A bar pinned to the bottom of the screen on the Visuals step (founder, 2026-11-01: "there need to be something that
  // tells me something is processing or what to do next"). It always says what is happening and the one next click,
  // wherever the page is scrolled.
  function visDock(v, preparing) {
    var text, btn = '', bar = '', m = v.manifest;
    if (S.vbusy) text = '<span class="is-spin" aria-hidden="true"></span><b>' + esc(S.vbusy) + '</b> Please wait.';
    else if (preparing) {
      var j = v.job || {};
      text = '<span class="is-spin" aria-hidden="true"></span><b>Making new previews' + (j.created_at ? ' (started ' + esc(fmt(j.created_at)) + ')' : '') +
        '.</b> This usually takes 8 to 15 minutes. You can leave this page; it updates on its own.';
    } else if (v.state === 'ready' || v.state === 'needs_fixes') {
      var pr = visProgress(m), sp = visShotProgress(m), nx = nextGroup(v), all = !!pr.all && pr.done === pr.all;
      bar = '<div class="is-vdock-bar" aria-hidden="true"><i style="width:' + (sp.all ? Math.round(100 * sp.done / sp.all) : 0) + '%"></i></div>';
      text = (S.vlast ? '<span class="is-badge ok">✓ ' + esc(S.vlast) + ' approved</span> ' : '') +
        '<b>' + sp.done + ' of ' + sp.all + ' pictures approved</b> (' + pr.done + ' of ' + pr.all + ' parts). ' +
        (v.state === 'needs_fixes' ? esc(v.why || 'Some shots need fixing: prepare the visuals again.')
          : all ? 'Every part is approved. Next: approve the visuals.'
          : nx ? 'Next: ' + esc(groupName(nx.k, nx.gi)) + '.' : '');
      btn = v.state === 'ready' && all ? '<button class="is-btn primary" data-act="vapprove">Approve the visuals</button>'
        : nx ? (nx.k === S.vtab && !S.vlast ? '' : '<button class="is-btn primary" data-act="vnext">Go to ' + esc(groupName(nx.k, nx.gi)) + ' ›</button>') : '';
    } else if (v.state === 'approved') {
      text = '<b>✓ Visuals approved.</b> Next: render the videos (about 1 to 3 hours).';
      btn = '<button class="is-btn primary" data-act="render"' + ((S.data.media || {}).current ? ' data-new="1"' : '') + '>Render the videos</button>';
    } else return '';
    return '<div class="is-vdock" id="is-vdock" role="status" aria-live="polite"><div class="is-vdock-text">' + text + bar + '</div>' + btn + '</div>';
  }
  function setBusy(label, t) {
    S.vbusy = label;
    if (t) { t.disabled = true; t.innerHTML = '<span class="is-spin" aria-hidden="true"></span>' + esc(t.getAttribute('data-busy') || 'Saving…'); }
    var d = S.el && S.el.querySelector('#is-vdock');
    if (d) d.outerHTML = visDock(S.data.visuals || {}, false);
  }
  function visAllDone(v) { v = v || {}; var pr = visProgress(v.manifest); return v.state === 'ready' && !!pr.all && pr.done === pr.all; }
  // the first part (in tab order) that still has a shot to approve
  function nextGroup(v) {
    var m = (v || {}).manifest, out = null;
    vkeys(m).some(function (k) {
      return visGroups(m, k).some(function (g, gi) {
        if (groupApproved(k, g)) return false;
        var left = g.shots.some(function (sh) { var d = shotDecision(k, sh.id); return !d || (d.decision === 'approved' && d.carried); });
        if (left) out = { k: k, gi: gi };
        return left;
      });
    });
    return out;
  }
  function visiblePreviewPaths() {
    var v = S.data.visuals || {}, m = v.manifest || {}, out = [];
    vkeys(m).forEach(function (k) {
      shotsOf(m, k).forEach(function (sh) {
        if (sh.preview && sh.preview.path && (k === S.vtab || sh.status !== 'clear')) out.push(sh.preview.path);
      });
    });
    (m.alternatives || []).concat((v.blocked && v.blocked.candidates) || []).forEach(function (g) {
      (g.candidates || []).forEach(function (c) { if (c.preview && c.preview.path) out.push(c.preview.path); });
    });
    return out.filter(function (p) { return !S.urls[p] && !S.prevFail[p]; });
  }
  // Previews are private files: downloaded with the admin's own session and shown from blob: links (the page's CSP),
  // only the ones on screen, then the sheet is drawn once more.
  function loadPreviews() {
    if (S.loadingPrev) return;
    var need = visiblePreviewPaths();
    if (!need.length) return;
    S.loadingPrev = true;
    // A failed download is remembered, so the redraw does not try it again in a loop; "Try the previews again" clears it.
    Promise.all(need.map(function (p) { return signed(p).then(null, function () { S.prevFail[p] = true; return null; }); })).then(function () {
      S.loadingPrev = false;
      if (S.step === 'visuals' && S.open) renderWorkspace();
    });
  }
  // The in-page box that replaces the browser's confirm/prompt pop-ups for a reject (one is open at a time: S.vask).
  function askBox(text, label, go) {
    var e = S.vask || {};
    return '<div class="is-panel" role="group" aria-label="' + esc(go) + '" style="margin-top:6px;padding:8px">' +
      '<p style="margin:0 0 6px;font-size:12px">' + esc(text) + '</p>' +
      '<label style="display:block;font-size:12px">' + esc(label) +
      '<textarea id="is-vask-note" rows="2" maxlength="1000" style="display:block;width:100%;box-sizing:border-box;margin-top:4px">' + esc(e.note || '') + '</textarea></label>' +
      (e.err ? '<p role="alert" style="margin:4px 0 0;font-size:12px;color:#9b2c1f">' + esc(e.err) + '</p>' : '') +
      '<div class="is-row" style="gap:6px;margin-top:6px"><button class="is-btn primary" data-act="vaskgo">' + esc(go) + '</button>' +
      '<button class="is-btn" data-act="vaskno">Cancel</button></div></div>';
  }
  // "Need new photo" asks what the photo should show and why not this one (founder, 2026-11-06). The two answers are
  // saved as the shot decision's note; the engine searches the first (homesignal-ingest acquire.request_subject) and a
  // photo found for it goes on this shot. "Why not this one:" is the separator the engine splits on.
  var WHY_SEP = '\n\nWhy not this one: ';
  function photoAskBox() {
    var e = S.vask || {};
    return '<div class="is-panel" role="group" aria-label="Ask for a new photo" style="margin-top:6px;padding:8px">' +
      '<p style="margin:0 0 6px;font-size:12px">Describe the photo you want for this shot. Name the person or place if you want a specific one ' +
      '(for example "a photo of Hakeem Jeffries"): only photos whose own title or categories name them are offered.</p>' +
      '<label style="display:block;font-size:12px">What should the new photo show?' +
      '<textarea id="is-vask-want" rows="2" maxlength="600" style="display:block;width:100%;box-sizing:border-box;margin-top:4px">' + esc(e.want || '') + '</textarea></label>' +
      '<label style="display:block;font-size:12px;margin-top:6px">Why not this one? (optional)' +
      '<textarea id="is-vask-why" rows="2" maxlength="350" style="display:block;width:100%;box-sizing:border-box;margin-top:4px">' + esc(e.why || '') + '</textarea></label>' +
      (e.err ? '<p role="alert" style="margin:4px 0 0;font-size:12px;color:#9b2c1f">' + esc(e.err) + '</p>' : '') +
      '<div class="is-row" style="gap:6px;margin-top:6px"><button class="is-btn primary" data-act="vaskgo">Ask for this photo</button>' +
      '<button class="is-btn" data-act="vaskno">Cancel</button></div></div>';
  }
  // The engine (homesignal-ingest job.visuals_with_requests) puts a photo found for a request on its shot and records the
  // choice with entry.for_shot; it lists requests that found no usable photo in the manifest's requests_unfound.
  function requestOutcome(sh, k, noteQ) {
    var v = S.data.visuals || {}, m = v.manifest || {}, ph = sh.photo;
    var forShot = function (fs) { return fs && fs.asset === k && fs.shot === sh.id; };
    var found = ph && ((S.data.media || {}).choices || []).concat(m.auto_choices || []).some(function (c) {
      return c.candidate_id === ph.id && forShot((c.entry || {}).for_shot);
    });
    if (found) return '<span class="is-badge ok" style="margin-top:4px">Found for your request</span>';
    var want = noteQ ? String(noteQ).split(WHY_SEP)[0].trim() : '';
    var miss = want && (m.requests_unfound || []).some(function (u) {
      return u.asset === k && u.shot_id === sh.id && String(u.request || '').trim() === want;
    });
    return miss ? '<span class="is-muted" role="status" style="display:block;margin-top:4px"><b>No usable photo was found for this request.</b> ' +
      'The search found no licensed photo whose own title or categories match it. Try describing it differently (a person\'s full name works best) ' +
      'with Need new photo, then prepare the visuals again.</span>' : '';
  }
  function shotCard(sh, k) {
    var lab = SHOT_LABEL[sh.status] || ['', 'wait'], url = sh.preview && S.urls[sh.preview.path], tall = k === 'short_a' || k === 'short_b';
    var ph = sh.photo, rec = (ph && ph.record) || {};
    var where = ph ? '<span class="is-muted">Photo: ' + esc(ph.credit || rec.title || ph.id) + (rec.page_url ? ' · <a href="' + esc(rec.page_url) + '" target="_blank" rel="noopener noreferrer">file page</a>' : '') + '</span>'
      : sh.photo_needed || sh.illustration ? '<span class="is-muted">No photo yet: showing the record. Choose a photo below.</span>'
      : sh.map ? '<span class="is-muted">Map</span>' : '<span class="is-muted">From the record</span>';
    // Reject and Need new photo under every shot; approval is per act (founder, 2026-10-30). The newest decision shows.
    var rej = ph && rejectedIds()[ph.id], dec = shotDecision(k, sh.id), da = ' data-k="' + esc(k) + '" data-shot="' + esc(sh.id) + '"';
    var DEC = { approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], new_photo: ['New photo asked for', 'warn'] };
    var ask = S.vask && S.vask.kind === 'newphoto' && S.vask.k === k && S.vask.shot === sh.id ? photoAskBox()
      : S.vask && S.vask.kind === 'shot' && S.vask.k === k && S.vask.shot === sh.id ? askBox(ph
      ? 'Reject this photo? It is removed from every shot that uses it, in every video. Then prepare the visuals again to get new photos.'
      : 'Say what is wrong with this shot. It stays rejected until you approve it or prepare the visuals again.',
      ph ? 'What should the photo show instead? (optional; the next Prepare looks for it)' : 'What is wrong with this shot?', 'Reject this shot') : '';
    var rejBtn = ask || '<div class="is-row" style="gap:6px;margin-top:6px;flex-wrap:wrap">' +
      (rej ? '<span class="is-badge bad">Photo rejected</span> <button class="is-btn" data-act="vrestore" data-photo="' + esc(ph.id) + '">Use it again</button>'
       : (dec && DEC[dec.decision] ? '<span class="is-badge ' + DEC[dec.decision][1] + '">' + esc(dec.carried ? 'Approved earlier (same picture)' : DEC[dec.decision][0]) + '</span>' : '') +
         '<button class="is-btn" data-act="vshot" data-d="rejected"' + da + (ph ? ' data-photo="' + esc(ph.id) + '"' : '') + '>Reject</button>' +
         (sh.subject_ref ? '<button class="is-btn" data-act="vshot" data-d="new_photo"' + da + '>Need new photo</button>' : '')) +
      '</div>';
    // What the founder asked this shot to show (a Need new photo or Reject note), kept across preparations until the
    // shot is approved: shown on the new previews too, so a request is never silently lost (founder, 2026-11-07).
    var reqQ = ((S.data.visuals || {}).photo_requests || []).filter(function (r) { return r.asset === k && r.shot_id === sh.id; })[0];
    var noteQ = reqQ ? reqQ.note : dec && dec.note;
    rejBtn += noteQ ? (reqQ || dec.decision === 'new_photo'
      ? '<span class="is-muted">You asked for: ' + esc(noteQ.split(WHY_SEP)[0]) +
        (noteQ.indexOf(WHY_SEP) >= 0 ? '<br>Why not this one: ' + esc(noteQ.split(WHY_SEP)[1]) : '') + '</span>'
      : '<span class="is-muted">Your note: ' + esc(noteQ) + '</span>') : '';
    // What the last Prepare did with the request (audit, 2026-11-07): the photo it put on this shot is labelled, and a
    // search that found nothing usable says so, instead of the old picture standing there as if nothing was tried.
    rejBtn += requestOutcome(sh, k, noteQ);
    return '<figure class="is-shot" style="margin:0;width:' + (tall ? '170px' : '300px') + '">' +
      (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img alt="' + esc(ASSET_LABEL[k] + ', shot ' + sh.id) + '" src="' + esc(url) + '" style="width:100%;border-radius:6px;border:1px solid var(--line)"></a>'
           : '<div class="is-muted" style="aspect-ratio:' + (tall ? '9/16' : '16/9') + ';display:flex;align-items:center;justify-content:center;border:1px dashed var(--line);border-radius:6px">' +
             (sh.preview && S.prevFail[sh.preview.path] ? 'Preview could not be loaded' : 'Loading preview…') + '</div>') +
      '<figcaption style="font-size:12px;margin-top:4px"><span class="is-badge ' + lab[1] + '">' + esc(lab[0]) + '</span> <b>' + esc(sh.id) + '</b>' +
      (sh.start_s != null ? ' <span class="is-muted">' + esc(secs(sh.start_s)) + '</span>' : '') + '<br>' + esc(sh.label || '') +
      (sh.onscreen ? '<br>“' + esc(sh.onscreen) + '”' : '') + (sh.subline ? '<br><span class="is-muted">' + esc(sh.subline) + '</span>' : '') + (sh.cta ? ' <span class="is-badge ok">' + esc(sh.cta) + '</span>' : '') + '<br>' + where +
      ((sh.reasons || []).length ? '<ul class="is-list" style="margin:4px 0 0">' + sh.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' : '') +
      rejBtn + '</figcaption></figure>';
  }
  // Photos the founder rejected for this story (hs_impact_story_photo_reject): never shown in it again; the next
  // Prepare searches new licensed photos for their subjects and leaves these files out.
  function shotDecision(k, id) {
    var v = S.data.visuals || {}, list = v.shot_decisions || [], i;
    for (i = 0; i < list.length; i++) if (list[i].asset === k && list[i].shot_id === id) return list[i];
    // approved on the previous previews and the picture did not change (_hs_is_visuals carried_decisions)
    var old = v.carried_decisions || [];
    for (i = 0; i < old.length; i++) if (old[i].asset === k && old[i].shot_id === id) return Object.assign({ carried: true }, old[i]);
    return null;
  }
  function rejectedIds() {
    var out = {};
    (((S.data || {}).visuals || {}).rejected || []).forEach(function (r) { if (r && r.id) out[r.id] = r; });
    return out;
  }
  function rejectedPanel() {
    var list = ((S.data.visuals || {}).rejected) || [], more = ((S.data.visuals || {}).more_photos_for) || [];
    var b = (S.data.version && S.data.version.body) || {}, names = {};
    (((b.discovery || {}).subjects) || []).forEach(function (x) { if (x && x.id) names[x.id] = x.subject || x.id; });
    var ask = more.length ? '<div class="is-panel" style="margin-top:8px"><h4>New photos asked for</h4><p>' + more.map(function (x) { return esc(names[x] || x); }).join(', ') +
      '. Click <b>Prepare the visuals again</b>: new licensed photos are searched for them and shown under "Other licensed photos".</p></div>' : '';
    if (!list.length) return ask;
    return '<div class="is-panel" style="margin-top:8px"><h4>Rejected photos (' + list.length + ')</h4>' +
      '<p class="is-muted">Not shown anywhere in this story. Prepare the visuals again: new licensed photos are searched for their subjects (leaving these out), or the shot shows its record until you choose one.</p>' +
      '<ul class="is-list">' + list.map(function (r) {
        return '<li>' + esc(r.title || r.id) + ' <button class="is-btn" data-act="vrestore" data-photo="' + esc(r.id) + '">Use it again</button></li>';
      }).join('') + '</ul></div>' + ask;
  }
  function altPanel(groups, job, title) {
    if (!(groups || []).length) return '';
    var chosen = {};
    ((S.data.media || {}).choices || []).forEach(function (c) { chosen[c.subject_id + '|' + c.candidate_id] = true; });
    return '<div class="is-panel" style="margin-top:8px"><h4>' + esc(title) + '</h4>' +
      '<p class="is-muted">Add every photo you are happy with. The video picks the best one for each shot from the photos you added, and uses more of them the more you add.</p>' + groups.map(function (g) {
      return '<section class="is-angle"><b>' + esc(g.subject || g.subject_id) + '</b>' + ((g.candidates || []).length ? '<div class="is-row" style="flex-wrap:wrap;gap:10px;margin-top:6px">' +
        g.candidates.map(function (c) {
          var u = c.preview && S.urls[c.preview.path], on = !!chosen[g.subject_id + '|' + c.id];
          return '<figure style="margin:0;width:180px">' + (u ? '<img alt="' + esc(c.title || c.id) + '" src="' + esc(u) + '" style="width:100%;border-radius:6px">' : '') +
            '<figcaption style="font-size:12px"><a href="' + esc(c.page_url || '#') + '" target="_blank" rel="noopener noreferrer">' + esc(c.title || c.id) + '</a><br>' + esc(c.license || '') + ' · ' + esc(c.author || '') +
            '<br><span class="is-muted">Shown as a REPRESENTATIVE PHOTO</span><br>' +
            (on ? '<span class="is-badge ok">✓ In your photos</span> <button class="is-btn" data-act="unchoose" data-subject="' + esc(g.subject_id) + '" data-id="' + esc(c.id) + '">Remove</button>'
                : '<button class="is-btn" data-act="choose" data-job="' + esc(job) + '" data-subject="' + esc(g.subject_id) + '" data-id="' + esc(c.id) + '">Add to your photos</button>') +
            '</figcaption></figure>';
        }).join('') + '</div>' : '<p class="is-muted">No licensed photo was found' + ((g.errors || []).length ? ' (' + esc(g.errors.slice(0, 2).join('; ')) + ')' : '') + '.</p>') + '</section>';
    }).join('') + '</div>';
  }
  // Every photo the founder has added, per subject, each with Remove: the set the engine picks the best fit from.
  function yourPhotosPanel() {
    var list = ((S.data.media || {}).choices || []);
    if (!list.length) return '';
    var b = (S.data.version && S.data.version.body) || {}, names = {}, by = {}, order = [];
    (((b.discovery || {}).subjects) || []).forEach(function (x) { if (x && x.id) names[x.id] = x.subject || x.id; });
    list.forEach(function (c) { if (!by[c.subject_id]) { by[c.subject_id] = []; order.push(c.subject_id); } by[c.subject_id].push(c); });
    return '<div class="is-panel" style="margin-top:8px"><h4>Your photos (' + list.length + ')</h4>' +
      '<p class="is-muted">The video picks the best one for each shot from these. Prepare the visuals again after adding or removing photos.</p>' +
      order.map(function (sid) {
        return '<p style="margin:6px 0 2px"><b>' + esc(names[sid] || sid) + '</b> (' + by[sid].length + ')</p><ul class="is-list">' + by[sid].map(function (c) {
          return '<li>' + esc(String(c.title || c.candidate_id).replace(/^File:/, '')) + (c.source === 'founder_upload' ? ' <span class="is-muted">(your upload)</span>' : '') +
            ' <button class="is-btn" data-act="unchoose" data-subject="' + esc(sid) + '" data-id="' + esc(c.candidate_id) + '">Remove</button></li>';
        }).join('') + '</ul>';
      }).join('') + '</div>';
  }
  // A photo the founder took or may use (plan v3 §6.3 "Upload owned/cleared photo"). The file goes into this story's
  // private uploads folder with the admin's own session; hs_impact_story_upload_photo records it with the permission
  // statement below (the same words the database stores) and makes it that subject's photo. The engine checks the
  // checksum taken here against the file before it shows it.
  var UPLOAD_PERMISSION = 'I own this photo or have permission to use it in JODY Tracks videos.';
  var UPLOAD_MAX = 15728640;
  function uploadPanel() {
    var b = (S.data.version && S.data.version.body) || {}, subs = ((b.discovery || {}).subjects || []).filter(function (x) { return x && x.id; });
    if (!subs.length) return '';
    var f = upState(), mine = ((S.data.media || {}).choices || []).filter(function (c) { return c.source === 'founder_upload'; });
    var label = {};
    subs.forEach(function (x) { label[x.id] = x.subject || x.id; });
    return '<div class="is-panel" style="margin-top:8px"><h4>Use your own photo</h4>' +
      '<p class="is-muted">A photo you took or have permission to use. It is added to that subject\'s photos, and the video can use it in any shot about that subject. JPEG or PNG, under 15 MB. Prepare the visuals again afterwards to see it in place.</p>' +
      (mine.length ? '<ul class="is-list">' + mine.map(function (c) {
        return '<li><b>' + esc(label[c.subject_id] || c.subject_id) + '</b>: your photo (credit ' + esc(c.author || '') + '), added ' + esc(fmt(c.at)) + '</li>';
      }).join('') + '</ul>' : '') +
      '<div class="is-row" style="flex-wrap:wrap;gap:10px;align-items:flex-end">' +
      '<label>Subject<br><select id="is-up-subj">' + subs.map(function (x) {
        return '<option value="' + esc(x.id) + '"' + (f.subject === x.id ? ' selected' : '') + '>' + esc(x.subject || x.id) + '</option>';
      }).join('') + '</select></label>' +
      '<label>Photo<br><input type="file" id="is-up-file" accept="image/jpeg,image/png">' +
      (f.file ? '<br><span class="is-muted" id="is-up-chosen">Chosen: ' + esc(f.file.name) + '</span>' : '') + '</label>' +
      '<label>Credit shown on screen<br><input id="is-up-credit" maxlength="120" placeholder="Who took it" value="' + esc(f.credit || '') + '"></label></div>' +
      '<label style="display:block;margin-top:6px"><input type="checkbox" id="is-up-site"' + (f.site ? ' checked' : '') + '> This photo shows this site (otherwise it is labelled REPRESENTATIVE PHOTO)</label>' +
      '<label style="display:block;margin-top:4px"><input type="checkbox" id="is-up-perm"' + (f.perm ? ' checked' : '') + '> ' + esc(UPLOAD_PERMISSION) + '</label>' +
      '<div class="is-row" style="margin-top:6px"><button class="is-btn" data-act="vupload">Upload photo</button></div></div>';
  }
  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  // The panel is redrawn whenever the page refreshes (every few seconds while a job runs), so what the founder has
  // chosen and typed lives in S.upForm, kept for the story it was filled in for, not in the inputs.
  function upState() { return (S.upForm && S.upForm.story === S.open) ? S.upForm : {}; }
  function syncUpload(t) {
    if (!t || !/^is-up-/.test(t.id || '')) return;
    var f = upState();
    if (f.story !== S.open) { f = S.upForm = { story: S.open }; }
    if (t.id === 'is-up-subj') f.subject = t.value;
    if (t.id === 'is-up-credit') f.credit = t.value;
    if (t.id === 'is-up-site') f.site = !!t.checked;
    if (t.id === 'is-up-perm') f.perm = !!t.checked;
    if (t.id === 'is-up-file') { f.file = (t.files && t.files[0]) || null; var c = S.el.querySelector('#is-up-chosen'); if (c) c.remove(); }
  }
  function uploadPhoto() {
    var story = S.open, q = function (id) { return S.el.querySelector('#' + id); };
    ['is-up-subj', 'is-up-credit', 'is-up-site', 'is-up-perm'].forEach(function (id) { syncUpload(q(id)); });
    var inp = q('is-up-file'); if (inp && inp.files && inp.files[0]) syncUpload(inp);
    var f = upState(), file = f.file, subject = f.subject, credit = (f.credit || '').trim(), site = !!f.site, perm = !!f.perm;
    var bad = !file ? 'Choose a photo to upload.'
      : (file.type !== 'image/jpeg' && file.type !== 'image/png') ? 'Upload a JPEG or PNG photo.'
      : file.size > UPLOAD_MAX ? 'The photo must be smaller than 15 MB.'
      : credit.length < 2 ? 'Say who took the photo. It is shown on screen as the credit.'
      : !perm ? 'Confirm that you own this photo or have permission to use it.' : null;
    if (!bad && !(window.crypto && crypto.subtle && crypto.randomUUID)) bad = 'This browser cannot check the photo before uploading it. Use a current browser on the https dashboard.';
    if (bad) return Promise.reject(new Error(bad));
    var id = crypto.randomUUID(), path = story + '/uploads/' + id + (file.type === 'image/png' ? '.png' : '.jpg');
    return file.arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); }).then(function (d) {
      var sha = hex(d);
      return S.client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false }).then(function (r) {
        if (r && r.error) throw r.error;
        return rpc('hs_impact_story_upload_photo', { p_story: story, p_subject: subject, p_upload: id, p_mime: file.type,
          p_sha256: sha, p_credit: credit, p_shows_site: site, p_permission: perm });
      });
    }).then(function () { return story; });
  }
  // One bar at the top of Visuals: where things stand and the one next step (founder, 2026-10-30: "the ui design is bad").
  function visStatusBar(v, preparing, btns, c) {
    var j = v.job || {}, head, next = '', allDone = false, cls = VIS_CLS[v.state] || 'wait';
    if (preparing) {
      head = 'Making new previews' + (j.created_at ? ' (started ' + fmt(j.created_at) + ')' : '') + '.';
      next = 'This usually takes 8 to 15 minutes. ' + (v.manifest_id ? 'The pictures below are the previous set until it finishes.' : 'The pictures appear here when it finishes.');
      cls = 'wait';
    } else if (v.state === 'none') { head = 'Not prepared yet.'; next = 'Next: click Prepare the visuals.'; }
    else if (v.state === 'blocked') { var why = visualsStop(v.blocked); head = why.head + '.'; next = why.body; }
    else if (v.state === 'failed') { head = 'Preparing failed.'; next = (v.why ? v.why + ' ' : '') + 'Next: click Prepare the visuals again.'; }
    else if (v.state === 'stale') { head = 'These previews are out of date.'; next = (v.why || '') + (/again/.test(v.why || '') ? '' : ' Next: click Prepare the visuals again.'); }
    else if (v.state === 'needs_fixes') { head = 'Some shots need fixing.'; next = v.why || ''; }
    else if (v.state === 'ready') {
      var pr = visProgress(v.manifest);
      // every part can already read approved (approvals kept from the previous previews) with the set itself not yet
      // approved: then the one click left is approving the set, so say so and make it the main button
      allDone = !!pr.all && pr.done === pr.all;
      head = allDone ? 'Every part is approved. One click left.' : 'Ready for your approval: ' + pr.done + ' of ' + pr.all + ' parts approved.';
      next = allDone ? 'Next: click Approve the visuals.' : 'Look at each act below and click Approve this act under it. When every act, Short and the thumbnail are approved, the visuals are approved.';
    }
    else if (v.state === 'approved') { head = 'Visuals approved.'; next = 'Next: click Render the videos.'; }
    else { head = VIS_LABEL[v.state] || v.state || ''; next = v.why || ''; }
    var approve = preparing || v.state !== 'ready' ? ''
      : allDone ? ' <button class="is-btn primary" data-act="vapprove">Approve the visuals</button>'
      : ' <button class="is-btn" data-act="vapprove">Approve everything at once</button>';
    return '<div class="is-panel" id="is-visbar" role="status" style="margin:8px 0;border-left:4px solid var(--line)">' +
      '<p style="margin:0 0 4px"><span class="is-badge ' + cls + '">' + esc(preparing ? 'Preparing' : (VIS_LABEL[v.state] || v.state)) + '</span> <b>' + esc(head) + '</b></p>' +
      (next ? '<p style="margin:0 0 8px">' + esc(next) + '</p>' : '') +
      (v.created_at && !preparing ? '<p class="is-muted" style="margin:0 0 8px">Previews prepared ' + esc(fmt(v.created_at)) + '.</p>' : '') +
      '<div class="is-row">' + btns + approve + '</div>' + dupPhotoWarning() + '</div>';
  }
  // One photo used for two different subjects (a lake photo chosen for both the lake and a stream) is almost always a
  // mistake: say so, naming both subjects and the photo.
  function dupPhotoWarning() {
    var v = S.data.visuals || {}, m = v.manifest || {}, b = (S.data.version && S.data.version.body) || {}, names = {}, by = {}, title = {};
    (((b.discovery || {}).subjects) || []).forEach(function (x) { if (x && x.id) names[x.id] = x.subject || x.id; });
    function add(pid, subj, t) {
      if (!pid || !subj) return;
      (by[pid] = by[pid] || {})[subj] = true;
      if (t && !title[pid]) title[pid] = t;
    }
    ((S.data.media || {}).choices || []).forEach(function (c) { add(c.candidate_id, c.subject_id, c.entry && c.entry.title); });
    vkeys(m).forEach(function (k) { shotsOf(m, k).forEach(function (sh) {
      if (sh.photo && sh.photo.id) add(sh.photo.id, sh.subject_ref, (sh.photo.record || {}).title || sh.photo.credit);
    }); });
    var out = Object.keys(by).filter(function (pid) { return Object.keys(by[pid]).length > 1; }).map(function (pid) {
      return '<li>' + esc(String(title[pid] || pid).replace(/^File:/, '')) + ' is used for ' +
        esc(Object.keys(by[pid]).map(function (x) { return names[x] || x; }).join(' and ')) + '. Choose a different photo for one of them.</li>';
    });
    return out.length ? '<div class="is-warnbox" style="margin-top:8px"><b>The same photo is used for different subjects</b><ul class="is-list">' + out.join('') + '</ul></div>' : '';
  }
  function viewPreviews() {
    var st = S.data.status, v = S.data.visuals || {}, m = v.manifest || {}, c = v.counts || {};
    var approved = st.artifacts && st.artifacts.narrative && st.artifacts.narrative.state === 'approved';
    var job = st.job, preparing = job && job.kind === 'visuals' && (job.status === 'queued' || job.status === 'running');
    var head = '<div class="is-panel"><h3>Visuals</h3>' + viewGates();
    if (!approved) return head + '<p class="is-muted">The visuals are prepared from the approved integrated narrative. Approve it in Script &amp; Shorts first.</p></div>';
    var intro = '<p class="is-muted">Every shot of the main video, both Shorts and the thumbnail, made by the same compositor as the video ' +
      '(one still per shot, no video yet). Add every photo you like under "More licensed photos" below; the video picks the best one for each shot. ' +
      'Then approve each act. The render shows exactly what you approved.</p>';
    var btns = preparing ? '' : (v.state === 'blocked' ? updateBtn(v.blocked) + dismissBtn(v.blocked) : '') + '<button class="is-btn' + (v.state === 'ready' || v.state === 'approved' ? '' : ' primary') + '" data-act="vprep"' + (v.manifest_id || v.job ? ' data-new="1"' : '') + '>' +
      (v.manifest_id ? 'Prepare the visuals again' : 'Prepare the visuals') + '</button>' +
      (v.state === 'approved' ? ' <button class="is-btn" data-act="vrevoke">Revoke approval</button> <button class="is-btn primary" data-act="render"' + ((S.data.media || {}).current ? ' data-new="1"' : '') + '>Render the videos</button>' : '');
    var blocked = v.blocked ? '<div class="is-warnbox" style="margin-top:8px"><b>' + (v.blocked.blocked ? visualsStop(v.blocked).head : 'Preparing failed') + '</b> (' + esc(fmt(v.blocked.at)) + '). ' +
      esc(v.blocked.error || '') + failureList(v.blocked.failures) + (v.blocked.candidates_error ? '<p>' + esc(v.blocked.candidates_error) + '</p>' : '') + '</div>' +
      altPanel(v.blocked.candidates, v.blocked.job_id, 'Photos the search looked at') : '';
    var bar = visStatusBar(v, preparing, btns, c);
    var dock = visDock(v, preparing);
    if (!v.manifest_id) return head + bar + intro + blocked + yourPhotosPanel() + uploadPanel() + dock + '</div>';
    var keys = vkeys(m);
    if (keys.indexOf(S.vtab) < 0) S.vtab = keys[0] || 'main';
    var exceptions = [];
    keys.forEach(function (k) { shotsOf(m, k).forEach(function (sh) { if (sh.status !== 'clear') exceptions.push([k, sh]); }); });
    var tabs = '<div class="is-row" role="tablist" aria-label="Video" style="margin:10px 0">' + keys.map(function (k) {
      var n = shotsOf(m, k), bad = n.filter(function (x) { return x.status !== 'clear'; }).length;
      return '<button class="is-chip" role="tab" data-act="vtab" data-k="' + k + '" aria-pressed="' + (S.vtab === k) + '" aria-selected="' + (S.vtab === k) + '">' +
        esc(ASSET_LABEL[k]) + ' · ' + visGroups(m, k).filter(function (g) { return groupApproved(k, g); }).length + ' of ' + visGroups(m, k).length + ' approved' + '</button>';
    }).join('') + '</div>';
    var groups = visGroups(m, S.vtab);
    var rejMap = rejectedIds(), canApprove = v.state === 'ready' || v.state === 'needs_fixes';
    var sheet = groups.map(function (g, gi) {
      var mine = g.shots.filter(function (sh) { return sh.photo && sh.photo.id && !rejMap[sh.photo.id]; });
      var word = S.vtab === 'main' ? 'act' : 'part', ok = groupApproved(S.vtab, g);
      var left = g.shots.filter(function (sh) { var d = shotDecision(S.vtab, sh.id); return !d || (d.decision === 'approved' && d.carried); }).length;
      var approve = v.state === 'approved' || ok ? '<span class="is-badge ok">✓ Approved</span>'
        : canApprove && !left ? '<span class="is-badge warn">Needs a fix: prepare the visuals again</span>'
        : canApprove ? '<button class="is-btn primary" data-act="vapprovegroup" data-k="' + esc(S.vtab) + '" data-group="' + gi + '">Approve this ' + word + '</button>' : '';
      return '<section id="is-vgroup-' + esc(S.vtab) + '-' + gi + '" style="margin-top:14px;padding-top:8px;border-top:1px solid var(--line)"><h4 style="margin:0 0 6px">' + esc(g.name) + '</h4>' +
        '<div class="is-row" style="flex-wrap:wrap;gap:10px;align-items:flex-start">' +
        g.shots.map(function (sh) { return shotCard(sh, S.vtab); }).join('') + '</div>' +
        '<div class="is-row" style="margin-top:8px;gap:8px">' + approve +
        (mine.length ? ' <button class="is-btn" data-act="vrejectgroup" data-group="' + gi + '">Reject every photo in this ' + word + '</button>' : '') + '</div>' +
        (S.vask && S.vask.kind === 'group' && S.vask.k === S.vtab && S.vask.group === gi
          ? askBox('Reject ' + (S.vask.ids.length === 1 ? 'this photo' : 'these ' + S.vask.ids.length + ' photos') + ' for this story? ' +
              (S.vask.ids.length === 1 ? 'It is' : 'They are') + ' removed from every shot that uses ' + (S.vask.ids.length === 1 ? 'it' : 'them') +
              ', in every video. Then prepare the visuals again to get new photos.', 'Why? (optional)', 'Reject ' + (S.vask.ids.length === 1 ? 'the photo' : 'all ' + S.vask.ids.length + ' photos'))
          : '') + '</section>';
    }).join('');
    // a short list, not a second copy of the shot cards: each shot's buttons live once, in the sheet below
    var exc = exceptions.length ? '<div class="is-panel" style="margin-top:8px"><h4>Needs your attention (' + exceptions.length + ')</h4><ul class="is-list">' +
      exceptions.map(function (x) {
        var sh = x[1], lab = SHOT_LABEL[sh.status] || ['', 'wait'], gi = -1;
        visGroups(m, x[0]).some(function (g, i) { if (g.shots.indexOf(sh) >= 0) { gi = i; return true; } return false; });
        return '<li><span class="is-badge ' + lab[1] + '">' + esc(lab[0]) + '</span> <b>' + esc(ASSET_LABEL[x[0]]) + ', ' + esc(sh.id) + '</b> ' + esc(sh.label || '') +
          (sh.photo_needed || sh.illustration ? ' · No photo yet: showing the record.' : '') +
          ((sh.reasons || []).length ? ' · ' + esc(sh.reasons.join('; ')) : '') +
          ' <button class="is-btn" data-act="vgoto" data-k="' + esc(x[0]) + '" data-group="' + gi + '">Show it</button></li>';
      }).join('') + '</ul></div>' : '';
    return head + bar + intro +
      '<p class="is-muted">' + esc((c.clear || 0) + ' clear · ' + (c.flagged || 0) + ' to look at · ' + (c.blocked || 0) + ' blocked') +
      (m.identity && m.identity.same === false ? ' · <b>the previews did not match the render; prepare again</b>' : '') + '</p>' +
      (Object.keys(S.prevFail).length ? '<p class="is-muted">Some previews could not be loaded. <button class="is-btn" data-act="vretry">Try the previews again</button></p>' : '') +
      blocked + exc + tabs + sheet +
      '<h3 style="margin-top:22px">Photos</h3>' +
      yourPhotosPanel() + altPanel(m.alternatives, v.manifest_job_id, 'More licensed photos you can add') +
      (m.alternatives_error ? '<p class="is-muted">' + esc(m.alternatives_error) + '</p>' : '') + rejectedPanel() + uploadPanel() + dock + '</div>';
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
        // the Bluesky post's verified action link (homesignal-ingest impact/action_link.py decides; this only shows it)
        var act = v.destination !== 'bluesky' ? '' :
          (v.action_url ? '<span class="is-badge ok">Action link included' + (v.action_deadline ? ' · deadline ' + esc(v.action_deadline) : '') + '</span>'
            : '<span class="is-badge wait">No open, verified action to link</span>') +
          (v.manual ? '<span class="is-badge wait">Edited by hand · kept as written</span>' : '') +
          (v.action_missing ? '<span class="is-badge bad">Leaves out the verified action link</span>' : '');
        return '<section class="is-angle"><div class="is-row"><b>' + esc(dest[v.destination] || v.destination) + '</b> <span class="is-muted">' + esc(v.asset) + ' · ' + esc(v.format) + '</span>' +
          '<span class="is-badge wait">Not published</span>' + (v.connection === 'not_connected' ? '<span class="is-badge wait">Not connected</span>' : '') +
          '<span class="is-badge wait">Automatic publishing: unavailable</span>' +
          (v.full_video_pending ? '<span class="is-badge bad">Full video URL pending</span>' : '') +
          (v.destination === 'bluesky' && v.fits === false ? '<span class="is-badge bad">Over 300 characters (' + esc(v.chars) + ')</span>' : '') + act + '</div>' +
          (v.note ? '<p class="is-muted">' + esc(v.note) + '</p>' : '') +
          '<div class="is-pre" id="var-' + i + '">' + esc(txt) + '</div>' +
          '<button class="is-btn" data-act="copy" data-i="' + i + '">Copy text</button></section>';
      }).join('') + actionsPanel(d.variants.actions) +
      '<div class="is-row"><button class="is-btn" data-act="export"' + (ready ? '' : ' disabled') + '>Download export package (text, JSON)</button>' +
      (ready ? '' : '<span class="is-muted">Export unlocks when every editorial approval is in place.</span>') + '</div></div>';
  }

  // Every public action research recorded, open or not. Only a verified, open one may go in the post.
  var ACTION_STATE = { open: ['ok', 'Open'], closes_today: ['warn', 'Closes today'], none: ['ok', 'Open (no deadline)'],
    expired: ['bad', 'Closed'], unknown: ['bad', 'No readable deadline'] };
  function actionsPanel(list) {
    if (!list || !list.length) return '<p class="is-muted">Public actions: research found none for this story, so the post and the thumbnail carry no call to action.</p>';
    return '<section class="is-angle"><b>Public actions found in research</b><ul>' + list.map(function (o) {
      var st = ACTION_STATE[o.state] || ['wait', o.state];
      return '<li><span class="is-badge ' + st[0] + '">' + esc(st[1]) + '</span> ' +
        (o.verified ? '<span class="is-badge ok">Verified</span> ' : '<span class="is-badge bad">Not verified: ' + esc((o.problems || []).join('; ')) + '</span> ') +
        esc(o.label) + (o.deadline ? ' · deadline ' + esc(o.deadline) : '') +
        (o.url ? ' · <a href="' + esc(o.url) + '" target="_blank" rel="noopener noreferrer">' + esc(o.url) + '</a>' : '') + '</li>';
    }).join('') + '</ul></section>';
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
    return p.then(function (r) { return r; }, function (e) { S.vbusy = null; S.msg = { bad: true, text: errText(e) }; return S.open ? refresh(false) : renderLibrary(); });
  }
  function onClick(ev) {
    var ct = ev.target.closest('[data-cs-act]');
    if (ct && S.el.contains(ct) && S.csEd && CR()) {
      var res = CR().onAction(S.csEd, ct);
      if (res && res !== 'render') S.msg = { bad: true, text: res };
      if (res) renderWorkspace();
      return;
    }
    var t = ev.target.closest('[data-act]'); if (!t || !S.el.contains(t)) return;
    if (/^cs-/.test(t.getAttribute('data-act'))) return creatorClick(t);
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
    if (a === 'open') { S.another = false; S.av = {}; return openStory(id, null, true); }
    if (a === 'another') { S.another = true; renderWorkspace(); var at = S.el.querySelector('#is-av-title'); if (at) at.focus(); return; }
    if (a === 'anothercancel') { S.another = false; S.av = {}; return renderWorkspace(); }
    if (a === 'anothersend') {
      var typeSel = S.el.querySelector('#is-av-type');
      var video = { story_type: S.av.story_type || (typeSel && typeSel.value) || '', title: (S.av.title || '').trim(), note: (S.av.note || '').trim() || null,
        links: String(S.av.links || '').split(/\s+/).map(function (x) { return x.trim(); }).filter(Boolean) };
      if (video.title.length < 5) { S.msg = { bad: true, text: 'Give the new video a title (at least 5 characters).' }; return renderWorkspace(); }
      S.anotherBusy = true; renderWorkspace();
      return act(rpc('hs_impact_story_another_video', { p_story: S.open, p_video: video }).then(function () {
        S.anotherBusy = false; S.another = false; S.av = {};
        S.msg = { text: 'Research for the new video has started. It reuses this research’s verified records, checks what the new video needs, and becomes its own story with its own approvals (it shows in Hot Topics until then). This story is not changed.' };
        return refresh(false);
      }, function (e) { S.anotherBusy = false; throw e; }));
    }
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
    if (a === 'sbsel') { S.sbSel = t.getAttribute('data-key'); return renderWorkspace(); }
    if (a === 'sbfull') { S.sbFull = !S.sbFull; return renderWorkspace(); }
    if (a === 'sbissues') { S.sbIssues = !S.sbIssues; return renderWorkspace(); }
    if (a === 'claim') { S.drawer = { kind: 'claim', id: id }; return renderWorkspace(); }
    if (a === 'close-drawer') { S.drawer = null; return renderWorkspace(); }
    if (a === 'req') {
      t.disabled = true;
      var kind = t.getAttribute('data-kind'), scope = t.getAttribute('data-scope') || 'all', isNew = t.getAttribute('data-new') === '1';
      if (isNew && kind !== 'pack' && !confirm('This reads the story Claude wrote for this project again and creates a new version. Your current version is kept. Continue?')) { t.disabled = false; return; }
      return act(rpc('hs_impact_story_request', { p_story: S.open, p_kind: kind, p_scope: scope, p_new: isNew }).then(function (r) {
        S.msg = { text: r.existing ? 'That request already exists (' + r.status + '). Showing it instead of starting another run.' : 'Queued. This page updates on its own.' };
        return refresh(false);
      })).then(function (r) { S.vbusy = null; return r; }, function (e) { S.vbusy = null; throw e; });
    }
    if (a === 'render') {
      t.disabled = true;
      if (t.getAttribute('data-new') === '1' && !confirm('Render this narrative again? The current files stay as history; the new files need reviewing again.')) { t.disabled = false; return; }
      if (S.step === 'visuals') setBusy('Starting the render…', t);
      return act(rpc('hs_impact_story_render', { p_story: S.open, p_expected_version: S.data.story.current_version, p_new: t.getAttribute('data-new') === '1' }).then(function (r) {
        S.vbusy = null;
        S.msg = { text: r.existing ? 'That render already exists (' + r.status + '). Showing it instead of starting another.' : 'Render queued. It takes about 1 to 3 hours; this page updates on its own.' };
        S.step = 'media'; writeHash(false); return refresh(false);
      })).then(function (r) { S.vbusy = null; return r; }, function (e) { S.vbusy = null; throw e; });
    }
    if (a === 'choose') {
      // One save at a time: every "Use this photo" button stays disabled until the save and the redraw that follows
      // it have finished, so a click during the redraw cannot look as if it worked.
      if (S.choosing) return;
      S.choosing = true;
      lockChoose(true);
      t.textContent = 'Saving…';
      return act(rpc('hs_impact_story_choose_asset', { p_story: S.open, p_job: t.getAttribute('data-job'), p_subject: t.getAttribute('data-subject'), p_candidate: id })
        .then(function () {
          S.msg = { text: S.step === 'visuals' ? 'Photo added. Add any others you like, then prepare the visuals again.' : 'Photo added. Render the videos again to use it.' };
          return refresh(false);
        })).then(function () { S.choosing = false; lockChoose(false); }, function () { S.choosing = false; lockChoose(false); });
    }
    if (a === 'unchoose') {
      if (S.choosing) return;
      S.choosing = true;
      lockChoose(true);
      t.textContent = 'Saving…';
      return act(rpc('hs_impact_story_unchoose_asset', { p_story: S.open, p_subject: t.getAttribute('data-subject'), p_candidate: id })
        .then(function () { S.msg = { text: 'Photo removed. Prepare the visuals again to see the change.' }; return refresh(false); }))
        .then(function () { S.choosing = false; lockChoose(false); }, function () { S.choosing = false; lockChoose(false); });
    }
    if (a === 'vapprovegroup') {
      var va = S.data.visuals || {}, gk = t.getAttribute('data-k'), storyA = S.open;
      var grp = visGroups(va.manifest, gk)[+t.getAttribute('data-group')];
      if (!grp) return;
      // a shot the founder rejected or asked a new photo for stays that way; everything else in the part is approved
      var todo = grp.shots.filter(function (sh) { var d = shotDecision(gk, sh.id); return !d || (d.decision === 'approved' && d.carried); })
        .map(function (sh) { return sh.id; });
      if (!todo.length) return;
      if (S.vbusy) return;
      setBusy('Saving ' + groupName(gk, +t.getAttribute('data-group')) + '…', t);
      // one call for the whole part: every shot is saved, or none is (hs_impact_story_shots_approve)
      var save = rpc('hs_impact_story_shots_approve', { p_story: storyA, p_manifest_id: va.manifest_id, p_expected_hash: va.manifest_hash,
        p_asset: gk, p_shots: todo }).then(null, function (err) {
        if (!err || err.code !== 'PGRST202') throw err;     // the database is older than this page: one shot at a time
        var ch = Promise.resolve();
        todo.forEach(function (sid) {
          ch = ch.then(function () { return rpc('hs_impact_story_shot_decide', { p_story: storyA, p_manifest_id: va.manifest_id, p_expected_hash: va.manifest_hash,
            p_asset: gk, p_shot: sid, p_decision: 'approved', p_note: null }); });
        });
        return ch;
      });
      return act(save.then(function () { S.vbusy = null; return refresh(false); }).then(function () {
        if (S.open !== storyA) return;
        var v2 = S.data.visuals || {}, pr = visProgress(v2.manifest);
        // the last part approved approves the whole set (the server re-checks everything)
        if (v2.state === 'ready' && pr.all && pr.done === pr.all && v2.manifest_id === va.manifest_id) {
          setBusy('Approving the visuals…');
          return rpc('hs_impact_story_visuals_approve', { p_story: storyA, p_manifest_id: v2.manifest_id, p_expected_hash: v2.manifest_hash }).then(function () {
            S.vbusy = null; S.vlast = null;
            S.msg = { text: 'Every part approved, so the visuals are approved. Next: Render the videos.' };
            return refresh(false);
          });
        }
        var g2 = visGroups(v2.manifest, gk)[+t.getAttribute('data-group')];
        // a part holding a shot the founder rejected or asked a new photo for is not approved: never say it is
        var okG = g2 && groupApproved(gk, g2), nx = okG && nextGroup(v2);
        S.vlast = okG ? groupName(gk, +t.getAttribute('data-group')) : null;
        S.msg = { text: okG ? grp.name + ' approved (' + pr.done + ' of ' + pr.all + ' parts).' + (nx ? ' Now showing the next part: ' + groupName(nx.k, nx.gi) + '.' : '')
          : grp.name + ': the other shots are approved, but a shot you rejected or asked a new photo for still needs fixing. Prepare the visuals again.' };
        if (!nx) return renderWorkspace();
        // move straight on to the next part still waiting, so the founder never has to hunt for it
        S.vtab = nx.k; renderWorkspace();
        var el2 = S.el.querySelector('#is-vgroup-' + nx.k + '-' + nx.gi);
        if (el2 && el2.scrollIntoView) el2.scrollIntoView({ block: 'start', behavior: 'smooth' });
      })).then(function (r) { S.vbusy = null; return r; }, function (e) { S.vbusy = null; throw e; });
    }
    if (a === 'vshot' && t.getAttribute('data-d') === 'rejected') {
      // a reject asks in the page, never in a browser pop-up
      S.vask = { kind: 'shot', k: t.getAttribute('data-k'), shot: t.getAttribute('data-shot'), photo: t.getAttribute('data-photo') || null };
      renderWorkspace();
      var ta = S.el.querySelector('#is-vask-note'); if (ta) ta.focus();
      return;
    }
    if (a === 'vshot' && t.getAttribute('data-d') === 'new_photo') {
      S.vask = { kind: 'newphoto', k: t.getAttribute('data-k'), shot: t.getAttribute('data-shot') };
      renderWorkspace();
      var tw = S.el.querySelector('#is-vask-want'); if (tw) tw.focus();
      return;
    }
    if (a === 'vaskno') { S.vask = null; return renderWorkspace(); }
    if (a === 'vaskgo') {
      var q = S.vask, vq = S.data.visuals || {}, storyQ = S.open, box = S.el.querySelector('#is-vask-note');
      if (!q) return;
      if (q.kind === 'newphoto') {
        var wEl = S.el.querySelector('#is-vask-want'), yEl = S.el.querySelector('#is-vask-why');
        q.want = wEl ? wEl.value : ''; q.why = yEl ? yEl.value : '';
        var want = q.want.trim(), why = q.why.trim();
        if (!want) { q.err = 'Say what the new photo should show.'; renderWorkspace(); var w2 = S.el.querySelector('#is-vask-want'); if (w2) w2.focus(); return; }
        setBusy('Saving your request…', t);
        return act(rpc('hs_impact_story_shot_decide', { p_story: storyQ, p_manifest_id: vq.manifest_id, p_expected_hash: vq.manifest_hash,
          p_asset: q.k, p_shot: q.shot, p_decision: 'new_photo', p_note: want + (why ? WHY_SEP + why : '') }).then(function () {
          S.vask = null; S.vbusy = null;
          if (S.open !== storyQ) return;
          S.msg = { text: 'New photo asked for. Prepare the visuals again: the code searches for what you described and puts a licensed photo it finds on this shot. You approve it like any other shot.' };
          return refresh(false);
        })).then(function (r) { S.vbusy = null; return r; }, function (e) { S.vbusy = null; throw e; });
      }
      q.note = box ? box.value : '';
      var noteQ = q.note.trim() || null;
      if (q.kind === 'shot' && !q.photo && !noteQ) { q.err = 'Say what is wrong with this shot.'; renderWorkspace(); var b2 = S.el.querySelector('#is-vask-note'); if (b2) b2.focus(); return; }
      setBusy(q.kind === 'shot' ? 'Saving your rejection…' : 'Rejecting the photos…', t);
      var doQ = q.kind === 'shot'
        ? rpc('hs_impact_story_shot_decide', { p_story: storyQ, p_manifest_id: vq.manifest_id, p_expected_hash: vq.manifest_hash,
            p_asset: q.k, p_shot: q.shot, p_decision: 'rejected', p_note: noteQ })
        : rpc('hs_impact_story_photos_reject', { p_story: storyQ, p_manifest_id: vq.manifest_id, p_photos: q.ids, p_note: noteQ }).then(null, function (err) {
            if (!err || err.code !== 'PGRST202') throw err;   // the database is older than this page: one photo at a time
            var chain = Promise.resolve();
            q.ids.forEach(function (pid) {
              chain = chain.then(function () { return rpc('hs_impact_story_photo_reject', { p_story: storyQ, p_manifest_id: vq.manifest_id, p_photo: pid, p_note: noteQ }); });
            });
            return chain;
          });
      return act(doQ.then(function () {
        S.vask = null; S.vbusy = null;
        if (S.open !== storyQ) return;
        S.msg = { text: q.kind === 'shot' ? 'Shot rejected. Prepare the visuals again to replace it.'
          : (q.ids.length === 1 ? 'Photo rejected.' : q.ids.length + ' photos rejected.') + ' Prepare the visuals again to get new photos for those shots.' };
        return refresh(false);
      }));
    }
    if (a === 'vshot') {
      var vs2 = S.data.visuals || {}, d2 = t.getAttribute('data-d'), story3 = S.open;
      setBusy('Saving…', t);
      return act(rpc('hs_impact_story_shot_decide', { p_story: story3, p_manifest_id: vs2.manifest_id, p_expected_hash: vs2.manifest_hash,
        p_asset: t.getAttribute('data-k'), p_shot: t.getAttribute('data-shot'), p_decision: d2, p_note: null }).then(function () {
        if (S.open !== story3) return;
        S.vbusy = null;
        S.msg = { text: d2 === 'approved' ? 'Shot approved.' : 'New photos asked for. Prepare the visuals again: they are searched and shown under "Other licensed photos".' };
        return refresh(false);
      })).then(function (r) { S.vbusy = null; return r; }, function (e) { S.vbusy = null; throw e; });
    }
    if (a === 'vrejectgroup') {
      var gs = visGroups((S.data.visuals || {}).manifest, S.vtab), rm = rejectedIds(), gi2 = +t.getAttribute('data-group'), ids = [];
      ((gs[gi2] || {}).shots || []).forEach(function (sh) {
        if (sh.photo && sh.photo.id && !rm[sh.photo.id] && ids.indexOf(sh.photo.id) < 0) ids.push(sh.photo.id);
      });
      if (!ids.length) return;
      S.vask = { kind: 'group', k: S.vtab, group: gi2, ids: ids };
      renderWorkspace();
      var tg = S.el.querySelector('#is-vask-note'); if (tg) tg.focus();
      return;
    }
    if (a === 'vrestore') {
      t.disabled = true;
      var story2 = S.open;
      return act(rpc('hs_impact_story_photo_restore', { p_story: story2, p_photo: t.getAttribute('data-photo') }).then(function () {
        if (S.open !== story2) return;
        S.msg = { text: 'Photo restored. Prepare the visuals again to see it in place.' };
        return refresh(false);
      }));
    }
    if (a === 'vupload') {
      t.disabled = true;
      return act(uploadPhoto().then(function (story) {
        if (S.upForm && S.upForm.story === story) S.upForm = null;
        if (S.open !== story) return;         // the founder moved on; the photo is recorded on its own story
        S.msg = { text: 'Photo added. Prepare the visuals again to see it in place.' };
        return refresh(false);
      }, function (err) { t.disabled = false; throw err; }));
    }
    if (a === 'vtab') { S.vtab = t.getAttribute('data-k'); S.vask = null; S.vlast = null; return renderWorkspace(); }
    if (a === 'vnext' || a === 'vgoto') {
      var to = a === 'vnext' ? nextGroup(S.data.visuals) : { k: t.getAttribute('data-k'), gi: +t.getAttribute('data-group') };
      if (!to) return;
      if (S.step !== 'visuals') { S.step = 'visuals'; writeHash(true); }
      S.vtab = to.k; S.vlast = null; renderWorkspace();
      var el = S.el.querySelector('#is-vgroup-' + to.k + '-' + to.gi);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
      return;
    }
    if (a === 'vretry') { S.prevFail = {}; return renderWorkspace(); }
    if (a === 'curupdate') {
      var uk = (t.getAttribute('data-keys') || '').split(',').filter(Boolean);
      if (!uk.length || S.vbusy) return;
      setBusy('Asking Claude to update the story…', t);
      return act(rpc('hs_impact_story_currency_update', { p_story: S.open, p_keys: uk }).then(function () {
        S.vbusy = null;
        S.msg = { text: 'Sent to Claude: it reads the newest record and writes a plan. Confirm the plan under Media review; nothing changes before you do.' };
        return refresh(false);
      })).then(function (r) { S.vbusy = null; return r; }, function (e) { S.vbusy = null; throw e; });
    }
    if (a === 'cdismiss') {
      var ck = (t.getAttribute('data-keys') || '').split(',').filter(Boolean);
      if (!ck.length || S.vbusy) return;
      setBusy('Setting it aside and preparing again…', t);
      var toRender = t.getAttribute('data-then') === 'render';
      return act(rpc('hs_impact_story_currency_dismiss', { p_story: S.open, p_keys: ck }).then(function () {
        return toRender ? rpc('hs_impact_story_render', { p_story: S.open, p_expected_version: S.data.story.current_version, p_new: true })
                        : rpc('hs_impact_story_visuals_prepare', { p_story: S.open, p_expected_version: S.data.story.current_version, p_new: true });
      }).then(function () {
        S.vbusy = null; S.vlast = null;
        S.msg = { text: toRender ? 'Set aside as not about this story. Render queued: about 1 to 3 hours. This page updates on its own.'
                                 : 'Set aside as not about this story. Preparing the visuals again: about 10 to 20 minutes. This page updates on its own.' };
        S.step = toRender ? 'media' : 'visuals'; writeHash(false); return refresh(false);
      })).then(function (r) { S.vbusy = null; return r; }, function (e) { S.vbusy = null; throw e; });
    }
    if (a === 'vprep') {
      setBusy('Starting the previews…', t);
      return act(rpc('hs_impact_story_visuals_prepare', { p_story: S.open, p_expected_version: S.data.story.current_version, p_new: t.getAttribute('data-new') === '1' }).then(function (r) {
        S.vbusy = null; S.vlast = null;
        S.msg = { text: r.existing ? 'Those visuals are already being prepared (' + r.status + ').' : 'Preparing the visuals: one still per shot, about 10 to 20 minutes. This page updates on its own.' };
        S.step = 'visuals'; writeHash(false); return refresh(false);
      })).then(function (r) { S.vbusy = null; return r; }, function (e) { S.vbusy = null; throw e; });
    }
    if (a === 'vapprove') {
      var vv = S.data.visuals || {};
      if (S.vbusy) return;
      setBusy('Approving the visuals…', t);
      return act(rpc('hs_impact_story_visuals_approve', { p_story: S.open, p_manifest_id: vv.manifest_id, p_expected_hash: vv.manifest_hash }).then(function () {
        S.vbusy = null; S.vlast = null;
        S.msg = { text: 'Every visual approved. The render will show exactly these pictures.' };
        S.step = 'visuals'; return refresh(false);
      })).then(function (r) { S.vbusy = null; return r; }, function (e) { S.vbusy = null; throw e; });
    }
    if (a === 'vrevoke') {
      var vn = prompt('Why revoke the visuals approval?');
      if (vn == null) return;
      return act(rpc('hs_impact_story_visuals_revoke', { p_story: S.open, p_manifest_id: (S.data.visuals || {}).manifest_id, p_note: vn || null })
        .then(function () { return refresh(false); }));
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
      if (md === 'revoked') { mnote = prompt('Why revoke this approval?'); if (mnote == null) return; }
      return act(rpc('hs_impact_story_media_decide', { p_story: S.open, p_asset_id: Number(id), p_decision: md, p_note: mnote, p_timecode: tc })
        .then(function () { return refresh(false); }));
    }
    if (a === 'fixform') { S.fixForm[id] = true; renderWorkspace(); var ta = S.el.querySelector('#fx-note-' + id); if (ta) ta.focus(); return; }
    if (a === 'readplan') {
      S.step = 'media'; writeHash(true); renderWorkspace();
      var pl = S.el.querySelector('#is-next-box'); if (pl) { if (pl.closest('details')) pl.closest('details').open = true; pl.scrollIntoView({ block: 'start' }); }
      return;
    }
    if (a === 'fixblocked') {
      // one fix request per blocked video, each filled in with what its checks found (the same text the form starts with)
      var todo = blockedVideos().filter(function (f) { return fixDraft(f); });
      if (!todo.length) { S.msg = { bad: true, text: 'The checks did not say what failed. Open each video and write what to fix.' }; return renderWorkspace(); }
      t.disabled = true;
      return act(todo.reduce(function (p, f) {
        return p.then(function () { return rpc('hs_impact_story_media_decide', { p_story: S.open, p_asset_id: Number(f.id), p_decision: 'rejected', p_note: fixDraft(f).slice(0, 1000), p_timecode: null }); });
      }, Promise.resolve()).then(function () {
        S.msg = { text: 'Saved ' + todo.length + ' fix request' + (todo.length === 1 ? '' : 's') + '. Next: send them to Claude.' }; return refresh(false);
      }));
    }
    if (a === 'fixcancel') { delete S.fixForm[id]; return renderWorkspace(); }
    if (a === 'fixsend') {
      var fnote = (S.el.querySelector('#fx-note-' + id) || {}).value || '', ftc = ((S.el.querySelector('#fx-tc-' + id) || {}).value || '').trim() || null;
      if (!fnote.trim()) { S.msg = { bad: true, text: 'Say what should be fixed.' }; return renderWorkspace(); }
      if (ftc && !/^[0-9]{1,2}:[0-5][0-9](:[0-5][0-9])?$/.test(ftc)) { S.msg = { bad: true, text: 'Use m:ss for the moment, for example 1:05.' }; return renderWorkspace(); }
      t.disabled = true;
      return act(rpc('hs_impact_story_media_decide', { p_story: S.open, p_asset_id: Number(id), p_decision: 'rejected', p_note: fnote.trim(), p_timecode: ftc })
        .then(function () { delete S.fixForm[id]; S.msg = { text: 'Fix request saved. Press Fix when you have listed everything.' }; return refresh(false); }));
    }
    if (a === 'lnform') { var lp = t.getAttribute('data-path'); S.lnForm[lp] = true; renderWorkspace(); var lt = S.el.querySelector('[data-lnt="' + lp + '"]'); if (lt) lt.focus(); return; }
    if (a === 'lncancel') { var lc = t.getAttribute('data-path'); delete S.lnForm[lc]; delete S.lnText[lc]; delete S.lnResearch[lc]; return renderWorkspace(); }
    if (a === 'lnsend') {
      var ls = t.getAttribute('data-path'), lnote = (S.lnText[ls] || '').trim();
      if (!lnote) { S.msg = { bad: true, text: 'Say what should change, or what to look up.' }; return renderWorkspace(); }
      var line = (get(S.data.version && S.data.version.body, ls) || {}).text || '';
      t.disabled = true;
      return act(rpc('hs_impact_story_line_note', { p_story: S.open, p_path: ls, p_line: line, p_note: lnote, p_research: !!S.lnResearch[ls] })
        .then(function () { delete S.lnForm[ls]; delete S.lnText[ls]; delete S.lnResearch[ls];
          S.msg = { text: 'Note saved under the line. Add notes to any other lines, then press Fix at the top of Script & Shorts.' }; return refresh(false); }));
    }
    if (a === 'lnwithdraw') return act(rpc('hs_impact_story_line_note_withdraw', { p_story: S.open, p_note: Number(id) }).then(function () { return refresh(false); }));
    if (a === 'fixconfirm') {
      t.disabled = true;
      return act(rpc('hs_impact_story_fix_confirm', { p_story: S.open, p_batch: id, p_plan_md5: t.getAttribute('data-md5') })
        .then(function () { S.msg = { text: 'Confirmed. Claude is making exactly these changes; this list shows its progress.' }; return refresh(false); }));
    }
    if (a === 'fixplancancel') {
      t.disabled = true;
      return act(rpc('hs_impact_story_fix_cancel', { p_story: S.open, p_batch: id })
        .then(function () { S.msg = { text: 'Plan cancelled. Nothing was changed; rewrite or add fix requests, then press Fix again.' }; return refresh(false); }));
    }
    if (a === 'fixstart') {
      t.disabled = true;
      return act(rpc('hs_impact_story_fix_start', { p_story: S.open }).then(function (r) {
        S.msg = { text: r && r.existing ? 'These fixes are already with the fixer; it was asked to start again if it had not begun.'
                                        : 'Sent. Claude reads your notes and writes its plan (a few minutes); it changes nothing until you confirm.' };
        return refresh(false);
      }));
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
    if (a === 'research') {
      var ask = prompt('What should be researched further (a company, an owner, a decision, a later ruling)? This note is kept on the story; a Claude Code session researches it and rewrites the draft, then you press Analyze again.');
      if (!ask) return;
      return act(rpc('hs_impact_story_section_revision', { p_story: S.open, p_expected_version: S.data.story.current_version, p_section: 'accountability',
        p_note: ('Deeper research: ' + ask).slice(0, 1000) })
        .then(function () { S.msg = { text: 'Research request saved. Ask Claude, in a Claude Code session, to research it and revise the Impact Story; then press Analyze again.' }; return refresh(false); }));
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
      var link = document.createElement('a'); link.href = url; link.download = 'impact-story-' + (d.story.story_number ? d.story.story_number + '-' : '') + d.story.id.slice(0, 8) + '-v' + d.story.current_version + '.json';
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }
  }
  function creatorClick(t) {
    var a = t.getAttribute('data-act'), cs = S.data.creator, ver = S.data.story.current_version;
    if (a === 'cs-compare') { S.csCompare = !S.csCompare; return renderWorkspace(); }
    if (a === 'cs-edit') {
      var base = cs.pending && cs.pending.status === 'proposed' ? cs.pending.script : cs.script;
      S.csEd = CR().newEditor(base); S.csEd.showPaste = false;
      renderWorkspace();
      var sc = t.getAttribute('data-scene'), f = sc && S.el.querySelector('#is-cs-narr-' + (Number(sc) - 1));
      if (f) { f.scrollIntoView && f.scrollIntoView({ block: 'center' }); f.focus(); }
      return;
    }
    if (a === 'cs-cancel-edit') { S.csEd = null; return renderWorkspace(); }
    if (a === 'cs-save-rev') {
      var fin = CR().finished(S.csEd);
      if (fin.problems) { S.msg = { bad: true, text: 'Your script cannot be saved yet: ' + fin.problems.slice(0, 4).join('; ') + '.' }; return renderWorkspace(); }
      var note = (S.el.querySelector('#cs-rev-note') || {}).value || null;
      t.disabled = true;
      return act(rpc('hs_impact_story_creator_revise', { p_story: S.open, p_expected_version: ver, p_script: fin.script, p_note: note }).then(function (r) {
        S.csEd = null;
        S.msg = { text: r.unchanged ? 'That is already your waiting revision.' : 'Revision saved. Your locked script is unchanged until you send it: press Send it with Fix.' };
        return refresh(false);
      }));
    }
    if (a === 'cs-accept' || a === 'cs-keep') {
      var dn = null;
      if (a === 'cs-keep') { dn = prompt('Keep your words. Why? (optional — kept with your decision)', ''); if (dn === null) return; }
      t.disabled = true;
      return act(rpc('hs_impact_story_creator_flag_decide', { p_story: S.open, p_expected_version: ver, p_flag_key: t.getAttribute('data-key'),
        p_decision: a === 'cs-keep' ? 'keep' : 'accept', p_note: dn || null }).then(function () {
        S.msg = { text: a === 'cs-keep' ? 'Kept your words for this version.' : 'Suggestion put into your waiting revision. Your locked script is unchanged until you send it.' };
        return refresh(false);
      }));
    }
    if (a === 'cs-withdraw') {
      if (!confirm('Withdraw your waiting revision? Your locked script stays as it is.')) return;
      return act(rpc('hs_impact_story_creator_revision_withdraw', { p_story: S.open, p_revision: Number(t.getAttribute('data-rev')) }).then(function () { return refresh(false); }));
    }
    if (a === 'cs-send') {
      t.disabled = true;
      return act(rpc('hs_impact_story_fix_start', { p_story: S.open }).then(function (r) {
        S.msg = { text: 'Sent. Claude first shows its plan in Media review (Fix): confirm it, and your revised script is applied word for word and fact-checked again.' };
        return refresh(false);
      }));
    }
  }
  function onInput(ev) {
    var t = ev.target;
    if (S.csEd && CR() && t.closest && t.closest('[data-cs-root="is-cs"]')) {
      var r = CR().onInput(S.csEd, t, t.closest('[data-cs-root]'));
      if (r === 'render' && ev.type === 'change') renderWorkspace();
      return;
    }
    if (/^is-up-/.test(t.id || '')) return syncUpload(t);
    if (t.id === 'is-q') { S.q = t.value; var pos = t.selectionStart; renderLibrary(); var q = S.el.querySelector('#is-q'); q.focus(); q.setSelectionRange(pos, pos); return; }
    if (t.hasAttribute('data-lnt')) { S.lnText[t.getAttribute('data-lnt')] = t.value; return; }
    // the in-page Reject / photo-request box keeps what is typed, so a background redraw (previews, job poll) never
    // erases it (Codex, #2665)
    if (S.vask && t.id === 'is-vask-want') { S.vask.want = t.value; return; }
    if (S.vask && t.id === 'is-vask-why') { S.vask.why = t.value; return; }
    if (S.vask && t.id === 'is-vask-note') { S.vask.note = t.value; return; }
    if (t.hasAttribute('data-av')) { S.av[t.getAttribute('data-av')] = t.value; return; }
    if (t.hasAttribute('data-lnr')) { S.lnResearch[t.getAttribute('data-lnr')] = t.checked; return; }
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
        el.addEventListener('change', function (ev) {
          if (ev.target.hasAttribute('data-lnr') || (ev.target.closest && ev.target.closest('[data-cs-root]'))) return onInput(ev);
          syncUpload(ev.target);
        });
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
      if (h && h.impact) { S.doc = h.doc || 'board'; return openStory(h.impact, h.step, false); }
      return loadLibrary();
    },
    // exposed for tests
    _diffHtml: diffHtml, _setPath: setPath, _state: S
  };
})();
