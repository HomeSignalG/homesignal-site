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
   * THE CANONICAL MAP 1 DEVELOPMENT TYPE of a social_posts row — a CATEGORY_REGISTRY key
   * (`datacenter`, `industrial`, `residential`, `commercial`, `infrastructure`, `civic`,
   * `other`) — or null.
   *
   * This is the ONE Type answer every MAPS consumer reads: the Acquisition Dashboard's theme
   * buckets (below), the capture job's `evidence.visual.type_key` stamp, and through that stamp
   * the Bluesky custom feeds' TYPE membership (homesignal-ingest public.bsky_feed_skeleton). It
   * is `HS.resolveMarker(...).typeKey` — the same call that picks the marker's shape and its
   * PROJECT TYPE filter bucket on Map 1 — so it cannot hold an opinion Map 1 does not.
   *
   * It is NOT data-centre-specific and knows no type by name: a new CATEGORY_REGISTRY entry
   * becomes a Type here, in the dashboard and in the feeds with no edit to this file.
   *
   * An ABSENCE post carries no record, so there is nothing to resolve. Its Type is the Type it
   * answers — the stamped theme — accepted ONLY when that stamp is itself a registry key (never
   * matched, never inferred), and never the facility overlay, which is not a development Type.
   */
  HS.mapsSocialTypeKey = function (post) {
    if (!post || post.content_family !== 'MAPS') return null;
    if (post.tile !== 'development') return null;
    if (isAbsence(post)) {
      var stamped = ((post && post.evidence) || {}).theme;
      var c = (typeof HS.categoryFor === 'function') ? HS.categoryFor(stamped) : null;
      return (c && !c.isFacility && c.key === stamped) ? stamped : null;
    }
    if (typeof HS.resolveMarker !== 'function') return null;
    var m;
    try { m = HS.resolveMarker(markerItemFor(post)); } catch (err) { return null; }
    return (m && m.typeKey) ? m.typeKey : null;
  };

  /** Display label for a canonical Type key (Map 1's own legend label), or null. */
  HS.mapsSocialTypeLabel = function (key) {
    var c = (typeof HS.categoryFor === 'function') ? HS.categoryFor(key) : null;
    return (c && !c.isFacility) ? c.label : null;
  };

  /**
   * Why this row's canonical Type cannot be recorded, or null when it can. Pure.
   *
   * The capture job refuses a capture on any answer here, BEFORE it uploads, and the Type
   * backfill skips the row. Two cases, and only two:
   *   • Map 1 resolved no Type (not a MAPS development row, or the backbone is not loaded).
   *   • The row carries a THEME stamped by the MAPS generator (homesignal-ingest
   *     maps-datacenter.mjs, a port of this page's rule) that is NOT the Type Map 1 resolves
   *     for the same record. That would be a post whose copy says one Type while its map, its
   *     dashboard bucket and its feed say another — so it is never recorded, whichever side
   *     is wrong. This is what makes the ingest port CHECKED rather than trusted.
   */
  HS.mapsSocialTypeProblem = function (post) {
    var t = HS.mapsSocialTypeKey(post);
    if (!t) return 'Map 1 resolved no Development Type for this draft';
    var stamped = ((post && post.evidence) || {}).theme;
    if (stamped && stamped !== t) {
      return 'the draft\'s stamped theme "' + stamped + '" is not Map 1\'s Development Type "'
        + t + '" for this record';
    }
    return null;
  };

  /**
   * The THEME key for a social_posts row, or null.
   *
   * ⚖️ A THEME IS A CAMPAIGN VIEW OF THE CANONICAL TYPE, NEVER A SECOND ANSWER. It is exactly
   * "the row's canonical Type, if a campaign exists for that Type" — derived from
   * HS.mapsSocialTypeKey above and from nothing else, so a row's theme and its Type cannot
   * disagree by construction. (Before 2026-09-22 this function made its own resolveMarker call
   * and read `categories`; for a development record that set is exactly [typeKey], so the
   * answer is unchanged — measured over all 55 production MAPS rows, 55/55 identical.)
   */
  HS.mapsSocialThemeKey = function (post) {
    var t = HS.mapsSocialTypeKey(post);
    if (!t) return null;
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].key === t) return t;
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
