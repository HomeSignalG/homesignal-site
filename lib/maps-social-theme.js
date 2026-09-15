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
  var THEMES = [{ key: 'datacenter', label: 'Data Center Theme' }];

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
   * The theme key for a social_posts row, or null.
   * Returns null for anything that is not a MAPS development candidate, and null (never a
   * guess) if the map backbone is not loaded on this page.
   */
  HS.mapsSocialThemeKey = function (post) {
    if (!post || post.content_family !== 'MAPS') return null;
    if (post.tile !== 'development') return null;
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
