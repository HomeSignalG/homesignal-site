// ============================================================
// HomeSignal — canonical Pipeline > Topic taxonomy
// ------------------------------------------------------------
// SINGLE SOURCE OF TRUTH for the 4 content pipelines and the
// topics inside them. The same strings must be used in 3 places
// so that matching fires:
//   1. the community pop-ups        (what a user can follow)
//   2. subscription writes          (user_subscriptions.pipeline_type / .topic)
//   3. the tags you stamp in Zaps   (alerts.pipeline_type / alerts.category)
//
// `key` below is the canonical pipeline_type string. Tag your Zaps
// with EXACTLY these values. `government_notice` is already live and
// anchors the naming convention (singular, snake_case); the other
// three are DEFINED here as the standard for the Zaps you build next.
//
// Intended match rule (per the Feeds config: matching keys on CATEGORY):
//   an article reaches a user when community_id matches AND
//     ( subscription.topic = article.category   -> that one topic )
//     OR ( subscription.topic IS NULL AND subscription.pipeline_type
//          = article.pipeline_type              -> the whole pipeline )
//   `pipeline_type` is a grouping label; the granular match key is
//   category == topic (same canonical string, word-for-word).
// ============================================================
(function () {
  // Universal topics — INTENTIONALLY shared by News Alerts, Emerging
  // Technology, and Global Best Practices (one list keeps the site
  // simple). Edit this list to change all three at once.
  var UNIVERSAL_TOPICS = [
    'Water Quality',
    'Air Quality',
    'Soil Quality',
    'Animal & Human Viruses / Diseases',
    'Infrastructure',
    'EMF',
    'Noise Pollution',
    'Light Pollution',
    'Livestock, Crops, Pets & Wildlife Health',
    'Weather & Climate Hazards',
    'Radiation',
    'Data Centers'
  ];

  var PIPELINES = [
    {
      // PER-COUNTY: government topics must track the exact feeds you
      // can actually get for each county, so they live on the community
      // record (communities.js -> governmentTopics), not here.
      key: 'government_notice',
      label: 'Government Notices',
      perCommunity: true,
      topics: []
    },
    { key: 'news_alert',           label: 'News Alerts',          perCommunity: false, topics: UNIVERSAL_TOPICS },
    { key: 'emerging_technology',  label: 'Emerging Technology',  perCommunity: false, topics: UNIVERSAL_TOPICS },
    { key: 'global_best_practices',label: 'Global Best Practices',perCommunity: false, topics: UNIVERSAL_TOPICS }
  ];

  function getPipeline(key) {
    for (var i = 0; i < PIPELINES.length; i++) {
      if (PIPELINES[i].key === key) return PIPELINES[i];
    }
    return null;
  }

  // Resolve the topic list for a pipeline in a given community.
  // For per-county pipelines (government_notice) this returns the
  // county-specific list off the community record.
  function topicsFor(pipelineKey, community) {
    var p = getPipeline(pipelineKey);
    if (!p) return [];
    if (p.perCommunity) {
      return (community && community.governmentTopics) || [];
    }
    return p.topics;
  }

  window.HS = window.HS || {};
  window.HS.pipelines = PIPELINES;
  window.HS.universalTopics = UNIVERSAL_TOPICS;
  window.HS.getPipeline = getPipeline;
  window.HS.topicsFor = topicsFor;
})();
