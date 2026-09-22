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
  // TWO PRODUCERS OF THE SAME GEOGRAPHY TRUTH, ONE INTERPRETATION — deliberately here and
  // nowhere else. Map 1 ZIP mode reads `app_zip_projects_markers`, which answers with an
  // envelope carrying `status`. The ZIP PAGE reads `app_projects_for_zip`, which answers a
  // successful development read with a BARE ARRAY and an unsuccessful one with
  // `{unavailable:true, zip_geography_status, projects:null}` — the same vocabulary under a
  // second key name. Classifying that second shape anywhere else would be a rival definition
  // of "is this ZIP's geography usable", which is exactly what this module exists to prevent.
  //
  // A BARE ARRAY IS 'complete', INCLUDING AN EMPTY ONE. That is rule 1 read forwards: the
  // development producer only ever reaches its array branch after establishing
  // boundary_complete AND cutover, so `[]` from it is a MEASURED ZERO and may support an
  // absence claim. No existing caller passes an array (all pass the markers envelope), so
  // this branch changes nothing for Map 1 — pinned by test.
  HS.zipAuthOutcome = function (payload) {
    if (!payload || typeof payload !== 'object') return 'unavailable';
    if (isArr(payload)) return 'complete';
    const st = String(payload.status || payload.zip_geography_status || '');
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
    const site = {
      // physically located, and a DEVELOPMENT record - never a facility (rule 2).
      scope: 'point',
      relevance: 'development',
      bucket: bucket,
      type: bucket,
      use_type: project.type || '',
      label: project.name || '',
      // SIGNIFICANCE-ONLY carrier for the issuing authority's own permit class, so a
      // ZIP-mode data-centre record can say whether it is major or ancillary work
      // (lib/map.js::dataCenterSignificance). Deliberately NOT named `type_raw`: that
      // name is read by the data-centre classifier and by Rule 5, and neither may widen.
      // Degrades to null if a future RPC projection drops the column, which costs a
      // verdict and can never produce a wrong one.
      permit_class: project.type_raw || null,
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
    // RULE 5 - RESIDENTIAL DEVELOPMENT QUALIFICATION (founder, 2026-09-05). Map 1 Residential
    // means meaningful NEW residential development, not routine work on an existing residential
    // property. The gate runs HERE, at the one place a ZIP-mode site is made, so a record it
    // rejects never becomes a site at all: it cannot be drawn, cannot be counted by
    // zipAuthProjectCount (which counts sites), and cannot be re-admitted downstream by
    // lib/map.js NAME_RULES matching a bare /residential/. A rejected record is DROPPED, never
    // relabelled to another Type - see lib/residential-qualify.js.
    if (HS.residentialGateDrops && HS.residentialGateDrops(site, project)) return null;
    return site;
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

  // ── ZIP MEMBERSHIP IS GEOGRAPHY, NOT PROXIMITY — the ONE ZIP-mode admission door ──────────
  // (founder rule, restated 2026-09-22 for EVERY Map 1 Type and EVERY source.) A record may
  // appear on a ZIP-mode page only on CANONICAL MEMBERSHIP EVIDENCE produced by the server,
  // and this module READS that evidence — it never re-decides it. Two evidence forms exist:
  //
  //   1. AUTHORITATIVE DEVELOPMENT — a site built by zipAuthSiteFromMarker from a COMPLETE
  //      app_zip_projects_markers payload (geo.zip_authoritative_membership / _marker, exact
  //      ST_Intersects against the ZCTA polygon). `zip_authoritative: true` is set there and
  //      nowhere else.
  //   2. EVERY OTHER POINT — a `zip_membership` verdict stamped by the database's canonical
  //      predicate geo.zip_point_membership_in (docs/zip-membership-canonical.sql): the
  //      facility plane is stamped by the development_reports trigger, the national plane by
  //      public.national_dc_zip_members. Only the verdict 'member' admits.
  //
  // FAILS CLOSED. A point carrying neither form — no stamp, 'not_measured', 'outside',
  // 'no_coordinates', an unknown value, a future source nobody routed through the database —
  // is not admitted. Type (use_type/layer/type/category/type_raw/name) and source provenance
  // are NOT READ HERE AT ALL: they may change what a pin looks like, never whether it is in the
  // ZIP. There is deliberately no distance, centroid or radius anywhere in this door.
  HS.ZIP_MEMBER = 'member';
  HS.zipMemberAdmitted = function (rec) {
    return !!rec && rec.zip_membership === HS.ZIP_MEMBER;
  };

  // ZIP-MODE MERGE of the cached report with authoritative development. The report's own
  // DEVELOPMENT points are candidates (the engine retrieved them around the ZIP centroid) and
  // are REPLACED by authoritative whole-ZIP development — they are never shown. Its other
  // points (the facility plane) pass only on a 'member' verdict. Area / jurisdiction notices
  // (scope 'area') are not point claims and keep their county/city-wide treatment.
  HS.zipAuthMergeSites = function (reportSites, authSites) {
    const kept = (reportSites || []).filter(function (s) {
      if (!s) return false;
      if (s.scope !== 'point') return true;                 // area notices: not a point claim
      if (s.relevance === 'development') return false;      // candidates, replaced below
      return HS.zipMemberAdmitted(s);                       // facility plane: evidence or out
    });
    return kept.concat((authSites || []).filter(function (s) { return s && s.zip_authoritative === true; }));
  };

  // THE WHOLE ZIP-MODE POPULATION, assembled in one place so no plane can be appended beside
  // it. `nationalSites` are the national plane's records already mapped to sites; each must
  // carry the server's `zip_membership`, and the whole plane additionally requires this ZIP's
  // geography to be complete (Fix 29 — one definition, delegated). A future plane is added
  // HERE, with its evidence, or it does not reach the map.
  HS.zipModeSites = function (reportSites, authPayload, nationalSites) {
    const natl = HS.nationalPlaneAdmitted(authPayload)
      ? (nationalSites || []).filter(HS.zipMemberAdmitted) : [];
    return HS.zipAuthMergeSites(reportSites, HS.zipAuthSitesFrom(authPayload)).concat(natl);
  };

  // Is the FACILITY plane of this cached report a MEASUREMENT? True only when every facility-
  // plane point carries a canonical verdict other than 'not_measured'. A ZIP with no usable
  // boundary is stamped 'not_measured' by the trigger, and a row the trigger has not yet
  // rewritten carries no stamp — in both cases the count is UNKNOWN on a ZIP page, never 0.
  HS.zipFacilityPlaneMeasured = function (reportSites) {
    return (reportSites || []).every(function (s) {
      if (!s || s.scope !== 'point' || s.relevance === 'development') return true;
      return s.zip_membership === HS.ZIP_MEMBER || s.zip_membership === 'no_coordinates';
    });
  };

  // ── FIX 29 — PROXIMITY IS NOT MEMBERSHIP ─────────────────────────────────────────────────
  // HISTORY (the read below is now public.national_dc_zip_members): the national data-center
  // plane (public.national_dc_for_zip) selected records within a
  // 5-mile great-circle radius of `development_reports.home_lat/home_lng` — a ZIP CENTROID.
  // That is a proximity search. It says a record is NEAR a point; it says nothing about which
  // ZIP the record is in. On a ZIP page with no authoritative whole-ZIP geography, distance
  // from that centroid was the ONLY thing deciding membership: measured on production
  // 2026-09-15, 351 of the 706 canonical ZIP pages carrying no ZCTA polygon rendered 1,597
  // dot placements drawn from just 141 records, every one admitted by distance alone.
  //
  // This is rule 1 stated from the other side. Where whole-ZIP geography does not exist the
  // page returns the honest not-measured state instead of substituting — and a circle around
  // the ZIP centre is precisely the substitution HS.zipAuthNote promises not to make ("we
  // will not estimate it from a circle around the ZIP centre"). That promise was being
  // printed on the same map as these dots.
  //
  // ONE DEFINITION, REUSED — NOT A SECOND NOTION OF "USABLE ZIP GEOGRAPHY". The admission
  // test is zipAuthOutcome, read off the payload the page has ALREADY fetched, so this adds
  // no request, no new status vocabulary and nothing to keep in sync. Measured the same day:
  // status 'boundary_complete' holds for exactly the 12,013 canonical ZIPs that carry a
  // geo.zcta_boundary polygon, and 'not_measured' for exactly the 706 that do not, with ZERO
  // contradictory rows — so the outcome IS polygon availability here rather than a proxy for
  // it. (public.app_zcta_boundary would state it more directly and is NOT anon-executable,
  // so it cannot gate an anonymous page load; this signal can.)
  //
  // IT FAILS CLOSED, DELIBERATELY. 'unavailable' refuses alongside 'not_measured'. A failed
  // read tells us nothing about this ZIP's geography, and admitting proximity membership on
  // the strength of an answer we never received is the same fabrication from another angle.
  //
  // WHAT THIS IS NOT. It is the plane-level half only. Record-level membership is the
  // server's verdict on each row (public.national_dc_zip_members, canonical predicate), read by
  // HS.zipModeSites above — so a ZIP that HAS geography no longer shows a national record near
  // its centroid but outside its boundary, and no longer loses one inside it beyond 5 miles.
  // It DELEGATES to HS.zipAuthIsComplete rather than re-testing the outcome itself. That
  // predicate already IS this project's definition of "usable ZIP geography"; a second copy
  // of `zipAuthOutcome(...) === 'complete'` here would be a second definition to keep in
  // sync, and the day they diverge the divergence is silent. This name states only what is
  // being gated, never what "usable" means.
  HS.nationalPlaneAdmitted = function (payload) {
    return HS.zipAuthIsComplete(payload);
  };

  // ZIP 3D / 2D FRAME. The camera may not look at a ZIP centroid, a 3-mile radius, or any
  // other invented centre. The only honest frame is the bounding box of the records that
  // actually belong on this ZIP page (their own lat/lng). The returned lat/lng is the
  // midpoint of that box — camera math, never a drawn point and never a HOME.
  // No point records → null. The page must not substitute a centroid.
  HS.zipFrameFromSites = function (sites) {
    var minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity, n = 0;
    (sites || []).forEach(function (s) {
      if (!s || s.scope !== 'point') return;
      var lat = s.lat, lng = s.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      if (!isFinite(lat) || !isFinite(lng)) return;
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
      n++;
    });
    if (!n) return null;
    var lat = (minLat + maxLat) / 2;
    var lng = (minLng + maxLng) / 2;
    var spanN = (maxLat - minLat) * 69;
    var spanE = (maxLng - minLng) * 69 * Math.cos(lat * Math.PI / 180);
    // A single record has zero span. 0.4 mi is camera padding so the view is not infinitely
    // zoomed — it is not a ZIP radius and must never be drawn as one.
    var spanMi = Math.max(spanE, spanN, 0.4);
    return {
      lat: lat, lng: lng, spanMi: spanMi, n: n,
      south: minLat, north: maxLat, west: minLng, east: maxLng
    };
  };

  // WHAT A NON-COMPLETE OUTCOME MEANS, IN WORDS — owned here because a SECOND surface now
  // consumes this vocabulary and the one thing that must not happen is a second copy of
  // these two sentences growing on it. The ZIP community page reaches the same two outcomes
  // through `app_projects_for_zip` (see zipAuthOutcome above) and has no address box, so it
  // takes the FACT and stops; Map 1 takes the fact and appends its own invitation. Splitting
  // them that way is what lets one page offer a control the other does not have WITHOUT
  // either page writing its own words for "not measured" or "could not be read".
  //
  // Keyed on the OUTCOME, not on a payload, because the community page's reader has already
  // classified (lib/data.js::rpcAllRows delegates to zipAuthOutcome) and re-deriving from a
  // reconstructed envelope would be the rival definition this module exists to prevent.
  // 'complete' returns '' — a complete read's sentence depends on its rows, which is
  // zipAuthNote's job below and the calling page's job on the community page.
  HS.zipAuthUnmeasuredFact = function (outcome, zip) {
    const z = zip ? ('ZIP ' + zip) : 'this ZIP';
    if (outcome === 'not_measured') {
      return 'Development coverage for ' + z + ' is not measured yet — we will not estimate it '
           + 'from a circle around the ZIP centre.';
    }
    if (outcome === 'unavailable') {
      return 'Development coverage for ' + z + ' could not be read just now.';
    }
    return '';
  };

  // The one honest sentence about what the resident is looking at.
  HS.zipAuthNote = function (payload, zip, sites) {
    const z = zip ? ('ZIP ' + zip) : 'this ZIP';
    const outcome = HS.zipAuthOutcome(payload);
    // Byte-for-byte what this returned before the fact was factored out — pinned by test,
    // because a refactor that quietly reworded a resident-facing sentence on 1,259 live
    // Map 1 pages would be indistinguishable from an intentional copy change.
    if (outcome === 'not_measured') {
      return HS.zipAuthUnmeasuredFact(outcome, zip) + ' Enter an address for the live view '
           + 'around that address.';
    }
    if (outcome === 'unavailable') {
      return HS.zipAuthUnmeasuredFact(outcome, zip);
    }
    const n = HS.zipAuthProjectCount(sites);
    if (n === 0) {
      return 'No qualifying development records across ' + z + '. This is a measurement of the '
           + 'whole ZIP, not an empty search.';
    }
    return n + (n === 1 ? ' project' : ' projects') + ' across the whole of ' + z + '.';
  };
})();
