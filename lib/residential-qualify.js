// RESIDENTIAL DEVELOPMENT QUALIFICATION — the Map 1 Residential product rule, in one place.
//
// THE RULE (founder, 2026-09-05):
//
//   Map 1 Residential means MEANINGFUL NEW RESIDENTIAL DEVELOPMENT. It does not mean routine
//   work on an existing residential property. A record does not become residential development
//   because the PROPERTY is residential, because the source calls the BUILDING Residential,
//   because `type_raw` contains "Residential", because the work happens at an apartment
//   complex, or because an old registry `type_map` mapped it to Residential.
//   Classify the ACTIVITY, not the building or the use.
//
// WHY THIS IS A SEPARATE LAYER FROM lib/map.js
//
//   lib/map.js answers "what TYPE is this object" (shape). This answers "is this object a Map 1
//   residential-development object AT ALL" (eligibility). They are different questions and the
//   previous audit proved they must not be merged: a record correctly rejected here as
//   `HVAC Residential` would otherwise be re-admitted downstream by NAME_RULES, which matches a
//   bare /residential/. Eligibility therefore runs BEFORE type resolution can reinstate it, and
//   a rejected record is dropped from Map 1 entirely - it is NEVER relabelled `Development` or
//   `other`, because an HVAC permit is not made correct by changing its Type.
//
// WHY SUBSTRINGS AND NOT REGEXES
//
//   The national population is measured in SQL (450k+ objects cannot be streamed to a test
//   runner) while the product decision is made in JS. Two regex dialects - JS and POSIX - would
//   be two implementations of one rule, and they diverge silently on \b, lookahead and
//   character classes. Every rule here is therefore a PHRASE tested by substring containment
//   over one normalisation that both languages can reproduce exactly. `scripts/
//   residential-qualify-sql.mjs` GENERATES the SQL from this file's own exported vocabulary,
//   so the measurement and the product can never carry different words.
//
// THE EVIDENCE, AND WHY `name` COUNTS AS STRUCTURED SOURCE EVIDENCE
//
//   `app_projects` carries only these usable evidence fields (measured 2026-09-05: scope_text,
//   size and developer are NULL for 100% of residential rows): type_raw, name, stage, status,
//   submitted_at, source_key. `name` is not free text we are guessing at - the registry's own
//   `column_map.title` is an ARRAY whose FIRST element is a real source column, and for the
//   high-volume families that column IS the activity:
//     miami-building-permits      title[0] = ScopeofWork          ("NEW CONSTRUCTION")
//     memphis-dpd-building-permits title[0] = Construction_Type   ("NEW" / "ALT")
//     dekalb-county-building-permits title[0] = WorkTypeDescription ("Repairs to Existing ...")
//     denton-county-dev-permits   title[0] = PermitType           ("HOUSE" / "ADDITION TO HOUSE")
//     little-rock-permits         title[0] = PermitType           ("PLU" / "ELE" / "BLD")
//   `type_raw` is NOT uniform: it is the ACTIVITY in some families (new-hanover trade permits)
//   and the BUILDING USE in others (little-rock `APARTMENT COMPLEX` is 86.5% plumbing,
//   electrical and mechanical permits; loudoun `SINGLE-FAMILY DETACHED` is a UNIT_TYPE). So no
//   rule here may read type_raw as activity nationally - see FAMILY_RULES.
//
// FAIL CONSERVATIVELY. Positive development evidence is REQUIRED. Residential use alone, a
// dwelling-type label alone, and an address alone are all UNRESOLVED, and UNRESOLVED does not
// render. That is the founder rule's Class 4, and it is what removes the largest single block:
// families that publish a residential permit with no activity column at all.
(function () {
  const HS = (window.HS = window.HS || {});

  // ONE normalisation, reproducible in SQL character-for-character: lowercase, every character
  // that is not a-z or 0-9 becomes a space, runs collapse, and the result is wrapped in single
  // spaces so a phrase written " deck " cannot match "decker" or "sundeck".
  HS.residentialNormalize = function (s) {
    let out = '';
    const str = String(s == null ? '' : s).toLowerCase();
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      out += ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) ? str[i] : ' ';
    }
    return ' ' + out.split(' ').filter(Boolean).join(' ') + ' ';
  };

  // ── VOCABULARY ────────────────────────────────────────────────────────────────────────────
  // Every phrase below was read off the production corpus (top name-heads and type_raw values
  // by object count, 2026-09-05), never invented. Phrases carry their own spaces.

  // DEVELOPMENT-SCALE RECORD CLASSES — Class 6. A subdivision, plat or residential site plan is
  // a development record wherever it appears in the source's own class text, so these are the
  // only phrases allowed to match ANYWHERE. They are nouns for the record class itself, which
  // is why they cannot be produced incidentally by an address or a scope sentence.
  // `subdivide`, `subdividing` and `resub` are added from PRODUCTION text, not invented:
  // Delaware County PA files "Subdivide 41.411 acres into two lots", Seattle files "Land Use
  // Application to subdivide one development site into...", and Austin files "Resub of a Part
  // of BLK A & D". They were UNRESOLVED while the corpus literally described the act of
  // subdividing. Each is space-delimited, so `resub` cannot match `resubmission`.
  const DEV_ANYWHERE = [
    ' subdivision ', ' resubdivision ', ' subdivisions ',
    ' subdivide ', ' subdivided ', ' subdividing ', ' resub ',
    ' plat ', ' plats ', ' replat ', ' preliminary plat ', ' final plat ',
    ' site plan ', ' site development plan ', ' sitedevelopment ',
    ' planned development ', ' planned unit development ', ' master plan ',
    ' land development '
  ];

  // UNAMBIGUOUS CONSTRUCTION PHRASES. These are multi-word and cannot be produced by a street
  // name, so they are read from ACTIVITY text ANYWHERE rather than only at its head. Naperville
  // is the case that forces it: `RESIDENTIAL Single Family New Construction - Lot 168` states
  // new construction in the middle of the string and was UNRESOLVED under head-only matching.
  // Anchoring was originally there to stop "...REPLACE the NEW CONSTRUCTION era windows"; that
  // is now handled earlier and better by STRONG_ROUTINE, which outranks every development rule.
  const DEV_PHRASE_ANYWHERE = [
    ' new construction ', ' new residential ', ' new single family ', ' new multi family ',
    ' new multifamily ', ' new apartment ', ' new apartments ', ' new dwelling ',
    ' new dwellings ', ' new townhome ', ' new townhomes ', ' new townhouse ',
    ' new condominium ', ' residential construction ', ' construction residential ',
    ' ground up '
  ];

  // NEW-CONSTRUCTION SCOPE — must ANCHOR the source's own class text (the start of type_raw or
  // the start of name, i.e. the start of column_map.title[0]). Anchoring is what keeps
  // "... to REPLACE the NEW CONSTRUCTION era windows" from qualifying while Miami's
  // ScopeofWork "NEW CONSTRUCTION" does.
  const DEV_HEAD = [
    'new construction', 'new residential', 'new single family', 'new multi family',
    'new multifamily', 'new apartment', 'new home', 'new homes', 'new house',
    'new dwelling', 'new building', 'new bldg', 'new sfr', 'new sfd',
    'residential new', 'construction residential', 'residential construction',
    'site dev', 'sfd devel', 'ground up'
  ];

  // WEAK HEADS carry a construction CODE rather than a phrase - Memphis files
  // Construction_Type 'NEW', Denton files 'DSP'. Alone a bare "new" is not evidence: for the
  // families whose title[0] is the ADDRESS, a street called "NEW HOPE RD" would head-match it
  // and manufacture a development. So a weak head qualifies ONLY when the record also names
  // something being built. Measured on the corpus, this is what separates Memphis's
  // "NEW New construction custom home" from an address that merely starts with the word.
  const DEV_HEAD_WEAK = ['new', 'nb', 'dsp'];
  const DEV_NOUN = [
    ' construction ', ' home ', ' homes ', ' house ', ' dwelling ', ' dwellings ',
    ' residence ', ' residences ', ' residential ', ' duplex ', ' apartment ', ' apartments ',
    ' townhome ', ' townhomes ', ' townhouse ', ' condo ', ' condominium ', ' sfr ', ' sfd ', ' sfth ',
    ' building ', ' bldg ', ' units ', ' unit '
  ];

  // ROUTINE ACTIVITY — Classes 1 and 2. Matching ANYWHERE is deliberate and is the conservative
  // direction: a false match removes one record, it can never invent one. Trade codes are
  // included only in the space-delimited forms the sources actually publish.
  // ACCESSORY OBJECTS — things a permit can be "new construction" OF that are never residential
  // DEVELOPMENT. Found by the adversarial production audit: Miami files its ScopeofWork as
  // "NEW CONSTRUCTION" and puts the real object in WorkItems, so "NEW CONSTRUCTION WOOD FENCE",
  // "NEW CONSTRUCTION COMBINATION POOL AND SPA", "NEW CONSTRUCTION TREE REMOVAL" and
  // "NEW CONSTRUCTION GENERATOR (SINGLE FAMILY / DUPLEX)" all head-matched a development phrase
  // while being a fence, a pool, some trees and a generator. These outrank a development head.
  // STANDALONE accessory projects and equipment only. Deliberately EXCLUDED from this list:
  // windows, siding, roof, garage and waterproofing. Those are normal COMPONENTS of a genuine
  // new build and Miami concatenates its WorkItems, so listing them here excluded real houses -
  // "NEW CONSTRUCTION TWO-FAMILY RESIDENCE|WATERPROOFING" is a two-family residence. They stay
  // in ROUTINE_ANYWHERE, so a permit that is ONLY a reroof is still routine; they simply do not
  // override an explicit new-construction head.
  const ROUTINE_OBJECT = [
    ' fence ', ' fencing ', ' pool ', ' pools ', ' spa ', ' deck ', ' decks ', ' porch ',
    ' porches ', ' shed ', ' carport ', ' driveway ', ' patio ', ' awning ',
    ' generator ', ' ev charger ', ' antenna ', ' sign ', ' signs ', ' retaining wall ',
    ' tree ', ' trees ', ' solar ', ' photovoltaic ', ' water heater ', ' boiler ',
    ' furnace ', ' hvac ', ' air conditioning ', ' irrigation ', ' sprinkler ', ' ductwork '
  ];
  // SCALE NOUNS — a development big enough that an accessory object inside it is part of the
  // project, not the project. "NEW CONSTRUCTION 200 UNIT APARTMENT WITH POOL" is development;
  // "NEW CONSTRUCTION POOL" is not. Bare " unit " is deliberately NOT here - it appears in
  // apartment ADDRESSES ("U-407", "APT 1001" normalise near it) and would readmit unit-level
  // trade work.
  const SCALE_NOUN = [
    ' apartment ', ' apartments ', ' multifamily ', ' multi family ', ' townhome ',
    ' townhomes ', ' townhouse ', ' townhouses ', ' condominium ', ' condominiums ',
    ' units ', ' dwellings ', ' subdivision ', ' residences '
  ];
  const ROUTINE_ANYWHERE = [
    // Class 1 - trade-only permits
    ' hvac ', ' electric ', ' electrical ', ' plumbing ', ' plumb ', ' mechanical ',
    ' gas piping ', ' gas appliances ', ' venting ', ' boiler ', ' furnace ',
    ' water heater ', ' photovoltaic ', ' solar ', ' trade ', ' trades ',
    ' ele ', ' mec ', ' plu ', ' sprinkler ', ' irrigation ', ' low voltage ',
    // Class 2 - alteration / accessory / maintenance on an existing property
    ' alter ', ' alters ', ' alteration ', ' alterations ', ' remodel ', ' remodeling ',
    ' renovation ', ' renovations ', ' repair ', ' repairs ', ' replace ', ' replacing ',
    ' replacement ', ' reroof ', ' re roof ', ' roofing ', ' roof ', ' siding ', ' window ',
    ' windows ', ' deck ', ' decks ', ' porch ', ' porches ', ' fence ', ' fencing ',
    ' pool ', ' pools ', ' spa ', ' shed ', ' carport ', ' garage ', ' accessory ',
    ' maintenance ', ' demolition ', ' demo ', ' tear off ', ' tear down ', ' teardown ',
    ' interior ', ' finish basement ', ' basement finish ', ' addition ', ' additions ',
    ' relocation ', ' move ', ' sign ', ' signs ', ' fire damage ', ' retaining wall ',
    ' driveway ', ' patio ', ' awning ', ' generator ', ' ev charger ', ' antenna ',
    ' alt ', ' air conditioning ', ' ductwork ', ' tree ', ' trees '
  ];

  // PLACE-NAME-AMBIGUOUS ROUTINE WORDS — measured, not guessed. Across the ten
  // development-provenance registries the routine words that fire from `name` while ABSENT
  // from `type_raw` are dominated by ONE word: ` addition ` (261 hits over 6 families, and
  // every sampled hit is a subdivision NAME - "MC ADAMS ADDITION TO HILLBROOK SEC 4 LT 48",
  // "FIRST ADDITION TO TEMPLE VIEW", "Cook Resubdivision of a portion of Block G Bouldins
  // Addition"), with ` tree ` a distant second (5 hits, "The Woods at Rose Tree", and York's
  // plan "Cherry Tree"). In American plat vocabulary an "Addition" IS a subdivision.
  //
  // WHAT WAS DELIBERATELY LEFT OUT, because the same measurement refused it: ` pool ` fires
  // 68 times in fairfax-active-site-construction and all 68 are real pools ("NEW POOL AT 3540
  // ST AUGUSTINE LANE", "CARRIAGE HILL LOT 60 - POOL"). Demoting ` pool ` would have restored
  // exactly the permit noise this whole rule exists to remove. Four words, no more.
  const PLACE_AMBIGUOUS = [' addition ', ' additions ', ' tree ', ' trees '];

  // NAME FIELD SEMANTICS — generated from the registry's own `column_map.title` column NAMES
  // by scripts/residential-name-kind.mjs, and pinned by test/residential-name-kind.test.mjs,
  // which re-derives it from jurisdiction-registry.json and fails on any drift.
  //
  // 'label' = every title column is an address, a parcel, or a project / plan / case NAME, so
  // the whole of `name` is a proper noun. For these families the four PLACE_AMBIGUOUS words
  // carry no activity meaning. Every other family is 'activity' and reads the full vocabulary.
  const NAME_KIND_LABEL = {
    'aldot-atrip-ii-projects': 1,
    'aldot-rebuild-alabama-grant-projects': 1,
    'allegheny-county-asbestos-permits': 1,
    'anne-arundel-commercial-site-plans': 1,
    'anne-arundel-subdivision-activity': 1,
    'ar-ardot-job-status-lines': 1,
    'ar-ardot-job-status-points': 1,
    'austin-site-plan-cases': 1,
    'austin-subdivision-cases': 1,
    'austin-zoning-cases': 1,
    'boone-county-ky-planning-board-actions': 1,
    'burlington-vt-building-permits': 1,
    'burlington-vt-zoning-permits': 1,
    'butler-county-ks-permits': 1,
    'caltrans-sb1-projects': 1,
    'charlotte-land-dev-commercial-projects': 1,
    'chattanooga-building-permits': 1,
    'chester-county-pa-act247-plans': 1,
    'clark-county-active-projects': 1,
    'clarksville-montgomery-final-subdivisions': 1,
    'clarksville-montgomery-preliminary-subdivisions': 1,
    'colorado-springs-planning-applications': 1,
    'cook-county-il-highway-construction-program': 1,
    'fairfax-active-site-construction': 1,
    'fort-worth-zoning-cases': 1,
    'georgia-dot-gpas-projects': 1,
    'harris-county-permits': 1,
    'harris-county-plats': 1,
    'houston-plat-applications': 1,
    'idot-annual-program-bridges': 1,
    'idot-annual-program-construction': 1,
    'iowa-dot-five-year-program': 1,
    'irving-development-permits': 1,
    'johns-creek-building-permits': 1,
    'kdot-wincpms-project-locations': 1,
    'lee-county-fl-development-orders': 1,
    'mdot-sha-project-portal': 1,
    'mt-mdt-stip-lines': 1,
    'nddot-special-road-fund-projects': 1,
    'ndot-program-book-points': 1,
    'ndot-program-book-segments': 1,
    'nj-stip-projects': 1,
    'nvdot-project-boundaries': 1,
    'oregon-dot-stip-projects': 1,
    'oregon-dot-stip-projects-lines': 1,
    'penndot-transportation-projects': 1,
    'phoenix-building-permits': 1,
    'provo-planning-applications': 1,
    'round-rock-large-development-projects': 1,
    'san-marcos-planning-cases': 1,
    'scdot-project-viewer-lines': 1,
    'stamford-major-developments': 1,
    'summit-county-oh-planning-commission-items': 1,
    'weld-county-site-plan-review': 1,
    'york-county-pa-planning-subdivisions': 1
  };


  // ── SOURCE PROVENANCE AS AUTHORITATIVE EVIDENCE (founder ruling, 2026-09-06) ─────────────
  //
  // A registry may qualify a record when the SOURCE FAMILY ITSELF is demonstrably constrained
  // to a development-class universe. This is not "the name sounds developmental": each entry
  // below records the corpus census that proves the bound, taken from production
  // `app_projects` on 2026-09-06, and every one was re-proved rather than inherited from the
  // audit's list. Provenance sits BELOW row-level routine evidence in the ladder, so a pool
  // inside a development registry is still a pool.
  //
  // REJECTED, with the evidence that rejected them — do not "restore" these:
  //   dallas-specific-use-permits      530 distinct type_raw values that are USES, not
  //                                    development: Billiard Hall 655, Bus Passenger Shelter
  //                                    914, Videoboard 1,067, Electric Substation 417, Day
  //                                    Nursery 464. A Specific Use Permit authorises a use on
  //                                    existing land; the corpus is a use universe.
  //   slc-planning-petitions           mixed: Minor Alteration 97, Conditional Use 107,
  //                                    Request for Rebuild 120 - and 34 of its 44 residential
  //                                    rows are `Routine and Uncontest Home Occ`, a
  //                                    home-occupation licence, which is not development.
  //   slo-county-planning-permits      Zoning Clearance 6,605, SolarAPP+ 1,276, Fire
  //                                    Suppression 879, Vacation Rental 15. Not bounded. (Its
  //                                    genuine `Residential New Structure` rows already
  //                                    qualify on their own activity text.)
  //   burlington-vt-zoning-permits     type_raw is a ZONING DISTRICT (R1 - Single Fam, RA -
  //                                    Apartments). A district is not an activity.
  //   arlington-permit-applications    type_raw is an occupancy class (Single-Family, New
  //                                    Tenant, Mercantile).
  //   montgomery-county-residential-permits  a FAMILY RULE was drafted for its worktype
  //                                    `CONSTRUCT` (2,041 rows) and the measurement killed it:
  //                                    the sampled descriptions are "Construct a pre-engineered
  //                                    metal shed", "Prefabricated Suncast Modernist shed",
  //                                    "Build deck using Typical Deck Details", "Bike shed to
  //                                    shelter my bikes". CONSTRUCT is not new-dwelling
  //                                    evidence here.
  const DEV_PROVENANCE = {
    // Austin's subdivision case file. Every record IS a subdivision case; type_raw is the
    // land-use code (Single Family 1,176 / SF 364 / MF 48 / DUP 43 / Commercial 391).
    'austin-subdivision-cases': true,
    // Austin's site-plan case file - site plans are development entitlements. type_raw is
    // again the land-use code (MF 246, Single Family 222, Condominium 170).
    'austin-site-plan-cases': true,
    // Pennsylvania Act 247 requires municipalities to refer SUBDIVISION AND LAND DEVELOPMENT
    // plans to the county planning commission. 5 clean type_raw values, all land-use classes:
    // Residential 1,177 / Commercial 544 / Institutional 378 / Industrial 264 / Agricultural 97.
    'chester-county-pa-act247-plans': true,
    // County planning subdivisions. 3 type_raw values: Residential 2,085 / Nonresidential
    // 3,158 / null 55 - a pure land-use split over a subdivision-and-land-development corpus.
    'delaware-county-pa-subdivisions-land-developments': true,
    // County planning subdivisions. type_raw is a serialized checkbox matrix
    // ("NO NO YES NO NO NO NO NO"), so it can never supply activity evidence; the corpus bound
    // is what makes these records readable at all.
    'york-county-pa-planning-subdivisions': true,
    // Fairfax's ACTIVE SITE CONSTRUCTION plans. 9 type_raw values and every one is a plan
    // class: Infill Lot Grading Plan 4,474 / Site Plan 1,116 / Minor Site Plan 685 / Rough
    // Grading Plan 456 / Subdivision Grading Plan 396 / DPWES Plan 255 / Public Improvement
    // Plan 248 / Subdivision Plan 213 / Conservation Plan 164. Its 68 pool records are
    // excluded by row-level routine evidence, which outranks this.
    'fairfax-active-site-construction': true,
    // Seattle Master Use Permits - land-use entitlements. 6 type_raw values, all building-use
    // classes. Its `description` column is ACTIVITY text, so "an addition to an existing
    // single family" is still excluded by the routine rules above this.
    'seattle-land-use-permits': true,
    // Casa Grande's ACTIVE DEVELOPMENT SITES. 10 type_raw values, all zoning-district classes
    // over a development-site corpus (Planned Area Development 22, Residential - Multi-Family 3).
    'casa-grande-active-development-sites': true
  };

  // PER-FAMILY RULES — the only place a registry-specific meaning is asserted, each with the
  // column_map field it reads and why. Nothing here is applied nationally.
  const FAMILY_RULES = {
    // title[0] = PermitType. The permit type IS the thing being built, so a HOUSE / DUPLEX /
    // MOBILE HOME permit is a new dwelling; ADDITION TO HOUSE and GARAGE are their own
    // PermitType values and are caught by ROUTINE_ANYWHERE.
    'denton-county-dev-permits': { dev_type_raw: ['house', 'duplex', 'mobile home'] },
    // type_source = OccupancyTypeDescription; "New Homes" is the one occupancy value that
    // states construction rather than a building class.
    'dekalb-county-building-permits': { dev_type_raw: ['new homes'] }
  };

  HS.RESIDENTIAL_VOCABULARY = {
    dev_anywhere: DEV_ANYWHERE,
    dev_phrase_anywhere: DEV_PHRASE_ANYWHERE,
    place_ambiguous: PLACE_AMBIGUOUS,
    name_kind_label: NAME_KIND_LABEL,
    dev_provenance: DEV_PROVENANCE,
    dev_head: DEV_HEAD,
    dev_head_weak: DEV_HEAD_WEAK,
    dev_noun: DEV_NOUN,
    routine_object: ROUTINE_OBJECT,
    scale_noun: SCALE_NOUN,
    routine_anywhere: ROUTINE_ANYWHERE,
    family_rules: FAMILY_RULES
  };

  function has(norm, phrases) {
    for (let i = 0; i < phrases.length; i++) if (norm.indexOf(phrases[i]) !== -1) return phrases[i];
    return null;
  }
  // Head match = the phrase begins the normalised string. Phrases may be written with or
  // without their surrounding spaces, so both forms are trimmed to one shape here rather than
  // maintained twice.
  function headHas(norm, phrases) {
    for (let i = 0; i < phrases.length; i++) {
      if (norm.indexOf(' ' + phrases[i].trim() + ' ') === 0) return phrases[i];
    }
    return null;
  }

  // The verdict for ONE app_projects row. Never throws; an unreadable row is UNRESOLVED, which
  // does not render - absence of evidence is never read as evidence of development.
  //   DEVELOPMENT  qualifying residential development
  //   ROUTINE      routine work on an existing residential property
  //   UNRESOLVED   the source states residential use but no activity we can defend
  // Routine phrases minus the four place-name-ambiguous ones, for use against a LABEL name.
  function routineFor(nameIsLabel) {
    if (!nameIsLabel) return ROUTINE_ANYWHERE;
    return ROUTINE_ANYWHERE.filter(function (w) { return PLACE_AMBIGUOUS.indexOf(w) === -1; });
  }

  HS.residentialNameIsLabel = function (registryId) {
    return !!NAME_KIND_LABEL[String(registryId || '')];
  };

  // THE PRECEDENCE LADDER, and why it is in this order.
  //
  //   1 STRONG_ROUTINE   a routine phrase in `type_raw`, or heading `name`. The issuing
  //                      authority's own class field saying "Interior Remodel" or "Accessory
  //                      Structure" outranks EVERY development rule below, which is what stops
  //                      a remodel qualifying because its ADDRESS contains "CLARION LAKE
  //                      SUBDIVISION" (measured: 144 such records before this change).
  //   2 DEV_HEAD         an explicit construction phrase in activity text, accessory-overridden.
  //   3 ROUTINE_ANYWHERE routine evidence anywhere else - minus the place-ambiguous words when
  //                      the family's `name` is a plan/case/address label.
  //   4 DEV_ANYWHERE     record-class nouns (subdivision, plat, site plan, subdivide).
  //   5 PROVENANCE       the source family is a bounded development-class corpus.
  //   6 FAMILY_TYPE_RAW  a per-family type_raw meaning.
  //   7 UNRESOLVED       no evidence. Does not render. Absence is never read as development.
  HS.residentialActivity = function (project) {
    const p = project || {};
    const tr = HS.residentialNormalize(p.type_raw);
    const nm = HS.residentialNormalize(p.name);
    const both = tr + nm;
    const registryId = String(p.registry_id || '');
    const nameIsLabel = HS.residentialNameIsLabel(registryId);

    // 1 — STRONG ROUTINE. The class field, or the head of the class field inside `name`.
    let hit = has(tr, ROUTINE_ANYWHERE);
    if (hit) return { verdict: 'ROUTINE', rule: 'ROUTINE_TYPE_RAW', evidence: hit.trim(), field: 'type_raw' };
    hit = headHas(nm, ROUTINE_ANYWHERE);
    if (hit) return { verdict: 'ROUTINE', rule: 'ROUTINE_NAME_HEAD', evidence: hit.trim(), field: 'name' };

    // 2 — EXPLICIT CONSTRUCTION. A development head is only development if what is being built
    // is not a standalone accessory object.
    const accessory = has(both, ROUTINE_OBJECT);
    const scale = has(both, SCALE_NOUN);
    const activityText = nameIsLabel ? tr : both;
    const devPhrase = has(activityText, DEV_PHRASE_ANYWHERE);
    const devHead = headHas(tr, DEV_HEAD) || (nameIsLabel ? null : headHas(nm, DEV_HEAD));
    if (devPhrase || devHead) {
      if (accessory && !scale) {
        return { verdict: 'ROUTINE', rule: 'ACCESSORY_OBJECT_OUTRANKS_DEV_HEAD',
                 evidence: accessory.trim(), field: 'name' };
      }
      return { verdict: 'DEVELOPMENT', rule: devPhrase ? 'DEV_PHRASE' : 'DEV_HEAD',
               evidence: (devPhrase || devHead).trim(),
               field: tr.indexOf(devPhrase || devHead) !== -1 ? 'type_raw' : 'name' };
    }

    // The corroborating noun must come from the SAME field that carried the weak head.
    // Reading it from `both` let type_raw='Residential' corroborate every weak head, which
    // turned the street "NEW HOPE RD" into a development - caught before shipping. Weak heads
    // stay ANCHORED and are never read from a LABEL name for the same reason.
    const weakTr = headHas(tr, DEV_HEAD_WEAK);
    const weakNm = nameIsLabel ? null : headHas(nm, DEV_HEAD_WEAK);
    if ((weakTr && has(tr, DEV_NOUN)) || (weakNm && has(nm, DEV_NOUN))) {
      if (accessory && !scale) {
        return { verdict: 'ROUTINE', rule: 'ACCESSORY_OBJECT_OUTRANKS_DEV_HEAD',
                 evidence: accessory.trim(), field: 'name' };
      }
      return { verdict: 'DEVELOPMENT', rule: 'DEV_HEAD_WEAK+NOUN',
               evidence: (weakTr || weakNm).trim(), field: weakTr ? 'type_raw' : 'name' };
    }

    // 3 — ROUTINE ANYWHERE ELSE.
    hit = has(nameIsLabel ? tr : both, ROUTINE_ANYWHERE) || has(nm, routineFor(nameIsLabel));
    if (hit) return { verdict: 'ROUTINE', rule: 'ROUTINE_ANYWHERE', evidence: hit.trim(),
                      field: tr.indexOf(hit) !== -1 ? 'type_raw' : 'name' };

    // 4 — RECORD-CLASS NOUNS. Below routine on purpose: this is the P2 leak the audit measured.
    hit = has(both, DEV_ANYWHERE);
    if (hit) return { verdict: 'DEVELOPMENT', rule: 'DEV_ANYWHERE', evidence: hit.trim(),
                      field: tr.indexOf(hit) !== -1 ? 'type_raw' : 'name' };

    // 5 — SOURCE PROVENANCE.
    if (DEV_PROVENANCE[registryId]) {
      return { verdict: 'DEVELOPMENT', rule: 'DEV_PROVENANCE', evidence: registryId,
               field: 'registry_id' };
    }

    // 6 — PER-FAMILY type_raw MEANING.
    const fam = FAMILY_RULES[registryId];
    if (fam && fam.dev_type_raw) {
      for (let i = 0; i < fam.dev_type_raw.length; i++) {
        if (tr === ' ' + fam.dev_type_raw[i] + ' ') {
          return { verdict: 'DEVELOPMENT', rule: 'FAMILY_TYPE_RAW', evidence: fam.dev_type_raw[i],
                   field: 'type_raw:' + registryId };
        }
      }
    }
    return { verdict: 'UNRESOLVED', rule: 'NO_ACTIVITY_EVIDENCE', evidence: null, field: null };
  };

  HS.residentialQualifies = function (project) {
    return HS.residentialActivity(project).verdict === 'DEVELOPMENT';
  };

  // THE GATE the site builders call. It is scoped by the SHIPPED classifier - never by a second
  // copy of the residential rules - so it can only ever remove objects that Map 1 would in fact
  // have drawn as Residential. Every other Type is returned untouched, which is what keeps this
  // workstream from weakening Data center, Regulated facility or Roads & infrastructure.
  // ── THE SITE ADAPTER — one semantic contract, several entry points ───────────────────────
  //
  // Map 1 builds development sites from THREE shapes, and the audit proved that gating only
  // the two that carry an `app_projects` row left the third rendering un-qualified:
  //   1. authoritative ZIP markers  -> lib/zip-authoritative.js (has the project row)
  //   2. address-mode radius sites  -> lib/n5-radius.js         (has the project row)
  //   3. cached report sites        -> development_reports.sites / property_reports.sites,
  //                                    which carry no project row at all - the site IS the
  //                                    record. 41,661 of these are scope 'area' with
  //                                    relevance 'development' (measured 2026-09-06), 812 of
  //                                    them Residential across 90 ZIPs, and every one reached
  //                                    the rails, the count and the map without qualification.
  //
  // The fix is NOT a second copy of the rules. It is an ADAPTER that reads the same three
  // evidence fields off a site, so shape 3 is judged by the identical ladder. Nothing is
  // invented: a site with no class text and no title simply has no evidence, and UNRESOLVED
  // does not render.
  HS.residentialEvidenceFromSite = function (site) {
    if (!site) return null;
    return {
      // The registry's own class field, carried on cached report sites as `type_raw`.
      type_raw: site.type_raw || null,
      // column_map.title, carried as `title` and mirrored into `label` for display.
      name: site.title || site.label || site.name || null,
      // Source identity. `source_registry_id` on registry-sourced sites; `src` is the same
      // slug on the authoritative ZIP shape (kept off `registry_id` there on purpose - see
      // lib/zip-authoritative.js rule 2). Never written back onto the site.
      registry_id: site.source_registry_id || site.src || site.registry_id || null
    };
  };

  // The gate for a site that carries no project row. Same classifier, same verdicts.
  HS.residentialSiteGateDrops = function (site) {
    const ev = HS.residentialEvidenceFromSite(site);
    if (!ev) return false;
    return HS.residentialGateDrops(site, ev);
  };

  // TOTAL QUALIFICATION. Every user-facing Residential population - rail, count, marker,
  // property card - is built from the array this returns, so a record it removes cannot
  // appear in one of them and be missing from another. Scoped to development records: a
  // regulated facility or a civic notice is not a Map 1 Residential candidate and is
  // returned untouched, which is what keeps the other Types out of this workstream.
  HS.residentialQualifySites = function (sites) {
    if (!sites || !sites.length) return sites || [];
    return sites.filter(function (s) {
      if (!s || s.relevance !== 'development') return true;
      return !HS.residentialSiteGateDrops(s);
    });
  };

  HS.residentialGateDrops = function (site, project) {
    if (!site || !project) return false;
    if (!HS.resolveTrackerMarker) return false;
    let m;
    try { m = HS.resolveTrackerMarker(site); } catch (e) { return false; }
    if (!m || m.typeKey !== 'residential') return false;
    return !HS.residentialQualifies(project);
  };
})();
