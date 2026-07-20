// HomeSignal impact resolver — Phase 2 of the Development impact system.
// THE one canonical, deterministic scorer: takes Stage-1 extracted facts (from
// development_impact_analyses, produced by the ingest repo's document extractor)
// plus project metadata and a distance, and returns score / level / direction /
// sentence / confidence / per-category results / evidence. No AI judgment here —
// the number is computed in this shared code so the browser, the batch scorer
// (scripts/impact-score.mjs) and the tests all agree byte-for-byte.
//
// Score = MAGNITUDE of likely effect on the selected home (not good-vs-bad);
// direction carries the sign separately. A flood-control project can be
// high + positive; an industrial project high + negative.
//
// Anti-fabrication contract (same as the rest of the tracker): a category only
// scores when the document (or, in fallback, the record's own metadata) supports
// it. Absent facts stay absent — they never default into an effect.
(function (root) {
  const VERSION = 'impact-score-v1';

  // ---- distance decay (documented, testable; category-specific treatment is a
  // later build — corridors / watersheds don't follow radial distance) ----
  const DISTANCE_BANDS = [
    { maxMi: 0.5, w: 1.0 },
    { maxMi: 1,   w: 0.9 },
    { maxMi: 2,   w: 0.75 },
    { maxMi: 5,   w: 0.5 },
    { maxMi: 10,  w: 0.25 },
    { maxMi: Infinity, w: 0.1 }
  ];
  function distanceWeight(mi) {
    if (mi == null || isNaN(mi)) return 1.0;   // no home set → in-area view, no decay
    for (const b of DISTANCE_BANDS) if (mi <= b.maxMi) return b.w;
    return 0.1;
  }

  function levelFor(score) {
    return score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  }

  const CATEGORY_PHRASE = {
    'traffic': 'traffic',
    'noise': 'noise',
    'air': 'air quality',
    'water': 'water use',
    'soil': 'ground disturbance',
    'light': 'nighttime lighting',
    'flooding/drainage': 'drainage and flood protection',
    'utilities': 'utility service',
    'recreation': 'parks and public amenities',
    'neighborhood activity': 'neighborhood activity',
    'visual character': 'the look of the area',
    'construction disruption': 'construction disruption'
  };

  const num = v => (typeof v === 'number' && isFinite(v) && v >= 0) ? v : null;
  const list = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : [];
  const has = v => v != null && v !== '' && v !== false && !(Array.isArray(v) && !v.length);

  // banded helper: first band whose threshold the value meets (descending)
  function band(v, pairs) {
    for (const [min, mag] of pairs) if (v >= min) return mag;
    return null;
  }

  // ---- Stage-2 core: extracted facts → per-category results -----------------
  // Each rule reads ONLY explicit facts; the evidence entries name the fact and
  // value that produced the magnitude so the detail view can show its work.
  function categoriesFromFacts(f) {
    const out = [];
    function add(category, magnitude, direction, evidence) {
      if (magnitude == null) return;
      out.push({
        category, magnitude: Math.max(0, Math.min(100, Math.round(magnitude))),
        direction, evidence
      });
    }
    const ev = (fact, value) => ({ fact, value });

    // traffic
    {
      let mag = null, evs = [];
      const vt = num(f.vehicle_trips_per_day), tt = num(f.truck_trips_per_day);
      if (vt != null) { mag = band(vt, [[5000, 90], [1000, 70], [200, 50], [1, 30]]); evs.push(ev('vehicle_trips_per_day', vt)); }
      if (tt != null) { const m = band(tt, [[100, 85], [20, 65], [1, 45]]); if (m != null && (mag == null || m > mag)) mag = m; evs.push(ev('truck_trips_per_day', tt)); }
      const ps = num(f.parking_spaces);
      if (ps != null && ps >= 100) { const m = band(ps, [[500, 55], [100, 35]]); if (mag == null || m > mag) mag = m; evs.push(ev('parking_spaces', ps)); }
      if (mag != null) add('traffic', mag, 'negative', evs);
    }
    // road changes: disruption while built, capacity after — mixed
    if (has(list(f.road_changes)) || has(list(f.traffic_signals))) {
      const rc = list(f.road_changes), ts = list(f.traffic_signals);
      add('traffic', 55, 'mixed', rc.map(v => ev('road_changes', v)).concat(ts.map(v => ev('traffic_signals', v))));
    }

    // noise
    {
      const ns = list(f.noise_sources);
      if (ns.length) {
        let mag = 50 + (f.nighttime_activity === true ? 15 : 0) + (has(f.generators) ? 10 : 0);
        const evs = ns.map(v => ev('noise_sources', v));
        if (f.nighttime_activity === true) evs.push(ev('nighttime_activity', true));
        add('noise', mag, 'negative', evs);
      } else if (f.nighttime_activity === true) {
        add('noise', 40, 'negative', [ev('nighttime_activity', true)]);
      }
    }

    // air
    {
      const em = list(f.emissions_sources);
      if (em.length) add('air', 60, 'negative', em.map(v => ev('emissions_sources', v)));
      else if (has(f.generators)) add('air', 45, 'negative', [ev('generators', f.generators)]);
    }

    // water
    if (has(f.water_demand)) add('water', 55, 'negative', [ev('water_demand', f.water_demand)]);
    if (has(f.wastewater_changes)) add('water', 50, 'mixed', [ev('wastewater_changes', f.wastewater_changes)]);

    // flooding/drainage — flood-control features are a POSITIVE effect
    {
      const fc = list(f.flood_control_features), dr = list(f.drainage_changes);
      if (fc.length) add('flooding/drainage', 65, 'positive', fc.map(v => ev('flood_control_features', v)));
      else if (dr.length) add('flooding/drainage', 50, 'mixed', dr.map(v => ev('drainage_changes', v)));
    }

    // light
    if (has(f.outdoor_lighting)) {
      add('light', f.nighttime_activity === true ? 55 : 45, 'negative', [ev('outdoor_lighting', f.outdoor_lighting)]);
    }

    // utilities — new infrastructure: build disruption + service capacity
    {
      const ut = list(f.utility_infrastructure);
      if (ut.length) add('utilities', 45, 'mixed', ut.map(v => ev('utility_infrastructure', v)));
    }

    // recreation / amenities — positive
    {
      const pa = list(f.public_amenities);
      if (pa.length) add('recreation', 55, 'positive', pa.map(v => ev('public_amenities', v)));
      else if (has(f.open_space)) add('recreation', 45, 'positive', [ev('open_space', f.open_space)]);
    }

    // soil / ground
    if (has(f.tree_removal)) add('soil', 45, 'negative', [ev('tree_removal', f.tree_removal)]);

    // neighborhood activity — scale of use
    {
      let mag = null; const evs = [];
      const uc = num(f.unit_count);
      if (uc != null) { mag = band(uc, [[500, 80], [100, 60], [20, 40], [1, 25]]); evs.push(ev('unit_count', uc)); }
      const sf = num(f.square_feet);
      if (sf != null) { const m = band(sf, [[500000, 70], [100000, 50], [20000, 30]]); if (m != null && (mag == null || m > mag)) mag = m; evs.push(ev('square_feet', sf)); }
      if (has(f.operating_hours)) { if (mag == null) mag = 35; evs.push(ev('operating_hours', f.operating_hours)); }
      if (mag != null) add('neighborhood activity', mag, 'negative', evs);
    }

    // visual character — height / bulk
    {
      let mag = null; const evs = [];
      const bh = num(f.building_height);
      if (bh != null) { mag = band(bh, [[100, 70], [50, 50], [35, 35]]); evs.push(ev('building_height', bh)); }
      const sf = num(f.square_feet);
      if (sf != null) { const m = band(sf, [[500000, 65], [100000, 45]]); if (m != null && (mag == null || m > mag)) mag = m; evs.push(ev('square_feet', sf)); }
      if (mag != null) add('visual character', mag, 'negative', evs);
    }

    // construction disruption
    {
      let mag = null; const evs = [];
      if (has(f.construction_duration)) {
        const months = parseDurationMonths(f.construction_duration);
        mag = months == null ? 40 : band(months, [[18, 70], [6, 50], [0, 40]]);
        evs.push(ev('construction_duration', f.construction_duration));
      } else if (has(f.construction_start) || has(f.construction_end)) {
        mag = 40;
        if (has(f.construction_start)) evs.push(ev('construction_start', f.construction_start));
        if (has(f.construction_end)) evs.push(ev('construction_end', f.construction_end));
      } else if (/demol/i.test(String(f.project_type || ''))) {
        mag = 55; evs.push(ev('project_type', f.project_type));
      }
      if (mag != null) add('construction disruption', mag, 'negative', evs);
    }

    // documented mitigation softens the top negative effects (never below 0)
    {
      const em = list(f.environmental_mitigation);
      if (em.length) {
        for (const c of out) {
          if (c.direction === 'negative') c.magnitude = Math.max(0, c.magnitude - 8);
        }
        out.push({ category: 'mitigation', magnitude: 0, direction: 'positive',
          evidence: em.map(v => ({ fact: 'environmental_mitigation', value: v })) });
      }
    }

    // acreage scales the physical-footprint categories slightly
    {
      const ac = num(f.acreage);
      if (ac != null && ac >= 100) {
        for (const c of out) {
          if (c.category === 'visual character' || c.category === 'construction disruption' || c.category === 'soil') {
            c.magnitude = Math.min(100, c.magnitude + 10);
          }
        }
      }
    }

    // merge duplicate categories (keep the stronger; union evidence; direction
    // becomes 'mixed' when a category scored both ways)
    const merged = {};
    for (const c of out) {
      const m = merged[c.category];
      if (!m) { merged[c.category] = c; continue; }
      m.evidence = m.evidence.concat(c.evidence);
      if (m.direction !== c.direction) m.direction = 'mixed';
      m.magnitude = Math.max(m.magnitude, c.magnitude);
    }
    return Object.keys(merged).map(k => merged[k]).filter(c => c.category !== 'mitigation' || c.evidence.length);
  }

  function parseDurationMonths(s) {
    const m = /([\d.]+)\s*(year|yr|month|mo|week|wk|day)/i.exec(String(s || ''));
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (isNaN(n)) return null;
    const u = m[2].toLowerCase();
    if (u.startsWith('y')) return n * 12;
    if (u.startsWith('mo')) return n;
    if (u.startsWith('w')) return n / 4.345;
    return n / 30.44;
  }

  // ---- metadata fallback (no readable document) -----------------------------
  // Conservative, category-based, LOW confidence — never pretends the filing
  // was analyzed. Uses only fields already on the record.
  const TYPE_FALLBACK = {
    residential:   { cats: ['construction disruption', 'neighborhood activity'], mag: 35, dir: 'negative' },
    commercial:    { cats: ['traffic', 'neighborhood activity'], mag: 35, dir: 'negative' },
    industrial:    { cats: ['traffic', 'noise'], mag: 45, dir: 'negative' },
    utility:       { cats: ['utilities', 'construction disruption'], mag: 35, dir: 'mixed' },
    'civic/public':{ cats: ['recreation', 'construction disruption'], mag: 30, dir: 'mixed' },
    trades:        { cats: ['construction disruption'], mag: 20, dir: 'negative' },
    logistics:     { cats: ['traffic'], mag: 40, dir: 'negative' },
    energy:        { cats: ['utilities'], mag: 30, dir: 'mixed' },
    datacenter:    { cats: ['water', 'noise'], mag: 50, dir: 'negative' }
  };
  function fallbackCategories(meta) {
    const t = String((meta && meta.type) || '').trim().toLowerCase();
    const fb = TYPE_FALLBACK[t];
    if (!fb) return [];
    return fb.cats.map(c => ({
      category: c, magnitude: fb.mag, direction: fb.dir,
      evidence: [{ fact: 'project_type', value: meta.type }]
    }));
  }

  // ---- direction + confidence ----------------------------------------------
  function overallDirection(cats) {
    let neg = 0, pos = 0;
    for (const c of cats) {
      if (c.direction === 'negative') neg = Math.max(neg, c.magnitude);
      else if (c.direction === 'positive') pos = Math.max(pos, c.magnitude);
      else if (c.direction === 'mixed') { neg = Math.max(neg, c.magnitude * 0.6); pos = Math.max(pos, c.magnitude * 0.6); }
    }
    if (neg >= 30 && pos >= 30) return 'mixed';
    if (neg > pos) return 'negative';
    if (pos > neg) return 'positive';
    return 'neutral';
  }

  // Evidence quality → confidence (see the storage doc):
  //   quantified facts w/ grounded quotes → high; descriptive-only → medium;
  //   metadata fallback → low; thin/unknown type → very low.
  function confidenceFor(basis, facts, cats) {
    if (basis !== 'document') {
      return cats.length ? 0.3 : 0.15;
    }
    const quotes = Array.isArray(facts && facts.document_quotes) ? facts.document_quotes.length : 0;
    const quantified = ['vehicle_trips_per_day', 'truck_trips_per_day', 'unit_count', 'square_feet',
      'building_height', 'acreage', 'parking_spaces', 'building_count']
      .some(k => num(facts && facts[k]) != null);
    let c = quantified ? 0.8 : (cats.length ? 0.55 : 0.35);
    if (quotes >= 2) c += 0.1;
    else if (!quotes) c -= 0.15;   // no grounded quotes → cautious-wording tier for descriptive-only docs
    return Math.max(0.1, Math.min(0.95, Math.round(c * 100) / 100));
  }

  // ---- sentence -------------------------------------------------------------
  // One plain-language homeowner sentence from the strongest supported effects.
  // Confidence gates the verb: high → "Likely to…", medium → "May…",
  // low/fallback → "The available filing suggests…". Never names the project,
  // never claims an effect no category supports.
  function phrase(cat, f) {
    const p = CATEGORY_PHRASE[cat.category] || cat.category;
    if (cat.category === 'traffic') {
      const truck = (cat.evidence || []).some(e => e.fact === 'truck_trips_per_day');
      return truck ? 'truck traffic' : 'traffic';
    }
    if (cat.category === 'noise') {
      const constr = (cat.evidence || []).some(e => /construction/i.test(String(e.value)));
      const night = f && f.nighttime_activity === true;
      return (night ? 'nighttime ' : constr ? 'daytime construction ' : '') + 'noise';
    }
    return p;
  }
  function buildSentence(basis, facts, cats, direction, confidence) {
    if (!cats.length) {
      return basis === 'document'
        ? 'The filing does not document effects on nearby homes; more detail is needed to determine any impact.'
        : 'Details on file are limited, so the likely effect on nearby homes can’t be determined yet.';
    }
    const ranked = cats.slice().sort((a, b) => b.magnitude - a.magnitude);
    const negs = ranked.filter(c => c.direction === 'negative' || c.direction === 'mixed');
    const poss = ranked.filter(c => c.direction === 'positive');
    const lowConf = confidence < 0.45 || basis !== 'document';
    const p1 = negs[0] && phrase(negs[0], facts), p2 = negs[1] && phrase(negs[1], facts);
    const g1 = poss[0] && phrase(poss[0], facts);

    let s;
    if (direction === 'positive' && g1) {
      s = (lowConf ? 'The available filing suggests improved ' : 'Expected to improve ') + g1 +
        (poss[1] ? ' and ' + phrase(poss[1], facts) : '') + ' near the home.';
    } else if (direction === 'mixed' && g1 && p1) {
      s = (lowConf ? 'Could improve ' : 'May improve ') + g1 + ' while increasing ' + p1 + ' nearby.';
    } else if (p1) {
      const eff = p1 + (p2 && p2 !== p1 ? ' and ' + p2 : '');
      s = lowConf
        ? 'The available filing suggests possible ' + eff + ' near the home, but details are limited.'
        : 'Likely to increase ' + eff + ' near the home.';
    } else if (g1) {
      s = (lowConf ? 'Could improve ' : 'Expected to improve ') + g1 + ' in the surrounding area.';
    } else {
      s = 'May affect ' + phrase(ranked[0], facts) + ' near the home, but details are limited.';
    }
    return s;
  }

  // ---- the canonical resolver ----------------------------------------------
  // resolveProjectImpact({ extractedFacts, projectMetadata, distanceMiles, analysis })
  //   extractedFacts  — Stage-1 facts JSON (null/absent → metadata fallback)
  //   projectMetadata — the app_projects row (type/status/size/…)
  //   distanceMiles   — home→site distance (null → no decay)
  //   analysis        — the development_impact_analyses row, if loaded (for evidence/versions)
  function resolveProjectImpact(input) {
    input = input || {};
    const facts = input.extractedFacts || null;
    const meta = input.projectMetadata || {};
    const basis = facts ? 'document' : 'metadata_fallback';
    const cats = facts ? categoriesFromFacts(facts) : fallbackCategories(meta);
    const direction = cats.length ? overallDirection(cats) : 'neutral';
    const confidence = confidenceFor(basis, facts, cats);

    // base = strongest effect blended with the runner-up (magnitude, not merit)
    const ranked = cats.slice().sort((a, b) => b.magnitude - a.magnitude);
    let base = 0;
    if (ranked.length === 1) base = ranked[0].magnitude;
    else if (ranked.length > 1) base = Math.round(0.7 * ranked[0].magnitude + 0.3 * ranked[1].magnitude);

    const w = distanceWeight(input.distanceMiles);
    const score = Math.max(0, Math.min(100, Math.round(base * w)));
    const level = levelFor(score);
    const catConf = c => Object.assign({}, c, { confidence });

    // flat evidence list; document quotes ride along for the detail view
    const evidence = [];
    for (const c of cats) for (const e of c.evidence) evidence.push(Object.assign({ category: c.category }, e));
    if (facts && Array.isArray(facts.document_quotes)) {
      for (const q of facts.document_quotes) {
        if (q && q.text) evidence.push({ category: 'document', fact: 'quote', value: q.text, page: q.page ?? null, supports: q.supports || null });
      }
    }

    return {
      score, level, direction,
      sentence: buildSentence(basis, facts, cats, direction, confidence),
      confidence,
      categoryScores: ranked.map(catConf),
      evidence,
      factors: { base, distanceMiles: input.distanceMiles ?? null, distanceWeight: w, basis },
      basis,
      version: VERSION
    };
  }

  // ---- "Impact on me" ordering ---------------------------------------------
  // score desc → confidence desc → distance asc → most recently updated.
  // A low-confidence generic fallback must not outrank a well-supported result
  // on a similar raw score: when scores are within 10 points and exactly one of
  // the two is document-based, the document-based one wins.
  function impactSortCompare(a, b) {
    const ia = a.impact_resolved || {}, ib = b.impact_resolved || {};
    const sa = ia.score || 0, sb = ib.score || 0;
    const docA = ia.basis === 'document', docB = ib.basis === 'document';
    if (docA !== docB && Math.abs(sa - sb) <= 10) return docA ? -1 : 1;
    if (sb !== sa) return sb - sa;
    const ca = ia.confidence || 0, cb = ib.confidence || 0;
    if (cb !== ca) return cb - ca;
    const da = a.distance_mi == null ? 9e9 : a.distance_mi;
    const db = b.distance_mi == null ? 9e9 : b.distance_mi;
    if (da !== db) return da - db;
    return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
  }

  // Attach a resolved impact to every project (shared by every page that renders
  // dev cards). A project without an analysis row still resolves — via the
  // conservative metadata fallback — so no card is ever blocked on analysis.
  function attachResolvedImpact(projects, analysesByRef) {
    return (projects || []).map(function (p) {
      const a = (analysesByRef && p.source_ref && analysesByRef[p.source_ref]) || null;
      p.impact_analysis = a;
      p.impact_resolved = resolveProjectImpact({
        extractedFacts: (a && a.extraction_status === 'extracted') ? a.extracted_facts : null,
        projectMetadata: p,
        distanceMiles: p.distance_mi,
        analysis: a
      });
      return p;
    });
  }

  const api = {
    IMPACT_RESOLVER_VERSION: VERSION,
    resolveProjectImpact, impactSortCompare, attachResolvedImpact,
    distanceWeight, levelFor, categoriesFromFacts, fallbackCategories,
    IMPACT_CATEGORY_PHRASE: CATEGORY_PHRASE
  };
  if (root) Object.assign((root.HS = root.HS || {}), api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' && globalThis.window) || null);
