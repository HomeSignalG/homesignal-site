// project-type.js — THE CANONICAL DEVELOPMENT TYPE. One classifier, no map runtime.
//
// WHAT THIS FILE IS. The single implementation of "what kind of development is this record":
// the closed CATEGORY_REGISTRY, the precedence rules (terminal-neutral → stated data centre →
// exact class → layer → keyword → name → honest fallback) and the pure helpers they need.
// It was EXTRACTED VERBATIM from lib/map.js on 2026-09-24 — moved, not copied: lib/map.js no
// longer contains any of it and reads it from here (HS.projectType), refusing to load without it.
//
// WHY IT MOVED. The Type was trapped inside the Map 1 rendering module, so any surface that
// shows a Type but draws no map (the ZIP page's Development & Growth cards) could only get
// Map 1's answer by loading the whole map runtime — which the ZIP hosts deliberately do not
// (test/zcta-boundary-reader.test.mjs §5a). A surface without the runtime would otherwise have
// had to write a second classifier. Now every consumer reaches the SAME function:
//
//     HS.classifyProjectType (here)
//        ├── HS.resolveMarker (lib/map.js) ── Map 1 marker, filter bucket ── MAPS
//        │                                    (lib/maps-social-theme.js → evidence.visual.type_key)
//        └── HS.canonicalProjectType (here) ── Development & Growth badge (lib/community-page.js)
//
// WHAT MUST NEVER ENTER THIS FILE: DOM, Leaflet/MapLibre, marker drawing or placement, colour,
// lifecycle, geography, ZIP membership, residential qualification, network calls, or any
// surface's presentation. `symbol` in the registry is a NAME the renderer looks up, not code.
// Pinned by test/project-type-authority.test.mjs.
//
// LOAD ORDER: before lib/map.js on every page, test and script that loads lib/map.js.
(function () {
  var HS = (typeof window !== 'undefined')
    ? (window.HS = window.HS || {})
    : (globalThis.HS = globalThis.HS || {});

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
  function normType(s) { return String(s || '').trim().toLowerCase(); }
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

  // The Type keys — every registry category except the regulatory record kind. Map 1's PROJECT
  // TYPE row and the facility overlay rule both read THIS list (lib/map.js binds it).
  const TYPE_FILTER_KEYS = Object.keys(CATEGORY_REGISTRY).filter(function (k) {
    return !CATEGORY_REGISTRY[k].isFacility;
  });
  // Overlay-on-Type (founder, 2026-09-07, reversing the keep-purple display
  // language on classifiable EPA). A regulated facility whose CLASS FIELDS map
  // a project Type keeps that Type's shape and the operating/lifecycle colour;
  // purple is the R overlay, not the pin. Toggle OFF drops the R and leaves
  // the Type pin (membership is [typeKey, 'facility']).
  //
  // CLASS FIELDS ONLY. Name/title/label are stripped so NAME_RULES cannot
  // invent a Type from "DE-ANDA TRUCKING" or re-type a power pod from its
  // label. Logistics is already LAYER_EXACT → industrial — that is how
  // DE-ANDA TRUCKING (`type: 'logistics'`) lands on Industrial rather than
  // Commercial. Unmapped / FALLBACK:other / TERMINAL_NEUTRAL stay the
  // standalone purple square.
  function classifyFacilityOverlayType(item) {
    const classOnly = {
      type: item && item.type,
      use_type: item && item.use_type,
      layer: item && item.layer,
      category: item && item.category
    };
    const info = classifyProjectType(classOnly);
    if (!info) return null;
    const rule = String(info.shapeRule || '');
    if (rule.indexOf('FALLBACK:') === 0 || rule.indexOf('TERMINAL_NEUTRAL:') === 0
        || rule.indexOf('NAME:') === 0) {
      return null;
    }
    if (!info.typeKey || info.typeKey === 'other' || info.typeKey === 'facility') return null;
    const cat = CATEGORY_REGISTRY[info.typeKey];
    if (!cat || cat.isFacility) return null;
    if (TYPE_FILTER_KEYS.indexOf(info.typeKey) === -1) return null;
    return info;
  }
  HS.classifyFacilityOverlayType = classifyFacilityOverlayType;

  // ── THE FACILITY IDENTITY — one decision, read by Map 1 AND the ZIP page ──────────────────
  // Moved out of lib/map.js resolveMarker (2026-09-24) in the order that branch applied it:
  //   1. DUAL — the record's own CLASS field states a data centre → 'datacenter'
  //   2. OVERLAY — the class field maps a project Type (founder Overlay-on-Type, 2026-09-07)
  //   3. PLAIN — nothing classifiable → 'facility' (the regulatory record kind, NOT a Type)
  // Class fields only: statedDataCenter(…, true) and classifyFacilityOverlayType both ignore
  // name/title/label, so no facility is ever typed from its name.
  function facilityIdentity(item) {
    const dc = statedDataCenter(item, true);
    if (dc) return { kind: 'dual', typeKey: 'datacenter', info: dc };
    const overlay = classifyFacilityOverlayType(item);
    if (overlay) return { kind: 'overlay', typeKey: overlay.typeKey, info: overlay };
    return { kind: 'plain', typeKey: 'facility', info: null };
  }

  // ── THE CANONICAL TYPE of a regulated-facility app_projects row (record_kind='facility') ──
  // For a surface that lists regulated facilities without drawing them. Map 1 draws the same
  // EPA FRS records from development_reports.sites, where the source class is `layer`; the
  // app_projects facility row carries the identical value in `type` (measured 2026-09-24:
  // 73/73 Map 1 facility points in 19475/78617/75009/85003 matched on registry_id, 0 differing).
  // So the row is projected onto Map 1's field and asked the SAME facilityIdentity.
  // Returns { typeKey, label, kind } with the REGISTRY label — 'facility' reads
  // "Regulated facility" — or null for no row.
  function canonicalFacilityType(facility) {
    if (!facility) return null;
    const fid = facilityIdentity({ layer: facility.type || '', _facility: true, record_kind: 'facility' });
    const c = CATEGORY_REGISTRY[fid.typeKey];
    return c ? { typeKey: c.key, label: c.label, kind: fid.kind } : null;
  }
  HS.canonicalFacilityType = canonicalFacilityType;

  // ── THE CANONICAL DEVELOPMENT TYPE of an app_projects row ────────────────────────────────
  // For a surface that shows a record's Type WITHOUT drawing it (Development & Growth). The
  // input projection is the one every Map 1 development surface builds from an app_projects
  // row: lib/zip-authoritative.js zipAuthSiteFromMarker and lib/n5-radius.js set
  // `use_type: p.type` and `label: p.name`, and lib/map.js trackerSiteItem turns that into
  // {type, use_type, name, title, label}. `type_raw` is deliberately NOT read — Map 1 carries
  // it as `permit_class` precisely so the classifier never sees it. Parity with that chain is
  // asserted over the whole corpus by test/project-type-authority.test.mjs.
  //
  // Returns { typeKey, label } — label is CATEGORY_REGISTRY's own, never the source string —
  // or null when there is no DEVELOPMENT Type to give (no row; the facility identity, which
  // is a record kind, not a Type; a rule key outside the registry). Never guessed.
  //
  // It answers TYPE ONLY. Whether Map 1 DRAWS the record (ZIP membership, geography, the
  // residential qualification gate) is a separate question owned elsewhere and not asked here.
  function canonicalProjectType(project) {
    if (!project) return null;
    const t = project.type || '';
    const n = project.name || '';
    const info = classifyProjectType({ type: t, use_type: t, name: n, title: n, label: n });
    const c = info && CATEGORY_REGISTRY[info.typeKey];
    if (!c || c.isFacility) return null;
    return { typeKey: c.key, label: c.label };
  }
  HS.canonicalProjectType = canonicalProjectType;

  // The one handle lib/map.js reads. Only what a consumer outside this file actually uses.
  HS.projectType = {
    CATEGORY_REGISTRY: CATEGORY_REGISTRY,
    classifyProjectType: classifyProjectType,
    statedDataCenter: statedDataCenter,
    canonicalProjectType: canonicalProjectType,
    TYPE_FILTER_KEYS: TYPE_FILTER_KEYS,
    classifyFacilityOverlayType: classifyFacilityOverlayType,
    facilityIdentity: facilityIdentity,
    canonicalFacilityType: canonicalFacilityType
  };
})();
