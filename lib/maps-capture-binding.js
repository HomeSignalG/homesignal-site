// maps-capture-binding.js — WHICH MAP IMAGE BELONGS TO WHICH DRAFT, and what state its
// capture is in. ONE definition, read by BOTH consumers:
//
//   • scripts/maps-social-image.mjs  — decides which drafts need a capture this run
//   • acquisition.html               — decides whether Approve may unlock
//
// A second copy of this rule is how the capture and the approval gate would come to
// disagree about whether the picture on screen is the picture this draft would publish,
// which is the one disagreement neither surface could detect on its own.
//
// ── WHY A BINDING KEY EXISTS AT ALL ──────────────────────────────────────────────────
// Before this, "has an image" was `image_bucket_path IS NOT NULL` and nothing more. The
// object path is `maps/<zip>/<project_id>.png` and the upload is `x-upsert`, so a row kept
// a non-null path forever — and the capture selector skipped any row that had one. A
// project whose coordinates moved, whose source re-typed it, or whose name changed kept
// the older picture indefinitely, with no field anywhere recording that the two had come
// apart. The key makes that detectable rather than invisible.
//
// ── WHAT IS IN THE KEY, AND WHY post_text IS NOT ─────────────────────────────────────
// The key carries exactly what decides WHAT THE PICTURE SHOWS. Map 1 is framed on the
// project's own coordinates, draws its marker with a shape from the project's type and a
// colour from its lifecycle status, opens that marker's popup (which prints the name), and
// — on a theme capture — leaves only that theme's PROJECT TYPE chip selected.
//
// `post_text` is deliberately ABSENT. homesignal-ingest's recompose-maps-drafts.mjs
// rewrites post_text through the shipped composer and touches nothing else; the wording of
// a sentence does not change a screenshot of a map. Including it would recapture every
// draft on every recompose — load with no truth behind it. The founder's requirement is
// that the image match the draft's INTENDED MAP VIEW, and this is that view's inputs.
//
// `theme` is included even though it is DERIVED from type/type_raw/name/status, because it
// is derived by lib/map.js — so a change to the shipped classifier moves the key too, and
// an image captured under the old classification stops counting as bound. That is correct:
// the chip state baked into the picture would no longer be the chip state the map draws.
//
// ── THE KEY IS A READABLE STRING, NOT A DIGEST ───────────────────────────────────────
// It is stored verbatim in evidence.visual.capture_key. A hash would need an
// implementation that matches byte-for-byte in Node and in the browser, and it would tell
// a reader nothing about WHY two keys differ. This repo's own rule — every stored value
// self-describing, never an opaque code — applies to a provenance field more than anywhere.
(function () {
  var HS = (typeof window !== 'undefined')
    ? (window.HS = window.HS || {})
    : (globalThis.HS = globalThis.HS || {});

  // ── THE FOUR STATES ────────────────────────────────────────────────────────────────
  // These are four DIFFERENT FACTS and the founder asked for them to stay four. Collapsing
  // any pair is how "we could not photograph this project" becomes readable as "this ZIP
  // has no data centres", which is a claim about the world made out of a capture failure.
  //
  //   WAITING    — eligible, and a capture is owed. Nothing has been attempted yet, or a
  //                bounded retry is still pending. NOT a statement about the project.
  //   READY      — a real capture exists AND is bound to this draft's current inputs.
  //   FAILED     — the capture was attempted and did not produce a truthful image. The
  //                project is real and eligible; our instrument did not work.
  //   INELIGIBLE — the project cannot be photographed on its ZIP page as things stand
  //                (it is not in the ZIP's authoritative development set, has no
  //                coordinates, or the live row has moved away from the draft). Still not
  //                a claim that no such project exists.
  //
  // READY keeps the historical literal `REAL_MAP_VISUAL` so rows written before this
  // module, and every reader that tests for it, keep working unchanged.
  var STATES = {
    WAITING: 'WAITING_CAPTURE',
    READY: 'REAL_MAP_VISUAL',
    FAILED: 'CAPTURE_FAILED',
    INELIGIBLE: 'CAPTURE_INELIGIBLE'
  };

  // Founder-facing copy per state. Written so that NO variant can be read as a finding
  // about the ZIP's development — each one names the instrument, not the world.
  var STATE_COPY = {
    WAITING_CAPTURE: 'Waiting for its Map 1 screenshot. Not yet attempted.',
    REAL_MAP_VISUAL: 'Real Map 1 screenshot, matching this draft.',
    CAPTURE_FAILED: 'The screenshot attempt did not produce a truthful image. '
      + 'This is a capture failure, not a finding about the ZIP.',
    CAPTURE_INELIGIBLE: 'This project cannot be photographed on its ZIP page yet. '
      + 'This is a capture limitation, not a finding about the ZIP.'
  };

  // ~1.1 m at the equator. The same precision scripts/maps-social-image.mjs uses to decide
  // that a drawn marker IS the project (COORD_EPS 1e-5), so the key moves exactly when the
  // capture's own identity test would stop matching — never before, never after.
  var COORD_DP = 5;

  function coord(v) {
    return (typeof v === 'number' && isFinite(v)) ? v.toFixed(COORD_DP) : '';
  }

  // A key field must never contain the separator, or two different drafts could produce one
  // string. Blanked rather than escaped: a project name with a pipe in it is vanishingly
  // rare and a missing name is a weaker key, never a wrong one.
  function part(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return s.indexOf('|') > -1 ? s.replace(/\|/g, '/') : s;
  }

  /**
   * The capture key for a MAPS draft, or null when the draft cannot be keyed at all.
   *
   * NULL IS NOT "unbound" — it means the row carries no project identity, so there is
   * nothing a picture could be bound TO. Callers treat null as "never bound", which keeps
   * the failure direction on the side of demanding a capture rather than accepting one.
   */
  HS.mapsCaptureKey = function (post) {
    if (!post || post.content_family !== 'MAPS') return null;
    var e = (post.evidence) || {};
    if (!e.project_id) return null;
    var theme = (typeof HS.mapsSocialThemeKey === 'function')
      ? HS.mapsSocialThemeKey(post)
      : null;
    var parts = [
      'v1',
      part(post.zip),
      part(e.project_id),
      part(e.source_key),
      coord(e.lat),
      coord(e.lng),
      part(e.type),
      part(e.type_raw),
      part(e.status),
      part(e.project_name),
      part(theme || '')
    ];
    // ── THE MAP-STATE POLICY RIDES IN THE KEY, FOR THE POSTS IT GOVERNS ONLY ────────
    // An image taken under an older Data Center map-state policy is a picture of a DIFFERENT
    // map state, so it must stop counting as this draft's image — which is what a key change
    // does, and it is why the object path (derived from the key) changes with it rather than
    // overwriting the superseded PNG.
    //
    // ⛔ IT IS APPENDED, NEVER A BUMPED PREFIX. An ordinary MAPS capture is governed by no
    // such policy and its picture is exactly as valid as it was, so its key must come out
    // BYTE-FOR-BYTE unchanged — a global 'v1' -> 'v2' would have invalidated all 37 of them
    // and sent the job to re-photograph work that was never in question.
    if (typeof HS.mapsDcCapturePolicyApplies === 'function'
        && HS.mapsDcCapturePolicyApplies(post) && HS.MAPS_DC_CAPTURE_POLICY) {
      parts.push(HS.MAPS_DC_CAPTURE_POLICY.key);
    }
    return parts.join('|');
  };

  /**
   * Is the stored image bound to what this draft is NOW?
   *
   * Requires all three: an image path, a stored key, and a stored key equal to the key this
   * draft computes today. A row whose visual predates this module has no stored key and is
   * therefore UNBOUND — deliberately, because nothing recorded what those pixels were of.
   */
  HS.mapsCaptureBound = function (post) {
    if (!post || !post.image_bucket_path) return false;
    var v = ((post.evidence) || {}).visual || {};
    if (!v.capture_key) return false;
    var now = HS.mapsCaptureKey(post);
    if (!now || v.capture_key !== now) return false;
    // ── A MATCHING KEY IS NOT ENOUGH FOR A POLICY-GOVERNED CAPTURE ───────────────
    // The key is a LABEL. It says which draft the picture was taken for and, now, under which
    // map-state policy — and a label can be written by anything that can write the row. What
    // makes a Data Center capture usable is the MEASURED state of the controls and of the drawn
    // layer, recorded at the shutter. Both are required, and the measurements are checked for
    // completeness and internal consistency, so a current-looking key sitting beside missing or
    // contradictory measurements reports NOT BOUND rather than unlocking approval.
    //
    // FAILS CLOSED ON A MISSING MODULE. If lib/maps-capture-policy.js did not load, this cannot
    // tell a Data Center post from an ordinary one, so it declares nothing bound. A gate that
    // assumes the best when its own rule is absent is not a gate — the same reasoning the
    // Acquisition Dashboard already applies to this module.
    if (typeof HS.mapsDcCapturePolicyApplies !== 'function'
        || typeof HS.mapsDcCapturePolicyEvidence !== 'function') return false;
    if (!HS.mapsDcCapturePolicyApplies(post)) return true;
    return HS.mapsDcCapturePolicyEvidence(v).ok === true;
  };

  /**
   * The state of this draft's capture, DERIVED from the row rather than trusted from it.
   *
   * The stored `state` is observability; this function is the authority. A row claiming
   * READY whose image is missing or whose key has moved reports WAITING here, so a stale
   * or hand-edited evidence blob cannot talk the approval gate into unlocking.
   */
  HS.mapsCaptureState = function (post) {
    if (!post) return STATES.WAITING;
    if (HS.mapsCaptureBound(post)) return STATES.READY;

    // ── AN ABSENCE POST IS INTRINSICALLY UNPHOTOGRAPHABLE, AND THAT IS ROW TRUTH ──────
    // ⚠️ THIS WAS THE THIRD DIVERGENT IMPLEMENTATION OF ONE QUESTION, and the only one
    // missing the carve-out its two siblings already had:
    //   homesignal-ingest bluesky/lib/maps-image-state.mjs -> NOT_REQUIRED for an absence
    //   lib/maps-capture-policy.js::mapsDcCapturePolicyApplies -> false for an absence
    //   THIS function -> fell through to WAITING
    // So an absence draft reported "AWAITING MAP CAPTURE · not yet attempted" on the
    // Acquisition Dashboard — a capture that will never happen and is not required —
    // until the capture worker happened to VISIT the row and stamp `evidence.visual`.
    // Measured 2026-09-21 on production: the two absence drafts the worker had reached
    // read CAPTURE_INELIGIBLE correctly, and sixteen it had not reached read AWAITING.
    // Identical rows, opposite answers, decided by whether another repo's job had run.
    //
    // 🔑 THE FIX IS TO DERIVE IT, NOT TO WAIT FOR THE STAMP. A post with no project has
    // nothing on the map to photograph; that is a fact about the ROW, knowable here and
    // now, and it must not depend on an out-of-band write to become true.
    //
    // FAILS CLOSED ON A MISSING MODULE, exactly as `mapsCaptureBound` above does: if
    // lib/maps-social-theme.js did not load we cannot tell an absence from a project post,
    // so we claim nothing and fall through to the stored-evidence reading below.
    if (typeof HS.mapsSocialIsAbsence === 'function' && HS.mapsSocialIsAbsence(post)) {
      return STATES.INELIGIBLE;
    }

    var v = ((post.evidence) || {}).visual || {};
    // An image that exists but is no longer bound is not a failure — it is a capture that
    // is owed again because the draft moved under it.
    if (post.image_bucket_path) return STATES.WAITING;
    if (v.state === STATES.INELIGIBLE || v.state === STATES.FAILED) return v.state;
    // Rows written before this module recorded only NO_PROJECT_SPECIFIC_VISUAL, which did
    // not distinguish the two. They read as FAILED: the weaker claim, and the one that
    // keeps them in the retry population rather than writing them off.
    if (v.status === 'NO_PROJECT_SPECIFIC_VISUAL') return STATES.FAILED;
    return STATES.WAITING;
  };

  /** Founder-facing sentence for a state. Never invents copy for an unknown value. */
  HS.mapsCaptureStateCopy = function (state) {
    return Object.prototype.hasOwnProperty.call(STATE_COPY, state) ? STATE_COPY[state] : '';
  };

  // ── BOUNDED RETRY ──────────────────────────────────────────────────────────────────
  // A recurring job whose selector means "everything not yet done" re-attempts every past
  // failure on every fire, forever. That is the uncontrolled load a schedule would
  // otherwise create — 40 imageless drafts becoming 40 browser navigations against
  // production every run — so the clock is part of the shared contract, not a private
  // detail of the runner.
  var RETRY = {
    MAX_ATTEMPTS: 3,
    BACKOFF_HOURS: [1, 4, 12],
    // INELIGIBLE is NOT terminal and must not be: the fact it rests on genuinely changes
    // when a ZIP's authoritative boundary completes or a source publishes coordinates. It
    // gets the long floor, so an unphotographable project costs one cheap RPC a day rather
    // than a browser session every fire.
    INELIGIBLE_RETRY_HOURS: 24
  };

  HS.mapsCaptureNextAttemptAt = function (attempts, nowMs) {
    var n = (typeof nowMs === 'number') ? nowMs : Date.now();
    var i = Math.max(1, attempts) - 1;
    var h = (i < RETRY.BACKOFF_HOURS.length)
      ? RETRY.BACKOFF_HOURS[i]
      : RETRY.BACKOFF_HOURS[RETRY.BACKOFF_HOURS.length - 1];
    return new Date(n + h * 3600 * 1000).toISOString();
  };

  /**
   * Does this draft need a capture right now? { due, skip }.
   *
   * ONE predicate, called by the capture job and testable offline, so "which drafts does a
   * run touch" is never two implementations. `skip` names the reason so a run can report
   * "already bound" separately from "waiting out a backoff" separately from "past its
   * attempt budget" — three different healths that a single number would blur.
   *
   * `opts.ignoreClock` is the `--ids` path: an operator naming a row has already decided.
   * It never bypasses the binding check, because a bound row genuinely needs no picture.
   */
  HS.mapsCaptureDue = function (post, nowMs, opts) {
    var now = (typeof nowMs === 'number') ? nowMs : Date.now();
    if (HS.mapsCaptureBound(post)) return { due: false, skip: 'bound' };
    var v = ((post && post.evidence) || {}).visual || {};
    if (opts && opts.ignoreClock) return { due: true, skip: null };
    // A BACKOFF IS A VERDICT ABOUT THE INPUTS IT WAS SET AGAINST. If the draft's key has
    // moved since the refusal, the thing that failed is not the thing being asked now, so
    // waiting out the remaining hours would be waiting on a stale answer. A key change
    // releases the clock. (`attempted_key` absent = a row written before this module; it
    // falls through to the clock, which is the conservative direction.)
    var keyMoved = !!v.attempted_key && v.attempted_key !== HS.mapsCaptureKey(post);
    if (!keyMoved && v.next_attempt_at && Date.parse(v.next_attempt_at) > now) {
      return { due: false, skip: (v.attempts || 0) >= RETRY.MAX_ATTEMPTS ? 'exhausted' : 'backoff' };
    }
    return { due: true, skip: null };
  };

  HS.MAPS_CAPTURE_STATES = STATES;
  HS.MAPS_CAPTURE_STATE_COPY = STATE_COPY;
  HS.MAPS_CAPTURE_RETRY = RETRY;
}());
