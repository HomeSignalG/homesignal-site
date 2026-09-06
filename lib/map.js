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

  // ── 3D CAPABILITY + HONEST FAILURE COPY ───────────────────────────────────────────
  // The development tracker (homesignalmap.html) offers two WebGL views — 3D aerial
  // (three.js) and 3D satellite (MapLibre GL). Both draw into a canvas layered over a
  // dark panel, so ANY initialisation failure used to present as a silent black
  // rectangle: the panel's own background, no message, and (for MapLibre) not even a
  // console error, because the caller swallowed the exception.
  //
  // Two failure classes were reproduced against the real page, and they are the reason
  // these two helpers exist:
  //   * NO WEBGL — Brave's "Block fingerprinting: Strict" (and equivalents elsewhere)
  //     makes getContext('webgl') return null. three.js logs and returns a dead
  //     renderer; MapLibre throws "Failed to initialize WebGL". BOTH 3D views go black
  //     while the 2D Leaflet map, which needs no WebGL, keeps working — exactly the
  //     shape a resident reports as "the 3D buttons show a black box".
  //   * INIT THREW — e.g. MapLibre's constructor raising
  //     "Invalid LngLat object: (NaN, NaN)" when the report carries no home point.
  //
  // Both are surfaced, never swallowed. A black panel is not an error state.

  // Can this browser actually give us a WebGL drawing context? Answers the question the
  // 3D views ask, and NEVER throws — a probe that can throw is a second failure mode.
  // The probe canvas is discarded; it is not attached to the document. A browser that
  // exposes the constructor but refuses the context (the fingerprint-blocking case)
  // returns false here, which is the whole point: presence of the API is not capability.
  HS.webglSupported = function (doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || !d.createElement) return false;
    try {
      const c = d.createElement('canvas');
      if (!c || !c.getContext) return false;
      return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) { return false; }
  };

  // Plain-language copy for a 3D view that could not start. `kind` is the resident-facing
  // view name ("3D aerial" / "3D satellite"); `reason` is one of 'nowebgl' | 'load' |
  // 'init'. Every message says what happened, what still works, and — where the resident
  // can act — what to change. It never blames them and never invents a cause.
  HS.map3dFailCopy = function (kind, reason) {
    const k = kind || '3D view';
    if (reason === 'nowebgl') {
      return k + ' needs WebGL, which this browser has switched off. ' +
        'In Brave, set Shields for this site to "Block fingerprinting: Standard"; ' +
        'in other browsers, re-enable hardware acceleration. The 2D map works either way.';
    }
    if (reason === 'load') {
      return k + " couldn't load — the map library was blocked or the connection dropped. " +
        'Showing the 2D map instead; try again in a moment.';
    }
    return k + " couldn't start on this page. Showing the 2D map instead — " +
      'it has the same records.';
  };

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
  //   • `other` moved circle → CAPSULE. Symbol uniqueness was asserted on the symbol
  //     NAME, so 'octagon' !== 'circle' passed while the two RENDERED silhouettes were
  //     95% identical at the 14px legend size — Data center and Other project were the
  //     same dot on the map. The contract is now geometric, not nominal (§13 of
  //     test/maps-category-contract.test.mjs). Data center KEEPS its octagon and
  //     Commercial KEEPS its hexagon; only the residual bucket moved.
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
    other:          { key: 'other',          label: 'Other project',          symbol: 'capsule',  legend: true },
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
    // Production carries the source-stated type as the ONE WORD `datacenter` (738 rows,
    // 509 ZIPs, measured 2026-09-05) and no row anywhere carries the spaced form. Until
    // now the one-word spelling resolved only by accident, through LAYER_EXACT — a table
    // meant for the `layer`/`category` fields — so the TYPE phase reported no hit for the
    // only spelling the corpus actually uses. Both spellings are the same statement.
    'datacenter':               cat('datacenter'),
    'data-center':              cat('datacenter'),
    'data centre':              cat('datacenter'),
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
    // TERMINAL honest fallback, written by the engine's Commercial work-evidence gate
    // (supabase/functions/get-address-report/sources/commercial-eligibility.ts) when a record's
    // only Commercial evidence was the property's occupancy/zoning/land use and the source
    // states no qualifying work. Deliberately ABSENT from GENERIC_EXACT below, which is the
    // whole point: 'development' and 'unclassified' are NON-TERMINAL, so a downgraded record
    // would fall through to the name phase and NAME_RULES would match /commercial|retail|
    // office|hotel/ against its own label — and these labels routinely carry those words
    // ("ELECTRIC COMMERCIAL 1200 SE ...", "Commercial Amusement (Inside)", any address on a
    // street named Commercial). Terminal here means the downgrade actually holds.
    // ADDITIVE: no record in production carries this string today, so no existing record of
    // any Type changes classification (asserted in test/commercial-work-evidence.test.mjs).
    'other project':            cat('other'),
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
  // ── DATA CENTER — a STATED class that outranks every broader one (2026-09-05) ──
  // The `datacenter` legend row existed, carried a symbol, and essentially never drew.
  // Measured on production `app_projects` (control 3,216,489 rows): 1,190 records state a
  // data centre in their own words, and only 153 of them resolved to the Data center
  // octagon. The other 1,037 drew something else, for two separate reasons:
  //
  //   738  record_kind='facility', type='datacenter'  → purple SQUARE (facility flag wins)
  //   100  type='Utility'      → diamond    84  type='Industrial'   → triangle
  //    61  type='Commercial'   → hexagon    15  type='Civic/Public' → cross
  //    39  generic type, stated only in `type_raw` or in a TRUNCATED name → circle
  //
  // The 299 project rows are the defect this rule fixes. Their source type is a COARSE
  // BUCKET, not a contradiction: Phoenix files a data-centre fire pump under the Fire
  // department code range (→ Civic/Public), Memphis files data-centre fit-out under
  // `COM`, and San Jose's own `type_raw` literally reads `Data Center` while our registry
  // `type_map` collapsed it to Industrial. Every category being displaced — Utility,
  // Industrial, Commercial, Civic, Other — is STRICTLY BROADER than "data center", so
  // there is no record for which the broader answer is the better one. This restores the
  // record's own statement; it never invents one.
  //
  // The 738 FACILITY rows are deliberately NOT touched here — `resolveMarker` checks the
  // facility flag before this runs, and the purple square plus the `facility` filter
  // bucket are a founder-set contract (CATEGORY_REGISTRY). Whether a regulated facility
  // that IS a data centre should draw the octagon is a separate, resident-visible call.
  //
  // `cente` (no trailing r/e) is in the pattern because connectors TRUNCATE long names:
  // 37 production rows end "... EXISTING 2-STORY DATA CENTE". Requiring the whole word
  // would silently drop exactly the records with the most descriptive names.
  // `data hall` is the industry's own term for a data centre's equipment floor, and it is the
  // ONE alternative wording that survived measurement. Swept across all 1,045 ZIPs where Compute
  // Atlas independently places a data centre: `data hall` appears in 6 records and all 6 are
  // genuine data centres — two Mesa AZ ground-up buildings (243,332 SF and 285,282 SF), three
  // battery-system permits in the Phoenix PHX05 data halls, and an Amazon data hall. Its
  // neighbours in the same sweep were REJECTED on the same evidence: `colo` matched a Verizon
  // Wireless cell site and a bell-tower antenna, and `server room` matched a server room inside
  // an office fit-out. Precision, not vocabulary breadth, is what makes this type trustworthy.
  const DATACENTER_RE = /data\s*cent(?:er|re|e)|data\s*hall|hyperscale|server\s*farm/i;
  // Street-name guard, same shape as the NAME_RULES `\bschool\b` guard that a national
  // audit made necessary. Measured 0 collisions in production today (control: 1,188 rows
  // match DATACENTER_RE on the name, so the zero is a real absence, not a dead query) —
  // written because "Data Center Drive" is an address the moment one source carries it.
  const DATACENTER_NOT_RE = /data\s*cent(?:er|re)\s+(?:rd|road|st|street|ave|avenue|ln|lane|dr|drive|blvd|boulevard|way|pkwy|parkway|ct|court|cir|circle)\b/i;
  // INCIDENTAL-REFERENCE GUARD (2026-09-05). The rule above fires on any data-centre string in
  // the NAME, and permit names are long free text — so "132 kV substation to serve the Vantage
  // data center" or "transmission line feeding the Ashburn data center campus" would classify
  // the POWER project as a data centre. That is the single worst failure this type can have:
  // the resident is told a data centre is coming when what is coming is a switchyard.
  //
  // Measured across all 96 distinct records behind the live 452: ZERO trip this guard today,
  // and the probe's own control is non-zero (4 of 96 trip at least one attack pattern), so the
  // zero is a real absence rather than a dead query. It ships anyway, for the same reason the
  // street-name guard did: these records certainly exist nationally, they are simply not yet in
  // a county HomeSignal has wired, and the corpus grows on every ingest.
  //
  // BOTH halves are required — a "serving …" construction AND a competing infrastructure head
  // noun. One alone is not enough, and that is deliberate: `AT&T - OAKTON DATA CENTER GENERATOR
  // POWER` is backup power AT a data centre (no serving construction) and must keep classifying,
  // while `NEW Install data centers … 20 transformers` names transformers but is a data-centre
  // build. Requiring both is what separates "power project for a data centre" from
  // "data-centre project that involves power".
  const DATACENTER_SERVING_RE = /\b(?:serving|serves|to\s+serve|in\s+support\s+of|supporting|feeding|adjacent\s+to|next\s+to|abutting|associated\s+with)\b[^.;]{0,60}?data\s*cent/i;
  const DATACENTER_COMPETING_RE = /\bsubstation\b|\bswitchyard\b|switching\s+station\b|\btransmission\b|\b\d{2,3}\s*kv\b|\bpower\s*line\b|\btransmission\s+line\b|\bsolar\s+(?:farm|array|field)\b|photovoltaic|\bbattery\s+(?:energy\s+)?storage\b|\bbess\b|\bwind\s+(?:farm|turbine)\b|\bpower\s+plant\b|\bgenerating\s+station\b|\bcell\s+tower\b|\bmonopole\b|\bantenna\b/i;
  // The record's own class fields. `type_raw` is the SOURCE's verbatim words and is read
  // ONLY here — the general phases keep reading the mapped `type`, so this rule cannot
  // reshape anything outside the data-centre vocabulary. A class field is the source's OWN
  // type, so the incidental guard deliberately does not apply to it — there is no room for a
  // passing reference inside a one-word type code.
  const DATACENTER_CLASS_FIELDS = ['type', 'type_raw', 'use_type', 'layer', 'category'];
  // `classOnly` — used by the FACILITY path. For an EPA-FRS record the stamped class
  // field IS the authoritative classification (the engine derives it from the whole
  // registered facility name), so a passing mention inside the free-text name adds no
  // evidence and costs consistency. Measured: `CYRUSONE POWER POD 5` and `POWER POD 7`
  // are stamped `energy` and state no data centre, while `CYRUS ONE DATA HALL 1 POWER
  // POD 1` is the SAME kind of facility and merely names the hall it powers. Reading
  // the name would call one of three identical power pods a data centre purely because
  // of what its label mentions. The class field refuses all three, correctly.
  function statedDataCenter(item, classOnly) {
    if (!item) return null;
    for (let i = 0; i < DATACENTER_CLASS_FIELDS.length; i++) {
      const v = item[DATACENTER_CLASS_FIELDS[i]];
      if (v && DATACENTER_RE.test(String(v))) {
        return Object.assign(cat('datacenter'), {
          typeLabel: CATEGORY_REGISTRY.datacenter.label,
          shapeRule: 'DATACENTER:' + DATACENTER_CLASS_FIELDS[i]
        });
      }
    }
    if (classOnly) return null;   // facility path: the stamped class field is the whole evidence
    const nm = String((item.name || item.title || item.label) || '');
    const incidental = DATACENTER_SERVING_RE.test(nm) && DATACENTER_COMPETING_RE.test(nm);
    if (nm && DATACENTER_RE.test(nm) && !DATACENTER_NOT_RE.test(nm) && !incidental) {
      return Object.assign(cat('datacenter'), {
        typeLabel: CATEGORY_REGISTRY.datacenter.label,
        shapeRule: 'DATACENTER:name'
      });
    }
    return null;
  }
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
    // Was `shape: 'circle', legendLabel: 'Other project'` while declaring typeKey 'civic' —
    // a leftover from before `civic` became first-class with its own CROSS. It rendered a
    // school as an Other-project dot, and once `other` moved to the capsule that circle
    // would have matched NO legend row at all. Now agrees with the registry, like every
    // other rule here. typeKey is unchanged, so membership, counts and filtering are too.
    { re: /\bschool\b|education/i, typeKey: 'civic', shape: 'cross', legendLabel: 'Civic & public' },
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
    // NO data-centre rule here, deliberately. The DATACENTER phase above runs first, tests a
    // STRICTLY BROADER pattern against the same name, and carries the street-name and
    // incidental-reference guards — so this rule could only ever fire on a record the phase
    // had already VETOED, silently undoing the veto one phase later. That is not theoretical:
    // it is exactly what happened to "transmission line feeding the Ashburn data center
    // campus" and "1100 DATACENTER RD SFR ADDITION" while this rule was still here. A guard
    // that a later duplicate can overturn is not a guard.
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


  // ── Per-CATEGORY (type) visibility — a SECOND, independent filter dimension ──
  // The status dimension above answers "which lifecycle stages do I want to see".
  // This one answers "which KINDS of thing do I want to see" — the founder's
  // "turn off every Map 1 type except EPA / Regulated facility".
  //
  // THE INVARIANT THIS EXISTS TO HOLD: filter membership decides whether a record
  // QUALIFIES to be visible; it never decides what the record IS. A record is shown
  // when ANY of its memberships is on, and it is shown ONCE — membership is an
  // any-of test over one marker, never a join that could emit a second marker.
  // Its primary symbol comes from resolveMarker's single categoryKey and does not
  // change with which filter admitted it.
  const CATEGORY_FILTER_KEYS = Object.keys(CATEGORY_REGISTRY);
  const CATEGORY_FILTER_SS_KEY = 'hs.map.categoryFilters';
  function defaultCategoryFilters() {
    const f = {};
    CATEGORY_FILTER_KEYS.forEach(function (k) { f[k] = true; });
    return f;
  }
  function loadCategoryFilters() {
    const f = defaultCategoryFilters();
    try {
      const raw = window.sessionStorage.getItem(CATEGORY_FILTER_SS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        CATEGORY_FILTER_KEYS.forEach(function (k) { if (typeof saved[k] === 'boolean') f[k] = saved[k]; });
      }
    } catch (e) { /* storage blocked or bad JSON -> all-on default */ }
    return f;
  }
  let categoryFilters = loadCategoryFilters();
  function persistCategoryFilters() {
    try { window.sessionStorage.setItem(CATEGORY_FILTER_SS_KEY, JSON.stringify(categoryFilters)); } catch (e) {}
  }
  // The membership SET for a record. Falls back to the single categoryKey so a
  // caller holding a marker object from any older path still gets a valid answer.
  function markerCategories(item) {
    const m = (item && item.categoryKey) ? item : HS.resolveMarker(item);
    const list = (m.categories && m.categories.length) ? m.categories : [m.categoryKey];
    return list.filter(function (k) { return !!CATEGORY_REGISTRY[k]; });
  }
  HS.categoryFilterKeys = CATEGORY_FILTER_KEYS.slice();
  HS.getCategoryFilters = function () { return categoryFilters; };
  HS.setCategoryFilter = function (key, on) {
    if (CATEGORY_FILTER_KEYS.indexOf(key) === -1) return categoryFilters;
    categoryFilters[key] = !!on;
    persistCategoryFilters();
    return categoryFilters;
  };
  HS.markerCategories = markerCategories;
  HS.categoryVisible = function (item) {
    const cats = markerCategories(item);
    for (let i = 0; i < cats.length; i++) if (categoryFilters[cats[i]]) return true;
    return false;
  };
  HS.allCategoriesOff = function () {
    return CATEGORY_FILTER_KEYS.every(function (k) { return !categoryFilters[k]; });
  };
  HS.filterByCategory = function (items) { return (items || []).filter(HS.categoryVisible); };

  // ── DATA CENTER SIGNIFICANCE (2026-09-06) ────────────────────────────────────
  // TYPE answers "what is this related to". SIGNIFICANCE answers "what KIND of
  // activity is this". They are different dimensions and this never changes the
  // first: a data centre stays `datacenter` and keeps its octagon whatever its
  // significance.
  //
  // WHAT THE EVIDENCE ACTUALLY IS. Measured over the whole shipped corpus (107
  // distinct records / 479 rows): `app_projects.size`, `.investment`, `.jobs`,
  // `.scope_text` and `.developer` are populated on **0 of 479 rows**. There is no
  // structured scale anywhere. Only two things exist:
  //   1. `type_raw` — the ISSUING AUTHORITY'S OWN permit class ("SIGN  PERMIT",
  //      "FP STATIONARY LEAD-ACID BATTERY SYSTEM", "NEW CONSTRUCTION"). This is the
  //      strongest signal available, because the jurisdiction assigned it.
  //   2. the record's own description text in `name`.
  // Explicit square footage appears in the name of **6 rows of 479**, so scale is
  // read where the source states it and NEVER inferred where it does not.
  //
  // ⚠️ ABSENCE IS NOT EVIDENCE. A record with no scale wording is `not stated`, never
  // "minor" — asserted in test/marker-datacenter-significance.test.mjs.
  //
  // ⚖️ REVISED 2026-09-06 after an adversarial competitor-CTO audit of 96eade0. The audit
  // found no false classification, and two resident-facing weaknesses:
  //   1. `Ancillary work` asserted MAGNITUDE ("minor") that no evidence establishes. A
  //      stationary-battery or fire-pump installation can be substantial. That label is
  //      GONE from the resident-facing surface; where the issuing authority names the
  //      activity, the resident now reads the activity.
  //   2. 16 records / 79 rows sat in the unknown bucket while their own authoritative
  //      wording deterministically established work on an EXISTING data centre. That is
  //      information HomeSignal held and discarded.
  // `Significance not stated` also became `Scope not stated by source`: the old wording
  // read as HomeSignal's finding rather than the source's silence.
  const SIGNIFICANCE = {
    major:      { key: 'major',      label: 'Major development' },
    existing:   { key: 'existing',   label: 'Work on existing data center' },
    supporting: { key: 'supporting', label: 'Supporting work' },
    unknown:    { key: 'unknown',    label: 'Scope not stated by source' }
  };
  HS.SIGNIFICANCE = SIGNIFICANCE;
  // A resident-facing name for the SUPPORTING activity, taken from the issuing authority's
  // own permit class. This is normalization of a government string, never interpretation:
  // each entry maps one enumerated class to the plain-English name of the same thing, and
  // says NOTHING about how big it is. ⚠️ "Supporting" describes the activity's RELATION to
  // the data centre — it never means small, minor or unimportant, and no label here may
  // imply that (asserted in test/marker-datacenter-significance.test.mjs).
  const SUPPORTING_ACTIVITY = [
    { re: /sign\s+permit/i,                             label: 'Sign permit' },
    { re: /fire\s+alarm/i,                              label: 'Fire-alarm permit' },
    { re: /fire\s+pump/i,                               label: 'Fire-pump permit' },
    { re: /lead[-\s]?acid\s+battery|battery\s+system/i, label: 'Battery-system permit' },
    { re: /vehicle\s+access\s+control/i,                label: 'Access-control permit' },
    { re: /fire\s+prevention\s+service\s+request/i,      label: 'Fire-prevention service request' }
  ];
  // The same, for the two records whose ACT is named in their own description rather than
  // in a permit class. Kept separate because a description is free text: only wordings
  // that name the act unambiguously appear here.
  const SUPPORTING_NAME_ACTIVITY = [
    { re: /roof\s+replacement/i, label: 'Roof replacement' },
    { re: /cooling\s+tower/i,    label: 'Cooling-tower work' },
    { re: /\bsign\s+permit\b/i,  label: 'Sign permit' }
  ];
  function supportingActivity(cls, nm) {
    for (let i = 0; i < SUPPORTING_ACTIVITY.length; i++) {
      if (SUPPORTING_ACTIVITY[i].re.test(cls)) {
        return { key: 'supporting', label: SUPPORTING_ACTIVITY[i].label };
      }
    }
    for (let j = 0; j < SUPPORTING_NAME_ACTIVITY.length; j++) {
      if (SUPPORTING_NAME_ACTIVITY[j].re.test(nm)) {
        return { key: 'supporting', label: SUPPORTING_NAME_ACTIVITY[j].label };
      }
    }
    return null;
  }
  // WORK ON AN EXISTING DATA CENTRE — the record's own class or words establish that the
  // subject is an existing building being altered, not a data centre being built. This is
  // the class the audit proved HomeSignal was discarding. It says nothing about magnitude:
  // a renovation may be large or small, and the label claims neither.
  const SIG_EXISTING_RE = /alterat|renovat|\binterior\b|tenant\s+improve|\bupfit\b|fit[-\s]?out|\bT\.?\s?I\.?\b/i;
  // MAJOR — the source states construction of a data centre building.
  const SIG_MAJOR_CLASS_RE = /new\s+construction|commercial\s*-\s*new|\bshell\b/i;
  const SIG_MAJOR_NAME_RE = /new\s+ground[\s-]?up|\bconstruct\s+(?:a\s+)?data\s*cent|to\s+construct[^.]{0,80}data\s*(?:cent|hall)|\bshell\s+data\s*(?:hall|cent)/i;
  // THE VETO, and it is load-bearing. "ADDITIONS/ALTERATIONS/REPAIRS Construct data
  // center and pump house renovations" reads as new construction in its free text while
  // the jurisdiction filed it as an alteration. THE SOURCE'S OWN CLASS OUTRANKS ITS FREE
  // TEXT — 2 production records turn on this exact conflict.
  //
  // `\bT\.?\s?I\.?\b` closes the audit's preventive finding: a permit class such as
  // `SHELL TI` or `TI - SHELL` describes TENANT IMPROVEMENT inside an existing shell, and
  // `shell` alone would otherwise have read it as major new construction. No such record
  // exists in today's 107-record corpus — this is hardening against the national corpus.
  const SIG_MAJOR_VETO_RE = /alterat|renovat|repair|addition|tenant|\bT\.?\s?I\.?\b/i;
  // `permit_class` is a SIGNIFICANCE-ONLY carrier for the source's own permit class.
  // It exists because HS.trackerSiteItem does not map `type_raw`, and adding type_raw
  // there would feed the FROZEN data-centre classifier a fifth evidence field and turn
  // 2 more production records into data centres on Map 1. Significance needs the permit
  // class; classification must not change. So the value travels under its own name and
  // is read HERE ONLY — asserted in test/marker-datacenter-significance.test.mjs.
  function dataCenterSignificance(item) {
    const nm = String((item && (item.name || item.title || item.label)) || '');
    const cls = String((item && (item.type_raw || item.permit_class)) || '');
    // EXPLICIT PRECEDENCE, most specific first. Ordering is a decision here, not an
    // accident of regex order:
    //   1. SUPPORTING ACTIVITY — the authority named the exact activity. Most specific,
    //      so it wins even when the record also says "TI" (`IRON MOUNTAIN SC-31 DATA HALL
    //      TI` is a fire-alarm permit, and "Fire-alarm permit" tells a resident more than
    //      "Work on existing data center").
    //   2. EXISTING-BUILDING WORK — alteration/renovation/interior/TI/upfit/fit-out. Runs
    //      BEFORE major so `SHELL TI` can never reach the major test, and so the two
    //      ADDITIONS/ALTERATIONS records land here instead of falling through to unknown.
    //   3. MAJOR NEW CONSTRUCTION, still subject to its own class veto.
    //   4. Source silence.
    // Verified against all 5 production major records: none matches (1) or (2), so this
    // ordering cannot steal a major verdict.
    const support = supportingActivity(cls, nm);
    if (support) return support;
    if (SIG_EXISTING_RE.test(cls) || SIG_EXISTING_RE.test(nm)) return SIGNIFICANCE.existing;
    const majorVetoed = SIG_MAJOR_VETO_RE.test(cls);
    if (!majorVetoed && (SIG_MAJOR_CLASS_RE.test(cls) || SIG_MAJOR_NAME_RE.test(nm))) return SIGNIFICANCE.major;
    return SIGNIFICANCE.unknown;
  }
  HS.dataCenterSignificance = dataCenterSignificance;

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
  // ── TERMINAL-NEUTRAL — an EXPLICIT "type unresolved", checked before every inference ──
  // The engine already writes one such value: commercial-eligibility.ts downgrades a record to
  // NON_QUALIFYING_COMMERCIAL_USE_TYPE ("other project") when the property's occupancy was its
  // only Commercial evidence. TYPE_EXACT resolves it and GENERIC_EXACT deliberately omits it, so
  // it survives the keyword and name phases. It did NOT survive statedDataCenter(), which runs
  // BEFORE the TYPE_EXACT loop and reads the record NAME — so a downgraded record whose label
  // merely mentions a data centre was re-typed anyway. Measured on production: 2 rows.
  //
  // This is a classifier-CONTROL state, not a category: it says the SOURCE could not resolve the
  // type, so no inference may guess one from the property's name. It is deliberately generic —
  // the classifier learns the concept, never any source's business rules (a Phoenix/SLO rule here
  // would be exactly the coupling this repo forbids). `development`/`unclassified` keep their
  // existing NON-TERMINAL meaning and still reach NAME_RULES unchanged.
  const TERMINAL_NEUTRAL = new Set(['other project']);
  function terminalNeutral(item) {
    if (!item) return null;
    const fields = [item.type, item.use_type, item.layer, item.category];
    for (let i = 0; i < fields.length; i++) {
      if (TERMINAL_NEUTRAL.has(normType(fields[i]))) {
        return Object.assign(cat('other'), {
          typeLabel: CATEGORY_REGISTRY.other.label,
          shapeRule: 'TERMINAL_NEUTRAL:' + ['type', 'use_type', 'layer', 'category'][i],
          fallbackReason: 'the source explicitly resolved no project type for this record, so no '
                        + 'type was inferred from its name'
        });
      }
    }
    return null;
  }
  function classifyProjectType(item) {
    const display = (item && (item.type || item.use_type || item.layer || item.category)) || '';
    // PRECEDENCE 1.5 — an EXPLICIT terminal-neutral outranks every inference below,
    // including statedDataCenter(), whose name branch would otherwise re-type a record
    // the source already declared unresolved. Terminal means terminal.
    const tn = terminalNeutral(item);
    if (tn) return tn;
    // PRECEDENCE 2 — a stated data centre beats every broader class (see DATACENTER_RE).
    // It runs after the facility flag (checked in resolveMarker) and before everything
    // else, because "data center" is the most specific member of the closed use_type
    // vocabulary and every category it can displace is strictly broader.
    const dc = statedDataCenter(item);
    if (dc) return dc;
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
    // Dual identity, in the founder's order: what it IS first, the regulatory
    // signal second. Never "Regulated facility" alone — that would erase the
    // primary identity in the one line a resident actually reads.
    if (m.dualDataCenter) return name + ', ' + CATEGORY_REGISTRY.datacenter.label
      + ' · ' + CATEGORY_REGISTRY.facility.label + dist;
    if (m.isFacility) return name + ', Regulated facility' + dist;
    const typePart = m.typeLabel || (item && item.type) || '';
    const statusPart = (item && item.status) ? ', ' + item.status : '';
    // Significance sits between TYPE and STATUS: what it is, what kind of activity,
    // then where it is in the process.
    const sigPart = (m.significanceApplies && m.significance) ? ', ' + m.significance.label : '';
    return name + (typePart ? ', ' + typePart : '') + sigPart + statusPart + dist;
  }
  HS.resolveMarker = function (item, opts) {
    opts = opts || {};
    if (isFacilityItem(item)) {
      // ── DUAL IDENTITY (2026-09-06) ────────────────────────────────────────
      // A regulated facility whose OWN EPA-FRS record names a data centre is two
      // true things at once, and the founder-set product contract is that the
      // stronger of the two — what the thing IS — owns the primary symbol, while
      // the regulatory fact rides as a subordinate signal beneath it.
      //
      // The evidence bar is identical to the project classifier's: statedDataCenter
      // reads the record's own class fields and name, carries the street-name veto
      // and the incidental-reference guard, and asserts nothing a source did not
      // say. NO project join is performed and none is needed — the authoritative
      // regulatory record establishes the identity by itself (see the population
      // measurement in docs/maps-datacenter-dual-identity-2026-09-06.md).
      const dcFac = statedDataCenter(item, true);
      if (dcFac) {
        // The primary symbol takes the LIFECYCLE colour (a regulated facility is by
        // definition operating), never the facility purple — purple is what the
        // subordinate EPA square says, and letting it own the whole pin would make
        // the record read as "Regulated facility" exactly when the contract says its
        // primary identity is Data center. colorMode is honoured so this pin is the
        // same green as every other "Operating now" pin on the surface drawing it.
        const dcColor = (opts.colorMode === 'lifecycle' && HS.LIFECYCLE_HEX.operating)
          ? HS.LIFECYCLE_HEX.operating : STATUS_TIERS.operating.hex;
        return {
          shape: CATEGORY_REGISTRY.datacenter.symbol,
          color: dcColor,
          categoryKey: 'datacenter',
          lifecycle: 'operating',
          lifecycleLabel: STATUS_TIERS.operating.label,
          fallbackReason: null,
          typeKey: 'datacenter',
          typeLabel: CATEGORY_REGISTRY.datacenter.label,
          statusKey: 'facility',
          statusLabel: CATEGORY_REGISTRY.facility.label,
          legendLabel: CATEGORY_REGISTRY.datacenter.label,
          shapeRule: 'DUAL:datacenter+facility',
          popupLabel: popupLabelFor(item, { isFacility: true, dualDataCenter: true }),
          filterKey: 'facility',
          // Filter MEMBERSHIP is a set; entity IDENTITY is the single categoryKey
          // above. Turning the EPA filter on is what makes this record QUALIFY to
          // be seen — it never rewrites what the record is.
          categories: ['datacenter', 'facility'],
          signals: ['facility'],
          // GATE 7: an operating EPA facility is not a development record. Its
          // significance is pinned to `unknown` and can never be major or ancillary —
          // facility identity says nothing about construction activity.
          significance: SIGNIFICANCE.unknown,
          significanceApplies: false,
          signal: { key: 'facility', shape: CATEGORY_REGISTRY.facility.symbol,
                    color: FACILITY_HEX, label: CATEGORY_REGISTRY.facility.label },
          isFacility: true,
          isDataCenter: true
        };
      }
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
        categories: ['facility'],
        signals: [],
        signal: null,
        significance: null,
        significanceApplies: false,
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
      popupLabel: popupLabelFor(item, { isFacility: false, typeLabel: typeInfo.typeLabel,
        significanceApplies: typeInfo.typeKey === 'datacenter',
        significance: typeInfo.typeKey === 'datacenter' ? dataCenterSignificance(item) : null }),
      filterKey: filterKey,
      // Every marker carries a membership SET so callers never have to special-case
      // the dual record. An ordinary project belongs to exactly one category.
      categories: [typeInfo.typeKey],
      signals: [],
      signal: null,
      // Data centres only. Every other category carries null, so this unit cannot
      // change what a resident reads on any other kind of record.
      significance: typeInfo.typeKey === 'datacenter' ? dataCenterSignificance(item) : null,
      significanceApplies: typeInfo.typeKey === 'datacenter',
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
      // Significance-only (see dataCenterSignificance). Deliberately NOT `type_raw`:
      // that name is read by the data-centre classifier and would widen it.
      permit_class: (s && (s.type_raw || s.permit_class)) || undefined,
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
      // Other project — CAPSULE (a wide rounded bar). The residual bucket needs a
      // silhouette no resident can confuse with a classified one. It was a CIRCLE, and at
      // the 14px legend size a circle is 95% identical to the Data center OCTAGON
      // (silhouette distance 1-IoU ~ 5%): the two rendered as the same dot, so "pin
      // shape shows project type" was untrue for the single largest bucket. Every other
      // symbol is isotropic (roughly as tall as it is wide), so a 2.1:1 bar is the one
      // unoccupied silhouette family — it reads as different at a glance instead of by
      // counting corners. Measured worst-case separation from the other seven symbols is
      // ~36% (vs diamond), against ~8% for the weakest existing pair. It is a <rect>
      // like the facility square on purpose: same primitive, no new drawing machinery.
      // Pinned by test/maps-category-contract.test.mjs §13.
      case 'capsule': {
        const hw = r * 1.30, hh = r * 0.62;
        return '<rect x="' + (cx - hw).toFixed(2) + '" y="' + (cy - hh).toFixed(2)
          + '" width="' + (hw * 2).toFixed(2) + '" height="' + (hh * 2).toFixed(2)
          + '" rx="' + hh.toFixed(2) + '" ' + common + '/>';
      }
      case 'circle':
      default:         return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" ' + common + '/>';
    }
  }
  HS.shapeEl = shapeEl;
  // A standalone map-pin SVG (shape = type, fill = status color, optional white letter).
  // Used by BOTH tile engines (MapLibre + Leaflet div markers). The triangle's letter
  // nudges down so it sits inside the narrower apex.
  // `signal` (optional) = {shape, color} drawn SUBORDINATE, directly beneath the primary
  // symbol: ~55% of its size, thinner stroke, slightly transparent. It is ONE marker
  // carrying two truths, not two markers — the primary symbol stays centred on (c,c),
  // which is the icon's anchor point, so the record keeps its exact coordinate and the
  // badge overflows the box downward (the svg is already `overflow:visible`). No offset
  // is applied to the primary and no second coordinate is invented.
  HS.markerSVG = function (shape, color, label, size, signal) {
    size = size || 26;
    const c = size / 2, r = size * 0.40;
    const dy = shape === 'triangle' ? size * 0.10 : 0;
    const txt = label ? '<text x="' + c + '" y="' + (c + dy) + '" text-anchor="middle" dominant-baseline="central" '
      + 'font-family="sans-serif" font-weight="700" font-size="' + (size * 0.44).toFixed(1) + '" fill="#fff">' + label + '</text>' : '';
    const sig = (signal && signal.shape && signal.color)
      ? '<g opacity="0.92">' + shapeEl(signal.shape, c, c + r * 1.30, r * 0.55, signal.color, 1.6) + '</g>'
      : '';
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg" '
      + 'style="overflow:visible;filter:drop-shadow(0 1px 3px rgba(0,0,0,.4))">'
      + sig + shapeEl(shape, c, c, r, color, 3) + txt + '</svg>';
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
