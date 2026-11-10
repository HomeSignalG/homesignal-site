/* Jody Acquisition Dashboard, tab 20 · Weekly Report (STAGE 1: offline prototype).

   QUALITY-of-LIFE Weekly Report, one workspace per Local News topic. The topic list is window.HS.universalTopics
   (topics.js, the same strings Local News uses; alert_topic_catalog stream 'news'), so the two can never name a topic
   differently. One generic workspace serves every topic: nothing here is written for one topic.

   STAGE 1 IS NOT CONNECTED. It calls no database function, starts no job, fetches nothing from the network:
   - "Real" work (imported discovery files and your decisions) is kept in THIS BROWSER only (localStorage) and can be
     downloaded. Research, knowledge, report history and lessons are shown as empty sections until Stage 2 stores them.
   - "Demo data" is an example, labelled on every screen, held in memory only and never written to the real store, so a
     demo approval can never reach a real report.
   - Approvals are tied to a hash of what was approved: editing the script, changing the selected pictures, their rights
     evidence or which picture goes with which segment makes the affected approval stale.
   - Render is disabled. It needs both approvals current, every picture in the report rights-cleared, the Remotion
     licence question resolved, and the render job (Stage 3), which does not exist yet.
   Picture rights come from the discovery output. Only a candidate whose rights are 'available' (and whose class is
   A, B or C) can be selected; a publisher's lead image is never embedded, only linked. Every value is escaped. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});

  var SERIES = 'QUALITY-of-LIFE Weekly Report';
  var THUMB_WORD = { 'Air Quality': 'Air', 'Water Quality': 'Water' };   // founder's short titles; others use their name
  var FIRST_TOPIC = 'Data Centers';
  var STORE_KEY = 'hs-weekly-report-stage1';
  var SECTIONS = [['overview', 'Overview / knowledge'], ['research', 'Research'], ['visuals', 'Visual library'],
    ['new', 'New weekly report'], ['reports', 'Previous reports'], ['lessons', 'Lessons and corrections']];
  var CLASS_NAME = { A: 'A · exact-name match', B: 'B · related', C: 'C · background', D: 'D · excluded' };
  var RIGHTS_NAME = { available: 'Rights cleared (licence check passed)', needs_confirmation: 'Rights unresolved: licence to confirm',
    terms_not_reviewed: 'Rights unresolved: terms not reviewed', needs_permission: 'Rights unresolved: permission needed',
    blocked: 'Blocked by its licence' };
  var STAGE2 = 'Not connected until Stage 2: nothing here is stored outside this browser yet.';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function dataImg(u) { return /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(String(u || '')) ? String(u) : ''; }
  function thumbnailTitle(topic) { return SERIES + ' : ' + (THUMB_WORD[topic] || topic); }
  // A stable fingerprint of a JSON value (key order fixed), for approval validity. Not a security hash.
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function fp(v) {
    var s = canon(v), h1 = 0x811c9dc5, h2 = 5381;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + c) >>> 0; }
    return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
  }

  // ------------------------------------------------------------------ the two stores (real is persisted; demo never is)
  function emptyTopic() {
    return { knowledge: [], research: [], questions: [], reports: [], lessons: [], imports: [], candidates: [], draft: null };
  }
  function loadReal() {
    try { var v = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null'); if (v && v.schema === 'stage1') return v; } catch (e) { /* none */ }
    return { schema: 'stage1', topics: {} };
  }
  function saveReal() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(S.real)); return true; } catch (e) { S.saveError = 'This browser would not save: ' + e.message; return false; }
  }
  function store() { return S.mode === 'demo' ? S.demo : S.real; }
  function topicData(t) { var st = store(); if (!st.topics[t]) st.topics[t] = emptyTopic(); return st.topics[t]; }
  function persist() { if (S.mode === 'real') saveReal(); }

  // ------------------------------------------------------------------ demo data (an example, never real discovery output)
  function demoStore() {
    var t = emptyTopic();
    t.knowledge = [
      { id: 'k1', status: 'verified', statement: 'DEMO: A county board approved a rezoning for a data center campus.', as_of: '2026-10-20',
        scope: 'Example County, ST', sources: [{ title: 'DEMO county board minutes', date: '2026-10-14', url: '' }] },
      { id: 'k2', status: 'disputed', statement: 'DEMO: The campus will use 2 million gallons of water a day.', as_of: '2026-10-22',
        scope: 'Example County, ST', note: 'The application states a lower figure; both are kept.', sources: [{ title: 'DEMO news report', date: '2026-10-22', url: '' }] },
      { id: 'k3', status: 'superseded', statement: 'DEMO: A public hearing is set for Oct 1.', as_of: '2026-09-15', superseded_by: 'k1',
        scope: 'Example County, ST', sources: [{ title: 'DEMO hearing notice', date: '2026-09-10', url: '' }] }];
    t.research = [{ id: 'r1', title: 'DEMO water-use application', kind: 'official record', published: '2026-10-15', retrieved: '2026-10-28',
      scope: 'Example County, ST', provenance: 'DEMO: fetched by a research job', linked_topics: ['Water Quality'] }];
    t.questions = [{ id: 'q1', text: 'DEMO: Which aquifer would supply the campus?', status: 'open' }];
    t.reports = [{ id: 'p1', title: thumbnailTitle(FIRST_TOPIC), period: '2026-10-26 to 2026-11-01', status: 'completed (demo)', stories: 2 }];
    t.lessons = [{ id: 'l1', status: 'approved', text: 'DEMO: Say "proposed", never "planned", until a permit is issued.', from: 'your correction on report p1' },
      { id: 'l2', status: 'proposed', text: 'DEMO: Lead with the water figure only when the record states it.', from: 'a rejected script line' }];
    var c = function (o) { return Object.assign({ demo: true, story: 's1', need: 'site', source: 'DEMO source', page_url: '', class: 'B', review: [],
      rights_evidence: 'DEMO rights evidence', original_w: 4000, original_h: 2250, credit: 'DEMO credit' }, o); };
    t.candidates = [
      c({ id: 'dm1', title: 'DEMO farmland near the proposed site', rights: 'available', caption: 'Fields along a county road (demo).' }),
      c({ id: 'dm2', title: 'DEMO town main street', need: 'place', rights: 'available', caption: 'Downtown (demo).' }),
      c({ id: 'dm3', title: 'DEMO news photo of the site', rights: 'terms_not_reviewed', lead_image: true, caption: 'A publisher\'s lead image (demo).' }),
      c({ id: 'dm4', title: 'DEMO water tower', story: 's2', need: 'water', rights: 'needs_confirmation', class: 'C', review: ['location not stated by the source'] }),
      c({ id: 'dm5', title: 'DEMO river at low water', story: 's2', need: 'water', rights: 'available', class: 'C' })];
    t.stories = [{ id: 's1', title: 'DEMO: County approves data center rezoning', place: 'Example County, ST' },
      { id: 's2', title: 'DEMO: Water questions for the campus', place: 'Example County, ST' }];
    t.reuse = [{ finding: 'k1', decision: 'reuse', why: 'verified, inside its refresh date, same area' },
      { finding: 'k2', decision: 'refresh', why: 'disputed figure; re-check the application' },
      { finding: 'q1', decision: 'new research', why: 'open question with no finding' }];
    var topics = {}; topics[FIRST_TOPIC] = t;
    return { schema: 'stage1-demo', topics: topics };
  }

  // ------------------------------------------------------------------ importing a discovery run (weekly-candidates/0.2)
  function importCandidates(json, sheets) {
    if (!json || json.schema !== 'weekly-candidates/0.2' || !Array.isArray(json.stories))
      throw new Error('This is not a discovery output file (expected schema weekly-candidates/0.2).');
    var thumbs = {};
    (sheets || []).forEach(function (html) {
      var re = /<div class="card" data-id="([0-9a-f]{6,40})"[^>]*>\s*<div class="thumb"><img src="(data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)"/g, m;
      while ((m = re.exec(html))) thumbs[m[1]] = m[2];
    });
    var t = topicData(S.topic), run = String(json.run || 'unknown'), added = 0, stories = t.stories || (t.stories = []);
    t.candidates = t.candidates.filter(function (x) { return x.run !== run; });
    json.stories.forEach(function (st) {
      var sid = run + ':' + st.story;
      stories = stories.filter(function (x) { return x.id !== sid; });
      stories.push({ id: sid, title: st.title || st.story, place: '', run: run });
      (st.needs || []).forEach(function (n) {
        (n.shown || []).forEach(function (r) {
          t.candidates.push({ id: run + ':' + r.id, run: run, story: sid, need: n.id, need_text: n.need, title: r.title, caption: r.description,
            source: r.source, page_url: r.page_url, class: r.class, review: r.review || [], rights: r.rights, rights_evidence: r.rights_evidence,
            credit: r.credit, original_w: r.original_w, original_h: r.original_h, thumb: dataImg(thumbs[r.id]) || '' });
          added++;
        });
      });
      (st.story_pages || []).forEach(function (p) {
        var r = p.lead_image; if (!r) return;
        t.candidates.push({ id: run + ':' + (r.id || p.page), run: run, story: sid, need: 'story page', title: r.title, caption: r.figure_caption || r.image_alt,
          source: r.site_name || r.source, page_url: p.page, class: r.class, review: r.review || [], rights: r.rights, rights_evidence: r.rights_evidence,
          credit: r.credit, lead_image: true, original_w: r.original_w, original_h: r.original_h, thumb: '' });
        added++;
      });
    });
    t.stories = stories;
    t.imports = (t.imports || []).filter(function (x) { return x.run !== run; }).concat([{ run: run, at: new Date().toISOString(), stories: json.stories.length,
      candidates: added, thumbnails: Object.keys(thumbs).length, missing: json.stories.reduce(function (a, st) {
        return a.concat((st.needs || []).filter(function (n) { return n.not_found; }).map(function (n) { return { story: st.title || st.story, need: n.need, note: n.not_found }; }));
      }, []), errors: json.stories.reduce(function (a, st) { return a.concat(st.errors || []); }, []) }]);
    persist();
    return added;
  }

  // ------------------------------------------------------------------ approvals and gates
  function selectable(c) { return c.rights === 'available' && /^[ABC]$/.test(c.class || '') && !c.lead_image; }
  function pictureState(d) {
    var t = topicData(S.topic);
    return (d.stories || []).map(function (sid) {
      var sel = (d.picks[sid] || []).map(function (id) { var c = cand(t, id); return c ? { id: id, rights: c.rights, evidence: c.rights_evidence } : { id: id, missing: true }; });
      return { story: sid, selected: sel, assign: (d.segments[sid] || []).map(function (g) { return g.visual || null; }) };
    });
  }
  function scriptState(d) {
    return (d.stories || []).map(function (sid) { return { story: sid, segments: (d.segments[sid] || []).map(function (g) { return [g.text, g.visual || null]; }) }; });
  }
  function approval(d, kind) {
    var a = d.approvals[kind]; var now = fp(kind === 'pictures' ? pictureState(d) : scriptState(d));
    return !a ? { state: 'not approved', current: false } : a.hash === now ? { state: 'approved', current: true, at: a.at } :
      { state: 'changed after approval: approve again', current: false, at: a.at };
  }
  function gates(d) {
    var t = topicData(S.topic), used = [];
    (d.stories || []).forEach(function (sid) { (d.segments[sid] || []).forEach(function (g) { if (g.visual) used.push(cand(t, g.visual)); }); });
    var uncleared = used.filter(function (c) { return !c || c.rights !== 'available'; });
    return [
      ['Picture approval is current', approval(d, 'pictures').current],
      ['Script approval is current', approval(d, 'script').current],
      ['Every picture in the script is rights-cleared', used.length > 0 && !uncleared.length],
      ['Remotion licence for the pinned 4.0.250 resolved', false, 'Unresolved: do contractors count toward "up to 3 employees"?'],
      ['Render job connected', false, 'Not built yet (Stage 3: one job, 60-minute limit).'],
      ['Real report (not demo data)', S.mode === 'real', S.mode === 'demo' ? 'Demo data can never be rendered.' : ''] ];
  }
  function cand(t, id) { for (var i = 0; i < t.candidates.length; i++) if (t.candidates[i].id === id) return t.candidates[i]; return null; }

  // ------------------------------------------------------------------ rendering
  var S = null;
  function banner() {
    return S.mode === 'demo' ? '<div class="wr-demo" role="status"><b>DEMO DATA — an example, not real discovery output.</b> Held in memory only; ' +
      'nothing here is saved, and demo approvals never reach a real report. <button type="button" class="wr-act" data-act="real">Back to the real workspace</button></div>' : '';
  }
  function topicNav() {
    return '<nav class="wr-topics" aria-label="Weekly Report topics">' + S.topics.map(function (t) {
      return '<button type="button" class="wr-topic' + (t === S.topic ? ' on' : '') + '" data-topic="' + esc(t) + '"' + (t === S.topic ? ' aria-current="true"' : '') + '>' + esc(t) + '</button>';
    }).join('') + '</nav>';
  }
  function sectionNav() {
    return '<nav class="wr-sections">' + SECTIONS.map(function (s) {
      return '<button type="button" class="wr-sec' + (s[0] === S.section ? ' on' : '') + '" data-sec="' + s[0] + '">' + esc(s[1]) + '</button>';
    }).join('') + '</nav>';
  }
  function emptyNote(what) { return '<p class="wr-empty">' + esc(what) + '</p>'; }
  function list(items, fn, empty) { return items && items.length ? '<ul class="wr-list">' + items.map(fn).join('') + '</ul>' : emptyNote(empty); }

  function viewOverview(t) {
    return '<div class="card"><h3>' + esc(S.topic) + '</h3><p class="sub">Thumbnail title for this topic: <b class="wr-thumbtitle">' + esc(thumbnailTitle(S.topic)) + '</b></p>' +
      '<p class="wr-stage">Sourced topic knowledge, open questions and the learning loop are ' + esc(STAGE2) +
      ' This prototype does not learn from finished videos.</p><h4>Sourced knowledge</h4>' +
      list(t.knowledge, function (k) {
        return '<li><span class="wr-st wr-st-' + esc(k.status) + '">' + esc(k.status) + '</span> ' + esc(k.statement) + ' <span class="sub">as of ' + esc(k.as_of) +
          ' · ' + esc(k.scope) + (k.note ? ' · ' + esc(k.note) : '') + (k.superseded_by ? ' · superseded by ' + esc(k.superseded_by) : '') + '</span><br><span class="sub">Sources: ' +
          esc((k.sources || []).map(function (s) { return s.title + ' (' + s.date + ')'; }).join('; ')) + '</span></li>';
      }, 'No sourced knowledge for this topic yet.') +
      '<h4>Open questions and research gaps</h4>' + list(t.questions, function (q) { return '<li>' + esc(q.text) + ' <span class="sub">' + esc(q.status) + '</span></li>'; },
        'No open questions recorded yet.') + '</div>';
  }
  function viewResearch(t) {
    return '<div class="card"><h3>Research and source library</h3><p class="wr-stage">Research jobs are not connected (Stage 3); the source library is ' + esc(STAGE2) +
      ' Each source will keep its publication date, retrieval date, geographic scope and provenance, and can be linked to other topics without changing its home topic.</p>' +
      list(t.research, function (r) {
        return '<li><b>' + esc(r.title) + '</b> <span class="sub">' + esc(r.kind) + ' · published ' + esc(r.published) + ' · retrieved ' + esc(r.retrieved) + ' · ' + esc(r.scope) +
          ' · ' + esc(r.provenance) + (r.linked_topics && r.linked_topics.length ? ' · also linked to: ' + esc(r.linked_topics.join(', ')) : '') + '</span></li>';
      }, 'No sources in this topic\'s library yet.') + '</div>';
  }
  function candCard(c, sel, controls) {
    var img = c.thumb ? '<img class="wr-thumb" src="' + esc(dataImg(c.thumb)) + '" alt="">' : c.lead_image ?
      '<div class="wr-thumb wr-nothumb">Image not embedded: rights unresolved.' + (safeUrl(c.page_url) ? '<br><a href="' + esc(safeUrl(c.page_url)) + '" target="_blank" rel="noopener">View it on the article page</a>' : '') + '</div>' :
      '<div class="wr-thumb wr-nothumb">' + (c.demo ? 'Demo picture (no image)' : 'No thumbnail in the loaded files') + '</div>';
    var rid = c.rights === 'available' ? 'ok' : c.rights === 'blocked' ? 'bad' : 'warn';
    return '<div class="wr-card" data-cand="' + esc(c.id) + '">' + img + '<div class="wr-cbody"><b>' + esc(c.title) + '</b>' + (c.demo ? ' <span class="wr-demotag">DEMO</span>' : '') +
      '<div class="sub">' + esc(CLASS_NAME[c.class] || c.class || '') + (c.review && c.review.length ? ' · <span class="wr-unc">uncertain: ' + esc(c.review.join('; ')) + '</span>' : '') + '</div>' +
      (c.caption ? '<div class="sub">Caption: ' + esc(c.caption) + '</div>' : '') +
      '<div class="sub">Source: ' + esc(c.source || '') + (safeUrl(c.page_url) ? ' · <a href="' + esc(safeUrl(c.page_url)) + '" target="_blank" rel="noopener">source page</a>' : '') + '</div>' +
      '<div class="sub">Original size: ' + esc(c.original_w && c.original_h ? c.original_w + '×' + c.original_h : 'not stated') + '</div>' +
      '<div class="wr-rights wr-r-' + rid + '">' + esc(RIGHTS_NAME[c.rights] || c.rights || 'Rights not stated') + '</div><div class="sub">' + esc(c.rights_evidence || '') + '</div>' +
      (controls || '') + '</div></div>';
  }
  function viewVisuals(t) {
    var imp = (t.imports || []).map(function (i) {
      return '<li>Run ' + esc(i.run) + ': ' + i.stories + ' stories, ' + i.candidates + ' candidates, ' + i.thumbnails + ' thumbnails' +
        (i.missing.length ? '<ul>' + i.missing.map(function (m) { return '<li class="wr-missing"><b>Missing:</b> ' + esc(m.story) + ' · ' + esc(m.need) + ' — ' + esc(m.note) + '</li>'; }).join('') + '</ul>' : '') +
        (i.errors.length ? '<ul>' + i.errors.map(function (e) { return '<li class="wr-failed"><b>Failed search:</b> ' + esc(e) + '</li>'; }).join('') + '</ul>' : '') + '</li>';
    }).join('');
    return '<div class="card"><h3>Visual library</h3><p class="wr-stage">Pictures come from a discovery run you load below (files stay on this computer). ' + esc(STAGE2) + '</p>' +
      (S.mode === 'real' ? '<p><label>Load a discovery run: <input type="file" id="wr-import" accept=".json,.html,application/json,text/html" multiple></label> ' +
        '<span class="sub">candidates.json, plus the contact sheets for thumbnails</span></p>' : '') +
      (S.importMsg ? '<p class="wr-msg" role="status">' + esc(S.importMsg) + '</p>' : '') + (imp ? '<ul class="wr-list">' + imp + '</ul>' : '') +
      (t.candidates.length ? '<div class="wr-grid">' + t.candidates.map(function (c) { return candCard(c); }).join('') + '</div>' : emptyNote('No pictures in this topic\'s library yet.')) + '</div>';
  }
  function viewReports(t) {
    return '<div class="card"><h3>Previous reports</h3><p class="wr-stage">Completed-report history is ' + esc(STAGE2) + '</p>' +
      list(t.reports, function (r) { return '<li><b>' + esc(r.title) + '</b> <span class="sub">' + esc(r.period) + ' · ' + esc(r.status) + ' · ' + r.stories + ' stories</span></li>'; },
        'No reports yet for this topic.') + '</div>';
  }
  function viewLessons(t) {
    return '<div class="card"><h3>Lessons and corrections</h3><p class="wr-stage">The review step that proposes lessons after each report is ' + esc(STAGE2) +
      ' A proposed lesson is used only after you approve it; nothing generated is promoted on its own.</p>' +
      list(t.lessons, function (l) { return '<li><span class="wr-st wr-st-' + esc(l.status) + '">' + esc(l.status) + '</span> ' + esc(l.text) + ' <span class="sub">from ' + esc(l.from) + '</span></li>'; },
        'No lessons or corrections recorded yet.') + '</div>';
  }
  function newDraft(t) {
    return { id: 'draft-' + Date.now(), topic: S.topic, series: SERIES, title: thumbnailTitle(S.topic), from: '', to: '', area: '',
      stories: [], picks: {}, rejects: {}, segments: {}, approvals: { pictures: null, script: null }, demo: S.mode === 'demo' };
  }
  function viewNew(t) {
    var d = t.draft;
    if (!d) return '<div class="card"><h3>New weekly report</h3><p class="sub">Title: <b class="wr-thumbtitle">' + esc(thumbnailTitle(S.topic)) + '</b></p>' +
      '<p><button type="button" class="wr-act wr-primary" data-act="draft">Start a new report</button></p></div>';
    var stories = t.stories || [];
    var setup = '<div class="card"><h3>1 · Report setup</h3><p class="sub">Series: <b>' + esc(SERIES) + '</b> · Title: <b class="wr-thumbtitle">' + esc(d.title) + '</b></p>' +
      '<p><label>From <input type="date" data-field="from" value="' + esc(d.from) + '"></label> <label>To <input type="date" data-field="to" value="' + esc(d.to) + '"></label> ' +
      '<label>Area <input data-field="area" maxlength="120" placeholder="county, state or ZIP" value="' + esc(d.area) + '"></label></p><h4>Stories in this report</h4>' +
      (stories.length ? '<ul class="wr-list">' + stories.map(function (s) {
        return '<li><label><input type="checkbox" class="wr-story" data-story="' + esc(s.id) + '"' + (d.stories.indexOf(s.id) >= 0 ? ' checked' : '') + '> ' + esc(s.title) + '</label></li>';
      }).join('') + '</ul>' : emptyNote('No stories yet: load a discovery run in the Visual library.')) + '</div>';
    var reuse = '<div class="card"><h3>2 · Research reuse</h3><p class="wr-stage">Deciding reuse / refresh / new research is the database\'s job from Stage 2.</p>' +
      list(t.reuse, function (r) { return '<li><b>' + esc(r.decision) + '</b> · ' + esc(r.finding) + ' <span class="sub">' + esc(r.why) + '</span></li>'; },
        'Nothing to reuse yet: this topic has no stored research.') + '</div>';
    var pics = '<div class="card"><h3>3 · Pictures</h3><p class="sub">Select or reject pictures per story. Only rights-cleared pictures can be selected. ' +
      'An exact-site photo is not required.</p>' + d.stories.map(function (sid) {
        var s = stories.filter(function (x) { return x.id === sid; })[0] || { title: sid };
        var cs = t.candidates.filter(function (c) { return c.story === sid; });
        return '<h4>' + esc(s.title) + '</h4>' + (cs.length ? '<div class="wr-grid">' + cs.map(function (c) {
          var picked = (d.picks[sid] || []).indexOf(c.id) >= 0, rej = (d.rejects[sid] || []).indexOf(c.id) >= 0;
          var ctl = '<div class="wr-ctl"><button type="button" class="wr-act" data-act="pick" data-story="' + esc(sid) + '" data-cand="' + esc(c.id) + '"' + (selectable(c) ? '' : ' disabled') +
            ' title="' + (selectable(c) ? '' : 'Rights unresolved or excluded: cannot be selected') + '">' + (picked ? 'Selected ✓' : 'Select') + '</button> ' +
            '<button type="button" class="wr-act" data-act="reject" data-story="' + esc(sid) + '" data-cand="' + esc(c.id) + '">' + (rej ? 'Rejected ✕' : 'Reject') + '</button></div>';
          return candCard(c, picked, ctl);
        }).join('') + '</div>' : emptyNote('No pictures found for this story. A map, document or sourced graphic can carry it.'));
      }).join('') + approvalRow(d, 'pictures') + '</div>';
    var script = '<div class="card"><h3>4 · Script</h3><p class="sub">The talk-along script by story. Each segment names the picture shown with it.</p>' +
      d.stories.map(function (sid) {
        var s = stories.filter(function (x) { return x.id === sid; })[0] || { title: sid };
        var picked = (d.picks[sid] || []).map(function (id) { return cand(t, id); }).filter(Boolean);
        return '<h4>' + esc(s.title) + '</h4>' + (d.segments[sid] || []).map(function (g, i) {
          return '<div class="wr-seg"><textarea data-seg="' + esc(sid) + '|' + i + '" rows="3" maxlength="2000" aria-label="Segment ' + (i + 1) + '">' + esc(g.text) + '</textarea>' +
            '<label>Picture <select data-vis="' + esc(sid) + '|' + i + '"><option value="">none (map, document or graphic)</option>' + picked.map(function (c) {
              return '<option value="' + esc(c.id) + '"' + (g.visual === c.id ? ' selected' : '') + '>' + esc(c.title) + '</option>'; }).join('') + '</select></label></div>';
        }).join('') + '<button type="button" class="wr-act" data-act="seg" data-story="' + esc(sid) + '">Add segment</button>';
      }).join('') + approvalRow(d, 'script') + '</div>';
    var g = gates(d);
    var render = '<div class="card"><h3>5 · Preview and render</h3><ul class="wr-gates">' + g.map(function (x) {
      return '<li class="' + (x[1] ? 'ok' : 'no') + '">' + (x[1] ? '✓ ' : '✕ ') + esc(x[0]) + (x[2] ? ' <span class="sub">' + esc(x[2]) + '</span>' : '') + '</li>'; }).join('') +
      '</ul><p><button type="button" id="wr-render" disabled>Render (disabled)</button> <span class="sub">Rendering stays off in Stage 1.</span></p>' +
      '<div class="wr-prog"><b>Progress</b><p class="sub">No render job. Progress, errors, metrics and the preview appear here once the render job exists (Stage 3); each step will be saved as it finishes.</p></div>' +
      '<p><button type="button" class="wr-act" data-act="download">Download decisions</button>' + (S.mode === 'real' ? ' <span class="sub">Saved in this browser only.</span>' : '') +
      ' <button type="button" class="wr-act" data-act="discard">Discard this report</button></p></div>';
    return setup + reuse + pics + script + render;
  }
  function approvalRow(d, kind) {
    var a = approval(d, kind);
    return '<p class="wr-appr wr-appr-' + (a.current ? 'ok' : a.at ? 'stale' : 'none') + '" data-appr="' + kind + '"><b>' + (kind === 'pictures' ? 'Picture' : 'Script') +
      ' approval:</b> ' + esc(a.state) + (a.at ? ' <span class="sub">(' + esc(a.at.slice(0, 16).replace('T', ' ')) + ')</span>' : '') +
      ' <button type="button" class="wr-act" data-act="approve" data-kind="' + kind + '"' + (a.current ? ' disabled' : '') + '>Approve ' + (kind === 'pictures' ? 'pictures' : 'script') + '</button></p>';
  }

  function render() {
    var t = topicData(S.topic);
    var body = { overview: viewOverview, research: viewResearch, visuals: viewVisuals, new: viewNew, reports: viewReports, lessons: viewLessons }[S.section](t);
    S.el.innerHTML = '<div class="wr-root">' + banner() +
      '<div class="card wr-head"><h3>20 · Weekly Report <span class="sub">' + esc(SERIES) + '</span></h3><p class="wr-stage">Stage 1 prototype. ' + esc(STAGE2) +
      ' No discovery, narration or rendering runs from here.</p>' + (S.mode === 'real' ? '<p><button type="button" class="wr-act" data-act="demo">Load demo data</button> ' +
      '<span class="sub">An example report, clearly labelled, kept apart from your real work.</span></p>' : '') + (S.saveError ? '<p class="wr-failed">' + esc(S.saveError) + '</p>' : '') + '</div>' +
      (S.topicsError ? '<p class="wr-failed">' + esc(S.topicsError) + '</p>' : topicNav() + sectionNav() + body) + '</div>';
  }

  // ------------------------------------------------------------------ events
  function onClick(e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    var t = topicData(S.topic), d = t.draft;
    if (b.dataset.topic) { S.topic = b.dataset.topic; S.importMsg = ''; return render(); }
    if (b.dataset.sec) { S.section = b.dataset.sec; return render(); }
    var act = b.dataset.act;
    if (act === 'demo') { S.mode = 'demo'; S.demo = demoStore(); S.topic = FIRST_TOPIC; S.section = 'overview'; return render(); }
    if (act === 'real') { S.mode = 'real'; S.demo = null; return render(); }
    if (act === 'draft') { t.draft = newDraft(t); persist(); return render(); }
    if (!d) return;
    if (act === 'pick' || act === 'reject') {
      var sid = b.dataset.story, id = b.dataset.cand, mine = act === 'pick' ? 'picks' : 'rejects', other = act === 'pick' ? 'rejects' : 'picks';
      if (act === 'pick' && !selectable(cand(t, id) || {})) return;
      var arr = d[mine][sid] || (d[mine][sid] = []), i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1); else { arr.push(id); d[other][sid] = (d[other][sid] || []).filter(function (x) { return x !== id; }); }
      (d.segments[sid] || []).forEach(function (g) { if (g.visual && (d.picks[sid] || []).indexOf(g.visual) < 0) g.visual = null; });
    } else if (act === 'seg') { (d.segments[b.dataset.story] || (d.segments[b.dataset.story] = [])).push({ text: '', visual: null }); }
    else if (act === 'approve') {
      var k = b.dataset.kind; d.approvals[k] = { hash: fp(k === 'pictures' ? pictureState(d) : scriptState(d)), at: new Date().toISOString() };
    } else if (act === 'discard') { t.draft = null; }
    else if (act === 'download') { download(d); return; }
    persist(); render();
  }
  function onInput(e) {
    var t = topicData(S.topic), d = t.draft, el = e.target; if (!d) return;
    if (el.dataset.field) { d[el.dataset.field] = el.value; persist(); return; }
    if (el.dataset.seg) { var p = el.dataset.seg.split('|'); d.segments[p[0]][+p[1]].text = el.value; persist(); refreshApprovals(); return; }
  }
  function onChange(e) {
    var t = topicData(S.topic), d = t.draft, el = e.target;
    if (el.id === 'wr-import') return readFiles(el.files);
    if (!d) return;
    if (el.classList.contains('wr-story')) {
      var sid = el.dataset.story; d.stories = d.stories.filter(function (x) { return x !== sid; }); if (el.checked) d.stories.push(sid);
      if (!d.segments[sid]) d.segments[sid] = [{ text: '', visual: null }];
      persist(); return render();
    }
    if (el.dataset.vis) { var p = el.dataset.vis.split('|'); d.segments[p[0]][+p[1]].visual = el.value || null; persist(); return render(); }
  }
  function refreshApprovals() {   // keep the textarea focused: update only the approval lines and gates
    var d = topicData(S.topic).draft;
    ['pictures', 'script'].forEach(function (k) { var n = S.el.querySelector('[data-appr="' + k + '"]'); if (n) n.outerHTML = approvalRow(d, k); });
    var gl = S.el.querySelector('.wr-gates'); if (gl) gl.innerHTML = gates(d).map(function (x) {
      return '<li class="' + (x[1] ? 'ok' : 'no') + '">' + (x[1] ? '✓ ' : '✕ ') + esc(x[0]) + (x[2] ? ' <span class="sub">' + esc(x[2]) + '</span>' : '') + '</li>'; }).join('');
  }
  function readFiles(files) {
    var arr = Array.prototype.slice.call(files || []);
    Promise.all(arr.map(function (f) { return f.text().then(function (s) { return { name: f.name, text: s }; }); })).then(function (got) {
      var json = got.filter(function (g) { return /\.json$/i.test(g.name); })[0];
      try {
        if (!json) throw new Error('Choose the run\'s candidates.json (the contact sheets alone carry no rights evidence).');
        var n = importCandidates(JSON.parse(json.text), got.filter(function (g) { return /\.html?$/i.test(g.name); }).map(function (g) { return g.text; }));
        S.importMsg = 'Loaded ' + n + ' candidates from ' + json.name + '.';
      } catch (err) { S.importMsg = 'Not loaded: ' + err.message; }
      render();
    });
  }
  function download(d) {
    var out = { schema: 'weekly-report-stage1/0.1', demo: S.mode === 'demo', report: d, note: S.mode === 'demo' ? 'DEMO DATA: not a real report' : 'Stage 1: saved in one browser only' };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = (S.mode === 'demo' ? 'DEMO-' : '') + 'weekly-report-' + d.id + '.json'; a.click(); URL.revokeObjectURL(u);
  }

  function css() {
    if (document.getElementById('wr-css')) return;
    var st = document.createElement('style'); st.id = 'wr-css';
    st.textContent = '.wr-root{max-width:1200px}.wr-topics,.wr-sections{display:flex;flex-wrap:wrap;gap:4px;margin:10px 0}' +
      '.wr-topic,.wr-sec,.wr-act,#wr-render{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12.5px;color:var(--ink)}' +
      '.wr-topic.on,.wr-sec.on,.wr-primary{background:var(--accent);color:#fff;border-color:var(--accent)}.wr-act[disabled],#wr-render[disabled]{opacity:.5;cursor:not-allowed}' +
      '.wr-demo{background:#fff4d6;border:2px solid #c47a1a;border-radius:10px;padding:10px 14px;margin:10px 0}.wr-demotag{background:#c47a1a;color:#fff;border-radius:4px;padding:0 5px;font-size:11px}' +
      '.wr-stage{background:var(--panel2);border-left:3px solid var(--pending);padding:6px 10px;font-size:12.5px;color:var(--muted)}' +
      '.wr-empty{color:var(--muted);font-style:italic}.wr-list{padding-left:18px}.wr-list li{margin:4px 0}' +
      '.wr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}.wr-card{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--panel)}' +
      '.wr-thumb{display:block;width:100%;max-height:200px;object-fit:cover;background:var(--panel2)}.wr-nothumb{padding:30px 8px;text-align:center;color:var(--muted);font-size:12.5px}' +
      '.wr-cbody{padding:8px 10px}.wr-rights{font-weight:600;font-size:12.5px;margin-top:4px}.wr-r-ok{color:#157a49}.wr-r-warn{color:#a35d00}.wr-r-bad{color:#8a2b24}.wr-unc{color:#a35d00}' +
      '.wr-st{font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 5px;text-transform:uppercase}.wr-ctl{margin-top:6px}' +
      '.wr-seg{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.wr-seg textarea{flex:1 1 320px;min-width:0;font:inherit}.wr-seg select{max-width:100%}' +
      '.wr-gates{list-style:none;padding:0}.wr-gates .ok{color:#157a49}.wr-gates .no{color:#8a2b24}.wr-appr-stale{color:#a35d00}.wr-missing,.wr-failed{color:#8a2b24}' +
      '.wr-prog{border:1px dashed var(--line);border-radius:8px;padding:8px 10px}.wr-msg{font-weight:600}' +
      '@media (max-width:640px){.wr-grid{grid-template-columns:1fr}}';
    document.head.appendChild(st);
  }

  function load(client, el) {
    if (!el) return;
    css();
    var topics = Array.isArray(HS.universalTopics) ? HS.universalTopics.slice() : [];
    if (!S || S.el !== el) {
      S = { el: el, mode: 'real', real: loadReal(), demo: null, topics: topics, topic: topics.indexOf(FIRST_TOPIC) >= 0 ? FIRST_TOPIC : topics[0], section: 'overview', importMsg: '' };
      S.topicsError = topics.length ? '' : 'The topic list (topics.js) did not load, so the workspaces cannot be shown.';
      el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('change', onChange);
    }
    render();
  }

  HS.acqWeeklyReport = { load: load, thumbnailTitle: thumbnailTitle, SERIES: SERIES, _fp: fp, _importCandidates: function (j, s) { return importCandidates(j, s); } };
})();
