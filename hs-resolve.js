// hs-resolve.js — the ONE shared live-DB community resolver.
//
// Coverage, page routing, and community lookups all read the live `communities`
// table (the source of truth, §1) — NEVER the frozen communities.js map. That map
// is a bootstrap/offline-last-resort only. Extracting this module stops the
// frozen-map drift that produced the dashboard bugs (add-community + saved-follows
// list both silently dropped communities outside the 2-entry map).
//
// Loaded AFTER communities.js so window.HS already exists (and HS.zipToCommunity is
// available as the offline last resort). Vanilla, no build step (CLAUDE.md §4).
(function () {
  window.HS = window.HS || {};
  var SB_URL = 'https://qwnnmljucajnexpxdgxr.supabase.co';
  // Public anon key — safe in the browser (RLS gates writes). Same key every page embeds.
  var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3bm5tbGp1Y2FqbmV4cHhkZ3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTAyOTgsImV4cCI6MjA5NTk4NjI5OH0.prpXB6lSIhWMAsdkkaxAfkvEodbojfUUyN4L4JbQE1U';
  // Communities with a bespoke launch page (SEO); every other community uses community.html.
  var LEGACY_PAGE = { 'box-elder': 'box-elder.html', 'eagle-mountain': 'eagle-mountain.html' };
  var LEVEL_RANK = { neighborhood: 4, zip: 3, city: 2, county: 1 };
  function anonHeaders() { return { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON }; }

  // The page URL for a resolved community row {id, slug}. Prefer ?zip= when we have the
  // searched ZIP (keeps the resident-facing ZIP page); else address it by ?id=.
  function pageForCommunity(row, zip) {
    if (!row) return null;
    var q = zip ? ('?zip=' + encodeURIComponent(zip)) : ('?id=' + encodeURIComponent(row.id));
    return (row.slug && LEGACY_PAGE[row.slug]) ? (LEGACY_PAGE[row.slug] + q) : ('community.html' + q);
  }

  // ZIP -> most-specific community page URL (live DB). Cache per-ZIP (shared hs_cov_ key),
  // then the frozen map as an absolute last resort. Null = genuinely not covered.
  async function resolveCoverageUrl(zip) {
    if (!zip) return null;
    try {
      var res = await fetch(SB_URL + '/rest/v1/communities?select=id,slug,level,zip_codes&zip_codes=cs.{' + encodeURIComponent(zip) + '}', { headers: anonHeaders() });
      if (res.ok) {
        var rows = await res.json();
        if (Array.isArray(rows) && rows.length) {
          rows.sort(function (a, b) { return (LEVEL_RANK[b.level] || 0) - (LEVEL_RANK[a.level] || 0) || (a.zip_codes || []).length - (b.zip_codes || []).length; });
          var url = pageForCommunity(rows[0], zip);
          try { localStorage.setItem('hs_cov_' + zip, url); } catch (e) {}
          return url;
        }
      }
    } catch (e) { /* DB unreachable -> last DB-resolved answer, then the frozen map */ }
    try { var cached = localStorage.getItem('hs_cov_' + zip); if (cached) return cached; } catch (e) {}
    var legacy = (window.HS.zipToCommunity ? window.HS.zipToCommunity(zip) : null);
    return legacy ? (legacy.page + '?zip=' + encodeURIComponent(zip)) : null;
  }

  // Fetch community rows for a set of ids -> { id: {id,name,level,slug} }. Used by the
  // dashboard to render the saved-follows list from the DB (name + level + page), so a
  // followed community outside the frozen map is never dropped.
  async function communitiesByIds(ids) {
    var out = {};
    var uniq = (ids || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    if (!uniq.length) return out;
    try {
      var inList = uniq.map(encodeURIComponent).join(',');
      var res = await fetch(SB_URL + '/rest/v1/communities?select=id,name,level,slug&id=in.(' + inList + ')', { headers: anonHeaders() });
      if (res.ok) { (await res.json()).forEach(function (r) { out[r.id] = r; }); }
    } catch (e) {}
    return out;
  }

  // ZIP -> the most-specific community ROW that contains it ({id,name,level,slug}), or null.
  // Same live-DB query + most-specific ranking as resolveCoverageUrl, but returns the ROW so a
  // caller can DISPLAY the resident's place. The dashboard uses this to show the ZIP a user
  // entered (users.zip_code) as their follow's name — while the follow's community_id stays
  // anchored at the county so alerts keep delivering. Null = ZIP not covered.
  async function communityForZip(zip) {
    if (!zip) return null;
    try {
      var res = await fetch(SB_URL + '/rest/v1/communities?select=id,name,level,slug,zip_codes&zip_codes=cs.{' + encodeURIComponent(zip) + '}', { headers: anonHeaders() });
      if (res.ok) {
        var rows = await res.json();
        if (Array.isArray(rows) && rows.length) {
          rows.sort(function (a, b) { return (LEVEL_RANK[b.level] || 0) - (LEVEL_RANK[a.level] || 0) || (a.zip_codes || []).length - (b.zip_codes || []).length; });
          return rows[0];
        }
      }
    } catch (e) {}
    return null;
  }

  window.HS.resolveCoverageUrl = resolveCoverageUrl;
  window.HS.communitiesByIds = communitiesByIds;
  window.HS.pageForCommunity = pageForCommunity;
  window.HS.communityForZip = communityForZip;
})();
