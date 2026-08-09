// HomeSignal viewed-ZIP resolution — pure helpers for shell boot + nav hrefs.
// Consumed by shell.js (browser) and test/navigation-zip.test.mjs (Node).
//
// Developer note — ZIP navigation architecture:
//   • HS.state.zip is the canonical viewed ZIP (do not add parallel ZIP state).
//   • Use HS.navHref(page, zip) or <a data-znav="page.html"> for ZIP-preserving links.
//   • Never hand-build ?zip= URLs. Full reference: docs/zip-navigation.md
//
// NAV-01: preserve ZIP context across full-page shell navigation without
// overwriting the resident's saved myZip (localStorage).
(function () {
  function parseZipParam(search) {
    if (search == null || search === '') return null;
    try {
      var z = new URLSearchParams(String(search)).get('zip');
      return (z && /^\d{5}$/.test(z)) ? z : null;
    } catch (e) { return null; }
  }

  // Extract a 5-digit ZIP from the end of a geocoded U.S. address string (avoids
  // matching a 5-digit house number earlier in the line).
  function parseZipFromAddress(str) {
    if (str == null || str === '') return null;
    var m = String(str).match(/(\d{5})(?:-\d{4})?\s*$/);
    return (m && /^\d{5}$/.test(m[1])) ? m[1] : null;
  }

  // Boot precedence for the ZIP the shell pages scope to:
  //   1. ?zip= on the current URL (explicit navigation / deep link)
  //   2. saved myZip (resident's chosen area — never overwritten by viewing)
  //   3. session viewZip (browsing context from this tab)
  //   4. DEFAULT_ZIP (Del Valle prototype)
  function resolveViewedZip(opts) {
    opts = opts || {};
    var def = opts.defaultZip || '78617';
    var urlZ = opts.urlZip;
    if (urlZ && /^\d{5}$/.test(String(urlZ))) return String(urlZ);
    var myZ = opts.myZip;
    if (myZ && /^\d{5}$/.test(String(myZ))) return String(myZ);
    var sesZ = opts.sessionViewZip;
    if (sesZ && /^\d{5}$/.test(String(sesZ))) return String(sesZ);
    return def;
  }

  function navHref(page, zip) {
    if (!page) return page;
    if (!zip || !/^\d{5}$/.test(String(zip))) return page;
    return page + '?zip=' + encodeURIComponent(String(zip));
  }

  // Build a shell page URL with zip + optional query params (one canonical builder).
  // opts: { zip, place, id, lens, sort, band, category, focus, ... }
  function pageHref(page, opts) {
    if (!page) return page;
    opts = opts || {};
    var params = new URLSearchParams();
    var zip = opts.zip;
    if (zip && /^\d{5}$/.test(String(zip))) params.set('zip', String(zip));
    Object.keys(opts).forEach(function (k) {
      if (k === 'zip') return;
      var v = opts[k];
      if (v == null || v === '') return;
      params.set(k, String(v));
    });
    var qs = params.toString();
    return page + (qs ? '?' + qs : '');
  }

  // Dashboard / map pin destinations for a mixed feed item (project, alert, facility).
  function itemNavHref(it, zip) {
    if (!it) return null;
    zip = zip && /^\d{5}$/.test(String(zip)) ? String(zip) : null;
    if (it.type || it.record_kind === 'facility' || it._facility) {
      return pageHref('development.html', { zip: zip, id: it.id });
    }
    if (it.related_project_id) {
      return pageHref('development.html', { zip: zip, id: it.related_project_id });
    }
    var win = it.window_closes_at;
    if (win != null) {
      try {
        var d = Math.ceil((new Date(win) - new Date()) / 86400000);
        if (d >= 0) return pageHref('alerts.html', { zip: zip, band: 'open', id: it.id });
      } catch (e) { /* fall through */ }
    }
    if (it.id) return pageHref('alerts.html', { zip: zip, id: it.id });
    return null;
  }

  // projectIds: optional Set of development-record ids in the viewed ZIP — when
  // provided, related_project_id routes to development only for a real project.
  function meetingNavHref(m, zip, projectIds) {
    if (!m) return null;
    zip = zip && /^\d{5}$/.test(String(zip)) ? String(zip) : null;
    var rid = m.related_project_id;
    if (rid) {
      var isProject = projectIds
        ? projectIds.has(rid)
        : /^proj-/i.test(String(rid));
      if (isProject) return pageHref('development.html', { zip: zip, id: rid });
      return pageHref('alerts.html', { zip: zip, id: rid });
    }
    return pageHref('alerts.html', { zip: zip, category: 'Government & civic' });
  }

  // Sort keys, with legacy aliases folded onto the canonical key (2026-08-09).
  //   'impact' was NEVER an impact sort — it ordered by app_projects.impact_score, which
  //   is a lifecycle constant (Proposed=72, Approved/built=55, else 45). It therefore
  //   produced the same earliest-first ordering as 'status', by a route whose name
  //   claimed a calculation that does not exist.
  //   'lifecycle' is now the one canonical key and it reads devStatusSortRank() — the
  //   real normalized status/stage ranking below. 'impact', 'stage' and 'status' resolve
  //   to it so existing deep links (?sort=impact) and stored prefs keep working.
  // Null prototype: a plain object literal answers SORT_ALIAS['__proto__'] with
  // Object.prototype, which is truthy, so `?sort=__proto__` escaped the whitelist and
  // was returned as a sort key. (The previous SORT_WHITELIST had the same hole.)
  var SORT_ALIAS = Object.assign(Object.create(null), {
    lifecycle: 'lifecycle', stage: 'lifecycle', status: 'lifecycle', impact: 'lifecycle',
    distance: 'distance', newest: 'newest'
  });
  function sanitizeSort(s) {
    var v = SORT_ALIAS[s];
    return typeof v === 'string' ? v : 'lifecycle';
  }

  // Development lifecycle sort — earliest → latest. Reads the record's own normalized
  // status (and its stage text as a sub-rank); it has never read impact_score and must
  // not start. The vocabulary is exactly what app_refresh_zip materializes, verified
  // against the live table for ZIP 78617 on 2026-08-09 (Proposed 49 · Approved 336 ·
  // Active 4 · Operating 119 · 0 'On file'), plus 'Decided' and 'Built', which the
  // materializer can emit but that ZIP happens not to hold.
  //
  //   0  Proposed · On file   filed, no decision yet. 'On file' means the source stated
  //                           no lifecycle, so it sorts with the earliest rather than
  //                           being promoted past records that HAVE been decided.
  //   1  Decided              application resolved (approved OR denied/withdrawn), and
  //                           a Proposed record whose STAGE says review/hearing/pending.
  //                           Ranked before Approved on purpose: 'Decided' does not
  //                           assert which way the decision went.
  //   2  Approved
  //   3  Active               built, per the source's own lifecycle word
  //   4  Operating · Built
  //   5  anything unrecognised — last, never silently ranked as one of the above
  //
  // Closed/inactive has no materialized status today (the copy formatter carries the
  // word for a source that states it); when one appears it belongs after Operating.
  var DEV_STATUS_RANK = { 'Proposed': 0, 'On file': 0, 'Decided': 1, 'Approved': 2, 'Active': 3, 'Operating': 4, 'Built': 4 };
  var DEV_REVIEW_STAGE = /\breview\b|in review|under review|hearing|submitt|pending/;
  function devStatusSortRank(item) {
    var status = String((item && item.status) || (typeof item === 'string' ? item : ''));
    var base = DEV_STATUS_RANK[status];
    if (base != null) {
      if (status === 'Proposed' && item && item.stage && DEV_REVIEW_STAGE.test(String(item.stage).toLowerCase())) return 1;
      return base;
    }
    return 5;
  }
  function sanitizeLens(n) {
    n = parseInt(n, 10);
    return (n >= 0 && n <= 2 && !isNaN(n)) ? n : 0;
  }

  // True when the tab has an explicit browsing context (URL / session / saved area) —
  // used to avoid auto-loading the DEFAULT_ZIP sample when opening the tracker bare.
  function hasViewedZipContext(opts) {
    opts = opts || {};
    if (opts.urlZip && /^\d{5}$/.test(String(opts.urlZip))) return true;
    if (opts.myZip && /^\d{5}$/.test(String(opts.myZip))) return true;
    if (opts.sessionViewZip && /^\d{5}$/.test(String(opts.sessionViewZip))) return true;
    return false;
  }

  // Shell nav targets whose content is scoped by ZIP (NAV-01).
  var ZIP_NAV_PAGES = ['today.html', 'dashboard.html', 'alerts.html', 'development.html', 'maps.html', 'homesignalmap.html', 'community.html'];

  // The two map experiences — cross-links always carry ?zip= via navHref.
  var MAP_PAGES = ['maps.html', 'homesignalmap.html'];

  var api = {
    parseZipParam: parseZipParam,
    parseZipFromAddress: parseZipFromAddress,
    resolveViewedZip: resolveViewedZip,
    navHref: navHref,
    pageHref: pageHref,
    itemNavHref: itemNavHref,
    meetingNavHref: meetingNavHref,
    sanitizeSort: sanitizeSort,
    devStatusSortRank: devStatusSortRank,
    sanitizeLens: sanitizeLens,
    hasViewedZipContext: hasViewedZipContext,
    ZIP_NAV_PAGES: ZIP_NAV_PAGES,
    MAP_PAGES: MAP_PAGES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window.HS = window.HS || {}, api);
})();
