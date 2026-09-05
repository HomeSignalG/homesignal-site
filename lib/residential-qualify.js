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
  const DEV_ANYWHERE = [
    ' subdivision ', ' resubdivision ', ' subdivisions ',
    ' plat ', ' plats ', ' replat ', ' preliminary plat ', ' final plat ',
    ' site plan ', ' site development plan ', ' sitedevelopment ',
    ' planned development ', ' planned unit development ', ' master plan ',
    ' land development '
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
    ' townhome ', ' townhomes ', ' townhouse ', ' condo ', ' condominium ', ' sfr ', ' sfd ',
    ' building ', ' bldg ', ' units ', ' unit '
  ];

  // ROUTINE ACTIVITY — Classes 1 and 2. Matching ANYWHERE is deliberate and is the conservative
  // direction: a false match removes one record, it can never invent one. Trade codes are
  // included only in the space-delimited forms the sources actually publish.
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
    ' alt '
  ];

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
    dev_head: DEV_HEAD,
    dev_head_weak: DEV_HEAD_WEAK,
    dev_noun: DEV_NOUN,
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
  HS.residentialActivity = function (project) {
    const p = project || {};
    const tr = HS.residentialNormalize(p.type_raw);
    const nm = HS.residentialNormalize(p.name);
    const both = tr + nm;

    let hit = has(both, DEV_ANYWHERE);
    if (hit) return { verdict: 'DEVELOPMENT', rule: 'DEV_ANYWHERE', evidence: hit.trim(),
                      field: tr.indexOf(hit) !== -1 ? 'type_raw' : 'name' };

    // THE WORK-TYPE COLUMN OUTRANKS THE OCCUPANCY COLUMN. `name` begins with column_map
    // title[0], which for the families carrying both is the WORK performed, while `type_raw`
    // is the building's occupancy class. DeKalb is the case that forces the order: occupancy
    // "New Homes" with WorkTypeDescription "Repairs to Existing Structure" is a repair, and
    // reading type_raw first would have called it new construction.
    hit = headHas(nm, ROUTINE_ANYWHERE);
    if (hit) return { verdict: 'ROUTINE', rule: 'ROUTINE_NAME_HEAD', evidence: hit.trim(), field: 'name' };

    hit = headHas(tr, DEV_HEAD);
    if (hit) return { verdict: 'DEVELOPMENT', rule: 'DEV_HEAD', evidence: hit.trim(), field: 'type_raw' };
    hit = headHas(nm, DEV_HEAD);
    if (hit) return { verdict: 'DEVELOPMENT', rule: 'DEV_HEAD', evidence: hit.trim(), field: 'name' };

    // The corroborating noun must come from the SAME field that carried the weak head.
    // Reading it from `both` let type_raw='Residential' corroborate every weak head, which
    // turned the street "NEW HOPE RD" into a development - caught before shipping.
    const weakTr = headHas(tr, DEV_HEAD_WEAK);
    if (weakTr && has(tr, DEV_NOUN)) {
      return { verdict: 'DEVELOPMENT', rule: 'DEV_HEAD_WEAK+NOUN', evidence: weakTr.trim(), field: 'type_raw' };
    }
    const weakNm = headHas(nm, DEV_HEAD_WEAK);
    if (weakNm && has(nm, DEV_NOUN)) {
      return { verdict: 'DEVELOPMENT', rule: 'DEV_HEAD_WEAK+NOUN', evidence: weakNm.trim(), field: 'name' };
    }

    hit = has(both, ROUTINE_ANYWHERE);
    if (hit) return { verdict: 'ROUTINE', rule: 'ROUTINE_ANYWHERE', evidence: hit.trim(),
                      field: tr.indexOf(hit) !== -1 ? 'type_raw' : 'name' };

    const fam = FAMILY_RULES[String(p.registry_id || '')];
    if (fam && fam.dev_type_raw) {
      for (let i = 0; i < fam.dev_type_raw.length; i++) {
        if (tr === ' ' + fam.dev_type_raw[i] + ' ') {
          return { verdict: 'DEVELOPMENT', rule: 'FAMILY_TYPE_RAW', evidence: fam.dev_type_raw[i],
                   field: 'type_raw:' + p.registry_id };
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
  HS.residentialGateDrops = function (site, project) {
    if (!site || !project) return false;
    if (!HS.resolveTrackerMarker) return false;
    let m;
    try { m = HS.resolveTrackerMarker(site); } catch (e) { return false; }
    if (!m || m.typeKey !== 'residential') return false;
    return !HS.residentialQualifies(project);
  };
})();
