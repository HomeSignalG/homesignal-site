// ZIP-MODE AUTHORITATIVE GEOGRAPHY — the pure half of Map 1's ZIP mode.
//
// THE INVARIANT THIS EXISTS TO KEEP (founder, 2026-09-04):
//
//   A ZIP search represents the ENTIRE actual ZIP/ZCTA geography. It must NEVER use a
//   centroid, a ZIP center, a representative point, an invented coordinate, a 3-mile
//   radius, or any other point-radius approximation as a substitute for that geography.
//   There is NO radius filter in ZIP mode. Where authoritative whole-ZIP geography does
//   not yet exist, ZIP mode returns the honest not-measured state instead of substituting.
//
// Map 1 does not BUILD that geography (Session B owns acquisition and membership). It
// CONSUMES it, through one self-describing read:
//
//   public.app_zip_projects_markers(p_zip, p_kind, p_authoritative) -> jsonb
//     { zip, mode, status, projects: [...] | null, markers: [...] | null }
//
// Everything here is pure: no DOM, no fetch, no globals beyond window.HS.
//
// THE FOUR RULES THAT ARE EASY TO BREAK
//
// 1. `null` IS NOT `[]`. status 'not_measured' returns projects/markers as NULL; a ZIP that
//    was genuinely measured and holds nothing returns EMPTY ARRAYS. Measured 2026-09-04:
//    01004 -> {status:'not_measured', markers:null}, 01009 -> {status:'boundary_complete',
//    markers:[]}. Collapsing those two renders "no development in this ZIP" over a ZIP nobody
//    has measured - a claim the data cannot support. Never use `(x || []).length` to decide.
//
// 2. `registry_id` IS NOT COPIED. On this page `frsRid()` treats ANY registry_id as proof of
//    an EPA FRS facility, and app_projects.registry_id is a SOURCE slug
//    ("austin-site-plan-cases"). Copying it would relabel every civic project as
//    "Facility - operating now". Source identity rides on `src` instead. Same trap, and the
//    same fix, as lib/n5-radius.js rule 2.
//
// 3. NO DISTANCE IS EVER SET. In ZIP mode there is no HOME and therefore no "N miles away"
//    to state. A ZIP-mode site carries no distance_mi and no e/n offsets - those belong to
//    address mode, where a real geocoded HOME makes them true.
//
// 4. THE GRAIN IS THE MARKER. One project can own several authoritative markers (a road
//    project rendered as points along its length - marker_rule LINE_MERGED_COMPONENT_*).
//    Each marker draws once, carrying its project's content. Measured on 78617: 522 markers
//    over 500 project_refs, 497 of which carry hydrated content; the 3 that do not have no
//    record_url and are dropped by the page's own anti-fabrication gate.
(function () {
  const HS = (window.HS = window.HS || {});

  // The statuses this consumer understands. Anything else is treated as unavailable rather
  // than guessed at - an unknown status must never silently read as "measured and empty".
  HS.ZIP_AUTH_COMPLETE = 'boundary_complete';
  HS.ZIP_AUTH_NOT_MEASURED = 'not_measured';
  // The producer's OTHER way of saying "I hold no geography for this ZIP". Measured live
  // 2026-09-05: every one of the 1,259 ZIPs the geography view calls `pending` returns
  // status 'unknown' here, and all 1,259 have NO row at all in geo.maps_zip_geography_status
  // - so nobody has measured them, and "not measured yet" is the literal truth. Before this
  // was recognised those ZIPs fell to 'unavailable' and the page told the resident their
  // coverage "could not be read just now": a transient-failure claim about a read that in
  // fact succeeded, on 1,259 of 12,722 pages. It also cost them the address-mode invitation
  // that the not-measured wording carries.
  // This is an ALLOW-LIST of two, never a catch-all: an unrecognised status still falls to
  // 'unavailable', so a producer change can never quietly read as measured-and-empty.
  HS.ZIP_AUTH_UNKNOWN = 'unknown';

  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function finite(v) { return typeof v === 'number' && isFinite(v); }

  // What the read actually said. Three outcomes, never inferred from array lengths (rule 1):
  //   'complete'      - this ZIP's whole-ZIP geography is established; projects/markers are real
  //                     arrays and MAY legitimately be empty (a measured zero).
  //   'not_measured'  - authoritative geography does not exist for this ZIP yet. TWO producer
  //                     statuses mean this: 'not_measured' and 'unknown' (see above).
  //   'unavailable'   - the read failed or returned a shape we do not understand.
  HS.zipAuthOutcome = function (payload) {
    if (!payload || typeof payload !== 'object') return 'unavailable';
    const st = String(payload.status || '');
    if (st === HS.ZIP_AUTH_NOT_MEASURED || st === HS.ZIP_AUTH_UNKNOWN) return 'not_measured';
    if (st === HS.ZIP_AUTH_COMPLETE && isArr(payload.projects) && isArr(payload.markers)) return 'complete';
    return 'unavailable';
  };

  // True only when ZIP mode may render authoritative development for this ZIP.
  HS.zipAuthIsComplete = function (payload) { return HS.zipAuthOutcome(payload) === 'complete'; };

  // ONE authoritative marker -> one Map 1 site, in the page's existing site shape.
  // `project` is the hydrated app_projects content for that marker's project_ref.
  HS.zipAuthSiteFromMarker = function (marker, project) {
    if (!marker || !project) return null;                 // no content -> nothing honest to draw
    if (!finite(marker.lat) || !finite(marker.lng)) return null;
    const bucket = HS.n5BucketFromStatus ? HS.n5BucketFromStatus(project.status) : 'unknown';
    return {
      // physically located, and a DEVELOPMENT record - never a facility (rule 2).
      scope: 'point',
      relevance: 'development',
      bucket: bucket,
      type: bucket,
      use_type: project.type || '',
      label: project.name || '',
      // the anti-fabrication gate: a site with no official record URL is dropped by the page.
      record_url: project.source_ref || '',
      // source identity, kept OFF `registry_id` on purpose (rule 2).
      src: project.registry_id || '',
      lat: marker.lat,
      lng: marker.lng,
      // authoritative identity + how this marker was placed, carried so nothing has to guess.
      zip_authoritative: true,
      zip_project_ref: project.project_ref || marker.project_ref || null,
      zip_marker_rule: marker.marker_rule || null,
      zip_marker_seq: (marker.marker_seq == null ? null : marker.marker_seq),
      zip_point_rule: project.point_rule || null,
      file_date: project.submitted_at || null,
      date_kind: project.date_kind || null,
      impact_score: (project.impact_score == null ? null : project.impact_score),
      impact_dimensions: (project.impact_dimensions == null ? null : project.impact_dimensions)
      // NO distance_mi and NO e/n - rule 3. There is no HOME in ZIP mode.
    };
  };

  // The whole payload -> sites, at the marker grain. Returns [] for anything that is not a
  // complete read, so a caller that forgets to check the outcome cannot accidentally render
  // a not-measured ZIP as an empty one - it gets nothing either way, and the note (below)
  // is what tells the resident which of the two happened.
  HS.zipAuthSitesFrom = function (payload) {
    if (!HS.zipAuthIsComplete(payload)) return [];
    const byRef = Object.create(null);
    payload.projects.forEach(function (p) {
      if (p && p.project_ref && !byRef[p.project_ref]) byRef[p.project_ref] = p;
    });
    const out = [];
    payload.markers.forEach(function (m) {
      const site = HS.zipAuthSiteFromMarker(m, m && byRef[m.project_ref]);
      if (site) out.push(site);
    });
    return out;
  };

  // How many distinct PROJECTS those markers represent. The rail counts projects, not pins:
  // one road project drawn as 9 markers is one project, and reporting 9 would overstate it.
  HS.zipAuthProjectCount = function (sites) {
    const seen = Object.create(null);
    let n = 0;
    (sites || []).forEach(function (s) {
      const k = s && s.zip_project_ref;
      if (!k || seen[k]) return;
      seen[k] = 1; n++;
    });
    return n;
  };

  // ZIP-MODE MERGE. Authoritative whole-ZIP development REPLACES the cached report's own
  // development points, because only authoritative ZIP membership can support "everything in
  // this ZIP". Everything else the cached report carries is preserved untouched:
  //   * facilities (scope point, not relevance development) - the EPA national floor, still
  //     radius-derived and therefore NOT a whole-ZIP claim; Session B owns that geography;
  //   * area / jurisdiction notices (scope area) - keep their existing county/city-wide
  //     treatment.
  // When the ZIP is NOT measured the report's development points are dropped anyway: showing
  // centroid-radius development while claiming to show the ZIP is the exact substitution the
  // invariant forbids.
  HS.zipAuthMergeSites = function (reportSites, authSites) {
    const kept = (reportSites || []).filter(function (s) {
      return !(s && s.scope === 'point' && s.relevance === 'development');
    });
    return kept.concat(authSites || []);
  };

  // The one honest sentence about what the resident is looking at.
  HS.zipAuthNote = function (payload, zip, sites) {
    const z = zip ? ('ZIP ' + zip) : 'this ZIP';
    const outcome = HS.zipAuthOutcome(payload);
    if (outcome === 'not_measured') {
      return 'Development coverage for ' + z + ' is not measured yet — we will not estimate it '
           + 'from a circle around the ZIP centre. Enter your street address for the live view '
           + 'around your home.';
    }
    if (outcome === 'unavailable') {
      return 'Development coverage for ' + z + ' could not be read just now.';
    }
    const n = HS.zipAuthProjectCount(sites);
    if (n === 0) {
      return 'No qualifying development records across ' + z + '. This is a measurement of the '
           + 'whole ZIP, not an empty search.';
    }
    return n + (n === 1 ? ' project' : ' projects') + ' across the whole of ' + z + '.';
  };
})();
