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
      impact_dimensions: p.impact_dimensions || []   // no invented chips for named facilities
    });
  }
  function normChange(c) {
    return Object.assign({}, c, { impacts: c.impacts || [], lens: c.lens || 'traffic' });
  }
  function normMeeting(m) {
    return {
      id: m.id, body: m.title, title: m.title,
      starts_at: m.meeting_date, location: m.location,
      lat: m.geo_lat, lng: m.geo_lng,
      related_project_id: null, source_ref: m.source_url,
      window_closes_at: m.is_public_hearing ? m.meeting_date : null
    };
  }

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
      const { data } = await sb().from('app_projects').select('*')
        .eq('zip', zip).eq('record_kind', 'development')
        .order('submitted_at', { ascending: false, nullsFirst: false });
      return withDistance((data || []).map(normProject), home);
    },
    async facilities(zip, home) {
      // Regulated facilities (EPA FRS/ECHO, status 'Operating') — environmental context,
      // shown in a clearly-labeled section, never under Development / what's changing.
      zip = zip || CFG.DEFAULT_ZIP;
      home = homeFor(zip, home);
      if (isSeed()) return withDistance((window.HS_SEED.facilities || []).slice(), home);
      const { data } = await sb().from('app_projects').select('*')
        .eq('zip', zip).eq('record_kind', 'facility').order('name', { ascending: true });
      return withDistance((data || []).map(normProject), home);
    },
    async changes(zip, home) {
      zip = zip || CFG.DEFAULT_ZIP;
      home = homeFor(zip, home);
      if (isSeed()) return withDistance(window.HS_SEED.changes.slice(), home);
      const { data } = await sb().from('app_changes').select('*').eq('zip', zip).order('occurred_at', { ascending: false });
      return withDistance((data || []).map(normChange), home);
    },
    async meetings(zip, home) {
      zip = zip || CFG.DEFAULT_ZIP;
      home = homeFor(zip, home);
      if (isSeed()) return withDistance(window.HS_SEED.meetings.slice(), home);
      const c = await resolveCommunity(zip);
      if (!c) return [];
      const ids = [c.id, c.parent_id].filter(Boolean);
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
})();
