// HomeSignal data layer — ONE interface, two backends.
//   DATA_SOURCE='seed'      -> window.HS_SEED (the artifact preview; zero DB)
//   DATA_SOURCE='supabase'  -> live project, app_* tables via anon key + RLS (REAL data)
// Distances are ALWAYS computed here from the active property (never stored).
// DATA-QUALITY GATE: community() returns data_quality ('pass' | 'coverage_coming');
// a ZIP only renders the full page when it has real, sourced app data.
(function () {
  const HS = (window.HS = window.HS || {});
  const CFG = window.HS_CONFIG;

  let _sb = null;
  function sb() {
    if (!_sb && window.supabase) _sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    return _sb;
  }
  HS.sb = sb;
  const isSeed = () => (CFG.DATA_SOURCE || 'seed') === 'seed';

  // ------------------------------------------- the upcoming-meetings boundary ----
  // ⛔ `meetings.meeting_date` IS SEMANTICALLY A DATE, NOT AN INSTANT, so it must never
  // be compared against `now()` as one. Measured 2026-09-13 over all 2,574 upcoming
  // meetings (lib/dashboard-aggregate.js carries the full receipt): 1,475 sit at exactly
  // 06:00:00Z and 1,005 at exactly 07:00:00Z — midnight MDT and midnight MST/PDT, i.e. a
  // date stored in the body's own local zone. That is 2,480 of 2,574 = 96.3%, and the
  // correlation with the STATED `meeting_time` column is perfect in both directions.
  //
  // So `.gte('meeting_date', new Date().toISOString())` dropped a meeting from "upcoming"
  // at LOCAL MIDNIGHT ON THE DAY IT HAPPENS — a 9 AM council meeting left the tile before
  // anyone woke up, every time, and the tile could only ever show meetings on LATER days.
  // Measured 2026-09-21 against production: that costs 347 of 12,722 canonical ZIP pages a
  // filled Upcoming Meetings tile (4,742 -> 5,089), and 27 of Utah's 310 (207 -> 234).
  //
  // The boundary is therefore the VIEWER'S OWN CALENDAR DATE at 00:00Z. Every US local
  // midnight lands at 04:00–08:00Z on its own date, so a meeting dated today survives the
  // comparison while yesterday's does not — in any US zone, at any hour of the day.
  //
  // ⚠️ THIS IS ONE DECISION WITH THREE CALL SITES, and the third is in another language:
  // meetings(), meetingsForZips(), and scripts/gen_zip_pages.py (which builds the static
  // /community/<zip>/ documents a crawler sees). They must agree or the served page and
  // the live page disagree about the same ZIP. test/meetings-upcoming-window.test.mjs
  // pins all three, including the Python one, and fails if any drifts.
  function upcomingCutoffIso(now) {
    const d = now ? new Date(now) : new Date();
    const ymd = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
                 String(d.getDate()).padStart(2, '0')].join('-');
    return ymd + 'T00:00:00.000Z';
  }
  HS.upcomingCutoffIso = upcomingCutoffIso;

  function distanceMi(aLat, aLng, bLat, bLng) {
    if ([aLat, aLng, bLat, bLng].some(v => v == null || isNaN(v))) return null;
    const R = 3958.7613, toR = d => (d * Math.PI) / 180;
    const dLat = toR(bLat - aLat), dLng = toR(bLng - aLng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  const fmtMi = mi => mi == null ? '' : (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' mi';
  HS.distanceMi = distanceMi; HS.fmtMi = fmtMi;
  function withDistance(items, home) {
    const hLat = home && home.lat, hLng = home && home.lng;
    return (items || []).map(it => {
      const mi = distanceMi(hLat, hLng, it.lat, it.lng);
      return Object.assign({}, it, { distance_mi: mi, dist: fmtMi(mi) });
    });
  }
  HS.withDistance = withDistance;
  // Distances are only meaningful from a home IN this ZIP's area. For a visitor who
  // hasn't set their own place, activeProperty is the Del Valle SAMPLE home — measuring
  // a Utah facility from a Texas house would be a fabricated number. No home -> no dist.
  function homeFor(zip, home) {
    return (home && home.zip === zip) ? home : null;
  }
  HS.homeFor = homeFor;

  // ---- normalizers: shape supabase rows into what the templates expect ----
  function factualSowhat(p) {
    // anti-fabrication: for a named real record, describe the FACT, don't invent impacts
    const bits = [];
    if (p.type) bits.push(p.type);
    if (p.status) bits.push(p.status.toLowerCase());
    if (p.size) bits.push(p.size);
    if (p.investment) bits.push(p.investment);
    let s = bits.join(' · ');
    if (p.developer) s += (s ? ' — ' : '') + p.developer;
    return s || 'On file with the county — see the official record.';
  }
  function normProject(p) {
    return Object.assign({}, p, {
      lens: p.lens || 'value',
      sowhat: p.sowhat || factualSowhat(p),
      // TRUE when the line above generated a factual spec summary (type · status ·
      // size) because the record carries no written narrative — cards must then
      // label it "On the record", never "How it impacts you" (that would claim
      // an impact statement the record doesn't make).
      sowhat_factual: !p.sowhat,
      impact_dimensions: p.impact_dimensions || []   // no invented chips for named facilities
    });
  }
  function normChange(c) {
    return Object.assign({}, c, { impacts: c.impacts || [], lens: c.lens || 'traffic' });
  }
  function normMeeting(m) {
    return {
      id: m.id, body: m.title, title: m.title,
      // category MUST survive normalization: alerts.html::meetingAsChange reads
      // `m.category` to group the Meetings tab under the canonical topic headings.
      // Dropping it here silently collapsed every meeting into one generic
      // "Upcoming Meetings" group, so the 6 topic tiles never appeared.
      category: m.category,
      attendance_mode: m.attendance_mode,   // in_person | video | hybrid | null (null = omit the chip)
      starts_at: m.meeting_date, location: m.location,
      lat: m.geo_lat, lng: m.geo_lng,
      related_project_id: null, source_ref: m.source_url,
      window_closes_at: m.is_public_hearing ? m.meeting_date : null
    };
  }

  // ---- range-windowed full fetch (Maps uncap, Phase 1) ----
  // PostgREST silently caps un-paginated reads at 1,000 rows, so once the
  // materializer's 48/16 caps lift, a single-shot app_projects read would
  // silently truncate dense ZIPs (worst live ZIP: 5,424 dev records).
  // fetchAllPages() re-issues the caller's query in 1,000-row windows until a
  // short page. The caller's order MUST be total (e.g. submitted_at desc + id
  // tiebreak) so windows never skip or repeat a row. Returns { rows, complete }:
  // complete=false means a page failed (after one retry) — callers must treat
  // that as a failed read, NEVER render the prefix as if it were the full set.
  const PAGE_ROWS = 1000;
  async function fetchAllPages(build) {
    const rows = [];
    for (let from = 0; ; from += PAGE_ROWS) {
      let { data, error } = await build().range(from, from + PAGE_ROWS - 1);
      if (error) ({ data, error } = await build().range(from, from + PAGE_ROWS - 1)); // one retry per window
      if (error || !data) return { rows, complete: false };
      for (const r of data) rows.push(r);
      if (data.length < PAGE_ROWS) return { rows, complete: true };
    }
  }
  HS.fetchAllPages = fetchAllPages;   // exported for test/maps-pagination.test.mjs

  // ---- single-payload read (Maps uncap, Phase 2) ----
  // WHY THIS REPLACED THE WINDOWED READ FOR projects()/facilities(). PostgREST caps
  // EVERY response at 1,000 rows and the cap is service-side — `limit=5000` and
  // `limit=25000` both return exactly 1,000 (measured on app_projects?zip=eq.57104).
  // So a dense ZIP cost one round trip per 1,000 rows: 57104's 19,584 records meant
  // TWENTY sequential requests, and the page did not finish inside ~6.5 s (it did
  // finish by 15 s — slow, never truncated).
  // ⛔ RAISING PAGE_ROWS IS NOT THE FIX AND IS WORSE THAN NO FIX: fetchAllPages stops
  // on `data.length < PAGE_ROWS`, so PAGE_ROWS=5000 would read the first capped
  // 1,000-row response as a short page and return 1,000 of 19,584 records with
  // complete:true — silent truncation reported as a complete read.
  // The RPC returns ONE row containing a jsonb array, which the row cap cannot
  // truncate. Same contract: { rows, complete }, complete=false on any failure so
  // callers still refuse to render a partial set.
  async function rpcAllRows(zip, kind) {
    for (let attempt = 0; attempt < 2; attempt++) {          // one retry, as fetchAllPages does
      const { data, error } = await sb().rpc('app_projects_for_zip', { p_zip: zip, p_kind: kind });
      if (!error && Array.isArray(data)) return { rows: data, complete: true };
    }
    return { rows: [], complete: false };
  }
  HS.rpcAllRows = rpcAllRows;          // exported for test/maps-pagination.test.mjs

  // ── NATIONAL DATA-CENTER PLANE — READ OUTCOME ────────────────────────────────────────
  // A FAILED READ MUST NEVER BE INDISTINGUISHABLE FROM A LEGITIMATE ZERO.
  //
  // This is the same rule lib/zip-authoritative.js states as its rule 1 ("`null` IS NOT
  // `[]`"), applied to the third plane. Before this existed, the national read collapsed
  // a permission error, a 5xx, a timeout, a dropped connection, a malformed payload and a
  // plane that is not deployed into the SAME resident-visible result as "no eligible
  // national data centers near this ZIP" — a claim that costs nothing when it is true and
  // is a fabricated absence when it is not.
  //
  // Pure on purpose: no fetch, no DOM, no globals. It classifies ONE read so both call
  // sites (lib/data.js::nationalDataCenters and homesignalmap.html's ZIP-mode Promise.all)
  // decide the same way and cannot drift apart.
  //
  // `records` is ALWAYS an array, so every caller keeps rendering a graceful empty map on
  // failure; `status` is what says whether that emptiness is a measurement or a miss.
  HS.NATIONAL_PLANE_OK = 'ok';
  HS.NATIONAL_PLANE_UNAVAILABLE = 'unavailable';

  HS.nationalPlaneResult = function (r) {
    const fail = function (reason, http) {
      return { status: HS.NATIONAL_PLANE_UNAVAILABLE, reason: reason, http: http,
               records: [], truncated: false };
    };
    // Nothing came back at all: network drop, DNS, CORS, abort, or a client-side timeout.
    // supabase-js reports these as an `error` with no HTTP status, fetch as a rejection.
    if (!r || typeof r !== 'object') return fail('network', null);
    if (r.transportError) return fail('network', null);
    const http = typeof r.http === 'number' ? r.http : null;
    if (http === null) return fail('network', null);
    // 401/403 is the SECURITY DEFINER / grant posture failing — the exact defect that shipped
    // the plane returning nothing while looking healthy. It must never read as a zero.
    if (http === 401 || http === 403) return fail('permission', http);
    // PostgREST answers 404 when the function itself is absent, which is "the plane is not
    // deployed here", not "this ZIP has none". Kept separate so a rollback is legible.
    if (http === 404) return fail('not_deployed', http);
    if (http < 200 || http >= 300) return fail('server', http);
    // 2xx carrying something that is not a row array — a PostgREST error object, HTML from a
    // proxy, or truncated JSON. Shape is checked because a 200 does not promise rows.
    if (!Array.isArray(r.body)) return fail('malformed', http);
    // A row that is not an object carries no record and would throw the moment a caller
    // read a field off it. Drop those rather than let them reach a `.map()`.
    const rows = r.body.filter(function (x) { return x && typeof x === 'object'; });
    // ...but an array that was NON-EMPTY and survives as EMPTY is a malformed payload, not
    // a real zero. Collapsing it to `ok` with 0 records would reintroduce the exact defect
    // this function exists to remove, one level down.
    if (r.body.length > 0 && rows.length === 0) return fail('malformed', http);
    // TRUNCATION IS A THIRD STATE. The read SUCCEEDED, so status stays 'ok' — but the set
    // is not the whole set, and reporting a clipped set as complete is the same dishonesty
    // as reporting a failure as a zero. The server says so per row via has_more.
    // Measured 2026-09-15 across all 12,722 canonical ZIPs: `limit 200` silently clipped
    // ZIP 20166 (Sterling VA) at 203 records. The cap is now 1000 and it reports itself.
    const truncated = rows.length > 0 && rows[0].has_more === true;
    return { status: HS.NATIONAL_PLANE_OK, reason: null, http: http,
             records: rows, truncated: truncated };
  };

  async function resolveCommunity(zip) {
    const { data } = await sb().from('communities')
      .select('id,name,parent_id,county,state,zip_codes,level,government_topics').contains('zip_codes', [zip]);
    if (!data || !data.length) return null;
    const rank = { zip: 0, neighborhood: 0, city: 1, county: 2 };
    return data.slice().sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3))[0];
  }

  const data = {
    async community(zip) {
      zip = zip || CFG.DEFAULT_ZIP;
      if (isSeed()) { const c = window.HS_SEED.community; return c.zip === zip ? c : null; }
      const { data } = await sb().from('app_community_meta').select('*').eq('zip', zip).limit(1);
      const meta = data && data[0];
      if (!meta) return null;
      // Derive a display score transparently from the real component bars (no vanity metric).
      if (meta.community_score == null && meta.component_scores) {
        const pcts = Object.values(meta.component_scores).map(x => x && x.pct).filter(n => typeof n === 'number');
        if (pcts.length) meta.community_score = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
      }
      return Object.assign({ slug: null }, meta, { zip: meta.zip });
    },
    async coverageStatus(zip) {   // 'pass' | 'coverage_coming' | null(not covered)
      if (isSeed()) return window.HS_SEED.coverage.some(c => c.zip === zip) ? 'pass' : null;
      const { data } = await sb().from('app_community_meta').select('data_quality').eq('zip', zip).limit(1);
      return data && data[0] ? data[0].data_quality : null;
    },
    // Phase 2 ADDITIVE coverage-state model — reads the computed app_coverage_states
    // view. TWO INDEPENDENT PLANES (EPA/regulatory decoupling, Unit 2):
    //   coverage_state            CORE project plane only — populated | honestly_empty |
    //                             unsupported_source | temporarily_unavailable |
    //                             failed_ingest | stale_data. It never reads EPA counts.
    //   regulatory_overlay_state  the EPA/FRS overlay — overlay_records | overlay_empty |
    //                             overlay_unknown | overlay_unsupported, with its own
    //                             clock in facilities_refreshed_at.
    // A page that shows both COMPOSES them; neither is derivable from the other. The
    // pre-split `facilities_only` was the composition collapsed into the core enum.
    //
    // ⚠️ SELECT * ON PURPOSE, and it is load-bearing rather than lazy. Naming a column
    // PostgREST does not have 400s the whole request, which this catch turns into a
    // null — so a page would silently lose its coverage copy AND its
    // data-coverage-state attribute in the window between this code shipping and the
    // view migration being applied. `*` is correct against both shapes; the read is one
    // row, already filtered by zip.
    // Fails soft (null) so a missing view can never break a page.
    async coverageState(zip) {
      if (isSeed()) return null;
      try {
        const { data } = await sb().from('app_coverage_states')
          .select('*').eq('zip', zip).limit(1);
        return data && data[0] ? data[0] : null;
      } catch (_e) { return null; }
    },
    async isCovered(zip) {
      if (isSeed()) return window.HS_SEED.coverage.some(c => c.zip === zip && c.covered);
      const { data } = await sb().from('app_community_meta').select('zip').eq('zip', zip).limit(1);
      return !!(data && data.length);
    },
    async projects(zip, home) {
      // DEVELOPMENT only (permits / planning notices). Guardrail #3: EPA/ECHO regulated
      // facilities are NOT development — they come from facilities() and render in their
      // own "Regulated facilities nearby" section, never here.
      zip = zip || CFG.DEFAULT_ZIP;
      home = homeFor(zip, home);
      if (isSeed()) return withDistance(window.HS_SEED.projects.slice(), home);
      // Recency order, NOT impact_score: the stored scores are status constants
      // (Proposed=72 > Approved=55), so score-ordering put every Proposed record
      // first and the pages' display caps starved Approved records out entirely —
      // the same bug the materializer already fixed once on its side.
      // Single-payload read (see rpcAllRows): the RPC applies the SAME total order
      // server-side (submitted_at desc nulls last, then id), so the sequence the page
      // renders is unchanged. `complete` rides on the returned array — false means the
      // read failed; maps.html treats that as a load failure rather than presenting a
      // truncated set.
      const res = await rpcAllRows(zip, 'development');
      const out = withDistance(res.rows.map(normProject), home);
      out.complete = res.complete;
      return out;
    },
    async facilities(zip, home) {
      // Regulated facilities (EPA FRS/ECHO, status 'Operating') — environmental context,
      // shown in a clearly-labeled section, never under Development / what's changing.
      zip = zip || CFG.DEFAULT_ZIP;
      home = homeFor(zip, home);
      if (isSeed()) return withDistance((window.HS_SEED.facilities || []).slice(), home);
      // Same single-payload read as projects() above; the RPC orders facilities by
      // name asc then id, matching what this call ordered by before.
      const res = await rpcAllRows(zip, 'facility');
      const out = withDistance(res.rows.map(normProject), home);
      out.complete = res.complete;
      return out;
    },
    // NATIONAL DATA-CENTER PLANE — the third plane, and the ONLY one that is not
    // jurisdiction-gated. It reads public.national_dc_for_zip, which asks nothing about
    // registry coverage, so a record plots in a county with no permit/planning connector.
    // Local connector rules are untouched: projects() above still reads app_projects.
    //
    // NOT app_projects ON PURPOSE: app_refresh_zip deletes app_projects rows whose
    // last_seen_at predates its run, and that cron fires every 2 minutes — national rows
    // written there would be wiped. Read live, exactly like EPA FRS.
    //
    // The RPC returns ONLY map_eligible rows (real source URL + real coordinates +
    // displayable status), so nothing unsourced can reach the map through this path.
    // ⚠️ ODbL: any surface that displays these records must carry the source attribution
    // exposed as `source_name` on every row.
    async nationalDataCenters(zip, home, radiusMi) {
      zip = zip || CFG.DEFAULT_ZIP;
      home = homeFor(zip, home);
      if (isSeed()) {
        const seeded = withDistance((window.HS_SEED.national_dc || []).slice(), home);
        seeded.complete = true;
        seeded.plane = { status: 'ok', reason: null, http: null, truncated: false };
        return seeded;
      }
      const { data, error } = await sb().rpc('national_dc_for_zip',
        { p_zip: zip, p_radius_mi: radiusMi || 5 });
      // A FAILED READ IS NOT AN EMPTY ONE. This used to be `if (error) return []`, which made a
      // permission error, a server error, a timeout and a malformed payload indistinguishable
      // from "no eligible national data centers near this ZIP" - the same collapse
      // lib/zip-authoritative.js rule 1 forbids for the authoritative plane ("`null` IS NOT
      // `[]`"). The page still gets an array so nothing downstream breaks, but it now carries
      // WHICH of the two happened, exactly as rpcAllRows' `complete` does above.
      const outcome = HS.nationalPlaneResult(
        error ? { transportError: true } : { http: 200, body: data }
      );
      const rows = outcome.records.map(function (r) {
        return {
          id: r.source_key,
          name: r.project_name,
          // Map 1's pin vocabulary is PERMIT status (Proposed/Approved/Operating). The
          // source's own lifecycle word is carried separately and unmodified so the popup
          // can state what the source actually said rather than our bucket for it.
          status: r.normalized_status === 'operational' ? 'Operating' : 'Approved',
          normalized_status: r.normalized_status,
          raw_status: r.raw_status,
          type: 'datacenter',
          record_kind: 'national_project',
          developer: r.developer_or_operator || null,
          lat: r.lat, lng: r.lng, scope: 'point',
          location_precision: r.location_precision,
          location_text: r.location_text || null,
          record_url: r.source_url,               // the anti-fabrication gate reads this
          url: r.source_url,
          source_name: r.source_name,
          source_key: r.source_key,
          distance_mi: r.distance_mi
        };
      });
      const out = withDistance(rows.map(normProject), home);
      // Same contract the sibling planes use: `complete === false` means the read failed,
      // never that the ZIP is empty. `plane` carries why, for diagnostics.
      out.complete = outcome.status === 'ok' && !outcome.truncated;
      out.plane = { status: outcome.status, reason: outcome.reason, http: outcome.http,
                    truncated: !!outcome.truncated };
      return out;
    },
    async changes(zip, home) {
      zip = zip || CFG.DEFAULT_ZIP;
      home = homeFor(zip, home);
      if (isSeed()) return withDistance(window.HS_SEED.changes.slice(), home);
      const { data } = await sb().from('app_changes').select('*').eq('zip', zip).order('occurred_at', { ascending: false });
      // Local News is materialized into app_changes too (one canonical pipeline), but it is
      // a distinct customer-facing section served by news() below. Keep it OUT of the general
      // "what's changing" feed so Government Notices, Meetings, and every changes() consumer
      // (today / dashboard / maps / community / property / index) are unchanged. Filtered
      // client-side (not via .neq) so rows with a null category are never dropped.
      const rows = (data || []).filter(function (c) { return c.category !== 'Local News'; });
      return withDistance(rows.map(normChange), home);
    },
    async news(zip, home) {
      // Local News tab — the SAME materialized app_changes table, category-scoped. Not a
      // second pipeline: news is produced by the app_refresh_zip materializer alongside
      // notices/meetings and read here exactly like meetings() reads its own rows.
      zip = zip || CFG.DEFAULT_ZIP;
      home = homeFor(zip, home);
      if (isSeed()) return withDistance((window.HS_SEED.changes || []).filter(function (c) { return c.category === 'Local News'; }), home);
      const { data } = await sb().from('app_changes').select('*')
        .eq('zip', zip).eq('category', 'Local News').order('occurred_at', { ascending: false });
      return withDistance((data || []).map(normChange), home);
    },
    async meetings(zip, home) {
      zip = zip || CFG.DEFAULT_ZIP;
      home = homeFor(zip, home);
      if (isSeed()) return withDistance(window.HS_SEED.meetings.slice(), home);
      const c = await resolveCommunity(zip);
      if (!c) return [];
      // The full ancestor CHAIN, not just one hop: a normalized pilot ZIP row sits
      // under its city, which sits under the county — meetings can live on any
      // ancestor level. For the common zip→county shape (parent IS the chain root)
      // this is byte-identical to the old [c.id, c.parent_id].
      const ids = [c.id];
      let up = c, hops = 0;
      while (up && up.parent_id && hops++ < 6) {   // hop cap guards against a parent_id cycle
        ids.push(up.parent_id);
        const { data: pr } = await sb().from('communities').select('id,parent_id').eq('id', up.parent_id).limit(1);
        up = pr && pr[0];
      }
      // Sibling-exclusion: county-root meetings include EVERY city's council (category
      // "City government (X)"). Only this ZIP's own place(s) — parsed from the community
      // name, e.g. "Provo (84601)" or "Salt Lake City / Millcreek (84106)" — may show;
      // county-level topics always show. Otherwise a Provo page headlines Alpine's council.
      const places = (c.name || '').replace(/\s*\(\d{5}\)\s*$/, '')
        .split('/').map(s => s.trim().toLowerCase()).filter(Boolean);
      const { data } = await sb().from('meetings').select('*').in('community_id', ids)
        .gte('meeting_date', upcomingCutoffIso()).order('meeting_date', { ascending: true }).limit(24);
      const scoped = (data || []).filter(m => {
        const city = /^City government \((.+)\)$/.exec(m.category || '');
        return !city || places.indexOf(city[1].toLowerCase()) !== -1;
      }).slice(0, 12);
      return withDistance(scoped.map(normMeeting), home);
    },

    // ====================== ALL MY PLACES readers (Fix 8, ADDITIVE) ======================
    // Every method above is per-ZIP and stays byte-for-byte as it was — the Dashboard is
    // the only caller of what follows, and nothing else changed shape.
    //
    // THE QUERY SHAPES WERE MEASURED, AND THE OBVIOUS ONE IS WRONG FOR DEVELOPMENT.
    // A single .in(zips) is right for app_changes (2.1 ms over 5 ZIPs) and catastrophic for
    // app_projects: with five dense ZIPs the planner abandons the ordered index scan for a
    // bitmap heap scan over 97,052 index entries and top-N sorts — 17,566 ms measured. The
    // same rows via eq(zip) + limit let app_projects_zip_kind_date_idx serve the order
    // directly and stop at the limit: 0.661 ms, 12 buffers. So development is N small bounded
    // queries and everything else is one. Nothing here adds an index, a view or a migration.

    // One query, every monitored ZIP. Local News is INCLUDED (the Dashboard renders it as its
    // own type), which is the one deliberate difference from changes() above — that method
    // filters it out because its consumers have a separate news() section.
    async changesForZips(zips, limit) {
      zips = (zips || []).filter(function (z) { return /^\d{5}$/.test(String(z)); });
      if (!zips.length) return [];
      if (isSeed()) {
        var sz = window.HS_SEED.community.zip;
        if (zips.indexOf(sz) < 0) return [];
        return (window.HS_SEED.changes || []).map(function (c) {
          return Object.assign({}, normChange(c), { zip: sz });
        });
      }
      const { data, error } = await sb().from('app_changes')
        .select('id,zip,category,title,plain_language,occurred_at,source_ref,window_closes_at,related_project_id,lat,lng')
        .in('zip', zips)
        .order('occurred_at', { ascending: false })
        .limit(limit || 120);
      if (error) throw error;                 // a failed read is NEVER an empty read
      return (data || []).map(normChange);
    },

    // ONE ZIP, bounded, ordered by the index. See the note above for why this is not .in().
    // record_kind='development' only — EPA/regulated facilities are a separate plane and are
    // not "what's changing" (source-adapter guardrail #3).
    async developmentForZip(zip, limit) {
      if (!/^\d{5}$/.test(String(zip))) return [];
      if (isSeed()) {
        if (String(zip) !== window.HS_SEED.community.zip) return [];
        return (window.HS_SEED.projects || []).slice(0, limit || 8)
          .map(function (p) { return Object.assign({}, normProject(p), { zip: String(zip) }); });
      }
      const { data, error } = await sb().from('app_projects')
        .select('id,zip,name,type,status,submitted_at,source_ref,lat,lng,address')
        .eq('zip', String(zip))
        .eq('record_kind', 'development')
        .order('submitted_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .limit(limit || 8);
      if (error) throw error;
      return (data || []).map(normProject);
    },

    // ---- ALL-PLACES READ FOR THE MY PLACES STRIP -------------------------------------
    // The strip used to read the VIEWED ZIP alone and say so ("· ZIP 78617"), which was
    // honest but is not what My Places is about. This measures the resident's WHOLE
    // membership instead. Additive: no existing method changes.
    //
    // ⛔ THE DEVELOPMENT HALF IS DELIBERATELY *NOT* HERE, and the reason is the finding.
    // The obvious cheap implementation — a head-only `count: 'exact'` over
    // `app_projects.zip` — counts a DIFFERENT POPULATION from the one the page lists.
    // `app_projects_for_zip` routes development through
    // `app_authoritative_projects_for_zip`, which derives its set from
    // `geo.zip_authoritative_membership` (the authoritative ZIP BOUNDARY), not from the
    // `zip` column. Measured 2026-09-15 on the three ZIPs of the reported account:
    //     zip     authoritative (what the page lists)   app_projects.zip
    //     75009                              470                     24
    //     78617                              500                    512
    //     78657                                4                      4
    // Celina would have been understated by 446. The strip therefore counts through the
    // SAME RPC the page already uses (HS.rpcAllRows), so the tile and the list can never
    // disagree — see properties.html. No new RPC, no migration, no second definition.
    //
    // Every change carrying a comment-window date, for the whole membership. Deliberately
    // NOT date-filtered server-side: the shipped predicate is HS.daysUntil(...) >= 0, which
    // resolves in the RESIDENT's local time, and a server-side date comparison would
    // disagree with it at the day boundary — in the direction that drops a window still
    // open for them. The caller applies that one predicate, so there is exactly one
    // definition of "open".
    //
    // Unbounded-looking but measured: the worst single ZIP in production carries FOUR rows
    // with a window_closes_at and the 99th percentile is also 4 (2026-09-15), so the whole
    // membership is tens of rows, not thousands. The limit is a guard, never the plan.
    async openWindowChangesForZips(zips, limit) {
      zips = (zips || []).filter(function (z) { return /^\d{5}$/.test(String(z)); });
      if (!zips.length) return [];
      if (isSeed()) {
        var sz2 = window.HS_SEED.community.zip;
        if (zips.indexOf(sz2) < 0) return [];
        return (window.HS_SEED.changes || [])
          .filter(function (c) { return c && c.window_closes_at; })
          .map(function (c) { return Object.assign({}, normChange(c), { zip: sz2 }); });
      }
      const { data, error } = await sb().from('app_changes')
        .select('id,zip,category,title,occurred_at,source_ref,window_closes_at')
        .in('zip', zips)
        .not('window_closes_at', 'is', null)
        .order('window_closes_at', { ascending: true })
        .limit(limit || 500);
      if (error) throw error;                 // a failed read is NEVER an empty read
      return (data || []).map(normChange);
    },

    // Display labels for the place rail and for a record's place context. One query.
    async communityMetaForZips(zips) {
      zips = (zips || []).filter(function (z) { return /^\d{5}$/.test(String(z)); });
      if (!zips.length) return {};
      if (isSeed()) {
        var c = window.HS_SEED.community, out = {};
        if (zips.indexOf(c.zip) >= 0) out[c.zip] = { zip: c.zip, name: c.name, state: c.state };
        return out;
      }
      const { data, error } = await sb().from('app_community_meta')
        .select('zip,name,county,state').in('zip', zips);
      if (error) throw error;
      const byZip = {};
      (data || []).forEach(function (r) { byZip[r.zip] = r; });
      return byZip;
    },

    // Meetings for every monitored ZIP, in a BOUNDED number of queries regardless of how
    // many places there are: one overlaps() for the leaf communities, at most six level
    // reads to walk the chains, and one meetings read. The per-ZIP path above costs up to
    // eight queries PER ZIP, which is the fan-out this replaces.
    //
    // SIBLING EXCLUSION IS PRESERVED PER ZIP, not dropped in the batch. A county root carries
    // every city's council under "City government (X)"; each ZIP may only see its own place's,
    // exactly as meetings() already decides it — otherwise a Provo page headlines Alpine's
    // council. Each meeting is attributed to every monitored ZIP whose own chain contains its
    // community AND whose own place names admit it, so one county meeting legitimately
    // reaching three of the resident's ZIPs is ONE row that says so.
    async meetingsForZips(zips, limit) {
      zips = (zips || []).filter(function (z) { return /^\d{5}$/.test(String(z)); });
      if (!zips.length) return [];
      if (isSeed()) {
        var sz = window.HS_SEED.community.zip;
        if (zips.indexOf(sz) < 0) return [];
        return (window.HS_SEED.meetings || []).map(function (m) {
          return { id: m.id, title: m.title || m.body, category: m.category || null,
                   meeting_date: m.starts_at, meeting_time: null, location: m.location || null,
                   source_url: m.source_ref || null, is_public_hearing: false,
                   attendance_mode: m.attendance_mode || null, zips: [sz] };
        });
      }

      // leaves: every community that lists one of these ZIPs
      const { data: leaves, error: le } = await sb().from('communities')
        .select('id,name,parent_id,zip_codes,level').overlaps('zip_codes', zips);
      if (le) throw le;

      // Most-specific leaf per ZIP, the same rank meetings() applies.
      const rank = { zip: 0, neighborhood: 0, city: 1, county: 2 };
      const leafFor = {};
      (leaves || []).forEach(function (c) {
        (c.zip_codes || []).forEach(function (z) {
          if (zips.indexOf(z) < 0) return;
          const cur = leafFor[z];
          if (!cur || (rank[c.level] != null ? rank[c.level] : 3) < (rank[cur.level] != null ? rank[cur.level] : 3)) leafFor[z] = c;
        });
      });

      // Walk every chain together: one query per LEVEL, not per ZIP.
      const node = {};
      (leaves || []).forEach(function (c) { node[c.id] = c; });
      const chainOf = {};                       // zip -> [communityId, ...]
      Object.keys(leafFor).forEach(function (z) { chainOf[z] = [leafFor[z].id]; });
      let frontier = Object.keys(chainOf).map(function (z) { return leafFor[z].parent_id; })
        .filter(function (id, i, a) { return id && a.indexOf(id) === i; });
      for (let hop = 0; hop < 6 && frontier.length; hop++) {
        const { data: ups, error: ue } = await sb().from('communities')
          .select('id,name,parent_id,level').in('id', frontier);
        if (ue) throw ue;
        (ups || []).forEach(function (c) { node[c.id] = node[c.id] || c; });
        Object.keys(chainOf).forEach(function (z) {
          const tail = chainOf[z][chainOf[z].length - 1];
          const t = node[tail];
          if (t && t.parent_id && chainOf[z].indexOf(t.parent_id) < 0) chainOf[z].push(t.parent_id);
        });
        frontier = (ups || []).map(function (c) { return c.parent_id; })
          .filter(function (id, i, a) { return id && !node[id] && a.indexOf(id) === i; });
      }

      const allIds = [];
      Object.keys(chainOf).forEach(function (z) {
        chainOf[z].forEach(function (id) { if (allIds.indexOf(id) < 0) allIds.push(id); });
      });
      if (!allIds.length) return [];

      const { data, error } = await sb().from('meetings')
        .select('id,community_id,title,meeting_date,meeting_time,location,category,source_url,is_public_hearing,attendance_mode')
        .in('community_id', allIds)
        .gte('meeting_date', upcomingCutoffIso())
        .order('meeting_date', { ascending: true })
        .limit(limit || 40);
      if (error) throw error;

      // The ZIP's own place names, parsed from its leaf community name exactly as
      // meetings() does ("Provo (84601)" / "Salt Lake City / Millcreek (84106)").
      const placesFor = {};
      Object.keys(leafFor).forEach(function (z) {
        placesFor[z] = String(leafFor[z].name || '').replace(/\s*\(\d{5}\)\s*$/, '')
          .split('/').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
      });

      return (data || []).map(function (m) {
        const hits = Object.keys(chainOf).filter(function (z) {
          if (chainOf[z].indexOf(m.community_id) < 0) return false;
          const city = /^City government \((.+)\)$/.exec(m.category || '');
          return !city || (placesFor[z] || []).indexOf(city[1].toLowerCase()) !== -1;
        });
        return Object.assign({}, m, { zips: hits });
      }).filter(function (m) { return m.zips.length; });
    },

    async envRisk(zip) {
      zip = zip || CFG.DEFAULT_ZIP;
      if (isSeed()) return window.HS_SEED.environmental_risk[zip] || null;
      const { data } = await sb().from('app_environmental_risk').select('*').eq('zip', zip).limit(1);
      return (data && data[0]) || null;   // null -> the parcel env tile shows "coverage coming"
    },
    // Account-scoped lookup for followed projects (My Places). Not ZIP-filtered:
    // a follow is on the project id, and the resident may have changed ZIP since.
    // Absent fields stay absent — this does not geocode or invent an address.
    async projectsByIds(ids) {
      ids = (ids || []).map(function (id) { return id == null ? '' : String(id); }).filter(Boolean);
      if (!ids.length) return [];
      const unique = [];
      const seen = {};
      ids.forEach(function (id) { if (!seen[id]) { seen[id] = 1; unique.push(id); } });
      if (isSeed()) {
        const all = (window.HS_SEED.projects || []).concat(window.HS_SEED.facilities || []);
        const want = {};
        unique.forEach(function (id) { want[id] = 1; });
        return all.filter(function (p) { return want[String(p.id)]; }).map(normProject);
      }
      const { data } = await sb().from('app_projects').select('*').in('id', unique);
      return (data || []).map(normProject);
    },
    async properties() {
      // Keep the stubbed session's demo homes client-side (for the switcher + computed
      // distances) even in supabase mode; real signed-in users read app_properties.
      if (isSeed()) return window.HS_SEED.properties.slice();
      // GATE (config.js:14-20 invariant — enforced by test/signed-out-guard.test.mjs):
      // the seeded demo persona ("4400 Wildhorse Trail") may ONLY enter state.properties
      // under DEMO_SESSION preview (?demo=1). A signed-out production visitor gets [] —
      // never a fabricated home — so it can't leak into the shared chrome as if logged in.
      if (CFG.DEMO_SESSION && (!HS.state || !HS.state.session || HS.state.session.demo)) {
        return window.HS_SEED.properties.map(p => Object.assign({}, p, { sample: true }));
      }
      if (!HS.state.session) return [];
      const { data } = await sb().from('app_properties').select('*').eq('user_id', HS.state.session.user.id).order('created_at');
      return data || [];
    },
    topicCategories() { return window.HS_SEED.topicCategories; },
    // Community government topics + the subscription anchor, from the LIVE chain.
    // Labels come from `communities.government_topics` cascaded UP the chain (own
    // level first, then ancestors, deduped) — never from the seed — so the popup
    // shows this place's real labels word-for-word ("Stratos data center project",
    // "City government (Brigham City)", …). rootId = the chain ROOT (the
    // content-bearing community) — subscriptions always anchor there.
    // Returns null in seed mode or for an unmodeled ZIP (callers fall back / fail loud).
    _govTopicsCache: {},
    async communityGovTopics(zip) {
      zip = zip || CFG.DEFAULT_ZIP;
      if (isSeed()) return null;
      if (this._govTopicsCache[zip]) return this._govTopicsCache[zip];
      let node = await resolveCommunity(zip);
      if (!node) return null;
      const labels = [], seen = {};
      let rootId = node.id, hops = 0;
      while (node && hops++ < 6) {   // hop cap guards against a parent_id cycle
        (node.government_topics || []).forEach(t => { if (!seen[t]) { seen[t] = 1; labels.push(t); } });
        rootId = node.id;
        if (!node.parent_id) break;
        const { data } = await sb().from('communities')
          .select('id,parent_id,government_topics').eq('id', node.parent_id).limit(1);
        node = data && data[0];
      }
      const out = { labels, rootId };
      this._govTopicsCache[zip] = out;
      return out;
    },
    project(id, list) { return (list || []).find(p => p.id === id) || null; }
  };
  HS.data = data;

  // The active property NEVER resolves to a demo/sample home. A signed-out or sample
  // visitor's activeProperty MUST be null, so the fabricated persona ("4400 Wildhorse
  // Trail") can't leak into the shared chrome (top-bar, switcher, search, bell) or be
  // used as a distance anchor (config.js:14-20). shell.js's state.activeProperty getter
  // delegates here; test/signed-out-guard.test.mjs enforces it. Loaded before shell.js
  // on every page (verified), so the getter can rely on it.
  function pickActiveProperty(properties, activePropId) {
    properties = properties || [];
    return properties.find(p => p.id === activePropId && !p.sample)
        || properties.find(p => !p.sample)
        || null;
  }
  HS.pickActiveProperty = pickActiveProperty;

  // ---- Two-step area subscription: the CONSENT CONTRACT, as pure arg builders ----
  // Kept here (not buried in shell.js) so the contract is unit-testable without a DOM:
  //   * FOLLOW (subscribe_area_defaults) carries NO consent column — it can never set
  //     marketing_consent. Following an area is not email consent.
  //   * EMAIL OPT-IN (enable_area_email_alerts) is the ONLY call that carries
  //     marketing_consent_copy + consent_version, and it is the ONLY writer of
  //     marketing_consent=true (server-side, docs/email-optin-consent.sql).
  // test/email-optin.test.mjs pins both shapes.
  HS.followRpcArgs = function (email, communityId, zip, subs) {
    return { p_email: email, p_community_id: communityId, p_zip_code: zip, p_subscriptions: subs };
  };
  HS.optinRpcArgs = function (email, communityId, zip, topics, consentVersion, consentCopy) {
    return {
      p_email: email, p_community_id: communityId, p_zip_code: zip,
      p_topics: topics, p_consent_version: consentVersion, p_marketing_consent_copy: consentCopy
    };
  };
})();
