// maps-social-theme.js — MAPS Bluesky THEME membership for the Acquisition Dashboard.
//
// ⚠️ THIS FILE CONTAINS NO DATA-CENTRE VOCABULARY, AND THAT IS THE POINT. Theme
// membership is decided by `HS.resolveMarker` — the ONE shipped Map 1 classifier
// (lib/map.js) that also decides the marker's shape and which PROJECT TYPE filter bucket
// it belongs to. Grep this file for "data cent" and you will find it only in prose.
//
// WHY MEMBERSHIP MUST BE MAP 1'S OWN ANSWER, not a separate rule:
// a MAPS · Data Center Theme post's image is a screenshot of Map 1 with the "Data center"
// PROJECT TYPE chip selected and the other types deselected. If the queue's notion of
// "Data center" were narrower than the map's, the capture would filter out the very
// marker the post is about; if it were wider, the queue would carry posts whose marker
// the chip does not show. One classifier removes both failures by construction.
//
// INPUT IS IMMUTABLE CANDIDATE-TIME EVIDENCE. `social_posts.evidence` is stamped when the
// candidate is written (homesignal-ingest bluesky/generate-maps.mjs) and never edited, so
// a row's theme cannot drift because a source later re-typed the project. Only the
// DERIVATION happens at read time, which is what keeps the dashboard and the map in step.
//
// NO SCHEMA. There is no `theme` column and none is needed: every field this reads is
// already on the row.
(function () {
  var HS = (typeof window !== 'undefined')
    ? (window.HS = window.HS || {})
    : (globalThis.HS = globalThis.HS || {});

  // The themes this dashboard offers, in display order. `all` is not a theme — it is the
  // absence of a filter — and is handled by the caller so it can never be mistaken for a
  // membership test.
  var THEMES = [{ key: 'datacenter', label: 'Data Center' }];

  /**
   * Build the resolver input from a social_posts row's evidence.
   *
   * record_kind is pinned to 'development' rather than read, because `tile` is checked
   * first: a MAPS candidate is development by construction (generate-maps.mjs gate 1), and
   * a facility must never be able to reach the marker resolver's facility branch from
   * here — an EPA-registered site is not a project with a lifecycle and has no place in a
   * "planned near you" queue.
   */
  function markerItemFor(post) {
    var e = (post && post.evidence) || {};
    return {
      record_kind: 'development',
      type: e.type,
      type_raw: e.type_raw,
      name: e.project_name,
      status: e.status
    };
  }

  /**
   * Is this row an ABSENCE post — the campaign's "no qualifying filing was found" answer?
   *
   * TWO CONDITIONS, BOTH REQUIRED, because this predicate is what lets a row bypass the
   * marker derivation and it must never be reachable by a record-bearing post. A stamped
   * `theme_answer` on a row that DOES carry a project is a contradiction, and the safe
   * reading of a contradiction is "not an absence".
   */
  function isAbsence(post) {
    var e = (post && post.evidence) || {};
    return e.theme_answer === 'none_found' && !e.project_id;
  }

  /**
   * Exported because the Approve gate needs it: a Data Center Theme post normally REQUIRES
   * the real Map 1 screenshot, and an absence post can never have one — there is no
   * project to photograph. Without this the honest "no filings here" answer would be
   * permanently unapprovable.
   */
  HS.mapsSocialIsAbsence = function (post) {
    if (!post || post.content_family !== 'MAPS') return false;
    if (post.tile !== 'development') return false;
    return isAbsence(post);
  };

  /**
   * The theme key for a social_posts row, or null.
   * Returns null for anything that is not a MAPS development candidate, and null (never a
   * guess) if the map backbone is not loaded on this page.
   */
  HS.mapsSocialThemeKey = function (post) {
    if (!post || post.content_family !== 'MAPS') return null;
    if (post.tile !== 'development') return null;

    // ── THE ABSENCE CASE, AND WHY IT READS A STAMP WHERE NOTHING ELSE MAY ──────────────
    // Everything below this block derives membership from Map 1's own classifier, and that
    // stays true: the rule is "a RECORD's membership is the map's answer, never ours".
    //
    // An absence post carries NO RECORD. It exists precisely because the classifier found
    // nothing, so there is no marker to resolve and `markerItemFor` would hand the resolver
    // an object with every field undefined. That is not a classification question the map
    // can answer, and asking it anyway returns null — which is how these rows became
    // INVISIBLE to the dashboard: the ZIP showed no "Draft exists" badge, the theme chip
    // was absent, and the sub-nav count omitted them, while the row sat in the queue.
    //
    // So the stamp is read ONLY here, and only after `isAbsence` has established there is
    // no project to classify. It is still not a second classifier: nothing is matched, and
    // an unrecognised stamp yields null rather than a new theme.
    if (isAbsence(post)) {
      var stamped = ((post && post.evidence) || {}).theme;
      for (var a = 0; a < THEMES.length; a++) if (THEMES[a].key === stamped) return THEMES[a].key;
      return null;
    }

    if (typeof HS.resolveMarker !== 'function') return null;
    var m;
    try { m = HS.resolveMarker(markerItemFor(post)); } catch (err) { return null; }
    if (!m) return null;
    // `categories` is the filter MEMBERSHIP set — the same set the PROJECT TYPE chips
    // read — so this asks exactly "would the Data center chip show this marker?".
    // `typeKey` is the fallback for a resolver result that predates the membership set.
    var cats = m.categories || (m.typeKey ? [m.typeKey] : []);
    for (var i = 0; i < THEMES.length; i++) {
      if (cats.indexOf(THEMES[i].key) > -1) return THEMES[i].key;
    }
    return null;
  };

  /** Display label for a theme key, or null. Never invents a label for an unknown key. */
  HS.mapsSocialThemeLabel = function (key) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].key === key) return THEMES[i].label;
    return null;
  };

  HS.MAPS_SOCIAL_THEMES = THEMES;

  /**
   * Partition a queue into the theme buckets the sub-nav offers.
   *
   * THE COUNTS AND THE ROWS COME OUT OF THIS ONE CALL, so a count can never disagree with
   * what the founder sees listed. Returns { all: [...], byTheme: { datacenter: [...] } }.
   */
  HS.mapsSocialThemeBuckets = function (rows) {
    var all = [];
    var byTheme = {};
    for (var t = 0; t < THEMES.length; t++) byTheme[THEMES[t].key] = [];
    var list = rows || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || p.content_family !== 'MAPS') continue;
      all.push(p);
      var k = HS.mapsSocialThemeKey(p);
      if (k && byTheme[k]) byTheme[k].push(p);
    }
    return { all: all, byTheme: byTheme };
  };
}());
