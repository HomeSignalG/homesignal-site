// Pure topic-preference helpers — shared by shell.js (hydrate/paint) and unit tests.
(function () {
  const HS = (window.HS = window.HS || {});
  const TOPIC_PREF_CATS = ['gov', 'meetings', 'news', 'dev'];

  // Shell category <-> canonical stream. These three categories are DELIVERABLE:
  // their state now comes from public.my_alert_subscriptions, the same view the
  // digest resolves through, so the UI cannot show a topic as on while delivery
  // treats it as off. 'dev' has no delivery pipeline and stays an app-local pref.
  const CAT_TO_STREAM = { gov: 'notices', meetings: 'meetings', news: 'news' };
  const STREAM_TO_CAT = { notices: 'gov', meetings: 'meetings', news: 'news' };
  const DELIVERABLE_CATS = Object.keys(CAT_TO_STREAM);

  // Canonical rows -> the shell's per-category shape. Only origin='explicit'
  // counts: a follow_floor row is a pre-staged follow, never an email selection,
  // so showing it as a chosen topic would be the follow-is-consent error in the UI.
  // Order follows sort_order, which is the order the digest renders.
  function topicPrefsFromCanonicalRows(rows) {
    const prefs = {};
    (rows || [])
      .filter(r => r && r.origin === 'explicit' && STREAM_TO_CAT[r.stream])
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .forEach(r => {
        const cat = STREAM_TO_CAT[r.stream];
        if (!prefs[cat]) prefs[cat] = { topics: [], share_consent: false };
        if (prefs[cat].topics.indexOf(r.topic) < 0) prefs[cat].topics.push(r.topic);
      });
    return prefs;
  }

  // Canonical answer for the deliverable categories; app-local prefs supply only
  // 'dev'. Never the other way round -- a stale local cache must not be able to
  // add a deliverable topic the server does not have.
  function mergeCanonicalWithLocal(canonicalPrefs, localPrefs) {
    const out = {};
    DELIVERABLE_CATS.forEach(c => { if (canonicalPrefs && canonicalPrefs[c]) out[c] = canonicalPrefs[c]; });
    if (localPrefs && localPrefs.dev) out.dev = localPrefs.dev;
    return out;
  }

  // WHICH PLACE'S ROWS. Subscriptions are per (user, community) and delivery groups
  // by community, so the community is the right unit -- but resolving a ZIP to one
  // is a network call that can fail, and a failure must not render "no topics
  // selected" for a resident who has them (the UI-says-off/delivery-says-on
  // disagreement this model exists to end). So the id is a HINT, not the gate, and
  // the fallbacks are ordered by how directly each identifies the place.
  //
  // ⚠️ ZIP ALONE IS NOT ENOUGH, which is why it is second rather than first. Every
  // live community is a COUNTY with many ZIPs (Travis 85, Box Elder 18) while
  // users.zip_code holds exactly ONE of them -- the last one written. A resident who
  // signed up on 84302 and opens the Alerts page for 84312 is the same identity with
  // the same delivery, and a ZIP-equality read would show them nothing.
  function selectPlaceRows(rows, opts) {
    const all = Array.isArray(rows) ? rows : [];
    const communityId = opts && opts.communityId;
    const zip = String((opts && opts.zip) || '').trim();
    if (communityId) {
      const byId = all.filter(r => r && r.community_id === communityId);
      if (byId.length) return byId;
    }
    if (/^\d{5}$/.test(zip)) {
      const byZip = all.filter(r => r && String(r.zip_code || '').trim() === zip);
      if (byZip.length) return byZip;
    }
    // One place on file: no ambiguity to resolve.
    const ids = [];
    all.forEach(r => { if (r && r.community_id && ids.indexOf(r.community_id) < 0) ids.push(r.community_id); });
    if (ids.length === 1) return all;
    // Several places and none identified. Showing one of them would attribute
    // another place's selections to this page -- worse than showing none.
    return [];
  }

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
    CAT_TO_STREAM,
    STREAM_TO_CAT,
    DELIVERABLE_CATS,
    topicPrefsFromCanonicalRows,
    selectPlaceRows,
    mergeCanonicalWithLocal,
    topicPrefsFromRows,
    hydrateSignedInPrefs,
    hydrateSignedInFailure,
    hydrateAnonymousPrefs,
    topicCount,
    resolveHydrate
  };
})();
