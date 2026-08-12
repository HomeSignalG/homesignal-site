// HomeSignal PROPERTY CARD backbone — the ONE state vocabulary and renderer set shared by
// the full card (property-card.html) and the Maps slide-in that links to it (maps.html).
//
// WHY THIS FILE EXISTS. The card's whole job is to say, per source, WHICH OF THESE IT IS:
// we looked and found records · we looked and found none · we have not looked · we tried and
// the source failed · the source refused us. Those are different facts, and the founder's
// standing rule is that "not checked" must never render as "no records found" — the same
// distinction docs/multi-source-evidence-architecture.md Part 12 stores as seven states and
// PR #662 already had to repair once on the ZIP page (a failed EPA read had rendered as 0).
// One page owning that logic privately is how the two surfaces drift apart, so it lives here.
//
// THE RULE THE WHOLE FILE ENFORCES: a COUNT may be printed only for a state that actually
// counted something. Every other state prints an em-dash. There is no code path in which an
// unchecked, failed, or restricted source produces the numeral 0 — see metricText().
//
// Pure + DOM-free (same contract as lib/why.js) so test/property-card.test.mjs can pin every
// gate offline.
(function () {
  const HS = (window.HS = window.HS || {});
  const card = (HS.card = HS.card || {});

  function esc(v) { return HS.esc ? HS.esc(v) : String(v == null ? '' : v); }

  // ── THE CLOSED STATE VOCABULARY ────────────────────────────────────────────────
  // Seven states come straight from Part 12 (verified · reported · unresolved ·
  // conflicting · unavailable · not_checked · checked_empty). Three more describe
  // COVERAGE rather than a single claim, and each names a condition already observed in
  // production that the seven cannot express without lying:
  //   partial            — some fields of a section were checked and some were not. Rolling
  //                        that up to "checked" over-reads; to "not checked" under-reads.
  //   access_restricted  — the source answered and refused us (Buffalo's 403 view class,
  //                        Fort Bend's 403 web map). Distinct from a failure: retrying will
  //                        not help, so it must not read as a transient outage.
  //   in_progress        — a corpus is being built and is not yet queryable. Only the read
  //                        model may set this; nothing here infers it (see state()).
  //
  // `countable` is the load-bearing column: it is the ONLY thing that lets a number reach
  // the screen. checked_empty is countable BECAUSE its count is a real, measured zero.
  const STATES = {
    verified:          { label: 'Checked — records found',        short: 'Checked',      tone: 'ok',      countable: true },
    reported:          { label: 'Checked — records found as filed', short: 'As filed',   tone: 'ok',      countable: true },
    checked_empty:     { label: 'Checked — no records found',     short: 'Checked',      tone: 'clear',   countable: true },
    conflicting:       { label: 'Sources disagree',               short: 'Conflict',     tone: 'flag',    countable: true },
    partial:           { label: 'Partial coverage',               short: 'Partial',      tone: 'partial', countable: false },
    unresolved:        { label: 'Unresolved',                     short: 'Unresolved',   tone: 'flag',    countable: false },
    in_progress:       { label: 'In progress',                    short: 'In progress',  tone: 'work',    countable: false },
    not_checked:       { label: 'Not checked',                    short: 'Not checked',  tone: 'none',    countable: false },
    unavailable:       { label: 'Source unavailable',             short: 'Unavailable',  tone: 'down',    countable: false },
    access_restricted: { label: 'Access restricted',              short: 'Restricted',   tone: 'blocked', countable: false }
  };
  card.STATES = STATES;

  // Plain-language explanation of each state, for the legend and for a section with no
  // records to show. These are statements about OUR research, never about the property.
  const STATE_NOTES = {
    verified:          'We queried this source and it returned records for entities connected to this property.',
    reported:          'Records exist and are shown exactly as filed; the filing itself is the evidence.',
    checked_empty:     'We queried this source and it returned no records. A real, measured zero.',
    conflicting:       'Two or more sources make claims that contradict each other. Both are kept and shown.',
    partial:           'Some fields in this section have been checked and some have not. The unchecked ones say so.',
    unresolved:        'Records exist but do not resolve to one answer yet, so none is presented as the answer.',
    in_progress:       'This source is being wired up and is not queryable yet. No result is implied.',
    not_checked:       'We have not queried this source for this property. This is not a finding of any kind.',
    unavailable:       'We queried this source and the request failed, so we do not know what it holds.',
    access_restricted: 'This source exists but refuses automated access, so its contents cannot be read.'
  };
  card.STATE_NOTES = STATE_NOTES;

  /**
   * Normalize a state value coming off a payload.
   *   null / undefined / ''  -> 'not_checked'   (Part 12: NO source_check row IS "not checked")
   *   a declared key         -> that key
   *   anything else          -> null            (FAIL CLOSED)
   * A value we do not recognize must never be guessed into a state, because every state is a
   * claim about what we did. The same fail-closed posture the status_to_bucket lookups use:
   * an unmapped value publishes nothing rather than something plausible.
   */
  card.state = function (v) {
    if (v == null || v === '') return 'not_checked';
    const k = String(v).trim().toLowerCase().replace(/[\s-]+/g, '_');
    return STATES[k] ? k : null;
  };

  card.isCountable = function (v) {
    const k = card.state(v);
    return !!(k && STATES[k].countable);
  };

  card.label = function (v) {
    const k = card.state(v);
    return k ? STATES[k].label : 'State not recognized';
  };

  card.note = function (v) {
    const k = card.state(v);
    return k ? STATE_NOTES[k]
      : 'The state of this check could not be read, so nothing is asserted about it.';
  };

  /** The em-dash every non-countable state prints instead of a number. */
  card.NO_VALUE = '\u2014';

  /**
   * THE ANTI-FABRICATION GATE. A number reaches the screen only when the state counted
   * something AND the value really is a finite number. Everything else — not checked, a
   * failed read, a refused source, an unrecognized state, a missing value — is an em-dash.
   *
   * This is why `not_checked` with n=0 renders '—' and never '0': a zero printed next to a
   * source we never queried reads as "clean", which is the exact defect PR #662 repaired.
   */
  card.metricText = function (state, n) {
    if (!card.isCountable(state)) return card.NO_VALUE;
    if (typeof n !== 'number' || !isFinite(n)) return card.NO_VALUE;
    return String(n);
  };

  // ── PER-MODULE DISPLAY LABELS ───────────────────────────────────────────────────
  // The approved design says the same underlying state in FIVE different vocabularies: the track
  // record says "CHECKED", Regulatory Records says "Data available", Facilities says "Connections
  // found", Sustainability says "Pilot only", Sources & Verification uses an icon. Those words are
  // approved and must appear.
  //
  // What must NOT happen is each module owning its own state list — that is how five vocabularies
  // become five state machines that disagree at the edges, which is exactly what the draft brief
  // did. So the STATE is singular and only its LABEL varies by module. A module may relabel a
  // state; it may never invent one.
  const MODULE_LABELS = {
    'regulatory-records': { verified: 'Data available', reported: 'Data available',
      checked_empty: 'Checked \u2014 none found', unavailable: 'Not available',
      access_restricted: 'Not available' },
    'facility-connections': { verified: 'Connections found', reported: 'Connections found',
      unresolved: 'Unresolved', checked_empty: 'None found' },
    'sustainability': { in_progress: 'Pilot only', reported: 'Data available',
      verified: 'Data available' },
    // The design's agency badges are SHORT by necessity — five cards in one row leaves no width
    // for "Checked — records found", which clipped. These are the mockup's own words.
    'entity-track-record': { verified: 'Checked', reported: 'Checked', checked_empty: 'Checked',
      partial: 'Partial', not_checked: 'Not checked', in_progress: 'In progress',
      unavailable: 'Not available', access_restricted: 'Restricted', conflicting: 'Conflict',
      unresolved: 'Unresolved' }
  };

  /** The label a given module uses for a state, falling back to the canonical one. */
  card.moduleLabel = function (moduleId, state) {
    const k = card.state(state);
    if (!k) return card.label(state);
    const m = MODULE_LABELS[moduleId];
    return (m && m[k]) || STATES[k].label;
  };

  card.badgeHTML = function (state, opts) {
    opts = opts || {};
    const k = card.state(state);
    const tone = k ? STATES[k].tone : 'none';
    // `module` relabels; `short` shortens; neither may change which state is being reported.
    const text = opts.module ? card.moduleLabel(opts.module, state)
      : (opts.short && k ? STATES[k].short : card.label(state));
    return '<span class="pcst t-' + esc(tone) + '" title="' + esc(card.note(state)) + '">'
      + esc(text) + '</span>';
  };

  // ── SECTION ROLLUP ─────────────────────────────────────────────────────────────
  // A section's own state, derived from its rows' states. The order is deliberate and
  // pessimistic: a section reports the WEAKEST thing true of it, so a single unread source
  // can never hide behind its neighbours' green.
  //
  // Precedence, highest first:
  //   unavailable > access_restricted > conflicting > unresolved > partial
  // then, if every row agrees, that shared state; then a checked/unchecked mix -> partial.
  const ROLLUP_ORDER = ['unavailable', 'access_restricted', 'conflicting', 'unresolved', 'partial'];
  card.rollup = function (states) {
    const keys = (states || []).map(card.state);
    if (!keys.length) return 'not_checked';
    if (keys.some(function (k) { return k === null; })) return null;   // fail closed, loudly
    for (let i = 0; i < ROLLUP_ORDER.length; i++) {
      if (keys.indexOf(ROLLUP_ORDER[i]) >= 0) return ROLLUP_ORDER[i];
    }
    const uniq = keys.filter(function (k, i) { return keys.indexOf(k) === i; });
    if (uniq.length === 1) return uniq[0];
    const checked = keys.filter(card.isCountable).length;
    if (checked && checked < keys.length) return 'partial';           // some looked at, some not
    if (keys.indexOf('in_progress') >= 0 && keys.indexOf('not_checked') >= 0) return 'in_progress';
    return 'partial';
  };

  // ── COMPLETENESS ───────────────────────────────────────────────────────────────
  // The donut counts SOURCES BY RESEARCH STATE. It is deliberately not a score: there is no
  // weighting, no "percent complete" headline, and a property with nothing on record scores
  // identically to one we simply have not read. Coverage of our research, nothing else.
  card.completeness = function (rows) {
    const byState = {}; let total = 0, unrecognized = 0, read = 0;
    (rows || []).forEach(function (r) {
      const k = card.state(r && r.state !== undefined ? r.state : r);
      total++;
      if (k === null) { unrecognized++; return; }
      byState[k] = (byState[k] || 0) + 1;
      // "Read" means we actually got an answer out of the source, whether that answer was records
      // or a measured nothing. `partial` is deliberately NOT counted: it is a source we got only
      // part of an answer from, and giving it half credit would be a WEIGHT — the one thing this
      // module must not invent. It stays visible in the legend so the shortfall is explained
      // rather than hidden inside the number.
      if (k === 'verified' || k === 'reported' || k === 'checked_empty') read++;
    });
    // 0 of 0 is not 0% — with nothing to check there is no percentage, so it is null and renders
    // as an em-dash. A 0% on an empty denominator would read as a finding.
    const pct = total > 0 ? Math.round((read / total) * 100) : null;
    return { byState: byState, total: total, unrecognized: unrecognized, read: read, pct: pct };
  };

  /**
   * The percentage, and the fraction that explains it. Always render them together: an
   * unexplained "17%" invites the reader to supply their own denominator, and the number they
   * imagine is never "sources we have read". This measures OUR RESEARCH, never the property —
   * which is what card.DISCLAIMER says, and why a percentage here is safe to show at all.
   */
  card.completenessText = function (counts) {
    if (!counts || counts.pct == null) {
      return { pct: card.NO_VALUE, basis: 'No sources apply to this property yet.' };
    }
    return {
      pct: counts.pct + '%',
      basis: counts.read + ' of ' + counts.total + ' sources fully read'
        + (counts.byState.partial ? ', ' + counts.byState.partial + ' partly read' : '') + '.'
    };
  };

  // Donut order = the reading order of the legend, so slice and legend never disagree.
  const DONUT_ORDER = ['verified', 'reported', 'checked_empty', 'conflicting', 'unresolved',
    'partial', 'in_progress', 'not_checked', 'unavailable', 'access_restricted'];
  card.DONUT_ORDER = DONUT_ORDER;

  /**
   * Hand-rolled inline-SVG donut. The CSP on every data page allows script-src self +
   * jsDelivr only (CLAUDE.md §4), so charts are inline SVG by rule — never a chart library.
   * A total of 0 returns an honest empty ring rather than a full circle of one colour.
   */
  card.donutSVG = function (counts, opts) {
    opts = opts || {};
    const size = opts.size || 132, sw = opts.stroke || 17;
    const r = (size - sw) / 2, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
    const byState = (counts && counts.byState) || {};
    const total = DONUT_ORDER.reduce(function (n, k) { return n + (byState[k] || 0); }, 0);
    let out = '<svg class="pcdonut" viewBox="0 0 ' + size + ' ' + size + '" width="' + size
      + '" height="' + size + '" role="img" aria-label="'
      + esc(opts.aria || 'Coverage by information category') + '">'
      + '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--line-2)" stroke-width="' + sw + '"></circle>';
    if (total > 0) {
      let acc = 0;
      DONUT_ORDER.forEach(function (k) {
        const n = byState[k] || 0;
        if (!n) return;
        const len = C * (n / total);
        out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none"'
          + ' stroke="var(--pct-' + k.replace(/_/g, '-') + ')" stroke-width="' + sw + '"'
          + ' stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '"'
          + ' stroke-dashoffset="' + (-acc).toFixed(2) + '"'
          + ' transform="rotate(-90 ' + cx + ' ' + cy + ')"><title>'
          + esc(STATES[k].label + ': ' + n) + '</title></circle>';
        acc += len;
      });
    }
    const txt = card.completenessText(counts);
    out += '<text x="' + cx + '" y="' + (cy - 1) + '" text-anchor="middle" class="pcdn">'
      + esc(txt.pct) + '</text>'
      + '<text x="' + cx + '" y="' + (cy + 15) + '" text-anchor="middle" class="pcdl">'
      + (total > 0 ? 'read' : 'n/a') + '</text></svg>';
    return out;
  };

  // ── THE CARD'S OWN STRUCTURE ───────────────────────────────────────────────────
  // Declared once, consumed by the page AND by the tests, so a section cannot be renamed
  // in one place and asserted in another. `tab` is which tab owns the section; the Overview
  // tab is a digest that shows every section's headline state.
  card.TABS = [
    { id: 'overview',   label: 'Overview' },
    { id: 'trackrec',   label: 'Track Record' },
    { id: 'property',   label: 'Property' },
    { id: 'developmnt', label: 'Development' },
    { id: 'facilities', label: 'Facilities & Regulatory' },
    { id: 'hazards',    label: 'Hazards & Notices' },
    { id: 'records',    label: 'Records' },
    { id: 'sources',    label: 'Sources & Data' }
  ];

  // NOTE the absence of a "parent company track record" section. A parent is not a different
  // KIND of information, it is a different ENTITY — so it is an entity group inside Entity Track
  // Record (see ENTITY_ROLES), not a module of its own. Two modules invited the reading that a
  // parent's conduct is a separate category of fact about this property; one module with labelled
  // entity groups says the true thing: here is who is involved, and whose record each event is.
  card.SECTIONS = [
    { id: 'entity-track-record',   tab: 'trackrec',   title: 'Entity track record' },
    { id: 'property-ownership',    tab: 'property',   title: 'Property & ownership' },
    { id: 'development-activity',  tab: 'developmnt', title: 'Development / project activity' },
    { id: 'facility-connections',  tab: 'facilities', title: 'Facilities & regulatory connections' },
    { id: 'natural-hazards',       tab: 'hazards',    title: 'Natural hazards' },
    { id: 'meetings-notices',      tab: 'hazards',    title: 'Public meetings & notices' },
    { id: 'sustainability',        tab: 'trackrec',   title: 'Sustainability disclosures' },
    { id: 'recorded-instruments',  tab: 'records',    title: 'Recorded instruments' },
    { id: 'regulatory-records',    tab: 'records',    title: 'Regulatory records' },
    { id: 'sources-verification',  tab: 'sources',    title: 'Sources & verification' },
    { id: 'data-completeness',     tab: 'sources',    title: 'Data completeness' }
  ];

  // ── THE ENFORCEMENT SOURCE REGISTRY ────────────────────────────────────────────
  // Agencies are DATA. Adding one — a new federal regulator, a state AG, a city enforcement
  // body — is an entry in this list and nothing else: no new module, no new card, no layout
  // edit. That is the property the card was asked for, and it is why nothing below is keyed on
  // "SEC" or "FinCEN" as a special case.
  //
  // `metrics` declares BOTH the labels and the arity, because agencies count different things:
  // OSHA has inspections, FinCEN has matters, and forcing all of them into
  // violations/actions/penalties is how a programme enrolment ends up displayed as an
  // enforcement action. A metric an agency has no analogue for is simply absent.
  card.AGENCIES = [
    { id: 'epa_echo',    short: 'EPA / ECHO',          label: 'EPA ECHO compliance & enforcement',
      metrics: ['Violations', 'Enforcement actions', 'Penalties'] },
    { id: 'state_env',   short: 'State environmental',  label: 'State environmental regulator',
      metrics: ['Violations', 'Enforcement actions', 'Penalties'] },
    { id: 'osha',        short: 'OSHA',                 label: 'OSHA inspections & violations',
      metrics: ['Inspections', 'Violations', 'Penalties'] },
    { id: 'sec',         short: 'SEC',                  label: 'SEC filings & enforcement',
      metrics: ['Enforcement matters', 'Penalties'] },
    { id: 'fincen',      short: 'FinCEN',               label: 'FinCEN enforcement actions',
      metrics: ['Enforcement actions', 'Penalties'] },
    { id: 'doj',         short: 'DOJ',                  label: 'DOJ enforcement & prosecutions',
      metrics: ['Matters', 'Penalties'] },
    { id: 'ofac',        short: 'OFAC',                 label: 'OFAC sanctions & designations',
      metrics: ['Designations', 'Penalties'] },
    { id: 'state_local', short: 'State / local',        label: 'State & local enforcement records',
      metrics: ['Records', 'Penalties'] }
  ];
  card.agency = function (id) {
    return card.AGENCIES.filter(function (a) { return a.id === id; })[0] || null;
  };

  // ── ENTITY ROLES ───────────────────────────────────────────────────────────────
  // The groups Entity Track Record renders, in order. `order` is display order; `required` marks
  // the group that always appears (the project entity, even with nothing on it, because its
  // absence of records is itself the answer a resident came for).
  //
  // `related` is gated: a related entity appears ONLY when its relationship to the property is
  // verified AND its role is material. Corporate-family members that merely share ownership are
  // deliberately excluded — a list of every affiliate is not information about this property.
  card.ENTITY_ROLES = [
    { id: 'project_entity', order: 1, required: true,
      heading: 'Project entity', label: 'Project entity' },
    { id: 'parent', order: 2, required: false, gated: true,
      heading: 'Parent / controlling entity', label: 'Parent company' },
    { id: 'related', order: 3, required: false, gated: true,
      heading: 'Related entity', label: 'Related entity' }
  ];
  card.entityRole = function (id) {
    return card.ENTITY_ROLES.filter(function (r) { return r.id === id; })[0] || null;
  };

  // ── RELATIONSHIP KINDS ─────────────────────────────────────────────────────────
  // A relationship is a first-class thing with a KIND, a SOURCE and a VERIFICATION STATUS —
  // never an adjective on a company. `group` says which entity group the kind belongs to, so the
  // layout follows from the data rather than from a hardcoded list of parent synonyms.
  //
  // `corporate_family` marks the two kinds that describe a company's ownership chart rather than
  // its part in THIS project. They are never sufficient on their own: a subsidiary or affiliate
  // appears only when the relationship record also states a material role here, which is the
  // structural form of "do not display unrelated corporate-family entities merely because they
  // share ownership."
  card.RELATIONSHIP_KINDS = [
    { id: 'parent_company',      label: 'Parent company',      group: 'parent' },
    { id: 'controlling_company', label: 'Controlling company', group: 'parent' },
    { id: 'ultimate_owner',      label: 'Ultimate owner',      group: 'parent' },
    { id: 'operator',            label: 'Operator',            group: 'related' },
    { id: 'developer',           label: 'Developer',           group: 'related' },
    { id: 'property_owner',      label: 'Property owner',      group: 'related' },
    { id: 'management_company',  label: 'Management company',  group: 'related' },
    { id: 'subsidiary',          label: 'Subsidiary',          group: 'related', corporate_family: true },
    { id: 'affiliate',           label: 'Affiliate',           group: 'related', corporate_family: true }
  ];
  card.relationshipKind = function (id) {
    return card.RELATIONSHIP_KINDS.filter(function (k) { return k.id === id; })[0] || null;
  };

  // The verification vocabulary is the one the database already enforces on `company_parents`,
  // where a CHECK makes a parent NAME storable only on a verified row. Reused verbatim so the
  // card and the store cannot disagree about what "verified" means.
  card.VERIFICATION = ['not_yet_asked', 'unverified_candidate', 'verified'];

  // Evidence classes come from docs/multi-source-evidence-architecture.md Part 4.4. They record
  // WHOSE evidence a relationship rests on, which is a different question from whether we have
  // verified it — a permit filing is authoritative about what was filed and about nothing else.
  card.EVIDENCE_CLASSES = ['register_of_record', 'identifier_backed', 'authoritative_filing',
    'regulatory_affiliation', 'published_statement', 'derived', 'candidate'];

  /**
   * THE GROUP GATE. Returns whether an entity may render in a group, and when it may not, WHY —
   * because the reason is itself something the card says out loud ("we've seen a possible parent
   * but haven't confirmed it") rather than a silent omission.
   *
   * Three rules, and none of them is a matter of taste:
   *   1. The project entity always renders. Its lack of records is the answer a resident came for.
   *   2. A parent or controlling entity renders only on a VERIFIED relationship WITH A SOURCE.
   *      Every parent/subsidiary relationship must carry both; an unsourced parent is a rumour,
   *      and a rumour that renders becomes a fact the moment a reader sees it next to a fine.
   *   3. A related entity additionally needs a stated MATERIAL ROLE in this project. Sharing a
   *      corporate parent is not a role.
   */
  card.entityGate = function (entity, role) {
    var r = typeof role === 'string' ? card.entityRole(role) : role;
    if (!r) return { show: false, reason: 'undeclared_role' };
    if (!r.gated) return { show: true, reason: null };
    if (!entity) return { show: false, reason: 'none' };
    var kind = card.relationshipKind(entity.relationship_kind);
    if (!kind || kind.group !== r.id) return { show: false, reason: 'kind_mismatch' };
    if (entity.relationship_verification !== 'verified') {
      return { show: false,
        reason: entity.relationship_verification === 'unverified_candidate' ? 'candidate' : 'unverified' };
    }
    if (!entity.relationship_source) return { show: false, reason: 'unsourced' };
    // A material role is what makes a related company information about THIS property. It is
    // required of every related kind, not only of the corporate-family ones, because an
    // "operator" with no stated role here is equally unexplained.
    if (r.id === 'related' && !entity.material_role) return { show: false, reason: 'not_material' };
    return { show: true, reason: null };
  };

  /** The relationship label shown under an entity's name, from the declared kind. */
  card.relationshipLabel = function (entity, role) {
    var kind = entity && card.relationshipKind(entity.relationship_kind);
    if (kind) return kind.label;
    var r = typeof role === 'string' ? card.entityRole(role) : role;
    return (r && r.label) || '';
  };

  // ── ENTITY RESOLUTION ──────────────────────────────────────────────────────────
  // Two different questions, deliberately answered by two different functions:
  //
  //   lookupTargets()  — WHAT DO WE SEARCH FOR? The corporate family is in scope: a verified
  //                      parent and a verified subsidiary are both worth querying, because a
  //                      resident is entitled to know a controlling company's record.
  //   recordsFor()     — WHERE DOES A RESULT GO? Strictly under the entity the source document
  //                      NAMES. The family is not in scope here, ever.
  //
  // Collapsing those two questions into one is precisely how a subsidiary's fine ends up on a
  // parent's record: the search was correct and the filing was correct, and the attribution in
  // between was assumed.
  card.ALIAS_KINDS = [
    { id: 'legal_name',  label: 'Legal name' },
    { id: 'former_name', label: 'Former legal name' },
    { id: 'dba_name',    label: 'Name it does business as' }
  ];

  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

  /**
   * The keys a record may be matched to this entity ON. Aliases count only when VERIFIED — an
   * unverified former name is somebody's guess that two companies are one company, and acting on
   * it is the automatic merge the model forbids.
   */
  card.matchKeys = function (entity) {
    if (!entity) return [];
    var keys = [];
    if (entity.id) keys.push({ basis: 'identifier', kind: 'entity_id', value: String(entity.id) });
    (entity.identifiers || []).forEach(function (i) {
      if (i && i.id_value) {
        keys.push({ basis: 'identifier', kind: i.id_type || 'identifier', value: String(i.id_value) });
      }
    });
    if (entity.name) keys.push({ basis: 'legal_name', kind: 'legal_name', value: norm(entity.name) });
    (entity.aliases || []).forEach(function (a) {
      if (!a || !a.name) return;
      if (a.verification !== 'verified') return;              // never an unverified alias
      if (a.kind !== 'former_name' && a.kind !== 'dba_name') return;
      keys.push({ basis: a.kind, kind: a.kind, value: norm(a.name) });
    });
    return keys;
  };

  /**
   * Why this record belongs to this entity, or null if it does not. Returning the BASIS rather
   * than a boolean is what lets the card show its working: a record attributed on a former name
   * can say so, which is the difference between an attribution a reader can check and one they
   * have to trust.
   *
   * A NEAR NAME MATCH IS NEVER ACCEPTED. "Greenland Energy LLC" and "Greenland Energy Holdings
   * LLC" are different companies until a source says otherwise.
   */
  card.matchBasis = function (record, entity) {
    if (!record || !entity) return null;
    var keys = card.matchKeys(entity);
    var ids = keys.filter(function (k) { return k.basis === 'identifier'; });
    // When the resolver has already spoken AND this entity carries an identifier to answer it
    // with, its answer is the answer — including when it says the record belongs to somebody
    // else. Falling back to the name there would let a resolved record be re-attributed by a name
    // collision, which is the resolution being overruled by the very guess it replaced. An entity
    // with no identifier at all cannot answer, so it falls through to the exact-name path below.
    if (record.matched_entity_id && ids.length) {
      var hit = ids.filter(function (k) { return k.value === String(record.matched_entity_id); })[0];
      return hit ? 'identifier' : null;
    }
    var name = norm(record.entity_name);
    if (!name) return null;
    var byName = keys.filter(function (k) { return k.basis !== 'identifier' && k.value === name; })[0];
    return byName ? byName.basis : null;
  };

  /**
   * THE ATTRIBUTION GATE. Returns the records that belong to one entity, and only those.
   * Every enforcement record is displayed under the legal entity the SOURCE DOCUMENT names —
   * never under the property, and never under a sibling because they share a corporate parent.
   */
  card.recordsFor = function (records, entity) {
    if (!entity) return [];
    return (records || []).filter(function (r) { return !!card.matchBasis(r, entity); });
  };

  /**
   * WHAT TO SEARCH FOR, for one property. Each target is a name or identifier worth querying an
   * agency with, tagged with `via` — the entity it came from — so a result can be filed back
   * under the company the document names rather than under whichever query found it.
   *
   * The corporate family is IN SCOPE here and only here, and only when verified: a parent we
   * have confirmed is worth a search, a parent we merely suspect is not.
   */
  card.lookupTargets = function (entities) {
    var out = [], seen = {};
    (entities || []).forEach(function (e) {
      if (!e) return;
      var role = e.role || 'project_entity';
      // An unverified relationship is not searched under the property's name. It stays a
      // candidate, and the card says a candidate exists rather than showing its record.
      if (role !== 'project_entity' && e.relationship_verification !== 'verified') return;
      card.matchKeys(e).forEach(function (k) {
        var dedup = role + '|' + k.basis + '|' + k.value;
        if (seen[dedup]) return;
        seen[dedup] = 1;
        out.push({ entity_id: e.id || null, entity_name: e.name || null, role: role,
          basis: k.basis, kind: k.kind, value: k.value,
          via: role === 'project_entity' ? 'project_entity' : (e.relationship_kind || role) });
      });
    });
    return out;
  };

  // ── THE ENFORCEMENT RECORD CONTRACT ────────────────────────────────────────────
  // One shape for every agency. `entity_name` + `matched_entity_id` are what make attribution
  // checkable: a record is displayed under the entity the SOURCE DOCUMENT names, never under the
  // property, and never under a sibling entity because they share a corporate parent.
  card.ENFORCEMENT_FIELDS = ['source_agency', 'source_name', 'record_type', 'entity_name',
    'matched_entity_id', 'entity_role', 'relationship_to_property',
    'parent_or_subsidiary_relationship', 'action_date', 'matter_number', 'violation_category',
    'violation_summary', 'penalty_amount', 'action_status', 'source_url', 'source_document_url',
    'source_document_title', 'verification_status', 'confidence_score', 'retrieved_at'];

  // `confidence_score` is CARRIED and never RENDERED. It is in the contract because sources and
  // resolvers emit one, and dropping it on ingest would throw away a number somebody upstream
  // computed. It does not reach the card, and no arbitration here consumes it: the architecture
  // doc's Q8 settles confidence as categorical, permanently, because a number invites arithmetic
  // across incommensurable evidence. `verification_status` is the field the card reads.
  card.UNRENDERED_FIELDS = ['confidence_score'];

  /**
   * How many records this entity has, split by whether we verified them. The split is the whole
   * point: the required empty state says "no VERIFIED enforcement records", so a record we hold
   * but have not verified may not be counted into that sentence in either direction.
   */
  card.entityRecordSummary = function (records) {
    var rows = records || [];
    var v = rows.filter(function (r) { return r && r.verification_status === 'verified'; }).length;
    return { total: rows.length, verified: v, unverified: rows.length - v };
  };

  /**
   * The one line under an entity's name that answers what a resident asked: does this company
   * have a record here or not. `n = 0` returns the required sentence, which names WHERE we
   * looked so "nothing found" cannot be read as "nothing exists".
   */
  card.entitySummaryText = function (summary) {
    var s = summary || { verified: 0, unverified: 0 };
    var main = s.verified === 0 ? card.COPY.module.noEnforcement
      : (s.verified === 1 ? card.COPY.module.enforcementFoundOne
        : card.say(card.COPY.module.enforcementFound, { n: s.verified }));
    var extra = s.unverified > 0
      ? card.say(s.unverified === 1 ? card.COPY.module.enforcementUnverifiedOne
        : card.COPY.module.enforcementUnverified, { n: s.unverified })
      : '';
    return { main: main, extra: extra };
  };

  /**
   * The heading over a single record: WHOSE record it is, then whose record it is NOT.
   * "Parent Company — FinCEN Enforcement Action" is the required form, and the relationship
   * label leading the line is the part that does the work — it is what stops a parent's matter
   * being read as something the project LLC did.
   *
   * A missing `record_type` yields the agency alone. Supplying "Enforcement Action" for a record
   * whose source never called it one would be inventing the single most consequential word.
   */
  card.recordHeading = function (record, entity, role) {
    var r = record || {};
    var rel = card.relationshipLabel(entity, role)
      || (entity && entity.role === 'project_entity' ? 'Project entity' : '');
    var agency = card.agency(r.source_agency);
    var src = (agency && agency.short) || r.source_agency || r.source_name || '';
    var what = [src, r.record_type].filter(Boolean).join(' ');
    return [rel, what].filter(Boolean).join(' \u2014 ');
  };

  /**
   * A penalty is a stated figure or nothing. An unstated penalty must never render as $0 —
   * the same rule metricText() enforces for counts, for the same reason: a zero reads as a
   * finding, and "the record does not state a penalty" is not a finding of no penalty.
   */
  card.penaltyText = function (record) {
    var v = record && record.penalty_amount;
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return '$' + v.toLocaleString('en-US');
  };

  /**
   * The rows of one record, in the order the brief specifies. A field the source document does
   * not state is returned with a NULL VALUE rather than dropped, so a caller can say the record
   * is silent on it instead of leaving a reader to assume it was checked.
   *
   * Two flags carry the layout decisions that would otherwise be re-derived by every caller:
   *   inHeading — the record heading already states this ("FinCEN Enforcement Action"), so a row
   *               repeating it is duplication, not disclosure.
   *   always    — render this row even when unstated. Penalty is the one field where silence is
   *               routinely misread as zero, so "the record doesn't say" has to be on the face of
   *               the record rather than in a list of omitted fields.
   */
  card.recordRows = function (record) {
    var r = record || {};
    var agency = card.agency(r.source_agency);
    return [
      { label: 'Source agency', value: (agency && agency.short) || r.source_agency || null,
        inHeading: true },
      { label: 'Record type', value: r.record_type || null, inHeading: true },
      { label: 'Named on the record', value: r.entity_name || null },
      { label: 'Relationship', value: r.relationship_to_property
        || r.parent_or_subsidiary_relationship || null },
      { label: 'Action date', value: r.action_date || null, kind: 'date' },
      { label: 'Matter number', value: r.matter_number || null },
      { label: 'Issue', value: r.violation_category || null },
      { label: 'Summary', value: r.violation_summary || null },
      { label: 'Penalty', value: card.penaltyText(r), always: true },
      { label: 'Status', value: r.action_status || null },
      // The link text is the document's own title. With no URL there is no document to point at,
      // so the row is unstated rather than a dead label naming the agency again.
      { label: 'Source document',
        value: (r.source_document_url || r.source_url)
          ? (r.source_document_title || 'Official record') : null,
        href: r.source_document_url || r.source_url || null }
    ];
  };

  /**
   * The footer sentence. It is a disclaimer about OUR coverage, and it exists because a
   * grid of green and grey badges invites exactly the misreading it forbids: that the card
   * grades the property or the companies on it. It does not.
   */
  card.DISCLAIMER = 'Data completeness reflects source coverage and our research status only. '
    + 'It is not a rating, score, or prediction about this property or any company.';

  /** The Maps slide-in CTA copy, in one place so panel and page cannot disagree. */
  card.CTA_LABEL = 'View the full property card';

  // ── APPROVED RESIDENT-FACING COPY (founder, 2026-08-11) ────────────────────────
  // These strings are approved verbatim. They live in code, not in a document, because
  // approved copy that has to be retyped from a markdown file drifts on first contact — and the
  // thing that drifts is precisely the guard: "we haven't looked" quietly becomes something a
  // resident can read as "there's nothing to find".
  //
  // THREE RULES, all enforced by test/property-card.test.mjs:
  //   1. ONE SENTENCE each. A module carries a label, a badge and a line; a second sentence turns
  //      a scannable card into a wall, and this page is mostly empty states. If a state needs a
  //      second sentence to be honest, it belongs in the RECEIPT, not the module.
  //   2. NO INTERNAL VOCABULARY. Not "entity", "dataset", "coverage", "queried", "attribution",
  //      "regulatory event", "not applicable". Say "the companies named on filings here".
  //   3. NEVER FAVOURABLE ABOUT AN ABSENCE. No phrasing may let "not checked" read as "clean".
  //
  // `<X>` = source name · `<n>` = a gated count · `<date>` = a real check date ·
  // `<thing>` = what was counted · `<peril>` = the hazard. Alternatives are interchangeable in
  // meaning — pick by length. Do not compose new wording when one of these fits.
  card.COPY = {
    // said once, near the top of a card that is mostly empty
    page: [
      'Blank sections mean we haven\u2019t checked that source yet \u2014 not that there\u2019s nothing to find.',
      'Where we haven\u2019t looked, we say so \u2014 an empty section is a gap in our research, not an all-clear.'
    ],
    // per-source rows in Entity Track Record, keyed by the state that produced them
    source: {
      not_checked: [
        'We haven\u2019t checked <X> yet for the companies named on filings here, so we can\u2019t tell you either way.',
        'Not checked yet \u2014 this isn\u2019t a clean record or a bad one, just one we haven\u2019t looked at.'
      ],
      checked_empty: [
        'We searched <X> on <date> and found nothing for the companies named here.',
        'We looked, and <X> had no records for these companies.'
      ],
      partial: [
        'We\u2019ve searched one <X> list and it was empty, but haven\u2019t searched its <other> records yet.',
        'Only part of <X> has been searched, so this isn\u2019t the full picture.'
      ],
      unavailable: [
        'We tried to check <X> and couldn\u2019t reach it, so this is unknown rather than empty.',
        '<X> didn\u2019t respond when we last checked.'
      ],
      access_restricted: [
        '<X> is public but blocks automated searches, so we can\u2019t read it for you.',
        'This source won\u2019t let software search it, so we can\u2019t show what\u2019s in it.'
      ],
      in_progress: ['We\u2019re connecting <X> now, so it isn\u2019t searchable yet.'],
      broken_link: ['We couldn\u2019t match this property to its record in <X>, so we can\u2019t tell you what\u2019s there.'],
      verified: [
        '<X> shows <n> <thing> for companies named on filings here.',
        '<n> <thing> are on record with <X>.'
      ],
      reported: ['<n> <thing>, as the applicant described them on the filing.'],
      no_metric: ['We have records, but no <metric> figures in them.']
    },
    // module-level lines. `caveat` entries are shown WITH content, not instead of it.
    module: {
      trackRecordAttribution: 'These records may involve other locations these companies are connected to, not necessarily anything at this address.',
      // The required empty state. It names WHERE we looked, so "nothing found" cannot be read as
      // "nothing exists" — our source list is not the universe of enforcement records.
      noEnforcement: 'No verified enforcement records found in currently connected HomeSignal sources.',
      // Its counterpart. The count is of VERIFIED records only, so the two sentences answer the
      // same question and a reader can compare one company's line against another's.
      enforcementFound: '<n> verified enforcement records found.',
      enforcementFoundOne: '1 verified enforcement record found.',
      // Held but not verified: neither a finding nor an absence, and it must not be folded into
      // either count, since the sentence above says "verified" and has to keep meaning it.
      enforcementUnverified: '<n> further records name this company, and we haven\u2019t verified them yet.',
      enforcementUnverifiedOne: '1 further record names this company, and we haven\u2019t verified it yet.',
      // The two directions of the attribution rule, said where each is read. Conduct travels
      // neither up nor down an ownership chart on its own.
      parentAttribution: 'These are the parent company\u2019s own records, not things the company at this address did.',
      projectAttribution: 'These are this company\u2019s own records, not its parent\u2019s.',
      // Why another company appears here at all, and why most never will.
      relatedWhy: 'We show another company here only when a public document shows what part it plays in this project.',
      // How the search is scoped, which is what makes "found nothing" mean something.
      lookupScope: 'We search under a company\u2019s current name, any earlier name we have confirmed, and the names it trades under.',
      // Two filings spelling a company two ways are two rows until a document says otherwise.
      separateCompanies: 'These names are listed separately because nothing we have read shows they are the same company.',
      recordNotStated: 'The record doesn\u2019t say.',
      // Shown when a formation date is known, so a company incorporated last quarter with no
      // history does not read as equivalent to a thirty-year-old company with a clean one.
      entityFormed: 'Company formed <date>, so there is little history to find either way.',
      relationshipUnverified: 'We have not verified how this company relates to the property, so its record is not shown here.',
      parentNone: [
        'We haven\u2019t confirmed a parent company for the companies here, and a similar name or shared address isn\u2019t enough for us to link them.',
        'No confirmed parent company \u2014 we only show one when a public document proves the link.'
      ],
      parentCandidate: 'We\u2019ve seen a possible parent company but haven\u2019t confirmed it, so we\u2019re not showing its history.',
      parcelNotRead: [
        'We haven\u2019t read the county\u2019s property records for this address yet, so the owner on record, acreage and parcel numbers aren\u2019t here.',
        'The owner on record comes from the county appraisal district, which we haven\u2019t connected to yet.'
      ],
      fieldNotStated: ['The filing doesn\u2019t say.', 'Not on the record.'],
      ownerAsFiledCaveat: 'This is the owner the applicant wrote on the permit, which is often a different company from whoever owns the land.',
      developmentFound: '<n> permits have been filed at this address, each linked to its official record.',
      developmentEmpty: 'No permits have been filed at this address in the records we searched.',
      facilityNoneHere: 'There\u2019s no regulated facility at this address in the records we searched \u2014 the ones on the map are nearby, not part of this property.',
      facilityNoParcelLink: 'We found regulatory connections to companies linked to this property, but haven\u2019t tied any facility to this parcel itself.',
      floodNotRead: 'We haven\u2019t checked flood maps for this parcel, so this isn\u2019t a sign it sits outside a flood zone.',
      perilNoSource: [
        'We don\u2019t have a <peril> source yet, so this hasn\u2019t been checked.',
        '<peril> isn\u2019t covered by anything we read yet.'
      ],
      meetingsNotLinked: [
        'We track meetings and notices for this ZIP and county but can\u2019t tie them to a single address yet.',
        'Nothing here is matched to this address specifically, though area notices are on your community page.'
      ],
      sustainabilityNone: 'We haven\u2019t matched any sustainability reporting to the companies here.',
      sustainabilityCaveat: 'These are figures companies publish about themselves, not regulators\u2019 findings.',
      instrumentsUnavailable: [
        'We can\u2019t search this county\u2019s deed records automatically yet, so deeds, liens and easements aren\u2019t here.',
        'County recorder records aren\u2019t available through our automated sources for this property.'
      ],
      instrumentsAsReported: 'Instrument references as reported by the county appraisal district, which aren\u2019t verified deed records.',
      regulatoryEmpty: 'We don\u2019t have individual records to show for the companies named on filings here.',
      connectedFound: '<n> companies named on filings here share a detail with one another, which means two records match rather than that the companies are the same.',
      connectedNone: 'No filing here shares a detail with another.'
    }
  };

  /**
   * Words that may never appear in the EXPLANATORY SENTENCES above — they belong in the receipt.
   *
   * SCOPE, so nobody later either breaks the design or drops the rule: this applies to `card.COPY`
   * only. It does NOT apply to two things that legitimately contain these words:
   *   1. The design's own section titles — Property Card 0004 names the module "Entity Track
   *      Record", and renaming it to satisfy a word list would break the approved design.
   *   2. The approved disclaimer, which says "source coverage" by design.
   * The rule exists to stop jargon leaking into a sentence a homeowner has to parse, not to purge
   * a vocabulary from the page.
   */
  card.INTERNAL_WORDS = ['entity', 'entities', 'dataset', 'coverage', 'attribution', 'queried',
    'result_count', 'regulatory event', 'not applicable'];

  /** Phrasing that would let an unchecked source read as a clean one. */
  card.FORBIDDEN_COPY = ['no violations', 'no known issues', 'compliant', 'no risk', 'all clear',
    'up to date', 'clean record'];

  /**
   * Pick approved copy and fill its placeholders. Returns '' for an unknown key rather than
   * inventing a sentence — a missing string is a gap to add to COPY, not to improvise around.
   */
  card.say = function (list, vars, which) {
    const arr = Array.isArray(list) ? list : (list ? [list] : []);
    let s = arr[which || 0] || arr[0] || '';
    if (!s) return '';
    Object.keys(vars || {}).forEach(function (k) {
      s = s.split('<' + k + '>').join(String(vars[k]));
    });
    return s;
  };

  // ── IDENTITY ───────────────────────────────────────────────────────────────────
  // The card is keyed by the ENGINE'S canonical address string — the one normalizer, engine
  // side, exactly as homesignalmap.html?addr= already is (docs/property-reports-cache.sql).
  // The page NEVER invents a key: a record that carries no engine-emitted address yields
  // null here, and the card then says the parcel is unresolved instead of guessing one.
  // MEASURED 2026-08-11, and the reason this function is strict: `canonical_addr` exists on exactly
  // 5 site records in the entire cache — the Del Valle TABS filings. Every other connector
  // (arcgis / socrata / ckan / csv / carto) writes a RAW `address` string instead: Cleveland 44127
  // alone holds 3,415 distinct raw addresses, Phoenix 85003 holds 1,315.
  //
  // A raw address must NEVER be used as the card key. It is unnormalized, so "2165 E 89TH ST,
  // CLEVELAND, OH, 44106" and any other spelling of the same parcel would each mint their own card
  // — one parcel, several thin cards, none authoritative. That is precisely the drift the canonical
  // key exists to prevent, and it is why the normalizer is engine-side and singular. Canonicalizing
  // here would make the page a SECOND normalizer, which is how a page and a cache come to disagree
  // about which row is "this property".
  card.keyOf = function (rec) {
    if (!rec) return null;
    const k = rec.canonical_addr || rec.location_addr || null;
    return k ? String(k).trim() || null : null;
  };

  /**
   * The raw, unnormalized address a record carries, when it has one. Safe to DISPLAY — it tells a
   * resident which building the record is about — but never a key. A record with a raw address and
   * no canonical key is an unresolved parcel, and the card says so rather than inventing a key.
   */
  card.rawAddressOf = function (rec) {
    if (!rec || card.keyOf(rec)) return null;
    const a = rec.address || null;
    return a ? String(a).trim() || null : null;
  };

  /**
   * Link to the card. `addr` is used when the record carries the canonical key; otherwise
   * zip+id let the page resolve the address from the same cache the map page reads. Both
   * paths are honest — the second just costs a lookup.
   */
  card.href = function (o) {
    o = o || {};
    const p = [];
    if (o.zip && /^\d{5}$/.test(String(o.zip))) p.push('zip=' + encodeURIComponent(String(o.zip)));
    if (o.addr) p.push('addr=' + encodeURIComponent(String(o.addr).trim()));
    if (o.id) p.push('id=' + encodeURIComponent(String(o.id)));
    if (o.place) p.push('place=' + encodeURIComponent(String(o.place)));
    return 'property-card.html' + (p.length ? '?' + p.join('&') : '');
  };

  /**
   * The Maps slide-in's top-of-panel link. Rendered for every record the panel can open,
   * because "we could not resolve this parcel" is itself a thing the card must be able to
   * say — hiding the link when the address is unknown would hide that answer.
   */
  card.ctaHTML = function (o) {
    o = o || {};
    // When the record carries the canonical address, SHOW it — that is what tells a resident
    // which parcel the card will be about. Otherwise name what the card holds instead of
    // implying an address we do not have.
    const sub = o.subtitle || o.addr
      || 'Ownership, entity track record, hazards, and every source we have not checked yet';
    return '<a class="pccta" id="pcCta" href="' + esc(card.href(o)) + '">'
      + '<span class="pcct">' + esc(card.CTA_LABEL) + '</span>'
      + '<span class="pccs">' + esc(sub) + '</span>'
      + '<span class="pcca" aria-hidden="true">\u2192</span></a>';
  };
})();
