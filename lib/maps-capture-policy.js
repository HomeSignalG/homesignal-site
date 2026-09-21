// maps-capture-policy.js — THE MAP STATE A MAPS · DATA CENTER THEME SCREENSHOT MUST SHOW.
//
// ONE definition, read by THREE consumers, for the same reason lib/maps-capture-binding.js
// exists as one module:
//
//   • scripts/maps-social-image.mjs  — injects the page half into the throwaway browser and
//                                      drives the REAL controls with it
//   • lib/maps-capture-binding.js    — refuses to call a capture "bound" unless the policy
//                                      evidence on the row is complete and compliant
//   • acquisition.html               — the Approve gate reads that same boundness
//
// ── WHAT WENT WRONG, AND WHY A POLICY OBJECT IS THE FIX ──────────────────────────────
// The capture used to put ONE of Map 1's THREE filter dimensions into a known state. It
// set the PROJECT TYPE row to Data-center-only and said nothing at all about STATUS or
// about the REGULATORY overlay — so the picture published whatever those two happened to
// be when the page finished loading.
//
// Measured on the shipped Mesa draft (85212, captured 2026-09-20T20:47:37.227Z): the stored
// evidence carries `type_filter_before` and `type_filter_after` that are BYTE-IDENTICAL —
// `datacenter:true` and six falses in both — which is not what a fresh page looks like. The
// page's category filter persists in `sessionStorage` (lib/map.js `hs.map.categoryFilters`)
// and the capture job reuses ONE browser context for every draft in a run, so that "before"
// is the PREVIOUS draft's leftover state, not the product's default. The same blind spot in
// the other direction is what left `Regulatory facilities` checked in the published card.
//
// A screenshot of a filter panel is a CLAIM ABOUT WHICH RECORDS ARE ON SCREEN. Three
// dimensions decide that, so all three have to be stated, applied and measured — a policy
// that names one of them is not a weaker policy, it is an unstated one.
//
// ── WHY IT IS VERSIONED, AND WHY THE VERSION RIDES IN THE BINDING KEY ────────────────
// An image taken under an older policy is not "slightly stale", it is a picture of a
// DIFFERENT map state. Nothing in the pixels says which policy produced it, so the row has
// to: the version string goes into the capture key (binding), and the MEASURED control
// states go into `evidence.visual.capture_policy` beside it. A key that matches while the
// measurements are missing, incomplete or contradictory is treated as NOT BOUND — the label
// alone never unlocks anything.
//
// ⚠️ THIS PROVES WHAT THE CONTROLS SAID, NOT WHAT THE PNG CONTAINS. There is no digest of
// the pixels here and none is claimed. What the evidence attests is that the capture read
// the real controls back, immediately before the shutter, and found them in the required
// state — and that the shipped visibility predicate agreed about what was on the map at
// that moment. Anyone with write access to the row can write a compliant-looking blob; the
// defence against that is RLS and the approval function, not this file.
(function () {
  var HS = (typeof window !== 'undefined')
    ? (window.HS = window.HS || {})
    : (globalThis.HS = globalThis.HS || {});

  // The theme this policy belongs to. Taken as a literal ONCE, here, because this module is
  // the one place that has to name it; everywhere else asks HS.mapsSocialThemeKey.
  var DC_THEME = 'datacenter';

  // ── THE POLICY ───────────────────────────────────────────────────────────────────────
  // `statuses` is the COMPLETE set of Map 1 lifecycle controls this policy understands, and
  // it is compared for EQUALITY against what the page renders — not for containment. A page
  // that grows a fifth status is a page this policy has never been reasoned about, so the
  // capture fails closed rather than photographing a control it cannot name.
  var POLICY = {
    id: 'dc-map-state',
    version: 1,
    key: 'dc-map-state@1',
    theme: DC_THEME,
    statuses: ['operating', 'approved', 'proposed', 'unknown'],
    type: DC_THEME,          // the ONE PROJECT TYPE left selected
    regulatory: false        // the REGULATORY RECORDS overlay, OFF
  };
  HS.MAPS_DC_CAPTURE_POLICY = POLICY;

  /**
   * Does this policy govern this draft's capture?
   *
   * PROJECT-BACKED DATA CENTER THEME POSTS ONLY. Both halves are the EXISTING predicates:
   * membership is HS.mapsSocialThemeKey (Map 1's own classifier) and the absence carve-out
   * is HS.mapsSocialIsAbsence. No keyword matching is introduced here — grep this file for
   * "data cent" and you will find it only in prose, exactly as lib/maps-social-theme.js
   * promises.
   *
   * An ABSENCE post has no project, so there is no marker to isolate and no map state to
   * photograph. It is outside the policy, and that is what keeps its existing behaviour —
   * the honest "no filings here" answer — untouched.
   */
  HS.mapsDcCapturePolicyApplies = function (post) {
    if (!post || post.content_family !== 'MAPS') return false;
    // ⚠️ AN ABSENCE POST STAYS UNGOVERNED HERE, AND THAT IS NOT A HOLE. Under the "every
    // post gets a map" ruling it now RECEIVES a ZIP-scope capture, and `capture()` applies
    // and PROVES this policy before writing that image — its theme is `datacenter`, so it
    // takes the same path. What it is exempt from is the APPROVAL gate: #1277 records that
    // absence posts are approvable today, and making a failed capture block them would add
    // a blocker the ruling did not ask for. Proven when the picture is made, not re-gated
    // when the founder approves it.
    if (typeof HS.mapsSocialIsAbsence === 'function' && HS.mapsSocialIsAbsence(post)) return false;
    var e = (post.evidence) || {};
    // ── DERIVED **OR** STAMPED, AND THE UNION IS DELIBERATE ──────────────────────────
    // The browser derives membership live from Map 1's own classifier
    // (HS.mapsSocialThemeKey). The SERVER guard cannot: SQL has no classifier, so it reads
    // `evidence.theme`, the stamp homesignal-ingest's generate-maps.mjs writes from a
    // byte-verbatim port of the same rule (bluesky/lib/maps-datacenter.mjs, parity-tested
    // over a production cohort). The two therefore agree by construction — but "by
    // construction" is an argument, not a guarantee, so this predicate takes the UNION.
    //
    // WHY THE UNION AND NOT THE INTERSECTION: it makes the CLIENT's governed set a
    // SUPERSET of the server's, so there is no row the server would police and the
    // dashboard would wave through. The failure direction stays "Approve is blocked and a
    // capture is owed", which is the safe one. The intersection would have made the client
    // the laxer of the two, which is the whole failure this guard exists to remove.
    var derived = (typeof HS.mapsSocialThemeKey === 'function') ? HS.mapsSocialThemeKey(post) : null;
    var stamped = (e.theme === DC_THEME) && !!e.project_id;
    if (derived !== DC_THEME && !stamped) return false;
    return true;
  };

  // ── EVIDENCE VALIDATION ──────────────────────────────────────────────────────────────
  // Every branch returns a NAMED problem rather than a bare false, because the dashboard
  // prints these to the founder and "the image is stale" and "the project moved" are
  // different sentences that must not be substituted for one another.

  function boolMapEquals(got, wantKeys, wantValueFor) {
    if (!got || typeof got !== 'object' || Array.isArray(got)) return 'not an object';
    var gotKeys = Object.keys(got).sort();
    var want = wantKeys.slice().sort();
    if (gotKeys.length !== want.length) return 'has ' + gotKeys.length + ' controls, policy names ' + want.length;
    for (var i = 0; i < want.length; i++) {
      if (gotKeys[i] !== want[i]) return 'names "' + gotKeys[i] + '" where the policy names "' + want[i] + '"';
    }
    for (var j = 0; j < want.length; j++) {
      var k = want[j], v = got[k], expect = wantValueFor(k);
      if (typeof v !== 'boolean') return '"' + k + '" is not a measured boolean';
      if (v !== expect) return '"' + k + '" was ' + v + ', policy requires ' + expect;
    }
    return null;
  }

  /**
   * Is one measured snapshot of the three dimensions compliant? Returns a problem string or
   * null. `typeKeys` is the set of PROJECT TYPE controls the page actually rendered — it is
   * carried in the evidence rather than hardcoded, because the Type row is generated from
   * CATEGORY_REGISTRY and legitimately grows.
   */
  function snapshotProblem(snap, label) {
    if (!snap || typeof snap !== 'object') return label + ' is missing';
    var st = boolMapEquals(snap.statuses, POLICY.statuses, function () { return true; });
    if (st) return label + ' STATUS ' + st;
    if (!snap.types || typeof snap.types !== 'object' || Array.isArray(snap.types)) return label + ' PROJECT TYPE is missing';
    var typeKeys = Object.keys(snap.types);
    if (typeKeys.indexOf(POLICY.type) === -1) return label + ' has no "' + POLICY.type + '" PROJECT TYPE control';
    if (typeKeys.length < 2) return label + ' recorded only ' + typeKeys.length + ' PROJECT TYPE control(s)';
    var ty = boolMapEquals(snap.types, typeKeys, function (k) { return k === POLICY.type; });
    if (ty) return label + ' PROJECT TYPE ' + ty;
    if (typeof snap.regulatory !== 'boolean') return label + ' REGULATORY state was not measured';
    if (snap.regulatory !== POLICY.regulatory) return label + ' REGULATORY was ' + snap.regulatory
      + ', policy requires ' + POLICY.regulatory;
    return null;
  }

  function sameSnapshot(a, b) {
    try { return JSON.stringify([a.statuses, a.types, a.regulatory]) === JSON.stringify([b.statuses, b.types, b.regulatory]); }
    catch (e) { return false; }
  }

  /**
   * Validate a row's stored `evidence.visual.capture_policy`.
   *
   * Returns { ok, legacy, problems[] }. `legacy` distinguishes "this predates the policy"
   * from "this claims the policy and fails it", because those deserve different copy: the
   * first is our change invalidating an old picture, the second is a contradiction.
   */
  HS.mapsDcCapturePolicyEvidence = function (visual) {
    var cp = visual && visual.capture_policy;
    if (!cp || typeof cp !== 'object' || Array.isArray(cp)) {
      return { ok: false, legacy: true, problems: [
        'the stored screenshot records no capture_policy, so nothing says which map state it shows'] };
    }
    var problems = [];
    if (cp.policy !== POLICY.key) {
      problems.push('captured under map-state policy "' + String(cp.policy)
        + '"; the current policy is "' + POLICY.key + '"');
    }
    // BOTH snapshots are required. `applied` is what the controls read back once the filter
    // settled; `final` is what they read immediately before the shutter, AFTER framing and
    // after the popup opened. Framing calls setView and opening a popup can re-enter the
    // page's own handlers, so a single early reading would not be evidence about the image.
    var pa = snapshotProblem(cp.applied, 'the applied control state');
    if (pa) problems.push(pa);
    var pf = snapshotProblem(cp.final, 'the control state at the shutter');
    if (pf) problems.push(pf);
    if (!pa && !pf && !sameSnapshot(cp.applied, cp.final)) {
      problems.push('the control state changed between applying the filter and the shutter');
    }
    var r = cp.rendered;
    if (!r || typeof r !== 'object') {
      problems.push('the rendered map was not measured, so the controls are the only claim');
    } else {
      // ⚠️ SCOPE DECIDES WHETHER THERE IS A TARGET AT ALL. A ZIP-scope capture is the map
      // of the ZIP itself — the picture every post gets when no single project can be pinned
      // (an absence post, or a post whose record Map 1 does not place). There is no target to
      // draw, so demanding one would refuse the very capture that exists to give those posts
      // a map. Every OTHER requirement is unchanged: the three control dimensions are still
      // applied and proven, and the three zero-counts below still prove the filter took.
      if (cp.scope !== 'zip' && r.target_on_map !== true) {
        problems.push('the target project was not measured as drawn on the map');
      }
      if (r.non_datacenter_development_on_map !== 0) {
        problems.push('the map still drew ' + r.non_datacenter_development_on_map
          + ' non-data-centre development marker(s)');
      }
      if (r.regulatory_only_on_map !== 0) {
        problems.push('the map still drew ' + r.regulatory_only_on_map + ' regulatory-only marker(s)');
      }
      if (r.regulatory_badges_drawn !== 0) {
        problems.push('the map still drew ' + r.regulatory_badges_drawn
          + ' regulatory badge(s) while the overlay is required off');
      }
    }
    return { ok: problems.length === 0, legacy: false, problems: problems };
  };

  /**
   * One founder-facing sentence for why a stored capture does not satisfy the policy.
   * ⚠️ It never says the PROJECT changed — that is a different fact with a different fix,
   * and conflating them sends the reader to look for a data problem that is not there.
   */
  HS.mapsDcCapturePolicyCopy = function (visual) {
    var v = HS.mapsDcCapturePolicyEvidence(visual);
    if (v.ok) return '';
    if (v.legacy) {
      return 'The stored screenshot was taken before the Data Center map-state policy '
        + '(' + POLICY.key + ') existed, so nothing records which STATUS, PROJECT TYPE and '
        + 'REGULATORY controls it shows. The draft details have NOT changed; the picture is '
        + 'awaiting a re-capture under the current policy.';
    }
    return 'The stored screenshot does not satisfy the Data Center map-state policy ('
      + POLICY.key + '): ' + v.problems.join('; ') + '. The draft details have NOT changed; '
      + 'the picture is awaiting a re-capture.';
  };

  // ── THE PAGE HALF ────────────────────────────────────────────────────────────────────
  // Everything below runs INSIDE the captured browser. It is written as plain functions on
  // HS so the capture job and the browser test call the SAME code — a test that re-typed
  // this manoeuvre would pass while production stayed broken, which is precisely what the
  // previous browser suite did.
  //
  // It touches nothing but the page's own controls: `.checked` plus a `change` event, which
  // is what the page wires (setStage / setType / setRegulatory -> applyFilter). No marker
  // array is edited, no filter object is written, and no default or stored preference is
  // changed to prepare a shot.

  function readControls() {
    var out = { statuses: {}, types: {}, regulatory: null, problems: [] };
    var stageChips = Array.prototype.slice.call(document.querySelectorAll('#mapkey .stagechip'));
    var typeChips = Array.prototype.slice.call(document.querySelectorAll('#mapkeyShapes .typechip'));
    var regBoxes = Array.prototype.slice.call(document.querySelectorAll('#regToggleBox'));
    if (!stageChips.length) out.problems.push('Map 1 rendered no STATUS controls');
    if (!typeChips.length) out.problems.push('Map 1 rendered no PROJECT TYPE controls');
    if (regBoxes.length !== 1) out.problems.push('Map 1 rendered ' + regBoxes.length + ' regulatory controls, expected exactly 1');
    var seen;
    seen = {};
    stageChips.forEach(function (c) {
      var k = c.getAttribute('data-stage'), b = c.querySelector('.stagebox');
      if (!k) { out.problems.push('a STATUS control carries no data-stage'); return; }
      if (seen[k]) { out.problems.push('duplicate STATUS control "' + k + '"'); return; }
      seen[k] = 1;
      if (!b) { out.problems.push('STATUS control "' + k + '" has no checkbox'); return; }
      out.statuses[k] = !!b.checked;
    });
    seen = {};
    typeChips.forEach(function (c) {
      var k = c.getAttribute('data-cat'), b = c.querySelector('.chipbox');
      if (!k) { out.problems.push('a PROJECT TYPE control carries no data-cat'); return; }
      if (seen[k]) { out.problems.push('duplicate PROJECT TYPE control "' + k + '"'); return; }
      seen[k] = 1;
      if (!b) { out.problems.push('PROJECT TYPE control "' + k + '" has no checkbox'); return; }
      out.types[k] = !!b.checked;
    });
    if (regBoxes.length === 1) out.regulatory = !!regBoxes[0].checked;
    return out;
  }
  HS.mapsDcCaptureReadControls = readControls;

  /**
   * What the map is ACTUALLY DRAWING right now, measured through the SHIPPED predicates.
   *
   * ⚠️ `window.siteMarkers` IS NOT THE VISIBLE SET — Map 1's applyFilter() leaves every
   * marker in that array and only adds it to or removes it from the Leaflet layer group, so
   * array membership is byte-identical before and after filtering. ON THE MAP is `m._map`,
   * which Leaflet nulls on removeLayer, and that is what every count here reads.
   */
  function readRendered(targetKey) {
    var list = window.siteMarkers || [];
    var out = {
      on_map_total: 0, target_on_map: false, target_found: false,
      non_datacenter_development_on_map: 0, regulatory_only_on_map: 0,
      regulatory_badges_drawn: 0, dual_identity_target: false,
      offenders: []
    };
    var DC = 'datacenter';
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (!x || !x.s) continue;
      var ref = x.s.zip_project_ref || x.s.source_id || null;
      var isTarget = !!targetKey && ref === targetKey;
      if (isTarget) out.target_found = true;
      var onMap = !!(x.m && x.m._map);
      if (!onMap) continue;
      out.on_map_total++;
      var mk = x.mk || x.s;
      var cats = (HS.markerCategories ? HS.markerCategories(mk) : []) || [];
      var typeCats = [];
      for (var c = 0; c < cats.length; c++) {
        if (cats[c] !== HS.REGULATORY_LEGEND.key) typeCats.push(cats[c]);
      }
      if (isTarget) {
        out.target_on_map = true;
        out.dual_identity_target = cats.indexOf(HS.REGULATORY_LEGEND.key) > -1 && typeCats.indexOf(DC) > -1;
      }
      // A DEVELOPMENT marker that is not in the Data center bucket must not be on screen.
      if (typeCats.length && typeCats.indexOf(DC) === -1) {
        out.non_datacenter_development_on_map++;
        if (out.offenders.length < 5) out.offenders.push({ ref: ref, cats: cats.slice(0, 4), why: 'non-datacenter type' });
      }
      // A record whose ONLY membership is regulatory has no project identity at all.
      if (!typeCats.length) {
        out.regulatory_only_on_map++;
        if (out.offenders.length < 5) out.offenders.push({ ref: ref, cats: cats.slice(0, 4), why: 'regulatory-only' });
      }
      // THE BADGE, read off the DRAWN ELEMENT rather than inferred from the switch. A
      // dual-identity data centre stays on the map through its development identity; what
      // must follow the overlay's off state is its purple R. Two independent readings: the
      // shipped predicate, and the marker's own rendered markup.
      var sig = (HS.visibleSignal ? HS.visibleSignal(mk) : (mk && mk.signal)) || null;
      var el = x.m && x.m.getElement ? x.m.getElement() : null;
      var markup = (el && el.innerHTML) || '';
      var painted = !!(mk && mk.signal && mk.signal.color && markup.indexOf(mk.signal.color) > -1);
      if (sig || painted) {
        out.regulatory_badges_drawn++;
        if (out.offenders.length < 5) out.offenders.push({ ref: ref, cats: cats.slice(0, 4), why: 'regulatory badge drawn' });
      }
    }
    return out;
  }
  HS.mapsDcCaptureReadRendered = readRendered;

  function targetSnapshot() {
    var c = readControls();
    return { statuses: c.statuses, types: c.types, regulatory: c.regulatory, problems: c.problems };
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /**
   * Wait for a condition, bounded. Returns true when it held, false on timeout.
   * CONDITION-BASED, never a fixed sleep: a sleep that happens to be long enough today is
   * not evidence the page was ready, and it is the shape of check that stops working
   * silently on a slower runner.
   */
  async function waitFor(fn, timeoutMs, pollMs) {
    var deadline = Date.now() + timeoutMs;
    for (;;) {
      var v = false;
      try { v = !!fn(); } catch (e) { v = false; }
      if (v) return true;
      if (Date.now() > deadline) return false;
      await sleep(pollMs || 100);
    }
  }

  /**
   * Put Map 1 into the Data Center Theme capture state, through the real controls, and
   * measure the result. Resolves { ok, reason, applied, final, rendered }.
   *
   * FAILS CLOSED at every step. A missing or duplicated control, a status set the policy
   * does not name, a change handler that does not produce the required state, a map that
   * will not settle, or a target that is no longer drawn — each returns ok:false with a
   * reason. None of them produces an image.
   */
  HS.mapsDcCaptureApplyPolicy = async function (opts) {
    var o = opts || {};
    var targetKey = o.targetKey || null;
    var readyMs = o.readyMs || 30000;
    var settleMs = o.settleMs || 20000;

    // 1 ── READINESS. The controls AND the map, not merely the document.
    var ready = await waitFor(function () {
      var c = readControls();
      return !c.problems.length
        && Object.keys(c.statuses).length > 0
        && Object.keys(c.types).length > 0
        && c.regulatory !== null
        && Array.isArray(window.siteMarkers);
    }, readyMs, 150);
    var c0 = readControls();
    if (!ready) {
      return { ok: false, reason: 'Map 1 controls were not ready within ' + readyMs + 'ms'
        + (c0.problems.length ? ' (' + c0.problems.join('; ') + ')' : ''), before: targetSnapshot() };
    }

    // 2 ── THE STATUS SET MUST BE THE ONE THIS POLICY WAS REASONED ABOUT. Equality, not
    // containment: a page that gained a fifth lifecycle control is a page whose capture
    // state nobody has decided, and photographing it anyway would ship an unreviewed claim.
    var gotStatuses = Object.keys(c0.statuses).sort();
    var wantStatuses = POLICY.statuses.slice().sort();
    if (gotStatuses.join(',') !== wantStatuses.join(',')) {
      return { ok: false, before: targetSnapshot(),
        reason: 'Map 1 renders STATUS controls [' + gotStatuses.join(', ') + '] but policy '
          + POLICY.key + ' is defined for [' + wantStatuses.join(', ') + ']' };
    }
    if (!Object.prototype.hasOwnProperty.call(c0.types, POLICY.type)) {
      return { ok: false, before: targetSnapshot(),
        reason: 'Map 1 has no "' + POLICY.type + '" PROJECT TYPE control' };
    }

    var before = targetSnapshot();

    // 3 ── DRIVE THE REAL CONTROLS. `change`, not `click`: the page wires change precisely
    // so keyboard and pointer are one path, and its handler reads the control's RESULTING
    // state. Only controls that are in the wrong state are touched, so a no-op run dispatches
    // nothing and cannot churn the map.
    var dispatched = { statuses: 0, types: 0, regulatory: 0 };
    POLICY.statuses.forEach(function (k) {
      var chip = document.querySelector('#mapkey .stagechip[data-stage="' + k + '"]');
      var b = chip && chip.querySelector('.stagebox');
      if (b && b.checked !== true) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); dispatched.statuses++; }
    });
    Object.keys(c0.types).forEach(function (k) {
      var chip = document.querySelector('#mapkeyShapes .typechip[data-cat="' + k + '"]');
      var b = chip && chip.querySelector('.chipbox');
      var want = (k === POLICY.type);
      if (b && b.checked !== want) { b.checked = want; b.dispatchEvent(new Event('change', { bubbles: true })); dispatched.types++; }
    });
    var regBox = document.getElementById('regToggleBox');
    if (regBox && regBox.checked !== POLICY.regulatory) {
      regBox.checked = POLICY.regulatory;
      regBox.dispatchEvent(new Event('change', { bubbles: true }));
      dispatched.regulatory++;
    }

    // 4 ── WAIT FOR THE RESULT, not for a duration. The controls must read back compliant
    // AND the drawn set must stop moving, twice in a row, before anything is measured.
    var lastCount = -1, stable = 0;
    var settled = await waitFor(function () {
      var snap = targetSnapshot();
      if (snapshotProblem(snap, 'x')) { stable = 0; lastCount = -1; return false; }
      var n = (window.siteMarkers || []).filter(function (x) { return x && x.m && x.m._map; }).length;
      if (n === lastCount) stable++; else { stable = 0; lastCount = n; }
      return stable >= 2;
    }, settleMs, 120);

    var applied = targetSnapshot();
    var problem = snapshotProblem(applied, 'the applied control state');
    if (problem) {
      return { ok: false, before: before, applied: applied, dispatched: dispatched,
        reason: 'a change handler did not produce the required state — ' + problem };
    }
    if (!settled) {
      return { ok: false, before: before, applied: applied, dispatched: dispatched,
        reason: 'the map did not settle within ' + settleMs + 'ms after the filter was applied' };
    }

    var rendered = readRendered(targetKey);
    if (targetKey && !rendered.target_on_map) {
      return { ok: false, before: before, applied: applied, rendered: rendered, dispatched: dispatched,
        reason: rendered.target_found
          ? 'the target project is drawn on this ZIP but is NOT shown under policy ' + POLICY.key
          : 'the target project has no marker on this ZIP under policy ' + POLICY.key };
    }
    return { ok: true, before: before, applied: applied, rendered: rendered, dispatched: dispatched };
  };

  /**
   * RE-READ EVERYTHING AT THE SHUTTER. Called after framing and after the popup is opened,
   * because both re-enter the page (setView, openPopup) and a reading taken before them is
   * not a statement about the image. Returns { ok, reason, final, rendered }.
   */
  HS.mapsDcCaptureVerifyAtShutter = function (targetKey) {
    var final = targetSnapshot();
    var problem = snapshotProblem(final, 'the control state at the shutter');
    if (problem) return { ok: false, reason: problem, final: final };
    var rendered = readRendered(targetKey);
    if (targetKey && !rendered.target_on_map) {
      return { ok: false, reason: 'the target project is no longer drawn at the shutter', final: final, rendered: rendered };
    }
    if (rendered.non_datacenter_development_on_map !== 0) {
      return { ok: false, final: final, rendered: rendered,
        reason: rendered.non_datacenter_development_on_map + ' non-data-centre development marker(s) are on the map at the shutter' };
    }
    if (rendered.regulatory_only_on_map !== 0) {
      return { ok: false, final: final, rendered: rendered,
        reason: rendered.regulatory_only_on_map + ' regulatory-only marker(s) are on the map at the shutter' };
    }
    if (rendered.regulatory_badges_drawn !== 0) {
      return { ok: false, final: final, rendered: rendered,
        reason: rendered.regulatory_badges_drawn + ' regulatory badge(s) are drawn while the overlay is required off' };
    }
    return { ok: true, final: final, rendered: rendered };
  };

  /** Assemble the stored record. ONE builder, so the writer and the validator agree. */
  HS.mapsDcCapturePolicyRecord = function (applyResult, verifyResult) {
    return {
      policy: POLICY.key,
      // 'project' = framed and haloed on one record; 'zip' = the ZIP's own map, no target.
      // Stamped from what the capture ACTUALLY did, so a ZIP map can never be read back as
      // evidence that a particular project was shown.
      scope: (verifyResult && verifyResult.scope) || (applyResult && applyResult.scope) || 'project',
      applied: {
        statuses: applyResult.applied.statuses,
        types: applyResult.applied.types,
        regulatory: applyResult.applied.regulatory
      },
      final: {
        statuses: verifyResult.final.statuses,
        types: verifyResult.final.types,
        regulatory: verifyResult.final.regulatory
      },
      // The state the page was in BEFORE the policy was applied. Recorded, never asserted:
      // it is how a reader can tell a genuinely fresh page from a contaminated context.
      observed_before: applyResult.before,
      controls_changed: applyResult.dispatched,
      rendered: {
        target_on_map: verifyResult.rendered.target_on_map,
        on_map_total: verifyResult.rendered.on_map_total,
        non_datacenter_development_on_map: verifyResult.rendered.non_datacenter_development_on_map,
        regulatory_only_on_map: verifyResult.rendered.regulatory_only_on_map,
        regulatory_badges_drawn: verifyResult.rendered.regulatory_badges_drawn,
        dual_identity_target: verifyResult.rendered.dual_identity_target
      },
      note: 'Every value here was read back off Map 1\'s OWN controls and its OWN drawn '
        + 'layer — the STATUS chips, the PROJECT TYPE chips and the REGULATORY checkbox were '
        + 'set by dispatching a change event on each control, which runs the page\'s '
        + 'setStage/setType/setRegulatory and its applyFilter. It attests what the controls '
        + 'and the shipped visibility predicate said at the shutter. It is NOT a digest of '
        + 'the PNG and proves nothing about the pixels.'
    };
  };
}());
