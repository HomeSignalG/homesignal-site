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
      .select('id,name,parent_id,county,state,zip_codes,level').contains('zip_codes', [zip]);
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
      zip = zip || CFG.DEFAULT_ZIP;
      if (isSeed()) return withDistance(window.HS_SEED.projects.slice(), home);
      const { data } = await sb().from('app_projects').select('*').eq('zip', zip).order('impact_score', { ascending: false });
      return withDistance((data || []).map(normProject), home);
    },
    async changes(zip, home) {
      zip = zip || CFG.DEFAULT_ZIP;
      if (isSeed()) return withDistance(window.HS_SEED.changes.slice(), home);
      const { data } = await sb().from('app_changes').select('*').eq('zip', zip).order('occurred_at', { ascending: false });
      return withDistance((data || []).map(normChange), home);
    },
    async meetings(zip, home) {
      zip = zip || CFG.DEFAULT_ZIP;
      if (isSeed()) return withDistance(window.HS_SEED.meetings.slice(), home);
      const c = await resolveCommunity(zip);
      if (!c) return [];
      const ids = [c.id, c.parent_id].filter(Boolean);
      const { data } = await sb().from('meetings').select('*').in('community_id', ids)
        .gte('meeting_date', new Date().toISOString()).order('meeting_date', { ascending: true }).limit(12);
      return withDistance((data || []).map(normMeeting), home);
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
      if (isSeed() || (CFG.DEMO_SESSION && (!HS.state || !HS.state.session || HS.state.session.demo))) {
        return window.HS_SEED.properties.slice();
      }
      if (!HS.state.session) return [];
      const { data } = await sb().from('app_properties').select('*').eq('user_id', HS.state.session.user.id).order('created_at');
      return data || [];
    },
    topicCategories() { return window.HS_SEED.topicCategories; },
    project(id, list) { return (list || []).find(p => p.id === id) || null; }
  };
  HS.data = data;
})();
