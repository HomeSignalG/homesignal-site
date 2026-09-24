// HomeSignal map helpers — the ONE map backbone shared by every map surface:
// maps.html, dashboard.html preview, and homesignalmap.html (development tracker).
//
// HONEST-LABELING CONTRACT (2026-07-16 backbone audit):
//   * Pin colors encode PERMIT STATUS (Proposed / Approved / Operating) — the only
//     per-record fact the data carries. NO "impact" tiers: the old impact legend
//     decoded to a status->constant lookup, its red "High impact" tier was
//     unreachable (max stored score 72 < the 75 threshold), and its green
//     "Positive" tier required fields that never render. Unknown statuses get the
//     neutral "On file" gray — never a guessed severity.
//   * A saved-place marker renders ONLY for a real saved address in
//     the viewed ZIP — never a centroid, sample address, or arbitrary record.
//     Fix 9: the marker is never labeled "Your home".
//   * Live engines degrade MapLibre GL -> Leaflet rasters (no WebGL needed) ->
//     schematic diagram, and a map failure never throws into the caller's init.
(function () {
  const HS = (window.HS = window.HS || {});

  // ── 3D CAPABILITY + HONEST FAILURE COPY ───────────────────────────────────────────
  // The development tracker (homesignalmap.html) offers two WebGL views — 3D aerial
  // (three.js) and 3D satellite (MapLibre GL). Both draw into a canvas layered over a
  // dark panel, so ANY initialisation failure used to present as a silent black
  // rectangle: the panel's own background, no message, and (for MapLibre) not even a
  // console error, because the caller swallowed the exception.
  //
  // Two failure classes were reproduced against the real page, and they are the reason
  // these two helpers exist:
  //   * NO WEBGL — getContext('webgl') returns null. This is ONE REPRODUCED TRIGGER with
  //     many possible causes (WebGL unavailable or switched off, no hardware acceleration,
  //     a driver denylist, a virtualised GPU, an older device); it is NOT attributable to
  //     any one browser. three.js throws; MapLibre throws "Failed to initialize WebGL".
  //     BOTH 3D views go black while the 2D Leaflet map, which needs no WebGL, keeps
  //     working — exactly the shape a resident reports as "the 3D view is a black box".
  //   * INIT THREW — e.g. MapLibre's constructor raising
  //     "Invalid LngLat object: (NaN, NaN)" when the report carries no home point.
  //
  // Both are surfaced, never swallowed. A black panel is not an error state.

  // Can this browser actually give us a WebGL drawing context? Answers the question the
  // 3D views ask, and NEVER throws — a probe that can throw is a second failure mode.
  //
  // THE FALSE NEGATIVE THIS GUARDS (measured 2026-09-07, production ZIP 78617):
  // the same browser loaded 3D on a phone and reported `3d/nowebgl` on a new desktop.
  // The old probe used ONE unattached canvas and asked it for webgl2, then webgl, then
  // experimental-webgl. Two independent ways that returns false while a real renderer
  // would succeed:
  //   1. CONTEXT-TYPE LOCK. A canvas that has been asked for webgl2 (even when the
  //      call returned null) will refuse a later webgl request on the SAME canvas.
  //      Desktop GPUs that grant WebGL 1 and not WebGL 2 then look like "no WebGL".
  //      Fix: a fresh canvas per type.
  //   2. UNATTACHED / ZERO-WORK canvas. Some desktop GPU processes refuse a context
  //      on a canvas that is not in the document. The 3D views attach their canvas
  //      to a visible panel; the probe must ask the same question they do.
  //      Fix: attach a 1×1 canvas, then detach it.
  // The probe context is RELEASED (WEBGL_lose_context) so it cannot occupy a scarce
  // context slot the real renderer needs. Presence of the API is still not capability:
  // a constructor that refuses every type still returns false.
  HS.WEBGL_CONTEXT_TYPES = ['webgl2', 'webgl', 'experimental-webgl'];
  HS.WEBGL_PROBE_ATTRS = { failIfMajorPerformanceCaveat: false, alpha: true };

  function webglRelease(gl, canvas) {
    try {
      const ext = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
      if (ext && ext.loseContext) ext.loseContext();
    } catch (e) { /* ignore */ }
    try { if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas); } catch (e) { /* ignore */ }
  }

  HS.webglProbe = function (doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.createElement) return { ok: false, type: null };
    const types = HS.WEBGL_CONTEXT_TYPES;
    const attrs = HS.WEBGL_PROBE_ATTRS;
    try {
      for (let i = 0; i < types.length; i++) {
        const c = d.createElement('canvas');
        if (!c || !c.getContext) continue;
        try { c.width = 1; c.height = 1; } catch (e) { /* ignore */ }
        const parent = (d.body && d.body.appendChild) ? d.body
          : (d.documentElement && d.documentElement.appendChild) ? d.documentElement
          : null;
        try {
          if (parent) {
            try {
              if (c.style) c.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
              parent.appendChild(c);
            } catch (e) { /* unattached is still worth trying */ }
          }
          const gl = c.getContext(types[i], attrs) || c.getContext(types[i]);
          if (gl && !(typeof gl.isContextLost === 'function' && gl.isContextLost())) {
            webglRelease(gl, c);
            return { ok: true, type: types[i] };
          }
          webglRelease(gl, c);
        } catch (e) {
          webglRelease(null, c);
        }
      }
      return { ok: false, type: null };
    } catch (e) { return { ok: false, type: null }; }
  };

  HS.webglSupported = function (doc) {
    return !!HS.webglProbe(doc).ok;
  };

  // BROWSER-NEUTRAL FALLBACK COPY (founder ruling, 2026-09-06).
  //
  // ONE message for every failure class, and it names NO browser, NO vendor setting and
  // NO privacy control. HomeSignal must work across supported browsers and must never ask
  // a resident to weaken a protection to see a map. An earlier draft of this copy named a
  // browser and a privacy control and told the resident to change it; that is withdrawn
  // and must not come back. The guard is test/map1-3d-never-silent-black.test.mjs §2.
  //
  // The failure REASON ('nowebgl' | 'load' | 'init') is still carried, but only to the
  // console, where it is a diagnostic. The resident is told what happened to them and what
  // they have now, which is the same in every case: the 3D view did not start, and they are
  // on the 2D map, which carries the same records.
  HS.MAP3D_FALLBACK =
    '3D view couldn\u2019t load right now. ' +
    'You\u2019ve been returned to the 2D map.';

  // Secondary line — vendor-neutral and OPTIONAL. It says the failure may be transient and
  // makes NO claim about what the device or browser is capable of. Measured 2026-09-07: 3D
  // worked in the same browser on one device and fell back on another, so the old wording
  // ("requires WebGL and hardware-accelerated graphics") stated as fact something that was
  // not true of the machine reading it. Rendered only where there is room for it.
  HS.MAP3D_FALLBACK_DETAIL = 'You can try 3D again in a moment.';

  // `reason` is accepted and deliberately ignored for the resident-facing string, so that a
  // future failure class cannot quietly introduce browser-specific copy through this door.
  HS.map3dFailCopy = function (reason) {   // eslint-disable-line no-unused-vars
    return HS.MAP3D_FALLBACK;
  };

  // Merge regulated facilities into the lettered pin/list set with a reserved FLOOR
  // (default 4), so the closest facilities are ALWAYS surfaced and lettered even when
  // development records would otherwise fill every slot. De-duped across both streams
  // (by id, else name+coords; a facility wins a collision — it carries env context).
  // reserve = min(floor, #distinct facilities, cap). Final order + lettering follow
  // proximity. Pure + side-effect-free so test/facility-slots.test.mjs can pin it.
  // (Supersedes the older "facilities never lettered — spec §6" split for this list.)
  HS.reserveFacilitySlots = function (devItems, facs, opts) {
    opts = opts || {};
    var cap     = opts.cap     != null ? opts.cap     : 16;
    var floor   = opts.floor   != null ? opts.floor   : 4;
    var LETTERS = opts.letters || 'ABCDEFGHIJKLMNOP';
    function keyOf(x) {
      if (!x) return '';
      if (x.id != null && x.id !== '') return 'id:' + x.id;
      return 'k:' + String(x.name || x.title || '') + '@' + (x.lat != null ? x.lat : '') + ',' + (x.lng != null ? x.lng : '');
    }
    function dist(x) { return (x && x.distance_mi != null) ? x.distance_mi : 9e9; }
    function byDist(a, b) { return dist(a) - dist(b); }

    var seen = {}, facU = [], devU = [];
    (facs || []).slice().sort(byDist).forEach(function (f) {
      var k = keyOf(f); if (seen[k]) return; seen[k] = 1;
      facU.push(Object.assign({}, f, { _facility: true }));
    });
    (devItems || []).slice().sort(byDist).forEach(function (d) {
      var k = keyOf(d); if (seen[k]) return; seen[k] = 1;
      devU.push(Object.assign({}, d, { _facility: false }));
    });

    var reserve = Math.min(floor, facU.length, cap);      // guaranteed facility slots
    var picked = facU.slice(0, reserve);                  // closest facilities, always in
    var rest = devU.concat(facU.slice(reserve)).sort(byDist);
    for (var i = 0; i < rest.length && picked.length < cap; i++) picked.push(rest[i]);

    return picked.sort(byDist).slice(0, cap).map(function (it, i) {
      return Object.assign({}, it, { _letter: LETTERS[i] || '' });
    });
  };

  // ---- Maps uncap (Phase 2): the full-set "rest" layer backbone ----------------
  // The lettered A-P set is a presentation aid for the nearest records — it must
  // never be an accessibility cap. restAfterLetters() returns every coordinate-
  // bearing record in the filtered visible set that did NOT earn a letter; the map
  // pages render these as a lightweight clustered (GL) / canvas (Leaflet) layer so
  // ALL records stay reachable on the map. Pure + side-effect-free so
  // test/maps-rest-layer.test.mjs can pin it.
  HS.restAfterLetters = function (visible, lettered) {
    var inSet = {};
    (lettered || []).forEach(function (it) { if (it && it.id != null) inSet[it.id] = 1; });
    return (visible || []).filter(function (x) {
      return x && x.lat != null && x.lng != null && !(x.id != null && inSet[x.id]);
    });
  };
  // GeoJSON for the GL clustered source: one point per record, carrying its
  // resolved marker SHAPE (type) and status COLOR (lifecycle), the id for the
  // click -> panel dispatch, and a facility flag so facility points route to the
  // facility detail.
  //
  // `shape` used to be COMPUTED HERE AND THEN DROPPED: the feature carried only
  // `col`, and the GL layer was `type:'circle'`, so every record past the 16
  // lettered pins rendered as a circle no matter what it was. Classification was
  // never the problem — the shape was resolved correctly and discarded at this
  // exact line. Emitting it lets the symbol layer draw the real symbol, so
  // "pin shape = project type" holds for the WHOLE plotted set, not just the
  // lettered head. (test/maps-rest-shape-parity.test.mjs pins this.)
  HS.restFeatureCollection = function (items) {
    return { type: 'FeatureCollection', features: (items || []).map(function (it) {
      var mk = HS.resolveMarker ? HS.resolveMarker(it) : { color: '#706468', shape: 'circle' };
      var shape = mk.shape || 'circle';
      return { type: 'Feature',
        geometry: { type: 'Point', coordinates: [+it.lng, +it.lat] },
        properties: { id: it.id, col: mk.color, shape: shape,
                      icon: HS.restIconId(shape, mk.color),
                      fac: it._restFacility ? 1 : 0 } };
    }) };
  };
  // ONE id function for a (shape, color) marker image, shared by the page that
  // registers the icons and the tests that assert them, so they cannot disagree.
  HS.restIconId = function (shape, color) {
    return 'hs-' + (shape || 'circle') + '-' + String(color || '').replace('#', '');
  };
  // The distinct (shape,color) images a feature collection needs. Pure: the page
  // rasterizes HS.markerSVG(shape,color) for each and registers it under `id`.
  // Derived from the ACTUAL features, so a new category or status colour needs no
  // enumeration here and can never be missed.
  HS.restIconSpecs = function (fc) {
    var seen = {}, out = [];
    ((fc && fc.features) || []).forEach(function (f) {
      var p = (f && f.properties) || {};
      var id = p.icon || HS.restIconId(p.shape, p.col);
      if (seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, shape: p.shape || 'circle', color: p.col });
    });
    return out;
  };

  // ── COMPLETE PLOTTED-MARKER SET (Focus/tile symbology parity, 2026-07-24) ──────
  // ONE authority for WHICH records every render surface plots and WHAT canonical
  // symbol each gets. Before this, Focus/schematic plotted only the lettered A–P
  // subset (+ facility squares) while the tile modes' uncapped "rest" layer carried
  // the full remainder — so Focus silently dropped every record beyond the letters
  // and the map read as facility-dominated. plottedMarkerSet() derives the SAME
  // complete set the tile modes render, so Focus can plot it too and no mode can
  // regress into a partial view. Pure + side-effect-free (test/maps-focus-completeness).
  //
  //   visible   — the filtered dev + coordinate-bearing change set (facilities NOT in here)
  //   facs      — the nearest facilities that keep individual DOM squares (maps.html: nearest 24)
  //   restFacs  — mappable facilities beyond that nearest set (already _restFacility-tagged)
  //
  // Returns one entry per record { item, shape, color, isFacility, filterKey, lettered }.
  // Every visible record and every facility appears EXACTLY once (deduped by the
  // lettered/rest/unlettered partition), so the histogram is complete and drop-free.
  HS.plottedMarkerSet = function (visible, facs, restFacs, opts) {
    opts = opts || {};
    var letters = opts.letters || 'ABCDEFGHIJKLMNOP';
    var showFacilities = opts.showFacilities !== false;
    var facList  = showFacilities ? (facs || []) : [];
    var restFacL = showFacilities ? (restFacs || []) : [];
    var lettered = HS.reserveFacilitySlots(visible || [], facList,
      { cap: opts.cap != null ? opts.cap : 16, floor: opts.floor != null ? opts.floor : 4, letters: letters });
    var letteredIds = {};
    lettered.forEach(function (it) { if (it && it.id != null) letteredIds[it.id] = 1; });
    var restDev = HS.restAfterLetters(visible || [], lettered);          // dev beyond the letters
    var unletteredFacs = facList.filter(function (f) {                   // nearest facs not lettered
      return !(f.id != null && letteredIds[f.id]);
    });
    var out = [];
    function push(item, isLettered) {
      var m = HS.resolveMarker(item);
      out.push({ item: item, shape: m.shape, color: m.color, isFacility: m.isFacility,
                 filterKey: m.filterKey, lettered: !!isLettered });
    }
    lettered.forEach(function (it) { push(it, true); });
    restDev.forEach(function (it) { push(it, false); });
    unletteredFacs.forEach(function (f) { push(f, false); });
    restFacL.forEach(function (f) { push(f, false); });
    return out;
  };
  // Histogram of a plotted set by status-filter bucket, shape, and color — the
  // regression backbone. Two render surfaces built from the SAME inputs MUST agree,
  // and the total MUST equal the complete visible+facility count (nothing dropped,
  // nothing double-plotted). test/maps-focus-completeness.test.mjs pins both.
  HS.markerHistogram = function (plotted) {
    var byStatus = {}, byShape = {}, byColor = {};
    (plotted || []).forEach(function (p) {
      byStatus[p.filterKey] = (byStatus[p.filterKey] || 0) + 1;
      byShape[p.shape]      = (byShape[p.shape]  || 0) + 1;
      byColor[p.color]      = (byColor[p.color]  || 0) + 1;
    });
    return { total: (plotted || []).length, byStatus: byStatus, byShape: byShape, byColor: byColor };
  };

  // permit status -> pin color + legend label. Only EXACT known statuses are
  // colored ('Active'/'Built' are the materializer's built-bucket synonyms);
  // anything else renders the neutral "On file" — never a guessed tier.
  // Hexes come from the ONE canonical mapping (lib/templates.js::HS.statusHex,
  // loaded before this file on every page that uses both) so pins and card
  // bars can never drift apart; the literals are the load-order fallback.
  const HX = HS.statusHex || { proposed: '#c47a1a', approved: '#3f7fb0', operating: '#1f9d5c', onfile: '#706468' };
  // ── CANONICAL LIFECYCLE CONTRACT (maps-backbone repair) ───────────────────
  // FOUR members, no more: proposed | approved | operating | unknown. `unknown` is a
  // FIRST-CLASS, LEGENDED state — a record whose source states no lifecycle must never
  // be silently promoted to operating/built (that fabricates a fact) nor demoted to
  // proposed. `onfile` is retained ONLY as a read alias for the old vocabulary so
  // stored filter prefs and older callers keep resolving; it renders as `unknown`.
  const LIFECYCLE_KEYS = ['proposed', 'approved', 'operating', 'unknown'];
  const STATUS_TIERS = {
    proposed:  { hex: HX.proposed,  label: 'Proposed' },
    approved:  { hex: HX.approved,  label: 'Approved' },
    operating: { hex: HX.operating, label: 'Operating / built' },
    unknown:   { hex: HX.onfile,    label: 'Lifecycle unknown' }
  };
  STATUS_TIERS.onfile = STATUS_TIERS.unknown;              // legacy alias, same object
  HS.LIFECYCLE_KEYS = LIFECYCLE_KEYS.slice();

  // ══ DECISION HISTORY — the page half of sources/decision.ts ═══════════════════════
  //
  // ⚠️ THIS IS A SECOND COPY OF ONE CONTRACT, AND THAT IS PINNED, NOT TOLERATED.
  // The engine authority is a TypeScript module the browser cannot import, so the
  // vocabulary and the copy exist here too. test/decision-vocabulary-parity.test.mjs
  // imports BOTH and fails when they disagree on a single member or a single sentence —
  // the same control this repo already uses for the meetings enrolment gate. Two
  // vocabularies with no gate between them is precisely how they drift.
  //
  // WHAT THIS IMPLEMENTS (founder contract, 2026-09-20): a genuine proposal that was
  // DENIED stays discoverable under Proposed with a prominent sourced decision notation.
  // It is never auto-deleted, never relabelled "Canceled", and an appeal is never read as
  // an approval. Four things stay separate, and the separation is the whole design:
  //   (1) BROWSING CATEGORY        — unchanged by a decision; a denied application is a
  //                                  historical proposal. `statusTier` never reads a
  //                                  decision, so the pin's shape and colour cannot move.
  //   (2) DECISION + HISTORY       — HS.decisionNotation()
  //   (3) CURRENT-STATUS VERIFYING — HS.currentStatusLine()
  //   (4) ELIGIBILITY              — HS.isActiveUndecided()
  //
  // A RECENT FETCH IS NOT PROOF OF A RECENT DECISION CHECK. Nothing below reads
  // `refreshed_at`, and nothing may be added that does.
  const DECISION_OUTCOMES = ['denied', 'withdrawn'];
  const DECISION_LABELS = { denied: 'Denied', withdrawn: 'Withdrawn by applicant' };
  const DECISION_EVIDENCE_LEVELS = ['decision', 'title_only', 'date_only', 'none'];
  HS.DECISION_OUTCOMES = DECISION_OUTCOMES.slice();
  HS.DECISION_LABELS = DECISION_LABELS;
  HS.DECISION_EVIDENCE_LEVELS = DECISION_EVIDENCE_LEVELS.slice();

  // The decision object a record carries, or null. Read from the engine's own field —
  // never inferred from a label, a colour or a status string, because an inferred
  // decision is exactly the unsourced claim this feature exists to remove.
  HS.decisionOf = function (item) {
    const d = item && item.decision;
    if (!d || typeof d !== 'object') return null;
    if (DECISION_OUTCOMES.indexOf(String(d.outcome || '')) === -1) return null;
    if (!String(d.source_url || '').trim()) return null;   // unsourced → not a notation
    return d;
  };

  // What this record's SOURCE could report about a refusal. `date_only` groups with
  // `none` on purpose: a decision DATE column says when something was decided, never
  // that it was refused, so it is not denial coverage.
  HS.sourceCanReportDenial = function (evidence) {
    const e = String(evidence == null ? '' : evidence);
    return e === 'decision' || e === 'title_only';
  };

  // ── (4) ELIGIBILITY — the ONE predicate ────────────────────────────────────────────
  // Every active-proposal count, upcoming-decision list, notification and social claim
  // routes through this. A denied proposal is in the Proposed browsing category and is
  // refused here; that gap between (1) and (4) is the feature, not an inconsistency.
  // ⚠️ FIELD PRECEDENCE IS LOAD-BEARING — `type` MEANS TWO DIFFERENT THINGS. On an engine
  // site object it is the LIFECYCLE ("proposed"); on a marker item built by
  // HS.trackerSiteItem it is the project CATEGORY ("Data center"), with the lifecycle in
  // `lifecycleBucket`/`status`. Reading `type` first asked "is a data centre a proposal?"
  // and reported every live marker as not-active. Unambiguous fields first.
  // The decision test is ANY decision object, not a validated one: something tried to
  // record a decision, and counting that row as live is the direction that reaches a
  // resident. HS.decisionOf's validation exists for the opposite job — refusing to RENDER
  // an unsourced notation — and using it here made the page disagree with the engine.
  HS.isActiveUndecided = function (item) {
    const it = item || {};
    if (it.decision) return false;
    if (it.decided === true || it.decided === 'true') return false;
    if (String(it.status == null ? '' : it.status).trim().toLowerCase() === 'decided') return false;
    const stage = String(it.bucket || it.lifecycleBucket || it.status || it.type || '')
      .trim().toLowerCase();
    return stage === 'proposed';
  };

  const DEC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function decHumanDay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    const mon = DEC_MONTHS[Number(m[2]) - 1];
    return mon ? (Number(m[3]) + ' ' + mon + ' ' + m[1]) : String(iso);
  }

  // ── (2) THE DECISION NOTATION ─────────────────────────────────────────────────────
  // A missing date is SAID rather than hidden: dating a denial from a filing date would
  // fabricate the one field a resident would rely on.
  HS.decisionNotation = function (decision, subject) {
    const d = decision && DECISION_LABELS[decision.outcome] ? decision : null;
    if (!d) return '';
    const subj = String(subject || '').trim() || 'Application';
    const verb = d.outcome === 'denied' ? 'denied' : 'withdrawn by the applicant';
    const when = d.decided_on ? (' on ' + decHumanDay(d.decided_on))
                              : ' · date not stated by the source';
    const how = d.basis === 'title_text' ? ' (stated in the notice title)' : '';
    return subj + ' ' + verb + when + how + '.';
  };

  // ── (3) THE CURRENT-STATUS LINE — the universal protection ────────────────────────
  // What a surface may HONESTLY say about the disposition TODAY. There is no branch that
  // reads a fetch time, and that absence is load-bearing.
  HS.currentStatusLine = function (decision, evidence) {
    const d = decision && DECISION_LABELS[decision.outcome] ? decision : null;
    if (d) {
      return DECISION_LABELS[d.outcome]
        + ' on the record · Any later appeal or re-filing is not verified.';
    }
    if (HS.sourceCanReportDenial(evidence)) {
      return 'Application on file · No decision recorded by this source'
        + ' · Current decision status not verified.';
    }
    return 'Application on file · Current decision status not verified.';
  };

  // Shown on a Proposed rail ONLY when it actually holds a decided record, so a page
  // with none is byte-for-byte unchanged and the sentence never appears unexplained.
  HS.PROPOSED_INCLUDES_HISTORY_NOTE =
    'Includes historical proposals — applications that were filed and later decided.';
  HS.proposedRailNote = function (items) {
    const list = items || [];
    for (let i = 0; i < list.length; i++) {
      if (HS.decisionOf(list[i])) return HS.PROPOSED_INCLUDES_HISTORY_NOTE;
    }
    return '';
  };
  // Count of genuinely active, undecided applications in a set — separation (4) applied.
  HS.activeUndecidedCount = function (items) {
    return (items || []).filter(function (it) { return HS.isActiveUndecided(it); }).length;
  };

  // ── STABLE STAGE IDS — the vocabulary a URL and a stored preference speak ─────
  // The bucket keys above (proposed | approved | operating | unknown) are an
  // IMPLEMENTATION name. `?stages=` is a resident-facing, shareable contract, so the
  // two are deliberately separate: a bucket can be renamed without invalidating every
  // link a resident has already shared, and the Stage filter can key on an ID rather
  // than on a chip's LABEL TEXT or its DOT COLOUR — both of which are presentation and
  // both of which have already moved once (the row's mark went triangle -> dot, and
  // `operating` is displayed as "Operating now" while its tier label reads
  // "Operating / built"). An id is the one part of a stage a redesign may not move.
  //
  // GENERATED from LIFECYCLE_KEYS, never hand-listed, so a fifth lifecycle bucket
  // cannot ship without an id — it would resolve to '' here and be dropped by the URL
  // reader rather than silently filtering nothing.
  const STAGE_ID_BY_KEY = { operating: 'operating_now', approved: 'approved',
                            proposed: 'proposed', unknown: 'lifecycle_unknown' };
  const STAGE_KEY_BY_ID = {};
  LIFECYCLE_KEYS.forEach(function (k) {
    if (STAGE_ID_BY_KEY[k]) STAGE_KEY_BY_ID[STAGE_ID_BY_KEY[k]] = k;
  });
  HS.STAGE_ID_BY_KEY = STAGE_ID_BY_KEY;
  // `onfile` is the retained read alias for the old vocabulary (see LIFECYCLE_KEYS), so
  // it resolves to the same id rather than to nothing.
  HS.stageIdForKey = function (k) { return STAGE_ID_BY_KEY[k === 'onfile' ? 'unknown' : k] || ''; };
  HS.stageKeyForId = function (id) { return STAGE_KEY_BY_ID[String(id == null ? '' : id).trim()] || ''; };
  function statusTier(item) {
    const s = String((item && item.status) || '').toLowerCase();
    const k = (s === 'proposed') ? 'proposed'
            : (s === 'approved') ? 'approved'
            : (s === 'operating' || s === 'active' || s === 'built') ? 'operating'
            : 'unknown';
    return Object.assign({ k: k, c: STATUS_TIERS[k].hex }, STATUS_TIERS[k]);
  }
  HS.mapStatus = statusTier;

  // ── Per-status pin visibility (shared state, persisted per session) ───────
  // The map legend's "Status — pin color" rows double as show/hide toggles. The
  // chosen set lives HERE, on the shared backbone — NOT in any one page's script —
  // so a resident's choice applies on every ZIP/map surface that reads it, and it
  // PERSISTS in sessionStorage (survives radius changes and in-session navigation;
  // resets when the tab closes). Four independently-toggleable buckets, ALL default
  // ON:
  //   proposed / approved / operating — the three permit-status tiers.
  //   facility                        — regulated facilities (their own pin type).
  // An 'On file' / unknown-status pin has no legend row of its own, so it rides with
  // 'operating' (on record = exists now) — that keeps the all-off state genuinely
  // empty rather than leaving orphan pins no toggle can hide.
  // `unknown` is its own filter bucket — it used to be folded into `operating`, which
  // hid lifecycle-unknown records whenever a reader turned "Operating now" off and made
  // the legend a lie about what that toggle controls.
  const STATUS_FILTER_KEYS = ['proposed', 'approved', 'operating', 'unknown', 'facility'];
  const STATUS_FILTER_SS_KEY = 'hs.map.statusFilters';
  function defaultStatusFilters() { return { proposed: true, approved: true, operating: true, unknown: true, facility: true }; }
  function loadStatusFilters() {
    const f = defaultStatusFilters();
    try {
      const raw = window.sessionStorage.getItem(STATUS_FILTER_SS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        STATUS_FILTER_KEYS.forEach(function (k) { if (typeof saved[k] === 'boolean') f[k] = saved[k]; });
      }
    } catch (e) { /* storage blocked or bad JSON -> all-on default */ }
    return f;
  }
  let statusFilters = loadStatusFilters();
  function persistStatusFilters() {
    try { window.sessionStorage.setItem(STATUS_FILTER_SS_KEY, JSON.stringify(statusFilters)); } catch (e) {}
  }
  // Which of the four toggle buckets a pin belongs to (delegates to resolveMarker).
  function statusFilterKey(item) {
    return HS.resolveMarker(item).filterKey;
  }
  HS.statusFilterKeys = STATUS_FILTER_KEYS.slice();
  HS.getStatusFilters = function () { return statusFilters; };
  HS.setStatusFilter = function (key, on) {
    if (STATUS_FILTER_KEYS.indexOf(key) === -1) return statusFilters;
    statusFilters[key] = !!on;
    persistStatusFilters();
    return statusFilters;
  };
  HS.statusFilterKey = statusFilterKey;                 // item -> one of the four keys
  HS.statusVisible = function (item) { return !!statusFilters[statusFilterKey(item)]; };
  HS.allStatusesOff = function () { return STATUS_FILTER_KEYS.every(function (k) { return !statusFilters[k]; }); };
  HS.filterByStatus = function (items) { return (items || []).filter(HS.statusVisible); };


  // ── CANONICAL MARKER REGISTRY (marker-backbone audit, 2026-07-20) ─────────
  // ONE resolver — HS.resolveMarker(item) — is the sole authority for pin shape,
  // color, legend labels, popup text, and filter buckets. Every renderer (MapLibre,
  // Leaflet, schematic/Focus, dashboard preview, development tracker) MUST call it;
  // no renderer may independently derive shape or color.
  //
  // CLASSIFICATION PRECEDENCE (deterministic, renderer-agnostic):
  //   1. Explicit regulated-facility flag (_facility or record_kind === 'facility')
  //      then, inside that branch: stated data-centre dual identity, else
  //      overlay-on-Type from class fields, else standalone purple square
  //   2. Exact normalized project type string (TYPE_EXACT) — except GENERIC_EXACT
  //      buckets (Development/unclassified/Trades/…) which are NON-TERMINAL
  //   3. Canonical use_type field (same TYPE_EXACT / GENERIC_EXACT rules)
  //   4. layer / category fallback (LAYER_EXACT)
  //   5. Deliberately ordered keyword rules on type fields + name/title/label
  //   6. Other project (circle)
  // The regulated-facility identity colour — the purple square, and the small purple
  // square drawn beneath a dual-identity data-centre pin. It was '#6f42c1', a BLUE-violet
  // (CIELAB hue 308) sitting only 15.2 (CIEDE2000) from the lifecycle `approved` blue
  // '#2563EB' — closer than the operating/unknown pair that was reported from the live
  // page, and 24.3 from the muted permit-status blue. Shape separated them (square vs
  // triangle) but colour did not, on a map that draws both together.
  // '#7d148c' is a true violet (hue 324) rather than a blue-violet, so it stays
  // unmistakably purple while clearing every other colour on the map:
  //   lifecycle  approved 15.2 -> 27.0 · unknown 26.7 -> 26.8 · operating 42.4 · proposed 54.2
  //   status     approved 24.3 -> 37.6 · onfile  26.7 -> 26.8 · operating 55.4 · proposed 58.2
  //   contrast vs white 6.51:1 -> 8.93:1
  // It must clear the NEUTRAL as well as the blue, and that is what forces the saturation:
  // a softer purple (e.g. '#7b2d8e') lands at 24.7 against the warm-grey neutral.
  // Pinned by test/lifecycle-color-separation.test.mjs §7.
  const FACILITY_HEX = '#7d148c';
  // ── REGULATORY RECORDS ARE A THIRD DIMENSION, NOT A PROJECT TYPE ──────────
  // ⚖️ FOUNDER RULING 2026-09-06. "Regulated facility" must not appear under Project
  // Type or Status. It is regulatory CONTEXT, and context overlaps: a regulated site
  // still has a project type and a lifecycle stage, so listing it beside Data center /
  // Industrial / Residential asked the resident to pick between two things that are
  // both true. It shipped as an eighth Type chip, and the cost was exactly that
  // confusion — turning "Regulated facility" off read as "hide a kind of project" when
  // what it hides is a kind of RECORD.
  //
  // It is therefore its own legend row with its own on/off control, and the marker
  // language changes to match: an overlay badge on the project marker (see markerSVG),
  // never a replacement for the Type symbol.
  //
  // ⛔ The filter KEY stays `facility` and stays inside CATEGORY_REGISTRY. Only the
  // PRESENTATION moved. Membership is still the any-of set built in resolveMarker, so
  // the #1056 dual-identity contract — one record, two memberships, one marker — is
  // untouched: a dual-identity data centre still survives with its Data center chip on
  // and regulatory off (as a plain octagon), and with Data center off and regulatory on.
  // Overlay-on-Type uses the same membership set: a classifiable EPA record belongs
  // to its Type AND `facility`, so Regulatory OFF leaves the Type pin. Splitting the
  // key would have forked that contract into two filter models.
  const REGULATORY_BADGE_LETTER = 'R';
  const LEGEND_NEUTRAL_HEX = HX.onfile;
  // ── THE CANONICAL DEVELOPMENT TYPE LIVES IN lib/project-type.js ───────────
  // CATEGORY_REGISTRY, every precedence rule and classifyProjectType were moved there
  // verbatim (2026-09-24) so a surface that draws no map can read the SAME Type answer.
  // This file keeps everything that is about DRAWING: shape assembly, lifecycle colour,
  // the facility identity, filter membership, legends. It holds no Type rule of its own.
  // Fail LOUD if the authority is missing — a map that silently classified nothing would
  // draw every pin as the fallback and look healthy.
  const PT = HS.projectType;
  if (!PT || typeof PT.classifyProjectType !== 'function') {
    throw new Error('lib/map.js requires lib/project-type.js to be loaded first (the canonical Development Type authority).');
  }
  const CATEGORY_REGISTRY = PT.CATEGORY_REGISTRY;
  const classifyProjectType = PT.classifyProjectType;
  const statedDataCenter = PT.statedDataCenter;
  const facilityIdentity = PT.facilityIdentity;
  // GENERATED from CATEGORY_REGISTRY — never hand-listed, so the legend cannot drift
  // from what the renderer draws. The facility row is emitted separately (it carries
  // its own colour, not the neutral swatch), which is why it is filtered out here.
  HS.SHAPE_LEGEND = Object.keys(CATEGORY_REGISTRY)
    .filter(function (k) { return CATEGORY_REGISTRY[k].legend && !CATEGORY_REGISTRY[k].isFacility; })
    .map(function (k) { return { shape: CATEGORY_REGISTRY[k].symbol, label: CATEGORY_REGISTRY[k].label, categoryKey: k }; });
  // The THIRD legend row. GENERATED here beside the other two so a page draws three
  // rows from one source; nothing about it is hand-listed on the page.
  HS.REGULATORY_LEGEND = {
    key: 'facility',
    heading: 'Regulatory records',
    toggleLabel: 'Show regulatory facilities',
    // The CHIP's label. Deliberately not `toggleLabel`: that string is the imperative a
    // SWITCH needs ("Show …"), and the chip no longer needs it — its checkmark already
    // says whether the overlay is drawn, so the label names the thing, not the action.
    // Both are kept: `toggleLabel` is still the registry's answer for any consumer that
    // renders an imperative control, and it is pinned by an offline test.
    chipLabel: 'Regulatory facilities',
    // Founder-set copy, verbatim. It is the only place the purple R is explained, so it
    // states what the badge MEANS and what the corpus COVERS — and it claims a RECORD,
    // never a finding: a regulatory registration is a public fact, not a verdict on any
    // operator (docs/development-tracker-source-of-truth.md §10).
    helper: 'Purple R = environmental regulatory record. Includes EPA and linked state, '
          + 'local, tribal, and federal records.',
    letter: REGULATORY_BADGE_LETTER,
    color: FACILITY_HEX,
    // The standalone marker a regulatory-only location draws — a location with a
    // regulatory record and no mapped project type. Same purple, no project symbol to
    // ride on, so the regulatory identity IS the marker.
    symbol: CATEGORY_REGISTRY.facility.symbol,
    label: CATEGORY_REGISTRY.facility.label
  };
  HS.STATUS_LEGEND_ROWS = [
    { key: 'proposed',  hex: HX.proposed,  label: STATUS_TIERS.proposed.label },
    { key: 'approved',  hex: HX.approved,  label: STATUS_TIERS.approved.label },
    { key: 'operating', hex: HX.operating, label: STATUS_TIERS.operating.label },
    { key: 'unknown',   hex: STATUS_TIERS.unknown.hex, label: STATUS_TIERS.unknown.label },
    { key: 'facility',  hex: FACILITY_HEX, label: CATEGORY_REGISTRY.facility.label, squareSwatch: true }
  ];
  // Development-tracker lifecycle colors — intentionally separate from permit-status
  // colors; used only when resolveMarker is called with colorMode:'lifecycle'.
  // `operating` was '#1f5130' — the HomeSignal BRAND green (--green), chosen for buttons
  // and headings, not as a categorical data colour. Its CIELAB chroma is 29 against 80 for
  // `approved`, 67 for `proposed` and 71 for the facility violet, so it was barely more
  // saturated than the NEUTRAL it has to contrast with (chroma 6) — and at L*30 on a 14px
  // mark it read as dark GREY, not as green. That is why the legend still looked like one
  // colour after the palette was separated: a pair can measure 33.5 dE00 apart while almost
  // all of that distance is LIGHTNESS, which is the first thing a tiny mark loses.
  //
  // '#00893a' is a real green — chroma 29 -> 60, L* 30 -> 50, hue 146 so it stays in the
  // brand's own green family (150). It also clears 4.5:1 against white text, which the
  // `.band-h.t-built` "Operating now" section header needs and which '#1f9d5c' (the
  // permit-status green, contrast 3.48:1) would have failed — that is why the two palettes
  // do not share one value here. Separation is unaffected: worst pair 36.3.
  // Pinned by test/lifecycle-color-separation.test.mjs §10.
  HS.LIFECYCLE_HEX = { built: '#00893a', approved: '#2563EB', proposed: '#E2772F', permit: '#E2772F',
                       operating: '#00893a', unknown: HX.onfile };
  HS.markerRegistry = {
    facilityHex: FACILITY_HEX,
    neutralHex: LEGEND_NEUTRAL_HEX,
    statusHex: HX,
    lifecycleHex: HS.LIFECYCLE_HEX,
    shapeLegend: HS.SHAPE_LEGEND,
    statusLegend: HS.STATUS_LEGEND_ROWS
  };


  // ── Per-CATEGORY (type) visibility — a SECOND, independent filter dimension ──
  // The status dimension above answers "which lifecycle stages do I want to see".
  // This one answers "which KINDS of thing do I want to see" — the founder's
  // "turn off every Map 1 type except EPA / Regulated facility".
  //
  // THE INVARIANT THIS EXISTS TO HOLD: filter membership decides whether a record
  // QUALIFIES to be visible; it never decides what the record IS. A record is shown
  // when ANY of its memberships is on, and it is shown ONCE — membership is an
  // any-of test over one marker, never a join that could emit a second marker.
  // Its primary symbol comes from resolveMarker's single categoryKey and does not
  // change with which filter admitted it.
  const CATEGORY_FILTER_KEYS = Object.keys(CATEGORY_REGISTRY);
  const CATEGORY_FILTER_SS_KEY = 'hs.map.categoryFilters';
  function defaultCategoryFilters() {
    const f = {};
    CATEGORY_FILTER_KEYS.forEach(function (k) { f[k] = true; });
    return f;
  }
  function loadCategoryFilters() {
    const f = defaultCategoryFilters();
    try {
      const raw = window.sessionStorage.getItem(CATEGORY_FILTER_SS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        CATEGORY_FILTER_KEYS.forEach(function (k) { if (typeof saved[k] === 'boolean') f[k] = saved[k]; });
      }
    } catch (e) { /* storage blocked or bad JSON -> all-on default */ }
    return f;
  }
  let categoryFilters = loadCategoryFilters();
  function persistCategoryFilters() {
    try { window.sessionStorage.setItem(CATEGORY_FILTER_SS_KEY, JSON.stringify(categoryFilters)); } catch (e) {}
  }
  // The membership SET for a record. Falls back to the single categoryKey so a
  // caller holding a marker object from any older path still gets a valid answer.
  function markerCategories(item) {
    const m = (item && item.categoryKey) ? item : HS.resolveMarker(item);
    const list = (m.categories && m.categories.length) ? m.categories : [m.categoryKey];
    return list.filter(function (k) { return !!CATEGORY_REGISTRY[k]; });
  }
  HS.categoryFilterKeys = CATEGORY_FILTER_KEYS.slice();
  HS.getCategoryFilters = function () { return categoryFilters; };
  HS.setCategoryFilter = function (key, on) {
    if (CATEGORY_FILTER_KEYS.indexOf(key) === -1) return categoryFilters;
    categoryFilters[key] = !!on;
    persistCategoryFilters();
    return categoryFilters;
  };
  HS.markerCategories = markerCategories;
  // ── REGULATORY IS AN OVERLAY ON TYPE, NOT A WAY PAST THE TYPE ROW ─────────
  // ⚖️ FOUNDER RULING 2026-09-15, after the same confusion was reported twice from live
  // ZIP pages (78617 Del Valle, 75009 Celina). A flat any-of over the membership set made
  // `facility` an EXISTENCE GRANT that outranked the Type dimension: with Data center the
  // only Type checked, 78617 drew 30 pins and 75009 drew 27, and NOT ONE of the 57 was a
  // data centre. They were EPA industrial records — concrete batch plants, an asphalt
  // plant, a cement terminal — admitted by `facility` while their own Industrial chip was
  // OFF, drawn with the Industrial triangle the resident had just unchecked. The Type row
  // said one thing and the map said another, which is why the regulatory switch read as
  // the control that hides data centres.
  //
  // THE RULE, and the three cases it is made of:
  //   1. A record with a classifiable TYPE is governed by its TYPE chip. Regulatory then
  //      controls its ANNOTATION only (HS.visibleSignal draws or drops the purple R), so
  //      "Regulatory OFF drops the R and leaves the Type pin" still holds exactly.
  //   2. A record with NO classifiable type (`categories` is ['facility'] alone — the
  //      standalone purple square) has no Type chip that could govern it, so regulatory
  //      is its ONLY governor, in every filter state. Without this limb the default
  //      all-types-on view would hide every unmapped EPA record, which is the #1121
  //      disappearing-pin defect reached from a third direction.
  //   3. When NO Type at all is selected, regulatory admits typed EPA records too. That
  //      is the founder's acceptance scenario — "turn OFF every Map 1 type except EPA" —
  //      an unambiguous request for the regulatory layer alone, and it is pinned by
  //      test/map1-dual-identity.browser.test.mjs §4. It is deliberately NOT extended to
  //      the partial case, because there the resident HAS an explicit Type selection on
  //      screen and case 3 would contradict it.
  //
  // ⛔ DO NOT restore the flat any-of. It is what produced both reports, and the membership
  // set is still `[typeKey, 'facility']` — unchanged, and still the thing that keeps ONE
  // record ONE marker. What changed is which dimension ADMITS it, never what it IS.
  // ⚖️ FOUNDER RULING 2026-09-15 (second, and it SUPERSEDES the three-case rule shipped
  // in #1218): REGULATORY IS ALWAYS AN INDEPENDENT VISUAL OVERLAY. It is not a Type, not a
  // Type filter, not a status filter over membership, and it may never remove, hide, count,
  // classify, suppress or render a base Type pin.
  //
  //   basePinVisible       = inCurrentLoadedGeographicView && matchesAtLeastOneSelectedType
  //   regulatoryOverlay    = basePinVisible && overlayEnabled && hasRegulatoryStatus
  //
  // So this function answers ONLY the second half of basePinVisible, and the regulatory
  // switch is not consulted here at all — `HS.visibleSignal` is the whole of the overlay.
  //
  // WHAT #1218 STILL HAD WRONG. It removed the flat any-of that let `facility` admit a
  // record under a Type the resident had unchecked, but it kept two limbs that still let
  // the switch decide a BASE PIN: an untyped regulatory record was visible only while the
  // switch was ON (so turning Regulatory OFF removed a base pin), and with no Type selected
  // the switch could bring typed EPA records back (so turning it ON created base pins).
  // Both are forbidden by the ruling above, and the first is a pin disappearing on a
  // regulatory toggle — the exact symptom.
  //
  // ⚠️ THE UNTYPED LIMB COST NOTHING TO REMOVE, and that was MEASURED, not assumed: all
  // 216,405 production facility records carry a mapped class field (industrial 154,512 ·
  // energy 37,281 · logistics 23,868 · datacenter 744), so `categories: ['facility']` alone
  // has an EMPTY production population. Were an untyped regulatory record ever ingested it
  // would have no base pin and therefore nothing to overlay — which is what the ruling
  // says, not a gap: regulatory annotates project pins, it never sources one.
  //
  // ⛔ DO NOT reintroduce the regulatory key here in any form. Membership stays
  // `[typeKey, 'facility']` — unchanged, still one record one marker — and `facility` stays
  // in CATEGORY_REGISTRY for the legend row and the overlay; it is simply never a reason to
  // draw or to withhold a pin.
  HS.categoryVisible = function (item) {
    const typeCats = markerCategories(item)
      .filter(function (k) { return !CATEGORY_REGISTRY[k].isFacility; });
    for (let i = 0; i < typeCats.length; i++) if (categoryFilters[typeCats[i]]) return true;
    return false;
  };
  HS.allCategoriesOff = function () {
    return CATEGORY_FILTER_KEYS.every(function (k) { return !categoryFilters[k]; });
  };
  HS.filterByCategory = function (items) { return (items || []).filter(HS.categoryVisible); };

  // ── THE TYPE ROW IS THE CATEGORY KEYS MINUS THE REGULATORY ONE ────────────
  // Presentation split only (see REGULATORY_LEGEND). `facility` remains a category key
  // and a filter membership; it is simply not a PROJECT TYPE, so a page building the
  // Type row — or asking "has the resident hidden every project type" — must not count
  // it. Generated from CATEGORY_REGISTRY, never hand-listed, so a category added there
  // lands in the Type row automatically and the regulatory row keeps exactly one member.
  const TYPE_FILTER_KEYS = PT.TYPE_FILTER_KEYS;   // derived in lib/project-type.js from the same registry
  HS.typeFilterKeys = TYPE_FILTER_KEYS.slice();

  // ── STABLE TYPE IDS — the same boundary vocabulary the stages have ────────────
  // Identical reasoning to STAGE_ID_BY_KEY above: the registry keys (`datacenter`,
  // `infrastructure`, `civic`, `other`) are IMPLEMENTATION names, while `?types=` is a
  // resident-facing, shareable contract. Keeping them apart is what lets a key be
  // renamed without invalidating shared links, and it is why the Type filter keys on an
  // id rather than on a chip's LABEL or its SHAPE — both are presentation.
  //
  // GENERATED from TYPE_FILTER_KEYS, never hand-listed, so a category added to
  // CATEGORY_REGISTRY without an id resolves to '' and is dropped by the URL reader
  // rather than silently filtering nothing.
  const TYPE_ID_BY_KEY = { datacenter: 'data_center', industrial: 'industrial',
                           residential: 'residential', infrastructure: 'roads_infrastructure',
                           commercial: 'commercial', civic: 'civic_public', other: 'other_project' };
  const TYPE_KEY_BY_ID = {};
  TYPE_FILTER_KEYS.forEach(function (k) {
    if (TYPE_ID_BY_KEY[k]) TYPE_KEY_BY_ID[TYPE_ID_BY_KEY[k]] = k;
  });
  HS.TYPE_ID_BY_KEY = TYPE_ID_BY_KEY;
  HS.typeIdForKey = function (k) { return TYPE_ID_BY_KEY[k] || ''; };
  HS.typeKeyForId = function (id) { return TYPE_KEY_BY_ID[String(id == null ? '' : id).trim()] || ''; };
  HS.regulatoryFilterKey = HS.REGULATORY_LEGEND.key;
  HS.allTypeCategoriesOff = function () {
    return TYPE_FILTER_KEYS.every(function (k) { return !categoryFilters[k]; });
  };
  HS.regulatoryVisible = function () { return !!categoryFilters[HS.REGULATORY_LEGEND.key]; };
  // The badge is REGULATORY CONTEXT, so the regulatory toggle owns it — and owns ONLY
  // it. With the toggle off a dual-identity record keeps its project symbol, its colour,
  // its Type membership and its Stage membership; the R simply is not drawn. That is the
  // whole difference between "hide a regulatory annotation" and "hide a project", and
  // routing every renderer through this one helper is what stops the two diverging.
  HS.visibleSignal = function (mk) {
    return (mk && mk.signal && HS.regulatoryVisible()) ? mk.signal : null;
  };

  // ── DATA CENTER SIGNIFICANCE (2026-09-06) ────────────────────────────────────
  // TYPE answers "what is this related to". SIGNIFICANCE answers "what KIND of
  // activity is this". They are different dimensions and this never changes the
  // first: a data centre stays `datacenter` and keeps its octagon whatever its
  // significance.
  //
  // WHAT THE EVIDENCE ACTUALLY IS. Measured over the whole shipped corpus (107
  // distinct records / 479 rows): `app_projects.size`, `.investment`, `.jobs`,
  // `.scope_text` and `.developer` are populated on **0 of 479 rows**. There is no
  // structured scale anywhere. Only two things exist:
  //   1. `type_raw` — the ISSUING AUTHORITY'S OWN permit class ("SIGN  PERMIT",
  //      "FP STATIONARY LEAD-ACID BATTERY SYSTEM", "NEW CONSTRUCTION"). This is the
  //      strongest signal available, because the jurisdiction assigned it.
  //   2. the record's own description text in `name`.
  // Explicit square footage appears in the name of **6 rows of 479**, so scale is
  // read where the source states it and NEVER inferred where it does not.
  //
  // ⚠️ ABSENCE IS NOT EVIDENCE. A record with no scale wording is `not stated`, never
  // "minor" — asserted in test/marker-datacenter-significance.test.mjs.
  //
  // ⚖️ REVISED 2026-09-06 after an adversarial competitor-CTO audit of 96eade0. The audit
  // found no false classification, and two resident-facing weaknesses:
  //   1. `Ancillary work` asserted MAGNITUDE ("minor") that no evidence establishes. A
  //      stationary-battery or fire-pump installation can be substantial. That label is
  //      GONE from the resident-facing surface; where the issuing authority names the
  //      activity, the resident now reads the activity.
  //   2. 16 records / 79 rows sat in the unknown bucket while their own authoritative
  //      wording deterministically established work on an EXISTING data centre. That is
  //      information HomeSignal held and discarded.
  // `Significance not stated` also became `Scope not stated by source`: the old wording
  // read as HomeSignal's finding rather than the source's silence.
  const SIGNIFICANCE = {
    major:      { key: 'major',      label: 'Major development' },
    existing:   { key: 'existing',   label: 'Work on existing data center' },
    supporting: { key: 'supporting', label: 'Supporting work' },
    unknown:    { key: 'unknown',    label: 'Scope not stated by source' }
  };
  HS.SIGNIFICANCE = SIGNIFICANCE;
  // A resident-facing name for the SUPPORTING activity, taken from the issuing authority's
  // own permit class. This is normalization of a government string, never interpretation:
  // each entry maps one enumerated class to the plain-English name of the same thing, and
  // says NOTHING about how big it is. ⚠️ "Supporting" describes the activity's RELATION to
  // the data centre — it never means small, minor or unimportant, and no label here may
  // imply that (asserted in test/marker-datacenter-significance.test.mjs).
  const SUPPORTING_ACTIVITY = [
    { re: /sign\s+permit/i,                             label: 'Sign permit' },
    { re: /fire\s+alarm/i,                              label: 'Fire-alarm permit' },
    { re: /fire\s+pump/i,                               label: 'Fire-pump permit' },
    { re: /lead[-\s]?acid\s+battery|battery\s+system/i, label: 'Battery-system permit' },
    { re: /vehicle\s+access\s+control/i,                label: 'Access-control permit' },
    { re: /fire\s+prevention\s+service\s+request/i,      label: 'Fire-prevention service request' }
  ];
  // The same, for the two records whose ACT is named in their own description rather than
  // in a permit class. Kept separate because a description is free text: only wordings
  // that name the act unambiguously appear here.
  const SUPPORTING_NAME_ACTIVITY = [
    { re: /roof\s+replacement/i, label: 'Roof replacement' },
    { re: /cooling\s+tower/i,    label: 'Cooling-tower work' },
    { re: /\bsign\s+permit\b/i,  label: 'Sign permit' }
  ];
  function supportingActivity(cls, nm) {
    for (let i = 0; i < SUPPORTING_ACTIVITY.length; i++) {
      if (SUPPORTING_ACTIVITY[i].re.test(cls)) {
        return { key: 'supporting', label: SUPPORTING_ACTIVITY[i].label };
      }
    }
    for (let j = 0; j < SUPPORTING_NAME_ACTIVITY.length; j++) {
      if (SUPPORTING_NAME_ACTIVITY[j].re.test(nm)) {
        return { key: 'supporting', label: SUPPORTING_NAME_ACTIVITY[j].label };
      }
    }
    return null;
  }
  // WORK ON AN EXISTING DATA CENTRE — the record's own class or words establish that the
  // subject is an existing building being altered, not a data centre being built. This is
  // the class the audit proved HomeSignal was discarding. It says nothing about magnitude:
  // a renovation may be large or small, and the label claims neither.
  const SIG_EXISTING_RE = /alterat|renovat|\binterior\b|tenant\s+improve|\bupfit\b|fit[-\s]?out|\bT\.?\s?I\.?\b/i;
  // MAJOR — the source states construction of a data centre building.
  const SIG_MAJOR_CLASS_RE = /new\s+construction|commercial\s*-\s*new|\bshell\b/i;
  const SIG_MAJOR_NAME_RE = /new\s+ground[\s-]?up|\bconstruct\s+(?:a\s+)?data\s*cent|to\s+construct[^.]{0,80}data\s*(?:cent|hall)|\bshell\s+data\s*(?:hall|cent)/i;
  // THE VETO, and it is load-bearing. "ADDITIONS/ALTERATIONS/REPAIRS Construct data
  // center and pump house renovations" reads as new construction in its free text while
  // the jurisdiction filed it as an alteration. THE SOURCE'S OWN CLASS OUTRANKS ITS FREE
  // TEXT — 2 production records turn on this exact conflict.
  //
  // `\bT\.?\s?I\.?\b` closes the audit's preventive finding: a permit class such as
  // `SHELL TI` or `TI - SHELL` describes TENANT IMPROVEMENT inside an existing shell, and
  // `shell` alone would otherwise have read it as major new construction. No such record
  // exists in today's 107-record corpus — this is hardening against the national corpus.
  const SIG_MAJOR_VETO_RE = /alterat|renovat|repair|addition|tenant|\bT\.?\s?I\.?\b/i;
  // `permit_class` is a SIGNIFICANCE-ONLY carrier for the source's own permit class.
  // It exists because HS.trackerSiteItem does not map `type_raw`, and adding type_raw
  // there would feed the FROZEN data-centre classifier a fifth evidence field and turn
  // 2 more production records into data centres on Map 1. Significance needs the permit
  // class; classification must not change. So the value travels under its own name and
  // is read HERE ONLY — asserted in test/marker-datacenter-significance.test.mjs.
  function dataCenterSignificance(item) {
    const nm = String((item && (item.name || item.title || item.label)) || '');
    const cls = String((item && (item.type_raw || item.permit_class)) || '');
    // EXPLICIT PRECEDENCE, most specific first. Ordering is a decision here, not an
    // accident of regex order:
    //   1. SUPPORTING ACTIVITY — the authority named the exact activity. Most specific,
    //      so it wins even when the record also says "TI" (`IRON MOUNTAIN SC-31 DATA HALL
    //      TI` is a fire-alarm permit, and "Fire-alarm permit" tells a resident more than
    //      "Work on existing data center").
    //   2. EXISTING-BUILDING WORK — alteration/renovation/interior/TI/upfit/fit-out. Runs
    //      BEFORE major so `SHELL TI` can never reach the major test, and so the two
    //      ADDITIONS/ALTERATIONS records land here instead of falling through to unknown.
    //   3. MAJOR NEW CONSTRUCTION, still subject to its own class veto.
    //   4. Source silence.
    // Verified against all 5 production major records: none matches (1) or (2), so this
    // ordering cannot steal a major verdict.
    const support = supportingActivity(cls, nm);
    if (support) return support;
    if (SIG_EXISTING_RE.test(cls) || SIG_EXISTING_RE.test(nm)) return SIGNIFICANCE.existing;
    const majorVetoed = SIG_MAJOR_VETO_RE.test(cls);
    if (!majorVetoed && (SIG_MAJOR_CLASS_RE.test(cls) || SIG_MAJOR_NAME_RE.test(nm))) return SIGNIFICANCE.major;
    return SIGNIFICANCE.unknown;
  }
  HS.dataCenterSignificance = dataCenterSignificance;

  function isFacilityItem(item) {
    return !!(item && (item._facility || item.record_kind === 'facility'));
  }
  function popupLabelFor(item, m) {
    const name = (item && (item.name || item.title || item.label)) || 'Project';
    const dist = (item && item.dist) ? ', ' + item.dist + (String(item.dist).indexOf('away') !== -1 ? '' : ' away') : '';
    // Dual identity, in the founder's order: what it IS first, the regulatory
    // signal second. Never "Regulated facility" alone — that would erase the
    // primary identity in the one line a resident actually reads.
    if (m.dualDataCenter) return name + ', ' + CATEGORY_REGISTRY.datacenter.label
      + ' · ' + CATEGORY_REGISTRY.facility.label + dist;
    // Overlay-on-Type: same order as dual identity — what it IS, then the
    // regulatory fact. "Regulated facility" alone would erase the Type the
    // founder just put back on the pin (DE-ANDA TRUCKING is Industrial, not
    // an anonymous purple square).
    if (m.overlayType) return name + ', ' + m.overlayType + ' · '
      + CATEGORY_REGISTRY.facility.label + dist;
    if (m.isFacility) return name + ', Regulated facility' + dist;
    const typePart = m.typeLabel || (item && item.type) || '';
    const statusPart = (item && item.status) ? ', ' + item.status : '';
    // Significance sits between TYPE and STATUS: what it is, what kind of activity,
    // then where it is in the process.
    const sigPart = (m.significanceApplies && m.significance) ? ', ' + m.significance.label : '';
    return name + (typePart ? ', ' + typePart : '') + sigPart + statusPart + dist;
  }
  // THE LIFECYCLE COLOUR, decided in ONE place for every marker. statusTier() is the
  // lifecycle decision; this only turns it into a hex (the stage palette, or the lifecycle
  // palette when a surface asks for colorMode:'lifecycle'). The facility branches below used
  // to skip statusTier and hard-code the operating green; they now read the same answer as
  // every other record, so a facility with no sourced lifecycle draws the `unknown` neutral.
  function lifecycleColour(st, item, opts) {
    let c = st.hex;
    if (opts.colorMode === 'lifecycle') {
      const b = opts.lifecycleBucket || (item && item.lifecycleBucket);
      const lhx = HS.LIFECYCLE_HEX;
      if (b && lhx[b]) c = lhx[b];
    }
    return c;
  }
  HS.resolveMarker = function (item, opts) {
    opts = opts || {};
    if (isFacilityItem(item)) {
      // LIFECYCLE IS NOT IDENTITY (2026-09-24). Being an EPA-registered facility says what
      // kind of RECORD this is; it says nothing about whether the facility is running. The
      // three branches below used to assert lifecycle:'operating' for every facility. They
      // now take the lifecycle from statusTier(item) — the ONE canonical decision — which
      // resolves a record with no sourced lifecycle to `unknown`. Shape, Type, the R badge,
      // categories, filter membership and significance are untouched.
      const st = statusTier(item);
      // ── DUAL IDENTITY (2026-09-06) ────────────────────────────────────────
      // A regulated facility whose OWN EPA-FRS record names a data centre is two
      // true things at once, and the founder-set product contract is that the
      // stronger of the two — what the thing IS — owns the primary symbol, while
      // the regulatory fact rides as a subordinate signal beneath it.
      //
      // The evidence bar is identical to the project classifier's: statedDataCenter
      // reads the record's own class fields and name, carries the street-name veto
      // and the incidental-reference guard, and asserts nothing a source did not
      // say. NO project join is performed and none is needed — the authoritative
      // regulatory record establishes the identity by itself (see the population
      // measurement in docs/maps-datacenter-dual-identity-2026-09-06.md).
      // The facility IDENTITY (dual data centre / Type overlay / plain) is decided ONCE, by
      // lib/project-type.js facilityIdentity — the same decision the ZIP page's facility
      // cards read. This branch only turns that answer into a marker.
      const fid = facilityIdentity(item);
      const dcFac = fid.kind === 'dual' ? fid.info : null;
      if (dcFac) {
        // The primary symbol takes the record's LIFECYCLE colour, never the facility
        // purple — purple is what the subordinate EPA square says, and letting it own the
        // whole pin would make the record read as "Regulated facility" exactly when the
        // contract says its primary identity is Data center. The lifecycle comes from
        // statusTier like every other pin: registration is not operation, so an FRS
        // record with no sourced lifecycle draws the `unknown` neutral, not operating green.
        const dcColor = lifecycleColour(st, item, opts);
        return {
          shape: CATEGORY_REGISTRY.datacenter.symbol,
          color: dcColor,
          categoryKey: 'datacenter',
          lifecycle: st.k,
          lifecycleLabel: st.label,
          fallbackReason: null,
          typeKey: 'datacenter',
          typeLabel: CATEGORY_REGISTRY.datacenter.label,
          statusKey: 'facility',
          statusLabel: CATEGORY_REGISTRY.facility.label,
          legendLabel: CATEGORY_REGISTRY.datacenter.label,
          shapeRule: 'DUAL:datacenter+facility',
          popupLabel: popupLabelFor(item, { isFacility: true, dualDataCenter: true }),
          filterKey: 'facility',
          // Filter MEMBERSHIP is a set; entity IDENTITY is the single categoryKey
          // above. Turning the EPA filter on is what makes this record QUALIFY to
          // be seen — it never rewrites what the record is.
          categories: ['datacenter', 'facility'],
          signals: ['facility'],
          // GATE 7: an EPA facility is not a development record. Its
          // significance is pinned to `unknown` and can never be major or ancillary —
          // facility identity says nothing about construction activity.
          significance: SIGNIFICANCE.unknown,
          significanceApplies: false,
          // `shape` is retained because it names the regulatory identity's symbol (the
          // standalone square a regulatory-only location draws); `letter` is what the
          // BADGE renders. Both point at the same fact, which is why the legend can teach
          // one language for the square and the R.
          signal: { key: 'facility', shape: CATEGORY_REGISTRY.facility.symbol,
                    color: FACILITY_HEX, letter: REGULATORY_BADGE_LETTER,
                    label: CATEGORY_REGISTRY.facility.label },
          isFacility: true,
          isDataCenter: true
        };
      }
      // Overlay-on-Type, GLOBAL: every Map 1 surface reads this resolver. A
      // classifiable EPA record (ANDURIL `layer:'industrial'`, DE-ANDA TRUCKING
      // `type:'logistics'` → Industrial) draws Type shape + lifecycle colour +
      // purple R. Membership includes the Type key so Regulatory OFF leaves the pin.
      const overlay = fid.kind === 'overlay' ? fid.info : null;
      if (overlay) {
        const overlayColor = lifecycleColour(st, item, opts);
        return {
          shape: overlay.shape,
          color: overlayColor,
          categoryKey: overlay.typeKey,
          lifecycle: st.k,
          lifecycleLabel: st.label,
          fallbackReason: null,
          typeKey: overlay.typeKey,
          typeLabel: overlay.legendLabel,
          statusKey: 'facility',
          statusLabel: CATEGORY_REGISTRY.facility.label,
          legendLabel: overlay.legendLabel,
          shapeRule: 'OVERLAY:' + overlay.shapeRule,
          popupLabel: popupLabelFor(item, { isFacility: true, overlayType: overlay.legendLabel }),
          filterKey: 'facility',
          categories: [overlay.typeKey, 'facility'],
          signals: ['facility'],
          significance: null,
          significanceApplies: false,
          signal: { key: 'facility', shape: CATEGORY_REGISTRY.facility.symbol,
                    color: FACILITY_HEX, letter: REGULATORY_BADGE_LETTER,
                    label: CATEGORY_REGISTRY.facility.label },
          isFacility: true,
          overlayOnType: true
        };
      }
      return {
        shape: CATEGORY_REGISTRY.facility.symbol,
        color: FACILITY_HEX,
        categoryKey: 'facility',
        lifecycle: st.k,
        lifecycleLabel: st.label,
        fallbackReason: null,
        typeKey: 'facility',
        typeLabel: CATEGORY_REGISTRY.facility.label,
        statusKey: 'facility',
        statusLabel: CATEGORY_REGISTRY.facility.label,
        legendLabel: CATEGORY_REGISTRY.facility.label,
        shapeRule: 'PRECEDENCE:facility-flag',
        popupLabel: popupLabelFor(item, { isFacility: true }),
        filterKey: 'facility',
        categories: ['facility'],
        signals: [],
        signal: null,
        significance: null,
        significanceApplies: false,
        isFacility: true
      };
    }
    const typeInfo = classifyProjectType(item);
    const st = statusTier(item);
    const color = lifecycleColour(st, item, opts);
    // `unknown` is its OWN filter bucket. It used to be folded into 'operating', which
    // both hid these records behind the "Operating now" toggle and asserted a lifecycle
    // the source never stated.
    const filterKey = st.k;
    const m = {
      categoryKey: typeInfo.typeKey,
      lifecycle: st.k,
      lifecycleLabel: st.label,
      fallbackReason: typeInfo.fallbackReason || null,
      shape: typeInfo.shape,
      color: color,
      typeKey: typeInfo.typeKey,
      typeLabel: typeInfo.typeLabel,
      statusKey: st.k,
      statusLabel: st.label,
      legendLabel: typeInfo.legendLabel,
      shapeRule: typeInfo.shapeRule || 'FALLBACK:other',
      popupLabel: popupLabelFor(item, { isFacility: false, typeLabel: typeInfo.typeLabel,
        significanceApplies: typeInfo.typeKey === 'datacenter',
        significance: typeInfo.typeKey === 'datacenter' ? dataCenterSignificance(item) : null }),
      filterKey: filterKey,
      // Every marker carries a membership SET so callers never have to special-case
      // the dual record. An ordinary project belongs to exactly one category.
      categories: [typeInfo.typeKey],
      signals: [],
      signal: null,
      // Data centres only. Every other category carries null, so this unit cannot
      // change what a resident reads on any other kind of record.
      significance: typeInfo.typeKey === 'datacenter' ? dataCenterSignificance(item) : null,
      significanceApplies: typeInfo.typeKey === 'datacenter',
      isFacility: false,
      // The decision plane travels ON the marker so every surface — 2D popup, 3D aerial,
      // 3D satellite, the rails, the property page — reads ONE resolved answer instead of
      // re-deriving it from the raw row. Note what is NOT here: nothing above reads
      // `decision`, so shape, colour, filterKey and categories are byte-for-byte what
      // they were. A decision annotates a pin; it never moves one.
      decision: HS.decisionOf(item),
      decisionEvidence: String((item && item.decision_evidence) || 'none'),
      isActiveUndecided: HS.isActiveUndecided(item)
    };
    return m;
  };
  // Normalize a development-tracker site row for resolveMarker (Approach B: canonical
  // type shape + facility override; lifecycle color via colorMode:'lifecycle').
  HS.trackerSiteItem = function (s, frsRidFn) {
    const rid = frsRidFn ? frsRidFn(s) : ((s && s.registry_id) || '');
    // LIFECYCLE, HONESTLY. The old form was
    //   type==='built' ? 'built' : type==='approved' ? 'approved' : 'proposed'
    // so ANY record the engine could not bucket silently became "Proposed", and a
    // TABS-style record stamped type='built' with no status evidence became a green
    // "Operating now" pin on this page while the app map showed it as "On file".
    // Now: an explicit engine bucket wins; a record with NO lifecycle evidence
    // (no bucket AND no status_raw) resolves to the first-class `unknown` state.
    // EVIDENCE ORDER: the engine's canonical `bucket` wins; failing that an EXPLICIT
    // lifecycle `type` (proposed|approved|built) counts; anything else — including a
    // blank/absent/unrecognised value — is `unknown`. The old code's trailing
    // `: 'proposed'` meant a record with NO lifecycle evidence at all was asserted to be
    // proposed, and a source that stamped `built` with no supporting status was asserted
    // to be operating. A source with nothing to say must leave the page saying nothing.
    const declared = String((s && s.bucket) || '').toLowerCase();
    // AN EPA FRS ELEMENT'S `type` IS NOT LIFECYCLE EVIDENCE (2026-09-24). get-address-report
    // stamped `type:'built'` on EVERY FRS facility regardless of anything FRS said — FRS
    // carries no lifecycle field, and registration is not operation — so the value was
    // manufactured and read here as "operating". The producer no longer emits it, but
    // development_reports caches keep the old stamp until each ZIP is re-collected, so it is
    // refused here on the element's own FRS registry id. Keyed on the ELEMENT, never on
    // frsRidFn: bucketOf() on the tracker deliberately passes an empty rid function.
    // Measured before this change: every cached FRS element carries type='built' and none
    // carries a `bucket`; no development element carries a registry_id. An explicit `bucket`
    // (a sourced lifecycle) is still honoured for any record, so a future source that
    // STATES a facility lifecycle flows through this same rule unchanged.
    const frsElement = !!(s && s.registry_id != null && String(s.registry_id).trim());
    const t = frsElement ? '' : String((s && s.type) || '').toLowerCase();
    const bucket = (declared === 'built' || declared === 'operating' || t === 'built' || t === 'operating') ? 'operating'
      : (declared === 'approved' || t === 'approved') ? 'approved'
      : (declared === 'proposed' || t === 'proposed') ? 'proposed'
      : 'unknown';
    return {
      type: (s && s.use_type) || '',
      use_type: s && s.use_type,
      layer: s && s.layer,
      status: bucket === 'operating' ? 'Operating'
            : bucket === 'approved' ? 'Approved'
            : bucket === 'proposed' ? 'Proposed' : 'Unknown',
      record_kind: rid ? 'facility' : undefined,
      _facility: !!rid,
      // Significance-only (see dataCenterSignificance). Deliberately NOT `type_raw`:
      // that name is read by the data-centre classifier and would widen it.
      permit_class: (s && (s.type_raw || s.permit_class)) || undefined,
      name: s && s.label,
      title: s && s.label,
      label: s && s.label,
      // DECISION HISTORY rides through UNCHANGED and never touches `bucket` above. That
      // separation is the contract: a denied application keeps the Proposed browsing
      // category (so a resident still finds it) and gains a sourced notation beside it.
      // If a future edit makes `bucket` read `decision`, a denied record silently leaves
      // the rail a resident searches — which is the defect this replaced.
      decision: (s && s.decision) || null,
      decision_evidence: (s && s.decision_evidence) || 'none',
      decided: !!(s && s.decided),
      lifecycleBucket: bucket
    };
  };
  HS.resolveTrackerMarker = function (s, frsRidFn) {
    const it = HS.trackerSiteItem(s, frsRidFn);
    return HS.resolveMarker(it, { colorMode: 'lifecycle', lifecycleBucket: it.lifecycleBucket });
  };
  HS.projectShape = function (it) { return HS.resolveMarker(it).shape; };
  HS.paintStatusLegend = function (root) {
    const el = root || document;
    (HS.STATUS_LEGEND_ROWS || []).forEach(function (row) {
      const node = el.getElementById ? el.getElementById(
        row.key === 'proposed' ? 'sttProposed' : row.key === 'approved' ? 'sttApproved'
          : row.key === 'operating' ? 'sttOperating' : row.key === 'facility' ? 'legFacility' : ''
      ) : null;
      if (!node) return;
      const sw = node.querySelector('.ld');
      if (sw) {
        sw.style.background = row.hex;
        if (row.squareSwatch) sw.style.borderRadius = '2px';
      }
    });
  };

  function polyPts(cx, cy, r, n, startDeg) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (startDeg + i * 360 / n) * Math.PI / 180;
      pts.push((cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2));
    }
    return pts.join(' ');
  }
  // Inner SVG geometry for a shape centered at (cx,cy) with radius r, filled + white outline.
  // Shared by the schematic diagram (absolute coords) and the tile-marker builder below.
  function shapeEl(shape, cx, cy, r, fill, strokeW) {
    const sw = strokeW == null ? 3 : strokeW;
    const common = 'fill="' + fill + '" stroke="#fff" stroke-width="' + sw + '" stroke-linejoin="round"';
    switch (shape) {
      case 'square':   return '<rect x="' + (cx - r) + '" y="' + (cy - r) + '" width="' + (2 * r) + '" height="' + (2 * r) + '" rx="' + (r * 0.3).toFixed(2) + '" ' + common + '/>';
      case 'triangle': return '<polygon points="' + polyPts(cx, cy, r * 1.16, 3, -90) + '" ' + common + '/>';
      case 'diamond':  return '<polygon points="' + polyPts(cx, cy, r * 1.28, 4, -90) + '" ' + common + '/>';
      case 'hexagon':  return '<polygon points="' + polyPts(cx, cy, r * 1.12, 6, -90) + '" ' + common + '/>';
      case 'pentagon': return '<polygon points="' + polyPts(cx, cy, r * 1.16, 5, -90) + '" ' + common + '/>';
      // Data center — octagon. Distinct from the facility square (see CATEGORY_REGISTRY).
      case 'octagon':  return '<polygon points="' + polyPts(cx, cy, r * 1.08, 8, -112.5) + '" ' + common + '/>';
      // Civic & public — a plus/cross, readable at 14px and unlike every other symbol.
      case 'cross': {
        const a = (r * 0.42).toFixed(2), b = r.toFixed(2);
        return '<polygon points="' + [
          [-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a], [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a]
        ].map(function (p) { return (cx + Number(p[0])).toFixed(2) + ',' + (cy + Number(p[1])).toFixed(2); }).join(' ') + '" ' + common + '/>';
      }
      // Other project — CAPSULE (a wide rounded bar). The residual bucket needs a
      // silhouette no resident can confuse with a classified one. It was a CIRCLE, and at
      // the 14px legend size a circle is 95% identical to the Data center OCTAGON
      // (silhouette distance 1-IoU ~ 5%): the two rendered as the same dot, so "pin
      // shape shows project type" was untrue for the single largest bucket. Every other
      // symbol is isotropic (roughly as tall as it is wide), so a 2.1:1 bar is the one
      // unoccupied silhouette family — it reads as different at a glance instead of by
      // counting corners. Measured worst-case separation from the other seven symbols is
      // ~36% (vs diamond), against ~8% for the weakest existing pair. It is a <rect>
      // like the facility square on purpose: same primitive, no new drawing machinery.
      // Pinned by test/maps-category-contract.test.mjs §13.
      case 'capsule': {
        const hw = r * 1.30, hh = r * 0.62;
        return '<rect x="' + (cx - hw).toFixed(2) + '" y="' + (cy - hh).toFixed(2)
          + '" width="' + (hw * 2).toFixed(2) + '" height="' + (hh * 2).toFixed(2)
          + '" rx="' + hh.toFixed(2) + '" ' + common + '/>';
      }
      case 'circle':
      default:         return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" ' + common + '/>';
    }
  }
  HS.shapeEl = shapeEl;
  // A standalone map-pin SVG (shape = type, fill = status color, optional white letter).
  // Used by BOTH tile engines (MapLibre + Leaflet div markers). The triangle's letter
  // nudges down so it sits inside the narrower apex.
  // `signal` (optional) = {shape, color, letter} drawn SUBORDINATE, as a small badge
  // ON the LOWER-RIGHT CORNER of the primary symbol. It is ONE marker carrying two
  // truths, not two markers — the primary symbol stays centred on (c,c), which is the
  // icon's anchor point, so the record keeps its exact coordinate and the badge
  // overflows the box (the svg is already `overflow:visible`). No offset is applied to
  // the primary and no second coordinate is invented.
  //
  // ── IT IS AN OVERLAY, NOT A SECOND PIN (founder, 2026-09-06) ──────────────
  // It was drawn CENTRED DIRECTLY BENEATH the primary symbol and carried no letter, and
  // both halves of that were wrong for what it has to say. Centred-beneath reads as a
  // second, smaller pin of the same family — the eye groups two stacked marks on one
  // axis as one object drawn twice, not as a mark and an annotation — and an unlettered
  // purple square says only "purple", which the legend then has to translate. Moving it
  // to a CORNER is what makes it read as a badge (the position no primary symbol
  // occupies), and the white capital R is what makes it self-describing at the moment a
  // resident looks at the pin rather than at the legend.
  //
  // Drawn AFTER the primary shape, so it is genuinely on top of it. Regulatory context
  // is an overlay on the project marker and must never replace the Type symbol: the
  // shape underneath it still answers "what is this", which is the whole contract.
  // ── THE WHITE HALO SCALES WITH THE MARK ──────────────────────────────────
  // It was a CONSTANT 3px at every size, and the marks are not one size: the legend
  // chips render at 14 and the 3D-satellite pins at 13-15, against 20 on the 2D map.
  // A centred 3px stroke eats 1.5px inward from the fill in every direction, so the
  // smaller the mark the more of it is white — measured as the share of the triangle
  // that is actually its COLOUR:
  //     size 13 -> 25%   size 14 -> 29%   size 15 -> 32%   size 20 -> 46%   size 26 -> 56%
  // At 29% a legend chip is mostly white with a tinted core, which compresses every
  // colour toward the background and is why two well-separated hexes could still read
  // as one swatch. Fixing the COLOURS could not fix that; the fill has to be visible
  // before its colour can be judged.
  //
  // Proportional stroke makes the fill share SIZE-INVARIANT (~57% at every size), so a
  // 14px chip and a 26px pin are the same drawing at different scales instead of two
  // different-looking marks. The cap keeps the largest marks byte-identical in effect
  // (26 * 0.115 = 2.99), so this is a change to SMALL marks only. The floor keeps a
  // real halo on the smallest ones — the halo is what separates a pin from map tiles,
  // and thinning it away would trade one legibility bug for another.
  // Pinned by test/lifecycle-color-separation.test.mjs §9.
  const HALO_RATIO = 0.115, HALO_MIN = 1.25, HALO_MAX = 3;
  HS.markerStroke = function (size) {
    return Math.max(HALO_MIN, Math.min(HALO_MAX, (size || 26) * HALO_RATIO));
  };
  // ── THE REGULATORY BADGE SCALES, WITH A FLOOR ────────────────────────────
  // Same reasoning as the halo above, for the same reason: the marks are not one size.
  // Map pins render at 12-15, legend chips at 14, the 2D map at up to 26. A badge that
  // scaled purely with the mark would carry a letter of ~4px on a 12px pin, which is a
  // smudge rather than an R — and a badge nobody can read is not a badge, it is noise
  // with a colour. The floor is what keeps the letter legible on the smallest pin; the
  // cap is what keeps the badge SUBORDINATE on the largest, which is the other half of
  // the founder's rule ("legible at normal map zoom, but visually secondary").
  //   size 12 -> 7.0   size 14 -> 7.0   size 20 -> 9.2   size 26 -> 12.0
  // The badge is strictly smaller than the primary symbol at every size (primary width
  // is size * 0.80), which is asserted rather than eyeballed — see
  // test/marker-dual-identity.test.mjs §19b and test/marker-regulatory-badge.test.mjs.
  const BADGE_RATIO = 0.46, BADGE_MIN = 7, BADGE_MAX = 12;
  HS.markerBadgeSize = function (size) {
    return Math.max(BADGE_MIN, Math.min(BADGE_MAX, (size || 26) * BADGE_RATIO));
  };
  // The badge itself: a rounded square (a badge silhouette, distinct from the standalone
  // regulatory SQUARE that marks a regulatory-only location) carrying one white capital.
  // Attribute order is x, y, width — pinned by the subordination assertion that reads the
  // rect's width straight out of the emitted markup.
  function badgeEl(cx, cy, half, color, letter, stroke) {
    let out = '<rect x="' + (cx - half).toFixed(2) + '" y="' + (cy - half).toFixed(2)
      + '" width="' + (half * 2).toFixed(2) + '" height="' + (half * 2).toFixed(2)
      + '" rx="' + (half * 0.40).toFixed(2) + '" fill="' + color
      + '" stroke="#fff" stroke-width="' + stroke.toFixed(2) + '"/>';
    if (letter) {
      out += '<text x="' + cx.toFixed(2) + '" y="' + cy.toFixed(2) + '" text-anchor="middle" '
        + 'dominant-baseline="central" font-family="sans-serif" font-weight="700" font-size="'
        + (half * 1.50).toFixed(1) + '" fill="#fff">' + letter + '</text>';
    }
    return out;
  }
  HS.badgeEl = badgeEl;
  HS.markerSVG = function (shape, color, label, size, signal) {
    size = size || 26;
    const c = size / 2, r = size * 0.40;
    const sw = HS.markerStroke(size);
    const dy = shape === 'triangle' ? size * 0.10 : 0;
    const txt = label ? '<text x="' + c + '" y="' + (c + dy) + '" text-anchor="middle" dominant-baseline="central" '
      + 'font-family="sans-serif" font-weight="700" font-size="' + (size * 0.44).toFixed(1) + '" fill="#fff">' + label + '</text>' : '';
    // Lower-right CORNER, consistently, at every size and under every primary symbol —
    // a badge that moved with the silhouette would stop being a fixed place to look.
    const bh = HS.markerBadgeSize(size) / 2;
    const sig = (signal && signal.color)
      ? badgeEl(c + r * 0.80, c + r * 0.80, bh, signal.color, signal.letter || '', Math.max(0.75, sw * 0.55))
      : '';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg" '
      + 'style="overflow:visible;filter:drop-shadow(0 1px 3px rgba(0,0,0,.4))">'
      + shapeEl(shape, c, c, r, color, sw) + txt + sig + '</svg>';
  };

  // ── Quality-of-Life lens (Sprint-1) ──────────────────────────────────────
  // The five resident-facing QoL dimensions. A project maps to a QoL category
  // ONLY when its own public-record impact_dimensions say so (by key or label) —
  // never inferred from the project type. So the QoL filter/section narrows to
  // records that actually flag the dimension; absent stays absent (anti-fabrication).
  HS.QOL = ['Air', 'Water', 'Soil', 'Noise', 'Light'];
  const QOL_KEYS = { air: 'Air', water: 'Water', soil: 'Soil', noise: 'Noise', light: 'Light' };
  HS.qolOf = function (it) {
    const out = {}, dims = (it && (it.impact_dimensions || it.impacts)) || [];
    dims.forEach(function (d) {
      const k = String((d && d.k) || '').toLowerCase(), lab = String((d && d.label) || '').toLowerCase();
      Object.keys(QOL_KEYS).forEach(function (q) {
        if (k === q || lab.indexOf(q) !== -1) out[QOL_KEYS[q]] = d;
      });
    });
    return out;   // { 'Air': dim, 'Water': dim, ... } — only dimensions on the record
  };

  // ── "What's Changed" derivation (Sprint 7) ────────────────────────────────
  // There is NO change-history store, so every entry is derived from a date the
  // record itself carries, and labeled as exactly that (the honest fallback):
  //   NEW     — a project whose county FILING date (submitted_at) is in-window
  //   HEARING — an UPCOMING public hearing matched to the project
  //   UPDATE  — an official notice/change record RECORDED (occurred_at) in-window
  // APPROVED / CONSTRUCTION badges would need status-TRANSITION history the data
  // doesn't carry (a current status says nothing about WHEN it changed), so they
  // are deliberately absent. Never fabricate a change event.
  // Pure + side-effect-free so test/recent-changes.test.mjs can pin every gate.
  HS.recentChanges = function (projects, changes, meetings, o) {
    o = o || {};
    const days = o.days != null ? o.days : 30;
    const now = o.now ? new Date(o.now) : new Date();
    const fmt = d => HS.fmtDate(d, { month: 'long', day: 'numeric' });
    function daysAgo(d) { const t = new Date(d); return isNaN(t) ? null : (now - t) / 86400000; }
    const out = [];
    (projects || []).forEach(function (p) {
      const badges = [], lines = [];
      let when = null;
      const ago = p.submitted_at != null ? daysAgo(p.submitted_at) : null;
      if (ago != null && ago >= 0 && ago <= days) {
        badges.push('NEW');
        lines.push('Filed with the county ' + fmt(p.submitted_at));
        when = p.submitted_at;
      }
      const mtg = (meetings || []).find(function (m) {
        return m.related_project_id === p.id && m.starts_at && new Date(m.starts_at) > now;
      });
      if (mtg) {
        badges.push('HEARING');
        lines.push('Public hearing ' + fmt(mtg.starts_at));
        if (!when) when = mtg.starts_at;
      }
      if (badges.length) out.push({ id: p.id, kind: 'project', badges: badges, lines: lines, when: when, hearing: !!mtg, item: p });
    });
    (changes || []).forEach(function (c) {
      if (c.quiet) return;
      const ago = c.occurred_at != null ? daysAgo(c.occurred_at) : null;
      if (ago == null || ago < 0 || ago > days) return;
      const lines = ['Recorded ' + fmt(c.occurred_at)];
      const closes = c.window_closes_at != null ? daysAgo(c.window_closes_at) : null;
      if (closes != null && closes <= 0) lines.push('Comment window closes ' + fmt(c.window_closes_at));
      out.push({ id: c.id, kind: 'change', badges: ['UPDATE'], lines: lines, when: c.occurred_at, hearing: false, item: c });
    });
    // Actionable first (upcoming hearings, soonest first), then newest first.
    return out.sort(function (a, b) {
      if (a.hearing !== b.hearing) return a.hearing ? -1 : 1;
      if (a.hearing && b.hearing) return String(a.when || '').localeCompare(String(b.when || ''));
      return String(b.when || '').localeCompare(String(a.when || ''));
    });
  };

  // The resident-home marker IS the HomeSignal logo mark (founder-specified):
  // the brand's green rounded tile with the white house glyph — same SVG as the
  // header logo in partials/shell.html. ONE builder, used by every map engine.
  const HOME_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:__SZ__px;height:__SZ__px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>';
  HS.homeMarkerHTML = function (size) {
    const inner = Math.round(size * 0.62);
    return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:' + Math.round(size * 0.28) + 'px;'
      + 'background:#157a49;border:2.5px solid #fff;box-shadow:0 0 0 5px rgba(21,122,73,.18),0 1px 4px rgba(0,0,0,.35);'
      + 'display:grid;place-items:center">' + HOME_GLYPH.replace(/__SZ__/g, inner) + '</div>';
  };

  // Popup body for the saved-address pin — says WHICH address is logged.
  // Shows only the address actually saved on the row (HS.homeAddressLine —
  // absent parts stay absent), used by every map engine that pops this marker.
  // Fix 9: never labeled "Your home". Prefer the street; "Saved place" is a
  // map-only fallback when no address line exists (not a management type).
  HS.homePopupHTML = function (p) {
    const line = HS.homeAddressLine ? HS.homeAddressLine(p) : ((p && p.address) || '');
    return '<div style="font:600 13px/1.3 var(--font)">' + HS.esc(line || 'Saved place') + '</div>'
      + '<div style="font-size:11px;color:#5a6b63;margin-top:2px">Address saved on your account</div>';
  };

  const MapProvider = {
    name: 'schematic',
    // render into `el`; returns [{letter,item,color}] in draw order for a synced pin list
    render(el, opts) {
      const { home, items = [], radiusMi = 1.5, showRadius = true, showHome = true, homeLabel = '', w = 780, h = 520, itemClick } = opts;
      const cx = w / 2, cy = h / 2, radiusPx = Math.min(w, h) * 0.29;
      const pxPerMile = radiusPx / radiusMi;
      const hLat = home ? home.lat : (items[0] && items[0].lat) || 0;
      const hLng = home ? home.lng : (items[0] && items[0].lng) || 0;
      const place = (lat, lng) => {
        const north = (lat - hLat) * 69;               // mi north
        const east = (lng - hLng) * 69 * Math.cos(hLat * Math.PI / 180); // mi east
        return { x: Math.max(20, Math.min(w - 20, cx + east * pxPerMile)),
                 y: Math.max(20, Math.min(h - 20, cy - north * pxPerMile)) };
      };
      const letters = 'ABCDEFGHIJKLMNOP';
      const shown = items.slice(0, letters.length);
      const pins = shown.map((it, i) => {
        const p = place(it.lat, it.lng), m = HS.resolveMarker(it);
        return { letter: letters[i], item: it, color: m.color, shape: m.shape, x: p.x, y: p.y };
      });
      // Flat neutral field only. The old decorative green/blue "landmass" and
      // "water" blobs and the crossing road-lines all sat at fixed positions
      // unrelated to the data or the radius ring, so they never shifted when the
      // radius changed — which read as fake. The home, pins, and radius ring
      // carry all the real information.
      const bg = `
        <rect width="${w}" height="${h}" fill="#e4eadd"/>`;
      const radius = showRadius ? `
        <circle cx="${cx}" cy="${cy}" r="${radiusPx}" fill="#157a49" fill-opacity="0.07" stroke="#157a49" stroke-opacity="0.35" stroke-dasharray="7 7"/>
        <text x="${cx}" y="${cy-radiusPx-6}" font-size="11" fill="#157a49" text-anchor="middle" font-family="sans-serif" opacity="0.8">${radiusMi} mi radius</text>` : '';
      // Only mark a REAL saved address; a centroid stand-in is never labeled as the
      // place in view. The mark is the HomeSignal LOGO (green rounded tile + white
      // house glyph), drawn LAST (class hs-home) so nearby pins/facilities never bury
      // it — the label gets a white halo so it stays readable over anything underneath.
      // Prefer the logged street when the caller passes homeLabel. "Saved place" is
      // a map-only fallback when no address is available. Fix 9: never "Your home".
      const homePinLabel = (showHome && homeLabel) ? HS.esc(homeLabel) : 'Saved place';
      const homeMark = showHome ? `
        <g class="hs-home"><rect x="${cx-14}" y="${cy-14}" width="28" height="28" rx="8" fill="#157a49" stroke="#fff" stroke-width="3"/>
        <g transform="translate(${cx-9},${cy-9.5}) scale(0.79)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></g>
        <text x="${cx}" y="${cy+34}" font-size="11.5" fill="#16211c" stroke="#fff" stroke-width="4" paint-order="stroke" text-anchor="middle" font-weight="700" font-family="sans-serif">${homePinLabel}</text></g>` : '';
      const pinSvg = pins.map((p, idx) => {
        const shape = p.shape;
        const dy = shape === 'triangle' ? 6.5 : 5;
        const click = itemClick ? (' data-hs-map-item="" tabindex="0" role="button" aria-label="' + HS.esc(HS.resolveMarker(p.item).popupLabel) + '"') : '';
        return `<g class="hspin"${click} data-pin-idx="${idx}">${shapeEl(shape, p.x, p.y, 15, p.color, 3)}
        <text x="${p.x}" y="${p.y + dy}" font-size="13" fill="#fff" text-anchor="middle" font-weight="700" font-family="sans-serif">${p.letter}</text></g>`;
      }).join('');
      el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${bg}${radius}${pinSvg}${homeMark}</svg>`;
      if (itemClick) {
        pins.forEach((p, idx) => {
          const g = el.querySelector('g[data-pin-idx="' + idx + '"]');
          if (!g) return;
          g.style.cursor = 'pointer';
          const go = function (e) { if (e) e.stopPropagation(); itemClick(p.item); };
          g.addEventListener('click', go);
          g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
        });
      }
      return pins;
    }
  };
  HS.MapProvider = MapProvider;

  // ---- shared real-tile helpers ----
  HS._circle = function (lat, lng, rMi) {
    const pts = [], R = rMi / 69.0, cs = Math.cos(lat * Math.PI / 180);
    for (let i = 0; i <= 64; i++) { const a = i / 64 * 2 * Math.PI; pts.push([lng + (R * Math.sin(a)) / cs, lat + R * Math.cos(a)]); }
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } }] };
  };
  HS._glSources = function () {
    return {
      sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri, Maxar' },
      osm: { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png', 'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png', 'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' }
    };
  };


  // ── PCM-2 · BOUNDARY PRIMITIVE ────────────────────────────────────────────────────────
  // A polygon a caller can DRAW, and optionally FIT the viewport to. It exists so that
  // "show me the whole of this geography" is expressed once, inside buildLive, for all
  // three engines — rather than by a caller poking at whichever map object onReady handed
  // back. That would not work anyway: Leaflet and MapLibre take fitBounds in OPPOSITE
  // coordinate orders, the caller cannot tell which engine it got, and onReady is never
  // fired on the schematic path at all. A caller-side fit would therefore be silently
  // wrong on one engine and silently absent on another.
  //
  // THIS IS THE PRIMITIVE, NOT THE READER. It takes GeoJSON the caller already holds in
  // WGS84. It fetches nothing. Stored ZCTA geometry is SRID 4269 (NAD83) and must be
  // transformed before it gets here; that transform belongs to whatever eventually reads
  // it, which does not exist yet.
  var BOUNDARY_TYPES = { Polygon: 1, MultiPolygon: 1 };
  var BOUNDARY_FIT_PADDING_PX = 24;
  var BOUNDARY_STROKE = '#157a49';

  // Normalize to a FeatureCollection of AREA geometry, or null. Point/LineString input
  // returns null rather than being drawn as if it were an area — fail closed, because the
  // caller that asked for a boundary and silently got none is the failure this guards.
  HS.boundaryFC = function (gj) {
    if (!gj || typeof gj !== 'object') return null;
    var feats = [];
    function addGeom(g) {
      if (g && BOUNDARY_TYPES[g.type]) feats.push({ type: 'Feature', properties: {}, geometry: g });
    }
    if (gj.type === 'FeatureCollection') (gj.features || []).forEach(function (f) { addGeom(f && f.geometry); });
    else if (gj.type === 'Feature') addGeom(gj.geometry);
    else addGeom(gj);
    return feats.length ? { type: 'FeatureCollection', features: feats } : null;
  };

  // The polygon's own extent. Walks nested coordinate arrays to whatever depth the geometry
  // has, so Polygon (with holes) and MultiPolygon (many parts) are the same code path.
  // Returns null when nothing finite was found — again, so an unusable boundary cannot
  // quietly become a viewport.
  HS.boundaryBounds = function (gj) {
    var south = Infinity, west = Infinity, north = -Infinity, east = -Infinity, seen = 0;
    function walk(c) {
      if (!c || typeof c !== 'object') return;
      if (typeof c[0] === 'number' && typeof c[1] === 'number') {
        var lng = c[0], lat = c[1];
        if (!isFinite(lng) || !isFinite(lat)) return;
        if (lng < west) west = lng;
        if (lng > east) east = lng;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
        seen++;
        return;
      }
      for (var i = 0; i < c.length; i++) walk(c[i]);
    }
    var fc = HS.boundaryFC(gj);
    if (!fc) return null;
    fc.features.forEach(function (f) { walk(f.geometry.coordinates); });
    return seen ? { south: south, west: west, north: north, east: east } : null;
  };

  // Lazily load Leaflet from jsDelivr (the no-WebGL raster engine). Shared by
  // maps.html and buildLive; healthy-WebGL visitors never fetch it.
  HS.loadLeaflet = function (cb) {
    if (window.L && window.L.map) return cb(true);
    if (HS.loadLeaflet._q) { HS.loadLeaflet._q.push(cb); return; }
    const q = HS.loadLeaflet._q = [cb];
    const css = document.createElement('link'); css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
    s.onload = function () { const ok = !!(window.L && window.L.map); HS.loadLeaflet._q = null; q.forEach(f => f(ok)); };
    s.onerror = function () { HS.loadLeaflet._q = null; q.forEach(f => f(false)); };
    document.head.appendChild(s);
  };

  // Compact guarded live map for previews (Dashboard). Full chain:
  // MapLibre GL (WebGL ok) -> Leaflet rasters (WebGL off / GL failed) -> schematic.
  // NEVER throws into the caller, and NEVER fabricates a home marker: the green
  // home dot renders only when o.home is a real resident home (caller-verified).
  HS.buildLive = function (el, o) {
    o = o || {};
    const items = (o.items || []).filter(it => it.lat != null && it.lng != null);
    // PCM-2. Both are null/false unless the caller opts in, so every expression below that
    // mentions them is inert by default and the existing Dashboard preview is untouched.
    const bFC = o.boundary ? HS.boundaryFC(o.boundary) : null;
    const bBounds = bFC ? HS.boundaryBounds(bFC) : null;
    const fitB = !!o.fitBoundary;
    const center = o.center
      || (o.home ? { lat: o.home.lat, lng: o.home.lng } : null)
      // The boundary's own midpoint, used ONLY as the constructor's starting camera before
      // fitBounds replaces it. It is never drawn and never labelled — the same "camera math,
      // never a point" rule lib/zip-authoritative.js states for the ZIP frame. Null without
      // a boundary, so this term does not exist on the default path.
      || (bBounds ? { lat: (bBounds.south + bBounds.north) / 2, lng: (bBounds.west + bBounds.east) / 2 } : null)
      || (items[0] ? { lat: items[0].lat, lng: items[0].lng } : null);

    // A REFUSAL IS A STATE, NOT A SILENCE. It clears the box, marks it so the page can tell,
    // and calls back — rather than drawing something else and letting it read as the answer.
    // No copy is invented here: what a resident should be told is the caller's decision.
    function refuse(reason) {
      try { el.innerHTML = ''; el.setAttribute('data-hs-map-refused', reason); } catch (e) {}
      if (typeof o.onRefuse === 'function') { try { o.onRefuse(reason); } catch (e) {} }
    }
    // fitBoundary with no usable polygon cannot be honoured by ANY engine. Falling back to
    // center+zoom would hand back a point view to a caller that asked for a whole geography
    // — the substitution this whole contract exists to prevent — so it is refused outright
    // rather than degraded. Inert unless fitBoundary was asked for.
    if (fitB && !bBounds) { refuse('fitBoundary-without-boundary'); return; }

    function schematic() {
      // THE SCHEMATIC REFUSES A BOUNDARY VIEW. It has no tiles, no projection and no
      // viewport: it lays pins out around a centre at a miles-per-pixel scale. Drawing the
      // ZIP there would mean falling back on `o.radiusMi || 1.5` — the Dashboard's
      // DECORATIVE ring, which is not in the RPC's radius allowlist and is not a data
      // radius — and a circle presented where a ZIP boundary was asked for is a fabricated
      // geography. Refusing is the honest outcome; degrading is not. Inert by default, so
      // every existing schematic fallback still renders exactly as it does today.
      if (bFC || fitB) { refuse('boundary-needs-tiles'); return; }
      try {
        MapProvider.render(el, { home: center, items: items, radiusMi: o.radiusMi || 1.5,
          showRadius: o.radiusMi != null, showHome: !!o.home, homeLabel: o.home ? (o.home.address || '') : '',
          w: o.w || 640, h: o.h || 300, itemClick: o.itemClick });
      } catch (e) { /* a dead preview box is better than a dead page */ }
    }
    if (!center) { schematic(); return; }
    function leaflet() {
      HS.loadLeaflet(function (ok) {
        if (!ok) { schematic(); return; }
        try {
          el.innerHTML = '';
          const m = L.map(el, { zoomSnap: 0.2, zoomControl: o.interactive !== false,
            dragging: o.interactive !== false, scrollWheelZoom: false });
          if (m.attributionControl) m.attributionControl.setPrefix(
            '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>');
          const t = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri, Maxar', maxZoom: 19 });
          let okTiles = 0, errs = 0, dead = false;
          function toSchematic() { if (dead) return; dead = true; try { m.remove(); } catch (e) {} schematic(); }
          t.on('tileload', function () { okTiles++; });
          t.on('tileerror', function () { if (++errs >= 4 && okTiles === 0) toSchematic(); });
          setTimeout(function () { if (okTiles === 0) toSchematic(); }, 8000);
          t.addTo(m);
          // The view is set BEFORE the boundary layer is added: Leaflet cannot project a
          // layer onto a map that has no view yet.
          if (fitB && bBounds) {
            m.fitBounds([[bBounds.south, bBounds.west], [bBounds.north, bBounds.east]],
              { padding: [BOUNDARY_FIT_PADDING_PX, BOUNDARY_FIT_PADDING_PX] });
          } else {
            m.setView([center.lat, center.lng], o.zoom || 12);
          }
          // Solid edge, deliberately unlike the radius ring's dashes: a ZIP boundary is a
          // real line on the ground, a radius is an approximation.
          if (bFC) L.geoJSON(bFC, { style: function () {
            return { color: BOUNDARY_STROKE, weight: 2, opacity: 0.75, fillColor: BOUNDARY_STROKE, fillOpacity: 0.07 };
          } }).addTo(m);
          if (o.radiusMi) L.circle([center.lat, center.lng], { radius: o.radiusMi * 1609.34,
            color: '#157a49', weight: 2, dashArray: '4 4', fillColor: '#157a49', fillOpacity: 0.08 }).addTo(m);
          const div = (html, size) => L.divIcon({ html: html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
          if (o.home) L.marker([o.home.lat, o.home.lng], { zIndexOffset: 1000, icon: div(HS.homeMarkerHTML(22), 22),
            title: (HS.homeAddressLine ? HS.homeAddressLine(o.home) : o.home.address) || 'Saved place' }).addTo(m);
          items.forEach(function (it) {
            // `spec`, deliberately NOT `m`. The outer `const m = L.map(el, …)` above is the
            // MAP; naming the marker spec `m` here shadowed it, so `mk.addTo(m)` below handed
            // the marker to a plain {shape,color,…} object. Leaflet's addTo calls
            // target.addLayer(layer), that object has none, so it threw — and this branch's
            // own `catch (e) { schematic(); }` discarded the entire Leaflet map and rendered
            // the schematic instead. Every call with at least one item, silently.
            // MapLibre's loop shadows the same way but calls `.addTo(map)`, which is why only
            // this engine was affected and why the fix is a rename rather than a restructure.
            const spec = HS.resolveMarker(it);
            const mk = L.marker([it.lat, it.lng], { icon: div('<div style="line-height:0"' + (o.itemClick ? ' data-hs-map-item="" tabindex="0" role="button"' : '') + '>' + HS.markerSVG(spec.shape, spec.color, '', 20) + '</div>', 20) });
            if (o.itemClick) {
              const go = function (e) { if (e && e.originalEvent) e.originalEvent.stopPropagation(); o.itemClick(it); };
              mk.on('click', go);
              const el = mk.getElement();
              if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
            }
            mk.addTo(m);   // the MAP
          });
          if (o.onReady) o.onReady(m);
          if (o.itemClick) {
            m.on('dragstart', function () { el._hsDragged = true; });
            m.on('dragend', function () { setTimeout(function () { el._hsDragged = false; }, 0); });
          }
        } catch (e) { schematic(); }
      });
    }
    if (!window.maplibregl) { leaflet(); return; }
    let map = null, degraded = false, ready = false, tilesOK = 0, tileErrs = 0;
    function degrade() {
      if (degraded) return; degraded = true;
      try { if (map) map.remove(); } catch (e) {}
      map = null; leaflet();
    }
    try {
      map = new maplibregl.Map({
        container: el,
        style: { version: 8, sources: HS._glSources(), layers: [{ id: 'sat', type: 'raster', source: 'sat' }] },
        center: [center.lng, center.lat], zoom: o.zoom || 12,
        interactive: o.interactive !== false, attributionControl: false
      });
    } catch (e) { degrade(); return; }   // WebGL unavailable (hardened browsers)
    map.on('error', function (ev) {
      const msg = ev && ev.error && String(ev.error.message || ev.error);
      if (msg && /webgl/i.test(msg)) { degrade(); return; }   // async WebGL failure
      if ((ev && ev.sourceId === 'sat') || (msg && /429|rate|tile|failed to fetch|network/i.test(msg))) {
        if (++tileErrs >= 4) degrade();
      }
    });
    map.on('data', function (ev) { if (ev && ev.tile && ev.sourceId === 'sat') tilesOK++; });
    setTimeout(function () { if (!ready && !degraded) degrade(); }, 9000);   // stalled load
    map.on('load', function () {
      ready = true;
      setTimeout(function () { if (!degraded && tilesOK === 0) degrade(); }, 8000);   // silent blank
      try {
        if (bFC) {
          map.addSource('hsb', { type: 'geojson', data: bFC });
          map.addLayer({ id: 'hsbf', type: 'fill', source: 'hsb', paint: { 'fill-color': BOUNDARY_STROKE, 'fill-opacity': 0.07 } });
          map.addLayer({ id: 'hsbl', type: 'line', source: 'hsb', paint: { 'line-color': BOUNDARY_STROKE, 'line-width': 2, 'line-opacity': 0.75 } });
        }
        // MapLibre takes [[west,south],[east,north]] — the OPPOSITE order to Leaflet's
        // [[south,west],[north,east]] above. That single difference is why the fit lives in
        // here and not in a caller that cannot tell the two engines apart.
        if (fitB && bBounds) {
          map.fitBounds([[bBounds.west, bBounds.south], [bBounds.east, bBounds.north]],
            { padding: BOUNDARY_FIT_PADDING_PX, duration: 0 });
        }
        if (o.radiusMi) {
          map.addSource('r', { type: 'geojson', data: HS._circle(center.lat, center.lng, o.radiusMi) });
          map.addLayer({ id: 'rf', type: 'fill', source: 'r', paint: { 'fill-color': '#157a49', 'fill-opacity': 0.08 } });
          map.addLayer({ id: 'rl', type: 'line', source: 'r', paint: { 'line-color': '#157a49', 'line-width': 2, 'line-opacity': 0.6, 'line-dasharray': [2, 2] } });
        }
        if (o.home) {   // ONLY a real resident home — never a centroid stand-in; on top of items
          const w = document.createElement('div');
          w.innerHTML = HS.homeMarkerHTML(22);
          const h = w.firstChild; h.style.zIndex = '5';
          h.title = (HS.homeAddressLine ? HS.homeAddressLine(o.home) : o.home.address) || 'Saved place';
          new maplibregl.Marker({ element: h }).setLngLat([o.home.lng, o.home.lat]).addTo(map);
        }
        items.forEach(function (it) {
          const m = HS.resolveMarker(it);
          const d = document.createElement('div');
          d.style.cssText = 'width:20px;height:20px;line-height:0' + (o.itemClick ? ';cursor:pointer' : '');
          if (o.itemClick) {
            d.setAttribute('data-hs-map-item', '');
            d.setAttribute('tabindex', '0');
            d.setAttribute('role', 'button');
            d.setAttribute('aria-label', m.popupLabel);
          }
          d.innerHTML = HS.markerSVG(m.shape, m.color, '', 20);
          if (o.itemClick) {
            const go = function (e) { e.stopPropagation(); o.itemClick(it); };
            d.addEventListener('click', go);
            d.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
          }
          new maplibregl.Marker({ element: d }).setLngLat([it.lng, it.lat]).addTo(map);
        });
        if (o.itemClick) {
          map.on('dragstart', function () { el._hsDragged = true; });
          map.on('dragend', function () { setTimeout(function () { el._hsDragged = false; }, 0); });
        }
        if (o.onReady) o.onReady(map);
      } catch (e) { degrade(); }
    });
  };
})();
