// Pure topic-preference helpers — shared by shell.js (hydrate/paint) and unit tests.
(function () {
  const HS = (window.HS = window.HS || {});
  const TOPIC_PREF_CATS = ['gov', 'meetings', 'news', 'dev'];

  function topicPrefsFromRows(rows) {
    const prefs = {};
    (rows || []).forEach(row => {
      if (!row || !row.category) return;
      prefs[row.category] = {
        topics: Array.isArray(row.topics) ? row.topics.slice() : [],
        share_consent: !!row.share_consent
      };
    });
    return prefs;
  }

  function hydrateSignedInPrefs(serverRows) {
    return topicPrefsFromRows(serverRows);
  }

  function hydrateSignedInFailure() {
    return {};
  }

  function hydrateAnonymousPrefs(localPrefs) {
    return localPrefs && typeof localPrefs === 'object' && !Array.isArray(localPrefs) ? localPrefs : {};
  }

  function topicCount(prefs, category) {
    const pref = prefs && prefs[category];
    return pref && Array.isArray(pref.topics) ? pref.topics.length : 0;
  }

  // Local-News topic filter (Phase B). Pure so it is unit-testable off-DOM.
  // Semantics (per spec):
  //   * no saved selection (empty/falsy follows) -> show ALL Local News;
  //   * with a selection -> show a story when story.subtopics overlaps any selected
  //     canonical topic label (a multi-subtopic story appears if ANY selected matches);
  //   * untagged stories are hidden ONLY when a filter is applied (no overlap possible).
  // Canonical topic strings are compared verbatim — no second vocabulary.
  function filterNewsByTopics(items, follows) {
    const list = Array.isArray(items) ? items : [];
    if (!Array.isArray(follows) || follows.length === 0) return list.slice();
    const wanted = follows;
    return list.filter(function (it) {
      const subs = it && Array.isArray(it.subtopics) ? it.subtopics : [];
      for (let i = 0; i < subs.length; i++) {
        if (wanted.indexOf(subs[i]) !== -1) return true;
      }
      return false;
    });
  }

  // The saved News-tier follows for the current user, from hydrated topicPrefs.
  // Empty/absent -> [] (which filterNewsByTopics treats as "show all").
  function newsFollows(topicPrefs) {
    const pref = topicPrefs && topicPrefs.news;
    return pref && Array.isArray(pref.topics) ? pref.topics.slice() : [];
  }

  // Decision tree mirrored by shell.js::hydrateTopicPrefs (tested without DOM/Supabase).
  function resolveHydrate(opts) {
    const authenticated = !!(opts && opts.authenticated);
    if (!authenticated) return hydrateAnonymousPrefs(opts && opts.localPrefs);
    if (opts && opts.serverError) return hydrateSignedInFailure();
    return hydrateSignedInPrefs(opts && opts.serverRows);
  }

  HS.topicPrefsUtil = {
    TOPIC_PREF_CATS,
    topicPrefsFromRows,
    hydrateSignedInPrefs,
    hydrateSignedInFailure,
    hydrateAnonymousPrefs,
    topicCount,
    resolveHydrate,
    filterNewsByTopics,
    newsFollows
  };
})();
