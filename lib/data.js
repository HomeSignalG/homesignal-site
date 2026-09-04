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

  // ── Unit A4: the projects/markers delivery contract (SHADOW, default OFF) ────────
  // Authoritative geography is NOT the resident path. It is reachable only when a
  // reader explicitly asks for it with ?hs_auth=1, so shipping A4 moves no ZIP onto
  // authoritative results. Everything else keeps calling app_projects_for_zip.
  function authoritativeMode() {
    try {
      if (typeof window === 'undefined' || !window.location) return false;
      return new URLSearchParams(window.location.search).get('hs_auth') === '1';
    } catch (_e) { return false; }
  }
  HS.authoritativeMode = authoritativeMode;

  async function rpcProjectsMarkers(zip, kind, authoritative) {
    const { data, error } = await sb().rpc('app_zip_projects_markers',
      { p_zip: zip, p_kind: kind, p_authoritative: !!authoritative });
    if (error || !data) return null;
    return data;
  }
  HS.rpcProjectsMarkers = rpcProjectsMarkers;

  // Attach each project's OWN marker list by project_ref. A project with several
  // markers stays ONE object — the card grain never follows the geography grain.
  function attachMarkers(projects, markers) {
    const by = new Map();
    (markers || []).forEach(function (mk) {
      if (!mk || mk.project_ref == null) return;
      const k = String(mk.project_ref);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push({ lat: mk.lat, lng: mk.lng, marker_seq: mk.marker_seq, marker_rule: mk.marker_rule });
    });
    (projects || []).forEach(function (p) {
      const list = by.get(String(p.project_ref));
      if (list && list.length) p._markers = list.sort(function (a, b) { return (a.marker_seq || 0) - (b.marker_seq || 0); });
    });
    return projects || [];
  }
  HS.attachMarkers = attachMarkers;


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
    // view (populated | facilities_only | honestly_empty | unsupported_source |
    // temporarily_unavailable | failed_ingest | stale_data). Additive next to
    // coverageStatus(), which stays the untouched legacy gate: pages keep gating
    // layout on data_quality and use this only to render TRUTHFUL state copy.
    // Fails soft (null) so a missing view can never break a page.
    async coverageState(zip) {
      if (isSeed()) return null;
      try {
        const { data } = await sb().from('app_coverage_states')
          .select('coverage_state,refreshed_at').eq('zip', zip).limit(1);
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
      // SHADOW authoritative path — opt-in only (?hs_auth=1). A ZIP that is not
      // boundary_complete falls through to the legacy read below, so its resident
      // behaviour is unchanged; a boundary_complete ZIP with zero authoritative
      // projects renders an honest empty page and does NOT fall back.
      if (authoritativeMode()) {
        const a = await rpcProjectsMarkers(zip, 'development', true);
        if (a && a.status === 'boundary_complete' && Array.isArray(a.projects)) {
          const arr = attachMarkers(a.projects.slice(), a.markers);
          const outA = withDistance(arr.map(normProject), home);
          outA.complete = true;
          outA.authoritative = true;
          return outA;
        }
      }
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
        .gte('meeting_date', new Date().toISOString()).order('meeting_date', { ascending: true }).limit(24);
      const scoped = (data || []).filter(m => {
        const city = /^City government \((.+)\)$/.exec(m.category || '');
        return !city || places.indexOf(city[1].toLowerCase()) !== -1;
      }).slice(0, 12);
      return withDistance(scoped.map(normMeeting), home);
    },
    async envRisk(zip) {
      zip = zip || CFG.DEFAULT_ZIP;
      if (isSeed()) return window.HS_SEED.environmental_risk[zip] || null;
      const { data } = await sb().from('app_environmental_risk').select('*').eq('zip', zip).limit(1);
      return (data && data[0]) || null;   // null -> the parcel env tile shows "coverage coming"
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
