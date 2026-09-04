// HomeSignal map helpers — the ONE map backbone shared by every map surface:
// maps.html, dashboard.html preview, and homesignalmap.html (development tracker).
//
// HONEST-LABELING CONTRACT (2026-07-16 backbone audit):
//   * Pin colors encode PERMIT STATUS (Proposed / Approved / Operating) — the only
//     per-record fact the data carries. NO "impact" tiers: the old impact legend
//     decoded to a status->constant lookup, its red "High impact" tier was
//     unreachable (max stored score 72 < the 75 threshold), and its green
//     "Positive" tier required fields that never render. Unknown statuses get the
//     neutral "On file" gray — never a guessed severity.
//   * A home marker / "Your home" label renders ONLY for a real resident home in
//     the viewed ZIP — never a centroid, sample address, or arbitrary record.
//   * Live engines degrade MapLibre GL -> Leaflet rasters (no WebGL needed) ->
//     schematic diagram, and a map failure never throws into the caller's init.
(function () {
  const HS = (window.HS = window.HS || {});

  // Merge regulated facilities into the lettered pin/list set with a reserved FLOOR
  // (default 4), so the closest facilities are ALWAYS surfaced and lettered even when
  // development records would otherwise fill every slot. De-duped across both streams
  // (by id, else name+coords; a facility wins a collision — it carries env context).
  // reserve = min(floor, #distinct facilities, cap). Final order + lettering follow
  // proximity. Pure + side-effect-free so test/facility-slots.test.mjs can pin it.
  // (Supersedes the older "facilities never lettered — spec §6" split for this list.)
  HS.reserveFacilitySlots = function (devItems, facs, opts) {
    opts = opts || {};
    var cap     = opts.cap     != null ? opts.cap     : 16;
    var floor   = opts.floor   != null ? opts.floor   : 4;
    var LETTERS = opts.letters || 'ABCDEFGHIJKLMNOP';
    function keyOf(x) {
      if (!x) return '';
      if (x.id != null && x.id !== '') return 'id:' + x.id;
      return 'k:' + String(x.name || x.title || '') + '@' + (x.lat != null ? x.lat : '') + ',' + (x.lng != null ? x.lng : '');
    }
    function dist(x) { return (x && x.distance_mi != null) ? x.distance_mi : 9e9; }
    function byDist(a, b) { return dist(a) - dist(b); }

    var seen = {}, facU = [], devU = [];
    (facs || []).slice().sort(byDist).forEach(function (f) {
      var k = keyOf(f); if (seen[k]) return; seen[k] = 1;
      facU.push(Object.assign({}, f, { _facility: true }));
    });
    (devItems || []).slice().sort(byDist).forEach(function (d) {
      var k = keyOf(d); if (seen[k]) return; seen[k] = 1;
      devU.push(Object.assign({}, d, { _facility: false }));
    });

    var reserve = Math.min(floor, facU.length, cap);      // guaranteed facility slots
    var picked = facU.slice(0, reserve);                  // closest facilities, always in
    var rest = devU.concat(facU.slice(reserve)).sort(byDist);
    for (var i = 0; i < rest.length && picked.length < cap; i++) picked.push(rest[i]);

    return picked.sort(byDist).slice(0, cap).map(function (it, i) {
      return Object.assign({}, it, { _letter: LETTERS[i] || '' });
    });
  };

  // ---- Maps uncap (Phase 2): the full-set "rest" layer backbone ----------------
  // The lettered A-P set is a presentation aid for the nearest records — it must
  // never be an accessibility cap. restAfterLetters() returns every coordinate-
  // bearing record in the filtered visible set that did NOT earn a letter; the map
  // pages render these as a lightweight clustered (GL) / canvas (Leaflet) layer so
  // ALL records stay reachable on the map. Pure + side-effect-free so
  // test/maps-rest-layer.test.mjs can pin it.
  HS.restAfterLetters = function (visible, lettered) {
    var inSet = {};
    (lettered || []).forEach(function (it) { if (it && it.id != null) inSet[it.id] = 1; });
    return (visible || []).filter(function (x) {
      return x && x.lat != null && x.lng != null && !(x.id != null && inSet[x.id]);
    });
  };
  // GeoJSON for the GL clustered source: one point per record, carrying its
  // resolved marker SHAPE (type) and status COLOR (lifecycle), the id for the
  // click -> panel dispatch, and a facility flag so facility points route to the
  // facility detail.
  //
  // `shape` used to be COMPUTED HERE AND THEN DROPPED: the feature carried only
  // `col`, and the GL layer was `type:'circle'`, so every record past the 16
  // lettered pins rendered as a circle no matter what it was. Classification was
  // never the problem — the shape was resolved correctly and discarded at this
  // exact line. Emitting it lets the symbol layer draw the real symbol, so
  // "pin shape = project type" holds for the WHOLE plotted set, not just the
  // lettered head. (test/maps-rest-shape-parity.test.mjs pins this.)
  HS.restFeatureCollection = function (items) {
    return { type: 'FeatureCollection', features: (items || []).map(function (it) {
      var mk = HS.resolveMarker ? HS.resolveMarker(it) : { color: '#6b7f76', shape: 'circle' };
      var shape = mk.shape || 'circle';
      return { type: 'Feature',
        geometry: { type: 'Point', coordinates: [+it.lng, +it.lat] },
        properties: { id: it.id, col: mk.color, shape: shape,
                      icon: HS.restIconId(shape, mk.color),
                      fac: it._restFacility ? 1 : 0 } };
    }) };
  };
  // ONE id function for a (shape, color) marker image, shared by the page that
  // registers the icons and the tests that assert them, so they cannot disagree.
  HS.restIconId = function (shape, color) {
    return 'hs-' + (shape || 'circle') + '-' + String(color || '').replace('#', '');
  };
  // The distinct (shape,color) images a feature collection needs. Pure: the page
  // rasterizes HS.markerSVG(shape,color) for each and registers it under `id`.
  // Derived from the ACTUAL features, so a new category or status colour needs no
  // enumeration here and can never be missed.
  HS.restIconSpecs = function (fc) {
    var seen = {}, out = [];
    ((fc && fc.features) || []).forEach(function (f) {
      var p = (f && f.properties) || {};
      var id = p.icon || HS.restIconId(p.shape, p.col);
      if (seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, shape: p.shape || 'circle', color: p.col });
    });
    return out;
  };

  // ── COMPLETE PLOTTED-MARKER SET (Focus/tile symbology parity, 2026-07-24) ──────
  // ONE authority for WHICH records every render surface plots and WHAT canonical
  // symbol each gets. Before this, Focus/schematic plotted only the lettered A–P
  // subset (+ facility squares) while the tile modes' uncapped "rest" layer carried
  // the full remainder — so Focus silently dropped every record beyond the letters
  // and the map read as facility-dominated. plottedMarkerSet() derives the SAME
  // complete set the tile modes render, so Focus can plot it too and no mode can
  // regress into a partial view. Pure + side-effect-free (test/maps-focus-completeness).
  //
  //   visible   — the filtered dev + coordinate-bearing change set (facilities NOT in here)
  //   facs      — the nearest facilities that keep individual DOM squares (maps.html: nearest 24)
  //   restFacs  — mappable facilities beyond that nearest set (already _restFacility-tagged)
  //
  // Returns one entry per record { item, shape, color, isFacility, filterKey, lettered }.
  // Every visible record and every facility appears EXACTLY once (deduped by the
  // lettered/rest/unlettered partition), so the histogram is complete and drop-free.
  HS.plottedMarkerSet = function (visible, facs, restFacs, opts) {
    opts = opts || {};
    var letters = opts.letters || 'ABCDEFGHIJKLMNOP';
    var showFacilities = opts.showFacilities !== false;
    var facList  = showFacilities ? (facs || []) : [];
    var restFacL = showFacilities ? (restFacs || []) : [];
    var lettered = HS.reserveFacilitySlots(visible || [], facList,
      { cap: opts.cap != null ? opts.cap : 16, floor: opts.floor != null ? opts.floor : 4, letters: letters });
    var letteredIds = {};
    lettered.forEach(function (it) { if (it && it.id != null) letteredIds[it.id] = 1; });
    var restDev = HS.restAfterLetters(visible || [], lettered);          // dev beyond the letters
    var unletteredFacs = facList.filter(function (f) {                   // nearest facs not lettered
      return !(f.id != null && letteredIds[f.id]);
    });
    var out = [];
    function push(item, isLettered) {
      var m = HS.resolveMarker(item);
      out.push({ item: item, shape: m.shape, color: m.color, isFacility: m.isFacility,
                 filterKey: m.filterKey, lettered: !!isLettered });
    }
    lettered.forEach(function (it) { push(it, true); });
    restDev.forEach(function (it) { push(it, false); });
    unletteredFacs.forEach(function (f) { push(f, false); });
    restFacL.forEach(function (f) { push(f, false); });
    return out;
  };
  // Histogram of a plotted set by status-filter bucket, shape, and color — the
  // regression backbone. Two render surfaces built from the SAME inputs MUST agree,
  // and the total MUST equal the complete visible+facility count (nothing dropped,
  // nothing double-plotted). test/maps-focus-completeness.test.mjs pins both.
  HS.markerHistogram = function (plotted) {
    var byStatus = {}, byShape = {}, byColor = {};
    (plotted || []).forEach(function (p) {
      byStatus[p.filterKey] = (byStatus[p.filterKey] || 0) + 1;
      byShape[p.shape]      = (byShape[p.shape]  || 0) + 1;
      byColor[p.color]      = (byColor[p.color]  || 0) + 1;
    });
    return { total: (plotted || []).length, byStatus: byStatus, byShape: byShape, byColor: byColor };
  };

  // permit status -> pin color + legend label. Only EXACT known statuses are
  // colored ('Active'/'Built' are the materializer's built-bucket synonyms);
  // anything else renders the neutral "On file" — never a guessed tier.
  // Hexes come from the ONE canonical mapping (lib/templates.js::HS.statusHex,
  // loaded before this file on every page that uses both) so pins and card
  // bars can never drift apart; the literals are the load-order fallback.
  const HX = HS.statusHex || { proposed: '#c47a1a', approved: '#3f7fb0', operating: '#1f9d5c', onfile: '#6b7f76' };
  // ── CANONICAL LIFECYCLE CONTRACT (maps-backbone repair) ───────────────────
  // FOUR members, no more: proposed | approved | operating | unknown. `unknown` is a
  // FIRST-CLASS, LEGENDED state — a record whose source states no lifecycle must never
  // be silently promoted to operating/built (that fabricates a fact) nor demoted to
  // proposed. `onfile` is retained ONLY as a read alias for the old vocabulary so
  // stored filter prefs and older callers keep resolving; it renders as `unknown`.
  const LIFECYCLE_KEYS = ['proposed', 'approved', 'operating', 'unknown'];
  const STATUS_TIERS = {
    proposed:  { hex: HX.proposed,  label: 'Proposed' },
    approved:  { hex: HX.approved,  label: 'Approved' },
    operating: { hex: HX.operating, label: 'Operating / built' },
    unknown:   { hex: HX.onfile,    label: 'Lifecycle unknown' }
  };
  STATUS_TIERS.onfile = STATUS_TIERS.unknown;              // legacy alias, same object
  HS.LIFECYCLE_KEYS = LIFECYCLE_KEYS.slice();
  function statusTier(item) {
    const s = String((item && item.status) || '').toLowerCase();
    const k = (s === 'proposed') ? 'proposed'
            : (s === 'approved') ? 'approved'
            : (s === 'operating' || s === 'active' || s === 'built') ? 'operating'
            : 'unknown';
    return Object.assign({ k: k, c: STATUS_TIERS[k].hex }, STATUS_TIERS[k]);
  }
  HS.mapStatus = statusTier;

  // ── Per-status pin visibility (shared state, persisted per session) ───────
  // The map legend's "Status — pin color" rows double as show/hide toggles. The
  // chosen set lives HERE, on the shared backbone — NOT in any one page's script —
  // so a resident's choice applies on every ZIP/map surface that reads it, and it
  // PERSISTS in sessionStorage (survives radius changes and in-session navigation;
  // resets when the tab closes). Four independently-toggleable buckets, ALL default
  // ON:
  //   proposed / approved / operating — the three permit-status tiers.
  //   facility                        — regulated facilities (their own pin type).
  // An 'On file' / unknown-status pin has no legend row of its own, so it rides with
  // 'operating' (on record = exists now) — that keeps the all-off state genuinely
  // empty rather than leaving orphan pins no toggle can hide.
  // `unknown` is its own filter bucket — it used to be folded into `operating`, which
  // hid lifecycle-unknown records whenever a reader turned "Operating now" off and made
  // the legend a lie about what that toggle controls.
  const STATUS_FILTER_KEYS = ['proposed', 'approved', 'operating', 'unknown', 'facility'];
  const STATUS_FILTER_SS_KEY = 'hs.map.statusFilters';
  function defaultStatusFilters() { return { proposed: true, approved: true, operating: true, unknown: true, facility: true }; }
  function loadStatusFilters() {
    const f = defaultStatusFilters();
    try {
      const raw = window.sessionStorage.getItem(STATUS_FILTER_SS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        STATUS_FILTER_KEYS.forEach(function (k) { if (typeof saved[k] === 'boolean') f[k] = saved[k]; });
      }
    } catch (e) { /* storage blocked or bad JSON -> all-on default */ }
    return f;
  }
  let statusFilters = loadStatusFilters();
  function persistStatusFilters() {
    try { window.sessionStorage.setItem(STATUS_FILTER_SS_KEY, JSON.stringify(statusFilters)); } catch (e) {}
  }
  // Which of the four toggle buckets a pin belongs to (delegates to resolveMarker).
  function statusFilterKey(item) {
    return HS.resolveMarker(item).filterKey;
  }
  HS.statusFilterKeys = STATUS_FILTER_KEYS.slice();
  HS.getStatusFilters = function () { return statusFilters; };
  HS.setStatusFilter = function (key, on) {
    if (STATUS_FILTER_KEYS.indexOf(key) === -1) return statusFilters;
    statusFilters[key] = !!on;
    persistStatusFilters();
    return statusFilters;
  };
  HS.statusFilterKey = statusFilterKey;                 // item -> one of the four keys
  HS.statusVisible = function (item) { return !!statusFilters[statusFilterKey(item)]; };
  HS.allStatusesOff = function () { return STATUS_FILTER_KEYS.every(function (k) { return !statusFilters[k]; }); };
  HS.filterByStatus = function (items) { return (items || []).filter(HS.statusVisible); };

  // ── CANONICAL MARKER REGISTRY (marker-backbone audit, 2026-07-20) ─────────
  // ONE resolver — HS.resolveMarker(item) — is the sole authority for pin shape,
  // color, legend labels, popup text, and filter buckets. Every renderer (MapLibre,
  // Leaflet, schematic/Focus, dashboard preview, development tracker) MUST call it;
  // no renderer may independently derive shape or color.
  //
  // CLASSIFICATION PRECEDENCE (deterministic, renderer-agnostic):
  //   1. Explicit regulated-facility flag (_facility or record_kind === 'facility')
  //   2. Exact normalized project type string (TYPE_EXACT) — except GENERIC_EXACT
  //      buckets (Development/unclassified/Trades/…) which are NON-TERMINAL
  //   3. Canonical use_type field (same TYPE_EXACT / GENERIC_EXACT rules)
  //   4. layer / category fallback (LAYER_EXACT)
  //   5. Deliberately ordered keyword rules on type fields + name/title/label
  //   6. Other project (circle)
  const FACILITY_HEX = '#6f42c1';
  const LEGEND_NEUTRAL_HEX = HX.onfile;
  // ── CANONICAL CATEGORY REGISTRY (maps-backbone repair) ────────────────────
  // A CLOSED set. Every classified record resolves to exactly one member, and every
  // legend row is GENERATED from this table — classifier, renderer, shape legend,
  // popup, sidebar, Street, Satellite and Focus all read the same object, so they
  // cannot drift. Adding a category = adding one row here; nothing else.
  //
  // SYMBOL UNIQUENESS is an invariant (asserted in test/maps-category-contract.test.mjs):
  // no two categories may share a symbol. Two changes enforce it:
  //   • `datacenter` moved square → OCTAGON, because `facility` also renders a square
  //     and "pin shape shows project type" was untrue for squares. Facility keeps the
  //     square (it is the higher-volume, longer-established marker nationally), so the
  //     national churn is confined to the rarer data-center pins.
  //   • `civic` is now FIRST-CLASS with its own CROSS symbol. It was a real category in
  //     the data (schools, fire/EMS, correctional, community centres) that the legend
  //     never explained — it was relabelled "Other project" and drawn as a circle.
  const CATEGORY_REGISTRY = {
    datacenter:     { key: 'datacenter',     label: 'Data center',            symbol: 'octagon',  legend: true },
    industrial:     { key: 'industrial',     label: 'Industrial',             symbol: 'triangle', legend: true },
    residential:    { key: 'residential',    label: 'Residential',            symbol: 'pentagon', legend: true },
    infrastructure: { key: 'infrastructure', label: 'Roads & infrastructure', symbol: 'diamond',  legend: true },
    commercial:     { key: 'commercial',     label: 'Commercial',             symbol: 'hexagon',  legend: true },
    civic:          { key: 'civic',          label: 'Civic & public',         symbol: 'cross',    legend: true },
    other:          { key: 'other',          label: 'Other project',          symbol: 'circle',   legend: true },
    facility:       { key: 'facility',       label: 'Regulated facility',     symbol: 'square',   legend: true, isFacility: true }
  };
  HS.CATEGORY_REGISTRY = CATEGORY_REGISTRY;
  // One helper every rule goes through, so a rule can never invent a symbol or label
  // that the legend does not carry.
  function cat(key, extra) {
    const c = CATEGORY_REGISTRY[key];
    if (!c) throw new Error('unknown category key: ' + key);
    return Object.assign({ typeKey: c.key, shape: c.symbol, legendLabel: c.label }, extra || {});
  }
  HS.categoryFor = function (key) { return CATEGORY_REGISTRY[key] || null; };
  const TYPE_EXACT = {
    'data center':              cat('datacenter'),
    'industrial':               cat('industrial'),
    'residential':              cat('residential'),
    'roads & infrastructure':   cat('infrastructure'),
    'infrastructure':           cat('infrastructure'),
    'commercial':               cat('commercial'),
    'utility':                  cat('infrastructure'),
    'development':              cat('other'),
    'civic/public':             cat('civic'),
    'civic':                    cat('civic'),
    'unclassified':             cat('other'),
    'regulated facility':       cat('facility')
  };
  const LAYER_EXACT = {
    datacenter:       TYPE_EXACT['data center'],
    industrial:       TYPE_EXACT.industrial,
    residential:      TYPE_EXACT.residential,
    energy:           TYPE_EXACT.utility,
    logistics:        TYPE_EXACT.industrial,
    commercial:       TYPE_EXACT.commercial,
    'animal-facility': TYPE_EXACT.industrial,
    research:         TYPE_EXACT.industrial
  };
  // Source-stamped generic buckets — honest when nothing more specific is knowable,
  // but NON-TERMINAL: keyword rules (incl. name/title) may still classify the record.
  // `civic/public` and `civic` are NO LONGER generic — they are a real, source-stated
  // category with their own legend row, so they are TERMINAL and must not fall through
  // to the name phase (which would let "Del Valle High School" be re-read as something
  // else). Only the genuinely contentless buckets stay non-terminal.
  const GENERIC_EXACT = new Set(['development', 'unclassified', 'trades', 'land use']);
  // Keyword phase — most-specific multi-word patterns first to avoid collisions.
  const KEYWORD_RULES = [
    { re: /mixed[-\s]?use\s+residential|residential\s+mixed/i, typeKey: 'residential', shape: 'pentagon', legendLabel: 'Residential' },
    { re: /mixed[-\s]?use/i, typeKey: 'commercial', shape: 'hexagon', legendLabel: 'Commercial' },
    // OCTAGON, not square: `facility` owns the square (CATEGORY_REGISTRY), so a square
    // here made a data-center project visually identical to a Regulated facility and
    // contradicted the legend, which is GENERATED from the registry. Symbol uniqueness
    // is an invariant — asserted on real rule OUTPUT by test/maps-rule-output-contract.test.mjs.
    { re: /data\s*center|hyperscale|server\s*farm/i, typeKey: 'datacenter', shape: 'octagon', legendLabel: 'Data center' },
    { re: /water\s+treatment|wastewater|sewage|sewer\s+plant/i, typeKey: 'utility', shape: 'diamond', legendLabel: 'Roads & infrastructure' },
    { re: /\bschool\b|education/i, typeKey: 'civic', shape: 'circle', legendLabel: 'Other project' },
    { re: /industrial|manufactur|warehouse|logistic|factory/i, typeKey: 'industrial', shape: 'triangle', legendLabel: 'Industrial' },
    { re: /\bplant\b/i, typeKey: 'industrial', shape: 'triangle', legendLabel: 'Industrial' },
    { re: /resid|housing|subdivision|apartment|neighborhood/i, typeKey: 'residential', shape: 'pentagon', legendLabel: 'Residential' },
    { re: /road|infrastructure|transit|transport|utility|pipeline|rail|airport|bridge/i, typeKey: 'infrastructure', shape: 'diamond', legendLabel: 'Roads & infrastructure' },
    { re: /commercial|retail|office|hotel|event|entertain/i, typeKey: 'commercial', shape: 'hexagon', legendLabel: 'Commercial' }
  ];
  // Name-enrichment phase (2026-07-25, founder-approved): 78% of production dev
  // records carry a GENERIC source type ("Development"/"unclassified"/"Trades"),
  // but their NAME embeds the source's own permit-class text ("Residential
  // Alteration", "Multi Family - Other Structural", "Addition and/or Alteration
  // Commercial Building", "Wireless Communication Facility"). These rules derive
  // the type SHAPE from that record-stated class — never a guess — and run ONLY
  // when the type/layer/category phases resolved to the generic 'other' bucket,
  // so a record with a specific source type is never reinterpreted. Calibrated
  // on the live app_projects vocabulary (docs/maps-marker-symbology-audit
  // §name-enrichment); high-precision on purpose: trades/sign/demolition/board-up
  // classes state no building type, so they stay the honest neutral circle.
  const NAME_RULES = [
    { re: /mixed[-\s]?use\s+residential|residential\s+mixed/i, typeKey: 'residential', shape: 'pentagon', legendLabel: 'Residential' },
    { re: /mixed[-\s]?use/i, typeKey: 'commercial', shape: 'hexagon', legendLabel: 'Commercial' },
    // OCTAGON, not square: `facility` owns the square (CATEGORY_REGISTRY), so a square
    // here made a data-center project visually identical to a Regulated facility and
    // contradicted the legend, which is GENERATED from the registry. Symbol uniqueness
    // is an invariant — asserted on real rule OUTPUT by test/maps-rule-output-contract.test.mjs.
    { re: /data\s*center|hyperscale|server\s*farm/i, typeKey: 'datacenter', shape: 'octagon', legendLabel: 'Data center' },
    // Infrastructure: MAINS and public-way work only — a house sewer/gas LATERAL
    // ("Install sewer line", "gas service connection") is a trade job on a parcel,
    // not an infrastructure project, so those deliberately do NOT match. 'sidewalk'
    // is deliberately absent too: NYC facade-repair descriptions carry "sidewalk
    // shed" (temporary scaffolding — building work), which made it a false signal.
    // \broadway\b: word-anchored — "Broadway" the street name contains 'roadway' as a
    // bare substring (real San Diego permit addresses), so the boundary is load-bearing.
    // CIVIC & PUBLIC — strong, unambiguous public-institution nouns only. Runs BEFORE
    // infrastructure so "Correctional Complex WATER QUALITY Improvements" reads as the
    // correctional-facility project it is. `\bpark\b` is deliberately ABSENT: "Business
    // Park", "RV Park", "Fast Park" and "Parking" are all live non-civic records.
    { re: /\bschools?\b|\bisd\b|\bfire\s*(?:&|and|\/)?\s*ems\b|\bfire\s+station\b|\bems\s+station\b|\bfire\s+rescue\b|correctional|\bcorrection\s+facility\b|\bsheriff\b|\bcourthouse\b|community\s+cent(?:er|re)\b|public\s+library\b/i,
      // CROSS-STATE FALSE-POSITIVE GUARD (national audit, 2026-07-25). Two real collisions
      // found in live rows: (a) STREET NAMES — "2760 Gattis School Rd - Rezoning",
      // "4001 Smith School Road" (TX) are addresses, not school projects; (b) PRIVATE
      // TRAINING BUSINESSES — "Aqua Ducks Swim School" (CA), "Martial Arts School" (WA),
      // "Trade School (Truck Driving)" (MI), "Acton Business School" (TX) are commercial
      // tenants, not public civic institutions.
      not: /school\s+(?:rd|road|st|street|ave|avenue|ln|lane|dr|drive|blvd|boulevard|way|pkwy|parkway|ct|court)\b|\b(?:swim|martial\s+arts|driving|truck\s+driving|trade|business|beauty|barber|dance|music|flight|vocational|culinary|charm)\s+school\b/i,
      ...cat('civic') },
    // INFRASTRUCTURE — mains, public-way work, and utility plant. Extended with the
    // wastewater/energy vocabulary that Austin-style site-plan names actually use.
    // `\bstation\b` alone is NOT a rule (it would swallow "EMS Station"); only the
    // compound utility nouns count.
    { re: /wireless\s+communication|cell\s+tower|telecommunications?\s+tower|antenna|water\s+main|sewer\s+main|gas\s+main\b|right[-\s]?of[-\s]?way|\broadway\b|street\s+improvement|\bwwtp\b|\bwastewater\b|water\s+treatment|\blift\s+station\b|\bsubstation\b|\bwater\s?line\b|\bpipeline\b|\benergy\s+cent(?:er|re)\b/i,
      ...cat('infrastructure') },
    // `manufactured/mobile home` is a RESIDENTIAL product, not a factory — the negative
    // lookahead stops the `manufactur` stem from claiming it before the residential rule.
    { re: /(?:industrial|warehouse|manufactur(?!ed\s+home|ed\s+housing)|factory|\bbrewery\b|\bdistillery\b)/i, ...cat('industrial') },
    { re: /residential|\b1,\s?2,\s?3\s+family\b|\b(one|two|three|single|multi|1|2|3)[-\s]?family\b|\bmulti[-\s]?family\b|townhou?se|duplex|dwelling|apartment|condominium|manufactured\s+home|mobile\s+home/i,
      ...cat('residential') },
    // `\bstorage\b` alone was a CONFIRMED false positive nationally: "10x10 Accessory
    // Storage Shed ... in backyard" (LA), "Attached Garage addition with unconditioned
    // storage above" (NC), "carport addition connecting existing SFD and new unfinished
    // storage space" (WA) are all residential accessory work. Only a commercial storage
    // NOUN counts now; a bare mention does not.
    { re: /commercial|\bhotels?\b|\bmotels?\b|\bresorts?\b|\bretail\b|business\s+park\b|shopping\s+cent|\bcar\s*wash(?:es)?\b|self[-\s]?storage|mini[-\s]?storage|\bstorage\s+(?:facility|units?|cent(?:er|re)|yard)\b/i, ...cat('commercial') },
    // LAST resort before the honest circle: a plat-stage SUBDIVISION with no other
    // stated class. Deliberately after commercial/industrial/civic so
    // "Bergstrom East COMMERCIAL Subdivision" stays commercial. Bare "plat"/"section"
    // are NOT rules — a section number states no building type, so those records keep
    // the honest fallback rather than being guessed into Residential.
    { re: /\b(?:re)?subdivision\b/i, ...cat('residential') }
  ];
  // GENERATED from CATEGORY_REGISTRY — never hand-listed, so the legend cannot drift
  // from what the renderer draws. The facility row is emitted separately (it carries
  // its own colour, not the neutral swatch), which is why it is filtered out here.
  HS.SHAPE_LEGEND = Object.keys(CATEGORY_REGISTRY)
    .filter(function (k) { return CATEGORY_REGISTRY[k].legend && !CATEGORY_REGISTRY[k].isFacility; })
    .map(function (k) { return { shape: CATEGORY_REGISTRY[k].symbol, label: CATEGORY_REGISTRY[k].label, categoryKey: k }; });
  HS.STATUS_LEGEND_ROWS = [
    { key: 'proposed',  hex: HX.proposed,  label: STATUS_TIERS.proposed.label },
    { key: 'approved',  hex: HX.approved,  label: STATUS_TIERS.approved.label },
    { key: 'operating', hex: HX.operating, label: STATUS_TIERS.operating.label },
    { key: 'unknown',   hex: STATUS_TIERS.unknown.hex, label: STATUS_TIERS.unknown.label },
    { key: 'facility',  hex: FACILITY_HEX, label: CATEGORY_REGISTRY.facility.label, squareSwatch: true }
  ];
  // Development-tracker lifecycle colors — intentionally separate from permit-status
  // colors; used only when resolveMarker is called with colorMode:'lifecycle'.
  HS.LIFECYCLE_HEX = { built: '#1f5130', approved: '#2563EB', proposed: '#E2772F', permit: '#E2772F',
                       operating: '#1f5130', unknown: HX.onfile };
  HS.markerRegistry = {
    facilityHex: FACILITY_HEX,
    neutralHex: LEGEND_NEUTRAL_HEX,
    statusHex: HX,
    lifecycleHex: HS.LIFECYCLE_HEX,
    shapeLegend: HS.SHAPE_LEGEND,
    statusLegend: HS.STATUS_LEGEND_ROWS
  };

  function normType(s) { return String(s || '').trim().toLowerCase(); }
  function isFacilityItem(item) {
    return !!(item && (item._facility || item.record_kind === 'facility'));
  }
  function typeInfoFromExact(raw, displayLabel) {
    const hit = TYPE_EXACT[normType(raw)];
    if (!hit || GENERIC_EXACT.has(normType(raw))) return null;
    return Object.assign({ typeLabel: displayLabel || raw || hit.legendLabel, shapeRule: 'TYPE_EXACT:' + normType(raw) }, hit);
  }
  // Name phase: derive the type SHAPE from the record's own permit-class text in
  // name/title/label via the HIGH-PRECISION NAME_RULES — runs only after the exact,
  // layer, and keyword phases found nothing. Returns null when the name states no
  // building type — the honest neutral circle stands.
  function refineFromName(item, display) {
    const nm = String((item && (item.name || item.title || item.label)) || '');
    if (!nm) return null;
    for (let k = 0; k < NAME_RULES.length; k++) {
      const rule = NAME_RULES[k];
      if (rule.not && rule.not.test(nm)) continue;   // exclusion guard (see NAME_RULES)
      if (rule.re.test(nm)) {
        return { typeKey: rule.typeKey, shape: rule.shape, legendLabel: rule.legendLabel,
                 typeLabel: display || rule.legendLabel, shapeRule: 'NAME:' + rule.typeKey };
      }
    }
    return null;
  }
  function classifyProjectType(item) {
    const display = (item && (item.type || item.use_type || item.layer || item.category)) || '';
    const fields = [item && item.type, item && item.use_type, item && item.layer, item && item.category];
    for (let i = 0; i < fields.length; i++) {
      const hit = typeInfoFromExact(fields[i], i === 0 ? display : (fields[0] || fields[i]));
      if (hit) return hit;
      const layerKey = normType(fields[i]);
      const layerHit = LAYER_EXACT[layerKey];
      if (layerHit) return Object.assign({ typeLabel: display || layerHit.legendLabel, shapeRule: 'LAYER_EXACT:' + layerKey }, layerHit);
    }
    // Keyword phase runs on the TYPE FIELDS ONLY — short source class strings where
    // the broad patterns are safe. The record NAME is deliberately NOT in this string:
    // permit names are long free text where broad keywords misfire on real records
    // ("…Building Construction:655/Broadway" → 'road' → infrastructure; "Neighborhood
    // Development Permit Wireless Communication Facility" → 'neighborhood' →
    // residential — both live app_projects rows). Names go through the calibrated
    // NAME_RULES phase below instead (audit doc §6).
    const combined = fields.filter(Boolean).map(normType).join(' ');
    for (let j = 0; j < KEYWORD_RULES.length; j++) {
      const rule = KEYWORD_RULES[j];
      if (rule.re.test(combined)) {
        return { typeKey: rule.typeKey, shape: rule.shape, legendLabel: rule.legendLabel,
                 typeLabel: display || rule.legendLabel, shapeRule: 'KEYWORD:' + rule.typeKey };
      }
    }
    const refined = refineFromName(item, display);
    if (refined) return refined;
    // HONEST FALLBACK — carries an explicit machine-readable reason so a page (or an
    // audit) can say WHY a record is uncategorised instead of implying it is a
    // nondescript project.
    const hadType = fields.some(Boolean);
    return Object.assign(cat('other'), {
      typeLabel: display || CATEGORY_REGISTRY.other.label,
      shapeRule: 'FALLBACK:other',
      fallbackReason: hadType ? 'source type is a generic bucket and the record name states no building class'
                              : 'source states no project type and the record name states no building class'
    });
  }
  HS.classifyProjectType = classifyProjectType;
  function popupLabelFor(item, m) {
    const name = (item && (item.name || item.title || item.label)) || 'Project';
    const dist = (item && item.dist) ? ', ' + item.dist + (String(item.dist).indexOf('away') !== -1 ? '' : ' away') : '';
    if (m.isFacility) return name + ', Regulated facility' + dist;
    const typePart = m.typeLabel || (item && item.type) || '';
    const statusPart = (item && item.status) ? ', ' + item.status : '';
    return name + (typePart ? ', ' + typePart : '') + statusPart + dist;
  }
  HS.resolveMarker = function (item, opts) {
    opts = opts || {};
    if (isFacilityItem(item)) {
      return {
        shape: CATEGORY_REGISTRY.facility.symbol,
        color: FACILITY_HEX,
        categoryKey: 'facility',
        lifecycle: 'operating',
        lifecycleLabel: STATUS_TIERS.operating.label,
        fallbackReason: null,
        typeKey: 'facility',
        typeLabel: CATEGORY_REGISTRY.facility.label,
        statusKey: 'facility',
        statusLabel: CATEGORY_REGISTRY.facility.label,
        legendLabel: CATEGORY_REGISTRY.facility.label,
        shapeRule: 'PRECEDENCE:facility-flag',
        popupLabel: popupLabelFor(item, { isFacility: true }),
        filterKey: 'facility',
        isFacility: true
      };
    }
    const typeInfo = classifyProjectType(item);
    const st = statusTier(item);
    let color = st.hex;
    if (opts.colorMode === 'lifecycle') {
      const b = opts.lifecycleBucket || (item && item.lifecycleBucket);
      const lhx = HS.LIFECYCLE_HEX;
      if (b && lhx[b]) color = lhx[b];
    }
    // `unknown` is its OWN filter bucket. It used to be folded into 'operating', which
    // both hid these records behind the "Operating now" toggle and asserted a lifecycle
    // the source never stated.
    const filterKey = st.k;
    const m = {
      categoryKey: typeInfo.typeKey,
      lifecycle: st.k,
      lifecycleLabel: st.label,
      fallbackReason: typeInfo.fallbackReason || null,
      shape: typeInfo.shape,
      color: color,
      typeKey: typeInfo.typeKey,
      typeLabel: typeInfo.typeLabel,
      statusKey: st.k,
      statusLabel: st.label,
      legendLabel: typeInfo.legendLabel,
      shapeRule: typeInfo.shapeRule || 'FALLBACK:other',
      popupLabel: popupLabelFor(item, { isFacility: false, typeLabel: typeInfo.typeLabel }),
      filterKey: filterKey,
      isFacility: false
    };
    return m;
  };
  // Normalize a development-tracker site row for resolveMarker (Approach B: canonical
  // type shape + facility override; lifecycle color via colorMode:'lifecycle').
  HS.trackerSiteItem = function (s, frsRidFn) {
    const rid = frsRidFn ? frsRidFn(s) : ((s && s.registry_id) || '');
    // LIFECYCLE, HONESTLY. The old form was
    //   type==='built' ? 'built' : type==='approved' ? 'approved' : 'proposed'
    // so ANY record the engine could not bucket silently became "Proposed", and a
    // TABS-style record stamped type='built' with no status evidence became a green
    // "Operating now" pin on this page while the app map showed it as "On file".
    // Now: an explicit engine bucket wins; a record with NO lifecycle evidence
    // (no bucket AND no status_raw) resolves to the first-class `unknown` state.
    // EVIDENCE ORDER: the engine's canonical `bucket` wins; failing that an EXPLICIT
    // lifecycle `type` (proposed|approved|built) counts; anything else — including a
    // blank/absent/unrecognised value — is `unknown`. The old code's trailing
    // `: 'proposed'` meant a record with NO lifecycle evidence at all was asserted to be
    // proposed, and a source that stamped `built` with no supporting status was asserted
    // to be operating. A source with nothing to say must leave the page saying nothing.
    const declared = String((s && s.bucket) || '').toLowerCase();
    const t = String((s && s.type) || '').toLowerCase();
    const bucket = (declared === 'built' || declared === 'operating' || t === 'built' || t === 'operating') ? 'operating'
      : (declared === 'approved' || t === 'approved') ? 'approved'
      : (declared === 'proposed' || t === 'proposed') ? 'proposed'
      : 'unknown';
    return {
      type: (s && s.use_type) || '',
      use_type: s && s.use_type,
      layer: s && s.layer,
      status: bucket === 'operating' ? 'Operating'
            : bucket === 'approved' ? 'Approved'
            : bucket === 'proposed' ? 'Proposed' : 'Unknown',
      record_kind: rid ? 'facility' : undefined,
      _facility: !!rid,
      name: s && s.label,
      title: s && s.label,
      label: s && s.label,
      lifecycleBucket: bucket
    };
  };
  HS.resolveTrackerMarker = function (s, frsRidFn) {
    const it = HS.trackerSiteItem(s, frsRidFn);
    return HS.resolveMarker(it, { colorMode: 'lifecycle', lifecycleBucket: it.lifecycleBucket });
  };
  HS.projectShape = function (it) { return HS.resolveMarker(it).shape; };
  HS.paintStatusLegend = function (root) {
    const el = root || document;
    (HS.STATUS_LEGEND_ROWS || []).forEach(function (row) {
      const node = el.getElementById ? el.getElementById(
        row.key === 'proposed' ? 'sttProposed' : row.key === 'approved' ? 'sttApproved'
          : row.key === 'operating' ? 'sttOperating' : row.key === 'facility' ? 'legFacility' : ''
      ) : null;
      if (!node) return;
      const sw = node.querySelector('.ld');
      if (sw) {
        sw.style.background = row.hex;
        if (row.squareSwatch) sw.style.borderRadius = '2px';
      }
    });
  };

  function polyPts(cx, cy, r, n, startDeg) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (startDeg + i * 360 / n) * Math.PI / 180;
      pts.push((cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2));
    }
    return pts.join(' ');
  }
  // Inner SVG geometry for a shape centered at (cx,cy) with radius r, filled + white outline.
  // Shared by the schematic diagram (absolute coords) and the tile-marker builder below.
  function shapeEl(shape, cx, cy, r, fill, strokeW) {
    const sw = strokeW == null ? 3 : strokeW;
    const common = 'fill="' + fill + '" stroke="#fff" stroke-width="' + sw + '" stroke-linejoin="round"';
    switch (shape) {
      case 'square':   return '<rect x="' + (cx - r) + '" y="' + (cy - r) + '" width="' + (2 * r) + '" height="' + (2 * r) + '" rx="' + (r * 0.3).toFixed(2) + '" ' + common + '/>';
      case 'triangle': return '<polygon points="' + polyPts(cx, cy, r * 1.16, 3, -90) + '" ' + common + '/>';
      case 'diamond':  return '<polygon points="' + polyPts(cx, cy, r * 1.28, 4, -90) + '" ' + common + '/>';
      case 'hexagon':  return '<polygon points="' + polyPts(cx, cy, r * 1.12, 6, -90) + '" ' + common + '/>';
      case 'pentagon': return '<polygon points="' + polyPts(cx, cy, r * 1.16, 5, -90) + '" ' + common + '/>';
      // Data center — octagon. Distinct from the facility square (see CATEGORY_REGISTRY).
      case 'octagon':  return '<polygon points="' + polyPts(cx, cy, r * 1.08, 8, -112.5) + '" ' + common + '/>';
      // Civic & public — a plus/cross, readable at 14px and unlike every other symbol.
      case 'cross': {
        const a = (r * 0.42).toFixed(2), b = r.toFixed(2);
        return '<polygon points="' + [
          [-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a], [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a]
        ].map(function (p) { return (cx + Number(p[0])).toFixed(2) + ',' + (cy + Number(p[1])).toFixed(2); }).join(' ') + '" ' + common + '/>';
      }
      case 'circle':
      default:         return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" ' + common + '/>';
    }
  }
  HS.shapeEl = shapeEl;
  // A standalone map-pin SVG (shape = type, fill = status color, optional white letter).
  // Used by BOTH tile engines (MapLibre + Leaflet div markers). The triangle's letter
  // nudges down so it sits inside the narrower apex.
  HS.markerSVG = function (shape, color, label, size) {
    size = size || 26;
    const c = size / 2, r = size * 0.40;
    const dy = shape === 'triangle' ? size * 0.10 : 0;
    const txt = label ? '<text x="' + c + '" y="' + (c + dy) + '" text-anchor="middle" dominant-baseline="central" '
      + 'font-family="sans-serif" font-weight="700" font-size="' + (size * 0.44).toFixed(1) + '" fill="#fff">' + label + '</text>' : '';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg" '
      + 'style="overflow:visible;filter:drop-shadow(0 1px 3px rgba(0,0,0,.4))">' + shapeEl(shape, c, c, r, color, 3) + txt + '</svg>';
  };

  // ── Quality-of-Life lens (Sprint-1) ──────────────────────────────────────
  // The five resident-facing QoL dimensions. A project maps to a QoL category
  // ONLY when its own public-record impact_dimensions say so (by key or label) —
  // never inferred from the project type. So the QoL filter/section narrows to
  // records that actually flag the dimension; absent stays absent (anti-fabrication).
  HS.QOL = ['Air', 'Water', 'Soil', 'Noise', 'Light'];
  const QOL_KEYS = { air: 'Air', water: 'Water', soil: 'Soil', noise: 'Noise', light: 'Light' };
  HS.qolOf = function (it) {
    const out = {}, dims = (it && (it.impact_dimensions || it.impacts)) || [];
    dims.forEach(function (d) {
      const k = String((d && d.k) || '').toLowerCase(), lab = String((d && d.label) || '').toLowerCase();
      Object.keys(QOL_KEYS).forEach(function (q) {
        if (k === q || lab.indexOf(q) !== -1) out[QOL_KEYS[q]] = d;
      });
    });
    return out;   // { 'Air': dim, 'Water': dim, ... } — only dimensions on the record
  };

  // ── "What's Changed" derivation (Sprint 7) ────────────────────────────────
  // There is NO change-history store, so every entry is derived from a date the
  // record itself carries, and labeled as exactly that (the honest fallback):
  //   NEW     — a project whose county FILING date (submitted_at) is in-window
  //   HEARING — an UPCOMING public hearing matched to the project
  //   UPDATE  — an official notice/change record RECORDED (occurred_at) in-window
  // APPROVED / CONSTRUCTION badges would need status-TRANSITION history the data
  // doesn't carry (a current status says nothing about WHEN it changed), so they
  // are deliberately absent. Never fabricate a change event.
  // Pure + side-effect-free so test/recent-changes.test.mjs can pin every gate.
  HS.recentChanges = function (projects, changes, meetings, o) {
    o = o || {};
    const days = o.days != null ? o.days : 30;
    const now = o.now ? new Date(o.now) : new Date();
    const fmt = d => HS.fmtDate(d, { month: 'long', day: 'numeric' });
    function daysAgo(d) { const t = new Date(d); return isNaN(t) ? null : (now - t) / 86400000; }
    const out = [];
    (projects || []).forEach(function (p) {
      const badges = [], lines = [];
      let when = null;
      const ago = p.submitted_at != null ? daysAgo(p.submitted_at) : null;
      if (ago != null && ago >= 0 && ago <= days) {
        badges.push('NEW');
        lines.push('Filed with the county ' + fmt(p.submitted_at));
        when = p.submitted_at;
      }
      const mtg = (meetings || []).find(function (m) {
        return m.related_project_id === p.id && m.starts_at && new Date(m.starts_at) > now;
      });
      if (mtg) {
        badges.push('HEARING');
        lines.push('Public hearing ' + fmt(mtg.starts_at));
        if (!when) when = mtg.starts_at;
      }
      if (badges.length) out.push({ id: p.id, kind: 'project', badges: badges, lines: lines, when: when, hearing: !!mtg, item: p });
    });
    (changes || []).forEach(function (c) {
      if (c.quiet) return;
      const ago = c.occurred_at != null ? daysAgo(c.occurred_at) : null;
      if (ago == null || ago < 0 || ago > days) return;
      const lines = ['Recorded ' + fmt(c.occurred_at)];
      const closes = c.window_closes_at != null ? daysAgo(c.window_closes_at) : null;
      if (closes != null && closes <= 0) lines.push('Comment window closes ' + fmt(c.window_closes_at));
      out.push({ id: c.id, kind: 'change', badges: ['UPDATE'], lines: lines, when: c.occurred_at, hearing: false, item: c });
    });
    // Actionable first (upcoming hearings, soonest first), then newest first.
    return out.sort(function (a, b) {
      if (a.hearing !== b.hearing) return a.hearing ? -1 : 1;
      if (a.hearing && b.hearing) return String(a.when || '').localeCompare(String(b.when || ''));
      return String(b.when || '').localeCompare(String(a.when || ''));
    });
  };

  // The resident-home marker IS the HomeSignal logo mark (founder-specified):
  // the brand's green rounded tile with the white house glyph — same SVG as the
  // header logo in partials/shell.html. ONE builder, used by every map engine.
  const HOME_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:__SZ__px;height:__SZ__px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>';
  HS.homeMarkerHTML = function (size) {
    const inner = Math.round(size * 0.62);
    return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:' + Math.round(size * 0.28) + 'px;'
      + 'background:#157a49;border:2.5px solid #fff;box-shadow:0 0 0 5px rgba(21,122,73,.18),0 1px 4px rgba(0,0,0,.35);'
      + 'display:grid;place-items:center">' + HOME_GLYPH.replace(/__SZ__/g, inner) + '</div>';
  };

  // Popup body for the home pin — says WHICH address is logged, not just
  // "Your home" (the bare label left the pinned address a mystery). Shows only
  // the address actually saved on the row (HS.homeAddressLine — absent parts
  // stay absent), used by every map engine that pops the home marker.
  HS.homePopupHTML = function (p) {
    const line = HS.homeAddressLine ? HS.homeAddressLine(p) : ((p && p.address) || '');
    return '<div style="font:600 13px/1.3 var(--font)">Your home</div>'
      + (line ? '<div style="font-size:12px;color:#16211c;margin-top:2px">' + HS.esc(line) + '</div>' : '')
      + '<div style="font-size:11px;color:#5a6b63;margin-top:2px">The home address saved on your account</div>';
  };

  const MapProvider = {
    name: 'schematic',
    // render into `el`; returns [{letter,item,color}] in draw order for a synced pin list
    render(el, opts) {
      const { home, items = [], radiusMi = 1.5, showRadius = true, showHome = true, homeLabel = '', w = 780, h = 520, itemClick } = opts;
      const cx = w / 2, cy = h / 2, radiusPx = Math.min(w, h) * 0.29;
      const pxPerMile = radiusPx / radiusMi;
      const hLat = home ? home.lat : (items[0] && items[0].lat) || 0;
      const hLng = home ? home.lng : (items[0] && items[0].lng) || 0;
      const place = (lat, lng) => {
        const north = (lat - hLat) * 69;               // mi north
        const east = (lng - hLng) * 69 * Math.cos(hLat * Math.PI / 180); // mi east
        return { x: Math.max(20, Math.min(w - 20, cx + east * pxPerMile)),
                 y: Math.max(20, Math.min(h - 20, cy - north * pxPerMile)) };
      };
      const letters = 'ABCDEFGHIJKLMNOP';
      const shown = items.slice(0, letters.length);
      const pins = shown.map((it, i) => {
        const p = place(it.lat, it.lng), m = HS.resolveMarker(it);
        return { letter: letters[i], item: it, color: m.color, shape: m.shape, x: p.x, y: p.y };
      });
      // Flat neutral field only. The old decorative green/blue "landmass" and
      // "water" blobs and the crossing road-lines all sat at fixed positions
      // unrelated to the data or the radius ring, so they never shifted when the
      // radius changed — which read as fake. The home, pins, and radius ring
      // carry all the real information.
      const bg = `
        <rect width="${w}" height="${h}" fill="#e4eadd"/>`;
      const radius = showRadius ? `
        <circle cx="${cx}" cy="${cy}" r="${radiusPx}" fill="#157a49" fill-opacity="0.07" stroke="#157a49" stroke-opacity="0.35" stroke-dasharray="7 7"/>
        <text x="${cx}" y="${cy-radiusPx-6}" font-size="11" fill="#157a49" text-anchor="middle" font-family="sans-serif" opacity="0.8">${radiusMi} mi radius</text>` : '';
      // Only mark a REAL resident home; a centroid stand-in is never labeled "Your home".
      // The mark is the HomeSignal LOGO (green rounded tile + white house glyph), drawn
      // LAST (class hs-home) so nearby pins/facilities never bury it — the label gets a
      // white halo so it stays readable over anything underneath. When the caller
      // passes homeLabel (the logged street address) it renders under "Your home",
      // so the diagram says WHICH address is pinned — only ever a saved address,
      // never derived here.
      const homeAddr = (showHome && homeLabel) ? `
        <text x="${cx}" y="${cy+48}" font-size="10.5" fill="#3d4c45" stroke="#fff" stroke-width="4" paint-order="stroke" text-anchor="middle" font-weight="600" font-family="sans-serif">${HS.esc(homeLabel)}</text>` : '';
      const homeMark = showHome ? `
        <g class="hs-home"><rect x="${cx-14}" y="${cy-14}" width="28" height="28" rx="8" fill="#157a49" stroke="#fff" stroke-width="3"/>
        <g transform="translate(${cx-9},${cy-9.5}) scale(0.79)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></g>
        <text x="${cx}" y="${cy+34}" font-size="11.5" fill="#16211c" stroke="#fff" stroke-width="4" paint-order="stroke" text-anchor="middle" font-weight="700" font-family="sans-serif">Your home</text>${homeAddr}</g>` : '';
      const pinSvg = pins.map((p, idx) => {
        const shape = p.shape;
        const dy = shape === 'triangle' ? 6.5 : 5;
        const click = itemClick ? (' data-hs-map-item="" tabindex="0" role="button" aria-label="' + HS.esc(HS.resolveMarker(p.item).popupLabel) + '"') : '';
        return `<g class="hspin"${click} data-pin-idx="${idx}">${shapeEl(shape, p.x, p.y, 15, p.color, 3)}
        <text x="${p.x}" y="${p.y + dy}" font-size="13" fill="#fff" text-anchor="middle" font-weight="700" font-family="sans-serif">${p.letter}</text></g>`;
      }).join('');
      el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${bg}${radius}${pinSvg}${homeMark}</svg>`;
      if (itemClick) {
        pins.forEach((p, idx) => {
          const g = el.querySelector('g[data-pin-idx="' + idx + '"]');
          if (!g) return;
          g.style.cursor = 'pointer';
          const go = function (e) { if (e) e.stopPropagation(); itemClick(p.item); };
          g.addEventListener('click', go);
          g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
        });
      }
      return pins;
    }
  };
  HS.MapProvider = MapProvider;

  // ---- shared real-tile helpers ----
  HS._circle = function (lat, lng, rMi) {
    const pts = [], R = rMi / 69.0, cs = Math.cos(lat * Math.PI / 180);
    for (let i = 0; i <= 64; i++) { const a = i / 64 * 2 * Math.PI; pts.push([lng + (R * Math.sin(a)) / cs, lat + R * Math.cos(a)]); }
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } }] };
  };
  HS._glSources = function () {
    return {
      sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri, Maxar' },
      osm: { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png', 'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png', 'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' }
    };
  };

  // Lazily load Leaflet from jsDelivr (the no-WebGL raster engine). Shared by
  // maps.html and buildLive; healthy-WebGL visitors never fetch it.
  HS.loadLeaflet = function (cb) {
    if (window.L && window.L.map) return cb(true);
    if (HS.loadLeaflet._q) { HS.loadLeaflet._q.push(cb); return; }
    const q = HS.loadLeaflet._q = [cb];
    const css = document.createElement('link'); css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
    s.onload = function () { const ok = !!(window.L && window.L.map); HS.loadLeaflet._q = null; q.forEach(f => f(ok)); };
    s.onerror = function () { HS.loadLeaflet._q = null; q.forEach(f => f(false)); };
    document.head.appendChild(s);
  };

  // Compact guarded live map for previews (Dashboard). Full chain:
  // MapLibre GL (WebGL ok) -> Leaflet rasters (WebGL off / GL failed) -> schematic.
  // NEVER throws into the caller, and NEVER fabricates a home marker: the green
  // home dot renders only when o.home is a real resident home (caller-verified).
  HS.buildLive = function (el, o) {
    o = o || {};
    const items = (o.items || []).filter(it => it.lat != null && it.lng != null);
    const center = o.center
      || (o.home ? { lat: o.home.lat, lng: o.home.lng } : null)
      || (items[0] ? { lat: items[0].lat, lng: items[0].lng } : null);
    function schematic() {
      try {
        MapProvider.render(el, { home: center, items: items, radiusMi: o.radiusMi || 1.5,
          showRadius: o.radiusMi != null, showHome: !!o.home, homeLabel: o.home ? (o.home.address || '') : '',
          w: o.w || 640, h: o.h || 300, itemClick: o.itemClick });
      } catch (e) { /* a dead preview box is better than a dead page */ }
    }
    if (!center) { schematic(); return; }
    function leaflet() {
      HS.loadLeaflet(function (ok) {
        if (!ok) { schematic(); return; }
        try {
          el.innerHTML = '';
          const m = L.map(el, { zoomSnap: 0.2, zoomControl: o.interactive !== false,
            dragging: o.interactive !== false, scrollWheelZoom: false });
          if (m.attributionControl) m.attributionControl.setPrefix(
            '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>');
          const t = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri, Maxar', maxZoom: 19 });
          let okTiles = 0, errs = 0, dead = false;
          function toSchematic() { if (dead) return; dead = true; try { m.remove(); } catch (e) {} schematic(); }
          t.on('tileload', function () { okTiles++; });
          t.on('tileerror', function () { if (++errs >= 4 && okTiles === 0) toSchematic(); });
          setTimeout(function () { if (okTiles === 0) toSchematic(); }, 8000);
          t.addTo(m);
          m.setView([center.lat, center.lng], o.zoom || 12);
          if (o.radiusMi) L.circle([center.lat, center.lng], { radius: o.radiusMi * 1609.34,
            color: '#157a49', weight: 2, dashArray: '4 4', fillColor: '#157a49', fillOpacity: 0.08 }).addTo(m);
          const div = (html, size) => L.divIcon({ html: html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
          if (o.home) L.marker([o.home.lat, o.home.lng], { zIndexOffset: 1000, icon: div(HS.homeMarkerHTML(22), 22),
            title: 'Your home · ' + (HS.homeAddressLine ? HS.homeAddressLine(o.home) : o.home.address || '') }).addTo(m);
          items.forEach(function (it) {
            const m = HS.resolveMarker(it);
            const mk = L.marker([it.lat, it.lng], { icon: div('<div style="line-height:0"' + (o.itemClick ? ' data-hs-map-item="" tabindex="0" role="button"' : '') + '>' + HS.markerSVG(m.shape, m.color, '', 20) + '</div>', 20) });
            if (o.itemClick) {
              const go = function (e) { if (e && e.originalEvent) e.originalEvent.stopPropagation(); o.itemClick(it); };
              mk.on('click', go);
              const el = mk.getElement();
              if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
            }
            mk.addTo(m);
          });
          if (o.onReady) o.onReady(m);
          if (o.itemClick) {
            m.on('dragstart', function () { el._hsDragged = true; });
            m.on('dragend', function () { setTimeout(function () { el._hsDragged = false; }, 0); });
          }
        } catch (e) { schematic(); }
      });
    }
    if (!window.maplibregl) { leaflet(); return; }
    let map = null, degraded = false, ready = false, tilesOK = 0, tileErrs = 0;
    function degrade() {
      if (degraded) return; degraded = true;
      try { if (map) map.remove(); } catch (e) {}
      map = null; leaflet();
    }
    try {
      map = new maplibregl.Map({
        container: el,
        style: { version: 8, sources: HS._glSources(), layers: [{ id: 'sat', type: 'raster', source: 'sat' }] },
        center: [center.lng, center.lat], zoom: o.zoom || 12,
        interactive: o.interactive !== false, attributionControl: false
      });
    } catch (e) { degrade(); return; }   // WebGL unavailable (hardened browsers)
    map.on('error', function (ev) {
      const msg = ev && ev.error && String(ev.error.message || ev.error);
      if (msg && /webgl/i.test(msg)) { degrade(); return; }   // async WebGL failure
      if ((ev && ev.sourceId === 'sat') || (msg && /429|rate|tile|failed to fetch|network/i.test(msg))) {
        if (++tileErrs >= 4) degrade();
      }
    });
    map.on('data', function (ev) { if (ev && ev.tile && ev.sourceId === 'sat') tilesOK++; });
    setTimeout(function () { if (!ready && !degraded) degrade(); }, 9000);   // stalled load
    map.on('load', function () {
      ready = true;
      setTimeout(function () { if (!degraded && tilesOK === 0) degrade(); }, 8000);   // silent blank
      try {
        if (o.radiusMi) {
          map.addSource('r', { type: 'geojson', data: HS._circle(center.lat, center.lng, o.radiusMi) });
          map.addLayer({ id: 'rf', type: 'fill', source: 'r', paint: { 'fill-color': '#157a49', 'fill-opacity': 0.08 } });
          map.addLayer({ id: 'rl', type: 'line', source: 'r', paint: { 'line-color': '#157a49', 'line-width': 2, 'line-opacity': 0.6, 'line-dasharray': [2, 2] } });
        }
        if (o.home) {   // ONLY a real resident home — never a centroid stand-in; on top of items
          const w = document.createElement('div');
          w.innerHTML = HS.homeMarkerHTML(22);
          const h = w.firstChild; h.style.zIndex = '5';
          h.title = 'Your home · ' + (HS.homeAddressLine ? HS.homeAddressLine(o.home) : o.home.address || '');
          new maplibregl.Marker({ element: h }).setLngLat([o.home.lng, o.home.lat]).addTo(map);
        }
        items.forEach(function (it) {
          const m = HS.resolveMarker(it);
          const d = document.createElement('div');
          d.style.cssText = 'width:20px;height:20px;line-height:0' + (o.itemClick ? ';cursor:pointer' : '');
          if (o.itemClick) {
            d.setAttribute('data-hs-map-item', '');
            d.setAttribute('tabindex', '0');
            d.setAttribute('role', 'button');
            d.setAttribute('aria-label', m.popupLabel);
          }
          d.innerHTML = HS.markerSVG(m.shape, m.color, '', 20);
          if (o.itemClick) {
            const go = function (e) { e.stopPropagation(); o.itemClick(it); };
            d.addEventListener('click', go);
            d.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } });
          }
          new maplibregl.Marker({ element: d }).setLngLat([it.lng, it.lat]).addTo(map);
        });
        if (o.itemClick) {
          map.on('dragstart', function () { el._hsDragged = true; });
          map.on('dragend', function () { setTimeout(function () { el._hsDragged = false; }, 0); });
        }
        if (o.onReady) o.onReady(map);
      } catch (e) { degrade(); }
    });
  };
})();
