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

  card.badgeHTML = function (state, opts) {
    opts = opts || {};
    const k = card.state(state);
    const tone = k ? STATES[k].tone : 'none';
    const text = opts.short && k ? STATES[k].short : card.label(state);
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
    const byState = {}; let total = 0, unrecognized = 0;
    (rows || []).forEach(function (r) {
      const k = card.state(r && r.state !== undefined ? r.state : r);
      total++;
      if (k === null) { unrecognized++; return; }
      byState[k] = (byState[k] || 0) + 1;
    });
    return { byState: byState, total: total, unrecognized: unrecognized };
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
    out += '<text x="' + cx + '" y="' + (cy - 1) + '" text-anchor="middle" class="pcdn">'
      + (total > 0 ? String(total) : card.NO_VALUE) + '</text>'
      + '<text x="' + cx + '" y="' + (cy + 15) + '" text-anchor="middle" class="pcdl">'
      + (total === 1 ? 'source' : 'sources') + '</text></svg>';
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

  card.SECTIONS = [
    { id: 'entity-track-record',   tab: 'trackrec',   title: 'Entity track record' },
    { id: 'parent-track-record',   tab: 'trackrec',   title: 'Parent company track record' },
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

  /**
   * The footer sentence. It is a disclaimer about OUR coverage, and it exists because a
   * grid of green and grey badges invites exactly the misreading it forbids: that the card
   * grades the property or the companies on it. It does not.
   */
  card.DISCLAIMER = 'Data completeness reflects source coverage and our research status only. '
    + 'It is not a rating, score, or prediction about this property or any company.';

  /** The Maps slide-in CTA copy, in one place so panel and page cannot disagree. */
  card.CTA_LABEL = 'View the full property card';

  // ── IDENTITY ───────────────────────────────────────────────────────────────────
  // The card is keyed by the ENGINE'S canonical address string — the one normalizer, engine
  // side, exactly as homesignalmap.html?addr= already is (docs/property-reports-cache.sql).
  // The page NEVER invents a key: a record that carries no engine-emitted address yields
  // null here, and the card then says the parcel is unresolved instead of guessing one.
  card.keyOf = function (rec) {
    if (!rec) return null;
    const k = rec.canonical_addr || rec.location_addr || rec.address || null;
    return k ? String(k).trim() || null : null;
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
