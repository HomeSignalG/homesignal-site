// ============================================================
// HomeSignal — shared community registry
// Single source of truth for the communities we cover and the
// ZIP -> community mapping used by the homepage search and the
// dashboard. To add a county, add an entry here.
//
// (Later this can be backed by the Supabase `communities` table;
//  the helpers below are written so callers don't need to change
//  when that happens.)
// ============================================================
(function () {
  var COMMUNITIES = [
    {
      id: 'd67c558f-1f04-4811-a565-873ae2afd6f3',
      slug: 'box-elder',
      name: 'Box Elder County, Utah',
      page: 'box-elder.html',
      // Union of the two registries that used to drift (index.html carried
      // 84308 + 84315; this list lacked them). index.html now loads THIS file,
      // so this is the single ZIP registry — keep it complete.
      zips: ['84301', '84302', '84306', '84307', '84308', '84309', '84311',
             '84312', '84313', '84314', '84315', '84316', '84324', '84329',
             '84330', '84331', '84334', '84336', '84337', '84340'],
      // Per-county Government Notices topics — these must track the exact
      // government feeds available for this county (see topics.js).
      governmentTopics: [
        'County Commission & county business',
        'Planning, zoning & development',
        'Elections & voting',
        'Public safety & emergencies',
        'Water companies',
        'Stratos data center project',
        'Property taxes & assessments',
        'City government (Brigham City)',
        'City government (Tremonton)'
      ]
    }
  ];

  // Pull a 5-digit ZIP out of whatever was typed (ignores spaces, etc.).
  function extractZip(query) {
    var m = (query || '').match(/\b\d{5}\b/);
    return m ? m[0] : null;
  }

  // Find the community that covers a ZIP (or null).
  function zipToCommunity(zip) {
    for (var i = 0; i < COMMUNITIES.length; i++) {
      if (COMMUNITIES[i].zips.indexOf(zip) >= 0) return COMMUNITIES[i];
    }
    return null;
  }

  // Look up a community by its UUID id or its slug (or null).
  function getCommunity(idOrSlug) {
    for (var i = 0; i < COMMUNITIES.length; i++) {
      if (COMMUNITIES[i].id === idOrSlug || COMMUNITIES[i].slug === idOrSlug) {
        return COMMUNITIES[i];
      }
    }
    return null;
  }

  window.HS = window.HS || {};
  window.HS.communities = COMMUNITIES;
  window.HS.extractZip = extractZip;
  window.HS.zipToCommunity = zipToCommunity;
  window.HS.getCommunity = getCommunity;
})();
