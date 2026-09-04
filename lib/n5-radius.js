// N5 ADDRESS-RADIUS HELPERS — the pure half of Map 1's address mode.
//
// Map 1 has two geographic modes and they must never share retrieval semantics:
//
//   ZIP MODE      ZIP -> the entire ZIP geography, from the cached development_reports row.
//   ADDRESS MODE  street address -> geocode-address -> HOME lat/lng
//                                -> public.n5_projects_within_radius (canonical geometry)
//                                -> app_projects hydration by source_key
//                                -> the SAME Map 1 markers, rails and dossier.
//
// Everything here is pure: no DOM, no fetch, no globals beyond window.HS. The page owns the
// network calls; this owns the shape of a site, so the rules below are unit-testable.
//
// THE THREE RULES THAT ARE EASY TO BREAK AND EXPENSIVE TO GET WRONG
//
// 1. marker_lat / marker_lng are PRESENTATION COORDINATES. They say where to draw one pin for
//    a geometry instance. They are NOT the radius answer and NOT the distance answer:
//    `distance_mi` comes from the RPC, measured against the TRUE canonical geometry, and for a
//    polygon or a long line the marker is generally NOT its nearest point. Nothing here
//    recomputes distance from coordinates, and app_projects.lat/lng is never read.
//
// 2. `registry_id` IS NOT COPIED FROM app_projects. On this page `frsRid()` treats ANY
//    registry_id as proof of an EPA FRS facility, and app_projects.registry_id is a SOURCE
//    registry slug ("austin-site-plan-cases"). Copying it would relabel every canonical
//    project as "Facility - operating now" and hand it EPA affordances. The source identity
//    is preserved under `src` and `n5_registry_id` instead, where nothing keys facility
//    behaviour off it.
//
// 3. The result grain is (source_key, feature_id), never source_key. One project may own many
//    geometry instances; each has its own marker, distance, geometry type and provenance.
//    Hydration content is shared per project - the spatial rows are not collapsed.
(function () {
  const HS = (window.HS = window.HS || {});

  // The product radii, matching the RPC's own allowlist. Anything else is refused server-side.
  HS.N5_RADII = [0.5, 1, 2, 5];

  // app_projects.status is a CLOSED vocabulary, measured 2026-09-04 over record_kind
  // 'development': Operating 1,377,492 - Approved 1,261,503 - Proposed 360,380 - Active 5.
  // 'Active' is deliberately NOT mapped: it is not one of the three lifecycle words, and the
  // resolver has a first-class `unknown` state, so guessing would be fabrication for the sake
  // of a colour. Anything unrecognised - including null - resolves to 'unknown'.
  HS.n5BucketFromStatus = function (status) {
    const s = String(status == null ? '' : status).trim().toLowerCase();
    if (s === 'operating' || s === 'built') return 'operating';
    if (s === 'approved') return 'approved';
    if (s === 'proposed') return 'proposed';
    return 'unknown';
  };

  function finite(v) { return typeof v === 'number' && isFinite(v); }

  // The distinct (source_key, feature_id) identity of a returned geometry instance.
  HS.n5RowKey = function (row) {
    return String((row && row.source_key) || '') + ' ' + String((row && row.feature_id) || '');
  };

  // The project keys to hydrate. De-duped, because many geometry instances can share a project
  // - but the SPATIAL rows are never de-duped (rule 3).
  HS.n5SourceKeys = function (rows) {
    const seen = Object.create(null);
    const out = [];
    (rows || []).forEach(function (r) {
      const k = r && r.source_key;
      if (!k || seen[k]) return;
      seen[k] = 1; out.push(k);
    });
    return out;
  };

  // has_more is returned on every row and means the same thing on each: more matching canonical
  // geometry exists beyond what came back. Never inferred from rows.length === limit.
  HS.n5HasMore = function (rows) {
    return (rows || []).some(function (r) { return r && r.has_more === true; });
  };

  // ONE geometry instance -> one Map 1 site, in the page's existing site shape.
  // `project` is its hydrated app_projects row, or null when hydration found nothing.
  HS.n5SiteFromRow = function (row, project, home) {
    if (!row) return null;
    const p = project || {};
    const bucket = HS.n5BucketFromStatus(p.status);
    const site = {
      // physically located, and a DEVELOPMENT record - never a facility (rule 2). Together
      // these route it through the page's existing development rails and dossier.
      scope: 'point',
      relevance: 'development',
      bucket: bucket,
      // `type` carries the same lifecycle word so the dot colour and the label are computed
      // from ONE signal; `use_type` carries the project's real category for the shape.
      type: bucket,
      use_type: p.type || '',
      label: p.name || '',
      // the anti-fabrication gate: a site with no official record URL is dropped by the page.
      record_url: p.source_ref || '',
      // source identity, kept OFF `registry_id` on purpose (rule 2).
      src: p.registry_id || '',
      n5_registry_id: row.registry_id || null,
      // canonical identity + evidence class, carried so nothing downstream has to guess.
      n5_source_key: row.source_key,
      n5_feature_id: row.feature_id,
      n5_provenance: row.provenance || null,
      n5_geometry_type: row.geometry_type || null,
      // AUTHORITATIVE. Measured by the RPC against true canonical geometry. Never recomputed.
      distance_mi: finite(row.distance_mi) ? row.distance_mi : null,
      file_date: p.submitted_at || null,
      date_kind: p.date_kind || null,
      impact_score: (p.impact_score == null ? null : p.impact_score),
      impact_dimensions: (p.impact_dimensions == null ? null : p.impact_dimensions)
    };
    // MARKER - presentation only, and only from this row's own geometry. A NULL marker is an
    // honest "cannot place this": the record still lists, with its real distance, and the page
    // simply draws no pin. Never substituted from app_projects.lat/lng, the home point, a ZIP
    // centroid, or another feature.
    if (finite(row.marker_lat) && finite(row.marker_lng)) {
      site.lat = row.marker_lat;
      site.lng = row.marker_lng;
      if (home && finite(home.lat) && finite(home.lng)) {
        // display offsets in miles East/North, used by the 3D views for PLACEMENT. This is
        // geometry for drawing, not a distance claim - distance_mi above is the claim.
        site.e = (site.lng - home.lng) * 69 * Math.cos(home.lat * Math.PI / 180);
        site.n = (site.lat - home.lat) * 69;
      }
    }
    return site;
  };

  // Rows + hydration -> sites, at the (source_key, feature_id) grain.
  HS.n5SitesFrom = function (rows, projects, home) {
    const byKey = Object.create(null);
    (projects || []).forEach(function (p) { if (p && p.source_key && !byKey[p.source_key]) byKey[p.source_key] = p; });
    return (rows || []).map(function (r) { return HS.n5SiteFromRow(r, byKey[r && r.source_key] || null, home); })
      .filter(Boolean);
  };

  // ADDRESS MODE MERGE. Canonical N5 results REPLACE the report engine's own development
  // points, because only the RPC's geometry can support a "physically within X miles" claim.
  // Everything else the engine returns is preserved untouched:
  //   * facilities (scope point, not relevance development) - a separate physical object class,
  //     spatially filtered by the EPA FRS radius search, never relabelled as development;
  //   * area / jurisdiction notices (scope area) - they keep their existing "county/city-wide
  //     notice, dot placed within the search area, not at an exact project site" treatment and
  //     are never described as within the radius.
  HS.n5MergeSites = function (reportSites, n5Sites) {
    const kept = (reportSites || []).filter(function (s) {
      return !(s && s.scope === 'point' && s.relevance === 'development');
    });
    return kept.concat(n5Sites || []);
  };

  // The one honest sentence about completeness for address mode. Zero rows means exactly this:
  // no eligible canonical development geometry came back inside this radius at this query. It is
  // NOT a claim that nothing is nearby, and truncation is never presented as completeness.
  HS.n5CoverageNote = function (rows, radiusText) {
    const n = (rows || []).length;
    const r = radiusText || 'this radius';
    if (HS.n5HasMore(rows)) {
      return 'showing the ' + n + ' nearest canonical projects - more canonical project geometry exists within ' + r;
    }
    if (n === 0) {
      return 'no canonical project geometry in the development corpus fell within ' + r + ' of this address';
    }
    return n + (n === 1 ? ' canonical project' : ' canonical projects') + ' within ' + r;
  };
})();
