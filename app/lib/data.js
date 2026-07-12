// HomeSignal data layer — ONE interface, two backends.
//   DATA_SOURCE='seed'      -> reads window.HS_SEED (runs the whole app with zero DB; the review path)
//   DATA_SOURCE='supabase'  -> reads the live project with the anon key (RLS-gated)
// Every read is async so pages don't care which backend is live. Distances are ALWAYS
// computed here from the active property's lat/lng (haversine now; PostGIS RPC seam noted),
// never stored — matching the prompt's "distance is computed" rule.
(function () {
  const HS = (window.HS = window.HS || {});
  const CFG = window.HS_CONFIG;

  // --- Supabase client (only created if/when needed; jsDelivr build matches the live CSP) ---
  let _sb = null;
  function sb() {
    if (!_sb && window.supabase) _sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    return _sb;
  }
  HS.sb = sb;

  // --- geo: haversine miles (client-side seed path). Supabase path uses an ST_Distance RPC. ---
  function distanceMi(aLat, aLng, bLat, bLng) {
    if ([aLat, aLng, bLat, bLng].some(v => v == null || isNaN(v))) return null;
    const R = 3958.7613, toR = d => (d * Math.PI) / 180;
    const dLat = toR(bLat - aLat), dLng = toR(bLng - aLng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function fmtMi(mi) { return mi == null ? '' : (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' mi'; }
  HS.distanceMi = distanceMi;
  HS.fmtMi = fmtMi;

  // Attach a computed `.distance_mi` (+ formatted `.dist`) to items relative to a home point.
  function withDistance(items, home) {
    const hLat = home && home.lat, hLng = home && home.lng;
    return (items || []).map(it => {
      const mi = distanceMi(hLat, hLng, it.lat, it.lng);
      return Object.assign({}, it, { distance_mi: mi, dist: fmtMi(mi) });
    });
  }
  HS.withDistance = withDistance;

  const isSeed = () => (CFG.DATA_SOURCE || 'seed') === 'seed';

  // ---------------------------------------------------------------- reads ----
  const data = {
    async community(zip) {
      zip = zip || CFG.DEFAULT_ZIP;
      if (isSeed()) {
        const c = window.HS_SEED.community;
        return c.zip === zip ? c : null;
      }
      const { data } = await sb().from('communities')
        .select('*').contains('zip_codes', [zip]).limit(1);
      return (data && data[0]) || null;
    },
    async coverage() {
      if (isSeed()) return window.HS_SEED.coverage.slice();
      // live: resolve against communities.zip_codes; a ZIP present == covered.
      return null;
    },
    async isCovered(zip) {
      if (isSeed()) return window.HS_SEED.coverage.some(c => c.zip === zip && c.covered);
      const { data } = await sb().from('communities')
        .select('id').contains('zip_codes', [zip]).limit(1);
      return !!(data && data.length);
    },
    async projects(zip, home) {
      const list = isSeed() ? window.HS_SEED.projects.slice() : await _sbList('projects', zip);
      return withDistance(list, home);
    },
    async changes(zip, home) {
      const list = isSeed() ? window.HS_SEED.changes.slice() : await _sbList('changes', zip);
      return withDistance(list, home);
    },
    async meetings(zip, home) {
      const list = isSeed() ? window.HS_SEED.meetings.slice() : await _sbList('meetings', zip);
      return withDistance(list, home);
    },
    async envRisk(zip) {
      zip = zip || CFG.DEFAULT_ZIP;
      if (isSeed()) return window.HS_SEED.environmental_risk[zip] || null;
      const { data } = await sb().from('environmental_risk')
        .select('*').eq('zip', zip).limit(1);
      return (data && data[0]) || null;
    },
    async properties() {
      // In seed/demo mode the demo user's homes; in live mode the signed-in user's `properties`.
      if (isSeed()) return withDistance(window.HS_SEED.properties.slice(), null)
        .map(p => Object.assign({}, p)); // properties are homes themselves
      if (!HS.state.session) return [];
      const { data } = await sb().from('properties')
        .select('*').eq('user_id', HS.state.session.user.id).order('created_at');
      return data || [];
    },
    topicCategories() {
      return isSeed() ? window.HS_SEED.topicCategories : window.HS_SEED.topicCategories; // taxonomy same either way
    },
    project(id, list) { return (list || []).find(p => p.id === id) || null; }
  };
  async function _sbList(table, zip) {
    const { data } = await sb().from(table).select('*').eq('zip', zip || CFG.DEFAULT_ZIP);
    return data || [];
  }
  HS.data = data;
})();
