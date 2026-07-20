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
      zips: ['84301', '84302', '84306', '84307', '84309', '84311', '84312',
             '84313', '84314', '84316', '84324', '84329', '84330', '84331',
             '84334', '84336', '84337', '84340'],
      // Per-county Government Notices topics — these must track the exact
      // government feeds available for this county (see topics.js).
      governmentTopics: [
        'County Commission & county business',
        'Planning, zoning & development',
        'Elections & voting',
        'Public safety & emergencies',
        'Water districts & utilities',
        'Stratos data center project',
        'Property taxes & assessments',
        'City government (Brigham City)',
        'City government (Tremonton)'
      ]
    },
    {
      id: '3aa7541e-2aa1-4254-96d2-962240cd2e32',
      slug: 'eagle-mountain',
      name: 'Eagle Mountain, Utah',
      page: 'eagle-mountain.html',
      zips: ['84005'],
      // Per-community Government Notices topics — must track the exact government
      // feeds available for this city (see topics.js / digest.py::CANONICAL_TOPICS).
      // A city's own council maps to the fixed 'County Commission & county business'
      // label — do NOT rename to 'City Council'; the engine matches exact strings.
      governmentTopics: [
        'County Commission & county business',
        'Planning, zoning & development',
        'Property taxes & assessments',
        'Public safety & emergencies',
        'Water districts & utilities',
        'Elections & voting',
        'Eagle Mountain data center project'
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

  // ---------------------------------------------------------------------------
  // Canonical resident-facing place label: "Town Name (ZIP)".
  // The ZIP is the resident-facing identity of every page (see CLAUDE.md §2), so a
  // place shown to a resident always pairs the town/place name with a 5-digit ZIP
  // when one is known. This is the ONE backbone standard used on every alert page,
  // the dashboard, the development pages and the emails — so "Ogden (84401)" and
  // "Brigham City (84302)" read identically everywhere.
  //
  //  - `row`  a community row ({name, level, zip_codes})
  //  - `zip`  the resident's ZIP context (the ZIP they entered / are viewing). Wins
  //           over the row's own ZIP. Omit it and a single-ZIP row uses its own ZIP;
  //           a multi-ZIP county (no single ZIP) falls back to the bare name.
  //
  // Idempotent: a level=zip row whose name already carries a "(#####)" (e.g.
  // "Ogden (84401)") is returned verbatim, and a legacy ", State" suffix from the
  // fallback registry is dropped so "Tremonton, Utah" reads "Tremonton (84337)".
  function displayName(row, zip) {
    if (!row) return '';
    var base = String(row.name || '').trim();
    if (!base) return '';
    // Already "Town (#####)" — that IS the standard; keep it exactly.
    if (/\(\d{5}\)\s*$/.test(base)) return base;
    // Drop a trailing ", State" so the format matches the ZIP-level rows.
    base = base.replace(/,\s*[A-Za-z][A-Za-z. ]+$/, '').trim();
    var z = String(zip == null ? '' : zip).replace(/\D/g, '').slice(0, 5);
    if (z.length !== 5) {
      // No resident ZIP: use the row's own ZIP only when it has exactly one
      // (a single-ZIP city). A multi-ZIP county has no single ZIP to show.
      z = (row.zip_codes && row.zip_codes.length === 1) ? String(row.zip_codes[0]) : '';
    }
    return z ? (base + ' (' + z + ')') : base;
  }

  window.HS = window.HS || {};
  window.HS.communities = COMMUNITIES;
  window.HS.extractZip = extractZip;
  window.HS.zipToCommunity = zipToCommunity;
  window.HS.getCommunity = getCommunity;
  window.HS.displayName = displayName;
})();
