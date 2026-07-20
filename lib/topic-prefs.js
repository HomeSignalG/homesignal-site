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
    resolveHydrate
  };
})();
